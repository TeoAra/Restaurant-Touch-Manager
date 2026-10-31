// Isolated invoice route and emulated TCP RT: never connects to real hardware/DB.
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { registerHooks } from "node:module";

const h = {
  invoices: [], customers: [], printed: [], printer: { id: 1, ip: "EMULATED", port: 1126, name: "Test RT" },
  result: { ok: true }, wait: null,
};
globalThis.__invoiceCourtesy = h;
const handlers = new Map();
h.router = Object.fromEntries(["get", "post", "patch", "delete"].map(method => [method, (path, handler) => {
  if (method === "post") handlers.set(path, handler);
}]));
const table = name => new Proxy({ name }, { get: (target, key) => key === "name" ? name : String(key) });
h.tables = Object.fromEntries(["invoicesTable", "customersTable", "ordersTable", "orderItemsTable", "paymentsTable", "fiscalReceiptsTable", "printersTable"].map(name => [name, table(name)]));
h.db = {
  select() { return { from(table) { return { where: async predicate =>
    (table === h.tables.invoicesTable ? h.invoices : h.customers).filter(predicate) }; } }; },
  insert() { throw Error("Courtesy must not create accounting records"); },
  update() { throw Error("Courtesy must not alter invoices"); },
  delete() { throw Error("Courtesy must not delete records"); },
  execute() { throw Error("Courtesy must not generate XML or read transmission settings"); },
};
const code = source => ({ shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` });
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@workspace/db" || specifier === "@workspace/db/schema") return code(`
      export const db=globalThis.__invoiceCourtesy.db;
      ${Object.keys(h.tables).map(name => `export const ${name}=globalThis.__invoiceCourtesy.tables.${name};`).join("\n")}
    `);
    if (specifier === "drizzle-orm") return code(`
      export const eq=(key,value)=>row=>row[key]===value;
      export const and=(...predicates)=>row=>predicates.every(fn=>fn(row));
      export const desc=x=>x; export const sql=()=>({});
    `);
    if (context.parentURL?.endsWith("/routes/invoices.ts")) {
      if (specifier === "express") return code(`export const Router=()=>globalThis.__invoiceCourtesy.router;`);
      if (specifier.endsWith("/fiscal-printer.js")) return code(`
        const h=globalThis.__invoiceCourtesy;
        export const getFiscalPrinter=async()=>h.printer;
        export const emettiFatturaCortesia=async opts=>{
          h.printed.push(opts);
          if(h.wait) await h.wait;
          return h.result;
        };
      `);
      if (specifier.endsWith("/fatturaPA.js")) return code(`export const generateFatturaPAXml=()=>{throw Error("Courtesy must not generate XML");};`);
    }
    if (specifier === "./settings") return code(`export const getSettings=async()=>({});`);
    if (specifier.startsWith(".") && (specifier.endsWith(".js") || !specifier.match(/\.[cm]?[jt]s$/))) {
      return next(specifier.endsWith(".js") ? specifier.slice(0, -3) + ".ts" : specifier + ".ts", context);
    }
    return next(specifier, context);
  },
});
await import("../src/routes/invoices.ts");
const transport = await import("../src/lib/fiscal-printer.ts");
const original = {
  id: 81, numero: 24, sezionale: "1", anno: 2026, data: "2026-10-31",
  stato: "bozza", customerId: 41, xmlContent: null, imponibile: "50.00",
  iva: "5.00", aliquotaIva: "10", totale: "55.00",
  righe: JSON.stringify([{ descrizione: "Cena test", quantita: "2", prezzoUnitario: "25.00" }]),
};
function reset() {
  h.invoices = [{ ...original }];
  h.customers = [{ id: 41, ragioneSociale: "Cliente test" }]; // Optional XML fields deliberately absent.
  h.printed = []; h.result = { ok: true }; h.wait = null;
  h.printer = { id: 1, ip: "EMULATED", port: 1126, name: "Test RT" };
}
async function call(id = "81") {
  const res = { statusCode: 200, body: null, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  await handlers.get("/:id/print-courtesy")({ params: { id } }, res);
  return res;
}
test("draft courtesy prints without XML fields, status changes, accounting or transmission", async () => {
  reset();
  const before = structuredClone(h.invoices);
  const result = await call();
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { ok: true, nonFiscale: true, sdiSent: false });
  assert.deepEqual(h.invoices, before);
  assert.equal(h.printed[0].numero, "1/24");
  assert.equal(h.printed[0].bozza, true);
  assert.equal(h.printed[0].requireIdle, true);
  assert.deepEqual(h.printed[0].righe, [{ desc: "Cena test", qta: 2, prezzoUnitario: "25.00" }]);
});
test("issued XML and historical identity remain untouched on reprint", async () => {
  reset();
  Object.assign(h.invoices[0], { stato: "emessa", sezionale: null, xmlContent: "<original-xml/>" });
  const before = structuredClone(h.invoices);
  assert.equal((await call()).statusCode, 200);
  assert.deepEqual(h.invoices, before);
  assert.equal(h.printed[0].numero, "2026/0024");
  assert.equal(h.printed[0].bozza, false);
});
test("missing/cancelled/invalid invoices, bad rows and absent printer never print", async () => {
  reset();
  assert.equal((await call("bad")).statusCode, 400);
  assert.equal((await call("999")).statusCode, 404);
  h.invoices[0].stato = "annullata";
  assert.equal((await call()).statusCode, 409);
  h.invoices[0].stato = "bozza";
  h.invoices[0].righe = "broken";
  assert.equal((await call()).statusCode, 400);
  h.invoices[0].righe = original.righe;
  h.printer = null;
  assert.equal((await call()).statusCode, 502);
  assert.equal(h.printed.length, 0);
});
test("duplicate clicks do not submit a second print while pending", async () => {
  reset();
  let release;
  h.wait = new Promise(resolve => { release = resolve; });
  const first = call();
  while (!h.printed.length) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await call()).statusCode, 409);
  assert.equal(h.printed.length, 1);
  release();
  assert.equal((await first).statusCode, 200);
});
test("RT failure does not announce success, mutate invoice or replay automatically", async () => {
  reset();
  const before = structuredClone(h.invoices);
  h.result = { ok: false, error: "RT non pronta" };
  const result = await call();
  assert.equal(result.statusCode, 502);
  assert.equal(result.body.ok, false);
  assert.match(result.body.error, /RT non pronta/);
  assert.equal(h.printed.length, 1);
  assert.deepEqual(h.invoices, before);
});

async function emulate(state, action) {
  const writes = [];
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let collected = "";
    socket.on("data", data => {
      const text = data.toString("latin1"); writes.push(text); collected += text;
      if (collected === "?") {
        socket.end(state === null ? "unreadable" : `1H2H3H0H0H${state}H0.00H0.00H55.00H55.00H?`);
      } else if (collected.endsWith("J")) setTimeout(() => socket.end(Buffer.from([0x11])), 200);
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try { await action({ id: 1, name: "Emulated RT", ip: "127.0.0.1", port: server.address().port }, writes); }
  finally { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }
}
const opts = {
  numero: "1/24", data: "2026-10-31", bozza: true, requireIdle: true,
  cliente: { denominazione: "Cliente test" },
  righe: [{ desc: "Cena TOTALE", qta: 1.5, prezzoUnitario: "10.00" }],
  imponibile: "15.00", iva: "1.50", aliquotaIva: "10", totale: "16.50",
};
test("real DTR transport sends only j/text/J and non-fiscal copy wording", async () => {
  await emulate(0, async (printer, writes) => {
    const result = await transport.emettiFatturaCortesia({ ...opts, printer });
    assert.equal(result.ok, true);
    const document = writes.slice(1).join("");
    assert.equal(writes[0], "?");
    assert(document.startsWith("j"));
    assert(document.endsWith("J"));
    assert(document.includes("FATTURA N. 1/24"));
    assert(document.includes("BOZZA - COPIA DI CORTESIA"));
    assert(document.includes("DOCUMENTO GESTIONALE"));
    assert(document.includes("FINI FISCALI"));
    assert(document.includes("NESSUN INVIO SDI"));
    assert(document.includes("1,5x"));
    assert(!document.includes("TOTALE"));
    assert(!/(?:1T|3T|1F|\dH\dR)/.test(document));
    assert(writes.slice(1).every(chunk => Buffer.byteLength(chunk, "latin1") <= 256));
  });
});
test("open or unreadable RT status blocks courtesy without k, K, J or sales", async () => {
  for (const state of [1, 2, 3, null]) {
    await emulate(state, async (printer, writes) => {
      const result = await transport.emettiFatturaCortesia({ ...opts, printer });
      assert.equal(result.ok, false);
      assert.deepEqual(writes, ["?"]);
    });
  }
});
