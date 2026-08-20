import { Router } from "express";
import { db, ordersTable, orderItemsTable, tablesTable, roomsTable, productsTable, categoriesTable, printersTable } from "@workspace/db";
import { eq, and, sql, inArray } from "drizzle-orm";
import net from "net";
import { emettiPreconto } from "../lib/fiscal-printer";
import { getSettings } from "../lib/settings";
import { logAudit } from "../lib/audit";
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
  // ── Calcolo in CENTESIMI per evitare errori floating-point ────────────────
  // Il totale è la somma esatta dei subtotal in centesimi. Questo allinea
  // perfettamente con il calcolo che la RT fa internamente sui prezzi unitari.
  const totalCents = items.reduce((sum, item) => {
    const unit = Math.round(parseFloat(item.unitPrice) * 100);
    return sum + unit * item.quantity;
  }, 0);
  const total = (totalCents / 100).toFixed(2);
  await db.update(ordersTable).set({ total }).where(eq(ordersTable.id, orderId));
  return total;
}

// ── Helper: libera tavolo se non ci sono altri ordini aperti (ATOMICO) ──────
// Usa SQL puro per evitare race conditions tra check e update.
async function freeTableIfEmpty(tableId: number, excludeOrderId?: number) {
  await db.execute(sql`
    UPDATE tables SET status = 'free'
    WHERE id = ${tableId}
      AND NOT EXISTS (
        SELECT 1 FROM orders
        WHERE table_id = ${tableId}
          AND status = 'open'
          ${excludeOrderId ? sql`AND id != ${excludeOrderId}` : sql``}
      )
  `);
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
  const bodyAny = req.body as { modalita?: string };
  const modalita = (["tavolo","asporto","delivery","rapida"].includes(bodyAny.modalita ?? ""))
    ? bodyAny.modalita as "tavolo"|"asporto"|"delivery"|"rapida"
    : body.tableId ? "tavolo" : "rapida";
  const [order] = await db.insert(ordersTable).values({
    tableId: body.tableId ?? null,
    notes: body.notes ?? null,
    covers: typeof covers === "number" && covers >= 0 ? covers : 1,
    status: "open",
    total: "0.00",
    modalita,
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
  return res.json({ ...order, tableName: order.tableId ? (tableMap.get(order.tableId) ?? null) : null, items });
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
  if (body.modalita !== undefined) updateData.modalita = body.modalita;

  // Campi extra non in zod schema (sconto, sospeso, mancia, coperti)
  // Validati ad-hoc per evitare di aggiornare colonne non previste
  const raw = req.body as Record<string, unknown>;

  // Helper: parsa valore decimale → "0.00" formato; ritorna null se invalido
  const parseDecimal = (v: unknown, max = 999999): string | null => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > max) return null;
    return n.toFixed(2);
  };

  if (raw.discountType !== undefined) {
    if (raw.discountType !== null && raw.discountType !== "percent" && raw.discountType !== "amount") {
      return res.status(400).json({ error: "discountType deve essere 'percent', 'amount' o null" });
    }
    updateData.discountType = raw.discountType;
  }
  if (raw.discountValue !== undefined) {
    const isPercent = raw.discountType === "percent" || (raw.discountType === undefined && currentOrder.discountType === "percent");
    const dec = parseDecimal(raw.discountValue, isPercent ? 100 : 999999);
    if (dec === null) return res.status(400).json({ error: "discountValue non valido" });
    updateData.discountValue = dec;
  }
  if (raw.discountReason !== undefined) {
    updateData.discountReason = raw.discountReason === null ? null : String(raw.discountReason).slice(0, 200);
  }
  if (raw.mancia !== undefined) {
    const dec = parseDecimal(raw.mancia, 9999);
    if (dec === null) return res.status(400).json({ error: "mancia non valida" });
    updateData.mancia = dec;
  }
  if (raw.sospeso !== undefined)        updateData.sospeso        = !!raw.sospeso;
  if (raw.sospesoNote !== undefined)    updateData.sospesoNote    = raw.sospesoNote === null ? null : String(raw.sospesoNote).slice(0, 500);
  if (raw.sospesoCustomerId !== undefined) {
    if (raw.sospesoCustomerId === null) updateData.sospesoCustomerId = null;
    else {
      const n = Number(raw.sospesoCustomerId);
      if (!Number.isInteger(n) || n <= 0) return res.status(400).json({ error: "sospesoCustomerId non valido" });
      updateData.sospesoCustomerId = n;
    }
  }
  if (raw.covers !== undefined) {
    const n = Number(raw.covers);
    if (!Number.isFinite(n) || n < 0 || n > 999) return res.status(400).json({ error: "covers non valido" });
    updateData.covers = Math.floor(n);
  }

  const [order] = await db.update(ordersTable).set(updateData).where(eq(ordersTable.id, id)).returning();
  if (!order) return res.status(404).json({ error: "Order not found" });

  // Handle table reassignment: free old table, occupy new table (ATOMICO)
  if (body.tableId !== undefined && body.tableId !== currentOrder.tableId) {
    if (currentOrder.tableId) {
      await freeTableIfEmpty(currentOrder.tableId);
    }
    if (body.tableId) {
      await db.update(tablesTable).set({ status: "occupied" }).where(eq(tablesTable.id, body.tableId));
    }
  }

  // When paid/cancelled, free the table atomically if no other open orders
  if ((body.status === "paid" || body.status === "cancelled") && order.tableId) {
    await freeTableIfEmpty(order.tableId);
  }

  const tables = await db.select().from(tablesTable);
  const tableMap = new Map(tables.map(t => [t.id, t.name]));
  return res.json({ ...order, tableName: order.tableId ? (tableMap.get(order.tableId) ?? null) : null });
});

