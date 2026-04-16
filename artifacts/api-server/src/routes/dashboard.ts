import { Router } from "express";
import { db, ordersTable, orderItemsTable, tablesTable, paymentsTable } from "@workspace/db";
import { eq, and, gte, sql } from "drizzle-orm";

const router = Router();

router.get("/summary", async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const allOrders = await db.select().from(ordersTable);
  const todayOrders = allOrders.filter(o => new Date(o.createdAt) >= today && o.status === "paid");
  const openOrders = allOrders.filter(o => o.status === "open");

  const todayRevenue = todayOrders.reduce((sum, o) => sum + parseFloat(o.total), 0);
  const avgOrderValue = todayOrders.length > 0 ? todayRevenue / todayOrders.length : 0;

  const tables = await db.select().from(tablesTable);
  const occupiedTables = tables.filter(t => t.status === "occupied").length;

  res.json({
    todayRevenue: todayRevenue.toFixed(2),
    todayOrders: todayOrders.length,
    openOrders: openOrders.length,
    occupiedTables,
    totalTables: tables.length,
    avgOrderValue: avgOrderValue.toFixed(2),
  });
});

router.get("/sales-by-day", async (req, res) => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  thirtyDaysAgo.setHours(0, 0, 0, 0);

  const orders = await db.select().from(ordersTable)
    .where(and(gte(ordersTable.createdAt, thirtyDaysAgo), eq(ordersTable.status, "paid")));

  const byDay = new Map<string, { revenue: number; orders: number }>();
  for (const order of orders) {
    const date = new Date(order.createdAt).toISOString().split("T")[0];
    const existing = byDay.get(date) ?? { revenue: 0, orders: 0 };
    byDay.set(date, {
      revenue: existing.revenue + parseFloat(order.total),
      orders: existing.orders + 1,
    });
  }

  // Fill in all days in the last 30 days
  const result = [];
  for (let i = 29; i >= 0; i--) {
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
  const items = await db.select().from(orderItemsTable);
  const productMap = new Map<number, { productName: string; totalQuantity: number; totalRevenue: number }>();

  for (const item of items) {
    const existing = productMap.get(item.productId) ?? { productName: item.productName, totalQuantity: 0, totalRevenue: 0 };
    productMap.set(item.productId, {
      productName: item.productName,
      totalQuantity: existing.totalQuantity + item.quantity,
      totalRevenue: existing.totalRevenue + parseFloat(item.subtotal),
    });
  }

  const result = Array.from(productMap.entries())
    .map(([productId, data]) => ({
      productId,
      productName: data.productName,
      totalQuantity: data.totalQuantity,
      totalRevenue: data.totalRevenue.toFixed(2),
    }))
    .sort((a, b) => b.totalQuantity - a.totalQuantity)
    .slice(0, 10);

  res.json(result);
});

router.get("/tables-status", async (req, res) => {
  const tables = await db.select().from(tablesTable).orderBy(tablesTable.number);
  const openOrders = await db.select().from(ordersTable).where(eq(ordersTable.status, "open"));

  const orderByTable = new Map(openOrders.map(o => [o.tableId, o]));

  const result = tables.map(t => {
    const activeOrder = orderByTable.get(t.id);
    return {
      id: t.id,
      number: t.number,
      name: t.name,
      seats: t.seats,
      status: t.status,
      activeOrderId: activeOrder?.id ?? null,
      activeOrderTotal: activeOrder?.total ?? null,
      activeOrderCreatedAt: activeOrder?.createdAt?.toISOString() ?? null,
    };
  });

  res.json(result);
});

export default router;
