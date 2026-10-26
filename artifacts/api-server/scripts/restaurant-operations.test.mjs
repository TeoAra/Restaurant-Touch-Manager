import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

async function load(relative) {
  const entry = fileURLToPath(new URL(relative, import.meta.url));
  const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: "node", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const bookings = await load("../src/lib/reservations.ts");
const fiscal = await load("../src/lib/fiscal-identity.ts");
const sessions = await load("../src/lib/staff-session.ts");
const slot = { id: 1, date: "2026-10-26", time: "20:00", durationMinutes: 120, status: "confirmed", tableId: 1, tableIds: "[1,2]" };
const valid = { ...slot, guestName: "Cliente", covers: 2, phone: "+39 123456789" };

test("booking validates real dates, times, covers, duration and status", () => {
  assert.equal(bookings.validateBooking(valid), null);
  for (const change of [{ date: "2026-02-30" }, { time: "24:10" }, { covers: 0 }, { covers: 1.5 }, { durationMinutes: 0 }, { status: "paid" }, { guestName: " " }, { phone: "not-a-phone" }]) {
    assert.ok(bookings.validateBooking({ ...valid, ...change }), JSON.stringify(change));
  }
});
test("overlapping reservations detect every assigned table, not only primary", () => {
  assert.equal(bookings.bookingConflict({ ...slot, id: 2, tableIds: "[2]", time: "21:00" }, [slot])?.id, 1);
  assert.equal(bookings.bookingConflict({ ...slot, id: 2, tableIds: "[3]" }, [slot]), undefined);
});
test("adjacent slots and editing the same booking do not conflict", () => {
  assert.equal(bookings.bookingConflict({ ...slot, id: 2, time: "22:00" }, [slot]), undefined);
  assert.equal(bookings.bookingConflict(slot, [slot]), undefined);
});
test("pending, completed and cancelled requests do not occupy tables", () => {
  for (const status of ["pending", "completed", "cancelled", "noshow"]) {
    assert.equal(bookings.bookingConflict({ ...slot, id: 2 }, [{ ...slot, status }]), undefined);
    assert.equal(bookings.bookingConflict({ ...slot, id: 2, status }, [slot]), undefined);
  }
});
test("cross-midnight bookings still block the same table", () => {
  assert.ok(bookings.bookingConflict({ ...slot, id: 2, date: "2026-10-27", time: "00:30" }, [{ ...slot, time: "23:30" }]));
});
test("RT void requires real closure, document and date; never uses an internal sequence", () => {
  for (const input of [{}, { numero: 42, anno: 2026 }, { numeroChiusura: 1, numeroDocumentoRt: 0, dataDocumento: "2026-10-26" }, { numeroChiusura: 1, numeroDocumentoRt: 23, dataDocumento: "2026-02-30" }]) assert.throws(() => fiscal.rtReference(input));
  assert.equal(fiscal.rtReference({ numeroChiusura: 42, numeroDocumentoRt: 1, dataDocumento: "2026-10-26" }).command, '"0042-0001-26102026"105M');
});
test("a socket response alone cannot confirm cancellation", () => {
  const before = { annulli: 2, chiusura: 42 };
  assert.equal(fiscal.cancellationConfirmed(before, null), false);
  assert.equal(fiscal.cancellationConfirmed(before, { annulli: 2, chiusura: 42, stato: 0 }), false);
  assert.equal(fiscal.cancellationConfirmed(before, { annulli: 3, chiusura: 42, stato: 1 }), false);
  assert.equal(fiscal.cancellationConfirmed(before, { annulli: 3, chiusura: 43, stato: 0 }), false);
  assert.equal(fiscal.cancellationConfirmed(before, { annulli: 3, chiusura: 42, stato: 0 }), true);
});
test("RT dates are decoded without inventing or renumbering document identities", () => {
  assert.equal(fiscal.rtDate("261026"), "2026-10-26");
  assert.equal(fiscal.rtDate("300226"), null);
});
test("staff session cannot be replaced by a client-provided admin role", () => {
  const req = { headers: { "x-user-role": "admin" }, header: name => name === "x-user-role" ? "admin" : undefined };
  assert.equal(sessions.staffUser(req), null);
  let code;
  const res = { status: n => { code = n; return res; }, json: () => {} };
  sessions.requireStaffAdmin(req, res, () => assert.fail("unauthenticated visitor admitted"));
  assert.equal(code, 401);
});
test("PIN-authenticated staff session is httpOnly, expires, and logout revokes it", () => {
  let cookie;
  let options;
  const req = { headers: {}, secure: true, header: () => undefined };
  const res = { cookie: (name, value, opts) => { cookie = `${name}=${value}`; options = opts; }, clearCookie: () => {} };
  sessions.startStaffSession(req, res, { id: 1, name: "Operatore test", role: "employee" });
  assert.equal(options.httpOnly, true);
  assert.equal(options.sameSite, "strict");
  assert.equal(options.secure, true);
  req.headers.cookie = cookie;
  assert.equal(sessions.staffUser(req)?.role, "employee");
  sessions.endStaffSession(req, res);
  assert.equal(sessions.staffUser(req), null);
});
