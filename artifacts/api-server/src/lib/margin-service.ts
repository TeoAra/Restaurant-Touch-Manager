import {
  db,
  costConfigurationsTable,
  equipmentTable,
  fryerOilCyclesTable,
  ingredientCostHistoryTable,
  ingredientsTable,
  marginCalculationJobsTable,
  marginOrderItemFactsTable,
  orderCostSnapshotsTable,
  orderIndirectCostAllocationsTable,
  orderItemsTable,
  ordersTable,
  paymentsTable,
  productEquipmentTable,
  productsTable,
  recipeItemsTable,
  recipesTable,
  utilityBillsTable,
  utilityTypesTable,
} from "@workspace/db";
import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { FixedDecimal } from "./fixed-decimal.js";
import { calculateActualPrepMinutes } from "./kitchen-domain.js";
import { calculateMargin, type MarginCalculatorOutput, type MarginProductLine } from "./margin-calculator.js";
import { logger } from "./logger.js";

const ZERO = FixedDecimal.zero();
const HUNDRED = FixedDecimal.from("100");
const SIXTY = FixedDecimal.from("60");
const CALCULATION_VERSION = 1;

// Drizzle espone un tipo transazione distinto dal client principale; entrambe
// le superfici condividono le operazioni usate qui (select/insert/update).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

function amount(value: string | number | null | undefined): FixedDecimal {
  return FixedDecimal.from(value ?? "0");
}

