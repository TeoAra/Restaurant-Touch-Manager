/**
 * Kitchen display board API — /api/kitchen
 *
 * Authenticated session required (kitchen, employee, admin).
 * NO cost or margin data is exposed here.
 */
import { Router } from "express";
import {
  db,
  ordersTable,
  orderItemsTable,
  tablesTable,
  productsTable,
  categoriesTable,
  recipesTable,
  recipeItemsTable,
  ingredientsTable,
  kitchenProductionEventsTable,
  departmentsTable,
} from "@workspace/db";
import { and, eq, inArray, gte, lt, sql } from "drizzle-orm";
import { requireAuthenticatedSession } from "../lib/session-auth.js";
import { requireAdminSession } from "../lib/session-auth.js";
import { logger } from "../lib/logger.js";
import {
  calculateActualPrepMinutes,
  isKitchenPrinter,
  isKitchenTransitionTarget,
  isValidKitchenTransition,
  type KitchenStatus,
} from "../lib/kitchen-domain.js";
import { recordActualPrepTimes } from "../lib/margin-service.js";

const router = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

// Timestamp column name for a given status
const STATUS_TIMESTAMP: Record<KitchenStatus, keyof typeof orderItemsTable.$inferSelect | null> = {
  draft:     null,
  sent:      "sentAt",
  preparing: "preparingAt",
  ready:     "readyAt",
  delivered: "deliveredAt",
};

// Scope every kitchen action through the same category → printer → department
// routing used by the board. A product without a kitchen department printer must
// never be moved by this tablet, even when it belongs to the same order.
const KITCHEN_ITEM_SCOPE = sql`
  EXISTS (
    SELECT 1
    FROM ${productsTable}
    INNER JOIN ${categoriesTable} ON ${categoriesTable.id} = ${productsTable.categoryId}
    INNER JOIN ${departmentsTable} ON ${departmentsTable.printerId} = ${categoriesTable.printerId}
    WHERE ${productsTable.id} = ${orderItemsTable.productId}
      AND ${departmentsTable.productionType} = ${"kitchen"}
  )
`;

function positiveId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

