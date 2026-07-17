import { Router } from "express";
import { db, ordersTable, orderItemsTable, tablesTable, paymentsTable, roomsTable } from "@workspace/db";
import { eq, and, gte, lt, sql } from "drizzle-orm";

const router = Router();

router.get("/summary", async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  // Stesso giorno della settimana scorsa (es. giovedì vs giovedì scorso)
  const lastWeekStart = new Date(today);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  const lastWeekEnd = new Date(lastWeekStart);
  lastWeekEnd.setDate(lastWeekEnd.getDate() + 1);

  // Carichiamo solo gli ordini pagati degli ultimi 8 giorni (basta per oggi/ieri/settimana scorsa)
  const paidOrders = await db.select().from(ordersTable)
    .where(and(gte(ordersTable.createdAt, lastWeekStart), eq(ordersTable.status, "paid")));
  const openOrdersList = await db.select().from(ordersTable).where(eq(ordersTable.status, "open"));

  const todayOrders = paidOrders.filter(o => new Date(o.createdAt) >= today);
  const yesterdayOrders = paidOrders.filter(o => {
    const d = new Date(o.createdAt);
    return d >= yesterday && d < today;
  });
  const lastWeekOrders = paidOrders.filter(o => {
    const d = new Date(o.createdAt);
    return d >= lastWeekStart && d < lastWeekEnd;
  });

  const sum = (list: typeof paidOrders) => list.reduce((s, o) => s + parseFloat(o.total), 0);
  const todayRevenue = sum(todayOrders);
  const avgOrderValue = todayOrders.length > 0 ? todayRevenue / todayOrders.length : 0;

  const tables = await db.select().from(tablesTable);
  const occupiedTables = tables.filter(t => t.status === "occupied").length;

  res.json({
    todayRevenue: todayRevenue.toFixed(2),
    todayOrders: todayOrders.length,
    openOrders: openOrdersList.length,
    occupiedTables,
    totalTables: tables.length,
    avgOrderValue: avgOrderValue.toFixed(2),
    yesterdayRevenue: sum(yesterdayOrders).toFixed(2),
    yesterdayOrders: yesterdayOrders.length,
    lastWeekRevenue: sum(lastWeekOrders).toFixed(2),
    lastWeekOrders: lastWeekOrders.length,
  });
});

router.get("/sales-by-day", async (req, res) => {
  // Range flessibile: ?days=7|14|30|90 (default 30, clamp 1..365)
  const daysRaw = parseInt(String(req.query.days ?? "30"), 10);
  const days = isNaN(daysRaw) ? 30 : Math.min(365, Math.max(1, daysRaw));

  const rangeStart = new Date();
  rangeStart.setDate(rangeStart.getDate() - days);
  rangeStart.setHours(0, 0, 0, 0);

  const orders = await db.select().from(ordersTable)
    .where(and(gte(ordersTable.createdAt, rangeStart), eq(ordersTable.status, "paid")));

  const byDay = new Map<string, { revenue: number; orders: number }>();
  for (const order of orders) {
    const date = new Date(order.createdAt).toISOString().split("T")[0];
    const existing = byDay.get(date) ?? { revenue: 0, orders: 0 };
    byDay.set(date, {
      revenue: existing.revenue + parseFloat(order.total),
      orders: existing.orders + 1,
    });
  }

  // Riempi tutti i giorni del periodo richiesto
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    const data = byDay.get(dateStr) ?? { revenue: 0, orders: 0 };
    result.push({
      date: dateStr,
      revenue: data.revenue.toFixed(2),
      orders: data.orders,
    });
  }

  res.json(result);
});

