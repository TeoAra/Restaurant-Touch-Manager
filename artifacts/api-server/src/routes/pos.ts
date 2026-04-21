/**
 * POS Terminal routes
 * POST /api/pos/sale   — avvia pagamento sul terminale
 * POST /api/pos/confirm — conferma manuale (myPOS Go 2)
 * GET  /api/pos/ping   — test connettività terminale
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

// ── Helper: genera reference univoco ─────────────────────────────────────────
function makeRef(orderId?: number): string {
  const ts = Date.now().toString(36).toUpperCase();
  return orderId ? `O${orderId}-${ts}` : `REF-${ts}`;
}

// ── POST /api/pos/sale ────────────────────────────────────────────────────────
// Avvia una transazione sul terminale POS configurato.
// Body: { amountCents: number, orderId?: number, reference?: string }
// Response: { approved, manualConfirmRequired?, authCode?, last4?, cardType?, responseMessage?, error? }
router.post("/sale", async (req, res) => {
  const { amountCents, orderId, reference } = req.body as {
    amountCents: number;
    orderId?: number;
    reference?: string;
  };

  if (!amountCents || amountCents <= 0) {
    return res.status(400).json({ error: "amountCents obbligatorio e > 0" });
  }

  const settings = await getSettings();
  const posType = settings["pos_type"] ?? "none";

  if (posType === "none") {
    return res.json({ approved: true, responseMessage: "Terminale non configurato — conferma manuale" });
  }

  const ref = reference || makeRef(orderId);

  // ── PAX D230 (Nexi / SumUp PAX) ──────────────────────────────────────────
  if (posType === "pax") {
    const ip   = settings["pos_pax_ip"]   || "192.168.8.163";
    const port = parseInt(settings["pos_pax_port"] || "10009", 10);

    console.log(`[POS] PAX ${ip}:${port} — sale ${amountCents}¢ ref=${ref}`);

    let result: PosTerminalResult;
    try {
      result = await payViaPax(ip, port, amountCents, ref);
    } catch (e) {
      result = { approved: false, error: e instanceof Error ? e.message : String(e) };
    }

    return res.json(result);
  }

  // ── myPOS Go 2 ───────────────────────────────────────────────────────────
  if (posType === "mypos") {
    const apiKey     = settings["pos_mypos_apikey"]     || "";
    const terminalId = settings["pos_mypos_terminal_id"] || "";

    const result: MyPosSaleResult = await initiateMyPos(amountCents, ref, apiKey, terminalId);
    return res.json(result);
  }

  return res.status(400).json({ error: `Tipo terminale non riconosciuto: ${posType}` });
});

// ── GET /api/pos/ping ─────────────────────────────────────────────────────────
// Testa la connettività al terminale PAX (solo PAX ha connettività TCP).
router.get("/ping", async (_req, res) => {
  const settings = await getSettings();
  const posType = settings["pos_type"] ?? "none";

  if (posType !== "pax") {
    return res.json({ ok: true, message: `Tipo terminale: ${posType} — nessun ping TCP disponibile` });
  }

  const ip   = settings["pos_pax_ip"]   || "192.168.8.163";
  const port = parseInt(settings["pos_pax_port"] || "10009", 10);

  const result = await pingPax(ip, port);
  return res.json({ ...result, ip, port });
});

export default router;