// ── Kitchen board ─────────────────────────────────────────────────────────────
// GET /api/kitchen/board
// Returns all active (open) orders with their items, table info, phases, and modifiers.
// Also includes recipe prep minutes. No costs.
router.get("/board", requireAuthenticatedSession, async (req, res): Promise<void> => {
  const [orders, allItems, tables, products, categories, recipes, departments] = await Promise.all([
    db.select().from(ordersTable).where(inArray(ordersTable.status, ["open", "paid"])),
    db.select().from(orderItemsTable),
    db.select().from(tablesTable),
    db.select({ id: productsTable.id, name: productsTable.name, categoryId: productsTable.categoryId }).from(productsTable),
    db.select({ id: categoriesTable.id, name: categoriesTable.name, printerId: categoriesTable.printerId }).from(categoriesTable),
    db.select({ productId: recipesTable.productId, preparationMinutes: recipesTable.preparationMinutes, active: recipesTable.active, version: recipesTable.version }).from(recipesTable),
    db.select({ printerId: departmentsTable.printerId, productionType: departmentsTable.productionType }).from(departmentsTable),
  ]);

  const tableMap = new Map(tables.map(t => [t.id, t]));
  const productMap = new Map(products.map(p => [p.id, p]));
  const categoryMap = new Map(categories.map(c => [c.id, c]));
  const kitchenPrinterIds = new Set(
    departments
      .filter(department => department.productionType === "kitchen" && department.printerId !== null)
      .map(department => department.printerId!),
  );
  const kitchenCategoryIds = new Set(
    categories
      .filter(category => isKitchenPrinter(category.printerId, kitchenPrinterIds))
      .map(category => category.id),
  );

  // Latest active recipe prep minutes per product
  const prepMinutesByProductId = new Map<number, { version: number; minutes: number }>();
  for (const r of recipes) {
    if (!r.active) continue;
    const existing = prepMinutesByProductId.get(r.productId);
    if (!existing || r.version > existing.version) {
      prepMinutesByProductId.set(r.productId, { version: r.version, minutes: r.preparationMinutes });
    }
  }

  const orderIds = orders.map(o => o.id);
  const items = orderIds.length
    ? allItems.filter(i =>
      orderIds.includes(i.orderId)
      && i.status !== "draft"
      && i.status !== "delivered"
      && kitchenCategoryIds.has(productMap.get(i.productId)?.categoryId ?? -1)
    )
    : [];

  const board = orders.map(order => {
    const orderItems = items.filter(i => i.orderId === order.id).map(item => {
      const product = productMap.get(item.productId);
      const category = product?.categoryId ? categoryMap.get(product.categoryId) : null;
      let parsedModifiers: unknown[] = [];
      try { parsedModifiers = JSON.parse(item.modifiers); } catch { /* ignore */ }
      return {
        id: item.id,
        orderId: item.orderId,
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        status: item.status,
        phase: item.phase,
        notes: item.notes,
        modifiers: parsedModifiers,
        categoryId: product?.categoryId ?? null,
        categoryName: category?.name ?? null,
        expectedPrepMinutes: prepMinutesByProductId.get(item.productId)?.minutes ?? null,
        sentAt: item.sentAt,
        preparingAt: item.preparingAt,
        readyAt: item.readyAt,
        deliveredAt: item.deliveredAt,
        createdAt: item.createdAt,
      };
    });

    const table = order.tableId ? tableMap.get(order.tableId) : null;
    return {
      orderId: order.id,
      tableId: order.tableId,
      tableName: table?.name ?? null,
      covers: order.covers,
      modalita: order.modalita,
      notes: order.notes,
      phase: order.modalita,
      createdAt: order.createdAt,
      items: orderItems,
    };
  });

  res.json(board.filter(order => order.items.length > 0));
});

// ── Menu categories (no costs) ────────────────────────────────────────────────
// GET /api/kitchen/categories
router.get("/categories", requireAuthenticatedSession, async (_req, res): Promise<void> => {
  const [categories, departments] = await Promise.all([
    db.select({ id: categoriesTable.id, name: categoriesTable.name, sortOrder: categoriesTable.sortOrder, printerId: categoriesTable.printerId })
      .from(categoriesTable)
      .orderBy(categoriesTable.sortOrder),
    db.select({ printerId: departmentsTable.printerId, productionType: departmentsTable.productionType }).from(departmentsTable),
  ]);
  const kitchenPrinterIds = new Set(
    departments
      .filter(department => department.productionType === "kitchen" && department.printerId !== null)
      .map(department => department.printerId!),
  );
  res.json(categories
    .filter(category => isKitchenPrinter(category.printerId, kitchenPrinterIds))
    .map(({ id, name, sortOrder }) => ({ id, name, sortOrder })));
});

// ── Recipe ingredients for product (for auto "Senza ingrediente" modifiers) ──
// GET /api/kitchen/products/:productId/ingredients
router.get("/products/:productId/ingredients", requireAuthenticatedSession, async (req, res): Promise<void> => {
  const productId = positiveId(req.params.productId);
  if (!productId) {
    res.status(400).json({ error: "ID prodotto non valido" });
    return;
  }
  // Find the latest active recipe for this product
  const productRecipes = await db.select().from(recipesTable)
    .where(and(eq(recipesTable.productId, productId), eq(recipesTable.active, true)))
    .orderBy(sql`${recipesTable.version} DESC`)
    .limit(1);

  if (!productRecipes.length) {
    res.json([]);
    return;
  }

  const recipe = productRecipes[0];
  const recipeIngredients = await db
    .select({
      id: ingredientsTable.id,
      name: ingredientsTable.name,
      baseUnit: ingredientsTable.baseUnit,
      quantity: recipeItemsTable.quantity,
    })
    .from(recipeItemsTable)
    .innerJoin(ingredientsTable, eq(recipeItemsTable.ingredientId, ingredientsTable.id))
    .where(eq(recipeItemsTable.recipeId, recipe.id));

  res.json(recipeIngredients.map(i => ({
    ingredientId: i.id,
    name: i.name,
    quantity: i.quantity,
    unit: i.baseUnit,
    source: "recipe",
  })));
});

