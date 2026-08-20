import { Router } from "express";
import {
  beverageLinesTable,
  beverageLineSupplyHistoryTable,
  beverageProductMappingsTable,
  costConfigurationsTable,
  coverCostItemsTable,
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
import { calculateBeveragePortionCost } from "../lib/beverage-costs.js";
import { ensureLegacyBeverageSupplyHistory, selectBeverageSupplyForDate } from "../lib/beverage-supply-history.js";
import {
  enqueueRecalculation,
  getMarginOrderDetail,
  getMarginOverview,
  processMarginJob,
  processPendingMarginJobs,
} from "../lib/margin-service.js";
import { FixedDecimal } from "../lib/fixed-decimal.js";
import { requireAdminSession } from "../lib/session-auth.js";

const router = Router();
router.use(requireAdminSession);

function positiveId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function validDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : value;
}

function hasValue(object: unknown, key: string): boolean {
  return typeof object === "object" && object !== null && key in object;
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

function nonNegativeDecimal(value: unknown, label: string): string {
  const parsed = decimal(value, "0");
  if (FixedDecimal.from(parsed).isNegative()) throw new Error(`${label} non può essere negativo`);
  return parsed;
}

function withUtilityRates<T extends { consumptionQuantity: string; variableCost: string; totalCost: string }>(bill: T) {
  const consumption = FixedDecimal.from(bill.consumptionQuantity);
  return {
    ...bill,
    variableUnitCost: consumption.isPositive() ? FixedDecimal.from(bill.variableCost).div(consumption).toString() : null,
    totalUnitCost: consumption.isPositive() ? FixedDecimal.from(bill.totalCost).div(consumption).toString() : null,
  };
}

function isElectricityUtility(type: { code: string; measurementUnit: string } | undefined): boolean {
  return type?.measurementUnit.trim().toLowerCase() === "kwh";
}

function isWaterUtility(type: { code: string; name: string; measurementUnit: string } | undefined): boolean {
  const code = `${type?.code ?? ""} ${type?.name ?? ""}`.toLowerCase();
  const unit = type?.measurementUnit.trim().toLowerCase().replace("³", "3") ?? "";
  return code.includes("acqua") || code.includes("water") || unit === "l" || unit === "litri" || unit === "m3";
}

function waterCostPerLiter(
  bill: { consumptionQuantity: string; variableCost: string },
  type: { code: string; name: string; measurementUnit: string } | undefined,
): string | undefined {
  const unit = type?.measurementUnit.trim().toLowerCase().replace("³", "3") ?? "";
  const consumption = FixedDecimal.from(bill.consumptionQuantity);
  if (!consumption.isPositive() || !isWaterUtility(type)) return undefined;
  const perUnit = FixedDecimal.from(bill.variableCost).div(consumption);
  return unit === "m3" ? perUnit.div(FixedDecimal.from("1000")).toString() : perUnit.toString();
}

function newestBillFor(
  bills: Array<{ utilityTypeId: number; periodEnd: string; consumptionQuantity: string; variableCost: string }>,
  types: Array<{ id: number; code: string; name: string; measurementUnit: string }>,
  matcher: (type: { code: string; name: string; measurementUnit: string } | undefined) => boolean,
) {
  const typeById = new Map(types.map((type) => [type.id, type]));
  return bills
    .filter((bill) => FixedDecimal.from(bill.consumptionQuantity).isPositive() && matcher(typeById.get(bill.utilityTypeId)))
    .sort((left, right) => right.periodEnd.localeCompare(left.periodEnd))[0];
}

function isStandardFriedSauce(name: string): boolean {
  const normalizedName = name.toLocaleLowerCase("it");
  return ["maionese", "ketchup", "senape", "bbq", "salsa bbq"]
    .some((sauce) => normalizedName === sauce || normalizedName.includes(sauce));
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
  await ensureLegacyBeverageSupplyHistory();
  const [ingredients, categories, products, productVariations, recipes, recipeItems, configurations, coverCostItems, utilityTypes, utilityBills, beverageLines, beverageLineSupplyHistory, beverageProductMappings] = await Promise.all([
    db.select().from(ingredientsTable).orderBy(ingredientsTable.name),
    db.select().from(categoriesTable).orderBy(categoriesTable.sortOrder, categoriesTable.name),
    db.select().from(productsTable).orderBy(productsTable.categoryId, productsTable.sortOrder, productsTable.name),
    db.select().from(productVariationsTable).orderBy(productVariationsTable.productId, productVariationsTable.sortOrder),
    db.select().from(recipesTable).orderBy(desc(recipesTable.validFrom), desc(recipesTable.version)),
    db.select().from(recipeItemsTable),
    db.select().from(costConfigurationsTable).orderBy(desc(costConfigurationsTable.validFrom)),
    db.select().from(coverCostItemsTable).orderBy(coverCostItemsTable.name),
    db.select().from(utilityTypesTable).orderBy(utilityTypesTable.name),
    db.select().from(utilityBillsTable).orderBy(desc(utilityBillsTable.periodStart)),
    db.select().from(beverageLinesTable).orderBy(beverageLinesTable.name),
    db.select().from(beverageLineSupplyHistoryTable).orderBy(desc(beverageLineSupplyHistoryTable.validFrom)),
    db.select().from(beverageProductMappingsTable),
  ]);
  const typeById = new Map(utilityTypes.map((type) => [type.id, type]));
  const electricityBill = newestBillFor(utilityBills, utilityTypes, isElectricityUtility);
  const waterBill = newestBillFor(utilityBills, utilityTypes, isWaterUtility);
  const today = new Date().toISOString().slice(0, 10);
  const currentConfiguration = configurations.find((configuration) =>
    configuration.validFrom <= today && (!configuration.validTo || configuration.validTo >= today),
  );
  const electricityCostPerKwh = electricityBill
    ? FixedDecimal.from(electricityBill.variableCost).div(FixedDecimal.from(electricityBill.consumptionQuantity)).toString()
    : (currentConfiguration ? currentConfiguration.electricityCostPerKwh : undefined);
  const waterRate = waterBill ? waterCostPerLiter(waterBill, typeById.get(waterBill.utilityTypeId)) : undefined;
  const beverageLinesWithCurrentSupply = beverageLines.map((line) => {
    const currentSupply = selectBeverageSupplyForDate(beverageLineSupplyHistory, line.id, today);
    return {
      ...line,
      purchasePriceNet: currentSupply?.purchasePriceNet ?? line.purchasePriceNet,
      sourceVolumeLiters: currentSupply?.sourceVolumeLiters ?? line.sourceVolumeLiters,
      currentSupplyValidFrom: currentSupply?.validFrom ?? null,
    };
  });
  const beverageCostPreviews = beverageLinesWithCurrentSupply.map((line) => {
    const cost = calculateBeveragePortionCost(line, "1", {
      waterCostPerLiter: waterRate,
      electricityCostPerKwh,
    });
    return {
      beverageLineId: line.id,
      costPerLiter: cost.totalCost,
      sourceCostPerLiter: cost.sourceCost,
      waterCostPerLiter: cost.waterCost,
      co2CostPerLiter: cost.co2Cost,
      energyCostPerLiter: cost.energyCost,
      missingData: cost.missingData,
    };
  });
  res.json({
    ingredients,
    categories,
    products,
    productVariations,
    recipes,
    recipeItems,
    configurations,
    coverCostItems: coverCostItems.map((item) => ({
      ...item,
      // Anche le voci create prima dell'introduzione dello scope rispettano
      // la nuova regola delle salse quando vengono lette dal Backoffice.
      applicationScope: item.applicationScope === "fried_order" || isStandardFriedSauce(item.name) ? "fried_order" : "cover",
    })),
    utilityTypes,
    utilityBills: utilityBills.map(withUtilityRates),
    beverageLines: beverageLinesWithCurrentSupply,
    beverageLineSupplyHistory,
    beverageProductMappings,
    beverageCostPreviews,
  });
});

