import { Router } from "express";
import { db, fiscalReceiptsTable, ordersTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { getFiscalPrinter, sendCgiCommand, inviaLotteriaRt } from "../lib/fiscal-printer";
import { getSettings } from "../lib/settings";

const router = Router();

// ── Lista scontrini fiscali ─────────────────────────────────────────────────
router.get("/receipts", async (req, res) => {
  const { anno, numero } = req.query;
  let rows;
  if (anno && numero) {
    rows = await db.select().from(fiscalReceiptsTable)
      .where(and(eq(fiscalReceiptsTable.anno, Number(anno)), eq(fiscalReceiptsTable.numero, Number(numero))));
  } else {
    rows = await db.select().from(fiscalReceiptsTable).orderBy(desc(fiscalReceiptsTable.createdAt)).limit(50);
  }
  res.json(rows);
});

// ── Crea scontrino fiscale ──────────────────────────────────────────────────
router.post("/receipts", async (req, res) => {
  const body = req.body;
  const anno = body.anno ?? new Date().getFullYear();
  const rows = await db.execute(
    sql`SELECT COALESCE(MAX(numero), 0) + 1 AS next FROM fiscal_receipts WHERE anno = ${anno}`
  );
  const numero = Number((rows.rows[0] as { next: number }).next);

  // Calcola IVA dalla modalità dell'ordine + impostazioni
  let ivaAmount = body.iva ?? "0";
  if (body.orderId) {
    try {
      const settings = await getSettings();
      const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, Number(body.orderId)));
      if (order) {
        const modalita = (order as never as { modalita?: string }).modalita ?? "tavolo";
        const aliquota = parseFloat(settings[`iva_${modalita}`] ?? settings["iva_tavolo"] ?? "10");
        const importo = parseFloat(body.importo ?? "0");
        const imponibile = importo / (1 + aliquota / 100);
        ivaAmount = (importo - imponibile).toFixed(2);
      }
    } catch { /* fallback: usa iva fornita */ }
  }

  // Recupera stampante fiscale per printerRef/printerSerial automatici
  const fiscalPrinter = await getFiscalPrinter();

  const [receipt] = await db.insert(fiscalReceiptsTable).values({
    numero,
    anno,
    data: body.data ?? new Date().toISOString().slice(0, 10),
    orderId: body.orderId,
    importo: body.importo ?? "0",
    iva: ivaAmount,
    metodoPagamento: body.metodoPagamento ?? "contanti",
    printerRef: body.printerRef ?? fiscalPrinter?.name ?? null,
    printerSerial: body.printerSerial ?? fiscalPrinter?.matricola ?? null,
  }).returning();
  res.status(201).json(receipt);
});

// ── Annulla scontrino ───────────────────────────────────────────────────────
router.post("/receipts/:id/void", async (req, res) => {
  const id = Number(req.params.id);
  const { motivo, numeroChiusura, numeroDocumentoRt, dataDocumento } = req.body as {
    motivo?: string;
    numeroChiusura?: number | string;
    numeroDocumentoRt?: number | string;
    dataDocumento?: string; // YYYY-MM-DD
  };

  const updateData: Record<string, unknown> = {
    annullato: true,
    annullatoAt: new Date(),
    motivoAnnullo: motivo ?? "Annullo operatore",
  };
  if (numeroChiusura)    updateData.numeroChiusura    = Number(numeroChiusura);
  if (numeroDocumentoRt) updateData.numeroDocumentoRt = Number(numeroDocumentoRt);

  const [receipt] = await db.update(fiscalReceiptsTable)
    .set(updateData as never)
    .where(eq(fiscalReceiptsTable.id, id))
    .returning();
  if (!receipt) return res.status(404).json({ error: "Scontrino non trovato" });

  const printer = await getFiscalPrinter();
  let printerResult = null;
  if (printer) {
    // Formato data per CGI RT: DDMMYYYY
    const dataRaw = dataDocumento ?? receipt.data; // YYYY-MM-DD
    const dataCgi = dataRaw.replace(/(\d{4})-(\d{2})-(\d{2})/, "$3$2$1"); // → DDMMYYYY

    const nChiusura  = numeroChiusura    ?? (receipt as never as { numeroChiusura?: number }).numeroChiusura    ?? 1;
    const nDocumento = numeroDocumentoRt ?? (receipt as never as { numeroDocumentoRt?: number }).numeroDocumentoRt ?? receipt.numero;

    printerResult = await sendCgiCommand(
      printer.ip,
      "/cgi-bin/annullo.cgi",
      "POST",
      `data=${dataCgi}&chiusura=${nChiusura}&documento=${nDocumento}&importo=${receipt.importo}`,
      6000
    );
  } else {
    printerResult = { ok: false, error: "Nessuna stampante fiscale configurata" };
  }

  res.json({ receipt, printer: printerResult });
});

// ── Lotteria degli Scontrini — valida RT e codice (XML Protocol 7.0) ────────
// Con protocollo XML 7.0 il codice lotteria viene incluso nel documento al momento
// della stampa tramite <printRecLottery>. Questo endpoint verifica la raggiungibilità
// della RT e valida il codice, che verrà applicato automaticamente al prossimo incasso.
router.post("/lotteria", async (req, res) => {
  const { codice } = req.body as { codice?: string };
  if (!codice || codice.length !== 8) {
    return res.status(400).json({ error: "Il codice lotteria deve essere di 8 caratteri" });
  }
  const codicePulito = codice.toUpperCase().trim();
  const printer = await getFiscalPrinter();
  if (!printer) {
    // Nessuna RT configurata: salviamo il codice e lo includeremo al prossimo incasso
    return res.json({ ok: true, codice: codicePulito, nota: "RT non configurata — codice salvato, verrà applicato all'incasso" });
  }
  // Verifica connettività RT via XML (queryPrinterStatus)
  const result = await inviaLotteriaRt(printer.ip, codicePulito);
  res.json({
    ok: result.ok,
    ms: result.ms,
    error: result.error ?? null,
    codice: codicePulito,
    nota: "Codice salvato — verrà incluso nel documento commerciale al momento dell'incasso",
  });
});

