/**
 * Interfaccia con Registratore Telematico (RT) italiano
 * Protocollo: DTR XonXoff su TCP (porta configurata, default 1126)
 *
 * Specifiche:
 *   - Comandi ASCII 20h–7Fh
 *   - XON (0x11) = RT pronto; XOFF (0x13) = RT in errore / buffer pieno
 *   - Echo: la RT restituisce ogni carattere ricevuto (se abilitato)
 *   - "2X" → risposta stato; "?" → stato scontrino
 *   - Una sola connessione TCP alla volta; timeout 20s dopo primo dato
 *
 * Comandi principali:
 *   "desc"qty*prezzo_centiHdeptR  → Vendita su reparto (prezzo in centesimi)
 *   1T / priceH1T                 → Pagamento contanti (chiude scontrino)
 *   3T / priceH3T                 → Pagamento carta
 *   K                             → Annullo / tasto C
 *   k                             → Annullo scontrino in corso
 *   1F                            → Chiusura fiscale giorno (Z-report)
 *   1f                            → Rapporto finanziario giorno (X-report)
 *   2X                            → Richiesta stato ECR (risposta: AHB…H2X)
 *   ?                             → Stato scontrino (risposta: AHB…HL H?)
 */

import net from "net";
import { db, fiscalReceiptsTable } from "@workspace/db";
import { printersTable } from "@workspace/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { getSettings } from "./settings";

const XON  = 0x11;
const XOFF = 0x13;

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
  rtCode?: string;
}

// ── IVA → Reparto RT ────────────────────────────────────────────────────────
const IVA_TO_DEPT_DEFAULT: Record<string, string> = {
  "22": "1",
  "10": "1",
  "5":  "1",
  "4":  "1",
  "0":  "1",
};
function ivaToRtDept(aliquota: string, deptMap?: Record<string, string>): string {
  const map = deptMap ?? IVA_TO_DEPT_DEFAULT;
  return map[aliquota] ?? map["10"] ?? "1";
}

// ── Metodo pagamento → comando XonXoff ──────────────────────────────────────
function methodToPaymentCmd(method: string): string {
  if (method === "cash") return "1T";  // Contanti
  if (method === "card") return "3T";  // Carta di credito
  return "3T";                         // Default: elettronico
}