router.post("/beverage-lines", async (req, res): Promise<void> => {
  try {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const lineType = req.body?.lineType === "beer" || req.body?.lineType === "bib" ? req.body.lineType : null;
    if (!name || !lineType) throw new Error("Nome e tipo di linea sono obbligatori");
    const lossPercentage = nonNegativeDecimal(req.body.lossPercentage, "Le perdite");
    if (FixedDecimal.from(lossPercentage).isNegative() || !FixedDecimal.from(lossPercentage).lessThan(FixedDecimal.from("100"))) {
      throw new Error("Le perdite devono essere comprese tra 0 e 100%");
    }
    const dilutionWaterRatio = nonNegativeDecimal(req.body.dilutionWaterRatio, "Il rapporto acqua");
    const purchasePriceNet = strictlyPositiveDecimal(req.body.purchasePriceNet, "Il costo imponibile");
    const sourceVolumeLiters = strictlyPositiveDecimal(req.body.sourceVolumeLiters, "Il volume della fonte");
    const providedValidFrom = hasValue(req.body, "validFrom");
    const parsedValidFrom = validDate(req.body?.validFrom);
    if (providedValidFrom && !parsedValidFrom) throw new Error("La data di decorrenza non è valida");
    const validFrom = parsedValidFrom ?? new Date().toISOString().slice(0, 10);
    const [line] = await db.transaction(async (tx) => {
      const [created] = await tx.insert(beverageLinesTable).values({
        name,
        lineType,
        purchasePriceNet,
        vatRate: nonNegativeDecimal(req.body.vatRate, "L'IVA"),
        sourceVolumeLiters,
        lossPercentage,
        dilutionWaterRatio: lineType === "bib" ? dilutionWaterRatio : "0",
        co2CostPerLiter: nonNegativeDecimal(req.body.co2CostPerLiter, "Il costo CO₂"),
        coolerKwhPerLiter: nonNegativeDecimal(req.body.coolerKwhPerLiter, "Il consumo del cooler"),
        cellarKwhPerLiter: nonNegativeDecimal(req.body.cellarKwhPerLiter, "Il consumo della cella"),
        active: req.body?.active !== false,
      }).returning();
      await tx.insert(beverageLineSupplyHistoryTable).values({
        beverageLineId: created.id,
        purchasePriceNet,
        sourceVolumeLiters,
        validFrom,
      });
      return [created];
    });
    res.status(201).json(line);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Linea beverage non valida" });
  }
});

