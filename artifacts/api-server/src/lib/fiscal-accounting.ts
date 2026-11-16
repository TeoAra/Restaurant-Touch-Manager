import { db, fiscalReceiptsTable as receipts, invoicesTable as invoices, paymentsTable as payments, fiscalReportsTable } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { closureBoundary, summarizeLedger, reportDay, reportDayStart, vatLedgerReport, type ReportData } from "./report-ledger";

/** Select only accounting columns: never load stored XML or payment snapshots. */
export async function loadReportData(): Promise<ReportData> {
  const [r, i, p] = await Promise.all([
    db.select({ id: receipts.id, orderId: receipts.orderId, importo: receipts.importo, iva: receipts.iva,
      createdAt: receipts.createdAt, emissionStatus: receipts.emissionStatus, annullato: receipts.annullato,
      annullatoAt: receipts.annullatoAt, printerSerial: receipts.printerSerial }).from(receipts),
    db.select({ id: invoices.id, orderId: invoices.orderId, totale: invoices.totale, iva: invoices.iva,
      createdAt: invoices.createdAt, issuedAt: invoices.issuedAt, stato: invoices.stato, tipoDocumento: invoices.tipoDocumento }).from(invoices),
    db.select({ orderId: payments.orderId, amount: payments.amount, method: payments.method,
      operationId: payments.operationId, createdAt: payments.createdAt }).from(payments),
  ]);
  return { receipts: r, invoices: i, payments: p };
}

export async function fiscalAccounting(serial?: string) {
  const reports = await db.select().from(fiscalReportsTable).where(and(
    eq(fiscalReportsTable.type, "Z"), eq(fiscalReportsTable.status, "confirmed"),
    serial ? eq(fiscalReportsTable.printerSerial, serial) : undefined,
  )).orderBy(desc(fiscalReportsTable.createdAt));
  const last = reports.sort((a, b) => closureBoundary(b).getTime() - closureBoundary(a).getTime())[0];
  const to = new Date();
  const data = await loadReportData();
  let source: string | null = null;
  try { source = JSON.parse(last?.response ?? "{}").baseline?.source ?? null; } catch { /* legacy evidence */ }
  const start = last ? closureBoundary(last) : null;
  return {
    ...summarizeLedger(data, start, to),
    rtScopeKnown: !!last && data.receipts.filter(r => (!start || new Date(r.createdAt) >= start) &&
      ["confirmed", "issued"].includes(r.emissionStatus)).every(r => r.printerSerial === last.printerSerial),
    lastClosure: last ? { id: last.id, number: last.numeroChiusura, serial: last.printerSerial, source } : null,
  };
}

export async function accountingVatReport(from?: string, to?: string) {
  const fromDay = from ?? reportDay(new Date());
  const toDay = to ?? fromDay;
  const start = reportDayStart(fromDay);
  const nextDay = new Date(`${toDay}T00:00:00Z`);
  if (!Number.isFinite(nextDay.getTime())) throw new Error("Data non valida");
  reportDayStart(toDay);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const end = reportDayStart(nextDay.toISOString().slice(0, 10));
  if (start >= end) throw new Error("Il periodo non è valido");
  const data = await loadReportData();
  const summary = summarizeLedger(data, start, end);
  return { from: fromDay, to: toDay, perAliquota: vatLedgerReport(data, start, end),
    perMetodo: summary.methods.map(m => ({ metodo: m.method, totale: m.amount })),
    accounting: summary };
}