// Delete (cancel) order
router.delete("/:id", async (req, res) => {
  const { id } = DeleteOrderParams.parse({ id: Number(req.params.id) });
  const reason = typeof (req.body as { reason?: unknown })?.reason === "string"
    ? ((req.body as { reason: string }).reason).slice(0, 200)
    : null;
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  const itemCount = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, id)).then(rows => rows.length);
  await db.delete(orderItemsTable).where(eq(orderItemsTable.orderId, id));
  await db.delete(ordersTable).where(eq(ordersTable.id, id));
  // Atomico: libera il tavolo solo se non ci sono altri open
  if (order?.tableId) await freeTableIfEmpty(order.tableId);
  void logAudit({ req, action: "order.cancel", entityType: "order", entityId: id, details: {
    tableId: order?.tableId ?? null,
    total: order?.total ?? null,
    items: itemCount,
    reason,
  } });
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
  return res.status(201).json(item);
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
  if (body.phase !== undefined) updateData.phase = body.phase;
  // modifiers is not in the Zod schema but can be passed directly
  const rawModifiers = (req.body as { modifiers?: string }).modifiers;
  if (rawModifiers !== undefined) updateData.modifiers = rawModifiers;

  const [item] = await db.update(orderItemsTable).set(updateData)
    .where(and(eq(orderItemsTable.id, itemId), eq(orderItemsTable.orderId, orderId)))
    .returning();

  await recalcOrderTotal(orderId);
  return res.json(item);
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


