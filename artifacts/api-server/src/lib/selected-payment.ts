import { db, ordersTable, orderItemsTable, paymentsTable, tablesTable, fiscalReceiptsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { cents, effectiveCoverPrice, money } from "./billing";
import { selectedBill, selectedFiscalDocument } from "./selected-bill";
import { getSettings } from "./settings";
import { getFiscalPrinter, emettiFiscalReceipt, reserveFiscalReceipt } from "./fiscal-printer";

export class SelectedPaymentError extends Error {
  public status: number;
  constructor(message: string, status = 409) { super(message); this.status = status; }
}

type Input = {
  orderId: number; amount: string; method: string; operationId?: string;
  selectedItems?: unknown; itemIds?: unknown; coversCount?: unknown;
};

type Snapshot = { method: string; amount: string; selectedItems: { itemId: number; quantity: number }[]; coversCount: number };
function signature(value: Snapshot) {
  return JSON.stringify([value.method, cents(value.amount), [...value.selectedItems].sort((a, b) => a.itemId - b.itemId), value.coversCount]);
}

async function existingAttempt(source: Pick<typeof db, "select">, orderId: number) {
  const attempts = await source.select().from(fiscalReceiptsTable).where(eq(fiscalReceiptsTable.orderId, orderId));
  for (const receipt of attempts.sort((a, b) => b.id - a.id)) {
    if (!receipt.operationId) continue;
    const [payment] = await source.select().from(paymentsTable).where(eq(paymentsTable.operationId, receipt.operationId));
    if (!payment) return receipt;
  }
  return null;
}

export async function assertNoPendingSelectedPayment(orderId: number) {
  if (await existingAttempt(db, orderId)) {
    throw new SelectedPaymentError("Questo conto ha un tentativo separato da completare o verificare. Ripristina la selezione originale: non effettuare un altro incasso.");
  }
}

function matchingAttempt(receipt: typeof fiscalReceiptsTable.$inferSelect, snapshot: Snapshot) {
  let saved: Snapshot;
  try { saved = JSON.parse(receipt.paymentSnapshot ?? "null"); }
  catch { throw new SelectedPaymentError("Tentativo fiscale da verificare nell’archivio: nessuna nuova stampa consentita"); }
  if (!saved || signature(saved) !== signature(snapshot)) {
    throw new SelectedPaymentError(`Esiste un tentativo fiscale da verificare di €${receipt.importo}. Ripristina la selezione originale; non effettuare un altro incasso.`);
  }
}

export async function previewSelectedPayment(input: Omit<Input, "method"> & { method?: string }) {
  if (input.operationId) {
    const [prior] = await db.select().from(paymentsTable).where(eq(paymentsTable.operationId, input.operationId));
    if (prior && prior.orderId === input.orderId && prior.method === input.method && cents(prior.amount) === cents(input.amount)) {
      return { amount: prior.amount, resume: true, operationId: input.operationId };
    }
  }
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, input.orderId));
  if (!order || order.status !== "open") throw new SelectedPaymentError("Ordine non aperto");
  if (cents(order.paidRomana) > 0) throw new SelectedPaymentError("Sono già state pagate quote alla romana: usa il saldo residuo, senza addebitare nuovamente i prodotti");
  const rows = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, input.orderId));
  const settings = await getSettings();
  const bill = selectedBill(rows, input, order.covers, effectiveCoverPrice(order, settings));
  const attempt = await existingAttempt(db, input.orderId);
  if (attempt) {
    matchingAttempt(attempt, {
      method: input.method ?? "", amount: bill.amount,
      selectedItems: bill.selected.map(row => ({ itemId: row.id, quantity: row.quantity })), coversCount: bill.coversCount,
    });
    // Resume bookkeeping only. Never send an approved card payment to the POS again.
    return { amount: bill.amount, resume: true, operationId: attempt.operationId! };
  }
  return { amount: bill.amount, resume: false, operationId: input.operationId };
}

