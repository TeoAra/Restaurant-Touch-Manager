import assert from "node:assert/strict";
import test from "node:test";
import { resolveSplitSelection } from "./split-payment.js";

test("conto separato conserva la quantità non ancora pagata", () => {
  const selection = resolveSplitSelection(
    [{ id: 10, quantity: 3, unitPrice: "4.50" }],
    [10],
    { 10: 1 },
  );
  assert.deepEqual(selection.lines, [{ id: 10, originalQuantity: 3, quantity: 1, unitPrice: "4.50" }]);
  assert.equal(selection.selectedCents, 450);
  assert.equal(selection.remainingCents, 900);
});

test("conto separato rifiuta quantità oltre la riga disponibile", () => {
  assert.throws(
    () => resolveSplitSelection([{ id: 10, quantity: 2, unitPrice: "4.50" }], [10], { 10: 3 }),
    /quantità selezionata/,
  );
});