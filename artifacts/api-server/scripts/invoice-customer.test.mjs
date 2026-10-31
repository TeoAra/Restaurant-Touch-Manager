import test from "node:test";
import assert from "node:assert/strict";
import { invoiceCustomerError } from "../src/lib/invoice-customer.ts";

const complete = {
  ragioneSociale: "Cliente di prova", partitaIva: "12345678901",
  codiceFiscale: null, indirizzo: "Via Test 1", cap: "00100", comune: "Roma",
};

test("a complete VAT customer does not also require a codice fiscale", () => {
  assert.equal(invoiceCustomerError(complete), null);
});
test("a complete private customer does not require a VAT number", () => {
  assert.equal(invoiceCustomerError({ ...complete, partitaIva: "", codiceFiscale: "RSSMRA80A01H501U" }), null);
});
test("messages list only the fields actually missing for the linked customer", () => {
  const error = invoiceCustomerError({ ...complete, cap: null });
  assert.equal(error, "Cliente collegato «Cliente di prova»: dati mancanti: CAP.");
  assert(!error.includes("P.IVA"));
});
test("missing linkage is different from an incomplete existing customer", () => {
  assert.match(invoiceCustomerError(null), /Cliente collegato non trovato/);
});
test("whitespace is not treated as saved fiscal data", () => {
  assert.match(invoiceCustomerError({ ...complete, partitaIva: "  ", indirizzo: "\n", cap: " ", comune: "" }),
    /codice fiscale oppure P\.IVA, indirizzo, CAP, comune/);
});