// ── Sanifica descrizione per XonXoff ────────────────────────────────────────
// Max 32 char, solo ASCII stampabile (20h-7Fh), no virgolette
function xonDesc(s: string): string {
  return s
    .substring(0, 32)
    .replace(/"/g, "'")
    .replace(/[^\x20-\x7E]/g, " ");
}

// ── Converti importo in centesimi interi ─────────────────────────────────────
function toCentesimi(importo: string | number): number {
  return Math.round(parseFloat(String(importo)) * 100);
}

// ── Restituisce la stampante fiscale attiva ─────────────────────────────────
export async function getFiscalPrinter(): Promise<RtPrinter | null> {
  const printers = await db.select().from(printersTable)
    .where(and(eq(printersTable.isFiscale, true), eq(printersTable.active, true)))
    .limit(1);
  return (printers[0] as unknown as RtPrinter) ?? null;
}

// ── Interfaccia risultato XonXoff ────────────────────────────────────────────
export interface XonXoffResult {
  ok: boolean;
  ms: number;
  ascii: string;          // testo ASCII ricevuto (echo + eventuali risposte)
  xoffCount: number;      // quanti byte XOFF (0x13) ricevuti → contano errori
  error?: string;
}

// ── Stato scontrino da risposta "?" ─────────────────────────────────────────
export interface StatusQ {
  chiusura: number;       // A: numero chiusura corrente
  docCommerciali: number; // B: documenti commerciali giornalieri
  docGestionali: number;  // C: documenti gestionali giornalieri
  resi: number;           // D: resi giornalieri
  annulli: number;        // E: annulli giornalieri
  stato: number;          // F: 0=chiuso 1=aperto 2=pagamento 3=non-fiscale
  totaleScontrino: number;// G
  totalePagato: number;   // H
  totaleGiorno: number;   // I
  totaleProgressivo: number; // L
  raw: string;
}

// ── Stato ECR da risposta "2X" ───────────────────────────────────────────────
export interface Status2X {
  tipoEcr: string;        // A
  matricola: string;      // B
  scontrinoAperto: boolean; // C: 0=chiuso 1=aperto
  nonFiscaleAperto: boolean; // D
  tastieraBloccata: boolean; // E
  errCode: string;        // F: "000"=OK
  carta: boolean;         // G: 0=ok 1=no-paper
  ora: string;            // hhmm
  data: string;           // GGMMAA
  numScontrino: string;   // NNNN
  numChiusura: string;    // ZZZZ
  raw: string;
}

// ── Invia comandi XonXoff via TCP ────────────────────────────────────────────
// Gestisce XON/XOFF software flow-control e raccoglie la risposta.
// waitForResponseMs: tempo dopo invio per raccogliere risposta/echo.
export async function sendXonXoff(
  ip: string,
  port: number,
  cmd: string,
  waitForResponseMs = 3000,
): Promise<XonXoffResult> {
  const t0 = Date.now();
  return new Promise<XonXoffResult>((resolve) => {
    let settled = false;
    let ascii = "";
    let xoffCount = 0;
    let sendDone = false;
    let responseTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (ok: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      if (responseTimer) clearTimeout(responseTimer);
      socket.destroy();
      resolve({ ok, ms: Date.now() - t0, ascii, xoffCount, error });
    };

    const scheduleFinish = () => {
      if (responseTimer) clearTimeout(responseTimer);
      responseTimer = setTimeout(() => finish(xoffCount === 0), waitForResponseMs);
    };

    const socket = new net.Socket();
    // Timeout globale connessione: 20s come da spec Ethernet
    socket.setTimeout(20000);

    socket.connect(port, ip, () => {
      // Attendiamo 150ms l'eventuale XON iniziale (RT lo manda ogni secondo idle)
      setTimeout(() => {
        if (settled) return;
        socket.write(Buffer.from(cmd, "latin1"));
        sendDone = true;
        scheduleFinish();
      }, 150);
    });

    socket.on("data", (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === XOFF) {
          xoffCount++;
        } else if (byte === XON) {
          // XON = pronto, ignora
        } else if (byte >= 0x20 && byte <= 0x7e) {
          ascii += String.fromCharCode(byte);
        }
      }
      // Riavvia il timer ogni volta che arriva un dato (aspetta quiete)
      if (sendDone) scheduleFinish();
    });

    socket.on("end",     () => finish(xoffCount === 0));
    socket.on("timeout", () => finish(xoffCount === 0));
    socket.on("error",   (err: Error) => finish(false, err.message));
  });
}

// ── Parsa risposta "?" ───────────────────────────────────────────────────────
// Formato risposta: AHBHCHDHEHFHGHhHIHLH?  (10 campi H-delimitati + echo "?")
export function parseStatusQ(ascii: string): StatusQ | null {
  // Trova l'ultima occorrenza del pattern "num H ... H?" nel testo ricevuto
  // (potrebbero esserci più "?" nel testo per via dell'echo del comando stesso)
  const match = ascii.match(/(\d+)H(\d+)H(\d+)H(\d+)H(\d+)H(\d+)H([\d.]+)H([\d.]+)H([\d.]+)H([\d.]+)H\?/);
  if (!match) return null;
  return {
    chiusura:          parseInt(match[1]),
    docCommerciali:    parseInt(match[2]),
    docGestionali:     parseInt(match[3]),
    resi:              parseInt(match[4]),
    annulli:           parseInt(match[5]),
    stato:             parseInt(match[6]),
    totaleScontrino:   parseFloat(match[7]),
    totalePagato:      parseFloat(match[8]),
    totaleGiorno:      parseFloat(match[9]),
    totaleProgressivo: parseFloat(match[10]),
    raw: match[0],
  };
}

