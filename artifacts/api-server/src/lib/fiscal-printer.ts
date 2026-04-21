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

import net from "net";
import { db, fiscalReceiptsTable } from "@workspace/db";
import { printersTable } from "@workspace/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { getSettings } from "./settings";

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
// Default: tutto reparto 1. Chi ha più reparti configura da Backoffice → Gestione Fiscale → Reparti RT
const IVA_TO_DEPT_DEFAULT: Record<string, string> = {
  "22": "1",
  "10": "1",
  "5": "1",
  "4": "1",
  "0": "1",
};
function ivaToRtDept(aliquota: string, deptMap?: Record<string, string>): string {
  const map = deptMap ?? IVA_TO_DEPT_DEFAULT;
  return map[aliquota] ?? map["10"] ?? "1";
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
  timeoutMs = 8000,
  port = 80
): Promise<CgiResult> {
  const portStr = port && port !== 80 ? `:${port}` : "";
  const url = `http://${ip}${portStr}${path}`;
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

// ── Invia XML Protocol 7.0 — doppia modalità: HTTP/CGI + fallback TCP raw ───
// La RT risponde via HTTP/CGI su /cgi-bin/fpmate.cgi (protocollo corretto).
// Se HTTP fallisce tenta TCP raw diretto sulla stessa porta.
export async function sendXmlCommand(ip: string, xml: string, timeoutMs = 15000, port = 80): Promise<CgiResult> {
  const t0 = Date.now();
  const portStr = port !== 80 ? `:${port}` : "";
  const url = `http://${ip}${portStr}/cgi-bin/fpmate.cgi`;

  // ── Tentativo 1: HTTP/CGI su porta RT (con timeout breve) ──────────────
  // La RT su porta 1126 risponde HTTP se riceve header HTTP, altrimenti raw TCP.
  // Proviamo prima HTTP (dà errori XML precisi come code="13", code="46"…).
  try {
    const HTTP_TIMEOUT = Math.min(4000, timeoutMs - 500);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT);
    const res = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "Connection": "close",
      },
      body: xml,
    });
    clearTimeout(timer);
    const text = await res.text();
    console.log("[FISCAL] HTTP risposta grezza:", text.substring(0, 400));
    const codeMatch = text.match(/code="(\d+)"/);
    const rtCode = codeMatch?.[1];
    const rtOk = res.ok && (!rtCode || rtCode === "0");
    return { ok: rtOk, ms: Date.now() - t0, body: text, rtCode };
  } catch (httpErr: unknown) {
    const httpMsg = httpErr instanceof Error ? httpErr.message : String(httpErr);
    console.log("[FISCAL] HTTP fallito (%s) → TCP raw", httpMsg);
  }

  // ── Tentativo 2: TCP raw ────────────────────────────────────────────────
  // La RT su porta 1126 riceve XML grezzo e risponde con:
  //   {echoXml}{statusBitmap}H{errCode}H…H?
  // NON chiamare socket.end() dopo write — la RT chiude lei quando ha finito.
  // Attesa greeting: la RT può mandare un saluto iniziale (GREETING_WAIT_MS ms).
  const GREETING_WAIT_MS = 400;
  const elapsed = Date.now() - t0;
  const remaining = Math.max(5000, timeoutMs - elapsed);

  return new Promise<CgiResult>((resolve) => {
    let resolved = false;
    let greetingReceived = false;
    let responseData = "";
    let greetingTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (result: CgiResult) => {
      if (resolved) return;
      resolved = true;
      if (greetingTimer) clearTimeout(greetingTimer);
      socket.destroy();
      resolve(result);
    };

    const sendCommand = () => {
      greetingReceived = true;
      socket.write(Buffer.from(xml, "utf-8"));
      // NON chiamare socket.end() — la RT chiude la connessione quando ha risposto
    };

    const parseTcp = (): CgiResult => {
      if (!responseData) return { ok: false, error: "nessuna risposta TCP", ms: Date.now() - t0 };
      const hMatch = responseData.match(/>\s*(\d+)H(\d+)H/);
      const hCode  = hMatch && hMatch[2] !== "0" ? hMatch[2] : undefined;
      const xmlMatch = !hMatch ? responseData.match(/code="(\d+)"/) : null;
      const xmlCode  = xmlMatch && xmlMatch[1] !== "0" ? xmlMatch[1] : undefined;
      const errCode  = hCode ?? xmlCode;
      console.log("[FISCAL] TCP risposta: errCode=%s raw=%s", errCode ?? "OK", responseData.substring(0, 300));
      return { ok: !errCode, ms: Date.now() - t0, body: responseData, rtCode: errCode };
    };

    const socket = new net.Socket();
    socket.setTimeout(remaining);

    socket.connect(port, ip, () => {
      greetingTimer = setTimeout(() => {
        if (!greetingReceived) sendCommand();
      }, GREETING_WAIT_MS);
    });

    socket.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      if (!greetingReceived) {
        // Greeting dalla RT — mandiamo subito il comando
        if (greetingTimer) { clearTimeout(greetingTimer); greetingTimer = null; }
        sendCommand();
        // Il greeting non fa parte della risposta, ignoriamolo
      } else {
        responseData += text;
      }
    });

    socket.on("end",     () => finish(parseTcp()));
    socket.on("timeout", () => finish(parseTcp()));
    socket.on("error", (err: Error) => {
      if (responseData) finish(parseTcp());
      else finish({ ok: false, error: err.message, ms: Date.now() - t0 });
    });
  });
}