router.patch("/beverage-lines/:id", async (req, res): Promise<void> => {
  const id = positiveId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "ID linea beverage non valido" });
    return;
  }

  try {
    await ensureLegacyBeverageSupplyHistory();
    const [existing] = await db.select().from(beverageLinesTable).where(eq(beverageLinesTable.id, id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Linea beverage non trovata" });
      return;
    }

    const updates: Record<string, unknown> = {};
    if (typeof req.body?.name === "string" && req.body.name.trim()) updates.name = req.body.name.trim();
    if (hasValue(req.body, "lineType")) {
      if (req.body.lineType !== "beer" && req.body.lineType !== "bib") throw new Error("Tipo di linea non valido");
      updates.lineType = req.body.lineType;
    }
    const effectiveLineType = (updates.lineType ?? existing.lineType) as "beer" | "bib";
    if (hasValue(req.body, "vatRate")) updates.vatRate = nonNegativeDecimal(req.body.vatRate, "L'IVA");
    if (hasValue(req.body, "lossPercentage")) {
      const lossPercentage = nonNegativeDecimal(req.body.lossPercentage, "Le perdite");
      if (!FixedDecimal.from(lossPercentage).lessThan(FixedDecimal.from("100"))) {
        throw new Error("Le perdite devono essere comprese tra 0 e 100%");
      }
      updates.lossPercentage = lossPercentage;
    }
    if (hasValue(req.body, "dilutionWaterRatio")) {
      updates.dilutionWaterRatio = effectiveLineType === "bib"
        ? nonNegativeDecimal(req.body.dilutionWaterRatio, "Il rapporto acqua")
        : "0";
    } else if (effectiveLineType === "beer" && existing.dilutionWaterRatio !== "0") {
      updates.dilutionWaterRatio = "0";
    }
    if (hasValue(req.body, "co2CostPerLiter")) updates.co2CostPerLiter = nonNegativeDecimal(req.body.co2CostPerLiter, "Il costo CO₂");
    if (hasValue(req.body, "coolerKwhPerLiter")) updates.coolerKwhPerLiter = nonNegativeDecimal(req.body.coolerKwhPerLiter, "Il consumo del cooler");
    if (hasValue(req.body, "cellarKwhPerLiter")) updates.cellarKwhPerLiter = nonNegativeDecimal(req.body.cellarKwhPerLiter, "Il consumo della cella");
    if (typeof req.body?.active === "boolean") updates.active = req.body.active;

    const changesSupply = hasValue(req.body, "purchasePriceNet") || hasValue(req.body, "sourceVolumeLiters");
    if (changesSupply && (!hasValue(req.body, "purchasePriceNet") || !hasValue(req.body, "sourceVolumeLiters"))) {
      throw new Error("Prezzo e volume devono essere indicati insieme per registrare una nuova fornitura");
    }
    const validFrom = changesSupply ? validDate(req.body?.validFrom) : null;
    if (changesSupply && !validFrom) throw new Error("La data di decorrenza della fornitura è obbligatoria");

    const [line] = await db.transaction(async (tx) => {
      const [updated] = Object.keys(updates).length
        ? await tx.update(beverageLinesTable).set(updates).where(eq(beverageLinesTable.id, id)).returning()
        : [existing];
      if (changesSupply && validFrom) {
        await tx.insert(beverageLineSupplyHistoryTable).values({
          beverageLineId: id,
          purchasePriceNet: strictlyPositiveDecimal(req.body.purchasePriceNet, "Il costo imponibile"),
          sourceVolumeLiters: strictlyPositiveDecimal(req.body.sourceVolumeLiters, "Il volume della fonte"),
          validFrom,
        }).onConflictDoUpdate({
          target: [beverageLineSupplyHistoryTable.beverageLineId, beverageLineSupplyHistoryTable.validFrom],
          set: {
            purchasePriceNet: strictlyPositiveDecimal(req.body.purchasePriceNet, "Il costo imponibile"),
            sourceVolumeLiters: strictlyPositiveDecimal(req.body.sourceVolumeLiters, "Il volume della fonte"),
          },
        });
      }
      return [updated];
    });
    res.json(line);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Aggiornamento linea beverage non valido" });
  }
});