// ── Parsa risposta "2X" ──────────────────────────────────────────────────────
// Formato: 2X (echo, se echo abilitato) + AHBHCHDHEHFHGHhhmmHGGMMAAHNNNNHZZZZH2X
export function parseStatus2X(ascii: string): Status2X | null {
  // Il record di stato 2X termina con "H2X"
  const match = ascii.match(/(.)H(.{10})H(\d)H(\d)H(\d)H(\d+)H(\d)H(\d{4})H(\d{6})H(\d+)H(\d+)H2X/);
  if (!match) return null;
  return {
    tipoEcr:            match[1],
    matricola:          match[2].trim(),
    scontrinoAperto:    match[3] === "1",
    nonFiscaleAperto:   match[4] === "1",
    tastieraBloccata:   match[5] === "1",
    errCode:            match[6],
    carta:              match[7] === "1",
    ora:                match[8],
    data:               match[9],
    numScontrino:       match[10],
    numChiusura:        match[11],
    raw: match[0],
  };
}

// ── Richiesta stato scontrino ─────────────────────────────────────────────
export async function getStatusQ(ip: string, port: number): Promise<{ ok: boolean; status: StatusQ | null; raw: string }> {
  const res = await sendXonXoff(ip, port, "?", 2500);
  const status = parseStatusQ(res.ascii);
  return { ok: res.xoffCount === 0 && status !== null, status, raw: res.ascii };
}

// ── Richiesta stato ECR ───────────────────────────────────────────────────
export async function getStatus2X(ip: string, port: number): Promise<{ ok: boolean; status: Status2X | null; raw: string }> {
  const res = await sendXonXoff(ip, port, "2X", 2500);
  const status = parseStatus2X(res.ascii);
  return { ok: res.xoffCount === 0 && status !== null, status, raw: res.ascii };
}

// ── Costruisce il comando XonXoff per un documento commerciale ───────────────
// Formato articolo:  "desc"centiH deptR
// Formato pagamento: totaleCentiH 1T  (contanti)  |  totaleCentiH 3T  (carta)
// Lotteria scontrini: "CODICE"L  (deve precedere il pagamento)
export function buildXonXoffReceipt(opts: {
  righe: { desc: string; qta: number; prezzoUnitario: string; aliquotaIva: string }[];
  importo: string;
  metodoPagamento: string;
  deptMap?: Record<string, string>;
  operatore?: string;   // es. "1"  (n del comando "nPPPP"O) — opzionale
  operatorePin?: string; // es. "0000"
  lotteria?: string;    // codice 8 char lotteria scontrini
}): string {
  const { righe, importo, metodoPagamento, deptMap, operatore, operatorePin, lotteria } = opts;
  const parts: string[] = [];

  // Selezione operatore (solo se configurato)
  if (operatore) {
    const pin = operatorePin ?? "";
    parts.push(`"${operatore}${pin}"O`);
  }

  // Righe articolo
  for (const r of righe) {
    const dept = ivaToRtDept(r.aliquotaIva, deptMap);
    const centi = toCentesimi(r.prezzoUnitario);
    const qta = parseFloat(String(r.qta));
    const desc = xonDesc(r.desc);

    // Formato: "desc"[qty*]priceHdeptR
    // Quantità: intera → integer; decimale → con virgola (es. 1,500)
    let qtaStr = "";
    if (!Number.isInteger(qta) || qta !== 1) {
      const qtaFmt = Number.isInteger(qta)
        ? String(Math.round(qta))
        : qta.toFixed(3).replace(".", ",");
      qtaStr = `${qtaFmt}*`;
    }

    parts.push(`"${desc}"${qtaStr}${centi}H${dept}R`);
  }

  // Codice lotteria scontrini (prima del pagamento)
  // Formato XonXoff: "CODICEXXXXXX"L  (max 8 char alfanumerici maiuscoli)
  if (lotteria) {
    const cod = lotteria.toUpperCase().replace(/[^A-Z0-9]/g, "").substring(0, 8);
    if (cod.length === 8) {
      parts.push(`"${cod}"L`);
    }
  }

  // Pagamento + chiusura
  const totaleCenti = toCentesimi(importo);
  const payCmd = methodToPaymentCmd(metodoPagamento);
  parts.push(`${totaleCenti}H${payCmd}`);

  return parts.join("");
}