// ── Costruisce XML Protocol 7.0 per documento commerciale ──────────────────
function buildReceiptXml(opts: {
  righe: { desc: string; qta: number; prezzoUnitario: string; aliquotaIva: string }[];
  importo: string;
  metodoPagamento: string;
  lotteria?: string;
  deptMap?: Record<string, string>;
}): string {
  const { righe, importo, metodoPagamento, lotteria, deptMap } = opts;
  const paymentType = methodToPaymentType(metodoPagamento);
  const paymentDesc = methodToDesc(metodoPagamento);
  const importoFmt = parseFloat(importo).toFixed(2);

  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="utf-8"?>`);
  // NOTA: operator NON va sul tag radice per Custom/DTR — va sui singoli comandi
  lines.push(`<printerFiscalReceipt>`);

  // beginFiscalReceipt apre la transazione (obbligatorio per Custom/DTR)
  lines.push(`  <beginFiscalReceipt operator="1"/>`);

  // Lotteria degli Scontrini (deve precedere le righe articolo)
  if (lotteria && lotteria.length === 8) {
    lines.push(`  <printRecLottery operator="1" code="${lotteria.toUpperCase()}"/>`);
  }

  // Righe articolo
  for (const r of righe) {
    const dept = ivaToRtDept(r.aliquotaIva, deptMap);
    const unitPrice = parseFloat(r.prezzoUnitario).toFixed(2);
    // qty: intero se senza decimali, altrimenti 3 decimali
    const qtyNum = parseFloat(String(r.qta));
    const qty = Number.isInteger(qtyNum) ? String(qtyNum) : qtyNum.toFixed(3);
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

  // endFiscalReceipt chiude la transazione e stampa lo scontrino
  lines.push(`  <endFiscalReceipt operator="1"/>`);

  lines.push(`</printerFiscalReceipt>`);
  return lines.join("\n");
}

// ── Invia solo il codice lotteria (per pre-registrazione) ──────────────────
// Protocollo XML 7.0: usa un documento vuoto con solo la tag lotteria
// NOTA: nella maggior parte delle RT il codice va incluso al momento della stampa.
// Questa funzione serve per validare la raggiungibilità e il codice prima del pagamento.
export async function inviaLotteriaRt(ip: string, codice: string, port = 80): Promise<CgiResult> {
  const xml = [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<printerCommand>`,
    `  <queryPrinterStatus operator="1" statusType="1"/>`,
    `</printerCommand>`,
  ].join("\n");
  // Verifichiamo la connettività alla RT; il codice viene applicato al momento della stampa
  const result = await sendXmlCommand(ip, xml, 6000, port);
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

  // ── Carica mapping IVA→Reparto dalle impostazioni ────────────────────────
  const settings = await getSettings();
  const deptMap: Record<string, string> = {
    "22": settings["rt_reparto_22"] ?? IVA_TO_DEPT_DEFAULT["22"],
    "10": settings["rt_reparto_10"] ?? IVA_TO_DEPT_DEFAULT["10"],
    "5":  settings["rt_reparto_5"]  ?? IVA_TO_DEPT_DEFAULT["5"],
    "4":  settings["rt_reparto_4"]  ?? IVA_TO_DEPT_DEFAULT["4"],
    "0":  settings["rt_reparto_0"]  ?? IVA_TO_DEPT_DEFAULT["0"],
  };

  // ── Chiama la RT con XML Protocol 7.0 ────────────────────────────────────
  let rt: CgiResult = { ok: false, error: "Nessuna stampante fiscale configurata" };
  if (printer) {
    const rtPort = printer.port ?? 80;
    const xml = buildReceiptXml({ righe, importo, metodoPagamento, lotteria, deptMap });
    console.log("[FISCAL] XML inviato alla RT:\n" + xml);
    rt = await sendXmlCommand(printer.ip, xml, 15000, rtPort);
    console.log("[FISCAL] RT risposta: ok=%s rtCode=%s body=%s", rt.ok, rt.rtCode ?? "OK", (rt.body ?? rt.error ?? "nessuna risposta").substring(0, 200));
  }

  return { receipt, rt };
}
