import { Router } from "express";
import { db, discountsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/", async (_req, res) => {
  const rows = await db.select().from(discountsTable).orderBy(discountsTable.name);
  res.json(rows);
});

router.post("/", async (req, res) => {
  const { name, type, value, applicableTo, active } = req.body as {
    name: string; type?: string; value?: string; applicableTo?: string; active?: boolean;
  };
  const [row] = await db.insert(discountsTable).values({ name, type: type ?? "percent", value: value ?? "0", applicableTo: applicableTo ?? "order", active: active ?? true }).returning();
  res.status(201).json(row);
});

router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const updates: Record<string, unknown> = {};
  const { name, type, value, applicableTo, active } = req.body as Record<string, unknown>;
  if (name !== undefined) updates.name = name;
  if (type !== undefined) updates.type = type;
  if (value !== undefined) updates.value = value;
  if (applicableTo !== undefined) updates.applicableTo = applicableTo;
  if (active !== undefined) updates.active = active;
  const [row] = await db.update(discountsTable).set(updates as never).where(eq(discountsTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

router.delete("/:id", async (req, res) => {
  await db.delete(discountsTable).where(eq(discountsTable.id, Number(req.params.id)));
  res.status(204).end();
});

export default router;