// ── Invia comando XonXoff generico (per X/Z-report, annullo, ecc.) ───────────
// Corrisponde a sendCgiCommand ma via XonXoff su TCP.
export async function sendXonXoffCommand(
  ip: string,
  port: number,
  cmd: string,
  waitMs = 5000,
): Promise<CgiResult> {
  const res = await sendXonXoff(ip, port, cmd, waitMs);
  return {
    ok: res.ok,
    ms: res.ms,
    body: res.ascii,
    error: res.error,
    rtCode: res.xoffCount > 0 ? `XOFF_${res.xoffCount}` : undefined,
  };
}

// ── Helper: stampa un documento gestionale VERO sulla RT ─────────────────────
// Protocollo DTR XonXoff:
//   j            → APRE il documento gestionale (la RT stampa la sua intestazione)
//   "testo"@     → stampa una riga di testo dentro il documento
//   J            → CHIUDE il documento (la RT stampa il piè di pagina e taglia)
// NOTA: un "@" nudo senza stringa tra virgolette è input non valido → ERRORE 16.
// Il vecchio codice non apriva mai il documento e terminava con "@" nudo:
// per questo mancavano intestazione/coda e la RT andava in ERRORE 16.
async function stampaDocumentoGestionale(
  printer: RtPrinter,
  righeTesto: string[],
  waitMs = 8000,
): Promise<CgiResult> {
  const rtPort = printer.port ?? 1126;

  // Pre-check: se c'è un documento rimasto aperto (fiscale o gestionale)
  // da un tentativo precedente fallito, chiudilo/annullalo prima di aprire.
  const preStatus = await sendXonXoff(printer.ip, rtPort, "?", 2500);
  const preQ = parseStatusQ(preStatus.ascii);
  if (preQ && preQ.stato === 3) {
    console.warn("[GESTIONALE] Documento gestionale rimasto aperto, invio chiusura 'J'...");
    await sendXonXoff(printer.ip, rtPort, "J", 2500);
    await new Promise(r => setTimeout(r, 500));
  } else if (preQ && preQ.stato !== 0) {
    console.warn(`[GESTIONALE] Scontrino aperto (stato=${preQ.stato}), invio annullo 'k'...`);
    await sendXonXoff(printer.ip, rtPort, "k", 2500);
    await new Promise(r => setTimeout(r, 500));
  }

  const cmd = "j" + righeTesto.map(s => `"${xonDesc(s)}"@`).join("") + "J";
  console.log("[GESTIONALE] cmd len=%d righe=%d", cmd.length, righeTesto.length);
  const raw = await sendXonXoff(printer.ip, rtPort, cmd, waitMs);
  console.log("[GESTIONALE] RT ok=%s xoff=%s ascii=%s", raw.ok, raw.xoffCount, raw.ascii.substring(0, 200));
  return {
    ok: raw.xoffCount === 0,
    ms: raw.ms,
    body: raw.ascii,
    error: raw.error ?? (raw.xoffCount > 0 ? `RT errore: ${raw.xoffCount} XOFF` : undefined),
  };
}

