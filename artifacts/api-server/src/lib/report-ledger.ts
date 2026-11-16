/** Pure accounting projection. Never talks to the RT and never repeats a payment. */
type Moment = Date | string;
type Receipt = {
  id: number; orderId: number | null; importo: string; iva: string; createdAt: Moment;
  emissionStatus: string; annullato: boolean; annullatoAt: Moment | null;
  printerSerial?: string | null;
};
type Invoice = {
  id: number; orderId: number | null; totale: string; iva: string; createdAt: Moment;
  issuedAt?: Moment | null; stato: string; tipoDocumento: string;
};
type Payment = { orderId: number; amount: string; method: string; operationId: string | null; createdAt: Moment };
export type ReportData = { receipts: Receipt[]; invoices: Invoice[]; payments: Payment[] };
export const reportDay = (at: Moment) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome",
  year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
export function reportDayStart(day: string): Date {
  const utc = new Date(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(utc.getTime()) || utc.toISOString().slice(0, 10) !== day) {
    throw new Error("Data non valida");
  }
  const offset = new Intl.DateTimeFormat("en", { timeZone: "Europe/Rome", timeZoneName: "longOffset" })
    .formatToParts(utc).find(p => p.type === "timeZoneName")!.value.replace("GMT", "");
  return new Date(`${day}T00:00:00${offset}`);
}
const minor = (value: string) => {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error("Importo contabile non valido");
  return Math.round(n * 100);
};
const money = (value: number) => (value / 100).toFixed(2);
const time = (value: Moment) => new Date(value).getTime();
const proven = (status: string) => status === "confirmed" || status === "issued";

export function buildReportLedger(data: ReportData) {
  const entries: { at: number; rt: number; invoice: number; overlap: number; revenue: number; iva: number; draft: number }[] = [];
  const events: { at: number; orderId: number | null; rt: number; invoice: number; iva: number; draft: number }[] = [];
  for (const r of data.receipts) {
    if (!proven(r.emissionStatus)) continue;
    events.push({ at: time(r.createdAt), orderId: r.orderId, rt: minor(r.importo), invoice: 0, iva: minor(r.iva), draft: 0 });
    if (r.annullato && r.annullatoAt) events.push({
      at: time(r.annullatoAt), orderId: r.orderId, rt: -minor(r.importo), invoice: 0, iva: -minor(r.iva), draft: 0,
    });
    // Old voids without a timestamp cannot be assigned to a later shift.
    else if (r.annullato) events.pop();
  }
  const invoicePayments = new Map<string, Payment>();
  for (const payment of data.payments) {
    if (payment.operationId?.startsWith("invoice-") && !invoicePayments.has(payment.operationId)) invoicePayments.set(payment.operationId, payment);
  }
  for (const inv of data.invoices) {
    if (inv.stato === "annullata") continue;
    const payment = invoicePayments.get(`invoice-${inv.id}`);
    if (inv.stato !== "emessa" && !payment) continue;
    const sign = inv.tipoDocumento === "TD04" ? -1 : 1;
    const issuedAt = time(inv.issuedAt ?? inv.createdAt);
    // A paid draft is real collected turnover even before XML creation.
    const at = payment ? Math.min(time(payment.createdAt), inv.stato === "emessa" ? issuedAt : Infinity) : issuedAt;
    events.push({ at, orderId: sign < 0 ? null : inv.orderId, rt: 0, invoice: sign * minor(inv.totale),
      iva: sign * minor(inv.iva), draft: inv.stato === "bozza" ? minor(inv.totale) : 0 });
  }
  // Count a sale once even if an invoice is subsequently issued for its receipts.
  // Allocate the overlap when the second document actually appears, not to an
  // arbitrary calendar day; this works across midnight and across Z closures.
  const orders = new Map<number, { rt: number; invoice: number; ivaRt: number; ivaInvoice: number }>();
  for (const event of events.sort((a, b) => a.at - b.at)) {
    let overlap = 0;
    let ivaOverlap = 0;
    if (event.orderId != null) {
      const prev = orders.get(event.orderId) ?? { rt: 0, invoice: 0, ivaRt: 0, ivaInvoice: 0 };
      const next = { rt: prev.rt + event.rt, invoice: prev.invoice + event.invoice,
        ivaRt: prev.ivaRt + (event.rt ? event.iva : 0), ivaInvoice: prev.ivaInvoice + (event.invoice ? event.iva : 0) };
      overlap = Math.min(next.rt, next.invoice) - Math.min(prev.rt, prev.invoice);
      ivaOverlap = Math.min(next.ivaRt, next.ivaInvoice) - Math.min(prev.ivaRt, prev.ivaInvoice);
      orders.set(event.orderId, next);
    }
    entries.push({ at: event.at, rt: event.rt, invoice: event.invoice, overlap,
      revenue: event.rt + event.invoice - overlap, iva: event.iva - ivaOverlap, draft: event.draft });
  }
  return entries;
}

