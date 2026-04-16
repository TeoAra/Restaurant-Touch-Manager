import { Router } from "express";
import { db, customersTable } from "@workspace/db";
import { eq, ilike, or } from "drizzle-orm";

const router = Router();

router.get("/", async (req, res) => {
  const { q } = req.query;
  let query = db.select().from(customersTable).orderBy(customersTable.ragioneSociale);
  if (q && typeof q === "string") {
    const customers = await db.select().from(customersTable)
      .where(or(
        ilike(customersTable.ragioneSociale, `%${q}%`),
        ilike(customersTable.codiceFiscale, `%${q}%`),
        ilike(customersTable.partitaIva, `%${q}%`),
      ))
      .orderBy(customersTable.ragioneSociale);
    return res.json(customers);
  }
  const customers = await query;
  res.json(customers);
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, id));
  if (!customer) return res.status(404).json({ error: "Cliente non trovato" });
  res.json(customer);
});

router.post("/", async (req, res) => {
  const body = req.body;
  const [customer] = await db.insert(customersTable).values({
    tipo: body.tipo ?? "privato",
    ragioneSociale: body.ragioneSociale,
    nome: body.nome,
    cognome: body.cognome,
    codiceFiscale: body.codiceFiscale,
    partitaIva: body.partitaIva,
    pec: body.pec,
    codiceDestinatario: body.codiceDestinatario ?? "0000000",
    indirizzo: body.indirizzo,
    cap: body.cap,
    comune: body.comune,
    provincia: body.provincia,
    nazione: body.nazione ?? "IT",
    telefono: body.telefono,
    email: body.email,
    note: body.note,
  }).returning();
  res.status(201).json(customer);
});

router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body;
  const [customer] = await db.update(customersTable)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(customersTable.id, id))
    .returning();
  if (!customer) return res.status(404).json({ error: "Cliente non trovato" });
  res.json(customer);
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(customersTable).where(eq(customersTable.id, id));
  res.status(204).end();
});

export default router;
