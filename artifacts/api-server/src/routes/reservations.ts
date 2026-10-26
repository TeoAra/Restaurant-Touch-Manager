import { Router } from "express";
import { db, reservationsTable, tablesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { getSettings } from "../lib/settings";
import { bookingConflict, bookingTableIds, validateBooking, validDate } from "../lib/reservations";
import { requireStaff } from "../lib/staff-session";

const router = Router();
const publicLimits = new Map<string, { count: number; until: number }>();

router.get("/public/config", async (_req, res) => {
  const settings = await getSettings();
  res.json({
    enabled: settings.online_booking_enabled === "true",
    restaurantName: settings.restaurant_name || settings.nome_locale || "Prenotazioni",
    maxCovers: 30,
    whatsappConfigured: false,
  });
});

// Public route never returns the guest list, phone numbers or table occupancy.
router.post("/public/request", async (req, res): Promise<void> => {
  const settings = await getSettings();
  if (settings.online_booking_enabled !== "true") {
    res.status(403).json({ error: "Le richieste online non sono attive. Contatta il locale." }); return;
  }
  const now = Date.now();
  for (const [key, entry] of publicLimits) if (entry.until < now) publicLimits.delete(key);
  // Do not trust arbitrary X-Forwarded-For headers supplied by guests.
  const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const limit = publicLimits.get(key) ?? { count: 0, until: now + 15 * 60_000 };
  if (++limit.count > 20 || publicLimits.size > 10_000) {
    res.setHeader("Retry-After", "900");
    res.status(429).json({ error: "Troppe richieste. Attendi qualche minuto o contatta il locale." }); return;
  }
  publicLimits.set(key, limit);
  const body = req.body ?? {};
  if (body.website) { res.status(400).json({ error: "Richiesta non valida" }); return; }
  const candidate = {
    date: body.date, time: body.time, covers: body.covers,
    guestName: typeof body.guestName === "string" ? body.guestName.trim() : body.guestName,
    phone: typeof body.phone === "string" ? body.phone.trim() : body.phone,
    notes: body.notes || null, durationMinutes: 120, status: "pending", source: "online",
  };
  const error = validateBooking(candidate);
  if (error) { res.status(400).json({ error }); return; }
  if (!candidate.phone || candidate.covers > 30) {
    res.status(400).json({ error: "Inserisci un recapito telefonico. Per più di 30 coperti contatta il locale." }); return;
  }
  const localToday = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());
  if (candidate.date < localToday || candidate.date > new Date(now + 366 * 86400_000).toISOString().slice(0, 10)) {
    res.status(400).json({ error: "Scegli una data da oggi entro un anno" }); return;
  }
  const [row] = await db.insert(reservationsTable).values(candidate).returning({ id: reservationsTable.id });
  res.status(201).json({ id: row.id, status: "pending", message: "Richiesta ricevuta. La prenotazione sarà valida solo dopo la conferma del locale." });
});

router.use(requireStaff);

router.get("/", async (req, res): Promise<void> => {
  const { date, from, to, status } = req.query as Record<string, string | undefined>;
  if ((date && !validDate(date)) || (from && !validDate(from)) || (to && !validDate(to))) {
    res.status(400).json({ error: "Intervallo di date non valido" }); return;
  }
  let rows = await db.select().from(reservationsTable).orderBy(reservationsTable.date, reservationsTable.time);
  if (date) rows = rows.filter(r => r.date === date);
  else if (from && to) rows = rows.filter(r => r.date >= from && r.date <= to);
  if (status) rows = rows.filter(r => r.status === status);
  const tables = await db.select({ id: tablesTable.id, name: tablesTable.name }).from(tablesTable);
  const names = new Map(tables.map(t => [t.id, t.name]));
  res.json(rows.map(r => ({ ...r, tableName: bookingTableIds(r).map(id => names.get(id)).filter(Boolean).join(", ") || null })));
});

class BookingError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function saveBooking(body: Record<string, unknown>, id?: number) {
  return db.transaction(async tx => {
    // Serializes overlapping checks with writes, including concurrent staff sessions.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7315091)`);
    const [previous] = id ? await tx.select().from(reservationsTable).where(eq(reservationsTable.id, id)) : [];
    if (id && !previous) throw new BookingError(404, "Prenotazione non trovata");
    const row = {
      ...(previous ?? { tableId: null, tableIds: null, covers: 2, phone: null, notes: null, durationMinutes: 120, status: "confirmed", source: "desk" }),
      ...Object.fromEntries(Object.entries(body).filter(([k]) =>
        ["date", "time", "covers", "guestName", "phone", "notes", "durationMinutes", "status"].includes(k))),
    } as typeof reservationsTable.$inferInsert;
    if (typeof row.guestName === "string") row.guestName = row.guestName.trim();
    if (body.tableIds !== undefined) {
      if (!Array.isArray(body.tableIds) || !body.tableIds.every(v => Number.isInteger(v) && v > 0)) throw new BookingError(400, "Tavoli non validi");
      const ids = [...new Set(body.tableIds as number[])];
      row.tableIds = ids.length ? JSON.stringify(ids) : null;
      row.tableId = ids[0] ?? null;
    } else if (body.tableId !== undefined) {
      if (body.tableId !== null && (!Number.isInteger(body.tableId) || Number(body.tableId) <= 0)) throw new BookingError(400, "Tavolo non valido");
      row.tableId = body.tableId as number | null;
      row.tableIds = row.tableId ? JSON.stringify([row.tableId]) : null;
    }
    const error = validateBooking(row);
    if (error) throw new BookingError(400, error);
    const tables = await tx.select({ id: tablesTable.id }).from(tablesTable);
    if (bookingTableIds(row).some(id => !tables.some(t => t.id === id))) throw new BookingError(400, "Uno dei tavoli non esiste più");
    const all = await tx.select().from(reservationsTable);
    const conflict = bookingConflict({ ...row, id, durationMinutes: row.durationMinutes!, status: row.status! }, all);
    if (conflict) throw new BookingError(409, `Tavolo già prenotato alle ${conflict.time}. Cambia tavolo, orario o durata.`);
    const [saved] = id
      ? await tx.update(reservationsTable).set(row).where(eq(reservationsTable.id, id)).returning()
      : await tx.insert(reservationsTable).values(row).returning();
    return saved;
  });
}

router.post("/", async (req, res): Promise<void> => {
  try { res.status(201).json(await saveBooking(req.body ?? {})); }
  catch (error) {
    if (error instanceof BookingError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
});

router.patch("/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) { res.status(400).json({ error: "ID non valido" }); return; }
  try { res.json(await saveBooking(req.body ?? {}, id)); }
  catch (error) {
    if (error instanceof BookingError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
});

router.delete("/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) { res.status(400).json({ error: "ID non valido" }); return; }
  // Keep booking history rather than losing the customer's request.
  await db.update(reservationsTable).set({ status: "cancelled" }).where(eq(reservationsTable.id, id));
  res.status(204).end();
});

export default router;