export function summarizeLedger(data: ReportData, from: Date | null, to: Date) {
  const start = from?.getTime() ?? -Infinity;
  const end = to.getTime();
  const inside = (at: Moment) => time(at) >= start && time(at) < end;
  const entries = buildReportLedger(data).filter(e => e.at >= start && e.at < end);
  const sum = (field: "rt" | "invoice" | "overlap" | "revenue" | "iva" | "draft") => money(entries.reduce((s, e) => s + e[field], 0));
  const receipts = data.receipts.filter(r => inside(r.createdAt));
  const payments = data.payments.filter(p => inside(p.createdAt));
  const methods = new Map<string, number>();
  for (const p of payments) {
    const method = ({ contanti: "cash", bancomat: "card", carta: "card" } as Record<string, string>)[p.method] ?? p.method;
    methods.set(method, (methods.get(method) ?? 0) + minor(p.amount));
  }
  const uncertain = receipts.filter(r => !proven(r.emissionStatus) && r.emissionStatus !== "legacy" && !r.annullato);
  const legacy = receipts.filter(r => r.emissionStatus === "legacy" && !r.annullato);
  return {
    from: from?.toISOString() ?? null, to: to.toISOString(),
    rtRecorded: sum("rt"), invoices: sum("invoice"), overlap: sum("overlap"),
    total: sum("revenue"), iva: sum("iva"), paidDrafts: sum("draft"),
    receiptsCount: receipts.filter(r => proven(r.emissionStatus) && !r.annullato).length,
    uncertainTotal: money(uncertain.reduce((s, r) => s + minor(r.importo), 0)), uncertainCount: uncertain.length,
    legacyTotal: money(legacy.reduce((s, r) => s + minor(r.importo), 0)),
    paymentsTotal: money(payments.reduce((s, p) => s + minor(p.amount), 0)),
    methods: [...methods].map(([method, amount]) => ({ method, amount: money(amount) })),
    historicalInvoiceDates: data.invoices.some(inv => inv.stato === "emessa" && !inv.issuedAt && inside(inv.createdAt)),
  };
}

export function vatLedgerReport(data: ReportData, from: Date, to: Date) {
  const groups = new Map<string, { gross: number; vat: number; count: number }>();
  for (const e of buildReportLedger(data)) {
    if (e.at < from.getTime() || e.at >= to.getTime() || (!e.revenue && !e.iva)) continue;
    const base = e.revenue - e.iva;
    // Effective document-level rate only: original RT receipts don't retain
    // individual VAT buckets. Never advertise this as the official RT VAT split.
    const rate = base ? String(Math.round(e.iva * 100 / base)) : "0";
    const group = groups.get(rate) ?? { gross: 0, vat: 0, count: 0 };
    groups.set(rate, { gross: group.gross + e.revenue, vat: group.vat + e.iva, count: group.count + 1 });
  }
  return [...groups].sort(([a], [b]) => Number(b) - Number(a)).map(([aliquota, group]) => ({
    aliquota, imponibile: money(group.gross - group.vat), iva: money(group.vat),
    totale: money(group.gross), orders: group.count, scontrini: group.count,
  }));
}

/** The period ends at the attempt, never at a delayed reconciliation date. */
export function closureBoundary(report: { createdAt: Moment; response: string | null }): Date {
  let evidence;
  try { evidence = JSON.parse(report.response ?? "{}"); } catch { /* older record */ }
  const value = evidence?.accounting?.to;
  const date = value ? new Date(value) : new Date(report.createdAt);
  return Number.isFinite(date.getTime()) ? date : new Date(report.createdAt);
}