function asStorage(value: string | number | null | undefined): string {
  return amount(value).toFixed(6);
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function isApplicable(validFrom: string, validTo: string | null, at: string): boolean {
  return validFrom <= at && (!validTo || validTo >= at);
}

function paymentFeePercentage(method: string, config: {
  cashFeePercentage: string;
  cardFeePercentage: string;
  ticketFeePercentage: string;
  otherFeePercentage: string;
}): FixedDecimal {
  const normalized = method.toLowerCase();
  if (normalized.includes("cash") || normalized.includes("contant")) return amount(config.cashFeePercentage);
  if (normalized.includes("ticket") || normalized.includes("buon")) return amount(config.ticketFeePercentage);
  if (normalized.includes("card") || normalized.includes("pos") || normalized.includes("debit") || normalized.includes("credit")) {
    return amount(config.cardFeePercentage);
  }
  return amount(config.otherFeePercentage);
}

/**
 * Preserve sold rows before the POS removes them after a split payment.
 * The unique order-item key makes this safely repeatable.
 */
export async function captureMarginFacts(
  tx: Tx,
  orderId: number,
  options?: {
    selectedItemIds?: number[];
    cover?: { paymentId: number; quantity: number; unitPrice: string; vatRate: string };
  },
): Promise<void> {
  const rows: Array<typeof orderItemsTable.$inferSelect> = await tx.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
  const selected: Array<typeof orderItemsTable.$inferSelect> = options?.selectedItemIds?.length
    ? rows.filter((row) => options.selectedItemIds!.includes(row.id))
    : rows;
  const productIds = [...new Set(selected.map((row) => row.productId))];
  const products: Array<{ id: number; iva: string }> = productIds.length
    ? await tx.select({ id: productsTable.id, iva: productsTable.iva }).from(productsTable).where(inArray(productsTable.id, productIds))
    : [];
  const vatByProductId = new Map(products.map((product) => [product.id, product.iva]));
  const values = selected.map((row) => {
    // Compute actual prep minutes from kitchen lifecycle timestamps if available
    let actualPrepMinutes: number | null = null;
    if (row.preparingAt && row.readyAt) {
      actualPrepMinutes = calculateActualPrepMinutes(row.preparingAt, row.readyAt);
    }
    return {
      orderId,
      orderItemId: row.id,
      productId: row.productId,
      productName: row.productName,
      quantity: row.quantity,
      unitPrice: asStorage(row.unitPrice),
      subtotal: asStorage(row.subtotal),
      vatRate: asStorage(vatByProductId.get(row.productId) ?? "0"),
      // Snapshot modifiers for cost exclusion logic
      modifiersSnapshot: row.modifiers !== "[]" ? row.modifiers : null,
      actualPrepMinutes,
    };
  });
  if (options?.cover && options.cover.quantity > 0 && !amount(options.cover.unitPrice).isZero()) {
    values.push({
      orderId,
      orderItemId: -options.cover.paymentId,
      productId: 0,
      productName: "COPERTO",
      quantity: options.cover.quantity,
      unitPrice: asStorage(options.cover.unitPrice),
      subtotal: amount(options.cover.unitPrice).mul(amount(options.cover.quantity)).toString(),
      vatRate: asStorage(options.cover.vatRate),
      modifiersSnapshot: null,
      actualPrepMinutes: null,
    });
  }
  if (values.length) await tx.insert(marginOrderItemFactsTable).values(values).onConflictDoNothing();
}

export async function enqueueMarginCalculation(
  tx: Tx,
  orderId: number,
  calculationVersion = CALCULATION_VERSION,
): Promise<void> {
  await tx.insert(marginCalculationJobsTable).values({
    orderId,
    calculationVersion,
    status: "pending",
    attempts: 0,
  }).onConflictDoNothing();
}

async function enqueueNextCalculationVersion(tx: Tx, orderId: number): Promise<number> {
  const existing = await tx.select({ calculationVersion: marginCalculationJobsTable.calculationVersion })
    .from(marginCalculationJobsTable)
    .where(eq(marginCalculationJobsTable.orderId, orderId))
    .orderBy(desc(marginCalculationJobsTable.calculationVersion))
    .limit(1);
  const calculationVersion = (existing[0]?.calculationVersion ?? 0) + 1;
  await enqueueMarginCalculation(tx, orderId, calculationVersion);
  return calculationVersion;
}

export async function recordActualPrepTimes(
  orderId: number,
  entries: Array<{ orderItemId: number; actualPrepMinutes: number }>,
): Promise<void> {
  if (!entries.length) return;

  const shouldProcess = await db.transaction(async tx => {
    const lockedOrder = await tx.execute<{ status: string }>(sql`
      SELECT status FROM orders WHERE id = ${orderId} FOR UPDATE
    `);
    const orderStatus = lockedOrder.rows[0]?.status;
    if (!orderStatus) throw new Error(`Order ${orderId} not found`);

    let count = 0;
    for (const entry of entries) {
      const updated = await tx.update(marginOrderItemFactsTable)
        .set({ actualPrepMinutes: entry.actualPrepMinutes })
        .where(and(
          eq(marginOrderItemFactsTable.orderId, orderId),
          eq(marginOrderItemFactsTable.orderItemId, entry.orderItemId),
        ))
        .returning({ id: marginOrderItemFactsTable.id });
      count += updated.length;
    }
    if (!count || orderStatus !== "paid") return false;

    await enqueueNextCalculationVersion(tx, orderId);
    return true;
  });
  if (shouldProcess) void processPendingMarginJobs();
}

function selectRecipeForDate<T extends { productId: number; validFrom: string; validTo: string | null; active: boolean; version: number }>(
  recipes: T[],
  productId: number,
  at: string,
): T | undefined {
  return recipes
    .filter((recipe) => recipe.productId === productId && recipe.active && isApplicable(recipe.validFrom, recipe.validTo, at))
    .sort((a, b) => b.version - a.version || b.validFrom.localeCompare(a.validFrom))[0];
}

function selectCostForDate(
  history: Array<{ ingredientId: number; unitCost: string; validFrom: string }>,
  ingredientId: number,
  at: string,
): string | undefined {
  return history
    .filter((entry) => entry.ingredientId === ingredientId && entry.validFrom <= at)
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0]?.unitCost;
}

