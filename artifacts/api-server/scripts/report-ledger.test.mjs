import test from "node:test";
import assert from "node:assert/strict";
import { buildReportLedger, summarizeLedger, closureBoundary, reportDay, reportDayStart, vatLedgerReport } from "../src/lib/report-ledger.ts";

const moment = (hour, day = "2026-11-15") => `${day}T${hour}:00.000Z`;
const receipt = (patch = {}) => ({ id: 1, orderId: 1, importo: "30.00", iva: "2.73",
  createdAt: moment("22:00"), emissionStatus: "confirmed", annullato: false, annullatoAt: null, ...patch });
const invoice = (patch = {}) => ({ id: 2, orderId: 2, totale: "50.00", iva: "4.55",
  createdAt: moment("23:00"), issuedAt: moment("23:30"), stato: "emessa", tipoDocumento: "TD01", ...patch });
const payment = (patch = {}) => ({ orderId: 2, amount: "50.00", method: "card", operationId: "invoice-2", createdAt: moment("23:15"), ...patch });
const summary = (data, from = moment("21:00"), to = moment("03:00", "2026-11-16")) =>
  summarizeLedger({ receipts: [], invoices: [], payments: [], ...data }, from ? new Date(from) : null, new Date(to));

test("a fiscal service crosses midnight and includes invoices not sent to the RT", () => {
  const result = summary({ receipts: [receipt(), receipt({ id: 2, createdAt: moment("01:00", "2026-11-16") })], invoices: [invoice()] });
  assert.equal(result.rtRecorded, "60.00");
  assert.equal(result.invoices, "50.00");
  assert.equal(result.total, "110.00");
  assert.equal(result.iva, "10.01");
});
test("unknown, pending, transmitting, unverified and legacy documents never masquerade as confirmed RT sales", () => {
  const result = summary({ receipts: ["confirmed", "issued", "unknown", "pending", "transmitting", "unverified", "legacy"].map(emissionStatus => receipt({ emissionStatus })) });
  assert.equal(result.rtRecorded, "60.00");
  assert.equal(result.uncertainCount, 4);
  assert.equal(result.uncertainTotal, "120.00");
  assert.equal(result.legacyTotal, "30.00");
});
test("a paid invoice draft contributes once; an unpaid draft or cancelled invoice contributes nothing", () => {
  const data = { invoices: [invoice({ stato: "bozza", issuedAt: null }), invoice({ id: 3, stato: "bozza" }), invoice({ id: 4, stato: "annullata" })], payments: [payment()] };
  const result = summary(data);
  assert.equal(result.total, "50.00");
  assert.equal(result.paidDrafts, "50.00");
  assert.equal(result.paymentsTotal, "50.00");
  assert.deepEqual(result.methods, [{ method: "card", amount: "50.00" }]);
  const emitted = summary({ ...data, invoices: [invoice({ issuedAt: moment("01:00", "2026-11-16") })] });
  assert.equal(emitted.total, "50.00");
});
test("split receipts remain counted while their table is still open; repeated products do not multiply payments", () => {
  assert.equal(summary({ receipts: [receipt(), receipt({ id: 2, importo: "10.01" })] }).total, "40.01");
  assert.equal(summary({ payments: [payment()] }).total, "0.00");
});
test("invoice and receipt for the same order are not added twice, in either chronological order", () => {
  for (const createdAt of [moment("22:00"), moment("23:45")]) {
    const result = summary({ receipts: [receipt({ orderId: 2, createdAt })], invoices: [invoice()] });
    assert.equal(result.rtRecorded, "30.00");
    assert.equal(result.invoices, "50.00");
    assert.equal(result.overlap, "30.00");
    assert.equal(result.total, "50.00");
  }
});
test("a later invoice does not recount a receipt from the previous fiscal service", () => {
  const result = summary({ receipts: [receipt({ orderId: 2 })], invoices: [invoice({ issuedAt: moment("01:00", "2026-11-16") })] },
    moment("00:00", "2026-11-16"));
  assert.equal(result.rtRecorded, "0.00");
  assert.equal(result.invoices, "50.00");
  assert.equal(result.overlap, "30.00");
  assert.equal(result.total, "20.00");
});
test("voids reduce the period in which cancellation was confirmed, including older receipts", () => {
  const result = summary({ receipts: [receipt({ annullato: true, annullatoAt: moment("01:00", "2026-11-16") })] }, moment("00:00", "2026-11-16"));
  assert.equal(result.rtRecorded, "-30.00");
  assert.equal(result.total, "-30.00");
});
test("credit notes are negative and a reprint never creates a ledger entry", () => {
  const result = summary({ invoices: [invoice(), invoice({ id: 3, tipoDocumento: "TD04", totale: "10.00", iva: "0.91" })] });
  assert.equal(result.invoices, "40.00");
  assert.equal(result.iva, "3.64");
});
test("service boundaries are half-open, include all history without a prior closure and use integer cents", () => {
  const data = { receipts: [receipt({ importo: "0.10", createdAt: moment("21:00") }), receipt({ importo: "0.20" }), receipt({ createdAt: moment("03:00", "2026-11-16") })] };
  assert.equal(summary(data).total, "0.30");
  assert.equal(summary({ receipts: [receipt()] }, null).total, "30.00");
  assert.throws(() => buildReportLedger({ receipts: [receipt({ importo: "not-money" })], invoices: [], payments: [] }), /non valido/);
});
test("invoice attribution follows payment/emission, not the creation of an unpaid draft", () => {
  assert.equal(summary({ invoices: [invoice({ createdAt: "2026-10-01T12:00:00Z", issuedAt: moment("23:00") })] }).total, "50.00");
  assert.equal(summary({ invoices: [invoice({ createdAt: "2026-10-01T12:00:00Z", issuedAt: null })] }).historicalInvoiceDates, false);
  assert.equal(summary({ invoices: [invoice({ issuedAt: null })] }).historicalInvoiceDates, true);
});
test("reconciling an old Z today does not move its service boundary to today", () => {
  const report = { createdAt: moment("22:00"), completedAt: "2026-11-30T10:00:00Z", response: JSON.stringify({ accounting: { to: moment("23:00") } }) };
  assert.equal(closureBoundary(report).toISOString(), moment("23:00"));
  assert.equal(closureBoundary({ ...report, response: "old-response" }).toISOString(), moment("22:00"));
});
test("calendar statistics use Italian days, including DST changes", () => {
  assert.equal(reportDay("2026-11-15T23:30:00Z"), "2026-11-16");
  assert.equal(reportDayStart("2026-11-16").toISOString(), "2026-11-15T23:00:00.000Z");
  assert.equal(reportDayStart("2026-07-16").toISOString(), "2026-07-15T22:00:00.000Z");
  assert.equal(reportDayStart("2026-03-29").toISOString(), "2026-03-28T23:00:00.000Z");
  assert.equal(reportDayStart("2026-10-25").toISOString(), "2026-10-24T22:00:00.000Z");
  assert.throws(() => reportDayStart("2026-02-30"), /non valida/);
});
test("VAT management totals use the same invoice and RT ledger, with no duplicated revenue", () => {
  const data = { receipts: [receipt({ orderId: 2 })], invoices: [invoice()], payments: [] };
  const rows = vatLedgerReport(data, new Date(moment("21:00")), new Date(moment("03:00", "2026-11-16")));
  assert.equal(rows.reduce((s, r) => s + Number(r.totale), 0).toFixed(2), "50.00");
  assert.equal(rows.reduce((s, r) => s + Number(r.iva), 0).toFixed(2), "4.55");
});
