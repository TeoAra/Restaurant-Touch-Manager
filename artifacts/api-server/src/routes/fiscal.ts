import { Router } from "express";
import { db, fiscalReceiptsTable, fiscalReportsTable, ordersTable, paymentsTable } from "@workspace/db";
import { eq, desc, and, or, inArray, sql } from "drizzle-orm";
import { logAudit } from "../lib/audit";
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
import { requireAdminHeader } from "../lib/auth-guard";
import { cents, money, normalizeLottery, orderDue, validateRomana } from "../lib/billing";
import { randomUUID } from "node:crypto";
import { requireStaffAdmin } from "../lib/staff-session";
import { rtReference, cancellationConfirmed } from "../lib/fiscal-identity";
import { zReadiness, zConfirmed } from "../lib/fiscal-z-state";

const router = Router();

// ── Lista scontrini fiscali ─────────────────────────────────────────────────
router.get("/receipts", async (req, res) => {
  const { anno, numero } = req.query;
  let rows;
  if (numero) {
    rows = await db.select().from(fiscalReceiptsTable)
      .where(and(anno ? eq(fiscalReceiptsTable.anno, Number(anno)) : undefined, eq(fiscalReceiptsTable.numeroDocumentoRt, Number(numero))))
      .orderBy(desc(fiscalReceiptsTable.createdAt)).limit(200);
  } else {
    rows = await db.select().from(fiscalReceiptsTable).where(anno ? eq(fiscalReceiptsTable.anno, Number(anno)) : undefined).orderBy(desc(fiscalReceiptsTable.createdAt)).limit(200);
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
router.post("/receipts/:id/void", requireStaffAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) { res.status(400).json({ error: "ID non valido" }); return; }
  const [receipt] = await db.select().from(fiscalReceiptsTable).where(eq(fiscalReceiptsTable.id, id));
  if (!receipt) { res.status(404).json({ error: "Scontrino non trovato" }); return; }
  if (receipt.annullato || ["pending", "unknown", "confirmed"].includes(receipt.voidStatus ?? "")) {
    res.status(409).json({ error: receipt.annullato ? "Documento già annullato" : "Annullo già inviato: verifica l’esito sulla RT. Non ripetere la stampa.", receipt }); return;
  }
  let ref;
  try { ref = rtReference(req.body ?? {}); }
  catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
  if ((receipt.numeroChiusura != null && receipt.numeroChiusura !== ref.closure) ||
      (receipt.numeroDocumentoRt != null && receipt.numeroDocumentoRt !== ref.document) ||
      (receipt.dataDocumentoRt && receipt.dataDocumentoRt !== ref.date)) {
    res.status(409).json({ error: "I riferimenti inseriti non corrispondono ai dati RT già acquisiti" }); return;
  }
  const printer = await getFiscalPrinter();
  if (!printer) { res.status(503).json({ error: "Nessuna RT configurata. Nessun annullo registrato." }); return; }
  const port = printer.port ?? 1126;
  const before = await getStatusQ(printer.ip, port);
  const identity = await getStatus2X(printer.ip, port);
  const serial = identity.status?.matricola?.trim();
  if (!before.ok || !before.status || before.status.stato !== 0 || !identity.ok || !serial || Number(identity.status?.errCode) !== 0) {
    res.status(503).json({ error: "RT non pronta o stato non verificabile: nessun comando di annullo inviato" }); return;
  }
  if (typeof req.body.printerSerial !== "string" || req.body.printerSerial.trim() !== serial ||
      (receipt.printerSerial && receipt.printerSerial.trim() !== serial)) {
    res.status(400).json({ error: "La matricola sul documento deve corrispondere alla RT collegata" }); return;
  }
  const claimed = await db.transaction(async tx => {
    const [current] = await tx.select().from(fiscalReceiptsTable).where(eq(fiscalReceiptsTable.id, id)).for("update");
    if (current.annullato || ["pending", "unknown", "confirmed"].includes(current.voidStatus ?? "")) return false;
    await tx.update(fiscalReceiptsTable).set({
      voidStatus: "pending", voidError: null, numeroChiusura: ref.closure, numeroDocumentoRt: ref.document,
      dataDocumentoRt: ref.date, printerSerial: serial,
    }).where(eq(fiscalReceiptsTable.id, id));
    return true;
  });
  if (!claimed) { res.status(409).json({ error: "Annullo già in corso: non ripetere" }); return; }
  try {
    const result = await sendXonXoffCommand(printer.ip, port, ref.command, 8000);
    const after = await getStatusQ(printer.ip, port);
    const confirmed = result.ok && cancellationConfirmed(before.status, after.status);
    const error = confirmed ? null : "Esito annullo da verificare sulla RT. Non ripetere automaticamente il comando.";
    const [updated] = await db.update(fiscalReceiptsTable).set({
      annullato: confirmed, annullatoAt: confirmed ? new Date() : null,
      motivoAnnullo: String(req.body.motivo || "Annullo operatore").slice(0, 500),
      voidStatus: confirmed ? "confirmed" : "unknown", voidError: error,
    }).where(eq(fiscalReceiptsTable.id, id)).returning();
    res.status(confirmed ? 200 : 502).json({ receipt: updated, printer: { ...result, ok: confirmed }, error });
  } catch (error) {
    await db.update(fiscalReceiptsTable).set({ voidStatus: "unknown", voidError: "Comunicazione interrotta: verifica il documento sulla RT prima di qualsiasi altro tentativo." }).where(eq(fiscalReceiptsTable.id, id));
    throw error;
  }
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

  return res.json({
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
router.get("/reports", requireStaffAdmin, async (_req, res) => {
  res.json(await db.select().from(fiscalReportsTable).orderBy(desc(fiscalReportsTable.createdAt)).limit(100));
});

router.post("/z-report", requireStaffAdmin, async (req, res): Promise<void> => {
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
  if (!printer) {
    res.status(503).json({ error: "Nessuna RT configurata: chiusura fiscale non eseguita." }); return;
  }
  const port = printer.port ?? 1126;
  const before = await getStatusQ(printer.ip, port);
  const identity = await getStatus2X(printer.ip, port);
  const readiness = zReadiness(before, identity);
  if (!readiness.ready) {
    req.log.warn({ q: before, identity, reason: readiness.error }, "Chiusura Z bloccata prima dell'invio");
    res.status(503).json({ error: readiness.error }); return;
  }
  const { serial, closure } = readiness.baseline;
  const attempt = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7315092)`);
    const [existing] = await tx.select().from(fiscalReportsTable).where(and(
      eq(fiscalReportsTable.printerSerial, serial),
      or(eq(fiscalReportsTable.numeroChiusura, closure), inArray(fiscalReportsTable.status, ["pending", "unknown"])),
      eq(fiscalReportsTable.type, "Z"),
    ));
    if (existing) return null;
    const [saved] = await tx.insert(fiscalReportsTable).values({
      type: "Z", printerSerial: serial, numeroChiusura: closure, status: "pending", totalDb: row.totale,
      response: JSON.stringify({ baseline: readiness.baseline, before, identity }),
    }).returning();
    return saved;
  });
  if (!attempt) {
    res.status(409).json({ error: "Chiusura già inviata per questo numero Z. Verifica lo storico e la RT prima di ripetere." }); return;
  }
  let printerResult;
  try {
    const command = await sendXonXoffCommand(printer.ip, port, "1F", 12000);
    const after = await getStatusQ(printer.ip, port);
    const afterIdentity = await getStatus2X(printer.ip, port);
    const confirmed = command.ok && zConfirmed(readiness.baseline, after, afterIdentity);
    printerResult = { ...command, ok: confirmed, error: confirmed ? undefined : "Esito Z da verificare sulla RT. Non ripetere automaticamente la chiusura." };
    await db.update(fiscalReportsTable).set({
      status: confirmed ? "confirmed" : "unknown", error: printerResult.error ?? null,
      response: JSON.stringify({ baseline: readiness.baseline, command, after, afterIdentity }), completedAt: confirmed ? new Date() : null,
    }).where(eq(fiscalReportsTable.id, attempt.id));
  } catch (error) {
    await db.update(fiscalReportsTable).set({ status: "unknown", error: "Comunicazione interrotta: verificare la chiusura fisica sulla RT." }).where(eq(fiscalReportsTable.id, attempt.id));
    throw error;
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
    simulated: false,
    numeroChiusura: closure,
    reportId: attempt.id,
    totalsSource: "gestionale",
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
  return res.json({
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

// ── Apertura cassetto manuale ────────────────────────────────────────────────
// Comando RT XonXoff: "1g" o "5G" — apre il cassetto del cassiere
router.post("/open-drawer", requireAdminHeader, async (req, res) => {
  const printer = await getFiscalPrinter();
  if (!printer) {
    return res.status(400).json({ ok: false, error: "Nessuna stampante fiscale configurata" });
  }
  const rtPort = printer.port ?? 1126;
  // Per RT italiane più diffuse, "1g" = apertura cassetto (anche "5G" su alcuni modelli)
  const result = await sendXonXoffCommand(printer.ip, rtPort, "1g", 3000);
  void logAudit({
    req,
    action: "fiscal.drawer_open",
    details: { ok: result.ok, printer: printer.name },
  });
  return res.json({ ok: result.ok, printer: printer.name, error: result.error });
});

// ── Report IVA per aliquota (per data range) ─────────────────────────────────
// GET /api/fiscal/iva-report?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get("/iva-report", async (req, res) => {
  const { from, to } = req.query as { from?: string; to?: string };
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = from ?? today;
  const toDate   = to   ?? today;

  // Aggrega scontrini fiscali raggruppati per aliquota IVA approssimata.
  // L'aliquota viene calcolata da: iva_amount / (importo - iva_amount) * 100
  const result = await db.execute(sql`
    SELECT
      ROUND((iva::numeric * 100.0 / NULLIF((importo::numeric - iva::numeric), 0))::numeric, 0) AS aliquota,
      COUNT(*) AS scontrini,
      SUM((importo::numeric - iva::numeric))::text AS imponibile,
      SUM(iva::numeric)::text AS iva,
      SUM(importo::numeric)::text AS totale
    FROM fiscal_receipts
    WHERE annullato = false
      AND data >= ${fromDate}
      AND data <= ${toDate}
    GROUP BY aliquota
    ORDER BY aliquota DESC
  `);

  // Totali per metodo pagamento
  const byMethod = await db.execute(sql`
    SELECT metodo_pagamento AS metodo, COUNT(*) AS n, SUM(importo::numeric)::text AS totale
    FROM fiscal_receipts
    WHERE annullato = false
      AND data >= ${fromDate}
      AND data <= ${toDate}
    GROUP BY metodo_pagamento
  `);

  res.json({
    from: fromDate,
    to: toDate,
    perAliquota: result.rows,
    perMetodo: byMethod.rows,
  });
});

// ── Lista conti sospesi (paga dopo) ──────────────────────────────────────────
router.get("/sospesi", async (_req, res) => {
  const sospesi = await db.execute(sql`
    SELECT o.id, o.total, o.sospeso_note, o.sospeso_customer_id, o.created_at,
           c.ragione_sociale AS customer_name
    FROM orders o
    LEFT JOIN customers c ON c.id = o.sospeso_customer_id
    WHERE o.sospeso = true AND o.status = 'open'
    ORDER BY o.created_at DESC
  `);
  res.json(sospesi.rows);
});

// ── Pagamento alla Romana ─────────────────────────────────────────────────────
// POST /api/fiscal/romana
// Emette un singolo scontrino fiscale per una quota "alla romana".
// Ogni chiamata emette un scontrino separato sulla RT.
// Se isUltima=true (ultima quota), chiude anche l'ordine nel gestionale.
//
// Body: { orderId, importo, metodoPagamento, quotaNum, quoteTotali, tableName?, isUltima? }
router.post("/romana", async (req, res) => {
  const { orderId, metodoPagamento, quotaNum = 1, quoteTotali = 1 } = req.body;
  if (!Number.isInteger(orderId) || orderId < 1 || !["cash", "card", "other"].includes(metodoPagamento) ||
    !Number.isInteger(quotaNum) || quotaNum < 1 || !Number.isInteger(quoteTotali) || quoteTotali < 1 || quotaNum > quoteTotali) {
    return res.status(400).json({ ok: false, error: "Ordine, metodo o numero quota non validi" });
  }
  const operationId = req.body.operationId ?? randomUUID();
  if (typeof operationId !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(operationId)) return res.status(400).json({ ok: false, error: "Identificativo operazione non valido" });
  let amount: number, expectedPaid: number | undefined, lotteria: string | undefined;
  try {
    amount = cents(req.body.importo);
    expectedPaid = req.body.expectedPaidRomana === undefined ? undefined : cents(req.body.expectedPaidRomana);
    lotteria = normalizeLottery(req.body.lotteria);
  } catch (error) { return res.status(400).json({ ok: false, error: (error as Error).message }); }
  const settings = await getSettings();
  const printer = await getFiscalPrinter();
  try {
    // Serialize quota settlement for a table, including the RT operation.
    // Replays of an operation ID return the recorded result without reprinting.
    const result = await db.transaction(async tx => {
      await tx.execute(sql`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`);
      const [order] = await tx.select().from(ordersTable).where(eq(ordersTable.id, orderId));
      if (!order) return { status: 404, ok: false, error: "Ordine non trovato" };
      const [previous] = await tx.select().from(paymentsTable).where(eq(paymentsTable.operationId, operationId));
      if (previous) {
        if (previous.orderId !== orderId || cents(previous.amount) !== amount || previous.method !== metodoPagamento) {
          return { status: 409, ok: false, error: "Identificativo già usato per un pagamento diverso" };
        }
        return { status: 200, ok: true, rtOk: true, receiptId: previous.fiscalReceiptId, paidRomana: order.paidRomana, remaining: money(Math.max(0, orderDue(order, settings) - cents(order.paidRomana))), orderClosed: order.status === "paid", repeated: true };
      }
      if (order.status !== "open") return { status: 409, ok: false, error: "Il conto non è aperto" };
      let plan;
      try { plan = validateRomana({ due: orderDue(order, settings), paid: cents(order.paidRomana), amount, close: req.body.isUltima === true, expectedPaid }); }
      catch (error) { return { status: 409, ok: false, error: (error as Error).message }; }
      if (!printer) return { status: 503, ok: false, rtOk: false, error: "Nessuna stampante fiscale configurata. Quota non registrata." };
      const tavolo = String(req.body.tableName ?? `ORD.${orderId}`).slice(0, 12);
      const desc = (quoteTotali > 1 ? `QUOTA ${quotaNum}/${quoteTotali} ${tavolo}` : `CONTO ${tavolo}`).slice(0, 32);
      const importo = money(amount);
      const { receipt, rt } = await emettiFiscalReceipt({
        orderId, importo, metodoPagamento, lotteria, printer,
        righe: [{ desc, qta: 1, prezzoUnitario: importo, aliquotaIva: settings[`iva_${order.modalita}`] ?? settings.iva_tavolo ?? "10" }],
      });
      if (!rt.ok) return { status: 502, ok: false, rtOk: false, receiptId: receipt.id, rtError: rt.error, error: "Emissione fiscale non confermata: quota non scalata. Verificare la RT prima di riprovare." };
      await tx.insert(paymentsTable).values({ orderId, method: metodoPagamento, amount: importo, operationId, fiscalReceiptId: receipt.id });
      await tx.update(ordersTable).set({ paidRomana: money(plan.paid), ...(plan.close ? { status: "paid" } : {}) }).where(eq(ordersTable.id, orderId));
      if (plan.close && order.tableId) {
        await tx.execute(sql`UPDATE tables SET status = 'free' WHERE id = ${order.tableId}
          AND NOT EXISTS (SELECT 1 FROM orders WHERE table_id = ${order.tableId} AND status = 'open')`);
      }
      return { status: 200, ok: true, rtOk: true, receiptId: receipt.id, paidRomana: money(plan.paid), remaining: money(plan.remaining), orderClosed: plan.close, quota: { num: quotaNum, total: quoteTotali, importo, metodoPagamento } };
    });
    if (result.ok && !("repeated" in result)) void logAudit({ req, action: "payment.romana", entityType: "order", entityId: orderId, details: { operationId, importo: money(amount), metodoPagamento, quotaNum } });
    return res.status(result.status).json(result);
  } catch (error) {
    console.error("[ROMANA] Errore incasso quota:", error);
    return res.status(502).json({ ok: false, rtOk: false, error: "Incasso non confermato. Verificare documenti RT e storico pagamenti prima di riprovare." });
  }
});

export default router;
