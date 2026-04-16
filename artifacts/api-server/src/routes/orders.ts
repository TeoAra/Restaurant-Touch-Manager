import { Router } from "express";
import { db, ordersTable, orderItemsTable, tablesTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import {
  CreateOrderBody,
  UpdateOrderBody,
  GetOrderParams,
  UpdateOrderParams,
  DeleteOrderParams,
  ListOrdersQueryParams,
  AddOrderItemBody,
  UpdateOrderItemBody,
  ListOrderItemsParams,
  UpdateOrderItemParams,
  DeleteOrderItemParams,
  AddOrderItemParams,
} from "@workspace/api-zod";

const router = Router();

async function recalcOrderTotal(orderId: number) {
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
  const total = items.reduce((sum, item) => sum + parseFloat(item.subtotal), 0);
  await db.update(ordersTable).set({ total: total.toFixed(2) }).where(eq(ordersTable.id, orderId));
  return total.toFixed(2);
}

// List orders
router.get("/", async (req, res) => {
  const params = ListOrdersQueryParams.parse({
    status: req.query.status || undefined,
    tableId: req.query.tableId !== undefined ? Number(req.query.tableId) : undefined,
  });

  const conditions = [];
  if (params.status) conditions.push(eq(ordersTable.status, params.status));
  if (params.tableId != null) conditions.push(eq(ordersTable.tableId, params.tableId));

  const orders = conditions.length > 0
    ? await db.select().from(ordersTable).where(and(...conditions)).orderBy(ordersTable.createdAt)
    : await db.select().from(ordersTable).orderBy(ordersTable.createdAt);

  // Attach table names
  const tables = await db.select().from(tablesTable);
  const tableMap = new Map(tables.map(t => [t.id, t.name]));
  const result = orders.map(o => ({
    ...o,
    tableName: o.tableId ? (tableMap.get(o.tableId) ?? null) : null,
  }));
  res.json(result);
});

// Create order
router.post("/", async (req, res) => {
  const body = CreateOrderBody.parse(req.body);
  const [order] = await db.insert(ordersTable).values({
    tableId: body.tableId ?? null,
    notes: body.notes ?? null,
    status: "open",
    total: "0.00",
  }).returning();

  if (body.tableId) {
    await db.update(tablesTable).set({ status: "occupied" }).where(eq(tablesTable.id, body.tableId));
  }

  const tables = await db.select().from(tablesTable);
  const tableMap = new Map(tables.map(t => [t.id, t.name]));
  res.status(201).json({ ...order, tableName: order.tableId ? (tableMap.get(order.tableId) ?? null) : null });
});

// Get single order with items
router.get("/:id", async (req, res) => {
  const { id } = GetOrderParams.parse({ id: Number(req.params.id) });
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (!order) return res.status(404).json({ error: "Order not found" });
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, id));

  const tables = await db.select().from(tablesTable);
  const tableMap = new Map(tables.map(t => [t.id, t.name]));
  res.json({ ...order, tableName: order.tableId ? (tableMap.get(order.tableId) ?? null) : null, items });
});

// Update order
router.patch("/:id", async (req, res) => {
  const { id } = UpdateOrderParams.parse({ id: Number(req.params.id) });
  const body = UpdateOrderBody.parse(req.body);

  const updateData: Record<string, unknown> = {};
  if (body.status !== undefined) updateData.status = body.status;
  if (body.notes !== undefined) updateData.notes = body.notes;
  if (body.tableId !== undefined) updateData.tableId = body.tableId;

  const [order] = await db.update(ordersTable).set(updateData).where(eq(ordersTable.id, id)).returning();
  if (!order) return res.status(404).json({ error: "Order not found" });

  // When paid/cancelled, free the table if no other open orders
  if (body.status === "paid" || body.status === "cancelled") {
    if (order.tableId) {
      const openOrders = await db.select().from(ordersTable)
        .where(and(eq(ordersTable.tableId, order.tableId), eq(ordersTable.status, "open")));
      if (openOrders.length === 0) {
        await db.update(tablesTable).set({ status: "free" }).where(eq(tablesTable.id, order.tableId));
      }
    }
  }

  const tables = await db.select().from(tablesTable);
  const tableMap = new Map(tables.map(t => [t.id, t.name]));
  res.json({ ...order, tableName: order.tableId ? (tableMap.get(order.tableId) ?? null) : null });
});