// ── Stampa documento gestionale libero (per fatture, note, conferme) ─────────
// Non richiede orderId né metodoPagamento — adatto a documenti non legati a un ordine.
export async function emettiGestionaleLibero(opts: {
  titolo?: string;
  righe: { desc: string; qta: number; prezzoUnitario: string }[];
  totale: string;
  ragioneSociale?: string;
  note?: string;
  printer?: RtPrinter | null;
}): Promise<CgiResult> {
  const printer = opts.printer ?? await getFiscalPrinter();
  if (!printer) return { ok: false, error: "Nessuna stampante fiscale configurata" };

  const { titolo, righe, totale, ragioneSociale, note } = opts;
  const sep = "--------------------------------";
  const lines: string[] = [];

  if (titolo) lines.push(titolo);
  if (ragioneSociale) { lines.push(sep); lines.push(ragioneSociale); }
  lines.push(sep);

  for (const r of righe) {
    const qta = parseFloat(String(r.qta));
    const pu = parseFloat(r.prezzoUnitario);
    const tot = (qta * pu).toFixed(2);
    const desc = xonDesc(r.desc);
    const qtaStr = Number.isInteger(qta) && qta === 1 ? "" : `${Math.round(qta)}x `;
    lines.push(`${qtaStr}${desc}`);
    lines.push(`  EUR ${tot}`);
  }

  lines.push(sep);
  const totNum = parseFloat(totale);
  lines.push(`TOTALE EUR ${(isNaN(totNum) ? 0 : totNum).toFixed(2)}`);
  if (note) lines.push(note);

  return stampaDocumentoGestionale(printer, lines);
}

// ── Stampa copia di cortesia FATTURA sulla RT ────────────────────────────────
// Documento gestionale completo con intestazione fattura: numero, data,
// dati cliente (P.IVA / CF / indirizzo), righe, imponibile, IVA e totale.
// La fattura elettronica vera resta l'XML FatturaPA: questa è solo la copia
// cartacea di cortesia.
export async function emettiFatturaCortesia(opts: {
  numero: string;          // es. "2026/0001"
  data: string;            // ISO "YYYY-MM-DD"
  cliente?: {
    denominazione?: string;
    partitaIva?: string | null;
    codiceFiscale?: string | null;
    indirizzo?: string | null;
    cap?: string | null;
    comune?: string | null;
    provincia?: string | null;
  } | null;
  righe: { desc: string; qta: number; prezzoUnitario: string }[];
  imponibile?: string | null;
  aliquotaIva?: string | null;
  iva?: string | null;
  totale: string;
  printer?: RtPrinter | null;
}): Promise<CgiResult> {
  const printer = opts.printer ?? await getFiscalPrinter();
  if (!printer) return { ok: false, error: "Nessuna stampante fiscale configurata" };

  const { numero, cliente, righe, imponibile, aliquotaIva, iva } = opts;
  const sep = "--------------------------------";
  const lines: string[] = [];

  // Data in formato italiano GG/MM/AAAA
  let dataIt = opts.data;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(opts.data ?? "");
  if (m) dataIt = `${m[3]}/${m[2]}/${m[1]}`;

  lines.push("*** FATTURA ***");
  lines.push("(COPIA DI CORTESIA)");
  lines.push(sep);
  lines.push(`FATTURA N. ${numero}`);
  lines.push(`DATA: ${dataIt}`);

  // ── Dati cliente ──────────────────────────────────────────────────────────
  if (cliente && (cliente.denominazione || cliente.partitaIva || cliente.codiceFiscale)) {
    lines.push(sep);
    lines.push("CLIENTE:");
    if (cliente.denominazione) lines.push(cliente.denominazione);
    if (cliente.partitaIva)    lines.push(`P.IVA: ${cliente.partitaIva}`);
    if (cliente.codiceFiscale) lines.push(`CF: ${cliente.codiceFiscale}`);
    if (cliente.indirizzo)     lines.push(cliente.indirizzo);
    const cittaLine = [cliente.cap, cliente.comune, cliente.provincia ? `(${cliente.provincia})` : ""]
      .filter(Boolean).join(" ").trim();
    if (cittaLine) lines.push(cittaLine);
  }

  lines.push(sep);
  for (const r of righe) {
    const qta = parseFloat(String(r.qta));
    const pu = parseFloat(r.prezzoUnitario);
    const tot = (qta * pu).toFixed(2);
    const desc = xonDesc(r.desc);
    const qtaStr = Number.isInteger(qta) && qta === 1 ? "" : `${Math.round(qta)}x `;
    lines.push(`${qtaStr}${desc}`);
    lines.push(`  EUR ${tot}`);
  }

  // ── Riepilogo importi ─────────────────────────────────────────────────────
  lines.push(sep);
  const impNum = parseFloat(imponibile ?? "");
  if (!isNaN(impNum)) lines.push(`IMPONIBILE EUR ${impNum.toFixed(2)}`);
  const ivaNum = parseFloat(iva ?? "");
  if (!isNaN(ivaNum)) {
    const aliq = aliquotaIva ? `${aliquotaIva}%` : "";
    lines.push(`IVA ${aliq} EUR ${ivaNum.toFixed(2)}`.replace(/\s+/g, " "));
  }
  const totNum = parseFloat(opts.totale);
  lines.push(`TOTALE EUR ${(isNaN(totNum) ? 0 : totNum).toFixed(2)}`);

  lines.push(sep);
  lines.push("FATTURA ELETTRONICA EMESSA");
  lines.push("IN FORMATO XML (FatturaPA)");
  lines.push("COPIA NON VALIDA AI");
  lines.push("FINI FISCALI");

  console.log("[FATTURA-RT] righe=%d numero=%s", lines.length, numero);
  return stampaDocumentoGestionale(printer, lines);
}