// ── Report X — Lettura di giornata (non azzera) ─────────────────────────────
router.post("/x-report", async (req, res) => {
  const anno = new Date().getFullYear();
  const now = new Date().toISOString().slice(0, 10);

  // Totali DB di oggi
  const totals = await db.execute(sql`
    SELECT COUNT(*) as count, COALESCE(SUM(importo::numeric), 0) as totale,
           COALESCE(SUM(iva::numeric), 0) as totale_iva
    FROM fiscal_receipts
    WHERE anno = ${anno} AND data = ${now} AND annullato = false
  `);
  const row = totals.rows[0] as { count: string; totale: string; totale_iva: string };

  const printer = await getFiscalPrinter();
  let printerResult = null;
  if (printer) {
    // Lettura di giornata — CGI standard RT italiano
    printerResult = await sendCgiCommand(printer.ip, "/cgi-bin/lettura.cgi", "GET", undefined, 8000);
  } else {
    printerResult = { ok: false, error: "Nessuna stampante fiscale configurata" };
  }

  res.json({
    tipo: "X",
    data: now,
    anno,
    scontrini: Number(row.count),
    totale: row.totale,
    totale_iva: row.totale_iva,
    printer: printerResult,
    printer_name: printer?.name ?? null,
    printer_matricola: printer?.matricola ?? null,
    simulated: !printer,
  });
});

// ── Report Z — Chiusura fiscale giornaliera (azzera contatori) ─────────────
router.post("/z-report", async (req, res) => {
  const anno = new Date().getFullYear();
  const now = new Date().toISOString().slice(0, 10);

  // Totali DB di oggi
  const totals = await db.execute(sql`
    SELECT COUNT(*) as count, COALESCE(SUM(importo::numeric), 0) as totale,
           COALESCE(SUM(iva::numeric), 0) as totale_iva
    FROM fiscal_receipts
    WHERE anno = ${anno} AND data = ${now} AND annullato = false
  `);
  const row = totals.rows[0] as { count: string; totale: string; totale_iva: string };

  const printer = await getFiscalPrinter();
  let printerResult = null;
  if (printer) {
    // Chiusura fiscale — CGI standard RT italiano
    printerResult = await sendCgiCommand(printer.ip, "/cgi-bin/chiusura.cgi", "POST", undefined, 10000);
  } else {
    printerResult = { ok: false, error: "Nessuna stampante fiscale configurata" };
  }

  res.json({
    tipo: "Z",
    data: now,
    anno,
    scontrini: Number(row.count),
    totale: row.totale,
    totale_iva: row.totale_iva,
    printer: printerResult,
    printer_name: printer?.name ?? null,
    printer_matricola: printer?.matricola ?? null,
    simulated: !printer,
  });
});

// ── Test stato stampante fiscale ────────────────────────────────────────────
router.get("/printer-status", async (req, res) => {
  const printer = await getFiscalPrinter();
  if (!printer) {
    return res.json({ found: false, error: "Nessuna stampante fiscale (RT) configurata e attiva" });
  }
  const result = await sendCgiCommand(printer.ip, "/cgi-bin/stato.cgi", "GET", undefined, 4000);
  res.json({
    found: true,
    printer: {
      name: printer.name,
      ip: printer.ip,
      model: printer.model,
      matricola: printer.matricola,
    },
    connection: result,
  });
});

// ── Diagnostica completa RT ─────────────────────────────────────────────────
// GET /api/fiscal/diagnostica  →  mostra TUTTE le stampanti + quale è fiscale + test connessione
router.get("/diagnostica", async (req, res) => {
  const { printersTable } = await import("@workspace/db");
  const allPrinters = await db.select().from(printersTable).orderBy(printersTable.id);

  const fiscalPrinter = await getFiscalPrinter();

  let rtTest: { ok: boolean; ms?: number; error?: string; body?: string } | null = null;
  if (fiscalPrinter) {
    const t0 = Date.now();
    try {
      const resp = await fetch(`http://${fiscalPrinter.ip}/cgi-bin/fpmate.cgi`, {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=utf-8" },
        body: `<?xml version="1.0" encoding="utf-8"?><printerFiscalReceipt><queryPrinterStatus operator="1" statusType="0"/></printerFiscalReceipt>`,
        signal: AbortSignal.timeout(3000),
      });
      const body = await resp.text();
      rtTest = { ok: resp.ok, ms: Date.now() - t0, body: body.substring(0, 300) };
    } catch (e) {
      rtTest = { ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
    }
  }

  res.json({
    tutteLeStampanti: allPrinters.map(p => ({
      id: p.id, name: p.name, ip: p.ip, port: p.port,
      is_fiscale: p.isFiscale, active: p.active, model: p.model, matricola: p.matricola,
    })),
    stampanteFiscaleSelezionata: fiscalPrinter
      ? { id: fiscalPrinter.id, name: fiscalPrinter.name, ip: fiscalPrinter.ip }
      : null,
    testConnessioneRt: rtTest,
  });
});

export default router;
