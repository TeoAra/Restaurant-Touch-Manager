import assert from "node:assert/strict";
import test from "node:test";
import { canClaimSplitReservation, isSplitPaymentReplay } from "./split-reservation.js";

test("una riserva pending blocca qualunque secondo conto separato", () => {
  assert.equal(canClaimSplitReservation("pending", "richiesta-a", "richiesta-a"), false);
  assert.equal(canClaimSplitReservation("pending", "richiesta-a", "richiesta-b"), false);
});

test("il retry della stessa richiesta regolata è idempotente", () => {
  assert.equal(canClaimSplitReservation("settled", "richiesta-a", "richiesta-a"), false);
  assert.equal(isSplitPaymentReplay("settled", "richiesta-a", 42, "richiesta-a"), true);
  assert.equal(canClaimSplitReservation("settled", "richiesta-a", "richiesta-b"), true);
});