async function buildCalculation(orderId: number): Promise<{
  output: MarginCalculatorOutput;
  actualGrossRevenue: FixedDecimal;
}> {
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);
  if (!order) throw new Error(`Order ${orderId} not found`);

  const at = dateKey(order.createdAt);
  const [facts, products, recipes, recipeItems, ingredients, costHistory, equipment, productEquipment, oilCycles, configurations, payments, indirectAllocations, utilityBills, utilityTypes, paidOrders] = await Promise.all([
    db.select().from(marginOrderItemFactsTable).where(eq(marginOrderItemFactsTable.orderId, orderId)),
    db.select().from(productsTable),
    db.select().from(recipesTable),
    db.select().from(recipeItemsTable),
    db.select().from(ingredientsTable),
    db.select().from(ingredientCostHistoryTable),
    db.select().from(equipmentTable),
    db.select().from(productEquipmentTable),
    db.select().from(fryerOilCyclesTable),
    db.select().from(costConfigurationsTable),
    db.select().from(paymentsTable).where(eq(paymentsTable.orderId, orderId)),
    db.select().from(orderIndirectCostAllocationsTable)
      .where(and(eq(orderIndirectCostAllocationsTable.orderId, orderId), eq(orderIndirectCostAllocationsTable.calculationVersion, CALCULATION_VERSION))),
    db.select().from(utilityBillsTable),
    db.select().from(utilityTypesTable),
    db.select({ createdAt: ordersTable.createdAt }).from(ordersTable).where(eq(ordersTable.status, "paid")),
  ]);

  const config = configurations
    .filter((entry) => isApplicable(entry.validFrom, entry.validTo, at))
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
  const missingData: string[] = [];
  if (!config) missingData.push("COST_CONFIGURATION_MISSING");

  const productById = new Map(products.map((product) => [product.id, product]));
  const ingredientById = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
  const equipmentById = new Map(equipment.filter((item) => item.active).map((item) => [item.id, item]));
  const activeOilCycle = oilCycles
    .filter((cycle) => cycle.openedAt <= order.createdAt && cycle.portionsProduced > 0)
    .sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime())[0];

  const lines: MarginProductLine[] = facts.map((fact) => {
    if (fact.productId === 0) {
      return {
        productId: "cover",
        grossRevenue: fact.subtotal,
        quantity: fact.quantity,
        vatRate: fact.vatRate,
        ingredientCostPerUnit: "0",
        packagingCostPerUnit: "0",
        fryerOilCostPerUnit: "0",
        energyCostPerUnit: "0",
        preparationMinutesPerUnit: "0",
        complete: true,
      };
    }
    const product = productById.get(fact.productId);
    const recipe = selectRecipeForDate(recipes, fact.productId, at);
    const localMissing: string[] = [];
    if (!product) localMissing.push(`PRODUCT_${fact.productId}_MISSING`);
    if (!recipe) localMissing.push(`RECIPE_${fact.productId}_MISSING`);

    let ingredientCost = ZERO;
    let packagingCost: FixedDecimal | undefined;
    let energyCost = ZERO;
    let fryerOilCost: FixedDecimal | undefined;

    // Parse structured modifiers snapshot to determine excluded recipe ingredients
    // A structured "minus" modifier with ingredientId and source="recipe" means
    // that ingredient was removed, so its cost should be excluded.
    const excludedIngredientIds = new Set<number>();
    if (fact.modifiersSnapshot) {
      try {
        const mods = JSON.parse(fact.modifiersSnapshot) as Array<{
          type?: string;
          ingredientId?: number;
          source?: string;
        }>;
        for (const mod of mods) {
          if (mod.type === "minus" && typeof mod.ingredientId === "number" && mod.source === "recipe") {
            excludedIngredientIds.add(mod.ingredientId);
          }
        }
      } catch { /* ignore malformed JSON */ }
    }

    if (recipe) {
      const recipeRows = recipeItems.filter((item) => item.recipeId === recipe.id);
      if (!recipeRows.length) localMissing.push(`RECIPE_${fact.productId}_EMPTY`);

      for (const row of recipeRows) {
        // Skip excluded recipe ingredients (removed via structured modifier)
        if (excludedIngredientIds.has(row.ingredientId)) continue;

        const ingredient = ingredientById.get(row.ingredientId);
        const unitCost = selectCostForDate(costHistory, row.ingredientId, at) ?? ingredient?.currentUnitCost;
        if (!ingredient || !unitCost) {
          localMissing.push(`INGREDIENT_COST_${row.ingredientId}_MISSING`);
          continue;
        }
        const wasteMultiplier = HUNDRED.add(amount(row.wastePercentage)).div(HUNDRED);
        ingredientCost = ingredientCost.add(
          amount(recipe.yieldQuantity).isPositive()
            ? amount(row.quantity).mul(wasteMultiplier).mul(amount(unitCost)).div(amount(recipe.yieldQuantity))
            : ZERO,
        );
      }
      if (!amount(recipe.yieldQuantity).isPositive()) localMissing.push(`RECIPE_${fact.productId}_INVALID_YIELD`);

      packagingCost = amount(recipe.packagingCostPerUnit);
      for (const usage of productEquipment.filter((item) => item.productId === fact.productId)) {
        const machine = equipmentById.get(usage.equipmentId);
        if (!machine || !config) {
          localMissing.push(`ENERGY_COST_${fact.productId}_MISSING`);
          continue;
        }
        const unitEnergy = amount(machine.powerKw)
          .mul(amount(usage.usageMinutes))
          .div(SIXTY)
          .mul(amount(machine.averageUtilizationPercentage))
          .div(HUNDRED)
          .mul(amount(config.electricityCostPerKwh));
        energyCost = energyCost.add(unitEnergy);
      }

      if (recipe.usesFryer) {
        if (!activeOilCycle || !recipe.fryerPortionsPerYield) {
          localMissing.push(`FRYER_OIL_${fact.productId}_MISSING`);
        } else {
          fryerOilCost = amount(activeOilCycle.totalCost)
            .div(amount(activeOilCycle.portionsProduced))
            .div(amount(recipe.fryerPortionsPerYield));
        }
      }
    }

    // Use actual production elapsed minutes when available; otherwise expected recipe minutes
    const prepMinutes = fact.actualPrepMinutes != null
      ? fact.actualPrepMinutes
      : (recipe?.preparationMinutes ?? 0);

    missingData.push(...localMissing);
    return {
      productId: fact.productId,
      grossRevenue: fact.subtotal,
      quantity: fact.quantity,
      vatRate: fact.vatRate || product?.iva || "0",
      ingredientCostPerUnit: recipe ? ingredientCost.toString() : undefined,
      packagingCostPerUnit: packagingCost?.toString(),
      fryerOilCostPerUnit: fryerOilCost?.toString(),
      energyCostPerUnit: energyCost.toString(),
      preparationMinutesPerUnit: prepMinutes,
      complete: localMissing.length === 0,
    };
  });

  if (!facts.length) missingData.push("ORDER_ITEMS_MISSING");
  const actualGrossRevenue = facts.reduce((total, fact) => total.add(amount(fact.subtotal)), ZERO);
  const paymentFees = config
    ? payments.map((payment) => {
      const paid = amount(payment.amount);
      const percentage = paymentFeePercentage(payment.method, config);
      return {
        name: payment.method,
        amount: paid.mul(percentage).div(HUNDRED).add(amount(config.paymentFixedFee)).toString(),
      };
    })
    : [];
  const utilityTypeById = new Map(utilityTypes.map((utilityType) => [utilityType.id, utilityType]));
  const utilityCosts = utilityBills.flatMap((bill) => {
    if (at < bill.periodStart || at > bill.periodEnd) return [];
    const ordersInPeriod = paidOrders.filter((paid) => {
      const paidDate = dateKey(paid.createdAt);
      return paidDate >= bill.periodStart && paidDate <= bill.periodEnd;
    }).length;
    if (!ordersInPeriod) return [];
    const utilityType = utilityTypeById.get(bill.utilityTypeId);
    return [{
      code: `utility:${bill.id}`,
      amount: amount(bill.totalCost).div(amount(ordersInPeriod)).toString(),
      source: `Bolletta ${utilityType?.name ?? bill.utilityTypeId}, ripartita per comanda`,
      reliabilityLevel: "estimated" as const,
    }];
  });
  const indirectCosts = [...indirectAllocations.map((allocation) => ({
    code: allocation.costType,
    amount: allocation.allocatedAmount,
    source: allocation.source,
    reliabilityLevel: allocation.reliabilityLevel as "exact" | "estimated" | "approximate",
  })), ...utilityCosts];

  const preparationMinutes = lines.reduce((total, line) => total.add(
    amount(line.preparationMinutesPerUnit ?? 0).mul(amount(line.quantity)),
  ), ZERO);
  const fixedCostAllocation = config && amount(config.productiveHoursMonthly).isPositive()
    ? amount(config.fixedCostsMonthly)
      .div(amount(config.productiveHoursMonthly))
      .mul(preparationMinutes.div(SIXTY))
    : ZERO;
  if (config && !amount(config.productiveHoursMonthly).isPositive()) missingData.push("PRODUCTIVE_HOURS_INVALID");

  return {
    actualGrossRevenue,
    output: calculateMargin({
      actualGrossRevenue: actualGrossRevenue.toString(),
      lines,
      paymentFees,
      indirectCosts,
      laborHourlyCost: config?.ownerHourlyCost ?? "0",
      fixedCostAllocation: fixedCostAllocation.toString(),
      taxReservePercentage: config?.taxReservePercentage ?? "0",
      missingData,
    }),
  };
}

