import { Router } from "express";
import {
  costConfigurationsTable,
  db,
  categoriesTable,
  ingredientsTable,
  ingredientCostHistoryTable,
  marginCalculationJobsTable,
  productsTable,
  productVariationsTable,
  recipeItemsTable,
  recipesTable,
  utilityBillsTable,
  utilityTypesTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import {
  enqueueRecalculation,
  getMarginOrderDetail,
  getMarginOverview,
  processMarginJob,
  processPendingMarginJobs,
} from "../lib/margin-service.js";
import { requireAdminSession } from "../lib/session-auth.js";

const router = Router();
router.use(requireAdminSession);

function positiveId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function validDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function decimal(value: unknown, fallback = "0"): string {
  const source = value == null || value === "" ? fallback : String(value).trim();
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(source)) throw new Error("Valore numerico non valido");
  return source;
}

function strictlyPositiveDecimal(value: unknown, label: string): string {
  const parsed = decimal(value);
  if (/^-?0(?:\.0+)?$/.test(parsed) || parsed.startsWith("-")) throw new Error(`${label} deve essere maggiore di zero`);
  return parsed;
}

router.get("/overview", async (req, res): Promise<void> => {
  const from = validDate(req.query.from);
  const to = validDate(req.query.to);
  if ((req.query.from && !from) || (req.query.to && !to)) {
    res.status(400).json({ error: "Le date devono avere formato YYYY-MM-DD" });
    return;
  }
  void processPendingMarginJobs();
  res.json(await getMarginOverview(from ?? undefined, to ?? undefined));
});

router.get("/orders/:orderId", async (req, res): Promise<void> => {
  const orderId = positiveId(req.params.orderId);
  if (!orderId) {
    res.status(400).json({ error: "ID comanda non valido" });
    return;
  }
  const detail = await getMarginOrderDetail(orderId);
  if (!detail) {
    res.status(404).json({ error: "Nessun calcolo disponibile per questa comanda" });
    return;
  }
  res.json(detail);
});

router.post("/orders/:orderId/recalculate", async (req, res): Promise<void> => {
  const orderId = positiveId(req.params.orderId);
  if (!orderId) {
    res.status(400).json({ error: "ID comanda non valido" });
    return;
  }
  const calculationVersion = await enqueueRecalculation(orderId);
  const [job] = await db.select().from(marginCalculationJobsTable)
    .where(and(eq(marginCalculationJobsTable.orderId, orderId), eq(marginCalculationJobsTable.calculationVersion, calculationVersion)));
  if (job) void processMarginJob(job.id);
  res.status(202).json({ orderId, calculationVersion, status: "pending" });
});

router.get("/catalog", async (_req, res): Promise<void> => {
  const [ingredients, categories, products, productVariations, recipes, recipeItems, configurations, utilityTypes, utilityBills] = await Promise.all([
    db.select().from(ingredientsTable).orderBy(ingredientsTable.name),
    db.select().from(categoriesTable).orderBy(categoriesTable.sortOrder, categoriesTable.name),
    db.select().from(productsTable).orderBy(productsTable.categoryId, productsTable.sortOrder, productsTable.name),
    db.select().from(productVariationsTable).orderBy(productVariationsTable.productId, productVariationsTable.sortOrder),
    db.select().from(recipesTable).orderBy(desc(recipesTable.validFrom), desc(recipesTable.version)),
    db.select().from(recipeItemsTable),
    db.select().from(costConfigurationsTable).orderBy(desc(costConfigurationsTable.validFrom)),
    db.select().from(utilityTypesTable).orderBy(utilityTypesTable.name),
    db.select().from(utilityBillsTable).orderBy(desc(utilityBillsTable.periodStart)),
  ]);
  res.json({ ingredients, categories, products, productVariations, recipes, recipeItems, configurations, utilityTypes, utilityBills });
});

