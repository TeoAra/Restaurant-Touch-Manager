import { Router } from "express";
import { db } from "@workspace/db";
import { printersTable, insertPrinterSchema } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/", async (_req, res) => {
  const rows = await db.select().from(printersTable).orderBy(printersTable.name);
  res.json(rows);
});

router.post("/", async (req, res) => {
  const parsed = insertPrinterSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [row] = await db.insert(printersTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const parsed = insertPrinterSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [row] = await db.update(printersTable).set(parsed.data).where(eq(printersTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [row] = await db.delete(printersTable).where(eq(printersTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json({ success: true });
});

export default router;
