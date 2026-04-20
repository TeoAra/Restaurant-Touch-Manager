import { db, fiscalReceiptsTable } from "@workspace/db";
import { printersTable } from "@workspace/db/schema";
import { and, eq, sql } from "drizzle-orm";

export interface RtPrinter {
  id: number;
  ip: string;
  name: string;
  matricola?: string | null;
}

export interface CgiResult {
  ok: boolean;
  ms?: number;
  body?: string;
  error?: string;
}

// ── Restituisce la stampante fiscale attiva ─────────────────────────────────
export async function getFiscalPrinter(): Promise<RtPrinter | null> {
  const printers = await db.select().from(printersTable)
    .where(and(eq(printersTable.isFiscale, true), eq(printersTable.active, true)))
    .limit(1);
  return (printers[0] as unknown as RtPrinter) ?? null;
}

// ── Invia un comando CGI HTTP alla RT ──────────────────────────────────────
export async function sendCgiCommand(
  ip: string,
  path: string,
  method: "GET" | "POST" = "POST",
  body?: string,
  timeoutMs = 6000
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

// ── Calcola il tipo pagamento RT (0=contanti, 1=carta) ─────────────────────
function tipoRt(method: string): number {
  if (method === "cash") return 0;
  return 1; // card / other → carta
}

// ── Emetti documento commerciale sulla RT e salva in fiscal_receipts ────────
export async function emettiFiscalReceipt(opts: {
  orderId: number;
  importo: string;          // importo totale (es. "12.50")
  metodoPagamento: string;  // "cash" | "card" | "other"
  righe: { desc: string; qta: number; prezzoUnitario: string; aliquotaIva: string }[];
  lotteria?: string;        // codice 8 char, opzionale
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

  // ── Chiama la RT ──────────────────────────────────────────────────────────
  let rt: CgiResult = { ok: false, error: "Nessuna stampante fiscale configurata" };
  if (printer) {
    // Costruisci body CGI per documento commerciale
    // Formato compatibile con la maggior parte delle RT italiane (Epson FP, DTR, RCH)
    const params = new URLSearchParams();
    params.set("tipo", "1");           // 1 = documento commerciale
    params.set("n", String(righe.length));
    righe.forEach((r, i) => {
      const idx = i + 1;
      const centesimi = Math.round(parseFloat(r.prezzoUnitario) * parseFloat(String(r.qta)) * 100);
      params.set(`d${idx}`, r.desc.substring(0, 32));
      params.set(`q${idx}`, String(r.qta));
      params.set(`p${idx}`, String(centesimi));   // prezzo riga in centesimi
      params.set(`t${idx}`, r.aliquotaIva);       // aliquota IVA
    });
    params.set("tipo_pag", String(tipoRt(metodoPagamento)));
    params.set("importo", String(Math.round(importoNum * 100)));  // in centesimi
    if (lotteria && lotteria.length === 8) params.set("lotteria", lotteria.toUpperCase());

    rt = await sendCgiCommand(printer.ip, "/cgi-bin/documento.cgi", "POST", params.toString(), 10000);
  }

  return { receipt, rt };
}