router.post("/ingredients", async (req, res): Promise<void> => {
  try {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const baseUnit = typeof req.body?.baseUnit === "string" ? req.body.baseUnit.trim() : "";
    if (!name || !baseUnit) throw new Error("Nome e unità base sono obbligatori");
    const currentUnitCost = decimal(req.body.currentUnitCost);
    const unitSizeG = req.body?.unitSizeG == null || req.body.unitSizeG === "" ? null : strictlyPositiveDecimal(req.body.unitSizeG, "Il peso dell'unità in grammi");
    const sliceWeightG = req.body?.sliceWeightG == null || req.body.sliceWeightG === "" ? null : strictlyPositiveDecimal(req.body.sliceWeightG, "Il peso della fetta in grammi");
    if (sliceWeightG != null && unitSizeG == null) throw new Error("Il peso della fetta richiede anche il peso dell'unità in grammi");
    const [ingredient] = await db.transaction(async (tx) => {
      const [created] = await tx.insert(ingredientsTable).values({
        name, baseUnit, currentUnitCost, vatRate: decimal(req.body.vatRate, "0"), unitSizeG, sliceWeightG,
      }).returning();
      await tx.insert(ingredientCostHistoryTable).values({
        ingredientId: created.id,
        unitCost: currentUnitCost,
        source: "manual",
        validFrom: new Date().toISOString().slice(0, 10),
      });
      return [created];
    });
    res.status(201).json(ingredient);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Dati ingrediente non validi" });
  }
});

router.patch("/ingredients/:id", async (req, res): Promise<void> => {
  const id = positiveId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "ID ingrediente non valido" });
    return;
  }
  try {
    const updates: Record<string, unknown> = {};
    if (typeof req.body?.name === "string" && req.body.name.trim()) updates.name = req.body.name.trim();
    if (typeof req.body?.baseUnit === "string" && req.body.baseUnit.trim()) updates.baseUnit = req.body.baseUnit.trim();
    if (req.body?.currentUnitCost != null) updates.currentUnitCost = decimal(req.body.currentUnitCost);
    if (req.body?.vatRate != null) updates.vatRate = decimal(req.body.vatRate);
    if ("unitSizeG" in (req.body ?? {})) updates.unitSizeG = req.body.unitSizeG == null || req.body.unitSizeG === "" ? null : strictlyPositiveDecimal(req.body.unitSizeG, "Il peso dell'unità in grammi");
    if ("sliceWeightG" in (req.body ?? {})) updates.sliceWeightG = req.body.sliceWeightG == null || req.body.sliceWeightG === "" ? null : strictlyPositiveDecimal(req.body.sliceWeightG, "Il peso della fetta in grammi");
    if (typeof req.body?.active === "boolean") updates.active = req.body.active;
    const [ingredient] = await db.transaction(async (tx) => {
      const [updated] = await tx.update(ingredientsTable).set(updates).where(eq(ingredientsTable.id, id)).returning();
      if (updated && updates.currentUnitCost != null) {
        await tx.insert(ingredientCostHistoryTable).values({
          ingredientId: updated.id,
          unitCost: String(updates.currentUnitCost),
          source: "manual",
          validFrom: new Date().toISOString().slice(0, 10),
        });
      }
      return [updated];
    });
    if (!ingredient) {
      res.status(404).json({ error: "Ingrediente non trovato" });
      return;
    }
    res.json(ingredient);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Dati ingrediente non validi" });
  }
});

router.post("/recipes", async (req, res): Promise<void> => {
  try {
    const productId = positiveId(req.body?.productId);
    const validFrom = validDate(req.body?.validFrom);
    if (!productId || !validFrom) throw new Error("Prodotto e data di validità sono obbligatori");
    // I dati produttivi non vengono più chiesti alla creazione: la ricetta è
    // per porzione (yield = 1), i minuti reali arrivano dalla cucina e il
    // packaging del coperto è gestito nei costi fissi/utenze.
    const [recipe] = await db.insert(recipesTable).values({
      productId,
      yieldQuantity: req.body?.yieldQuantity == null || req.body.yieldQuantity === "" ? "1" : strictlyPositiveDecimal(req.body.yieldQuantity, "La resa della ricetta"),
      preparationMinutes: Math.max(0, Math.trunc(Number(req.body.preparationMinutes ?? 0))),
      packagingCostPerUnit: decimal(req.body.packagingCostPerUnit, "0"),
      usesFryer: req.body?.usesFryer === true,
      fryerPortionsPerYield: req.body?.fryerPortionsPerYield == null ? null : strictlyPositiveDecimal(req.body.fryerPortionsPerYield, "Le porzioni friggitrice"),
      active: req.body?.active !== false,
      version: Math.max(1, Math.trunc(Number(req.body.version ?? 1))),
      validFrom,
      validTo: validDate(req.body?.validTo),
    }).returning();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length) await db.insert(recipeItemsTable).values(items.map((item: unknown) => {
      const row = item as Record<string, unknown>;
      const ingredientId = positiveId(row.ingredientId);
      if (!ingredientId) throw new Error("Ingrediente ricetta non valido");
      return { recipeId: recipe.id, ingredientId, quantity: decimal(row.quantity), wastePercentage: decimal(row.wastePercentage, "0") };
    }));
    res.status(201).json(recipe);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Dati ricetta non validi" });
  }
});

