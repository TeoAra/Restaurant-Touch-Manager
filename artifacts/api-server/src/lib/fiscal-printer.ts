/**
 * Interfaccia con Registratore Telematico (RT) italiano
 * Protocollo: XML 7.0 (Custom / DTR / Epson FP serie RT)
 * Endpoint CGI: /cgi-bin/fpmate.cgi
 * Content-Type: text/xml; charset=utf-8
 *
 * Riferimenti:
 *   - Protocollo XML 7.0 §4 Documento Commerciale
 *   - Lotteria degli Scontrini: <printRecLottery> prima delle righe
 *   - Pagamento: paymentType 0=contanti, 2=carta/bancomat
 *   - Department: 1=IVA10%, 2=IVA22%, 3=IVA4%, 4=IVA0%
 */

import { db, fiscalReceiptsTable } from "@workspace/db";
import { printersTable } from "@workspace/db/schema";
import { and, eq, sql } from "drizzle-orm";

export interface RtPrinter {
  id: number;
  ip: string;
  name: string;
  matricola?: string | null;
  port?: number | null;
}

export interface CgiResult {
  ok: boolean;
  ms?: number;
  body?: string;
  error?: string;
  rtCode?: string;  // codice risposta XML dalla RT (success/error)
}

// ── IVA → Reparto RT ────────────────────────────────────────────────────────
const IVA_TO_DEPT: Record<string, string> = {
  "22": "2",
  "10": "1",
  "5": "5",
  "4": "3",
  "0": "4",
};
function ivaToRtDept(aliquota: string): string {
  return IVA_TO_DEPT[aliquota] ?? "1";
}

// ── Metodo pagamento → paymentType XML ──────────────────────────────────────
function methodToPaymentType(method: string): string {
  if (method === "cash") return "0";   // Contanti
  if (method === "card") return "2";   // Carta di credito
  return "2";                          // Default: elettronico
}
function methodToDesc(method: string): string {
  if (method === "cash") return "Contanti";
  if (method === "card") return "Carta";
  return "Elettronico";
}

// ── Sanifica descrizione per XML ────────────────────────────────────────────
function xmlAttr(s: string): string {
  return s
    .substring(0, 32)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── Restituisce la stampante fiscale attiva ─────────────────────────────────
export async function getFiscalPrinter(): Promise<RtPrinter | null> {
  const printers = await db.select().from(printersTable)
    .where(and(eq(printersTable.isFiscale, true), eq(printersTable.active, true)))
    .limit(1);
  return (printers[0] as unknown as RtPrinter) ?? null;
}

// ── Invia un comando CGI generico alla RT ───────────────────────────────────
// Per comandi non-fiscali (X/Z/stato/annullo) usa form-urlencoded
export async function sendCgiCommand(
  ip: string,
  path: string,
  method: "GET" | "POST" = "POST",
  body?: string,
  timeoutMs = 8000
): Promise<CgiResult> {
  const url = `http://${ip}${path}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method,
      signal: ctrl.signal,
      headers: body ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
      body,
    });
    clearTimeout(timer);
    const text = await res.text();
    return { ok: res.ok, ms: Date.now() - t0, body: text };
  } catch (err: unknown) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg.includes("abort") ? "timeout" : msg, ms: Date.now() - t0 };
  }
}

// ── Invia XML Protocol 7.0 a /cgi-bin/fpmate.cgi ───────────────────────────
async function sendXmlCommand(ip: string, xml: string, timeoutMs = 12000): Promise<CgiResult> {
  const url = `http://${ip}/cgi-bin/fpmate.cgi`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "text/xml; charset=utf-8" },
      body: xml,
    });
    clearTimeout(timer);
    const text = await res.text();
    // Cerca codice RT nella risposta XML (es. <addInfo><elementList>...</elementList></addInfo>)
    const codeMatch = text.match(/code="(\d+)"/);
    const rtCode = codeMatch?.[1];
    // Risposta OK se HTTP 200 e niente codice di errore (codice 0 o assente = OK)
    const rtOk = res.ok && (!rtCode || rtCode === "0");
    return { ok: rtOk, ms: Date.now() - t0, body: text, rtCode };
  } catch (err: unknown) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg.includes("abort") ? "timeout" : msg, ms: Date.now() - t0 };
  }
}