router.post("/beverage-product-mappings", async (req, res): Promise<void> => {
  try {
    const productId = positiveId(req.body?.productId);
    const beverageLineId = positiveId(req.body?.beverageLineId);
    const servingFormat = ["bottle", "can", "glass", "other"].includes(req.body?.servingFormat)
      ? req.body.servingFormat
      : null;
    if (!productId || !beverageLineId) throw new Error("Prodotto e linea beverage sono obbligatori");
    if (!servingFormat) throw new Error("Il formato di vendita è obbligatorio");
    const [[product], [line]] = await Promise.all([
      db.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.id, productId)).limit(1),
      db.select({ id: beverageLinesTable.id, active: beverageLinesTable.active }).from(beverageLinesTable).where(eq(beverageLinesTable.id, beverageLineId)).limit(1),
    ]);
    if (!product) throw new Error("Prodotto menu non trovato");
    if (!line) throw new Error("Linea beverage non trovata");
    if (!line.active) throw new Error("La linea beverage è disattivata e non può ricevere nuove associazioni");
    const [mapping] = await db.insert(beverageProductMappingsTable).values({
      productId,
      beverageLineId,
      servingVolumeLiters: strictlyPositiveDecimal(req.body?.servingVolumeLiters, "I litri del formato"),
      servingFormat,
    }).onConflictDoUpdate({
      target: beverageProductMappingsTable.productId,
      set: {
        beverageLineId,
        servingVolumeLiters: strictlyPositiveDecimal(req.body?.servingVolumeLiters, "I litri del formato"),
        servingFormat,
        updatedAt: new Date(),
      },
    }).returning();
    res.status(201).json(mapping);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Associazione beverage non valida" });
  }
});

