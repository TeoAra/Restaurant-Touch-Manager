import { Router } from "express";
import { db, productsTable } from "@workspace/db";
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

export default router;
