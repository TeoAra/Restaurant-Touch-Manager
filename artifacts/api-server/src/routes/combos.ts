import { Router } from "express";
import { db, combosTable, comboItemsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/", async (_req, res) => {
  const rows = await db.select().from(combosTable).orderBy(combosTable.sortOrder);
  res.json(rows);
});

router.post("/", async (req, res) => {
  const { name, description, price, categoryId, available, sortOrder } = req.body as {
    name: string; description?: string; price?: string; categoryId?: number; available?: boolean; sortOrder?: number;
  };
  const [row] = await db.insert(combosTable).values({ name, description, price: price ?? "0.00", categoryId, available: available ?? true, sortOrder: sortOrder ?? 0 }).returning();
  res.status(201).json(row);
});

router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.update(combosTable).set(req.body as never).where(eq(combosTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(comboItemsTable).where(eq(comboItemsTable.comboId, id));
  await db.delete(combosTable).where(eq(combosTable.id, id));
  res.status(204).end();
});

router.get("/:id/items", async (req, res) => {
  const rows = await db.select().from(comboItemsTable).where(eq(comboItemsTable.comboId, Number(req.params.id))).orderBy(comboItemsTable.sortOrder);
  res.json(rows);
});

router.post("/:id/items", async (req, res) => {
  const comboId = Number(req.params.id);
  const { productId, productName, quantity, priceOverride, sortOrder } = req.body as {
    productId: number; productName: string; quantity?: number; priceOverride?: string; sortOrder?: number;
  };
  const [row] = await db.insert(comboItemsTable).values({ comboId, productId, productName, quantity: quantity ?? 1, priceOverride, sortOrder: sortOrder ?? 0 }).returning();
  res.status(201).json(row);
});

router.delete("/:id/items/:itemId", async (req, res) => {
  await db.delete(comboItemsTable).where(eq(comboItemsTable.id, Number(req.params.itemId)));
  res.status(204).end();
});

export default router;
