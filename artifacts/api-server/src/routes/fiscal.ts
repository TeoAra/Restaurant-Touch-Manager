import { Router } from "express";
import { db, fiscalReceiptsTable, appSettingsTable } from "@workspace/db";
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

router.post("/receipts", async (req, res) => {
  const body = req.body;
  const anno = body.anno ?? new Date().getFullYear();
  const rows = await db.execute(
    sql`SELECT COALESCE(MAX(numero), 0) + 1 AS next FROM fiscal_receipts WHERE anno = ${anno}`
  );
  const numero = Number((rows.rows[0] as { next: number }).next);
  const [receipt] = await db.insert(fiscalReceiptsTable).values({
    numero,
    anno,
    data: body.data ?? new Date().toISOString().slice(0, 10),
    orderId: body.orderId,
    importo: body.importo ?? "0",
    iva: body.iva ?? "0",
    metodoPagamento: body.metodoPagamento ?? "contanti",
    printerRef: body.printerRef,
    printerSerial: body.printerSerial,
  }).returning();
  res.status(201).json(receipt);
});

router.post("/receipts/:id/void", async (req, res) => {
  const id = Number(req.params.id);
  const { motivo } = req.body;
  const [receipt] = await db.update(fiscalReceiptsTable)
    .set({ annullato: true, annullatoAt: new Date(), motivoAnnullo: motivo ?? "Annullo operatore" })
    .where(eq(fiscalReceiptsTable.id, id))
    .returning();
  if (!receipt) return res.status(404).json({ error: "Scontrino non trovato" });

  const settings = await getSettings();
  const dtrIp = settings["dtr_ip"];
  let printerResult = null;
  if (dtrIp) {
    try {
      const resp = await fetch(`http://${dtrIp}/cgi-bin/annullo.cgi`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `numero=${receipt.numero}&data=${receipt.data}&importo=${receipt.importo}`,
        signal: AbortSignal.timeout(5000),
      });
      printerResult = { ok: resp.ok, status: resp.status };
    } catch (e) {
      printerResult = { ok: false, error: String(e) };
    }
  }

  res.json({ receipt, printer: printerResult });
});

router.post("/z-report", async (req, res) => {
  const settings = await getSettings();
  const dtrIp = settings["dtr_ip"];
  const anno = new Date().getFullYear();
  const now = new Date().toISOString().slice(0, 10);

  const totals = await db.execute(sql`
    SELECT COUNT(*) as count, COALESCE(SUM(importo::numeric), 0) as totale
    FROM fiscal_receipts
    WHERE anno = ${anno} AND data = ${now} AND annullato = false
  `);
  const row = totals.rows[0] as { count: string; totale: string };

  let printerResult = null;
  if (dtrIp) {
    try {
      const resp = await fetch(`http://${dtrIp}/cgi-bin/chiusura.cgi`, {
        method: "POST",
        signal: AbortSignal.timeout(8000),
      });
      printerResult = { ok: resp.ok, status: resp.status };
    } catch (e) {
      printerResult = { ok: false, error: String(e) };
    }
  }

  res.json({
    data: now,
    anno,
    scontrini: Number(row.count),
    totale: row.totale,
    printer: printerResult,
    simulated: !dtrIp,
  });
});

router.get("/printer-test", async (req, res) => {
  const settings = await getSettings();
  const dtrIp = settings["dtr_ip"];
  const sewooIp = settings["sewoo_ip"];
  const results: Record<string, unknown> = {};

  if (dtrIp) {
    try {
      const resp = await fetch(`http://${dtrIp}/cgi-bin/stato.cgi`, { signal: AbortSignal.timeout(3000) });
      results.dtr = { ok: resp.ok, status: resp.status, ip: dtrIp };
    } catch (e) {
      results.dtr = { ok: false, error: String(e), ip: dtrIp };
    }
  } else {
    results.dtr = { ok: false, error: "IP non configurato" };
  }

  if (sewooIp) {
    try {
      const resp = await fetch(`http://${sewooIp}`, { signal: AbortSignal.timeout(3000) });
      results.sewoo = { ok: resp.ok, status: resp.status, ip: sewooIp };
    } catch (e) {
      results.sewoo = { ok: false, error: String(e), ip: sewooIp };
    }
  } else {
    results.sewoo = { ok: false, error: "IP non configurato" };
  }

  res.json(results);
});

export default router;
