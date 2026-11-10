import test from "node:test";
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { customersTable, insertCustomerSchema } from "../../../lib/db/src/schema/customers.ts";
import { normalizeCustomerInput } from "../src/lib/customer-input.ts";
import { invoiceCustomerError } from "../src/lib/invoice-customer.ts";

const db = drizzle({ query() { throw new Error("Tests must never access the database"); } });
const existing = {
  id: 41, tipo: "azienda", ragioneSociale: "Cliente test",
  partitaIva: "12345678901", codiceFiscale: "", codiceDestinatario: "ABC1234",
  pec: "test@example.invalid", indirizzo: "Via Test 1", cap: "00100",
  comune: "Roma", provincia: "RM", nazione: "IT",
  telefono: "000000", email: "test@example.invalid", note: "Nota cliente",
  createdAt: "2026-01-01T10:00:00.000Z", updatedAt: "2026-01-02T10:00:00.000Z",
};

test("reproduce the original ISO timestamp round-trip failure without database writes", () => {
  assert.throws(() => db.update(customersTable).set({ ...existing, updatedAt: new Date() }).toSQL(), /toISOString/);
});
test("saving a GET customer response strips metadata and preserves all optional data", () => {
  const body = insertCustomerSchema.partial().parse(existing);
  for (const key of ["id", "createdAt", "updatedAt"]) assert(!Object.hasOwn(body, key), key);
  for (const [key, value] of Object.entries(existing)) {
    if (!["id", "createdAt", "updatedAt"].includes(key)) assert.equal(body[key], value, key);
  }
  const query = db.update(customersTable).set({ ...body, updatedAt: new Date() }).where(eq(customersTable.id, 41)).toSQL();
  assert(query.params.includes("ABC1234"));
  assert(query.params.includes("Via Test 1"));
  assert(!query.sql.includes('"created_at" ='));
});
test("a partial SDI edit must not default or erase any omitted fields", () => {
  assert.deepEqual(insertCustomerSchema.partial().parse({ codiceDestinatario: "NEW1234" }), { codiceDestinatario: "NEW1234" });
});
test("optional fields can stay blank or be explicitly cleared without becoming mandatory", () => {
  assert.equal(insertCustomerSchema.safeParse({ ragioneSociale: "Cliente test" }).success, true);
  assert.deepEqual(insertCustomerSchema.partial().parse({ pec: "", indirizzo: null, codiceDestinatario: "" }), {
    pec: "", indirizzo: null, codiceDestinatario: "",
  });
});
test("invalid customer field types fail explicitly rather than silently dropping edits", () => {
  assert.equal(insertCustomerSchema.partial().safeParse({ cap: 100 }).success, false);
  assert.equal(insertCustomerSchema.partial().safeParse({ ragioneSociale: null }).success, false);
});
test("legacy front-office address and SDI aliases survive creation and SQL insertion", () => {
  const legacy = { ragioneSociale: "Cliente VIES test", partitaIva: "12345678901", sdiCode: "ABC1234",
    indirizzoVia: "Via Test 12", indirizzoCap: "00100", indirizzoComune: "Roma", indirizzoProvince: "RM" };
  // This reproduces precisely why the old client lost the values silently.
  const before = insertCustomerSchema.parse(legacy);
  assert.equal(before.indirizzo, undefined);
  assert.equal(before.codiceDestinatario, undefined);
  const body = insertCustomerSchema.parse(normalizeCustomerInput(legacy));
  assert.equal(body.codiceDestinatario, "ABC1234");
  assert.equal(body.indirizzo, "Via Test 12");
  assert.equal(body.cap, "00100");
  assert.equal(body.comune, "Roma");
  assert.equal(body.provincia, "RM");
  assert.equal(invoiceCustomerError(body), null, "Saved address must pass the real invoice customer validation");
  const query = db.insert(customersTable).values(body).toSQL();
  for (const value of ["ABC1234", "Via Test 12", "00100", "Roma", "RM"]) assert(query.params.includes(value));
  for (const alias of ["sdiCode", "indirizzoVia", "indirizzoCap", "indirizzoComune", "indirizzoProvince"]) assert(!Object.hasOwn(body, alias));
});
test("legacy partial edits do not erase omitted fields and canonical explicit clears take precedence", () => {
  assert.deepEqual(insertCustomerSchema.partial().parse(normalizeCustomerInput({ sdiCode: "XYZ9876" })), { codiceDestinatario: "XYZ9876" });
  assert.deepEqual(insertCustomerSchema.partial().parse(normalizeCustomerInput({
    sdiCode: "OLD1234", codiceDestinatario: "", indirizzoVia: "Old address", indirizzo: null,
  })), { codiceDestinatario: "", indirizzo: null });
  assert.equal(insertCustomerSchema.partial().safeParse(normalizeCustomerInput({ indirizzoCap: 100 })).success, false);
});
