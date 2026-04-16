import { Router } from "express";
import { db, productsTable, productVariationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateProductBody, UpdateProductBody, GetProductParams, UpdateProductParams, DeleteProductParams, ListProductsQueryParams } from "@workspace/api-zod";

const router = Router();

router.get("/", async (req, res) => {
  const params = ListProductsQueryParams.parse({
    categoryId: req.query.categoryId !== undefined ? Number(req.query.categoryId) : undefined,
  });
  let query = db.select().from(productsTable).orderBy(productsTable.sortOrder);
  if (params.categoryId != null) {
    const filtered = await db.select().from(productsTable).where(eq(productsTable.categoryId, params.categoryId)).orderBy(productsTable.sortOrder);
    return res.json(filtered);
  }
  const products = await query;
  res.json(products);
});

router.post("/", async (req, res) => {
  const body = CreateProductBody.parse(req.body);
  const [product] = await db.insert(productsTable).values(body).returning();
  res.status(201).json(product);
});

router.get("/:id", async (req, res) => {
  const { id } = GetProductParams.parse({ id: Number(req.params.id) });
  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, id));
  if (!product) return res.status(404).json({ error: "Product not found" });
  res.json(product);
});

router.patch("/:id", async (req, res) => {
  const { id } = UpdateProductParams.parse({ id: Number(req.params.id) });
  const body = UpdateProductBody.parse(req.body);
  const [product] = await db.update(productsTable).set(body).where(eq(productsTable.id, id)).returning();
  if (!product) return res.status(404).json({ error: "Product not found" });
  res.json(product);
});

router.delete("/:id", async (req, res) => {
  const { id } = DeleteProductParams.parse({ id: Number(req.params.id) });
  await db.delete(productsTable).where(eq(productsTable.id, id));
  res.status(204).end();
});

// ── Product Variations ─────────────────────────────────────────────────────

router.get("/:id/variations", async (req, res) => {
  const productId = Number(req.params.id);
  const rows = await db.select().from(productVariationsTable)
    .where(eq(productVariationsTable.productId, productId))
    .orderBy(productVariationsTable.sortOrder);
  res.json(rows);
});

router.post("/:id/variations", async (req, res) => {
  const productId = Number(req.params.id);
  const { name, options, required, sortOrder } = req.body as {
    name: string; options: Array<{ name: string; priceExtra: string }>;
    required?: boolean; sortOrder?: number;
  };
  const [row] = await db.insert(productVariationsTable).values({
    productId,
    name,
    options: JSON.stringify(options ?? []),
    required: required ?? false,
    sortOrder: sortOrder ?? 0,
  }).returning();
  res.status(201).json(row);
});

router.patch("/:productId/variations/:varId", async (req, res) => {
  const varId = Number(req.params.varId);
  const { name, options, required, sortOrder } = req.body as {
    name?: string; options?: Array<{ name: string; priceExtra: string }>;
    required?: boolean; sortOrder?: number;
  };
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (options !== undefined) updates.options = JSON.stringify(options);
  if (required !== undefined) updates.required = required;
  if (sortOrder !== undefined) updates.sortOrder = sortOrder;
  const [row] = await db.update(productVariationsTable).set(updates as never)
    .where(eq(productVariationsTable.id, varId)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

router.delete("/:productId/variations/:varId", async (req, res) => {
  const varId = Number(req.params.varId);
  await db.delete(productVariationsTable).where(eq(productVariationsTable.id, varId));
  res.status(204).end();
});

export default router;