router.post("/cover-cost-items", async (req, res): Promise<void> => {
  try {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const purchaseUnit = typeof req.body?.purchaseUnit === "string" ? req.body.purchaseUnit.trim() : "";
    if (!name || !purchaseUnit) throw new Error("Nome e unità di acquisto sono obbligatori");
    const isStandardIncludedSauce = isStandardFriedSauce(name);
    const [item] = await db.insert(coverCostItemsTable).values({
      name,
      purchaseUnit,
      purchaseQuantity: strictlyPositiveDecimal(req.body.purchaseQuantity, "La quantità acquistata"),
      purchasePrice: strictlyPositiveDecimal(req.body.purchasePrice, "Il prezzo d'acquisto"),
      // Regola concordata per il locale: due bustine/porzioni per ogni salsa
      // standard sono incluse una sola volta in una comanda che contiene fritti.
      quantityPerCover: isStandardIncludedSauce ? "2" : strictlyPositiveDecimal(req.body.quantityPerCover, "La quantità per coperto"),
      applicationScope: isStandardIncludedSauce ? "fried_order" : "cover",
    }).returning();
    res.status(201).json(item);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Componente coperto non valido" });
  }
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
      electricityCostPerKwh: decimal(req.body.electricityCostPerKwh, "0"),
      fixedCostsMonthly: decimal(req.body.fixedCostsMonthly, "0"),
      rentMonthly: decimal(req.body.rentMonthly, "0"),
      taxRegisterAnnual: decimal(req.body.taxRegisterAnnual, "0"),
      chamberFeeAnnual: decimal(req.body.chamberFeeAnnual, "0"),
      coverCostPerCover: decimal(req.body.coverCostPerCover, "0"),
      // Dato legacy: i costi fissi ora sono allocati sui coperti effettivi.
      productiveHoursMonthly: "0",
      ownerHourlyCost: decimal(req.body.ownerHourlyCost, "0"),
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
    if (periodEnd < periodStart) throw new Error("La fine del periodo non può precedere l'inizio");
    const consumptionQuantity = strictlyPositiveDecimal(req.body.consumptionQuantity, "Il consumo");
    // Il flusso principale registra la spesa complessiva della bolletta
    // (es. 1.000 € per 2.500 kWh). I vecchi client possono ancora inviare la
    // scomposizione precedente, mantenendo invariati gli snapshot storici.
    const hasTotalCost = req.body?.totalCost !== undefined && req.body?.totalCost !== "";
    const totalCost = hasTotalCost
      ? strictlyPositiveDecimal(req.body.totalCost, "La spesa della bolletta")
      : FixedDecimal.from(decimal(req.body.variableCost, "0"))
        .add(FixedDecimal.from(decimal(req.body.fixedCost, "0")))
        .add(FixedDecimal.from(decimal(req.body.taxesAndFees, "0")))
        .toString();
    const variableCost = hasTotalCost ? totalCost : decimal(req.body.variableCost, "0");
    const fixedCost = hasTotalCost ? "0" : decimal(req.body.fixedCost, "0");
    const taxesAndFees = hasTotalCost ? "0" : decimal(req.body.taxesAndFees, "0");
    const [bill] = await db.insert(utilityBillsTable).values({
      utilityTypeId, supplier: typeof req.body?.supplier === "string" ? req.body.supplier.trim() || null : null,
      periodStart, periodEnd,
      consumptionQuantity,
      variableCost,
      fixedCost,
      taxesAndFees,
      totalCost,
      documentReference: typeof req.body?.documentReference === "string" ? req.body.documentReference.trim() || null : null,
    }).returning();
    res.status(201).json(withUtilityRates(bill));
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