// ── Stampa preconto sulla RT (ordine rimane aperto) ───────────────────────────
// Usa il documento gestionale VERO della RT: apertura 'j', righe "testo"@,
// chiusura 'J'. La RT stampa da sola la propria intestazione e il piè di
// pagina "DOCUMENTO GESTIONALE".
export async function emettiPreconto(opts: {
  tavolo?: string;
  coperti?: number;
  righe: { desc: string; qta: number; prezzoUnitario: string }[];
  totale: string;
  ragioneSociale?: string;
  printer?: RtPrinter | null;
}): Promise<CgiResult> {
  const printer = opts.printer ?? await getFiscalPrinter();
  if (!printer) return { ok: false, error: "Nessuna stampante fiscale configurata" };

  const { tavolo, coperti, righe } = opts;

  // Totale difensivo: se il valore arriva NaN usa 0
  const totaleNum = parseFloat(opts.totale);
  const totale = (isNaN(totaleNum) ? 0 : totaleNum).toFixed(2);

  const sep = "--------------------------------";
  const lines: string[] = [];

  lines.push("*** PRECONTO ***");
  lines.push(sep);
  if (tavolo) lines.push(`TAVOLO: ${tavolo}`);
  if (coperti != null && coperti > 0) lines.push(`COPERTI: ${coperti}`);
  if (tavolo || (coperti != null && coperti > 0)) lines.push(sep);

  for (const r of righe) {
    const qta = parseFloat(String(r.qta));
    const pu  = parseFloat(r.prezzoUnitario);
    const tot = (qta * pu).toFixed(2);
    const desc = xonDesc(r.desc);
    const qtaStr = Number.isInteger(qta) && qta === 1 ? "" : `${Math.round(qta)}x `;
    lines.push(`${qtaStr}${desc}`);
    lines.push(`  EUR ${tot}`);
  }

  lines.push(sep);
  lines.push(`TOTALE EUR ${totale}`);
  lines.push(sep);
  lines.push("DOCUMENTO NON VALIDO AI");
  lines.push("FINI FISCALI");

  console.log("[PRECONTO] righe=%d totale=%s", lines.length, totale);
  return stampaDocumentoGestionale(printer, lines);
}

