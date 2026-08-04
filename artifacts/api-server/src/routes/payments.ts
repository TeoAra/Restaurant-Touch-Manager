import { Router } from "express";
import { db, paymentsTable, ordersTable, orderItemsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { CreatePaymentBody, GetPaymentParams } from "@workspace/api-zod";
import { getFiscalPrinter, emettiFiscalReceipt, emettiDocumentoNonFiscale } from "../lib/fiscal-printer";
import { getSettings } from "../lib/settings";
import { logAudit } from "../lib/audit";
import { createInvoiceRecord, emitInvoice, type CreateInvoiceInput } from "../lib/invoice-service";

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

router.post("/", async (req, res) => {
  const lotteria: string | undefined = req.body?.lotteria; // letto PRIMA del parse (Zod striperebbe)
  const body = CreatePaymentBody.parse(req.body);

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

  // ── Dati fattura (opzionali, letti PRIMA del parse Zod) ──────────────────
  // Se presenti, la fattura viene creata NELLA STESSA transazione del
  // pagamento: così non può andare persa se il client si blocca dopo il
  // pagamento (il vecchio flusso a due chiamate separate lo permetteva).
  const invoiceInput: CreateInvoiceInput | undefined =
    req.body?.invoice && Number(req.body.invoice.customerId) > 0
      ? (req.body.invoice as CreateInvoiceInput)
      : undefined;

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
  const coverPriceForDue = settingsForDue ? parseFloat(settingsForDue["cover_price"] ?? "0") : 0;

  // ── Atomico: INSERT pagamento + UPDATE ordine (status=paid) in una sola
  // transazione. Evita lo stato incoerente in cui un pagamento risulta inserito
  // ma l'ordine non viene chiuso (o viceversa) se il processo crasha tra le due
  // query. La chiamata di rete alla RT resta FUORI dalla transaction (lenta).
  const { payment, order, isSplitWithRemainder, invoice, invoiceNumeroFallback } = await db.transaction(async (tx) => {
    const [pay] = await tx.insert(paymentsTable).values({
      orderId: body.orderId,
      method: body.method,
      amount: body.amount,
      change: body.change ?? null,
    }).returning();

    // ── Determina se restano item/coperti da pagare DOPO questo split ────
    // Approccio robusto a split sequenziali con DELETE lato client:
    // calcoliamo il residuo dagli ARTICOLI E COPERTI rimanenti dopo questo
    // pagamento, NON da SUM(payments) (che divergerebbe quando il client
    // elimina gli item pagati e abbassa orders.total).
    let remainder = false;
    if (isPartialPayment) {
      const [orderRow] = await tx.select({ covers: ordersTable.covers })
        .from(ordersTable).where(eq(ordersTable.id, body.orderId)).limit(1);
      const allItemsTx = await tx.select({ id: orderItemsTable.id, subtotal: orderItemsTable.subtotal })
        .from(orderItemsTable).where(eq(orderItemsTable.orderId, body.orderId));
      const paidIds = new Set(splitItemIdsPre ?? []);
      const itemsResidui = allItemsTx.filter(i => !paidIds.has(i.id));
      const totaleItemsResidui = itemsResidui.reduce((s, i) => s + parseFloat(i.subtotal ?? "0"), 0);
      const coversResidui = Math.max(0, (orderRow?.covers ?? 0) - coversCountPre);
      const totaleCopertiResidui = coversResidui * coverPriceForDue;
      const totaleResiduo = totaleItemsResidui + totaleCopertiResidui;
      // Tolleranza 1 cent per arrotondamenti
      remainder = totaleResiduo > 0.01;
    }

    // Mark order as paid only when fully paid (not a partial split)
    const [ord] = remainder
      ? await tx.select().from(ordersTable).where(eq(ordersTable.id, body.orderId)).limit(1)
      : await tx.update(ordersTable).set({ status: "paid" }).where(eq(ordersTable.id, body.orderId)).returning();

    // ── Fattura nella STESSA transazione del pagamento ────────────────────
    // Se l'insert fattura fallisce, fallisce anche il pagamento: mai lo stato
    // "pagato ma senza fattura". Numero manuale già usato → fallback automatico
    // (gestito da createInvoiceRecord) invece di perdere la fattura.
    let inv: Awaited<ReturnType<typeof createInvoiceRecord>>["invoice"] | undefined;
    let invNumFallback = false;
    if (invoiceInput) {
      const created = await createInvoiceRecord(tx, { ...invoiceInput, orderId: invoiceInput.orderId ?? body.orderId });
      inv = created.invoice;
      invNumFallback = created.numeroFallback;
    }

    return { payment: pay, order: ord, isSplitWithRemainder: remainder, invoice: inv, invoiceNumeroFallback: invNumFallback };
  });

  // Free the table only when the order is fully paid (atomico)
  if (!isSplitWithRemainder && order?.tableId) {
    await freeTableIfEmpty(order.tableId);
  }

  // ── Emissione fattura (XML + stampa cortesia RT) FUORI transazione ───────
  // La fattura è già salvata (bozza): anche se XML/RT falliscono resta
  // recuperabile da Backoffice → Fatture (GET /:id/xml la genera on-demand).
  let invoiceResult:
    | { id: number; numero: number; anno: number; xml?: string; fileName?: string; rtOk?: boolean; rtError?: string; emitError?: string; numeroFallback?: boolean }
    | undefined;
  if (invoice) {
    try {
      const emitted = await emitInvoice(invoice);
      invoiceResult = {
        id: invoice.id,
        numero: invoice.numero,
        anno: invoice.anno,
        xml: emitted.xml,
        fileName: emitted.fileName,
        rtOk: emitted.rtOk,
        rtError: emitted.rtError,
        numeroFallback: invoiceNumeroFallback || undefined,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[INVOICE] Emissione fallita per fattura ${invoice.numero}/${invoice.anno}: ${msg}`);
      invoiceResult = {
        id: invoice.id,
        numero: invoice.numero,
        anno: invoice.anno,
        emitError: msg,
        numeroFallback: invoiceNumeroFallback || undefined,
      };
    }
  }

  // Audit
  void logAudit({
    req,
    action: "payment.create",
    entityType: "order",
    entityId: body.orderId,
    details: { amount: body.amount, method: body.method, isSplit: isPartialPayment, isSplitWithRemainder, coversCount: coversCountPre, invoiceId: invoice?.id },
  });

  // ── Emetti documento sulla RT (fiscale o non-fiscale) ────────────────────
  const nonFiscale = req.body?.nonFiscale === true; // documento gestionale → scontrino non fiscale
  const ragioneSocialeCliente: string | undefined = req.body?.ragioneSocialeCliente;
  const splitItemIds: number[] | undefined = Array.isArray(req.body?.itemIds) && req.body.itemIds.length > 0
    ? (req.body.itemIds as number[])
    : undefined;
  let fiscalResult: { receiptId?: number; rtOk?: boolean; rtError?: string; rtIp?: string; rtBody?: string; nonFiscale?: boolean } = {};
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
    const coverPrice = parseFloat(settings["cover_price"] ?? "0");
    const coverQty = isPartialPayment ? coversCountPre : orderCovers;
    const hasCover = coverQty > 0 && coverPrice > 0;

    if (!printer) {
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

  res.status(201).json({ ...payment, fiscal: fiscalResult, invoice: invoiceResult });
});

router.get("/:id", async (req, res) => {
  const { id } = GetPaymentParams.parse({ id: Number(req.params.id) });
  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, id));
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  return res.json(payment);
});

export default router;