// Delete (cancel) order
router.delete("/:id", async (req, res) => {
  const { id } = DeleteOrderParams.parse({ id: Number(req.params.id) });
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (order?.tableId) {
    const openOrders = await db.select().from(ordersTable)
      .where(and(eq(ordersTable.tableId, order.tableId), eq(ordersTable.status, "open")));
    if (openOrders.length <= 1) {
      await db.update(tablesTable).set({ status: "free" }).where(eq(tablesTable.id, order.tableId));
    }
  }
  await db.delete(orderItemsTable).where(eq(orderItemsTable.orderId, id));
  await db.delete(ordersTable).where(eq(ordersTable.id, id));
  res.status(204).end();
});

// List order items
router.get("/:orderId/items", async (req, res) => {
  const { orderId } = ListOrderItemsParams.parse({ orderId: Number(req.params.orderId) });
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
  res.json(items);
});

// Add order item
router.post("/:orderId/items", async (req, res) => {
  const { orderId } = AddOrderItemParams.parse({ orderId: Number(req.params.orderId) });
  const body = AddOrderItemBody.parse(req.body);

  const { productsTable: pt } = await import("@workspace/db");
  const [product] = await db.select().from(pt).where(eq(pt.id, body.productId));
  if (!product) return res.status(404).json({ error: "Product not found" });

  const unitPrice = product.price;
  const subtotal = (parseFloat(unitPrice) * body.quantity).toFixed(2);

  const [item] = await db.insert(orderItemsTable).values({
    orderId,
    productId: body.productId,
    productName: product.name,
    productPrice: product.price,
    quantity: body.quantity,
    unitPrice,
    subtotal,
    notes: body.notes ?? null,
  }).returning();

  await recalcOrderTotal(orderId);
  res.status(201).json(item);
});

// Update order item
router.patch("/:orderId/items/:itemId", async (req, res) => {
  const { orderId, itemId } = UpdateOrderItemParams.parse({
    orderId: Number(req.params.orderId),
    itemId: Number(req.params.itemId),
  });
  const body = UpdateOrderItemBody.parse(req.body);

  const [existing] = await db.select().from(orderItemsTable).where(
    and(eq(orderItemsTable.id, itemId), eq(orderItemsTable.orderId, orderId))
  );
  if (!existing) return res.status(404).json({ error: "Order item not found" });

  const updateData: Record<string, unknown> = {};
  if (body.quantity !== undefined) {
    updateData.quantity = body.quantity;
    updateData.subtotal = (parseFloat(existing.unitPrice) * body.quantity).toFixed(2);
  }
  if (body.notes !== undefined) updateData.notes = body.notes;

  const [item] = await db.update(orderItemsTable).set(updateData)
    .where(and(eq(orderItemsTable.id, itemId), eq(orderItemsTable.orderId, orderId)))
    .returning();

  await recalcOrderTotal(orderId);
  res.json(item);
});

// Delete order item
router.delete("/:orderId/items/:itemId", async (req, res) => {
  const { orderId, itemId } = DeleteOrderItemParams.parse({
    orderId: Number(req.params.orderId),
    itemId: Number(req.params.itemId),
  });
  await db.delete(orderItemsTable).where(
    and(eq(orderItemsTable.id, itemId), eq(orderItemsTable.orderId, orderId))
  );
  await recalcOrderTotal(orderId);
  res.status(204).end();
});

export default router;
