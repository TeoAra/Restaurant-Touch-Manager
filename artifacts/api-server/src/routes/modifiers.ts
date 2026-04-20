import { Router } from "express";
import { db, modifiersTable, categoryModifiersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const router = Router();

// GET /api/modifiers — tutti i modificatori con le categorie associate
router.get("/", async (_req, res) => {
  const mods = await db.select().from(modifiersTable).orderBy(modifiersTable.label);
  const links = await db.select().from(categoryModifiersTable);

  const result = mods.map(m => ({
    ...m,
    categoryIds: links.filter(l => l.modifierId === m.id).map(l => l.categoryId),
  }));
  res.json(result);
});

// GET /api/modifiers/by-category/:categoryId — modificatori di una categoria
router.get("/by-category/:categoryId", async (req, res) => {
  const categoryId = parseInt(req.params.categoryId);
  const links = await db.select().from(categoryModifiersTable)
    .where(eq(categoryModifiersTable.categoryId, categoryId));

  if (links.length === 0) return res.json([]);

  const mods = await db.select().from(modifiersTable)
    .where(inArray(modifiersTable.id, links.map(l => l.modifierId)));
  res.json(mods);
});

// POST /api/modifiers — crea modificatore
router.post("/", async (req, res) => {
  const { label, type, priceExtra, categoryIds } = req.body as {
    label: string; type: string; priceExtra?: string; categoryIds?: number[];
  };
  const [mod] = await db.insert(modifiersTable)
    .values({ label, type: type ?? "note", priceExtra: priceExtra ?? "0.00" })
    .returning();

  if (categoryIds?.length) {
    await db.insert(categoryModifiersTable)
      .values(categoryIds.map(cId => ({ categoryId: cId, modifierId: mod.id })));
  }
  res.status(201).json({ ...mod, categoryIds: categoryIds ?? [] });
});

// PATCH /api/modifiers/:id — aggiorna modificatore + associazioni categorie
router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const { label, type, priceExtra, categoryIds } = req.body as {
    label?: string; type?: string; priceExtra?: string; categoryIds?: number[];
  };

  const updates: Partial<typeof modifiersTable.$inferInsert> = {};
  if (label !== undefined) updates.label = label;
  if (type !== undefined) updates.type = type;
  if (priceExtra !== undefined) updates.priceExtra = priceExtra;

  const [mod] = Object.keys(updates).length > 0
    ? await db.update(modifiersTable).set(updates).where(eq(modifiersTable.id, id)).returning()
    : await db.select().from(modifiersTable).where(eq(modifiersTable.id, id));

  if (!mod) return res.status(404).json({ error: "Modificatore non trovato" });

  if (categoryIds !== undefined) {
    await db.delete(categoryModifiersTable).where(eq(categoryModifiersTable.modifierId, id));
    if (categoryIds.length > 0) {
      await db.insert(categoryModifiersTable)
        .values(categoryIds.map(cId => ({ categoryId: cId, modifierId: id })));
    }
  }

  const links = await db.select().from(categoryModifiersTable).where(eq(categoryModifiersTable.modifierId, id));
  res.json({ ...mod, categoryIds: links.map(l => l.categoryId) });
});

// DELETE /api/modifiers/:id
router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(categoryModifiersTable).where(eq(categoryModifiersTable.modifierId, id));
  await db.delete(modifiersTable).where(eq(modifiersTable.id, id));
  res.status(204).end();
});

export default router;
