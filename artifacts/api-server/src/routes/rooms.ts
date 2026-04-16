import { Router } from "express";
import { db } from "@workspace/db";
import { roomsTable, insertRoomSchema } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/", async (_req, res) => {
  const rows = await db.select().from(roomsTable).orderBy(roomsTable.sortOrder, roomsTable.name);
  res.json(rows);
});

// Reorder rooms: receives array of {id, sortOrder}
router.post("/reorder", async (req, res) => {
  const items: { id: number; sortOrder: number }[] = req.body;
  await Promise.all(items.map(({ id, sortOrder }) =>
    db.update(roomsTable).set({ sortOrder }).where(eq(roomsTable.id, id))
  ));
  res.json({ success: true });
});

router.post("/", async (req, res) => {
  const parsed = insertRoomSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [row] = await db.insert(roomsTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const parsed = insertRoomSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [row] = await db.update(roomsTable).set(parsed.data).where(eq(roomsTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [row] = await db.delete(roomsTable).where(eq(roomsTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json({ success: true });
});

export default router;