// ── Emetti documento non-fiscale sulla RT ─────────────────────────────────
export async function emettiDocumentoNonFiscale(opts: {
  orderId: number;
  importo: string;
  metodoPagamento: string;
  righe: { desc: string; qta: number; prezzoUnitario: string }[];
  ragioneSociale?: string;
  note?: string;
  printer?: RtPrinter | null;
}): Promise<CgiResult> {
  const { orderId: _orderId, importo, metodoPagamento, righe, ragioneSociale, note } = opts;
  const printer = opts.printer ?? await getFiscalPrinter();

  if (!printer) {
    return { ok: false, error: "Nessuna stampante fiscale configurata" };
  }

  const sep = "--------------------------------";
  const lines: string[] = [];

  lines.push("DOCUMENTO GESTIONALE");
  lines.push(sep);

  for (const r of righe) {
    const qta = parseFloat(String(r.qta));
    const pu = parseFloat(r.prezzoUnitario);
    const tot = (qta * pu).toFixed(2);
    const desc = xonDesc(r.desc);
    const qtaStr = Number.isInteger(qta) && qta === 1 ? "" : `${Math.round(qta)}x `;
    lines.push(`${qtaStr}${desc}`);
    lines.push(`  EUR ${tot}`);
  }

  lines.push(sep);
  const metodo = metodoPagamento === "cash" ? "CONTANTI" : metodoPagamento === "card" ? "CARTA" : "ALTRO";
  const impNum = parseFloat(importo);
  lines.push(`TOTALE EUR ${(isNaN(impNum) ? 0 : impNum).toFixed(2)}`);
  lines.push(`PAGAMENTO: ${metodo}`);
  if (note) lines.push(note);
  if (ragioneSociale) {
    lines.push(sep);
    lines.push(`CLIENTE: ${ragioneSociale}`);
  }
  lines.push(sep);
  lines.push("DOCUMENTO NON VALIDO AI");
  lines.push("FINI FISCALI");

  console.log("[NON-FISCAL] righe=%d importo=%s", lines.length, importo);
  return stampaDocumentoGestionale(printer, lines, 6000);
}

