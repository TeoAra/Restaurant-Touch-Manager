import { Router } from "express";
import { db, happyHourTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/", async (_req, res) => {
  const rows = await db.select().from(happyHourTable).orderBy(happyHourTable.name);
  res.json(rows);
});

router.get("/active", async (_req, res) => {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const timeStr = now.toTimeString().slice(0, 5);
  const allRules = await db.select().from(happyHourTable).where(eq(happyHourTable.active, true));
  const active = allRules.find(r => {
    const days = r.daysOfWeek.split(",").map(Number);
    if (!days.includes(dayOfWeek)) return false;
    return timeStr >= r.startTime && timeStr <= r.endTime;
  });
  res.json(active ?? null);
});

router.post("/", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const [row] = await db.insert(happyHourTable).values({
    name: body.name as string,
    startTime: (body.startTime as string) ?? "17:00",
    endTime: (body.endTime as string) ?? "19:00",
    daysOfWeek: (body.daysOfWeek as string) ?? "1,2,3,4,5",
    priceList: (body.priceList as string) ?? "2",
    discountPercent: (body.discountPercent as string) ?? "0",
    active: (body.active as boolean) ?? true,
  }).returning();
  res.status(201).json(row);
});

router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.update(happyHourTable).set(req.body as never).where(eq(happyHourTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

router.delete("/:id", async (req, res) => {
  await db.delete(happyHourTable).where(eq(happyHourTable.id, Number(req.params.id)));
  res.status(204).end();
});

export default router;
