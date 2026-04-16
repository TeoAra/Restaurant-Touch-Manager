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
  await Promise.all(items.map(({ id, sortOrder }) =>
    db.update(tablesTable).set({ sortOrder }).where(eq(tablesTable.id, id))
  ));
  res.json({ success: true });
});

router.post("/", async (req, res) => {
  const body = CreateTableBody.parse(req.body);
  const [table] = await db.insert(tablesTable).values(body).returning();
  res.status(201).json(table);
});

router.get("/:id", async (req, res) => {
  const { id } = GetTableParams.parse({ id: Number(req.params.id) });
  const [table] = await db.select().from(tablesTable).where(eq(tablesTable.id, id));
  if (!table) return res.status(404).json({ error: "Table not found" });
  res.json(table);
});

router.patch("/:id", async (req, res) => {
  const { id } = UpdateTableParams.parse({ id: Number(req.params.id) });
  const body = UpdateTableBody.parse(req.body);
  const [table] = await db.update(tablesTable).set(body).where(eq(tablesTable.id, id)).returning();
  if (!table) return res.status(404).json({ error: "Table not found" });
  res.json(table);
});

router.delete("/:id", async (req, res) => {
  const { id } = DeleteTableParams.parse({ id: Number(req.params.id) });
  await db.delete(tablesTable).where(eq(tablesTable.id, id));
  res.status(204).end();
});

export default router;
