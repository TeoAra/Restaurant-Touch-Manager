import test from "node:test";
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { customersTable, insertCustomerSchema } from "../../../lib/db/src/schema/customers.ts";

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