// Converte caratteri accentati italiani in ASCII puro (Codepage 437)
function toAscii(s: string): string {
  return s
    .replace(/[àáâãäå]/gi, "a").replace(/[èéêë]/gi, "e")
    .replace(/[ìíîï]/gi, "i").replace(/[òóôõö]/gi, "o")
    .replace(/[ùúûü]/gi, "u").replace(/[ç]/gi, "c")
    .replace(/[ñ]/gi, "n").replace(/[ý]/gi, "y")
    .replace(/[^A-Za-z0-9 !"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, "?");
}

type ComandaItem = { productName: string; quantity: number; notes?: string | null; modifiers?: string | null };
type PhaseGroup  = { phase: string; items: ComandaItem[] };

function escposComanda(
  tableLabel: string,
  phaseGroups: PhaseGroup[],
  printerName?: string,
  orderId?: number,
  operatorName?: string,
): Buffer {
  const COLS = 42;
  const SEP  = Buffer.from("-".repeat(COLS) + "\n");

  const init      = Buffer.from([ESC, 0x40]);
  const bold_on   = Buffer.from([ESC, 0x45, 0x01]);
  const bold_off  = Buffer.from([ESC, 0x45, 0x00]);
  const dbl_on    = Buffer.from([GS,  0x21, 0x11]);
  const dbl_off   = Buffer.from([GS,  0x21, 0x00]);
  const dbl_h_on  = Buffer.from([GS,  0x21, 0x01]);
  const dbl_h_off = Buffer.from([GS,  0x21, 0x00]);
  const center    = Buffer.from([ESC, 0x61, 0x01]);
  const left      = Buffer.from([ESC, 0x61, 0x00]);
  const cut       = Buffer.from([GS,  0x56, 0x41, 0x03]);
  const lf        = Buffer.from([0x0a]);

  const now = new Date().toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", "");

  // ── Header ──────────────────────────────────────────────────────────────
  const parts: Buffer[] = [
    init,
    SEP,
    center, bold_on,
    Buffer.from(toAscii(printerName ? `Comande ${printerName}` : "COMANDA") + "\n"),
    bold_off,
    SEP,
    left,
    dbl_on, bold_on,
    Buffer.from(toAscii(tableLabel.substring(0, 20)) + "\n"),
    dbl_off, bold_off,
  ];

  if (operatorName) parts.push(Buffer.from(toAscii(operatorName) + "\n"));
  if (orderId)      parts.push(Buffer.from(`Ordine: ${orderId}\n`));

  // ── Fasi — una sezione per fase all'interno della stessa comanda ─────────
  let totalQty = 0;
  for (const { phase, items } of phaseGroups) {
    parts.push(SEP);
    parts.push(center, bold_on, Buffer.from(`*** FASE->${phase} ***\n`), bold_off, left);
    parts.push(SEP);

    for (const item of items) {
      const qty  = String(item.quantity).padStart(2, " ");
      const name = toAscii(item.productName.substring(0, COLS - 4));
      parts.push(dbl_h_on, bold_on, Buffer.from(`${qty} ${name}\n`), bold_off, dbl_h_off);
      totalQty += item.quantity;

      if (item.modifiers) {
        try {
          const mods: Array<{ label: string; type: string }> = JSON.parse(item.modifiers);
          for (const m of mods) {
            const icon  = m.type === "plus" ? "+" : m.type === "minus" ? "-" : "*";
            const label = toAscii(m.label.substring(0, COLS - 6));
            parts.push(Buffer.from(`     ${icon} ${label}\n`));
          }
        } catch { /* ignora JSON malformato */ }
      }

      if (item.notes?.trim()) {
        const note = toAscii(item.notes.trim().substring(0, COLS - 8));
        parts.push(bold_on, Buffer.from(`    ** ${note} **\n`), bold_off);
      }
    }
  }

  // ── Footer ───────────────────────────────────────────────────────────────
  parts.push(
    SEP,
    Buffer.from(`Articoli in ordine # ${totalQty}\n`),
    Buffer.from(`${now}\n`),
    SEP,
    lf, lf,
    cut,
  );

  return Buffer.concat(parts);
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

  // 3. Group items by printer only; within each printer group, keep phase sub-groups sorted
  const phaseLabels = ["F1", "F2", "F3", "F4"];

  type PrinterGroup = { printerId: number | null; phases: Map<string, ComandaItem[]> };
  const byPrinter = new Map<string, PrinterGroup>();

  for (const item of sentItems) {
    const catId      = catByProductId.get(item.productId ?? 0) ?? null;
    const printerId  = catId ? (printerByCategory.get(catId) ?? null) : null;
    const phaseNum   = (item as unknown as { phase?: number }).phase ?? 0;
    const phaseLabel = phaseLabels[phaseNum] ?? "F1";
    const key        = String(printerId ?? "null");
    if (!byPrinter.has(key)) byPrinter.set(key, { printerId, phases: new Map() });
    const pg = byPrinter.get(key)!;
    if (!pg.phases.has(phaseLabel)) pg.phases.set(phaseLabel, []);
    pg.phases.get(phaseLabel)!.push({
      productName: item.productName,
      quantity: item.quantity,
      notes: (item as unknown as { notes?: string | null }).notes,
      modifiers: (item as unknown as { modifiers?: string | null }).modifiers,
    });
  }

  // 4. Table label
  let tableLabel = order.notes ?? `Ordine ${id}`;
  if (order.tableId) {
    const [tableRow] = await db
      .select({ tableName: tablesTable.name })
      .from(tablesTable)
      .where(eq(tablesTable.id, order.tableId));
    if (tableRow) tableLabel = tableRow.tableName;
  }

  // 5. Send ONE comanda per printer (all phases in a single ticket, sorted)
  const printResults: { printerId: number | null; printerName: string; phases: string; items: number; ok: boolean; error?: string }[] = [];

  for (const { printerId, phases } of byPrinter.values()) {
    const printer     = printerId ? printerById.get(printerId) : null;
    const printerName = printer?.name ?? "(nessuna stampante)";

    // Build sorted phase groups
    const phaseGroups: PhaseGroup[] = [...phases.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([phase, items]) => ({ phase, items }));

    const phasesStr  = phaseGroups.map(g => g.phase).join(", ");
    const totalItems = phaseGroups.reduce((s, g) => s + g.items.length, 0);

    if (!printer) {
      for (const { phase, items } of phaseGroups)
        console.log(`[COMANDA][No-printer] ${tableLabel} — Fase ${phase}: ${items.map(i => `${i.quantity}× ${i.productName}`).join(", ")}`);
      printResults.push({ printerId: null, printerName, phases: phasesStr, items: totalItems, ok: true });
      continue;
    }

    const data = escposComanda(tableLabel, phaseGroups, printer.name, order.id);
    try {
      await sendToPrinter(printer.ip, printer.port, data);
      console.log(`[COMANDA][OK] → ${printer.name} (${printer.ip}:${printer.port}) — Fasi ${phasesStr} — ${totalItems} art.`);
      printResults.push({ printerId, printerName, phases: phasesStr, items: totalItems, ok: true });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error(`[COMANDA][FAIL] → ${printer.name} (${printer.ip}:${printer.port}): ${errMsg}`);
      printResults.push({ printerId, printerName, phases: phasesStr, items: totalItems, ok: false, error: errMsg });
    }
  }

  const allPhases = [...new Set([...byPrinter.values()].flatMap(pg => [...pg.phases.keys()]))].sort().join(", ");
  return res.json({ success: true, sentItems: sentItems.length, phases: allPhases, printers: printResults });
});

// Update covers (0 allowed)
router.patch("/:id/covers", async (req, res) => {
  const id = Number(req.params.id);
  const { covers } = req.body as { covers: number };
  if (covers === undefined || covers < 0) return res.status(400).json({ error: "Invalid covers" });
  const [order] = await db.update(ordersTable).set({ covers }).where(eq(ordersTable.id, id)).returning();
  if (!order) return res.status(404).json({ error: "Order not found" });
  return res.json(order);
});

// ── Merge order into another (unificazione conto) ────────────────────────────
router.post("/:id/merge-into/:targetId", async (req, res) => {
  const sourceId = Number(req.params.id);
  const targetId = Number(req.params.targetId);
  if (sourceId === targetId) return res.status(400).json({ error: "Same order" });

  const [source] = await db.select().from(ordersTable).where(eq(ordersTable.id, sourceId));
  const [target] = await db.select().from(ordersTable).where(eq(ordersTable.id, targetId));
  if (!source || !target) return res.status(404).json({ error: "Order not found" });

  // Move all items from source to target
  await db.update(orderItemsTable).set({ orderId: targetId }).where(eq(orderItemsTable.orderId, sourceId));

  // Recalculate target total
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, targetId));
  const newTotal = items.reduce((s, i) => s + parseFloat(i.subtotal ?? "0"), 0).toFixed(2);
  await db.update(ordersTable).set({ total: newTotal }).where(eq(ordersTable.id, targetId));

  // Close source order and free its table (atomico)
  await db.update(ordersTable).set({ status: "paid" }).where(eq(ordersTable.id, sourceId));
  if (source.tableId) await freeTableIfEmpty(source.tableId);

  return res.json({ success: true, targetOrderId: targetId, newTotal });
});

