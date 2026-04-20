import { Router } from "express";
import { db, fiscalReceiptsTable, ordersTable } from "@workspace/db";
import { printersTable } from "@workspace/db/schema";
import { eq, desc, and, sql } from "drizzle-orm";

const router = Router();

async function getSettings(): Promise<Record<string, string>> {
  const rows = await db.execute(sql`SELECT key, value FROM app_settings`);
  const map: Record<string, string> = {};
  for (const row of rows.rows as { key: string; value: string }[]) {
    map[row.key] = row.value;
  }
  return map;
}

// Restituisce la stampante fiscale attiva (is_fiscale = true, active = true)
async function getFiscalPrinter() {
  const printers = await db.select().from(printersTable)
    .where(and(eq(printersTable.isFiscale, true), eq(printersTable.active, true)))
    .limit(1);
  return printers[0] ?? null;
}

// Invia un comando CGI HTTP alla stampante RT e restituisce il risultato
async function sendCgiCommand(
  ip: string,
  path: string,
  method: "GET" | "POST" = "POST",
  body?: string,
  timeoutMs = 8000
): Promise<{ ok: boolean; status?: number; body?: string; error?: string }> {
  try {
    const url = `http://${ip}${path}`;
    const opts: RequestInit = {
      method,
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (method === "POST" && body) {
      opts.headers = { "Content-Type": "application/x-www-form-urlencoded" };
      opts.body = body;
    }
    const resp = await fetch(url, opts);
    let respBody: string | undefined;
    try { respBody = await resp.text(); } catch { /* ignore */ }
    return { ok: resp.ok, status: resp.status, body: respBody };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

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

export default router;
