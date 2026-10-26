import { db, ordersTable, orderItemsTable, paymentsTable, tablesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { cents, effectiveCoverPrice, money } from "./billing";
import { selectedBill, selectedFiscalDocument } from "./selected-bill";
import { getSettings } from "./settings";
import { getFiscalPrinter, emettiFiscalReceipt } from "./fiscal-printer";

export class SelectedPaymentError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

type Input = {
  orderId: number; amount: string; method: string; operationId?: string;
  selectedItems?: unknown; itemIds?: unknown; coversCount?: unknown;
};

export async function previewSelectedPayment(input: Omit<Input, "method">) {
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, input.orderId));
  if (!order || order.status !== "open") throw new SelectedPaymentError("Ordine non aperto");
  if (cents(order.paidRomana) > 0) throw new SelectedPaymentError("Sono già state pagate quote alla romana: usa il saldo residuo, senza addebitare nuovamente i prodotti");
  const rows = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, input.orderId));
  const settings = await getSettings();
  return selectedBill(rows, input, order.covers, effectiveCoverPrice(order, settings));
}

/** One selected quantity drives amount, RT lines and the remaining order, for every payment method. */
export async function paySelectedBill(input: Input, lotteria?: string) {
  if (!input.operationId || !/^split-[A-Za-z0-9:_-]{8,114}$/.test(input.operationId)) {
    throw new SelectedPaymentError("Aggiorna la cassa e ripeti la selezione: identificativo del pagamento mancante");
  }
  const operationId = input.operationId;
  const settings = await getSettings();
  return db.transaction(async tx => {
    // Serialize retries on the same order; hold the rows until the fiscal result is known.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(71824, ${input.orderId})`);
    const [prior] = await tx.select().from(paymentsTable).where(eq(paymentsTable.operationId, operationId));
    if (prior) {
      if (prior.orderId !== input.orderId || prior.method !== input.method || cents(prior.amount) !== cents(input.amount)) {
        throw new SelectedPaymentError("Identificativo già usato per un altro pagamento");
      }
      return { ...prior, selectionApplied: true, fiscal: { rtOk: true, alreadyRecorded: true } };
    }
    const [order] = await tx.select().from(ordersTable).where(eq(ordersTable.id, input.orderId)).for("update");
    if (!order || order.status !== "open") throw new SelectedPaymentError("Ordine non aperto");
    if (cents(order.paidRomana) > 0) throw new SelectedPaymentError("Usa il saldo della romana: alcune quote sono già state pagate");
    const rows = await tx.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, input.orderId)).for("update");
    const bill = selectedBill(rows, input, order.covers, effectiveCoverPrice(order, settings));
    const printer = await getFiscalPrinter();
    if (!printer) throw new SelectedPaymentError("Nessuna stampante fiscale configurata: pagamento non registrato", 503);
    const aliquotaIva = settings[`iva_${order.modalita}`] ?? settings.iva_tavolo ?? "10";
    const document = selectedFiscalDocument(bill, input.method, effectiveCoverPrice(order, settings), aliquotaIva);
    const { receipt, rt } = await emettiFiscalReceipt({
      ...document, orderId: input.orderId, lotteria, printer,
    });
    if (!rt.ok || receipt.emissionStatus !== "confirmed") {
      throw new SelectedPaymentError(
        `Emissione fiscale non confermata: ${rt.error ?? "controlla la stampante"}. Il conto non è stato scalato. Se il POS ha già addebitato, verifica il pagamento e la RT prima di riprovare.`,
        502,
      );
    }
    for (const chosen of bill.selected) {
      const remaining = bill.remaining.find(row => row.id === chosen.id);
      if (remaining) await tx.update(orderItemsTable).set({
        quantity: remaining.quantity, subtotal: money(cents(remaining.unitPrice) * remaining.quantity),
      }).where(eq(orderItemsTable.id, chosen.id));
      else await tx.delete(orderItemsTable).where(eq(orderItemsTable.id, chosen.id));
    }
    const previousPayments = bill.closed
      ? await tx.select().from(paymentsTable).where(eq(paymentsTable.orderId, input.orderId)) : [];
    const paidSelectedCents = previousPayments.filter(row => row.operationId?.startsWith("split-"))
      .reduce((sum, row) => sum + cents(row.amount), 0);
    await tx.update(ordersTable).set({
      // Once closed, preserve the full recorded sale for revenue reports, not a zero residual.
      total: bill.closed ? money(paidSelectedCents + cents(bill.amount)) : money(bill.remainingItemsCents),
      covers: bill.remainingCovers, status: bill.closed ? "paid" : "open",
    }).where(eq(ordersTable.id, input.orderId));
    const [payment] = await tx.insert(paymentsTable).values({
      orderId: input.orderId, method: input.method, amount: bill.amount, change: "0.00", operationId,
    }).returning();
    if (bill.closed && order.tableId) await tx.execute(sql`
      UPDATE ${tablesTable} SET status = 'free'
      WHERE id = ${order.tableId}
      AND NOT EXISTS (SELECT 1 FROM orders WHERE table_id = ${order.tableId} AND status = 'open')
    `);
    return {
      ...payment, selectionApplied: true, orderClosed: bill.closed,
      fiscal: { rtOk: true, receiptId: receipt.id, rtIp: printer.ip },
    };
  });
}