// ── Stampa preconto sulla RT (ordine rimane aperto) ─────────────────────────
router.post("/:id/preconto", async (req, res) => {
  const id = Number(req.params.id);
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (!order) return res.status(404).json({ error: "Ordine non trovato" });
  if (order.status !== "open") return res.status(400).json({ error: "Ordine non aperto" });
  // Marca l'ordine come "preconto stampato" così la mappa tavoli lo evidenzia
  await db.update(ordersTable).set({ prePrintedAt: new Date() }).where(eq(ordersTable.id, id));

  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, id));
  const settings = await getSettings();

  // Tavolo
  let tableName: string | undefined;
  if (order.tableId) {
    const [tbl] = await db.select().from(tablesTable).where(eq(tablesTable.id, order.tableId));
    if (tbl) tableName = tbl.name;
  }

  // Coperti + prezzo coperto
  const covers = order.covers ?? 0;
  const coverPrice = parseFloat(settings["cover_price"] ?? "0");
  const coverTotal = covers > 0 && coverPrice > 0 ? covers * coverPrice : 0;

  // Righe articoli
  const righe = items.map(i => ({
    desc: i.productName,
    qta: parseFloat(i.quantity.toString()),
    prezzoUnitario: i.unitPrice,
  }));

  // Aggiungi riga coperto se presente
  if (coverTotal > 0) {
    righe.push({ desc: "Coperto", qta: covers, prezzoUnitario: coverPrice.toFixed(2) });
  }

  const totale = (parseFloat(order.total) + coverTotal).toFixed(2);
  const ragioneSociale = settings["ragione_sociale"] as string | undefined;

  const rt = await emettiPreconto({ tavolo: tableName, coperti: covers > 0 ? covers : undefined, righe, totale, ragioneSociale });
  req.log.info({ orderId: id, rt: rt.ok }, "[PRECONTO] stampa");

  return res.json({ ok: rt.ok, error: rt.error ?? null, totale });
});

