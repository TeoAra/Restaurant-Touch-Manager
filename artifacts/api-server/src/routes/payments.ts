import { Router } from "express";
import { db, paymentsTable, ordersTable, orderItemsTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { CreatePaymentBody, GetPaymentParams } from "@workspace/api-zod";
import { getFiscalPrinter, emettiFiscalReceipt, emettiDocumentoNonFiscale } from "../lib/fiscal-printer";
import { getSettings } from "../lib/settings";
import { logAudit } from "../lib/audit";
import { createInvoiceRecord, emitInvoice, type CreateInvoiceInput } from "../lib/invoice-service";
import { captureMarginFacts, enqueueMarginCalculation, processPendingMarginJobs } from "../lib/margin-service";
import { resolveSplitSelection } from "../lib/split-payment.js";
import { isSplitPaymentReplay } from "../lib/split-reservation.js";

const router = Router();

class PaymentRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

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
    ? [...new Set((req.body.itemIds as unknown[]).map(Number).filter(Number.isInteger))]
    : undefined;
  const rawSplitQuantities = req.body?.itemQuantities;
  const splitItemQuantitiesPre: Record<number, number> = {};
  if (rawSplitQuantities != null) {
    if (typeof rawSplitQuantities !== "object" || Array.isArray(rawSplitQuantities)) {
      res.status(400).json({ error: "Le quantità del conto separato non sono valide" });
      return;
    }
    for (const [itemId, value] of Object.entries(rawSplitQuantities as Record<string, unknown>)) {
      const id = Number(itemId);
      const quantity = Number(value);
      if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(quantity) || quantity <= 0) {
        res.status(400).json({ error: "Ogni quantità del conto separato deve essere un intero positivo" });
        return;
      }
      splitItemQuantitiesPre[id] = quantity;
    }
  }
  const coversCountPre: number = Number.isFinite(Number(req.body?.coversCount))
    ? Math.max(0, Math.trunc(Number(req.body.coversCount)))
    : 0;
  const partialFlag: boolean = req.body?.partial === true;
  const isPartialPayment = !!splitItemIdsPre || coversCountPre > 0 || partialFlag;
  if (isPartialPayment && !splitItemIdsPre?.length && coversCountPre === 0) {
    res.status(400).json({ error: "Seleziona almeno un articolo o un coperto per il conto separato" });
    return;
  }
  const splitRequestId = typeof req.body?.splitRequestId === "string" && req.body.splitRequestId.length >= 12 && req.body.splitRequestId.length <= 128
    ? req.body.splitRequestId
    : undefined;
  if (isPartialPayment && !splitRequestId) {
    res.status(400).json({ error: "Identificativo del conto separato mancante" });
    return;
  }

  // ── Dati fattura (opzionali, letti PRIMA del parse Zod) ──────────────────
  // Se presenti, la fattura viene creata NELLA STESSA transazione del
  // pagamento: così non può andare persa se il client si blocca dopo il
  // pagamento (il vecchio flusso a due chiamate separate lo permetteva).
  const invoiceInput: CreateInvoiceInput | undefined =
    req.body?.invoice && Number(req.body.invoice.customerId) > 0
      ? (req.body.invoice as CreateInvoiceInput)
      : undefined;

  // ── Costo coperti (per calcolo del dovuto totale, vedi sotto) ────────────
  // ATTENZIONE: orders.total contiene SOLO la somma degli item (recalcOrderTotal),
  // i coperti sono fuori. Per stabilire se un pagamento split chiude l'ordine
  // dobbiamo includere anche il costo dei coperti residui.
  const settingsForMargin = await getSettings();
  const settingsForDue = isPartialPayment ? settingsForMargin : null;
  const coverPriceForDue = settingsForDue ? parseFloat(settingsForDue["cover_price"] ?? "0") : 0;

  // ── Atomico: riserva split + validazione + pagamento + UPDATE ordine ─────
  // transazione. Evita lo stato incoerente in cui un pagamento risulta inserito
  // ma l'ordine non viene chiuso (o viceversa) se il processo crasha tra le due
  // query. La chiamata di rete alla RT resta FUORI dalla transaction (lenta).
  let paymentTransaction: {
    payment: typeof paymentsTable.$inferSelect;
    order: typeof ordersTable.$inferSelect | undefined;
    isSplitWithRemainder: boolean;
    splitLines: Array<{ id: number; originalQuantity: number; quantity: number; unitPrice: string }>;
    invoice: Awaited<ReturnType<typeof createInvoiceRecord>>["invoice"] | undefined;
    invoiceNumeroFallback: boolean;
    idempotent?: boolean;
  };
  try {
    paymentTransaction = await db.transaction(async (tx) => {
      let retryPayment: typeof paymentsTable.$inferSelect | undefined;
      if (isPartialPayment) {
        const claimed = await tx.execute(sql`
          UPDATE orders
          SET split_payment_state = 'printing', split_payment_token = ${splitRequestId}, split_payment_id = NULL
          WHERE id = ${body.orderId}
            AND status = 'open'
            AND (
              split_payment_state IS NULL
              OR (split_payment_state = 'settled' AND split_payment_token IS DISTINCT FROM ${splitRequestId})
            )
          RETURNING id
        `);
        if (!claimed.rows.length) {
          const [existing] = await tx.select({
            splitPaymentState: ordersTable.splitPaymentState,
            splitPaymentToken: ordersTable.splitPaymentToken,
            splitPaymentId: ordersTable.splitPaymentId,
          }).from(ordersTable).where(eq(ordersTable.id, body.orderId)).limit(1);
          if (isSplitPaymentReplay(existing?.splitPaymentState, existing?.splitPaymentToken, existing?.splitPaymentId, splitRequestId!)) {
            const [previousPayment] = await tx.select().from(paymentsTable).where(eq(paymentsTable.id, existing.splitPaymentId)).limit(1);
            const [existingOrder] = await tx.select().from(ordersTable).where(eq(ordersTable.id, body.orderId)).limit(1);
            if (previousPayment) {
              return { payment: previousPayment, order: existingOrder, isSplitWithRemainder: true, splitLines: [], invoice: undefined, invoiceNumeroFallback: false, idempotent: true };
            }
          }
          if (!retryPayment) throw new PaymentRequestError(409, "Il conto separato richiede una verifica RT: per sicurezza non verrà reinviato automaticamente");
        }
      } else {
        const claimedFull = await tx.execute(sql`
          UPDATE orders
          SET split_payment_state = 'full_printing'
          WHERE id = ${body.orderId}
            AND status = 'open'
            AND (split_payment_state IS NULL OR split_payment_state = 'settled')
          RETURNING id
        `);
        if (!claimedFull.rows.length) {
          throw new PaymentRequestError(409, "L'ordine ha una stampa RT in corso o da verificare");
        }
      }

      let splitSelections = new Map<number, number>();
      let settledSplitLines: Array<{ id: number; originalQuantity: number; quantity: number; unitPrice: string }> = [];
      let remainder = false;
      if (isPartialPayment) {
        const [orderRow] = await tx.select({ covers: ordersTable.covers })
          .from(ordersTable).where(eq(ordersTable.id, body.orderId)).limit(1);
        if (!orderRow || coversCountPre > orderRow.covers) {
          throw new PaymentRequestError(400, "I coperti selezionati non sono più disponibili");
        }
        const allItemsTx = await tx.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, body.orderId));
        let currentSplitSelection;
        try {
          currentSplitSelection = resolveSplitSelection(allItemsTx, splitItemIdsPre ?? [], splitItemQuantitiesPre);
        } catch (error) {
          throw new PaymentRequestError(400, error instanceof Error ? error.message : "Gli articoli del conto separato non sono validi");
        }
        const expectedCents = currentSplitSelection.selectedCents + Math.round(coverPriceForDue * 100) * coversCountPre;
        if (Math.abs(expectedCents - Math.round(parseFloat(body.amount) * 100)) > 1) {
          throw new PaymentRequestError(400, `L'importo selezionato (€ ${(expectedCents / 100).toFixed(2)}) non corrisponde al pagamento richiesto.`);
        }
        splitSelections = new Map(currentSplitSelection.lines.map(line => [line.id, line.quantity]));
        settledSplitLines = currentSplitSelection.lines;
        const coversResidui = Math.max(0, orderRow.covers - coversCountPre);
        remainder = currentSplitSelection.remainingCents / 100 + coversResidui * coverPriceForDue > 0.01;
      }

    const [pay] = retryPayment
      ? [retryPayment]
      : await tx.insert(paymentsTable).values({
        orderId: body.orderId,
        method: body.method,
        amount: body.amount,
        change: body.change ?? null,
      }).returning();

    if (isPartialPayment && !retryPayment) {
      await tx.update(ordersTable).set({ splitPaymentId: pay.id })
        .where(and(eq(ordersTable.id, body.orderId), eq(ordersTable.splitPaymentToken, splitRequestId!)));
    }

    // Mark order as paid only when fully paid (not a partial split)
    const [ord] = isPartialPayment
      ? await tx.select().from(ordersTable).where(eq(ordersTable.id, body.orderId)).limit(1)
      : remainder
      ? await tx.select().from(ordersTable).where(eq(ordersTable.id, body.orderId)).limit(1)
      : await tx.update(ordersTable).set({ status: "paid" }).where(eq(ordersTable.id, body.orderId)).returning();

    if (!isPartialPayment) {
      const modalitaMargin = (ord as { modalita?: string } | undefined)?.modalita ?? "tavolo";
      const coverVatRate = settingsForMargin[`iva_${modalitaMargin}`] ?? settingsForMargin["iva_tavolo"] ?? "10";
      await captureMarginFacts(tx, body.orderId, {
        cover: {
          paymentId: pay.id,
          quantity: ord?.covers ?? 0,
          unitPrice: settingsForMargin["cover_price"] ?? "0",
          vatRate: coverVatRate,
        },
      });
      if (!remainder) await enqueueMarginCalculation(tx, body.orderId);
    }

    // ── Fattura nella STESSA transazione del pagamento ────────────────────
    // Se l'insert fattura fallisce, fallisce anche il pagamento: mai lo stato
    // "pagato ma senza fattura". Numero manuale già usato → fallback automatico
    // (gestito da createInvoiceRecord) invece di perdere la fattura.
    let inv: Awaited<ReturnType<typeof createInvoiceRecord>>["invoice"] | undefined;
    let invNumFallback = false;
    if (invoiceInput && !retryPayment) {
      const created = await createInvoiceRecord(tx, { ...invoiceInput, orderId: invoiceInput.orderId ?? body.orderId });
      inv = created.invoice;
      invNumFallback = created.numeroFallback;
    }

      return {
      payment: pay,
      order: ord,
      isSplitWithRemainder: remainder,
      splitLines: settledSplitLines,
      invoice: inv,
      invoiceNumeroFallback: invNumFallback,
      };
    });
  } catch (error) {
    if (error instanceof PaymentRequestError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
  const { payment, order, isSplitWithRemainder, splitLines, invoice, invoiceNumeroFallback, idempotent } = paymentTransaction;
  if (idempotent) {
    res.status(200).json({ ...payment, fiscal: { rtOk: true, splitSettled: true, idempotent: true } });
    return;
  }

  // Elaborazione best-effort: il job resta in coda anche in caso di errore.
  // Non blocca né modifica l'esito del pagamento.
  void processPendingMarginJobs();

  // Free the table only when the order is fully paid (atomico)
  if (!isSplitWithRemainder && order?.tableId && !isPartialPayment) {
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
  let fiscalResult: { receiptId?: number; rtOk?: boolean; rtError?: string; rtIp?: string; rtBody?: string; nonFiscale?: boolean; splitSettled?: boolean; settlementError?: string } = {};
  try {
    const allItems = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, body.orderId));
    // ── Selezione righe RT in base al tipo di pagamento ──────────────────
    // - Conto separato con item: solo gli item selezionati
    // - Conto separato di SOLI coperti: nessun item (solo riga COPERTO)
    // - Pagamento totale: tutti gli item
    const splitQuantityByItemId = new Map(splitLines.map(line => [line.id, line.quantity]));
    const items = isPartialPayment
      ? allItems.filter(item => splitQuantityByItemId.has(item.id)).map(item => ({
        ...item,
        quantity: splitQuantityByItemId.get(item.id) ?? item.quantity,
        subtotal: ((splitQuantityByItemId.get(item.id) ?? item.quantity) * parseFloat(item.unitPrice)).toFixed(2),
      }))
      : allItems;
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

  if (!fiscalResult.rtOk) {
    // Timeout, errore di rete e risposta non valida sono ambigui: la RT
    // potrebbe avere chiuso lo scontrino. Blocchiamo ogni reinvio finché un
    // operatore non riconcilia manualmente il documento con la stampante.
    await db.update(ordersTable).set({ splitPaymentState: "rt_uncertain" }).where(and(
      eq(ordersTable.id, body.orderId),
      isPartialPayment
        ? eq(ordersTable.splitPaymentToken, splitRequestId!)
        : eq(ordersTable.splitPaymentState, "full_printing"),
      isPartialPayment
        ? eq(ordersTable.splitPaymentState, "printing")
        : eq(ordersTable.splitPaymentState, "full_printing"),
    ));
  }

  if (!isPartialPayment && fiscalResult.rtOk) {
    await db.update(ordersTable).set({ splitPaymentState: "settled" }).where(and(
      eq(ordersTable.id, body.orderId),
      eq(ordersTable.splitPaymentState, "full_printing"),
    ));
  }

  // Dopo una RT confermata, il residuo va aggiornato DAL SERVER. Il vecchio
  // flusso delegava la DELETE al browser: le righe già inviate alla cucina
  // venivano rifiutate e restavano nel conto, pur essendo state fiscalizzate.
  if (isPartialPayment && fiscalResult.rtOk) {
    try {
      await db.transaction(async (tx) => {
        // Lo snapshot va creato prima di ridurre/eliminare le righe: la
        // selezione validata è la fonte contabile, non il carrello residuo.
        const modalitaMargin = order?.modalita ?? "tavolo";
        const coverVatRate = settingsForMargin[`iva_${modalitaMargin}`] ?? settingsForMargin["iva_tavolo"] ?? "10";
        await captureMarginFacts(tx, body.orderId, {
          selectedItemIds: splitLines.map(line => line.id),
          selectedItemQuantities: Object.fromEntries(splitLines.map(line => [line.id, line.quantity])),
          paymentId: payment.id,
          cover: {
            paymentId: payment.id,
            quantity: coversCountPre,
            unitPrice: settingsForMargin["cover_price"] ?? "0",
            vatRate: coverVatRate,
          },
        });
        if (isSplitWithRemainder) {
          for (const line of splitLines) {
            if (line.quantity === line.originalQuantity) {
              const deleted = await tx.delete(orderItemsTable).where(and(
                eq(orderItemsTable.id, line.id),
                eq(orderItemsTable.orderId, body.orderId),
                eq(orderItemsTable.quantity, line.originalQuantity),
              )).returning({ id: orderItemsTable.id });
              if (!deleted.length) throw new Error("Una riga del conto è cambiata durante la stampa");
            } else {
              const remainingQuantity = line.originalQuantity - line.quantity;
              const updated = await tx.update(orderItemsTable).set({
                quantity: remainingQuantity,
                subtotal: (Math.round(parseFloat(line.unitPrice) * 100) * remainingQuantity / 100).toFixed(2),
              }).where(and(
                eq(orderItemsTable.id, line.id),
                eq(orderItemsTable.orderId, body.orderId),
                eq(orderItemsTable.quantity, line.originalQuantity),
              )).returning({ id: orderItemsTable.id });
              if (!updated.length) throw new Error("Una riga del conto è cambiata durante la stampa");
            }
          }
          if (coversCountPre > 0) {
            const [currentOrder] = await tx.select({ covers: ordersTable.covers }).from(ordersTable)
              .where(and(eq(ordersTable.id, body.orderId), eq(ordersTable.status, "open"))).limit(1);
            if (!currentOrder || currentOrder.covers < coversCountPre) throw new Error("I coperti del conto sono cambiati durante la stampa");
            await tx.update(ordersTable).set({ covers: currentOrder.covers - coversCountPre })
              .where(eq(ordersTable.id, body.orderId));
          }
          const remainingItems = await tx.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, body.orderId));
          const totalCents = remainingItems.reduce((total, item) => total + Math.round(parseFloat(item.unitPrice) * 100) * item.quantity, 0);
          await tx.update(ordersTable).set({ total: (totalCents / 100).toFixed(2) })
            .where(and(eq(ordersTable.id, body.orderId), eq(ordersTable.status, "open")));
        }
        if (!isSplitWithRemainder) await enqueueMarginCalculation(tx, body.orderId);
        const settled = await tx.update(ordersTable).set({
          splitPaymentState: "settled",
          ...(!isSplitWithRemainder ? { status: "paid" } : {}),
        })
          .where(and(
            eq(ordersTable.id, body.orderId),
            eq(ordersTable.splitPaymentToken, splitRequestId!),
            eq(ordersTable.splitPaymentState, "printing"),
          )).returning({ id: ordersTable.id });
        if (!settled.length) throw new Error("La riserva del conto separato non è più disponibile");
      });
      fiscalResult.splitSettled = true;
      if (!isSplitWithRemainder && order?.tableId) {
        await freeTableIfEmpty(order.tableId);
      }
    } catch (error) {
      fiscalResult.splitSettled = false;
      fiscalResult.settlementError = error instanceof Error ? error.message : "Aggiornamento del conto non riuscito";
      console.error(`[FISCAL] RT emessa ma residuo non aggiornato per ordine ${body.orderId}: ${fiscalResult.settlementError}`);
    }
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
