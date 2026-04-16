import { Router } from "express";
import { db, categoriesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateCategoryBody, UpdateCategoryBody, GetCategoryParams, UpdateCategoryParams, DeleteCategoryParams } from "@workspace/api-zod";

const router = Router();

router.get("/", async (req, res) => {
  const categories = await db.select().from(categoriesTable).orderBy(categoriesTable.sortOrder);
  res.json(categories);
});

router.post("/", async (req, res) => {
  const body = CreateCategoryBody.parse(req.body);
  const [category] = await db.insert(categoriesTable).values(body).returning();
  res.status(201).json(category);
});

router.get("/:id", async (req, res) => {
  const { id } = GetCategoryParams.parse({ id: Number(req.params.id) });
  const [category] = await db.select().from(categoriesTable).where(eq(categoriesTable.id, id));
  if (!category) return res.status(404).json({ error: "Category not found" });
  res.json(category);
});

router.patch("/:id", async (req, res) => {
  const { id } = UpdateCategoryParams.parse({ id: Number(req.params.id) });
  const body = UpdateCategoryBody.parse(req.body);
  const [category] = await db.update(categoriesTable).set(body).where(eq(categoriesTable.id, id)).returning();
  if (!category) return res.status(404).json({ error: "Category not found" });
  res.json(category);
});

router.delete("/:id", async (req, res) => {
  const { id } = DeleteCategoryParams.parse({ id: Number(req.params.id) });
  await db.delete(categoriesTable).where(eq(categoriesTable.id, id));
  res.status(204).end();
});

export default router;