router.post("/configurations", async (req, res): Promise<void> => {
  try {
    const validFrom = validDate(req.body?.validFrom);
    if (!validFrom) throw new Error("La data di validità è obbligatoria");
    const [configuration] = await db.insert(costConfigurationsTable).values({
      electricityCostPerKwh: decimal(req.body.electricityCostPerKwh),
      fixedCostsMonthly: decimal(req.body.fixedCostsMonthly),
      productiveHoursMonthly: strictlyPositiveDecimal(req.body.productiveHoursMonthly, "Le ore produttive mensili"),
      ownerHourlyCost: decimal(req.body.ownerHourlyCost),
      taxReservePercentage: decimal(req.body.taxReservePercentage, "0"),
      cashFeePercentage: decimal(req.body.cashFeePercentage, "0"),
      cardFeePercentage: decimal(req.body.cardFeePercentage, "0"),
      ticketFeePercentage: decimal(req.body.ticketFeePercentage, "0"),
      otherFeePercentage: decimal(req.body.otherFeePercentage, "0"),
      paymentFixedFee: decimal(req.body.paymentFixedFee, "0"),
      validFrom,
      validTo: validDate(req.body?.validTo),
    }).returning();
    res.status(201).json(configuration);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Configurazione non valida" });
  }
});

router.post("/utility-bills", async (req, res): Promise<void> => {
  try {
    const utilityTypeId = positiveId(req.body?.utilityTypeId);
    const periodStart = validDate(req.body?.periodStart);
    const periodEnd = validDate(req.body?.periodEnd);
    if (!utilityTypeId || !periodStart || !periodEnd) throw new Error("Tipo utenza e periodo sono obbligatori");
    const [bill] = await db.insert(utilityBillsTable).values({
      utilityTypeId, supplier: typeof req.body?.supplier === "string" ? req.body.supplier.trim() || null : null,
      periodStart, periodEnd,
      consumptionQuantity: decimal(req.body.consumptionQuantity),
      variableCost: decimal(req.body.variableCost),
      fixedCost: decimal(req.body.fixedCost),
      taxesAndFees: decimal(req.body.taxesAndFees, "0"),
      totalCost: decimal(req.body.totalCost),
      documentReference: typeof req.body?.documentReference === "string" ? req.body.documentReference.trim() || null : null,
    }).returning();
    res.status(201).json(bill);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Bolletta non valida" });
  }
});

router.post("/utility-types", async (req, res): Promise<void> => {
  try {
    const code = typeof req.body?.code === "string" ? req.body.code.trim().toLowerCase() : "";
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const measurementUnit = typeof req.body?.measurementUnit === "string" ? req.body.measurementUnit.trim() : "";
    if (!code || !name || !measurementUnit) throw new Error("Codice, nome e unità di misura sono obbligatori");
    const [utilityType] = await db.insert(utilityTypesTable).values({
      code, name, measurementUnit,
      allocationMethod: typeof req.body?.allocationMethod === "string" ? req.body.allocationMethod.trim() || "manual" : "manual",
      reliabilityLevel: typeof req.body?.reliabilityLevel === "string" ? req.body.reliabilityLevel.trim() || "estimated" : "estimated",
      active: req.body?.active !== false,
    }).returning();
    res.status(201).json(utilityType);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Tipo utenza non valido" });
  }
});

export default router;