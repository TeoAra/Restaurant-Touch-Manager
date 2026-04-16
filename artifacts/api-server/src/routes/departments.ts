import { Router } from "express";
import { db } from "@workspace/db";
import { departmentsTable, insertDepartmentSchema } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/", async (_req, res) => {
  const rows = await db.select().from(departmentsTable).orderBy(departmentsTable.name);
  res.json(rows);
});

router.post("/", async (req, res) => {
  const parsed = insertDepartmentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [row] = await db.insert(departmentsTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const parsed = insertDepartmentSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [row] = await db.update(departmentsTable).set(parsed.data).where(eq(departmentsTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [row] = await db.delete(departmentsTable).where(eq(departmentsTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json({ success: true });
});

export default router;
