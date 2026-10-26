import { Router } from "express";
import { db, paymentsTable, ordersTable, orderItemsTable, invoicesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { CreatePaymentBody, GetPaymentParams } from "@workspace/api-zod";
import { getFiscalPrinter, emettiFiscalReceipt, emettiDocumentoNonFiscale } from "../lib/fiscal-printer";
import { getSettings } from "../lib/settings";
import { logAudit } from "../lib/audit";
import { cents, money, effectiveCoverPrice, normalizeLottery } from "../lib/billing";
import { paySelectedBill, previewSelectedPayment, SelectedPaymentError } from "../lib/selected-payment";

const router = Router();

// ── Helper: libera tavolo se non ci sono altri ordini aperti (ATOMICO) ──────
async function freeTableIfEmpty(tableId: number) {
  await db.execute(sql`
    UPDATE tables SET status = 'free'
    WHERE id = ${tableId}
      AND NOT EXISTS (SELECT 1 FROM orders WHERE table_id = ${tableId} AND status = 'open')
  `);
}

router.get("/", async (req, res) => {
  const payments = await db.select().from(paymentsTable).orderBy(paymentsTable.createdAt);
  res.json(payments.reverse());
});

router.post("/selection-preview", async (req, res) => {
  if (!Number.isInteger(req.body?.orderId) || req.body.orderId < 1) return res.status(400).json({ error: "Ordine non valido" });
  try {
    const bill = await previewSelectedPayment(req.body);
    return res.json({ amount: bill.amount });
  } catch (error) {
    return res.status(error instanceof SelectedPaymentError ? error.status : 409).json({ error: (error as Error).message });
  }
});

router.post("/", async (req, res) => {
  let lotteria: string | undefined;
  try { lotteria = normalizeLottery(req.body?.lotteria); }
  catch (error) { return res.status(400).json({ error: (error as Error).message }); }
  const parsed = CreatePaymentBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dati del pagamento non validi", details: parsed.error.issues });
  const body = parsed.data;
  if (req.body?.selectedItems !== undefined || req.body?.itemIds !== undefined || req.body?.partial === true || req.body?.coversCount > 0) {
    if (req.body?.invoiceId || req.body?.nonFiscale) return res.status(400).json({ error: "Il conto separato si conclude con il documento fiscale delle sole voci selezionate" });
    try {
      const payment = await paySelectedBill({ ...body, selectedItems: req.body.selectedItems, itemIds: req.body.itemIds, coversCount: req.body.coversCount }, lotteria);
      void logAudit({ req, action: "payment.create", entityType: "order", entityId: body.orderId, details: { amount: body.amount, method: body.method, isSplit: true, selectedItems: req.body.selectedItems, coversCount: req.body.coversCount ?? 0 } });
      return res.status(201).json(payment);
    } catch (error) {
      req.log.warn({ err: error, orderId: body.orderId }, "Selected payment not completed");
      return res.status(error instanceof SelectedPaymentError ? error.status : 409).json({ error: (error as Error).message });
    }
  }
  const invoiceId = req.body.invoiceId;
  if (invoiceId !== undefined) {
    if (!Number.isInteger(invoiceId) || invoiceId < 1) return res.status(400).json({ error: "Fattura non valida" });
    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
    if (!invoice || invoice.orderId !== body.orderId || invoice.stato === "annullata" ||
      Number(body.amount) !== Number(invoice.totale) || req.body.partial) {
      return res.status(409).json({ error: "Il pagamento non corrisponde alla fattura salvata" });
    }
    const [prior] = await db.select().from(paymentsTable).where(eq(paymentsTable.operationId, `invoice-${invoiceId}`));
    if (prior) return res.json({ ...prior, fiscal: { rtOk: true, nonFiscale: true, deferredInvoice: true } });
  }

  // ── Conto separato (split bill): rilevamento del pagamento parziale ──────
  // Tre segnali (basta uno per considerarlo parziale):
  //  1) `itemIds`: lista di articoli selezionati per questo conto separato
  //  2) `coversCount`: numero di coperti pagati separatamente (riga PLU singola
  //     sulla RT, senza chiudere l'ordine)
  //  3) `partial`: flag esplicito dal client
  // Senza questa rilevazione, un conto separato di SOLI coperti chiuderebbe
  // erroneamente l'ordine completo (regressione: tutto messo in conto).
  const splitItemIdsPre: number[] | undefined = Array.isArray(req.body?.itemIds) && req.body.itemIds.length > 0
    ? (req.body.itemIds as number[])
    : undefined;
  const coversCountPre: number = Number.isFinite(Number(req.body?.coversCount))
    ? Math.max(0, Math.trunc(Number(req.body.coversCount)))
    : 0;
  const partialFlag: boolean = req.body?.partial === true;
  const isPartialPayment = !!splitItemIdsPre || coversCountPre > 0 || partialFlag;

  // ── Validazione server-side: coversCount <= coperti correnti dell'ordine ──
  if (coversCountPre > 0) {
    const [ordCheck] = await db.select({ covers: ordersTable.covers })
      .from(ordersTable).where(eq(ordersTable.id, body.orderId)).limit(1);
    const orderCoversNow = ordCheck?.covers ?? 0;
    if (coversCountPre > orderCoversNow) {
      res.status(400).json({ error: `coversCount (${coversCountPre}) supera i coperti dell'ordine (${orderCoversNow})` });
      return;
    }
  }

  // ── Costo coperti (per calcolo del dovuto totale, vedi sotto) ────────────
  // ATTENZIONE: orders.total contiene SOLO la somma degli item (recalcOrderTotal),
  // i coperti sono fuori. Per stabilire se un pagamento split chiude l'ordine
  // dobbiamo includere anche il costo dei coperti residui.
  const settingsForDue = isPartialPayment ? await getSettings() : null;

  // ── Atomico: INSERT pagamento + UPDATE ordine (status=paid) in una sola
  // transazione. Evita lo stato incoerente in cui un pagamento risulta inserito
  // ma l'ordine non viene chiuso (o viceversa) se il processo crasha tra le due
  // query. La chiamata di rete alla RT resta FUORI dalla transaction (lenta).
  const { payment, order, isSplitWithRemainder } = await db.transaction(async (tx) => {
    const [pay] = await tx.insert(paymentsTable).values({
      orderId: body.orderId,
      method: body.method,
      amount: body.amount,
      change: body.change ?? null,
      operationId: invoiceId ? `invoice-${invoiceId}` : null,
    }).returning();

    // ── Determina se restano item/coperti da pagare DOPO questo split ────
    // Approccio robusto a split sequenziali con DELETE lato client:
    // calcoliamo il residuo dagli ARTICOLI E COPERTI rimanenti dopo questo
    // pagamento, NON da SUM(payments) (che divergerebbe quando il client
    // elimina gli item pagati e abbassa orders.total).
    let remainder = false;
    if (isPartialPayment) {
      const [orderRow] = await tx.select({ covers: ordersTable.covers, coverPrice: ordersTable.coverPrice })
        .from(ordersTable).where(eq(ordersTable.id, body.orderId)).limit(1);
      const allItemsTx = await tx.select({ id: orderItemsTable.id, subtotal: orderItemsTable.subtotal })
        .from(orderItemsTable).where(eq(orderItemsTable.orderId, body.orderId));
      const paidIds = new Set(splitItemIdsPre ?? []);
      const itemsResidui = allItemsTx.filter(i => !paidIds.has(i.id));
      const totaleItemsResidui = itemsResidui.reduce((s, i) => s + parseFloat(i.subtotal ?? "0"), 0);
      const coversResidui = Math.max(0, (orderRow?.covers ?? 0) - coversCountPre);
      const totaleCopertiResidui = coversResidui * effectiveCoverPrice(orderRow ?? {}, settingsForDue ?? {}) / 100;
      const totaleResiduo = totaleItemsResidui + totaleCopertiResidui;
      // Tolleranza 1 cent per arrotondamenti
      remainder = totaleResiduo > 0.01;
    }

    // Mark order as paid only when fully paid (not a partial split)
    const splitPayments = await tx.select().from(paymentsTable).where(eq(paymentsTable.orderId, body.orderId));
    const priorSelectedCents = splitPayments.filter(row => row.operationId?.startsWith("split-"))
      .reduce((sum, row) => sum + cents(row.amount), 0);
    const [ord] = remainder
      ? await tx.select().from(ordersTable).where(eq(ordersTable.id, body.orderId)).limit(1)
      : await tx.update(ordersTable).set({
        status: "paid",
        ...(priorSelectedCents > 0 ? { total: money(priorSelectedCents + cents(body.amount) - cents(body.change ?? "0")) } : {}),
      }).where(eq(ordersTable.id, body.orderId)).returning();

    return { payment: pay, order: ord, isSplitWithRemainder: remainder };
  });

  // Free the table only when the order is fully paid (atomico)
  if (!isSplitWithRemainder && order?.tableId) {
    await freeTableIfEmpty(order.tableId);
  }

  // Audit
  void logAudit({
    req,
    action: "payment.create",
    entityType: "order",
    entityId: body.orderId,
    details: { amount: body.amount, method: body.method, isSplit: isPartialPayment, isSplitWithRemainder, coversCount: coversCountPre },
  });

  // ── Emetti documento sulla RT (fiscale o non-fiscale) ────────────────────
  const nonFiscale = req.body?.nonFiscale === true; // documento gestionale → scontrino non fiscale
  const ragioneSocialeCliente: string | undefined = req.body?.ragioneSocialeCliente;
  const splitItemIds: number[] | undefined = Array.isArray(req.body?.itemIds) && req.body.itemIds.length > 0
    ? (req.body.itemIds as number[])
    : undefined;
  let fiscalResult: { receiptId?: number; rtOk?: boolean; rtError?: string; rtIp?: string; rtBody?: string; nonFiscale?: boolean; deferredInvoice?: boolean } = {};
  try {
    const allItems = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, body.orderId));
    // ── Selezione righe RT in base al tipo di pagamento ──────────────────
    // - Conto separato con item: solo gli item selezionati
    // - Conto separato di SOLI coperti: nessun item (solo riga COPERTO)
    // - Pagamento totale: tutti gli item
    const items = splitItemIds
      ? allItems.filter(i => splitItemIds.includes(i.id))
      : (coversCountPre > 0 ? [] : allItems);
    const settings = await getSettings();
    const modalita = (order as never as { modalita?: string }).modalita ?? "tavolo";
    const aliquotaIva = settings[`iva_${modalita}`] ?? settings["iva_tavolo"] ?? "10";
    const printer = await getFiscalPrinter();

    console.log(`[FISCAL] Pagamento ordine ${body.orderId} — stampante: ${printer ? `${printer.name} (${printer.ip})` : "NESSUNA"} — nonFiscale: ${nonFiscale} — partial: ${isPartialPayment} — covers: ${coversCountPre}`);

    // ── Riga coperto ──────────────────────────────────────────────────────
    // - Conto separato: usa coversCountPre (numero coperti pagati ora)
    // - Pagamento totale: usa orderCovers (tutti i coperti dell'ordine)
    const orderCovers = (order as unknown as { covers?: number }).covers ?? 0;
    const coverPrice = effectiveCoverPrice(order, settings) / 100;
    const coverQty = isPartialPayment ? coversCountPre : orderCovers;
    const hasCover = coverQty > 0 && coverPrice > 0;

    if (invoiceId) {
      // The saved invoice emits its own courtesy copy after XML persistence.
      // Never print an unrelated first management receipt for this payment.
      fiscalResult = { rtOk: true, nonFiscale: true, deferredInvoice: true };
    } else if (!printer) {
      console.warn("[FISCAL] Nessuna stampante con is_fiscale=true e active=true trovata in DB");
      fiscalResult = { rtOk: false, rtError: "Nessuna stampante fiscale configurata nel DB" };
    } else if (nonFiscale) {
      // ── Documento non fiscale (gestionale) ──────────────────────────────
      const righe = items.map(i => ({
        desc: i.productName,
        qta: i.quantity,
        prezzoUnitario: i.unitPrice,
      }));
      if (hasCover) righe.unshift({ desc: "COPERTO", qta: coverQty, prezzoUnitario: coverPrice.toFixed(2) });
      const rt = await emettiDocumentoNonFiscale({
        orderId: body.orderId,
        importo: body.amount,
        metodoPagamento: body.method,
        righe,
        ragioneSociale: ragioneSocialeCliente,
        printer,
      });
      console.log(`[NON-FISCAL] RT risposta: ok=${rt.ok} ms=${rt.ms} error=${rt.error ?? "-"}`);
      fiscalResult = { rtOk: rt.ok, rtError: rt.error, rtIp: printer.ip, rtBody: rt.body?.substring(0, 200), nonFiscale: true };
    } else {
      // ── Scontrino fiscale ────────────────────────────────────────────────
      const righe = items.map(i => ({
        desc: i.productName,
        qta: i.quantity,
        prezzoUnitario: i.unitPrice,
        aliquotaIva,
      }));
      if (hasCover) righe.unshift({ desc: "COPERTO", qta: coverQty, prezzoUnitario: coverPrice.toFixed(2), aliquotaIva });

      // ── Calcola l'importo RT dalla somma esatta delle righe ──────────────
      // IMPORTANTE: l'importo del comando di pagamento (1T/3T) DEVE corrispondere
      // alla somma interna che la RT calcola dalle righe inserite (qty×prezzo).
      // Usare body.amount (totale dal POS) causerebbe "operazione non consentita"
      // ogni volta che c'è un disallineamento (coperto, arrotondamenti, split).
      const rtImporto = righe
        .reduce((sum, r) => sum + Math.round(parseFloat(r.prezzoUnitario) * 100) * r.qta, 0);
      const rtImportoStr = (rtImporto / 100).toFixed(2);

      console.log(`[FISCAL] Invio RT: ${printer.ip} — ${righe.length} righe — IVA ${aliquotaIva}% — totale righe ${rtImportoStr} (body.amount=${body.amount})`);

      const { receipt, rt } = await emettiFiscalReceipt({
        orderId: body.orderId,
        importo: rtImportoStr,
        metodoPagamento: body.method,
        righe,
        lotteria,
        printer,
      });

      console.log(`[FISCAL] RT risposta: ok=${rt.ok} ms=${rt.ms} rtCode=${rt.rtCode ?? "-"} error=${rt.error ?? "-"}`);
      if (rt.body) console.log(`[FISCAL] RT body: ${rt.body.substring(0, 300)}`);

      fiscalResult = { receiptId: receipt.id, rtOk: rt.ok, rtError: rt.error, rtIp: printer.ip, rtBody: rt.body?.substring(0, 200) };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[FISCAL] Eccezione: ${msg}`);
    fiscalResult = { rtOk: false, rtError: `Errore emissione documento: ${msg}` };
  }

  return res.status(201).json({ ...payment, fiscal: fiscalResult });
});

router.get("/:id", async (req, res) => {
  const { id } = GetPaymentParams.parse({ id: Number(req.params.id) });
  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, id));
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  return res.json(payment);
});

export default router;