// ── Sposta ordine su altro tavolo ──────────────────────────────────────────
// POST /orders/:id/move-table  body: { tableId }
// Sposta un ordine aperto su un altro tavolo. Il tavolo destinazione deve
// essere libero (status='free') a meno di forceMerge=true (in tal caso accetta
// di mettere un secondo ordine su un tavolo già occupato).
router.post("/:id/move-table", async (req, res) => {
  const id = Number(req.params.id);
  const tableId = Number(req.body?.tableId);
  const forceMerge = !!req.body?.forceMerge;
  if (!Number.isInteger(id) || !Number.isInteger(tableId)) {
    return res.status(400).json({ error: "id e tableId obbligatori" });
  }
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (!order) return res.status(404).json({ error: "Ordine non trovato" });
  if (order.status !== "open") return res.status(400).json({ error: "Solo ordini aperti possono essere spostati" });
  if (order.tableId === tableId) return res.json({ ok: true, order });

  const [target] = await db.select().from(tablesTable).where(eq(tablesTable.id, tableId));
  if (!target) return res.status(404).json({ error: "Tavolo destinazione non trovato" });
  if (target.status === "occupied" && !forceMerge) {
    return res.status(409).json({ error: "Tavolo destinazione occupato. Usa Unisci tavoli per spostare gli articoli." });
  }

  const oldTableId = order.tableId;
  const updated = await db.transaction(async (tx) => {
    const [u] = await tx.update(ordersTable).set({ tableId }).where(eq(ordersTable.id, id)).returning();
    await tx.update(tablesTable).set({ status: "occupied" }).where(eq(tablesTable.id, tableId));
    return u;
  });
  // freeTableIfEmpty è già atomico (UPDATE con NOT EXISTS); fuori transaction è ok
  if (oldTableId && oldTableId !== tableId) await freeTableIfEmpty(oldTableId);

  void logAudit({ req, action: "order.move_table", entityType: "order", entityId: id, details: { from: oldTableId, to: tableId } });
  return res.json({ ok: true, order: updated });
});

