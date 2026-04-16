import { Router } from "express";
import { db, promotionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/", async (_req, res) => {
  const rows = await db.select().from(promotionsTable).orderBy(promotionsTable.name);
  res.json(rows);
});

router.post("/", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const [row] = await db.insert(promotionsTable).values({
    name: body.name as string,
    description: body.description as string | undefined,
    type: (body.type as string) ?? "discount_percent",
    value: (body.value as string) ?? "0",
    minAmount: (body.minAmount as string) ?? "0",
    startDate: body.startDate as string | undefined,
    endDate: body.endDate as string | undefined,
    daysOfWeek: body.daysOfWeek as string | undefined,
    startTime: body.startTime as string | undefined,
    endTime: body.endTime as string | undefined,
    categoryIds: body.categoryIds as string | undefined,
    productIds: body.productIds as string | undefined,
    active: (body.active as boolean) ?? true,
  }).returning();
  res.status(201).json(row);
});

router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body as Record<string, unknown>;
  const [row] = await db.update(promotionsTable).set(body as never).where(eq(promotionsTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

router.delete("/:id", async (req, res) => {
  await db.delete(promotionsTable).where(eq(promotionsTable.id, Number(req.params.id)));
  res.status(204).end();
});

export default router;
