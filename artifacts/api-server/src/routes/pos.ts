/**
 * POS Terminal routes
 * POST /api/pos/sale   — avvia pagamento sul terminale (parametro `terminal`: "pax" | "mypos")
 * GET  /api/pos/ping   — test connettività terminale PAX
 *
 * Supporta più terminali abilitati contemporaneamente:
 *  - pos_pax_enabled   = "true"/"false"  (Nexi PAX D230, protocollo ECR su TCP)
 *  - pos_mypos_enabled = "true"/"false"  (myPOS Go — conferma manuale finché non è attiva la CRR API)
 * Retro-compatibilità: se le nuove chiavi non esistono, si usa la vecchia `pos_type`.
 */

import { Router } from "express";
import { getSettings } from "../lib/settings";
import {
  payViaPax,
  pingPax,
  initiateMyPos,
  type PosTerminalResult,
  type MyPosSaleResult,
} from "../lib/pos-terminal";

const router = Router();

export type PosTerminalId = "pax" | "mypos";

// Terminali abilitati, con fallback alla vecchia chiave pos_type
export function enabledPosTerminals(settings: Record<string, string>): PosTerminalId[] {
  const legacy = settings["pos_type"] ?? "none";
  const paxEnabled =
    settings["pos_pax_enabled"] != null
      ? settings["pos_pax_enabled"] === "true"
      : legacy === "pax";
  const myposEnabled =
    settings["pos_mypos_enabled"] != null
      ? settings["pos_mypos_enabled"] === "true"
      : legacy === "mypos";
  const out: PosTerminalId[] = [];
  if (paxEnabled) out.push("pax");
  if (myposEnabled) out.push("mypos");
  return out;
}

// ── Helper: genera reference univoco ─────────────────────────────────────────
function makeRef(orderId?: number): string {
  const ts = Date.now().toString(36).toUpperCase();
  return orderId ? `O${orderId}-${ts}` : `REF-${ts}`;
}

// ── POST /api/pos/sale ────────────────────────────────────────────────────────
// Avvia una transazione sul terminale POS scelto.
// Body: { amountCents: number, orderId?: number, reference?: string, terminal?: "pax"|"mypos" }
// Response: { approved, manualConfirmRequired?, authCode?, last4?, cardType?, responseMessage?, error? }
router.post("/sale", async (req, res) => {
  const { amountCents, orderId, reference, terminal } = req.body as {
    amountCents: number;
    orderId?: number;
    reference?: string;
    terminal?: PosTerminalId;
  };

  if (!amountCents || amountCents <= 0) {
    return res.status(400).json({ error: "amountCents obbligatorio e > 0" });
  }

  const settings = await getSettings();
  const enabled = enabledPosTerminals(settings);

  if (enabled.length === 0) {
    return res.json({ approved: true, responseMessage: "Terminale non configurato — conferma manuale" });
  }

  // Terminale richiesto dal client, oppure l'unico abilitato
  const chosen: PosTerminalId | undefined =
    terminal && (terminal === "pax" || terminal === "mypos") ? terminal : enabled.length === 1 ? enabled[0] : undefined;

  if (!chosen) {
    return res.status(400).json({ error: "Più terminali abilitati: specifica `terminal` (pax | mypos)" });
  }
  if (!enabled.includes(chosen)) {
    return res.status(400).json({ error: `Terminale "${chosen}" non abilitato nelle impostazioni` });
  }

  const ref = reference || makeRef(orderId);

  // ── PAX D230 (Nexi) ───────────────────────────────────────────────────────
  if (chosen === "pax") {
    const ip   = settings["pos_pax_ip"]   || "192.168.8.163";
    const port = parseInt(settings["pos_pax_port"] || "10009", 10);

    req.log.info({ ip, port, amountCents, ref }, "[POS] PAX sale");

    let result: PosTerminalResult;
    try {
      result = await payViaPax(ip, port, amountCents, ref);
    } catch (e) {
      result = { approved: false, error: e instanceof Error ? e.message : String(e) };
    }

    return res.json(result);
  }

  // ── myPOS Go ──────────────────────────────────────────────────────────────
  const apiKey     = settings["pos_mypos_apikey"]      || "";
  const terminalId = settings["pos_mypos_terminal_id"] || "";

  req.log.info({ amountCents, ref }, "[POS] myPOS sale (conferma manuale)");
  const result: MyPosSaleResult = await initiateMyPos(amountCents, ref, apiKey, terminalId);
  return res.json(result);
});

// ── GET /api/pos/ping ─────────────────────────────────────────────────────────
// Testa la connettività al terminale PAX (solo PAX ha connettività TCP).
router.get("/ping", async (_req, res) => {
  const settings = await getSettings();
  const enabled = enabledPosTerminals(settings);

  if (!enabled.includes("pax")) {
    return res.json({ ok: true, message: "Terminale PAX non abilitato — nessun ping TCP disponibile" });
  }

  const ip   = settings["pos_pax_ip"]   || "192.168.8.163";
  const port = parseInt(settings["pos_pax_port"] || "10009", 10);

  const result = await pingPax(ip, port);
  return res.json({ ...result, ip, port });
});

export default router;
