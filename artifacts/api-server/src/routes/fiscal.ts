import { Router } from "express";
import { db, fiscalReceiptsTable, ordersTable, paymentsTable, tablesTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import {
  getFiscalPrinter,
  emettiFiscalReceipt,
  inviaLotteriaRt,
  sendXonXoff,
  sendXonXoffCommand,
  getStatusQ,
  getStatus2X,
  parseStatusQ,
} from "../lib/fiscal-printer";
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

    // Storno RT: "ZZZZ-NNNN-DDMMYYYY"105M (XonXoff)
    const rtPort = printer.port ?? 1126;
    const zzzz = String(nChiusura).padStart(4, "0");
    const nnnn = String(nDocumento).padStart(4, "0");
    const stornoRef = `${zzzz}-${nnnn}-${dataCgi}`;
    const stornoCmd = `"${stornoRef}"105M`;
    printerResult = await sendXonXoffCommand(printer.ip, rtPort, stornoCmd, 8000);
  } else {
    printerResult = { ok: false, error: "Nessuna stampante fiscale configurata" };
  }

  res.json({ receipt, printer: printerResult });
});

// ── Lotteria degli Scontrini ─────────────────────────────────────────────────
// Il codice lotteria viene salvato nelle impostazioni (lotteria_codice).
// Alla prossima emissione scontrino viene inserito automaticamente come "CODICE"L
// nel flusso XonXoff (prima del pagamento).

// GET /api/fiscal/lotteria → leggi codice salvato
router.get("/lotteria", async (req, res) => {
  const settings = await getSettings();
  res.json({ codice: settings["lotteria_codice"] ?? null });
});

// POST /api/fiscal/lotteria → valida + salva codice
router.post("/lotteria", async (req, res) => {
  const { codice } = req.body as { codice?: string };

  // Cancellazione codice
  if (!codice || codice === "") {
    await db.execute(sql`
      INSERT INTO app_settings (key, value) VALUES ('lotteria_codice', '')
      ON CONFLICT (key) DO UPDATE SET value = ''
    `);
    return res.json({ ok: true, codice: null, nota: "Codice lotteria rimosso" });
  }

  const codicePulito = codice.toUpperCase().replace(/[^A-Z0-9]/g, "").trim();
  if (codicePulito.length !== 8) {
    return res.status(400).json({ error: "Il codice lotteria deve essere esattamente 8 caratteri alfanumerici" });
  }

  // Salva in settings
  await db.execute(sql`
    INSERT INTO app_settings (key, value) VALUES ('lotteria_codice', ${codicePulito})
    ON CONFLICT (key) DO UPDATE SET value = ${codicePulito}
  `);

  // Verifica connettività RT (XonXoff "?")
  const printer = await getFiscalPrinter();
  let rtCheck: { ok: boolean; error?: string; stato?: number } = { ok: true };
  if (printer) {
    const rtPort = printer.port ?? 1126;
    const sq = await inviaLotteriaRt(printer.ip, codicePulito, rtPort);
    rtCheck = { ok: sq.ok, error: sq.error };
  }

  res.json({
    ok: true,
    codice: codicePulito,
    rtConnessa: printer ? rtCheck.ok : null,
    nota: printer
      ? (rtCheck.ok
        ? "Codice salvato — sarà incluso automaticamente nel prossimo scontrino"
        : `Codice salvato, ma RT non raggiungibile: ${rtCheck.error ?? "timeout"}`)
      : "Codice salvato — RT non configurata, verrà usato all'incasso",
  });
});

