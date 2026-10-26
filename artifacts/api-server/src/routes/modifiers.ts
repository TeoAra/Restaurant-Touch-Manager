import { Router } from "express";
import { db, modifiersTable, categoryModifiersTable, categoriesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const router = Router();
import { requireStaffAdmin } from "../lib/staff-session";

router.use(async (req, res, next): Promise<void> => {
  if (!["POST", "PATCH"].includes(req.method)) { next(); return; }
  const body = req.body ?? {};
  if ((req.method === "POST" || body.label !== undefined) &&
      (typeof body.label !== "string" || !body.label.trim() || body.label.length > 100)) {
    res.status(400).json({ error: "Inserisci un nome per la variazione (massimo 100 caratteri)" }); return;
  }
  if (body.type !== undefined && !["plus", "minus", "both", "note"].includes(body.type)) {
    res.status(400).json({ error: "Tipo variazione non valido" }); return;
  }
  if (body.priceExtra !== undefined) {
    const text = String(body.priceExtra).replace(",", ".");
    if (!/^-?\d{1,6}(\.\d{1,2})?$/.test(text) || !Number.isFinite(Number(text))) {
      res.status(400).json({ error: "Prezzo extra non valido: usa al massimo due decimali" }); return;
    }
    body.priceExtra = Number(text).toFixed(2);
  }
  if (typeof body.label === "string") body.label = body.label.trim();
  if (body.categoryIds !== undefined) {
    if (!Array.isArray(body.categoryIds) || !body.categoryIds.every((id: unknown) => Number.isInteger(id) && Number(id) > 0)) {
      res.status(400).json({ error: "Categorie non valide" }); return;
    }
    body.categoryIds = [...new Set(body.categoryIds)];
    const categories = await db.select({ id: categoriesTable.id }).from(categoriesTable);
    if (body.categoryIds.some((id: number) => !categories.some(c => c.id === id))) {
      res.status(400).json({ error: "Una delle categorie non esiste più" }); return;
    }
  }
  next();
});

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
  return res.json(mods);
});

// POST /api/modifiers — crea modificatore
router.post("/", requireStaffAdmin, async (req, res) => {
  const { label, type, priceExtra, categoryIds } = req.body as {
    label: string; type: string; priceExtra?: string; categoryIds?: number[];
  };
  const mod = await db.transaction(async tx => {
  const [created] = await tx.insert(modifiersTable)
    .values({ label, type: type ?? "note", priceExtra: priceExtra ?? "0.00" })
    .returning();

  if (categoryIds?.length) {
    await tx.insert(categoryModifiersTable)
      .values(categoryIds.map(cId => ({ categoryId: cId, modifierId: created.id })));
  }
  return created;
  });
  res.status(201).json({ ...mod, categoryIds: categoryIds ?? [] });
});

// PATCH /api/modifiers/:id — aggiorna modificatore + associazioni categorie
router.patch("/:id", requireStaffAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { label, type, priceExtra, categoryIds } = req.body as {
    label?: string; type?: string; priceExtra?: string; categoryIds?: number[];
  };

  const updates: Partial<typeof modifiersTable.$inferInsert> = {};
  if (label !== undefined) updates.label = label;
  if (type !== undefined) updates.type = type;
  if (priceExtra !== undefined) updates.priceExtra = priceExtra;

  const result = await db.transaction(async tx => {
  const [mod] = Object.keys(updates).length > 0
    ? await tx.update(modifiersTable).set(updates).where(eq(modifiersTable.id, id)).returning()
    : await tx.select().from(modifiersTable).where(eq(modifiersTable.id, id));
  if (!mod) return null;
  if (categoryIds !== undefined) {
    await tx.delete(categoryModifiersTable).where(eq(categoryModifiersTable.modifierId, id));
    if (categoryIds.length > 0) {
      await tx.insert(categoryModifiersTable)
        .values(categoryIds.map(cId => ({ categoryId: cId, modifierId: id })));
    }
  }

  const links = await tx.select().from(categoryModifiersTable).where(eq(categoryModifiersTable.modifierId, id));
  return { ...mod, categoryIds: links.map(l => l.categoryId) };
  });
  if (!result) return res.status(404).json({ error: "Modificatore non trovato" });
  return res.json(result);
});

// DELETE /api/modifiers/:id
router.delete("/:id", requireStaffAdmin, async (req, res) => {
  const id = Number(req.params.id);
  await db.transaction(async tx => {
    await tx.delete(categoryModifiersTable).where(eq(categoryModifiersTable.modifierId, id));
    await tx.delete(modifiersTable).where(eq(modifiersTable.id, id));
  });
  res.status(204).end();
});

export default router;
