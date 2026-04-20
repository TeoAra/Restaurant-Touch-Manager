import { Router } from "express";
import { db, reservationsTable, tablesTable } from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";

const router = Router();

// GET /api/reservations?date=YYYY-MM-DD&from=YYYY-MM-DD&to=YYYY-MM-DD
router.get("/", async (req, res) => {
  const { date, from, to } = req.query as Record<string, string | undefined>;
  let rows = await db.select().from(reservationsTable).orderBy(reservationsTable.date, reservationsTable.time);
  if (date) rows = rows.filter(r => r.date === date);
  else if (from && to) rows = rows.filter(r => r.date >= from && r.date <= to);

  const tables = await db.select({ id: tablesTable.id, name: tablesTable.name }).from(tablesTable);
  const tableMap = new Map(tables.map(t => [t.id, t.name]));
  const result = rows.map(r => ({ ...r, tableName: r.tableId ? (tableMap.get(r.tableId) ?? null) : null }));
  res.json(result);
});

// POST /api/reservations
router.post("/", async (req, res) => {
  const { tableId, date, time, covers, guestName, phone, notes } = req.body as {
    tableId?: number | null; date: string; time: string; covers?: number;
    guestName: string; phone?: string; notes?: string;
  };
  const [row] = await db.insert(reservationsTable).values({
    tableId: tableId ?? null,
    date, time,
    covers: covers ?? 2,
    guestName,
    phone: phone ?? null,
    notes: notes ?? null,
    status: "confirmed",
  }).returning();
  res.status(201).json(row);
});

// PATCH /api/reservations/:id
router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const { tableId, date, time, covers, guestName, phone, notes, status } = req.body as Partial<{
    tableId: number | null; date: string; time: string; covers: number;
    guestName: string; phone: string; notes: string; status: string;
  }>;
  const updates: Partial<typeof reservationsTable.$inferInsert> = {};
  if (date !== undefined) updates.date = date;
  if (time !== undefined) updates.time = time;
  if (covers !== undefined) updates.covers = covers;
  if (guestName !== undefined) updates.guestName = guestName;
  if (phone !== undefined) updates.phone = phone;
  if (notes !== undefined) updates.notes = notes;
  if (status !== undefined) updates.status = status;
  if (tableId !== undefined) updates.tableId = tableId;

  const [row] = await db.update(reservationsTable).set(updates).where(eq(reservationsTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Prenotazione non trovata" });
  res.json(row);
});

// DELETE /api/reservations/:id
router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(reservationsTable).where(eq(reservationsTable.id, id));
  res.status(204).end();
});

export default router;
