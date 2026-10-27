// All RT sockets below use a local emulator, never a configured fiscal printer.
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { once } from "node:events";
import { registerHooks } from "node:module";
import { zReadiness, zConfirmed } from "../src/lib/fiscal-z-state.ts";

const Q = { chiusura: 42, docCommerciali: 8, docGestionali: 0, resi: 0, annulli: 0, stato: 0,
  totaleScontrino: 0, totalePagato: 0, totaleGiorno: 100, totaleProgressivo: 500, raw: "" };
const ECR = { tipoEcr: "2", matricola: "DC2B000001", scontrinoAperto: false, nonFiscaleAperto: false,
  tastieraBloccata: true, errCode: "000", carta: false, ora: "1800", data: "271026",
  numScontrino: "0008", numChiusura: "0041", raw: "" };
const ok = status => ({ ok: true, status, raw: status?.raw ?? "" });
const missing = { ok: false, status: null, raw: "" };

test("Z accepts healthy 2X when Q is unsupported, without treating different counters as equivalent", () => {
  assert.deepEqual(zReadiness(missing, ok(ECR)), { ready: true, baseline: { serial: ECR.matricola, closure: 41, source: "2X" } });
  assert.deepEqual(zReadiness(ok(Q), ok(ECR)), { ready: true, baseline: { serial: ECR.matricola, closure: 42, source: "Q" } });
  // Keyboard lock is normal for software-controlled ECR, not an open receipt.
  assert.equal(zReadiness(missing, ok(ECR)).ready, true);
});
test("Z never bypasses open documents, machine errors, paper failure, missing serial or malformed counter", () => {
  for (const state of [
    { scontrinoAperto: true }, { nonFiscaleAperto: true }, { carta: true }, { errCode: "016" },
    { errCode: "" }, { matricola: "" }, { numChiusura: "?" },
  ]) assert.equal(zReadiness(missing, ok({ ...ECR, ...state })).ready, false);
  for (const stato of [1, 2, 3, 8]) assert.equal(zReadiness(ok({ ...Q, stato }), ok(ECR)).ready, false);
  assert.equal(zReadiness(ok(Q), missing).ready, false);
});
test("confirmation requires same source, same RT and exactly one counter advance", () => {
  const qBaseline = zReadiness(ok(Q), ok(ECR)).baseline;
  const xBaseline = zReadiness(missing, ok(ECR)).baseline;
  assert.equal(zConfirmed(qBaseline, ok({ ...Q, chiusura: 43 }), ok(ECR)), true);
  assert.equal(zConfirmed(qBaseline, missing, ok({ ...ECR, numChiusura: "0043" })), false);
  assert.equal(zConfirmed(xBaseline, missing, ok({ ...ECR, numChiusura: "0042" })), true);
  assert.equal(zConfirmed(xBaseline, ok({ ...Q, chiusura: 42 }), ok(ECR)), false);
  for (const state of [
    { numChiusura: "0041" }, { numChiusura: "0043" }, { numChiusura: "0042", matricola: "OTHER" },
    { numChiusura: "0042", scontrinoAperto: true }, { numChiusura: "0042", errCode: "016" },
  ]) assert.equal(zConfirmed(xBaseline, missing, ok({ ...ECR, ...state })), false);
});