// ── Invia solo il codice lotteria (verifica connettività) ──────────────────
export async function inviaLotteriaRt(ip: string, _codice: string, port = 1126): Promise<CgiResult> {
  // Verifica connettività: chiede stato con "?"
  const res = await sendXonXoff(ip, port, "?", 2000);
  return { ok: res.xoffCount === 0, ms: res.ms, body: res.ascii };
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

  // ── Chiama la RT via XonXoff ──────────────────────────────────────────────
  let rt: CgiResult = { ok: false, error: "Nessuna stampante fiscale configurata" };
  if (printer) {
    const rtPort = printer.port ?? 1126;

    // ── PRE-CHECK: verifica stato RT e annulla eventuale scontrino aperto ──
    // L'errore "01 non consentita" succede quasi sempre perché la RT ha già
    // uno scontrino aperto da un tentativo precedente fallito (connessione
    // interrotta a metà). Prima di aprire un nuovo documento, controlliamo
    // e annulliamo con 'k' se necessario.
    console.log("[FISCAL] Pre-check stato RT...");
    const preStatus = await sendXonXoff(printer.ip, rtPort, "?", 2500);
    const preQ = parseStatusQ(preStatus.ascii);
    console.log(`[FISCAL] Pre-check: stato=${preQ?.stato ?? "?"} ascii=${preStatus.ascii.substring(0, 100)}`);
    if (preQ && preQ.stato === 3) {
      // Documento gestionale rimasto aperto → dentro un doc non fiscale il
      // comando 'k' viene ignorato dalla RT: va chiuso con 'J'.
      console.warn("[FISCAL] Documento gestionale aperto (stato=3), invio chiusura 'J'...");
      const chiusura = await sendXonXoff(printer.ip, rtPort, "J", 2500);
      console.log(`[FISCAL] Chiusura gestionale: xoff=${chiusura.xoffCount} ascii=${chiusura.ascii.substring(0, 60)}`);
      await new Promise(r => setTimeout(r, 500));
    } else if (preQ && preQ.stato !== 0) {
      // Scontrino fiscale aperto → annulla prima di procedere
      console.warn(`[FISCAL] Scontrino aperto (stato=${preQ.stato}), invio annullo 'k'...`);
      const annullo = await sendXonXoff(printer.ip, rtPort, "k", 2500);
      console.log(`[FISCAL] Annullo: xoff=${annullo.xoffCount} ascii=${annullo.ascii.substring(0, 60)}`);
      // Piccola pausa per dare tempo alla RT di tornare a riposo
      await new Promise(r => setTimeout(r, 500));
    }

    // Carica mapping IVA→Reparto dalle impostazioni
    const settings = await getSettings();
    const deptMap: Record<string, string> = {
      "22": settings["rt_reparto_22"] ?? IVA_TO_DEPT_DEFAULT["22"],
      "10": settings["rt_reparto_10"] ?? IVA_TO_DEPT_DEFAULT["10"],
      "5":  settings["rt_reparto_5"]  ?? IVA_TO_DEPT_DEFAULT["5"],
      "4":  settings["rt_reparto_4"]  ?? IVA_TO_DEPT_DEFAULT["4"],
      "0":  settings["rt_reparto_0"]  ?? IVA_TO_DEPT_DEFAULT["0"],
    };

    // Operatore da impostazioni (facoltativo)
    const opNum  = settings["rt_operatore"]     ?? "";
    const opPin  = settings["rt_operatore_pin"] ?? "";

    // Codice lotteria: SOLO da parametro per-pagamento (one-shot dal POS).
    // NB: niente più fallback su settings["lotteria_codice"], altrimenti il codice
    // si riapplicherebbe agli scontrini successivi → RT errore 137 "codice già usato".
    // La pagina di test in backoffice/fiscale può sempre inviare manualmente via
    // /fiscal/lotteria; quello rimane separato e non influenza più i pagamenti.
    const lotteriaCode = lotteria || undefined;

    // Costruisci comando XonXoff
    const cmd = buildXonXoffReceipt({
      righe,
      importo,
      metodoPagamento,
      deptMap,
      operatore:    opNum  || undefined,
      operatorePin: opPin  || undefined,
      lotteria:     lotteriaCode,
    });
    console.log("[FISCAL] XonXoff cmd:", cmd);

    // Invia ricevuta + chiedi stato per verificare chiusura
    const cmdFull = cmd + "?";
    const raw = await sendXonXoff(printer.ip, rtPort, cmdFull, 6000);
    console.log("[FISCAL] RT raw: ok=%s xoff=%s ascii=%s", raw.ok, raw.xoffCount, raw.ascii.substring(0, 200));

    if (raw.xoffCount > 0) {
      rt = { ok: false, ms: raw.ms, body: raw.ascii,
        error: `RT errore XOFF (verifica reparto/operatore sul display RT) — cmd: ${cmd.substring(0, 80)}` };
    } else {
      const statusQ = parseStatusQ(raw.ascii);
      if (statusQ && statusQ.stato === 0) {
        // Scontrino chiuso → successo!
        rt = { ok: true, ms: raw.ms, body: raw.ascii };
      } else if (statusQ && statusQ.stato === 1) {
        // Scontrino ancora aperto → pagamento non andato a buon fine
        rt = { ok: false, ms: raw.ms, body: raw.ascii,
          error: "RT: scontrino ancora aperto dopo il pagamento" };
      } else {
        // Nessuna risposta parsabile → probabilmente OK (modello che non risponde a ?)
        rt = { ok: raw.xoffCount === 0, ms: raw.ms, body: raw.ascii };
      }
    }
  }

  if (!rt.ok) {
    console.error("[FISCAL] RT errore:", rt.error ?? rt.rtCode);
  }

  return { receipt, rt };
}