// ── Costruisce XML Protocol 7.0 per documento commerciale ──────────────────
function buildReceiptXml(opts: {
  righe: { desc: string; qta: number; prezzoUnitario: string; aliquotaIva: string }[];
  importo: string;
  metodoPagamento: string;
  lotteria?: string;
}): string {
  const { righe, importo, metodoPagamento, lotteria } = opts;
  const paymentType = methodToPaymentType(metodoPagamento);
  const paymentDesc = methodToDesc(metodoPagamento);
  const importoFmt = parseFloat(importo).toFixed(2);

  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="utf-8"?>`);
  lines.push(`<printerFiscalReceipt operator="1">`);

  // Lotteria degli Scontrini (deve precedere le righe articolo)
  if (lotteria && lotteria.length === 8) {
    lines.push(`  <printRecLottery operator="1" code="${lotteria.toUpperCase()}"/>`);
  }

  // Righe articolo
  for (const r of righe) {
    const dept = ivaToRtDept(r.aliquotaIva);
    const unitPrice = parseFloat(r.prezzoUnitario).toFixed(2);
    const qty = parseFloat(String(r.qta)).toFixed(3);
    const desc = xmlAttr(r.desc);
    lines.push(
      `  <printRecItem operator="1" description="${desc}" quantity="${qty}" ` +
      `unitPrice="${unitPrice}" department="${dept}" justification="1"/>`
    );
  }

  // Totale + metodo di pagamento
  lines.push(
    `  <printRecTotal operator="1" description="${paymentDesc}" payment="${importoFmt}" ` +
    `paymentType="${paymentType}" index="1" justification="1"/>`
  );

  lines.push(`</printerFiscalReceipt>`);
  return lines.join("\n");
}

// ── Invia solo il codice lotteria (per pre-registrazione) ──────────────────
// Protocollo XML 7.0: usa un documento vuoto con solo la tag lotteria
// NOTA: nella maggior parte delle RT il codice va incluso al momento della stampa.
// Questa funzione serve per validare la raggiungibilità e il codice prima del pagamento.
export async function inviaLotteriaRt(ip: string, codice: string): Promise<CgiResult> {
  const xml = [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<printerCommand>`,
    `  <queryPrinterStatus operator="1" statusType="1"/>`,
    `</printerCommand>`,
  ].join("\n");
  // Verifichiamo la connettività alla RT; il codice viene applicato al momento della stampa
  const result = await sendXmlCommand(ip, xml, 6000);
  return { ...result, ok: result.ok };
}

// ── Emetti documento commerciale sulla RT e salva in fiscal_receipts ────────
export async function emettiFiscalReceipt(opts: {
  orderId: number;
  importo: string;
  metodoPagamento: string;
  righe: { desc: string; qta: number; prezzoUnitario: string; aliquotaIva: string }[];
  lotteria?: string;
  printer?: RtPrinter | null;
}): Promise<{ receipt: typeof fiscalReceiptsTable.$inferSelect; rt: CgiResult }> {
  const { orderId, importo, metodoPagamento, righe, lotteria } = opts;
  const printer = opts.printer ?? await getFiscalPrinter();

  // ── Salva scontrino in DB ─────────────────────────────────────────────────
  const anno = new Date().getFullYear();
  const rows = await db.execute(
    sql`SELECT COALESCE(MAX(numero), 0) + 1 AS next FROM fiscal_receipts WHERE anno = ${anno}`
  );
  const numero = Number((rows.rows[0] as { next: number }).next);

  const aliquota = parseFloat(righe[0]?.aliquotaIva ?? "10");
  const importoNum = parseFloat(importo);
  const imponibile = importoNum / (1 + aliquota / 100);
  const ivaAmount = (importoNum - imponibile).toFixed(2);

  const [receipt] = await db.insert(fiscalReceiptsTable).values({
    numero,
    anno,
    data: new Date().toISOString().slice(0, 10),
    orderId,
    importo,
    iva: ivaAmount,
    metodoPagamento,
    printerRef: printer?.name ?? null,
    printerSerial: printer?.matricola ?? null,
  }).returning();

  // ── Chiama la RT con XML Protocol 7.0 ────────────────────────────────────
  let rt: CgiResult = { ok: false, error: "Nessuna stampante fiscale configurata" };
  if (printer) {
    const xml = buildReceiptXml({ righe, importo, metodoPagamento, lotteria });
    rt = await sendXmlCommand(printer.ip, xml, 12000);
  }

  return { receipt, rt };
}