router.get("/top-products", async (req, res) => {
  // Filtro periodo opzionale: ?from=YYYY-MM-DD&to=YYYY-MM-DD (default: tutto lo storico)
  const { from, to } = req.query as { from?: string; to?: string };
  const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

  // Il periodo è riferito alla data dell'ORDINE (non dell'articolo, che può
  // essere stato aggiunto in un momento diverso): coerente con sales-by-day.
  const conditions = [];
  if (isDate(from)) conditions.push(gte(ordersTable.createdAt, new Date(`${from}T00:00:00`)));
  if (isDate(to)) {
    const toEnd = new Date(`${to}T00:00:00`);
    toEnd.setDate(toEnd.getDate() + 1);
    conditions.push(lt(ordersTable.createdAt, toEnd));
  }

  // Solo ordini pagati: il report deve riflettere le vendite reali,
  // non gli articoli di ordini ancora aperti o annullati.
  conditions.push(eq(ordersTable.status, "paid"));

  // Aggregazione in SQL (GROUP BY) invece che in memoria
  const rows = await db
    .select({
      productId: orderItemsTable.productId,
      productName: sql<string>`MAX(${orderItemsTable.productName})`,
      totalQuantity: sql<number>`SUM(${orderItemsTable.quantity})::int`,
      totalRevenue: sql<string>`SUM(${orderItemsTable.subtotal}::numeric)::text`,
    })
    .from(orderItemsTable)
    .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .where(and(...conditions))
    .groupBy(orderItemsTable.productId)
    .orderBy(sql`SUM(${orderItemsTable.quantity}) DESC`)
    .limit(10);

  res.json(rows.map(r => ({
    productId: r.productId,
    productName: r.productName,
    totalQuantity: r.totalQuantity,
    totalRevenue: parseFloat(r.totalRevenue ?? "0").toFixed(2),
  })));
});

// ── Alias per /api/fiscal/iva-report (compat: /api/dashboard/iva-report) ──
// Stessa logica del report IVA per aliquota; espone l'endpoint sotto il
// namespace dashboard per coerenza con altre statistiche di reporting.
router.get("/iva-report", async (req, res) => {
  const { from, to } = req.query as { from?: string; to?: string };
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = from ?? today;
  const toDate   = to   ?? today;

  const result = await db.execute(sql`
    SELECT
      ROUND((iva::numeric * 100.0 / NULLIF((importo::numeric - iva::numeric), 0))::numeric, 0) AS aliquota,
      COUNT(*) AS scontrini,
      SUM((importo::numeric - iva::numeric))::text AS imponibile,
      SUM(iva::numeric)::text AS iva,
      SUM(importo::numeric)::text AS totale
    FROM fiscal_receipts
    WHERE annullato = false
      AND data >= ${fromDate}
      AND data <= ${toDate}
    GROUP BY aliquota
    ORDER BY aliquota DESC
  `);

  const byMethod = await db.execute(sql`
    SELECT metodo_pagamento AS metodo, COUNT(*) AS n, SUM(importo::numeric)::text AS totale
    FROM fiscal_receipts
    WHERE annullato = false
      AND data >= ${fromDate}
      AND data <= ${toDate}
    GROUP BY metodo_pagamento
  `);

  res.json({
    from: fromDate,
    to: toDate,
    perAliquota: result.rows,
    perMetodo: byMethod.rows,
  });
});

router.get("/tables-status", async (req, res) => {
  const tables = await db
    .select({
      id: tablesTable.id,
      number: tablesTable.number,
      name: tablesTable.name,
      seats: tablesTable.seats,
      status: tablesTable.status,
      roomId: tablesTable.roomId,
      sortOrder: tablesTable.sortOrder,
      posX: tablesTable.posX,
      posY: tablesTable.posY,
      shape: tablesTable.shape,
      elementType: tablesTable.elementType,
      rotation: tablesTable.rotation,
      sizeScale: tablesTable.sizeScale,
      roomName: roomsTable.name,
    })
    .from(tablesTable)
    .leftJoin(roomsTable, eq(tablesTable.roomId, roomsTable.id))
    .orderBy(tablesTable.sortOrder, tablesTable.number);

  const openOrders = await db.select().from(ordersTable).where(eq(ordersTable.status, "open"));
  const orderByTable = new Map(openOrders.map(o => [o.tableId, o]));

  const result = tables.map(t => {
    const activeOrder = t.elementType === "table" ? orderByTable.get(t.id) : undefined;
    return {
      id: t.id,
      number: t.number,
      name: t.name,
      seats: t.seats,
      status: t.status,
      roomId: t.roomId ?? null,
      roomName: t.roomName ?? null,
      posX: t.posX ?? 0,
      posY: t.posY ?? 0,
      shape: t.shape ?? "square",
      elementType: t.elementType ?? "table",
      rotation: t.rotation ?? 0,
      sizeScale: t.sizeScale ?? 1.0,
      activeOrderId: activeOrder?.id ?? null,
      activeOrderTotal: activeOrder?.total ?? null,
      activeOrderCreatedAt: activeOrder?.createdAt?.toISOString() ?? null,
      prePrintedAt: activeOrder?.prePrintedAt?.toISOString() ?? null,
    };
  });

  res.json(result);
});

export default router;