// Import the real transport and route without database/network configuration.
const h = { reports: [], sent: [], q: [], x: [], command: { ok: true, body: "", ms: 1 } };
globalThis.__zReportTest = h;
const code = source => ({ shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` });
const handlers = new Map();
h.router = { get() {}, post(path, ...chain) { handlers.set(path, chain.at(-1)); } };
const table = name => new Proxy({ name }, { get: (target, key) => key === "name" ? name : String(key) });
h.tables = Object.fromEntries(["fiscalReportsTable", "fiscalReceiptsTable", "ordersTable", "paymentsTable", "printersTable"].map(name => [name, table(name)]));
h.db = {
  execute: async () => ({ rows: [{ count: "3", totale: "50.00", totale_iva: "4.55" }] }),
  select() { return { from() { return { where: async predicate => h.reports.filter(predicate) }; } }; },
  insert() { return { values(value) { return { returning: async () => {
    const row = { id: h.reports.length + 1, ...value }; h.reports.push(row); return [row];
  } }; } }; },
  update() { return { set(patch) { return { where: async predicate => {
    h.reports.filter(predicate).forEach(row => Object.assign(row, patch));
  } }; } }; },
  transaction: async fn => fn(h.db),
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@workspace/db" || specifier === "@workspace/db/schema") return code(`
      export const db=globalThis.__zReportTest.db;
      ${Object.keys(h.tables).map(name => `export const ${name}=globalThis.__zReportTest.tables.${name};`).join("\n")}
    `);
    if (specifier === "drizzle-orm") return code(`
      export const eq=(key,value)=>row=>row[key]===value;
      export const and=(...args)=>row=>args.every(fn=>fn(row));
      export const or=(...args)=>row=>args.some(fn=>fn(row));
      export const inArray=(key,values)=>row=>values.includes(row[key]);
      export const sql=()=>({});
      export const desc=x=>x;
    `);
    if (specifier.endsWith("/settings") || specifier === "./settings") return code(`export const getSettings=async()=>({});`);
    if (context.parentURL?.endsWith("/routes/fiscal.ts")) {
      if (specifier === "express") return code(`export const Router=()=>globalThis.__zReportTest.router;`);
      if (specifier.endsWith("/fiscal-printer")) return code(`
        const h=globalThis.__zReportTest;
        export const getFiscalPrinter=async()=>({ip:"EMULATED",port:1126,name:"Test RT"});
        export const getStatusQ=async()=>h.q.shift()??{ok:false,status:null,raw:""};
        export const getStatus2X=async()=>h.x.shift()??{ok:false,status:null,raw:""};
        export const sendXonXoffCommand=async(_ip,_port,cmd)=>{
          if(!h.reports.some(row=>row.status==="pending")) throw Error("Z sent without durable pending attempt");
          h.sent.push(cmd);
          if(h.command instanceof Error) throw h.command;
          return h.command;
        };
        export const emettiFiscalReceipt=()=>{throw Error("Unexpected emission");};
        export const inviaLotteriaRt=()=>{}; export const sendXonXoff=()=>{}; export const parseStatusQ=()=>{};
      `);
      if (specifier.endsWith("/audit")) return code(`export const logAudit=async()=>{};`);
      if (specifier.endsWith("/auth-guard")) return code(`export const requireAdminHeader=()=>{};`);
      if (specifier.endsWith("/staff-session")) return code(`export const requireStaffAdmin=()=>{};`);
    }
    if (specifier.startsWith(".") && !specifier.match(/\.[cm]?[jt]s$/)) {
      return next(`${specifier}.ts`, context);
    }
    return next(specifier, context);
  },
});
const transport = await import("../src/lib/fiscal-printer.ts");
await import("../src/routes/fiscal.ts");
// Same observed frame layout as the user's RT, with an anonymized serial.
const elevenCharacterFrame = "2X3H4TEST000123H0H0H0H000H0H1840H271026H0022H0892H2X";
test("observed 11-character RT serial parses without losing machine status or fiscal counters", () => {
  const status = transport.parseStatus2X(elevenCharacterFrame);
  assert(status, "A complete healthy 2X frame must not be rejected for its 11-character serial");
  assert.equal(status.matricola, "4TEST000123");
  assert.equal(status.tipoEcr, "3");
  assert.equal(status.errCode, "000");
  assert.equal(status.scontrinoAperto, false);
  assert.equal(status.nonFiscaleAperto, false);
  assert.equal(status.carta, false);
  assert.equal(status.numScontrino, "0022");
  assert.equal(status.numChiusura, "0892");
  assert.equal(status.ora, "1840");
  assert.equal(status.data, "271026");
  const q = transport.parseStatusQ("?892H22H2H0H0H0H0.00H0.00H100.00H500.00H?");
  assert.equal(zReadiness(ok(q), ok(status)).ready, true);
});
test("serial compatibility preserves legacy 10-character format and does not accept malformed records", () => {
  const legacy = elevenCharacterFrame.replace("4TEST000123", "DC2B000001");
  assert.equal(transport.parseStatus2X(legacy).matricola, "DC2B000001");
  assert.equal(transport.parseStatus2X(legacy.slice(2)).matricola, "DC2B000001");
  for (const frame of [
    elevenCharacterFrame.replace("4TEST000123", "4TEST0001234"),
    elevenCharacterFrame.replace("4TEST000123", "TEST00123"),
    elevenCharacterFrame.replace("4TEST000123", "4TEST!00123"),
    elevenCharacterFrame.replace("H1840H", "H184H"),
    elevenCharacterFrame.slice(0, -2),
  ]) assert.equal(transport.parseStatus2X(frame), null);
  const error = transport.parseStatus2X(elevenCharacterFrame.replace("H000H", "H016H"));
  assert.equal(error.errCode, "016");
  assert.equal(zReadiness(missing, ok(error)).ready, false);
});
const requestZ = async () => {
  let status = 200, body;
  await handlers.get("/z-report")({ log: { warn() {} } }, {
    status(value) { status = value; return this; }, json(value) { body = value; return this; },
  });
  return { status, body };
};
const reset = (q, x) => { h.reports = []; h.sent = []; h.q = q; h.x = x; h.command = { ok: true, body: "", ms: 1 }; };
test("11-character serial reaches the real Z route and is retained intact in the report", async () => {
  const before = transport.parseStatus2X(elevenCharacterFrame);
  const after = transport.parseStatus2X(elevenCharacterFrame.replace("0892H2X", "0893H2X"));
  reset([ok({ ...Q, chiusura: 892 }), ok({ ...Q, chiusura: 893 })], [ok(before), ok(after)]);
  const result = await requestZ();
  assert.equal(result.status, 200);
  assert.equal(result.body.printer.ok, true);
  assert.deepEqual(h.sent, ["1F"]);
  assert.equal(h.reports[0].printerSerial, "4TEST000123");
  assert.equal(h.reports[0].status, "confirmed");
});
test("real Z route sends 1F exactly once with 2X fallback and saves verified outcome", async () => {
  reset([missing, missing], [ok(ECR), ok({ ...ECR, numChiusura: "0042" })]);
  const result = await requestZ();
  assert.equal(result.status, 200);
  assert.equal(result.body.printer.ok, true);
  assert.deepEqual(h.sent, ["1F"]);
  assert.equal(h.reports[0].status, "confirmed");
  assert.equal(JSON.parse(h.reports[0].response).baseline.source, "2X");
});
test("real Z route blocks open documents and provides precise reason without 1F", async () => {
  reset([ok({ ...Q, stato: 1 })], [ok(ECR)]);
  const result = await requestZ();
  assert.equal(result.status, 503);
  assert.match(result.body.error, /Scontrino fiscale aperto/);
  assert.deepEqual(h.sent, []);
  assert.deepEqual(h.reports, []);
});
test("uncertain Z is persisted and blocked even if next request uses a different counter source", async () => {
  reset([ok(Q), missing], [ok(ECR), missing]);
  await requestZ();
  assert.equal(h.reports[0].status, "unknown");
  h.q = [missing]; h.x = [ok(ECR)];
  const result = await requestZ();
  assert.equal(result.status, 409);
  assert.deepEqual(h.sent, ["1F"]);
});
test("real Z route confirms Q only against Q and blocks duplicates for its counter", async () => {
  reset([ok(Q), ok({ ...Q, chiusura: 43 })], [ok(ECR), ok(ECR)]);
  assert.equal((await requestZ()).body.printer.ok, true);
  h.q = [ok(Q)]; h.x = [ok(ECR)];
  assert.equal((await requestZ()).status, 409);
  assert.deepEqual(h.sent, ["1F"]);
});
test("lost command response leaves Z unknown and cannot trigger a second closure", async () => {
  reset([missing], [ok(ECR)]);
  h.command = new Error("emulated lost connection after send");
  await assert.rejects(requestZ, /lost connection/);
  assert.equal(h.reports[0].status, "unknown");
  h.q = [missing]; h.x = [ok(ECR)];
  assert.equal((await requestZ()).status, 409);
  assert.deepEqual(h.sent, ["1F"]);
});

async function emulator(bytes, run) {
  const server = net.createServer(socket => socket.once("data", () => {
    socket.write(Buffer.from(bytes));
    socket.end();
  }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try { return await run(server.address().port); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
test("real TCP transport: transient XOFF followed by XON is ready; persistent XOFF is not", async () => {
  const resumed = await emulator([0x13, 0x11], port => transport.sendXonXoff("127.0.0.1", port, "?", 40));
  assert.equal(resumed.ok, true);
  assert.equal(resumed.xoffCount, 1);
  const paused = await emulator([0x13], port => transport.sendXonXoff("127.0.0.1", port, "?", 40));
  assert.equal(paused.ok, false);
});
test("status readers accept valid frames after a recovered flow pause", async () => {
  const frame = "42H8H0H0H0H0H0H0H100H500H?";
  const q = await emulator([0x13, 0x11, ...Buffer.from(frame)], port => transport.getStatusQ("127.0.0.1", port));
  assert.equal(q.ok, true);
  assert.equal(q.status.chiusura, 42);
  const record = "2HDC2B000001H0H0H1H000H0H1800H271026H0008H0041H2X";
  const x = await emulator([0x13, 0x11, ...Buffer.from(record)], port => transport.getStatus2X("127.0.0.1", port));
  assert.equal(x.ok, true);
  assert.equal(x.status.matricola, ECR.matricola);
  const modern = await emulator([0x11, ...Buffer.from(elevenCharacterFrame)], port => transport.getStatus2X("127.0.0.1", port));
  assert.equal(modern.ok, true);
  assert.equal(modern.status.matricola, "4TEST000123");
});
