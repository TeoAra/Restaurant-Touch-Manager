import test from "node:test";
import assert from "node:assert/strict";
import { fiscalEmissionEvidence } from "../src/lib/fiscal-emission-evidence.ts";

const before = { stato: 0, chiusura: 42, docCommerciali: 23 };
const after = { ...before, docCommerciali: 24 };
const identity = { errCode: "000", scontrinoAperto: false, nonFiscaleAperto: false, matricola: "RT-TEST", data: "261026", numChiusura: "0041", numScontrino: "0008" };

test("Q proves emission even when 2X is unavailable: missing identity is not a failed payment", () => {
  assert.deepEqual(fiscalEmissionEvidence(before, after, null, null), { issued: true, identity: null });
});
test("real 2X references are retained without equating its closure field to Q", () => {
  const result = fiscalEmissionEvidence(before, after, null, identity);
  assert.equal(result.issued, true);
  assert.equal(result.identity.numeroChiusura, 41);
  assert.equal(result.identity.numeroDocumentoRt, 8);
  assert.equal(result.identity.dataDocumentoRt, "2026-10-26");
});
test("an identity counter baseline can prove emission when Q is unsupported", () => {
  assert.equal(fiscalEmissionEvidence(null, null, { ...identity, numScontrino: "0007" }, identity).issued, true);
});
test("TCP acknowledgement, a current last receipt alone, unchanged counters or open receipt never prove emission", () => {
  for (const result of [
    fiscalEmissionEvidence(null, null, null, null),
    fiscalEmissionEvidence(null, null, null, identity),
    fiscalEmissionEvidence(before, before, null, null),
    fiscalEmissionEvidence(before, { ...after, stato: 2 }, null, null),
    fiscalEmissionEvidence(before, { ...after, docCommerciali: 25 }, null, null),
    fiscalEmissionEvidence(before, { ...after, chiusura: 43 }, null, null),
    fiscalEmissionEvidence(null, null, identity, identity),
  ]) assert.equal(result.issued, false);
});
test("another printer, bad date, open nonfiscal document or RT error cannot supply a confirmed identity", () => {
  for (const bad of [
    { ...identity, data: "321026" }, { ...identity, errCode: "001" },
    { ...identity, scontrinoAperto: true }, { ...identity, nonFiscaleAperto: true },
    { ...identity, matricola: "OTHER", numScontrino: "0009" },
  ]) assert.equal(fiscalEmissionEvidence(null, null, identity, bad).issued, false);
});
