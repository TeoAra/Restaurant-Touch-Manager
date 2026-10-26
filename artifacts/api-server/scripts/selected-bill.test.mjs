// No database writes, real fiscal printer or card terminal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectedBill, individualUnits, selectedFiscalDocument } from "../src/lib/selected-bill.ts";
import { UpdateTableBody, CreateTableBody } from "../../../lib/api-zod/src/generated/api.ts";

const sku = { id: 71, productId: 9, productName: "Birra", quantity: 3, unitPrice: "6.50", subtotal: "19.50", phase: 2, status: "sent", notes: "senza ghiaccio", modifiers: '[{"id":2}]', createdAt: "2026-10-26T18:00:00Z" };

test("one of three units has the same amount and quantity on cash, POS and fiscal document", () => {
  const bill = selectedBill([sku], { selectedItems: [{ itemId: 71, quantity: 1 }], amount: "6.50" }, 0, 150);
  assert.equal(bill.amount, "6.50");
  assert.equal(bill.selected[0].quantity, 1);
  assert.equal(bill.remaining[0].quantity, 2);
  assert.equal(bill.remainingItemsCents, 1300);
  assert.equal(bill.closed, false);
  for (const method of ["cash", "card", "satispay"]) {
    const fiscal = selectedFiscalDocument(bill, method, 150, "10");
    assert.equal(fiscal.importo, "6.50");
    assert.equal(fiscal.metodoPagamento, method);
    assert.equal(fiscal.righe.length, 1);
    assert.equal(fiscal.righe[0].qta, 1);
    assert.equal(fiscal.righe[0].prezzoUnitario, "6.50");
  }
});

test("legacy id-only payload cannot silently charge all three while claiming the price of one", () => {
  assert.throws(() => selectedBill([sku], { itemIds: [71], amount: "6.50" }, 0, 150), /Importo diverso/);
  assert.equal(selectedBill([sku], { itemIds: [71], amount: "19.50" }, 0, 150).selected[0].quantity, 3);
});

test("duplicate, foreign, unavailable, fractional or empty selected quantities are rejected", () => {
  for (const selectedItems of [
    [{ itemId: 71, quantity: 4 }], [{ itemId: 999, quantity: 1 }],
    [{ itemId: 71, quantity: 0 }], [{ itemId: 71, quantity: -1 }],
    [{ itemId: 71, quantity: 1.5 }], [{ itemId: 71, quantity: "1" }],
    [{ itemId: 71, quantity: 1 }, { itemId: 71, quantity: 1 }], [], null,
  ]) assert.throws(() => selectedBill([sku], { selectedItems, amount: "6.50" }, 0, 150));
});

test("selected covers only and mixed quantities have exact amounts and correct remaining covers", () => {
  const covers = selectedBill([sku], { selectedItems: [], coversCount: 1, amount: "1.50" }, 3, 150);
  assert.equal(covers.remainingCovers, 2);
  assert.equal(covers.remaining[0].quantity, 3);
  assert.deepEqual(selectedFiscalDocument(covers, "cash", 150, "10").righe.map(row => [row.desc, row.qta]), [["COPERTO", 1]]);
  const mixed = selectedBill([sku], { selectedItems: [{ itemId: 71, quantity: 2 }], coversCount: 1, amount: "14.50" }, 3, 150);
  assert.equal(mixed.remaining[0].quantity, 1);
  assert.equal(mixed.remainingCovers, 2);
  assert.throws(() => selectedBill([sku], { selectedItems: [], coversCount: 4, amount: "6.00" }, 3, 150));
});

test("three sequential payments of one unit leave 2, then 1, then 0 without losing cents", () => {
  let rows = [sku];
  for (let remaining = 2; remaining >= 0; remaining--) {
    const bill = selectedBill(rows, { selectedItems: [{ itemId: 71, quantity: 1 }], amount: "6.50" }, 0, 0);
    assert.equal(bill.remaining[0]?.quantity ?? 0, remaining);
    assert.equal(bill.closed, remaining === 0);
    rows = bill.remaining;
  }
});

test("Separa tutto preserves prices, timestamps, notes, modifiers, phase and kitchen status", () => {
  const units = individualUnits(sku);
  assert.equal(units.length, 3);
  assert.equal(units.reduce((sum, row) => sum + Number(row.subtotal), 0), 19.50);
  for (const row of units) assert.deepEqual(row, { ...sku, quantity: 1, subtotal: "6.50" });
  assert.equal(sku.quantity, 3);
  assert.equal(individualUnits(units[0]).length, 1);
});

test("fiscal document mismatch fails explicitly instead of silently changing the charged amount", () => {
  const bill = selectedBill([sku], { selectedItems: [{ itemId: 71, quantity: 1 }], amount: "6.50" }, 0, 0);
  assert.throws(() => selectedFiscalDocument({ ...bill, amount: "19.50" }, "card", 0, "10"), /non coincidono/);
});

test("table layout contract retains actual coordinates, room, order, rotation and decimal size", () => {
  const layout = { posX: 12, posY: 7, roomId: 2, sortOrder: 4, rotation: 45, sizeScale: 0.3, shape: "round", elementType: "table" };
  assert.deepEqual(UpdateTableBody.parse(layout), layout);
  const created = CreateTableBody.parse({ ...layout, number: 1, name: "Tavolo 1", seats: 4, status: "free" });
  assert.equal(created.posX, 12);
  assert.equal(created.sizeScale, 0.3);
  assert.equal(UpdateTableBody.safeParse({ posX: -1 }).success, false);
  assert.equal(UpdateTableBody.safeParse({ posY: 1.5 }).success, false);
});