/** One selected quantity drives amount, RT lines and the remaining order, for every payment method. */
export async function paySelectedBill(input: Input, lotteria?: string) {
  if (!input.operationId || !/^split-[A-Za-z0-9:_-]{8,114}$/.test(input.operationId)) {
    throw new SelectedPaymentError("Aggiorna la cassa e ripeti la selezione: identificativo del pagamento mancante");
  }
  let operationId = input.operationId;
  const settings = await getSettings();
  const printer = await getFiscalPrinter();
  const prepared = await db.transaction(async tx => {
    // Reserve a durable attempt, then release the DB connection before talking to the RT.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(71824, ${input.orderId})`);
    const [prior] = await tx.select().from(paymentsTable).where(eq(paymentsTable.operationId, operationId));
    if (prior) {
      if (prior.orderId !== input.orderId || prior.method !== input.method || cents(prior.amount) !== cents(input.amount)) {
        throw new SelectedPaymentError("Identificativo già usato per un altro pagamento");
      }
      const [savedOrder] = await tx.select().from(ordersTable).where(eq(ordersTable.id, input.orderId));
      return { already: { ...prior, selectionApplied: true, orderClosed: savedOrder?.status === "paid", fiscal: { rtOk: true, alreadyRecorded: true } }, plan: null };
    }
    const [order] = await tx.select().from(ordersTable).where(eq(ordersTable.id, input.orderId)).for("update");
    if (!order || order.status !== "open") throw new SelectedPaymentError("Ordine non aperto");
    if (cents(order.paidRomana) > 0) throw new SelectedPaymentError("Usa il saldo della romana: alcune quote sono già state pagate");
    const rows = await tx.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, input.orderId)).for("update");
    const bill = selectedBill(rows, input, order.covers, effectiveCoverPrice(order, settings));
    const snapshot: Snapshot = {
      method: input.method, amount: bill.amount, coversCount: bill.coversCount,
      selectedItems: bill.selected.map(row => ({ itemId: row.id, quantity: row.quantity })),
    };
    let receipt = await existingAttempt(tx, input.orderId);
    if (receipt) {
      matchingAttempt(receipt, snapshot);
      operationId = receipt.operationId!;
      if (!["confirmed", "issued"].includes(receipt.emissionStatus)) {
        throw new SelectedPaymentError(`Esito RT da verificare nell’archivio (registrazione interna ${receipt.id}). Nessuna nuova stampa o richiesta al POS è stata inviata. Non ripetere l’incasso senza riconciliare il documento.`);
      }
    }
    if (!printer && !receipt) throw new SelectedPaymentError("Nessuna stampante fiscale configurata: pagamento non registrato", 503);
    const aliquotaIva = settings[`iva_${order.modalita}`] ?? settings.iva_tavolo ?? "10";
    const document = selectedFiscalDocument(bill, input.method, effectiveCoverPrice(order, settings), aliquotaIva);
    const mustEmit = !receipt;
    receipt ??= await reserveFiscalReceipt({
      ...document, orderId: input.orderId, printer,
      operationId, paymentSnapshot: JSON.stringify(snapshot),
    }, tx);
    return { already: null, plan: { receipt, document, mustEmit } };
  });
  if (prepared.already) return prepared.already;
  if (!prepared.plan) throw new SelectedPaymentError("Tentativo non disponibile");
  let { receipt } = prepared.plan;
  if (prepared.plan.mustEmit) {
    const emitted = await emettiFiscalReceipt({
      ...prepared.plan.document, orderId: input.orderId, lotteria, printer, receiptId: receipt.id,
    });
    receipt = emitted.receipt;
    if (!emitted.rt.ok || !["confirmed", "issued"].includes(receipt.emissionStatus)) {
      throw new SelectedPaymentError(
        `Esito RT non verificabile (registrazione interna ${receipt.id}). Il tentativo è conservato e non verrà ristampato. Se il POS ha già addebitato, non ripetere il pagamento: verifica il documento sulla RT.`,
        409,
      );
    }
  }
  // A retry after a lost HTTP response/DB commit comes here without another RT command.
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(71824, ${input.orderId})`);
    const [prior] = await tx.select().from(paymentsTable).where(eq(paymentsTable.operationId, operationId));
    if (prior) {
      const [saved] = await tx.select().from(ordersTable).where(eq(ordersTable.id, input.orderId));
      return { ...prior, selectionApplied: true, orderClosed: saved?.status === "paid", fiscal: { rtOk: true, alreadyRecorded: true } };
    }
    const [order] = await tx.select().from(ordersTable).where(eq(ordersTable.id, input.orderId)).for("update");
    if (!order || order.status !== "open") throw new SelectedPaymentError("Documento già emesso: riconcilia l’ordine, senza stampare di nuovo");
    if (cents(order.paidRomana) > 0) throw new SelectedPaymentError("Documento già emesso: il conto è cambiato durante l’incasso. Riconcilia le quote senza ristampare.");
    const rows = await tx.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, input.orderId)).for("update");
    const bill = selectedBill(rows, input, order.covers, effectiveCoverPrice(order, settings));
    matchingAttempt(receipt, {
      method: input.method, amount: bill.amount, coversCount: bill.coversCount,
      selectedItems: bill.selected.map(row => ({ itemId: row.id, quantity: row.quantity })),
    });
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
      fiscal: {
        rtOk: true, receiptId: receipt.id, rtIp: printer?.ip,
        identityPending: receipt.emissionStatus === "issued",
        numeroChiusura: receipt.numeroChiusura, numeroDocumentoRt: receipt.numeroDocumentoRt,
      },
    };
  }).catch(error => {
    if (error instanceof SelectedPaymentError) throw error;
    const failure = new SelectedPaymentError("Documento RT già emesso: registrazione da recuperare. Riapri la stessa selezione e usa «Verifica esito», senza ripetere l’addebito o la stampa.");
    failure.cause = error;
    throw failure;
  });
}
