import { Router } from "express";
import { db, ordersTable, orderItemsTable, tablesTable, productsTable, categoriesTable, printersTable } from "@workspace/db";
import { eq, and, sql, inArray } from "drizzle-orm";
import net from "net";
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
  const covers = (req.body as { covers?: number }).covers;
  const [order] = await db.insert(ordersTable).values({
    tableId: body.tableId ?? null,
    notes: body.notes ?? null,
    covers: typeof covers === "number" && covers >= 0 ? covers : 1,
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

  // Read current order first (needed for table-reassign logic)
  const [currentOrder] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (!currentOrder) return res.status(404).json({ error: "Order not found" });

  const updateData: Record<string, unknown> = {};
  if (body.status !== undefined) updateData.status = body.status;
  if (body.notes !== undefined) updateData.notes = body.notes;
  if (body.tableId !== undefined) updateData.tableId = body.tableId;

  const [order] = await db.update(ordersTable).set(updateData).where(eq(ordersTable.id, id)).returning();
  if (!order) return res.status(404).json({ error: "Order not found" });

  // Handle table reassignment: free old table, occupy new table
  if (body.tableId !== undefined && body.tableId !== currentOrder.tableId) {
    // Free old table if no other open orders use it
    if (currentOrder.tableId) {
      const oldOpenOrders = await db.select().from(ordersTable)
        .where(and(eq(ordersTable.tableId, currentOrder.tableId), eq(ordersTable.status, "open")));
      if (oldOpenOrders.length === 0) {
        await db.update(tablesTable).set({ status: "free" }).where(eq(tablesTable.id, currentOrder.tableId));
      }
    }
    // Mark new table as occupied
    if (body.tableId) {
      await db.update(tablesTable).set({ status: "occupied" }).where(eq(tablesTable.id, body.tableId));
    }
  }

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

  // Use client-supplied price (for phase pricing) or fall back to base price
  const unitPrice = body.unitPrice ?? product.price;
  const subtotal = (parseFloat(unitPrice) * body.quantity).toFixed(2);

  const rawAddModifiers = (req.body as { modifiers?: string }).modifiers;
  const [item] = await db.insert(orderItemsTable).values({
    orderId,
    productId: body.productId,
    productName: product.name,
    productPrice: product.price,
    quantity: body.quantity,
    unitPrice,
    subtotal,
    notes: body.notes ?? null,
    modifiers: rawAddModifiers ?? "[]",
    phase: body.phase ?? 0,
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
  const effectiveUnitPrice = body.unitPrice ?? existing.unitPrice;
  if (body.unitPrice !== undefined) updateData.unitPrice = body.unitPrice;
  if (body.quantity !== undefined) {
    updateData.quantity = body.quantity;
    updateData.subtotal = (parseFloat(effectiveUnitPrice) * body.quantity).toFixed(2);
  } else if (body.unitPrice !== undefined) {
    updateData.subtotal = (parseFloat(effectiveUnitPrice) * existing.quantity).toFixed(2);
  }
  if (body.notes !== undefined) updateData.notes = body.notes;
  // modifiers is not in the Zod schema but can be passed directly
  const rawModifiers = (req.body as { modifiers?: string }).modifiers;
  if (rawModifiers !== undefined) updateData.modifiers = rawModifiers;

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

// ── ESC/POS helpers ──────────────────────────────────────────────────────────
const ESC = 0x1b;
const GS  = 0x1d;


function escposComanda(tableLabel: string, items: { productName: string; quantity: number; notes?: string | null }[], phase: string): Buffer {
  const init     = Buffer.from([ESC, 0x40]);                          // init
  const bold_on  = Buffer.from([ESC, 0x45, 0x01]);
  const bold_off = Buffer.from([ESC, 0x45, 0x00]);
  const dbl_on   = Buffer.from([GS,  0x21, 0x11]);                   // double width+height
  const dbl_off  = Buffer.from([GS,  0x21, 0x00]);
  const center   = Buffer.from([ESC, 0x61, 0x01]);
  const left     = Buffer.from([ESC, 0x61, 0x00]);
  const cut      = Buffer.from([GS,  0x56, 0x41, 0x03]);             // partial cut + feed
  const lf       = Buffer.from([0x0a]);

  const now = new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  const separator = Buffer.from("-".repeat(32) + "\n");

  const header = Buffer.concat([
    init, center, dbl_on, bold_on,
    Buffer.from(`COMANDA ${phase}\n`),
    dbl_off,
    Buffer.from(`${tableLabel}  ${now}\n`),
    bold_off, left, separator,
  ]);

  const body = Buffer.concat(items.map(item => {
    const qty  = String(item.quantity).padStart(3, " ");
    const name = item.productName.substring(0, 28);
    const line = Buffer.concat([
      bold_on,
      Buffer.from(`${qty}x ${name}\n`),
      bold_off,
    ]);
    const noteLine = item.notes
      ? Buffer.from(`     ** ${item.notes.substring(0, 26)} **\n`)
      : Buffer.alloc(0);
    return Buffer.concat([line, noteLine]);
  }));

  return Buffer.concat([header, body, lf, cut]);
}

async function sendToPrinter(ip: string, port: number, data: Buffer, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      socket.destroy();
      err ? reject(err) : resolve();
    };
    socket.setTimeout(timeoutMs);
    socket.on("timeout", () => finish(new Error(`Timeout connecting to ${ip}:${port}`)));
    socket.on("error", (e) => finish(e));
    socket.connect(port, ip, () => {
      socket.write(data, (err) => {
        if (err) return finish(err);
        finish();
      });
    });
  });
}

// ── Send comanda ─────────────────────────────────────────────────────────────
router.post("/:id/send-comanda", async (req, res) => {
  const id = Number(req.params.id);
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (!order) return res.status(404).json({ error: "Order not found" });

  // 1. Mark draft items as sent and get them back
  const sentItems = await db.update(orderItemsTable)
    .set({ status: "sent" })
    .where(and(eq(orderItemsTable.orderId, id), eq(orderItemsTable.status, "draft")))
    .returning();

  if (sentItems.length === 0) {
    return res.json({ success: true, sentItems: 0, printers: [] });
  }

  // 2. Resolve category → printer for each sent item
  const productIds = [...new Set(sentItems.map(i => i.productId).filter(Boolean))] as number[];
  const products   = productIds.length
    ? await db.select({ id: productsTable.id, categoryId: productsTable.categoryId })
        .from(productsTable)
        .where(inArray(productsTable.id, productIds))
    : [];

  const categoryIds = [...new Set(products.map(p => p.categoryId).filter(Boolean))] as number[];
  const categories  = categoryIds.length
    ? await db.select({ id: categoriesTable.id, printerId: categoriesTable.printerId })
        .from(categoriesTable)
        .where(inArray(categoriesTable.id, categoryIds))
    : [];

  const printerIds = [...new Set(categories.map(c => c.printerId).filter(Boolean))] as number[];
  const printers   = printerIds.length
    ? await db.select().from(printersTable).where(inArray(printersTable.id, printerIds))
    : [];

  // Build lookup maps
  const catByProductId  = new Map(products.map(p => [p.id, p.categoryId]));
  const printerByCategory = new Map(categories.map(c => [c.id, c.printerId]));
  const printerById     = new Map(printers.map(p => [p.id, p]));

  // 3. Group items by printer (null = no printer assigned)
  const byPrinter = new Map<number | null, typeof sentItems>();
  for (const item of sentItems) {
    const catId     = catByProductId.get(item.productId ?? 0) ?? null;
    const printerId = catId ? (printerByCategory.get(catId) ?? null) : null;
    if (!byPrinter.has(printerId)) byPrinter.set(printerId, []);
    byPrinter.get(printerId)!.push(item);
  }

  // 4. Determine phase label
  const phaseLabels = ["F1", "F2", "F3", "F4"];
  const phase = (() => {
    const phases = new Set(sentItems.map(i => (i as unknown as { phase?: number }).phase ?? 0));
    const first  = phases.values().next().value as number;
    return phaseLabels[first] ?? "F1";
  })();

  // 5. Table label
  const tableLabel = order.tableLabel ?? `Tavolo ${order.tableId ?? id}`;

  // 6. Send to each printer
  const printResults: { printerId: number | null; printerName: string; items: number; ok: boolean; error?: string }[] = [];

  for (const [printerId, items] of byPrinter) {
    const printer = printerId ? printerById.get(printerId) : null;
    const printerName = printer?.name ?? "(nessuna stampante)";
    const lineItems = items.map(i => ({ productName: i.productName, quantity: i.quantity, notes: (i as unknown as { notes?: string }).notes }));

    if (!printer) {
      console.log(`[COMANDA][No-printer] ${tableLabel} — Fase ${phase}: ${lineItems.map(li => `${li.quantity}× ${li.productName}`).join(", ")}`);
      printResults.push({ printerId: null, printerName, items: items.length, ok: true });
      continue;
    }

    const data = escposComanda(tableLabel, lineItems, phase);
    try {
      await sendToPrinter(printer.ip, printer.port, data);
      console.log(`[COMANDA][OK] → ${printer.name} (${printer.ip}:${printer.port}) — ${lineItems.length} articoli`);
      printResults.push({ printerId, printerName, items: items.length, ok: true });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error(`[COMANDA][FAIL] → ${printer.name} (${printer.ip}:${printer.port}): ${errMsg}`);
      printResults.push({ printerId, printerName, items: items.length, ok: false, error: errMsg });
    }
  }

  res.json({ success: true, sentItems: sentItems.length, phase, printers: printResults });
});

// Update covers (0 allowed)
router.patch("/:id/covers", async (req, res) => {
  const id = Number(req.params.id);
  const { covers } = req.body as { covers: number };
  if (covers === undefined || covers < 0) return res.status(400).json({ error: "Invalid covers" });
  const [order] = await db.update(ordersTable).set({ covers }).where(eq(ordersTable.id, id)).returning();
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(order);
});

// Void item: mark as deleted and optionally notify department (future: trigger print)
router.post("/:orderId/items/:itemId/void", async (req, res) => {
  const orderId = Number(req.params.orderId);
  const itemId = Number(req.params.itemId);
  const [item] = await db.select().from(orderItemsTable).where(
    and(eq(orderItemsTable.id, itemId), eq(orderItemsTable.orderId, orderId))
  );
  if (!item) return res.status(404).json({ error: "Item not found" });
  // TODO: trigger void print to department printer
  console.log(`[VOID] Articolo annullato: ${item.productName} (qty: ${item.quantity}) — ordine ${orderId}`);
  res.json({ success: true, voidedItem: item });
});

export default router;
