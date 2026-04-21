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
      6000,
      printer.port ?? 80
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
  const result = await inviaLotteriaRt(printer.ip, codicePulito, printer.port ?? 80);
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
    printerResult = await sendCgiCommand(printer.ip, "/cgi-bin/lettura.cgi", "GET", undefined, 8000, printer.port ?? 80);
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
    printerResult = await sendCgiCommand(printer.ip, "/cgi-bin/chiusura.cgi", "POST", undefined, 10000, printer.port ?? 80);
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
  const result = await sendCgiCommand(printer.ip, "/cgi-bin/stato.cgi", "GET", undefined, 4000, printer.port ?? 80);
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

  let rtTest: { ok: boolean; ms?: number; error?: string; body?: string; url?: string } | null = null;
  if (fiscalPrinter) {
    const rtPort = fiscalPrinter.port && fiscalPrinter.port !== 9100 ? fiscalPrinter.port : 80;
    const portStr = rtPort !== 80 ? `:${rtPort}` : "";
    const cgiUrl = `http://${fiscalPrinter.ip}${portStr}/cgi-bin/fpmate.cgi`;
    const t0 = Date.now();
    try {
      const resp = await fetch(cgiUrl, {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=utf-8" },
        body: `<?xml version="1.0" encoding="utf-8"?><printerCommand><queryPrinterStatus operator="1" statusType="0"/></printerCommand>`,
        signal: AbortSignal.timeout(5000),
      });
      const body = await resp.text();
      rtTest = { ok: resp.ok, ms: Date.now() - t0, body: body.substring(0, 400), url: cgiUrl };
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      const cause = (err as unknown as { cause?: { code?: string; message?: string } }).cause;
      const detail = cause?.code ?? cause?.message ?? err.message;
      rtTest = { ok: false, ms: Date.now() - t0, error: detail, url: cgiUrl };
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

// GET /api/fiscal/test-receipt
// Invia un scontrino di prova da €0.10 alla RT e restituisce XML inviato + risposta grezza.
// ⚠️  DEVE essere chiamato dal server LOCALE (X1 Carbon), non da Replit cloud.
//     URL locale:  http://localhost:8080/api/fiscal/test-receipt
// Prima manda un annullo XML per chiudere eventuali scontrini aperti (errore 46),
// poi prova 4 varianti XML in sequenza finché una funziona.
router.get("/test-receipt", async (req, res) => {
  const { sendXmlCommand, getFiscalPrinter } = await import("../lib/fiscal-printer");
  const printer = await getFiscalPrinter();
  if (!printer) {
    res.json({ error: "Nessuna stampante fiscale attiva configurata" });
    return;
  }
  const rtPort = printer.port ?? 80;

  // ── Passo -1: verifica connettività RT con queryPrinterStatus ────────────
  let statusCheck: { ok: boolean; body?: string; error?: string } = { ok: false };
  try {
    const statusXml = `<?xml version="1.0" encoding="utf-8"?><printerCommand><queryPrinterStatus operator="1" statusType="0"/></printerCommand>`;
    const statusRes = await sendXmlCommand(printer.ip, statusXml, 5000, rtPort);
    statusCheck = { ok: statusRes.ok, body: statusRes.body ?? statusRes.error };
    console.log("[FISCAL TEST] Status check:", statusRes.body ?? statusRes.error);
  } catch (e) {
    statusCheck = { ok: false, error: String(e) };
  }

  // ── Passo 0: tenta di chiudere documenti aperti (errore 46) ─────────────
  // Prova endFiscalReceipt (se receipt è aperto) poi printCancel
  const cancelXmls = [
    `<?xml version="1.0" encoding="utf-8"?>\n<printerFiscalReceipt>\n  <endFiscalReceipt operator="1"/>\n</printerFiscalReceipt>`,
    `<?xml version="1.0" encoding="utf-8"?>\n<printerFiscalReceipt>\n  <printCancel operator="1"/>\n</printerFiscalReceipt>`,
  ];
  let cancelRes = { ok: false, body: "non inviato", error: undefined as string | undefined };
  for (const cx of cancelXmls) {
    const r = await sendXmlCommand(printer.ip, cx, 6000, rtPort);
    console.log("[FISCAL TEST] Reset/cancel:", r.body ?? r.error);
    cancelRes = { ok: r.ok, body: r.body ?? "", error: r.error };
    if (r.ok) break;
    await new Promise(r2 => setTimeout(r2, 500));
  }

  // piccola pausa dopo cancel
  await new Promise(r => setTimeout(r, 800));

  // Importo 1.10 = 1.00 netto + 0.10 IVA 10% (nessun problema di arrotondamento)
  const varianti = [
    {
      nome: "A - begin/end + dept=1 + qty=1.000 + price=1.10",
      xml: `<?xml version="1.0" encoding="utf-8"?>
<printerFiscalReceipt>
  <beginFiscalReceipt operator="1"/>
  <printRecItem operator="1" description="TEST" quantity="1.000" unitPrice="1.10" department="1" justification="1"/>
  <printRecTotal operator="1" description="Contanti" payment="1.10" paymentType="0" index="1" justification="1"/>
  <endFiscalReceipt operator="1"/>
</printerFiscalReceipt>`,
    },
    {
      nome: "B - begin/end + dept=1 + qty=1 (intero) + price=1.10",
      xml: `<?xml version="1.0" encoding="utf-8"?>
<printerFiscalReceipt>
  <beginFiscalReceipt operator="1"/>
  <printRecItem operator="1" description="TEST" quantity="1" unitPrice="1.10" department="1" justification="1"/>
  <printRecTotal operator="1" description="Contanti" payment="1.10" paymentType="0" index="1" justification="1"/>
  <endFiscalReceipt operator="1"/>
</printerFiscalReceipt>`,
    },
    {
      nome: "C - begin/end + plu=1 + qty=1.000 + price=1.10",
      xml: `<?xml version="1.0" encoding="utf-8"?>
<printerFiscalReceipt>
  <beginFiscalReceipt operator="1"/>
  <printRecItemSale operator="1" description="TEST" quantity="1.000" unitPrice="1.10" plu="1" justification="1"/>
  <printRecTotal operator="1" description="Contanti" payment="1.10" paymentType="0" index="1" justification="1"/>
  <endFiscalReceipt operator="1"/>
</printerFiscalReceipt>`,
    },
    {
      nome: "D - begin/end + dept=1 senza description + qty=1.000",
      xml: `<?xml version="1.0" encoding="utf-8"?>
<printerFiscalReceipt>
  <beginFiscalReceipt operator="1"/>
  <printRecItem operator="1" quantity="1.000" unitPrice="1.10" department="1" justification="1"/>
  <printRecTotal operator="1" description="Contanti" payment="1.10" paymentType="0" index="1" justification="1"/>
  <endFiscalReceipt operator="1"/>
</printerFiscalReceipt>`,
    },
    {
      nome: "E - begin/end + dept=1 + printRecTotal senza index",
      xml: `<?xml version="1.0" encoding="utf-8"?>
<printerFiscalReceipt>
  <beginFiscalReceipt operator="1"/>
  <printRecItem operator="1" description="TEST" quantity="1.000" unitPrice="1.10" department="1" justification="1"/>
  <printRecTotal operator="1" description="Contanti" payment="1.10" paymentType="0" justification="1"/>
  <endFiscalReceipt operator="1"/>
</printerFiscalReceipt>`,
    },
  ];

  const risultati = [];
  for (const v of varianti) {
    console.log(`[FISCAL TEST] Variante ${v.nome}:\n${v.xml}`);
    const r = await sendXmlCommand(printer.ip, v.xml, 10000, rtPort);
    console.log(`[FISCAL TEST] Risposta ${v.nome}: ok=${r.ok} rtCode=${r.rtCode} body=${r.body ?? r.error}`);
    risultati.push({
      variante: v.nome,
      xmlInviato: v.xml,
      ok: r.ok,
      rtCode: r.rtCode,
      risposta: r.body ?? r.error ?? "nessuna risposta",
      ms: r.ms,
    });
    if (r.ok) break;
    await new Promise(r2 => setTimeout(r2, 600));
  }

  // ── Test sequenza comandi separati (un TCP per comando) ──────────────────
  // Alcune RT aspettano ogni comando in una connessione TCP separata
  await new Promise(r => setTimeout(r, 1000));
  const cmds = [
    { nome: "1-beginFiscalReceipt", xml: `<?xml version="1.0" encoding="utf-8"?>\n<printerFiscalReceipt>\n  <beginFiscalReceipt operator="1"/>\n</printerFiscalReceipt>` },
    { nome: "2-printRecItem", xml: `<?xml version="1.0" encoding="utf-8"?>\n<printerFiscalReceipt>\n  <printRecItem operator="1" description="TEST" quantity="1.000" unitPrice="1.10" department="1" justification="1"/>\n</printerFiscalReceipt>` },
    { nome: "3-printRecTotal", xml: `<?xml version="1.0" encoding="utf-8"?>\n<printerFiscalReceipt>\n  <printRecTotal operator="1" description="Contanti" payment="1.10" paymentType="0" index="1" justification="1"/>\n</printerFiscalReceipt>` },
    { nome: "4-endFiscalReceipt", xml: `<?xml version="1.0" encoding="utf-8"?>\n<printerFiscalReceipt>\n  <endFiscalReceipt operator="1"/>\n</printerFiscalReceipt>` },
  ];
  const sequenza = [];
  for (const c of cmds) {
    const r = await sendXmlCommand(printer.ip, c.xml, 8000, rtPort);
    console.log(`[FISCAL SEQ] ${c.nome}: ok=${r.ok} rtCode=${r.rtCode} body=${r.body ?? r.error}`);
    sequenza.push({
      cmd: c.nome,
      ok: r.ok,
      rtCode: r.rtCode,
      risposta: r.body ?? r.error ?? "",
      ms: r.ms,
    });
    if (!r.ok) {
      console.log(`[FISCAL SEQ] Stop alla sequenza su errore: ${c.nome}`);
      break;
    }
    await new Promise(r2 => setTimeout(r2, 300));
  }

  res.json({
    avviso: "Chiamare SOLO da server locale X1 Carbon: http://localhost:8080/api/fiscal/test-receipt",
    printer: { ip: printer.ip, port: rtPort },
    statusCheck,
    reset: { body: cancelRes.body ?? cancelRes.error, ok: cancelRes.ok },
    risultati,
    sequenza,
  });
});

export default router;
