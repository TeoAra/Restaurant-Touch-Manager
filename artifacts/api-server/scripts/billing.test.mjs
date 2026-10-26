// Pure financial and XML checks: no database, payment terminal or fiscal printer.
// node --test artifacts/api-server/scripts/billing.test.mjs (Node 24)
import { test } from "node:test";
import assert from "node:assert/strict";
import { cents, money, invoiceNumber, transmissionId, normalizeLottery, effectiveCoverPrice, orderDue, validateRomana, orderInvoiceLines, invoiceTotals } from "../src/lib/billing.ts";
import { generateFatturaPAXml } from "../src/lib/fatturaPA.ts";

test("manual sezionale/progressivo remain separate from year and transmission ID", () => {
  assert.equal(invoiceNumber({ sezionale: "1", numero: 23, anno: 2026 }), "1/23");
  assert.equal(invoiceNumber({ sezionale: "A", numero: 2, anno: 2026 }), "A/2");
  assert.equal(invoiceNumber({ numero: 23, anno: 2025 }), "2025/0023"); // issued legacy identity
  assert.match(transmissionId(23), /^[A-Z0-9]{5}$/);
});

test("money and lottery boundaries reject malformed values before fiscal operations", () => {
  assert.equal(cents("12,50"), 1250);
  assert.equal(money(1250), "12.50");
  for (const input of [NaN, Infinity, "-1", "1x", "", null, "1.001"]) assert.throws(() => cents(input));
  assert.equal(normalizeLottery(" abcd1234 "), "ABCD1234");
  for (const input of ["ABC", "ABCD-123", "<script>"]) assert.throws(() => normalizeLottery(input));
  assert.equal(normalizeLottery(""), undefined);
});

test("covers are per order, zero-price is explicit and the full amount includes covers", () => {
  const settings = { cover_price: "2.00" };
  assert.equal(effectiveCoverPrice({ coverPrice: null }, settings), 200);
  assert.equal(effectiveCoverPrice({ coverPrice: "0.00" }, settings), 0);
  assert.equal(orderDue({ total: "30.00", covers: 3, coverPrice: "1.50" }, settings), 3450);
  assert.equal(settings.cover_price, "2.00");
});

test("romana records exact cents, subtracts prior payments, preserves an open table", () => {
  assert.deepEqual(validateRomana({ due: 3301, paid: 0, amount: 1100, close: false, expectedPaid: 0 }), { paid: 1100, remaining: 2201, close: false });
  assert.deepEqual(validateRomana({ due: 3301, paid: 1100, amount: 1100, close: false, expectedPaid: 1100 }), { paid: 2200, remaining: 1101, close: false });
  assert.deepEqual(validateRomana({ due: 3301, paid: 2200, amount: 1101, close: true }), { paid: 3301, remaining: 0, close: true });
  assert.deepEqual(validateRomana({ due: 3301, paid: 2200, amount: 1101, close: false }), { paid: 3301, remaining: 0, close: false });
});

test("romana cannot close early, exceed the balance or settle stale concurrent state", () => {
  assert.throws(() => validateRomana({ due: 3300, paid: 1100, amount: 1000, close: true }), /saldare/);
  assert.throws(() => validateRomana({ due: 3300, paid: 1100, amount: 2201, close: false }), /supera/);
  assert.throws(() => validateRomana({ due: 3300, paid: 1100, amount: 100, close: false, expectedPaid: 0 }), /cambiato/);
  assert.throws(() => validateRomana({ due: 3300, paid: 1100, amount: 0, close: false }));
});

test("VAT is extracted from gross menu prices, including the edited cover SKU", () => {
  const rows = orderInvoiceLines([{ productName: "Menu", quantity: 2, unitPrice: "11.00" }], { covers: 2, coverPrice: "1.10", modalita: "tavolo" }, { iva_tavolo: "10", cover_price: "9.00" });
  assert.equal(rows[0].descrizione, "Coperto");
  assert.deepEqual(invoiceTotals(rows), { imponibile: "22.00", iva: "2.20", totale: "24.20" });
  assert(rows.every(r => r.aliquotaIva === "10.00"));
  assert.equal(invoiceTotals(orderInvoiceLines([{ productName: "Birra", quantity: 1, unitPrice: "12.20" }], { covers: 0, modalita: "asporto" }, { iva_asporto: "22" })).totale, "12.20");
});

test("FatturaPA exports 1/23, customer tax IDs, address, lines, VAT and exact payment amounts", () => {
  const rows = orderInvoiceLines([{ productName: "Menu & birra", quantity: 2, unitPrice: "11.00" }], { covers: 0 }, { iva_tavolo: "10" });
  const totals = invoiceTotals(rows);
  const xml = generateFatturaPAXml({
    cedente: { denominazione: "Ristorante Test", partitaIva: "12345678901", indirizzo: "Via Test 1", cap: "00100", comune: "Roma", provincia: "RM", nazione: "IT", regimeFiscale: "RF01" },
    cessionario: { tipo: "azienda", ragioneSociale: "Cliente Test", partitaIva: "10987654321", codiceFiscale: "10987654321", codiceDestinatario: "ABC1234", indirizzo: "Via Cliente 2", cap: "20100", comune: "Milano", provincia: "MI", nazione: "IT" },
    documento: { numero: "1/23", progressivoInvio: transmissionId(23), data: "2026-10-26", tipoDocumento: "TD01", aliquotaIva: "10", ...totals, righe: rows, pagamenti: [{ metodo: "cash", importo: "10.00" }, { metodo: "card", importo: "12.00" }] },
  });
  for (const text of ["<Numero>1/23</Numero>", "<ImportoTotaleDocumento>22.00</ImportoTotaleDocumento>", "<AliquotaIVA>10.00</AliquotaIVA>", "<ImponibileImporto>20.00</ImponibileImporto>", "<Imposta>2.00</Imposta>", "<CodiceDestinatario>ABC1234</CodiceDestinatario>", "<Denominazione>Cliente Test</Denominazione>", "<CodiceFiscale>10987654321</CodiceFiscale>", "<Indirizzo>Via Cliente 2</Indirizzo>", "<Descrizione>Menu &amp; birra</Descrizione>", "<ModalitaPagamento>MP08</ModalitaPagamento>", "<ImportoPagamento>12.00</ImportoPagamento>"]) assert(xml.includes(text), text);
  assert(!xml.includes("1/0000023"));
  assert(!xml.match(/<ProgressivoInvio>[^<]*\//));
});