// ── Item status transition ────────────────────────────────────────────────────
// PATCH /api/kitchen/items/:itemId/status
// body: { status: "preparing" | "ready" | "delivered" }
router.patch("/items/:itemId/status", requireAuthenticatedSession, async (req, res): Promise<void> => {
  const itemId = positiveId(req.params.itemId);
  if (!itemId) {
    res.status(400).json({ error: "ID articolo non valido" });
    return;
  }
  const toStatus = req.body?.status as string | undefined;
  if (!toStatus || !isKitchenTransitionTarget(toStatus)) {
    res.status(400).json({ error: "Stato non valido. Valori ammessi: sent, preparing, ready, delivered" });
    return;
  }

  const [item] = await db.select().from(orderItemsTable)
    .where(and(eq(orderItemsTable.id, itemId), KITCHEN_ITEM_SCOPE))
    .limit(1);
  if (!item) {
    res.status(404).json({ error: "Articolo non trovato nel reparto cucina" });
    return;
  }

  // Idempotency: already in target status → return current state without error
  if (item.status === toStatus) {
    res.json({ id: item.id, status: item.status, message: "already_in_status" });
    return;
  }

  if (!isValidKitchenTransition(item.status, toStatus)) {
    res.status(422).json({ error: `Transizione non valida: ${item.status} → ${toStatus}` });
    return;
  }

  const now = new Date();
  const tsCol = STATUS_TIMESTAMP[toStatus as KitchenStatus];
  const updateData: Record<string, unknown> = { status: toStatus };
  if (tsCol) updateData[tsCol as string] = now;

  // Actual production time is measured from explicit start to ready.
  let actualPrepMinutes: number | null = null;
  if (toStatus === "ready" && item.preparingAt) {
    actualPrepMinutes = calculateActualPrepMinutes(item.preparingAt, now);
  }

  const updated = await db.transaction(async (tx) => {
    const [transitioned] = await tx.update(orderItemsTable)
      .set(updateData)
      .where(and(
        eq(orderItemsTable.id, itemId),
        eq(orderItemsTable.status, item.status),
        KITCHEN_ITEM_SCOPE,
      ))
      .returning();
    if (!transitioned) return null;
    await tx.insert(kitchenProductionEventsTable).values({
      orderItemId: itemId,
      orderId: item.orderId,
      fromStatus: item.status,
      toStatus,
      triggeredBy: String((req as typeof req & { session?: { userId?: number } }).session?.userId ?? "kitchen"),
    }).onConflictDoNothing();
    return transitioned;
  });
  if (!updated) {
    const [latest] = await db.select({ status: orderItemsTable.status })
      .from(orderItemsTable)
      .where(eq(orderItemsTable.id, itemId))
      .limit(1);
    if (latest?.status === toStatus) {
      res.json({ id: itemId, status: toStatus, message: "already_in_status" });
      return;
    }
    res.status(409).json({ error: "Lo stato è cambiato su un altro dispositivo. Aggiorna e riprova." });
    return;
  }

  if (toStatus === "ready" && actualPrepMinutes !== null) {
    await recordActualPrepTimes(item.orderId, [{ orderItemId: itemId, actualPrepMinutes }])
      .catch(err => logger.warn({ err, itemId }, "Could not update actualPrepMinutes in margin facts"));
  }

  res.json({ id: updated.id, status: updated.status, message: "updated" });
});

