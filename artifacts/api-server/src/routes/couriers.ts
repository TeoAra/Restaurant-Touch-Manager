import { Router } from "express";
import { db, couriersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/", async (_req, res) => {
  const rows = await db.select().from(couriersTable).orderBy(couriersTable.name);
  res.json(rows);
});

router.post("/", async (req, res) => {
  const { name, phone, vehicle, notes, active } = req.body as {
    name: string; phone?: string; vehicle?: string; notes?: string; active?: boolean;
  };
  const [row] = await db.insert(couriersTable).values({ name, phone, vehicle: vehicle ?? "moto", notes, active: active ?? true }).returning();
  res.status(201).json(row);
});

router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const updates: Record<string, unknown> = {};
  const { name, phone, vehicle, notes, active } = req.body as Record<string, unknown>;
  if (name !== undefined) updates.name = name;
  if (phone !== undefined) updates.phone = phone;
  if (vehicle !== undefined) updates.vehicle = vehicle;
  if (notes !== undefined) updates.notes = notes;
  if (active !== undefined) updates.active = active;
  const [row] = await db.update(couriersTable).set(updates as never).where(eq(couriersTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

router.delete("/:id", async (req, res) => {
  await db.delete(couriersTable).where(eq(couriersTable.id, Number(req.params.id)));
  res.status(204).end();
});

export default router;
