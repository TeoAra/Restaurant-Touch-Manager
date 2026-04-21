import { Router } from "express";
import { db, fiscalReceiptsTable, ordersTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import {
  getFiscalPrinter,
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

export default router;
