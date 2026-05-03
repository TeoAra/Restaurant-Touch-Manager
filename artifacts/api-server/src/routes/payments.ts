import { Router } from "express";
import { db, paymentsTable, ordersTable, orderItemsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { CreatePaymentBody, GetPaymentParams } from "@workspace/api-zod";
import { getFiscalPrinter, emettiFiscalReceipt, emettiDocumentoNonFiscale } from "../lib/fiscal-printer";
import { getSettings } from "../lib/settings";
import { logAudit } from "../lib/audit";

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

  const [payment] = await db.insert(paymentsTable).values({
    orderId: body.orderId,
    method: body.method,
    amount: body.amount,
    change: body.change ?? null,
  }).returning();

  // For split payments: only mark order as paid if ALL items are being paid
  const splitItemIdsPre: number[] | undefined = Array.isArray(req.body?.itemIds) && req.body.itemIds.length > 0
    ? (req.body.itemIds as number[])
    : undefined;

  // Determina se l'ordine è completamente pagato sommando TUTTI i pagamenti
  // ricevuti finora. Questo gestisce correttamente il caso split-bill multiplo
  // (es. 5 split successivi su 10 articoli) senza richiedere link item↔payment.
  let isSplitWithRemainder = false;
  if (splitItemIdsPre) {
    const [orderRow] = await db.select({ id: ordersTable.id, total: ordersTable.total })
      .from(ordersTable).where(eq(ordersTable.id, body.orderId)).limit(1);
    const totaleOrdine = parseFloat(orderRow?.total ?? "0");
    const sumRow = await db.execute<{ totale: string | null }>(sql`
      SELECT COALESCE(SUM(amount::numeric), 0)::text AS totale
      FROM payments WHERE order_id = ${body.orderId}
    `);
    const totalePagato = parseFloat(sumRow.rows[0]?.totale ?? "0");
    // Tolleranza 1 cent per arrotondamenti
    isSplitWithRemainder = totalePagato + 0.01 < totaleOrdine;
  }

  // Mark order as paid only when fully paid (not a partial split)
  const [order] = isSplitWithRemainder
    ? await db.select().from(ordersTable).where(eq(ordersTable.id, body.orderId)).limit(1).then(r => r)
    : await db.update(ordersTable).set({ status: "paid" }).where(eq(ordersTable.id, body.orderId)).returning();

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
    details: { amount: body.amount, method: body.method, isSplit: !!splitItemIdsPre, isSplitWithRemainder },
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
    const items = splitItemIds ? allItems.filter(i => splitItemIds.includes(i.id)) : allItems;
    const settings = await getSettings();
    const modalita = (order as never as { modalita?: string }).modalita ?? "tavolo";
    const aliquotaIva = settings[`iva_${modalita}`] ?? settings["iva_tavolo"] ?? "10";
    const printer = await getFiscalPrinter();

    console.log(`[FISCAL] Pagamento ordine ${body.orderId} — stampante: ${printer ? `${printer.name} (${printer.ip})` : "NESSUNA"} — nonFiscale: ${nonFiscale}`);

    // ── Riga coperto (se presente) ───────────────────────────────────────
    const orderCovers = (order as unknown as { covers?: number }).covers ?? 0;
    const coverPrice = parseFloat(settings["cover_price"] ?? "0");
    const hasCover = orderCovers > 0 && coverPrice > 0;

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
      if (hasCover) righe.unshift({ desc: "COPERTO", qta: orderCovers, prezzoUnitario: coverPrice.toFixed(2) });
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
      if (hasCover) righe.unshift({ desc: "COPERTO", qta: orderCovers, prezzoUnitario: coverPrice.toFixed(2), aliquotaIva });

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

  res.status(201).json({ ...payment, fiscal: fiscalResult });
});

router.get("/:id", async (req, res) => {
  const { id } = GetPaymentParams.parse({ id: Number(req.params.id) });
  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, id));
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  return res.json(payment);
});

export default router;