// ── Cancella Scontrino Fiscale Aperto ────────────────────────────────────────
// XonXoff: "k" = Annullo scontrino in corso; "K" = Tasto C (reset errore)
router.post("/cancel-open-receipt", async (req, res) => {
  const printer = await getFiscalPrinter();
  if (!printer) {
    return res.status(400).json({ ok: false, error: "Nessuna stampante fiscale configurata" });
  }
  const rtPort = printer.port ?? 1126;
  const tentativi: Array<{ cmd: string; ok: boolean; body?: string; error?: string; ms: number }> = [];

  for (const [label, cmd] of [
    ["k — annullo scontrino in corso", "k"],
    ["K — tasto C (reset errore)", "K"],
    ["? — verifica stato", "?"],
  ] as [string, string][]) {
    const r = await sendXonXoffCommand(printer.ip, rtPort, cmd, 3000);
    console.log(`[FISCAL CANCEL] ${label}: ok=${r.ok} xoff=${r.rtCode} ascii=${(r.body ?? "").substring(0, 80)}`);
    tentativi.push({ cmd: label, ok: r.ok, body: r.body, error: r.error, ms: r.ms ?? 0 });
    await new Promise(resolve => setTimeout(resolve, 400));
  }

  // Leggi stato finale
  const statusFinal = await getStatusQ(printer.ip, rtPort);
  const ok = statusFinal.status?.stato === 0; // 0 = chiuso

  return res.json({
    ok,
    stato: statusFinal.status,
    tentativi,
    note: ok
      ? "Scontrino chiuso — ora prova il Report Z"
      : "Premi ANNULLO fisicamente sulla RT, poi riprova",
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
    // X-report: "1f" = Rapporto Finanziario Giorno (XonXoff)
    const rtPort = printer.port ?? 1126;
    printerResult = await sendXonXoffCommand(printer.ip, rtPort, "1f", 8000);
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
    // Z-report: "1F" = Chiusura Fiscale Giorno (XonXoff)
    const rtPort = printer.port ?? 1126;
    printerResult = await sendXonXoffCommand(printer.ip, rtPort, "1F", 12000);
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
  const rtPort = printer.port ?? 1126;
  const stato2X = await getStatus2X(printer.ip, rtPort);
  const statoQ  = await getStatusQ(printer.ip, rtPort);
  res.json({
    found: true,
    printer: { name: printer.name, ip: printer.ip, port: rtPort, matricola: printer.matricola },
    stato2X,
    statoQ,
  });
});

// ── Diagnostica completa RT ─────────────────────────────────────────────────
// GET /api/fiscal/diagnostica  →  mostra TUTTE le stampanti + quale è fiscale + test connessione
router.get("/diagnostica", async (req, res) => {
  const { printersTable } = await import("@workspace/db");
  const allPrinters = await db.select().from(printersTable).orderBy(printersTable.id);

  const fiscalPrinter = await getFiscalPrinter();

  let rtTest: { ok: boolean; ms?: number; error?: string; stato2X?: unknown; statoQ?: unknown } | null = null;
  if (fiscalPrinter) {
    const rtPort = fiscalPrinter.port ?? 1126;
    const s2x = await getStatus2X(fiscalPrinter.ip, rtPort);
    const sq  = await getStatusQ(fiscalPrinter.ip, rtPort);
    rtTest = { ok: s2x.ok || sq.ok, stato2X: s2x, statoQ: sq };
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
// ⚠️  DEVE essere chiamato dal server LOCALE (X1 Carbon), non da Replit cloud.
//     URL locale: http://localhost:8080/api/fiscal/test-receipt
//
// Protocollo: DTR XonXoff su TCP (non XML).
// Invia scontrino TEST €1.10 su reparti 1-4 finché uno funziona.
// Verifica successo con "?" (stato scontrino: F=0 = chiuso = OK).
router.get("/test-receipt", async (req, res) => {
  const printer = await getFiscalPrinter();
  if (!printer) {
    res.json({ error: "Nessuna stampante fiscale attiva configurata" });
    return;
  }
  const rtPort = printer.port ?? 1126;

  // ── Passo 1: Stato iniziale RT (2X) ─────────────────────────────────────
  console.log("[FISCAL TEST] Stato iniziale 2X...");
  const stato2X = await getStatus2X(printer.ip, rtPort);
  console.log("[FISCAL TEST] 2X:", JSON.stringify(stato2X));
  await new Promise(r => setTimeout(r, 300));

  // ── Passo 2: Stato scontrino (?) ─────────────────────────────────────────
  console.log("[FISCAL TEST] Stato scontrino ?...");
  const statoQ = await getStatusQ(printer.ip, rtPort);
  console.log("[FISCAL TEST] ?:", JSON.stringify(statoQ));
  const docPrima = statoQ.status?.docCommerciali ?? -1;
  await new Promise(r => setTimeout(r, 300));

  // ── Passo 3: Chiudi eventuale scontrino aperto ───────────────────────────
  let cancelResult = null;
  if (statoQ.status?.stato === 1 || statoQ.status?.stato === 2) {
    console.log("[FISCAL TEST] Scontrino aperto — invio 'k' (annullo)...");
    const cr = await sendXonXoff(printer.ip, rtPort, "k", 3000);
    cancelResult = { cmd: "k", ok: cr.xoffCount === 0, xoff: cr.xoffCount, ascii: cr.ascii };
    await new Promise(r => setTimeout(r, 500));
  }

  // ── Passo 4: Prova scontrino €1.10 su reparti 1-4 (XonXoff) ─────────────
  // Formato: "desc"priceHdeptR  priceH1T  ?
  // Price 1.10 → 110 centesimi.  Pagamento contanti immediato con 1T.
  const risultati: Array<{
    variante: string; cmd: string; xoffCount: number; ascii: string;
    ok: boolean; statoDopoF: number | null; docDopoB: number | null; ms: number;
  }> = [];

  let okDept = -1;
  for (const dept of [1, 2, 3, 4]) {
    const cmd = `"TEST HELLOTABLE"110H${dept}R110H1T?`;
    console.log(`[FISCAL TEST] Reparto ${dept}: ${cmd}`);
    const r = await sendXonXoff(printer.ip, rtPort, cmd, 5000);
    const statusDopo = parseStatusQ(r.ascii);
    console.log(`[FISCAL TEST] R${dept}: xoff=${r.xoffCount} ok=${r.ok} stato=${statusDopo?.stato} ascii=${r.ascii.substring(0, 100)}`);

    const v = {
      variante: `Reparto ${dept}`,
      cmd,
      xoffCount: r.xoffCount,
      ascii: r.ascii.substring(0, 200),
      ok: r.xoffCount === 0 && statusDopo?.stato === 0,
      statoDopoF: statusDopo?.stato ?? null,
      docDopoB:   statusDopo?.docCommerciali ?? null,
      ms: r.ms,
    };
    risultati.push(v);

    if (v.ok && (statusDopo?.docCommerciali ?? 0) > docPrima) {
      // Scontrino emesso con successo!
      okDept = dept;
      break;
    }

    // Se XOFF: la RT è in errore — manda K (C) per resettare
    if (r.xoffCount > 0) {
      await sendXonXoff(printer.ip, rtPort, "K", 1000);
    }
    await new Promise(r2 => setTimeout(r2, 800));
  }

  // ── Passo 5: Stato finale ─────────────────────────────────────────────────
  await new Promise(r => setTimeout(r, 400));
  const statoFinale = await getStatusQ(printer.ip, rtPort);

  res.json({
    avviso: "Chiamare SOLO da server locale X1 Carbon: http://localhost:8080/api/fiscal/test-receipt",
    protocollo: "DTR XonXoff su TCP",
    printer: { ip: printer.ip, port: rtPort },
    stato2X,
    statoIniziale: statoQ,
    cancelResult,
    risultati,
    okDept: okDept > 0 ? okDept : null,
    statoFinale,
    note: okDept > 0
      ? `Reparto ${okDept} funzionante — configura questo reparto nel Backoffice → Reparti RT`
      : "Nessun reparto ha funzionato — controlla display RT e verifica reparti configurati",
  });
});

// ── Pagamento alla Romana ─────────────────────────────────────────────────────
// POST /api/fiscal/romana
// Emette un singolo scontrino fiscale per una quota "alla romana".
// Ogni chiamata emette un scontrino separato sulla RT.
// Se isUltima=true (ultima quota), chiude anche l'ordine nel gestionale.
//
// Body: { orderId, importo, metodoPagamento, quotaNum, quoteTotali, tableName?, isUltima? }
router.post("/romana", async (req, res) => {
  const {
    orderId,
    importo,
    metodoPagamento,
    quotaNum   = 1,
    quoteTotali = 1,
    tableName,
    isUltima   = false,
  } = req.body as {
    orderId: number;
    importo: string;
    metodoPagamento: "cash" | "card" | "other" | "satispay";
    quotaNum?: number;
    quoteTotali?: number;
    tableName?: string;
    isUltima?: boolean;
  };

  if (!orderId || !importo || parseFloat(importo) <= 0) {
    return res.status(400).json({ error: "orderId e importo sono obbligatori" });
  }

  const printer = await getFiscalPrinter();
  const settings = await getSettings();

  // Recupera info ordine per IVA e descrizione
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  const modalita = (order as never as { modalita?: string })?.modalita ?? "tavolo";
  const aliquotaIva = settings[`iva_${modalita}`] ?? settings["iva_tavolo"] ?? "10";

  // Descrizione quota per la RT (max 32 char)
  const tavolo = tableName ? tableName.substring(0, 12) : `ORD.${orderId}`;
  const desc = quoteTotali > 1
    ? `QUOTA ${quotaNum}/${quoteTotali} ${tavolo}`.substring(0, 32)
    : `CONTO ${tavolo}`.substring(0, 32);

  // Emetti scontrino fiscale (crea record in fiscal_receipts)
  let rtOk = false;
  let rtError: string | undefined;
  let receiptId: number | undefined;
  let rtBody: string | undefined;

  try {
    const { receipt, rt } = await emettiFiscalReceipt({
      orderId,
      importo,
      metodoPagamento,
      righe: [{ desc, qta: 1, prezzoUnitario: importo, aliquotaIva }],
      printer,
    });
    receiptId = receipt.id;
    rtOk = rt.ok;
    rtError = rt.error;
    rtBody = rt.body?.substring(0, 200);
    console.log(`[ROMANA] Quota ${quotaNum}/${quoteTotali} ordine ${orderId}: rtOk=${rt.ok} importo=${importo} metodo=${metodoPagamento}`);
  } catch (e) {
    rtError = e instanceof Error ? e.message : String(e);
    console.error(`[ROMANA] Eccezione quota ${quotaNum}:`, rtError);
  }

  // Se è l'ultima quota: chiudi l'ordine nel gestionale
  let orderClosed = false;
  if (isUltima) {
    try {
      // Inserisci record di pagamento riepilogativo
      const [payment] = await db.insert(paymentsTable).values({
        orderId,
        method: metodoPagamento,
        amount: importo,
        change: null,
      }).returning();

      // Marca ordine come pagato
      const [updatedOrder] = await db.update(ordersTable)
        .set({ status: "paid" })
        .where(eq(ordersTable.id, orderId))
        .returning();

      // Libera tavolo se non ci sono altri ordini aperti
      if (updatedOrder?.tableId) {
        const openOrders = await db.select().from(ordersTable)
          .where(and(eq(ordersTable.tableId, updatedOrder.tableId), eq(ordersTable.status, "open")));
        if (openOrders.length === 0) {
          await db.update(tablesTable).set({ status: "free" }).where(eq(tablesTable.id, updatedOrder.tableId));
        }
      }

      orderClosed = true;
      console.log(`[ROMANA] Ordine ${orderId} chiuso, payment id=${payment.id}`);
    } catch (e) {
      console.error("[ROMANA] Errore chiusura ordine:", e);
    }
  }

  res.json({
    ok: true,
    receiptId,
    rtOk,
    rtError: rtError ?? null,
    rtBody: rtBody ?? null,
    orderClosed,
    quota: { num: quotaNum, total: quoteTotali, importo, metodoPagamento },
  });
});

export default router;