// ── Bulk start by order (sent → preparing) ────────────────────────────────────
// POST /api/kitchen/orders/:orderId/start
// body: { phase?: number }  — if provided, only items of that phase
router.post("/orders/:orderId/start", requireAuthenticatedSession, async (req, res): Promise<void> => {
  const orderId = positiveId(req.params.orderId);
  if (!orderId) {
    res.status(400).json({ error: "ID ordine non valido" });
    return;
  }

  const phase = req.body?.phase != null ? Number(req.body.phase) : null;

  const conditions = [
    eq(orderItemsTable.orderId, orderId),
    eq(orderItemsTable.status, "sent"),
    KITCHEN_ITEM_SCOPE,
  ];
  if (phase !== null && Number.isInteger(phase)) {
    conditions.push(eq(orderItemsTable.phase, phase));
  }

  const updated = await db.transaction(async tx => {
    const now = new Date();
    const transitioned = await tx.update(orderItemsTable)
      .set({ status: "preparing", preparingAt: now })
      .where(and(...conditions))
      .returning();
    if (transitioned.length) {
      await tx.insert(kitchenProductionEventsTable).values(transitioned.map(item => ({
        orderItemId: item.id,
        orderId,
        fromStatus: "sent",
        toStatus: "preparing",
        triggeredBy: "kitchen-bulk-start",
      }))).onConflictDoNothing();
    }
    return transitioned;
  });

  res.json({ updated: updated.length, items: updated });
});

// ── Bulk ready by order (preparing → ready) ───────────────────────────────────
// POST /api/kitchen/orders/:orderId/ready
// body: { phase?: number }
router.post("/orders/:orderId/ready", requireAuthenticatedSession, async (req, res): Promise<void> => {
  const orderId = positiveId(req.params.orderId);
  if (!orderId) {
    res.status(400).json({ error: "ID ordine non valido" });
    return;
  }

  const phase = req.body?.phase != null ? Number(req.body.phase) : null;

  const conditions = [
    eq(orderItemsTable.orderId, orderId),
    eq(orderItemsTable.status, "preparing"),
    KITCHEN_ITEM_SCOPE,
  ];
  if (phase !== null && Number.isInteger(phase)) {
    conditions.push(eq(orderItemsTable.phase, phase));
  }

  const updated = await db.transaction(async tx => {
    const now = new Date();
    const transitioned = await tx.update(orderItemsTable)
      .set({ status: "ready", readyAt: now })
      .where(and(...conditions))
      .returning();
    if (transitioned.length) {
      await tx.insert(kitchenProductionEventsTable).values(transitioned.map(item => ({
        orderItemId: item.id,
        orderId,
        fromStatus: "preparing",
        toStatus: "ready",
        triggeredBy: "kitchen-bulk-ready",
      }))).onConflictDoNothing();
    }
    return transitioned;
  });

  const actualPrepTimes = updated.flatMap(item =>
    item.preparingAt && item.readyAt
      ? [{ orderItemId: item.id, actualPrepMinutes: calculateActualPrepMinutes(item.preparingAt, item.readyAt) }]
      : [],
  );
  if (actualPrepTimes.length) {
    await recordActualPrepTimes(orderId, actualPrepTimes)
      .catch(err => logger.warn({ err, orderId }, "Could not update actualPrepMinutes in margin facts"));
  }

  res.json({ updated: updated.length, items: updated });
});

