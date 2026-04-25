import { Router } from "express";
import { db, paymentsTable, ordersTable, tablesTable, orderItemsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { CreatePaymentBody, GetPaymentParams } from "@workspace/api-zod";
import { getFiscalPrinter, emettiFiscalReceipt, emettiDocumentoNonFiscale } from "../lib/fiscal-printer";
import { getSettings } from "../lib/settings";

const router = Router();

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

  // Mark order as paid
  const [order] = await db.update(ordersTable).set({ status: "paid" }).where(eq(ordersTable.id, body.orderId)).returning();

  // Free the table if no other open orders
  if (order?.tableId) {
    const openOrders = await db.select().from(ordersTable)
      .where(and(eq(ordersTable.tableId, order.tableId), eq(ordersTable.status, "open")));
    if (openOrders.length === 0) {
      await db.update(tablesTable).set({ status: "free" }).where(eq(tablesTable.id, order.tableId));
    }
  }

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

      console.log(`[FISCAL] Invio RT: ${printer.ip} — ${righe.length} righe — IVA ${aliquotaIva}% — totale ${body.amount}`);

      const { receipt, rt } = await emettiFiscalReceipt({
        orderId: body.orderId,
        importo: body.amount,
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
  res.json(payment);
});

export default router;
