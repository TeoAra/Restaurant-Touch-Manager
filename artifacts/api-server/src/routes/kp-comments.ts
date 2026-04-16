import { Router } from "express";
import { db, kpCommentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/", async (_req, res) => {
  const rows = await db.select().from(kpCommentsTable).orderBy(kpCommentsTable.sortOrder);
  res.json(rows);
});

router.post("/", async (req, res) => {
  const { text, sortOrder, active } = req.body as { text: string; sortOrder?: number; active?: boolean };
  const [row] = await db.insert(kpCommentsTable).values({ text, sortOrder: sortOrder ?? 0, active: active ?? true }).returning();
  res.status(201).json(row);
});

router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.update(kpCommentsTable).set(req.body as never).where(eq(kpCommentsTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

router.delete("/:id", async (req, res) => {
  await db.delete(kpCommentsTable).where(eq(kpCommentsTable.id, Number(req.params.id)));
  res.status(204).end();
});

export default router;