// ── Admin analytics ───────────────────────────────────────────────────────────
// GET /api/kitchen/analytics
// Query params: from, to (YYYY-MM-DD), categoryId, productId
router.get("/analytics", requireAdminSession, async (req, res): Promise<void> => {
  const fromStr = typeof req.query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : null;
  const toStr = typeof req.query.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : null;
  const filterCategoryId = req.query.categoryId != null ? positiveId(req.query.categoryId) : null;
  const filterProductId = req.query.productId != null ? positiveId(req.query.productId) : null;

  // Filter by order date range via join
  const orderConditions: Array<ReturnType<typeof eq>> = [];
  if (fromStr) orderConditions.push(gte(ordersTable.createdAt, new Date(`${fromStr}T00:00:00`)));
  if (toStr) {
    const end = new Date(`${toStr}T23:59:59`);
    orderConditions.push(lt(ordersTable.createdAt, new Date(end.getTime() + 1000)));
  }

  // Fetch active orders (open + paid) with items
  const orderStatuses = ["open", "paid"];
  const baseOrders = await db.select().from(ordersTable).where(
    orderConditions.length
      ? and(inArray(ordersTable.status, orderStatuses), ...orderConditions)
      : inArray(ordersTable.status, orderStatuses),
  );

  const orderIds = baseOrders.map(o => o.id);
  const activeOrderIds = (await db.select({ id: ordersTable.id })
    .from(ordersTable)
    .where(inArray(ordersTable.status, orderStatuses)))
    .map(order => order.id);

  const [items, products, categories, recipes, currentItems] = await Promise.all([
    orderIds.length
      ? db.select().from(orderItemsTable).where(
        and(
          inArray(orderItemsTable.orderId, orderIds),
          sql`${orderItemsTable.sentAt} IS NOT NULL`,
        ),
      )
      : Promise.resolve([]),
    db.select({ id: productsTable.id, name: productsTable.name, categoryId: productsTable.categoryId }).from(productsTable),
    db.select({ id: categoriesTable.id, name: categoriesTable.name }).from(categoriesTable),
    db.select({ productId: recipesTable.productId, preparationMinutes: recipesTable.preparationMinutes, active: recipesTable.active, version: recipesTable.version }).from(recipesTable),
    activeOrderIds.length
      ? db.select().from(orderItemsTable).where(
        and(
          inArray(orderItemsTable.orderId, activeOrderIds),
          inArray(orderItemsTable.status, ["sent", "preparing"]),
        ),
      )
      : Promise.resolve([]),
  ]);

  const productMap = new Map(products.map(p => [p.id, p]));
  const categoryMap = new Map(categories.map(c => [c.id, c]));

  // Latest active prep minutes per product
  const prepMinByProduct = new Map<number, { version: number; minutes: number }>();
  for (const r of recipes.filter(r => r.active)) {
    const existing = prepMinByProduct.get(r.productId);
    if (!existing || r.version > existing.version) {
      prepMinByProduct.set(r.productId, { version: r.version, minutes: r.preparationMinutes });
    }
  }

  // Apply product/category filters
  let filteredItems = items;
  if (filterProductId) {
    filteredItems = filteredItems.filter(i => i.productId === filterProductId);
  }
  if (filterCategoryId) {
    filteredItems = filteredItems.filter(i => {
      const p = productMap.get(i.productId);
      return p?.categoryId === filterCategoryId;
    });
  }

  const filteredCurrentItems = currentItems.filter(item => {
    if (filterProductId && item.productId !== filterProductId) return false;
    if (filterCategoryId && productMap.get(item.productId)?.categoryId !== filterCategoryId) return false;
    return true;
  });
  const currentLoad = filteredCurrentItems.length;

  // Actual production minutes (preparingAt → readyAt), available from ready onward.
  const completedItems = filteredItems.filter(i => i.preparingAt && i.readyAt);
  const actualPrepMinutesValues = completedItems.map(i =>
    Math.max(0, Math.round((i.readyAt!.getTime() - i.preparingAt!.getTime()) / 60000)),
  );

  const avgActualPrepMinutes = actualPrepMinutesValues.length
    ? Math.round(actualPrepMinutesValues.reduce((a, b) => a + b, 0) / actualPrepMinutesValues.length)
    : null;

  // Expected vs actual variance
  let varianceSum = 0;
  let varianceCount = 0;
  const delayedCount = filteredCurrentItems.filter(item => {
    const expected = prepMinByProduct.get(item.productId)?.minutes;
    const startedAt = item.preparingAt ?? item.sentAt;
    return expected != null
      && startedAt != null
      && Date.now() - startedAt.getTime() > expected * 60_000;
  }).length;
  for (const item of completedItems) {
    const expected = prepMinByProduct.get(item.productId)?.minutes;
    if (expected == null) continue;
    const actual = Math.max(0, Math.round((item.readyAt!.getTime() - item.preparingAt!.getTime()) / 60000));
    varianceSum += actual - expected;
    varianceCount++;
  }
  const expectedVsActualVarianceMinutes = varianceCount > 0 ? Math.round(varianceSum / varianceCount) : null;

  // Product summaries
  const productStats = new Map<number, {
    productId: number; productName: string; categoryId: number | null; categoryName: string | null;
    count: number; deliveredCount: number; totalActualMinutes: number; expectedMinutes: number | null;
  }>();

  for (const item of filteredItems) {
    const product = productMap.get(item.productId);
    const category = product?.categoryId ? categoryMap.get(product.categoryId) : null;
    const existing = productStats.get(item.productId) ?? {
      productId: item.productId,
      productName: item.productName,
      categoryId: product?.categoryId ?? null,
      categoryName: category?.name ?? null,
      count: 0,
      deliveredCount: 0,
      totalActualMinutes: 0,
      expectedMinutes: prepMinByProduct.get(item.productId)?.minutes ?? null,
    };
    existing.count += item.quantity;
    if (item.preparingAt && item.readyAt) {
      existing.deliveredCount += item.quantity;
      existing.totalActualMinutes += Math.max(0, Math.round((item.readyAt.getTime() - item.preparingAt.getTime()) / 60000)) * item.quantity;
    }
    productStats.set(item.productId, existing);
  }

  const productSummaries = [...productStats.values()].map(p => ({
    productId: p.productId,
    productName: p.productName,
    categoryId: p.categoryId,
    categoryName: p.categoryName,
    totalCount: p.count,
    deliveredCount: p.deliveredCount,
    avgActualPrepMinutes: p.deliveredCount > 0 ? Math.round(p.totalActualMinutes / p.deliveredCount) : null,
    expectedPrepMinutes: p.expectedMinutes,
  }));

  // Category summaries
  const categoryStats = new Map<number, {
    categoryId: number; categoryName: string;
    count: number; deliveredCount: number; totalActualMinutes: number;
  }>();
  for (const ps of productSummaries) {
    if (!ps.categoryId) continue;
    const existing = categoryStats.get(ps.categoryId) ?? {
      categoryId: ps.categoryId,
      categoryName: ps.categoryName ?? `Categoria #${ps.categoryId}`,
      count: 0,
      deliveredCount: 0,
      totalActualMinutes: 0,
    };
    existing.count += ps.totalCount;
    existing.deliveredCount += ps.deliveredCount;
    if (ps.avgActualPrepMinutes != null && ps.deliveredCount > 0) {
      existing.totalActualMinutes += ps.avgActualPrepMinutes * ps.deliveredCount;
    }
    categoryStats.set(ps.categoryId, existing);
  }

  const categorySummaries = [...categoryStats.values()].map(c => ({
    categoryId: c.categoryId,
    categoryName: c.categoryName,
    totalCount: c.count,
    deliveredCount: c.deliveredCount,
    avgActualPrepMinutes: c.deliveredCount > 0 ? Math.round(c.totalActualMinutes / c.deliveredCount) : null,
  }));

  res.json({
    currentLoad,
    averageActualPrepMinutes: avgActualPrepMinutes,
    expectedVsActualVarianceMinutes,
    delayedCount,
    productSummaries,
    categorySummaries,
  });
});

export default router;
