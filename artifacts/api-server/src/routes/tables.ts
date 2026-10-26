import { Router } from "express";
import { db, tablesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateTableBody, UpdateTableBody, GetTableParams, UpdateTableParams, DeleteTableParams } from "@workspace/api-zod";

const router = Router();

router.get("/", async (req, res) => {
  const tables = await db.select().from(tablesTable).orderBy(tablesTable.sortOrder, tablesTable.number);
  res.json(tables);
});

// Reorder tables: receives array of {id, sortOrder}
router.post("/reorder", async (req, res) => {
  const items: { id: number; sortOrder: number }[] = req.body;
  if (!Array.isArray(items) || items.length > 1000 || items.some(item =>
    !item || !Number.isInteger(item.id) || item.id < 1 || !Number.isInteger(item.sortOrder) || item.sortOrder < 0
  ) || new Set(items.map(item => item.id)).size !== items.length) {
    return res.status(400).json({ error: "Ordinamento tavoli non valido" });
  }
  await db.transaction(async tx => {
    for (const { id, sortOrder } of items) await tx.update(tablesTable).set({ sortOrder }).where(eq(tablesTable.id, id));
  });
  return res.json({ success: true });
});

router.post("/", async (req, res) => {
  const body = CreateTableBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Dati del tavolo non validi", details: body.error.issues });
  const [table] = await db.insert(tablesTable).values(body.data).returning();
  return res.status(201).json(table);
});

router.get("/:id", async (req, res) => {
  const { id } = GetTableParams.parse({ id: Number(req.params.id) });
  const [table] = await db.select().from(tablesTable).where(eq(tablesTable.id, id));
  if (!table) return res.status(404).json({ error: "Table not found" });
  return res.json(table);
});

router.patch("/:id", async (req, res) => {
  const { id } = UpdateTableParams.parse({ id: Number(req.params.id) });
  const body = UpdateTableBody.safeParse(req.body);
  if (!body.success || Object.keys(body.data).length === 0) return res.status(400).json({ error: "Posizione o dati del tavolo non validi" });
  const [table] = await db.update(tablesTable).set(body.data).where(eq(tablesTable.id, id)).returning();
  if (!table) return res.status(404).json({ error: "Table not found" });
  return res.json(table);
});

router.delete("/:id", async (req, res) => {
  const { id } = DeleteTableParams.parse({ id: Number(req.params.id) });
  await db.delete(tablesTable).where(eq(tablesTable.id, id));
  res.status(204).end();
});

export default router;
