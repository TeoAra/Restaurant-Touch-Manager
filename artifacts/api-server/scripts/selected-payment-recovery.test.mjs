import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const names = ["orders", "items", "payments", "tables", "receipts"];
const tables = Object.fromEntries(names.map(name => [name, new Proxy({ name }, { get: (target, key) => key === "name" ? target.name : String(key) })]));
const harness = { state: {}, depth: 0, emissions: 0, mode: "confirmed", failCommit: false, tail: Promise.resolve() };
globalThis.__splitRecoveryTest = harness;
function selection(table) {
  let filter = () => true;
  const query = {
    where(value) { filter = value; return query; },
    for() { return query; },
    then(resolve, reject) { return Promise.resolve(structuredClone(harness.state[table.name].filter(filter))).then(resolve, reject); },
  };
  return query;
}
harness.db = {
  select() { return { from: selection }; },
  execute: async () => ({ rows: [] }),
  insert(table) { return { values(value) { return { returning: async () => {
    const row = { id: harness.state[table.name].length + 1, ...value };
    harness.state[table.name].push(row); return [structuredClone(row)];
  } }; } }; },
  update(table) { return { set(patch) { return { where: async predicate => {
    harness.state[table.name].filter(predicate).forEach(row => Object.assign(row, patch));
  } }; } }; },
  delete(table) { return { where: async predicate => { harness.state[table.name] = harness.state[table.name].filter(row => !predicate(row)); } }; },
  transaction(callback) {
    const run = harness.tail.catch(() => undefined).then(async () => {
      const backup = structuredClone(harness.state);
      harness.depth++;
      try {
        const result = await callback(harness.db);
        if (harness.failCommit && harness.state.payments.length > backup.payments.length) {
          harness.failCommit = false; throw new Error("simulated commit failure");
        }
        return result;
      } catch (error) { harness.state = backup; throw error; }
      finally { harness.depth--; }
    });
    harness.tail = run.then(() => undefined, () => undefined);
    return run;
  },
};
harness.reserve = async options => {
  const row = { id: harness.state.receipts.length + 1, orderId: options.orderId, operationId: options.operationId,
    paymentSnapshot: options.paymentSnapshot, importo: options.importo, emissionStatus: "pending" };
  harness.state.receipts.push(row); return structuredClone(row);
};
harness.emit = async options => {
  assert.equal(harness.depth, 0, "No transaction may be held open across RT I/O");
  const receipt = harness.state.receipts.find(row => row.id === options.receiptId);
  assert.equal(receipt.emissionStatus, "pending");
  harness.emissions++;
  receipt.emissionStatus = harness.mode;
  return { receipt: structuredClone(receipt), rt: { ok: ["issued", "confirmed"].includes(harness.mode) } };
};
const moduleUrl = source => `data:text/javascript,${encodeURIComponent(source)}`;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@workspace/db") return { shortCircuit: true, url: moduleUrl(`
      export const db=globalThis.__splitRecoveryTest.db;
      ${names.map((name, index) => `export const ${["ordersTable", "orderItemsTable", "paymentsTable", "tablesTable", "fiscalReceiptsTable"][index]}=new Proxy({name:${JSON.stringify(name)}},{get:(t,k)=>k==="name"?t.name:String(k)});`).join("\n")}
    `) };
    if (specifier === "drizzle-orm") return { shortCircuit: true, url: moduleUrl(`export const eq=(key,value)=>row=>row[key]===value; export const sql=(parts,...values)=>({parts,values});`) };
    if (context.parentURL?.endsWith("/selected-payment.ts") && specifier === "./settings") return { shortCircuit: true, url: moduleUrl(`export const getSettings=async()=>({cover_price:"1.50"});`) };
    if (context.parentURL?.endsWith("/selected-payment.ts") && specifier === "./fiscal-printer") return { shortCircuit: true, url: moduleUrl(`
      export const getFiscalPrinter=async()=>({id:1,ip:"127.0.0.1",name:"SIMULATED"});
      export const reserveFiscalReceipt=options=>globalThis.__splitRecoveryTest.reserve(options);
      export const emettiFiscalReceipt=options=>globalThis.__splitRecoveryTest.emit(options);
    `) };
    if (context.parentURL?.endsWith("/selected-payment.ts") && specifier.startsWith(".")) return next(specifier + ".ts", context);
    return next(specifier, context);
  },
});
const { paySelectedBill, previewSelectedPayment } = await import("../src/lib/selected-payment.ts");
const input = { orderId: 101, method: "card", amount: "6.50", selectedItems: [{ itemId: 11, quantity: 1 }], coversCount: 0, operationId: "split-test-operation-0001" };
function reset(mode = "confirmed") {
  harness.state = {
    orders: [{ id: 101, status: "open", covers: 0, coverPrice: "1.50", paidRomana: "0", modalita: "tavolo", total: "19.50", tableId: null }],
    items: [{ id: 11, orderId: 101, quantity: 3, unitPrice: "6.50", subtotal: "19.50", productName: "SIMULATED" }],
    payments: [], tables: [], receipts: [],
  };
  harness.emissions = 0; harness.mode = mode; harness.failCommit = false;
}
test("issued document with unreadable identity saves exact payment and deducts one unit", async () => {
  reset("issued");
  const result = await paySelectedBill(input);
  assert.equal(result.fiscal.identityPending, true);
  assert.equal(harness.state.items[0].quantity, 2);
  assert.equal(harness.state.payments[0].amount, "6.50");
  assert.equal(harness.emissions, 1);
});
test("unknown RT outcome persists the attempt, blocks both old and new operation retries without reprinting", async () => {
  reset("unknown");
  await assert.rejects(paySelectedBill(input), /non verrà ristampato/);
  assert.equal(harness.state.receipts.length, 1);
  assert.equal(harness.state.items[0].quantity, 3);
  assert.equal(harness.state.payments.length, 0);
  const preview = await previewSelectedPayment({ ...input, operationId: "split-new-operation-0002" });
  assert.equal(preview.resume, true);
  assert.equal(preview.operationId, input.operationId);
  await assert.rejects(paySelectedBill(input), /Nessuna nuova stampa/);
  await assert.rejects(paySelectedBill({ ...input, operationId: "split-new-operation-0002" }), /Nessuna nuova stampa/);
  assert.equal(harness.emissions, 1);
});
test("DB commit failure after RT issuance recovers bookkeeping exactly once with no second print", async () => {
  reset();
  harness.failCommit = true;
  await assert.rejects(paySelectedBill(input), /registrazione da recuperare/);
  assert.equal(harness.state.receipts[0].emissionStatus, "confirmed");
  assert.equal(harness.state.payments.length, 0);
  assert.equal(harness.state.items[0].quantity, 3);
  assert.equal((await previewSelectedPayment(input)).resume, true);
  await paySelectedBill(input);
  await paySelectedBill(input);
  assert.equal(harness.emissions, 1);
  assert.equal(harness.state.payments.length, 1);
  assert.equal(harness.state.items[0].quantity, 2);
});
test("changed selection or method cannot reuse an unresolved attempt", async () => {
  reset("unknown");
  await assert.rejects(paySelectedBill(input));
  await assert.rejects(paySelectedBill({ ...input, method: "cash" }), /selezione originale/);
  assert.equal(harness.emissions, 1);
});