async function saveSnapshot(orderId: number, calculationVersion: number, output: MarginCalculatorOutput): Promise<void> {
  await db.insert(orderCostSnapshotsTable).values({
    orderId,
    calculationVersion,
    grossRevenue: output.grossRevenue,
    vatAmount: output.vatAmount,
    netRevenue: output.netRevenue,
    ingredientCost: output.totalIngredientCost,
    packagingCost: output.totalPackagingCost,
    fryerOilCost: output.totalFryerOilCost,
    energyCost: output.totalEnergyCost,
    paymentFee: output.totalPaymentFees,
    laborCost: output.totalLaborCost,
    indirectCost: output.totalIndirectCosts,
    fixedCostAllocation: output.fixedCostAllocation,
    contributionMargin: output.contributionMargin,
    estimatedManagementResult: output.managementResult,
    taxReserve: output.taxReserve,
    preparationMinutes: Math.round(Number(output.totalPreparationMinutes)),
    completenessStatus: output.completeness,
    missingData: JSON.stringify(output.missingData),
    costBreakdown: JSON.stringify(output.lineBreakdown),
    sources: JSON.stringify({ vatBreakdown: output.vatBreakdown, indirectCosts: output.indirectCostSources }),
  }).onConflictDoNothing();
}

export async function processMarginJob(jobId: number): Promise<void> {
  const [job] = await db.update(marginCalculationJobsTable).set({
    status: "processing",
    attempts: sql<number>`${marginCalculationJobsTable.attempts} + 1`,
    lastError: null,
  }).where(and(
    eq(marginCalculationJobsTable.id, jobId),
    inArray(marginCalculationJobsTable.status, ["pending", "failed"]),
    or(isNull(marginCalculationJobsTable.nextAttemptAt), lt(marginCalculationJobsTable.nextAttemptAt, new Date())),
  )).returning();
  if (!job) return;

  try {
    const { output } = await buildCalculation(job.orderId);
    await saveSnapshot(job.orderId, job.calculationVersion, output);
    await db.update(marginCalculationJobsTable).set({ status: "completed", nextAttemptAt: null })
      .where(eq(marginCalculationJobsTable.id, job.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryAt = new Date(Date.now() + Math.min(60, Math.max(1, job.attempts)) * 60_000);
    await db.update(marginCalculationJobsTable).set({
      status: "failed",
      lastError: message.slice(0, 2000),
      nextAttemptAt: retryAt,
    }).where(eq(marginCalculationJobsTable.id, job.id));
    logger.error({ jobId: job.id, orderId: job.orderId, error: message }, "Margin calculation failed");
  }
}

export async function processPendingMarginJobs(limit = 25): Promise<void> {
  const staleProcessing = new Date(Date.now() - 5 * 60_000);
  await db.update(marginCalculationJobsTable).set({
    status: "failed",
    lastError: "Worker interrotto: job rimesso in coda",
    nextAttemptAt: new Date(),
  }).where(and(eq(marginCalculationJobsTable.status, "processing"), lt(marginCalculationJobsTable.updatedAt, staleProcessing)));
  const jobs = await db.select().from(marginCalculationJobsTable)
    .where(sql`${marginCalculationJobsTable.status} IN ('pending', 'failed') AND (${marginCalculationJobsTable.nextAttemptAt} IS NULL OR ${marginCalculationJobsTable.nextAttemptAt} <= NOW())`)
    .orderBy(asc(marginCalculationJobsTable.createdAt))
    .limit(limit);
  for (const job of jobs) await processMarginJob(job.id);
}

export async function enqueueRecalculation(orderId: number): Promise<number> {
  return db.transaction(async (tx) => {
    const lockedOrder = await tx.execute<{ id: number }>(sql`
      SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE
    `);
    if (!lockedOrder.rows.length) throw new Error(`Order ${orderId} not found`);
    return enqueueNextCalculationVersion(tx, orderId);
  });
}

export async function getMarginOverview(from?: string, to?: string) {
  const conditions = [eq(ordersTable.status, "paid")];
  if (from) conditions.push(gte(ordersTable.createdAt, new Date(`${from}T00:00:00`)));
  if (to) {
    const end = new Date(`${to}T00:00:00`);
    end.setDate(end.getDate() + 1);
    conditions.push(lt(ordersTable.createdAt, end));
  }
  const rows = await db.select({ snapshot: orderCostSnapshotsTable, order: ordersTable })
    .from(orderCostSnapshotsTable)
    .innerJoin(ordersTable, eq(orderCostSnapshotsTable.orderId, ordersTable.id))
    .where(and(...conditions))
    .orderBy(desc(orderCostSnapshotsTable.calculationVersion), desc(orderCostSnapshotsTable.calculatedAt));

  const latestByOrder = new Map<number, typeof rows[number]>();
  for (const row of rows) if (!latestByOrder.has(row.order.id)) latestByOrder.set(row.order.id, row);
  const snapshots = [...latestByOrder.values()];

  const totals = {
    grossRevenue: ZERO, netRevenue: ZERO, ingredientCost: ZERO, packagingCost: ZERO,
    paymentFee: ZERO, laborCost: ZERO, indirectCost: ZERO, fixedCost: ZERO,
    contributionMargin: ZERO, managementResult: ZERO,
  };
  const products = new Map<number, { productId: number; productName: string; quantity: number; grossRevenue: FixedDecimal; contribution: FixedDecimal }>();
  let incompleteOrders = 0;
  for (const { snapshot } of snapshots) {
    totals.grossRevenue = totals.grossRevenue.add(amount(snapshot.grossRevenue));
    totals.netRevenue = totals.netRevenue.add(amount(snapshot.netRevenue));
    totals.ingredientCost = totals.ingredientCost.add(amount(snapshot.ingredientCost));
    totals.packagingCost = totals.packagingCost.add(amount(snapshot.packagingCost));
    totals.paymentFee = totals.paymentFee.add(amount(snapshot.paymentFee));
    totals.laborCost = totals.laborCost.add(amount(snapshot.laborCost));
    totals.indirectCost = totals.indirectCost.add(amount(snapshot.indirectCost));
    totals.fixedCost = totals.fixedCost.add(amount(snapshot.fixedCostAllocation));
    totals.contributionMargin = totals.contributionMargin.add(amount(snapshot.contributionMargin));
    totals.managementResult = totals.managementResult.add(amount(snapshot.estimatedManagementResult));
    if (snapshot.completenessStatus !== "complete") incompleteOrders++;
    const lines: Array<{ productId: number; quantity: string; grossRevenue: string; contribution: string }> = snapshot.costBreakdown
      ? JSON.parse(snapshot.costBreakdown) : [];
    for (const line of lines) {
      const fact = await db.select({ productName: marginOrderItemFactsTable.productName }).from(marginOrderItemFactsTable)
        .where(and(eq(marginOrderItemFactsTable.orderId, snapshot.orderId), eq(marginOrderItemFactsTable.productId, line.productId))).limit(1);
      const current = products.get(line.productId) ?? {
        productId: line.productId, productName: fact[0]?.productName ?? `Prodotto #${line.productId}`,
        quantity: 0, grossRevenue: ZERO, contribution: ZERO,
      };
      current.quantity += Number(line.quantity);
      current.grossRevenue = current.grossRevenue.add(amount(line.grossRevenue));
      current.contribution = current.contribution.add(amount(line.contribution));
      products.set(line.productId, current);
    }
  }
  const productRows = [...products.values()].map((product) => ({
    productId: product.productId,
    productName: product.productName,
    quantity: product.quantity,
    grossRevenue: product.grossRevenue.toFixed(2),
    contribution: product.contribution.toFixed(2),
    contributionPercent: product.grossRevenue.isZero() ? "0.00" : product.contribution.mul(HUNDRED).div(product.grossRevenue).toFixed(2),
  })).sort((a, b) => amount(b.contribution).raw > amount(a.contribution).raw ? 1 : -1);

  return {
    from: from ?? null,
    to: to ?? null,
    orderCount: snapshots.length,
    incompleteOrders,
    totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value.toFixed(2)])),
    mostProfitableProducts: productRows.slice(0, 8),
    lossMakingProducts: productRows.filter((product) => amount(product.contribution).isNegative()).slice(0, 8),
    incomplete: snapshots.filter(({ snapshot }) => snapshot.completenessStatus !== "complete").map(({ snapshot }) => ({
      orderId: snapshot.orderId,
      calculatedAt: snapshot.calculatedAt,
      missingData: snapshot.missingData ? JSON.parse(snapshot.missingData) : [],
    })),
  };
}

export async function getMarginOrderDetail(orderId: number) {
  const snapshots = await db.select().from(orderCostSnapshotsTable)
    .where(eq(orderCostSnapshotsTable.orderId, orderId))
    .orderBy(desc(orderCostSnapshotsTable.calculationVersion));
  const snapshot = snapshots[0];
  if (!snapshot) return null;
  return {
    ...snapshot,
    missingData: snapshot.missingData ? JSON.parse(snapshot.missingData) : [],
    lines: snapshot.costBreakdown ? JSON.parse(snapshot.costBreakdown) : [],
    sources: snapshot.sources ? JSON.parse(snapshot.sources) : {},
  };
}