// ── Unisci due ordini (merge) ──────────────────────────────────────────────
// POST /orders/:id/merge  body: { sourceOrderId }
// Sposta tutti gli articoli dell'ordine source in :id, ricalcola il totale,
// elimina l'ordine source e libera il suo tavolo se vuoto.
router.post("/:id/merge", async (req, res) => {
  const id = Number(req.params.id);
  const sourceOrderId = Number(req.body?.sourceOrderId);
  if (!Number.isInteger(id) || !Number.isInteger(sourceOrderId) || id === sourceOrderId) {
    return res.status(400).json({ error: "id e sourceOrderId obbligatori e diversi" });
  }
  const [target] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  const [source] = await db.select().from(ordersTable).where(eq(ordersTable.id, sourceOrderId));
  if (!target || !source) return res.status(404).json({ error: "Ordine non trovato" });
  if (target.status !== "open" || source.status !== "open") {
    return res.status(400).json({ error: "Entrambi gli ordini devono essere aperti" });
  }
  // Blocca il merge se l'ordine source ha sconto o mancia: altrimenti li perderemmo
  // silenziosamente nel ricalcolo. Il cameriere deve azzerarli prima del merge.
  const srcDiscount = parseFloat(source.discountValue ?? "0");
  const srcMancia   = parseFloat(source.mancia ?? "0");
  if (srcDiscount > 0 || srcMancia > 0 || source.sospeso) {
    return res.status(409).json({ error: "L'ordine sorgente ha sconto, mancia o è sospeso. Azzerali prima di unire." });
  }

  // Tutto in transazione per evitare incoerenze (items spostati ma source non eliminato)
  const result = await db.transaction(async (tx) => {
    await tx.update(orderItemsTable).set({ orderId: id }).where(eq(orderItemsTable.orderId, sourceOrderId));
    // Ricalcola total dal SUM dei subtotal degli items adesso appartenenti a target
    const sumRow = await tx.execute<{ tot: string | null }>(sql`
      SELECT COALESCE(SUM(subtotal::numeric), 0)::text AS tot
      FROM order_items WHERE order_id = ${id}
    `);
    const itemsTot = parseFloat(sumRow.rows[0]?.tot ?? "0");
    const newTotal = itemsTot.toFixed(2);
    const newCovers = (target.covers ?? 0) + (source.covers ?? 0);
    await tx.update(ordersTable).set({ total: newTotal, covers: newCovers }).where(eq(ordersTable.id, id));
    await tx.delete(ordersTable).where(eq(ordersTable.id, sourceOrderId));
    return { newTotal };
  });
  if (source.tableId) await freeTableIfEmpty(source.tableId);

  void logAudit({ req, action: "order.merge", entityType: "order", entityId: id, details: { from: sourceOrderId, mergedTotal: result.newTotal } });
  return res.json({ ok: true, mergedItems: true, newTotal: result.newTotal });
});

// ── Sposta articoli tra ordini ─────────────────────────────────────────────
// POST /orders/:fromId/items/move  body: { itemIds: number[], toOrderId: number }
// Sposta uno o più articoli da un ordine a un altro (ricalcola totali entrambi).
router.post("/:fromId/items/move", async (req, res) => {
  const fromId = Number(req.params.fromId);
  const toOrderId = Number(req.body?.toOrderId);
  const itemIds: number[] = Array.isArray(req.body?.itemIds) ? req.body.itemIds.map(Number).filter(Number.isInteger) : [];
  if (!Number.isInteger(fromId) || !Number.isInteger(toOrderId) || fromId === toOrderId || itemIds.length === 0) {
    return res.status(400).json({ error: "fromId, toOrderId e itemIds obbligatori" });
  }
  const [from] = await db.select().from(ordersTable).where(eq(ordersTable.id, fromId));
  const [to]   = await db.select().from(ordersTable).where(eq(ordersTable.id, toOrderId));
  if (!from || !to) return res.status(404).json({ error: "Ordine non trovato" });
  if (from.status !== "open" || to.status !== "open") {
    return res.status(400).json({ error: "Entrambi gli ordini devono essere aperti" });
  }

  // Verifica che gli items appartengano davvero a fromId
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, fromId));
  const valid = items.filter(i => itemIds.includes(i.id));
  if (valid.length === 0) return res.status(400).json({ error: "Nessun articolo valido da spostare" });

  const moved = valid.reduce((s, i) => s + parseFloat(i.subtotal), 0);

  // Tutto in transazione: spostamento + ricalcolo totali da SUM dei subtotal
  // (più robusto contro discount/mancia al livello order, evita drift dei totali)
  await db.transaction(async (tx) => {
    await tx.update(orderItemsTable).set({ orderId: toOrderId })
      .where(and(eq(orderItemsTable.orderId, fromId), inArray(orderItemsTable.id, valid.map(i => i.id))));
    for (const oid of [fromId, toOrderId]) {
      const sumRow = await tx.execute<{ tot: string | null }>(sql`
        SELECT COALESCE(SUM(subtotal::numeric), 0)::text AS tot
        FROM order_items WHERE order_id = ${oid}
      `);
      const tot = parseFloat(sumRow.rows[0]?.tot ?? "0").toFixed(2);
      await tx.update(ordersTable).set({ total: tot }).where(eq(ordersTable.id, oid));
    }
  });

  void logAudit({ req, action: "order.move_items", entityType: "order", entityId: fromId, details: { to: toOrderId, count: valid.length, amount: moved.toFixed(2) } });
  return res.json({ ok: true, movedCount: valid.length, movedAmount: moved.toFixed(2) });
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
  return res.json({ success: true, voidedItem: item });
});

export default router;
