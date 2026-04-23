import { Router } from "express";

const router = Router();

// ── Luhn-style checksum per P.IVA italiana ────────────────────────────────────
function checkPivaIT(piva: string): boolean {
  if (!/^\d{11}$/.test(piva)) return false;
  let s = 0;
  for (let i = 0; i < 10; i++) {
    const n = parseInt(piva[i]!, 10);
    if (i % 2 === 0) {
      s += n;
    } else {
      const d = n * 2;
      s += d > 9 ? d - 9 : d;
    }
  }
  const check = (10 - (s % 10)) % 10;
  return check === parseInt(piva[10]!, 10);
}

router.get("/", async (req, res) => {
  const raw = String(req.query.vat ?? "").trim().toUpperCase().replace(/\s/g, "");
  if (!raw) return res.status(400).json({ error: "Parametro vat mancante" });

  const country = raw.length >= 2 && /^[A-Z]{2}/.test(raw) ? raw.slice(0, 2) : "IT";
  const vatNum = country === "IT" && raw.startsWith("IT") ? raw.slice(2) : raw;

  if (country === "IT" && !/^\d{11}$/.test(vatNum)) {
    return res.status(400).json({ error: "Formato P.IVA non valido (11 cifre senza prefisso IT)" });
  }

  try {
    const url = `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${country}/vat/${vatNum}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) {
      return res.status(502).json({ error: "Servizio VIES non disponibile" });
    }

    const data = await resp.json() as {
      isValid?: boolean;
      valid?: boolean;
      name?: string;
      address?: string;
      countryCode?: string;
      vatNumber?: string;
      userError?: string;
    };

    // Il VIES restituisce "isValid" (non "valid") nelle versioni recenti dell'API
    const isValid = data.isValid ?? data.valid ?? false;

    if (isValid) {
      // P.IVA verificata e iscritta al VIES — auto-fill completo
      const parsed = parseViesAddress(data.address ?? "");
      return res.json({
        valid: true,
        source: "vies",
        vatNumber: vatNum,
        country,
        name: data.name ?? "",
        address: data.address ?? "",
        parsed,
      });
    }

    // P.IVA non trovata nel VIES → verifica checksum locale
    if (country === "IT" && checkPivaIT(vatNum)) {
      return res.json({
        valid: true,
        source: "local",
        vatNumber: vatNum,
        country,
        name: "",
        address: "",
        message: "P.IVA valida (non iscritta al VIES — compila manualmente ragione sociale e indirizzo)",
        parsed: { indirizzo: "", cap: "", comune: "", provincia: "", nazione: "IT" },
      });
    }

    return res.json({ valid: false, message: "P.IVA non valida" });

  } catch (err: unknown) {
    // Se VIES non raggiungibile, almeno verifica checksum locale
    if (country === "IT" && checkPivaIT(vatNum)) {
      return res.json({
        valid: true,
        source: "local",
        vatNumber: vatNum,
        country,
        name: "",
        address: "",
        message: "VIES non raggiungibile — P.IVA sintatticamente valida (compila manualmente)",
        parsed: { indirizzo: "", cap: "", comune: "", provincia: "", nazione: "IT" },
      });
    }
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: "Errore connessione VIES: " + msg });
  }
});

function parseViesAddress(raw: string): {
  indirizzo: string; cap: string; comune: string; provincia: string; nazione: string;
} {
  const lines = raw.split(/\n|\r/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return { indirizzo: "", cap: "", comune: "", provincia: "", nazione: "IT" };

  const indirizzo = lines[0] ?? "";
  let cap = "", comune = "", provincia = "";

  const lastLine = lines[lines.length - 1] ?? "";
  const capMatch = lastLine.match(/^(\d{5})\s+(.+?)(?:\s+([A-Z]{2}))?$/);
  if (capMatch) {
    cap = capMatch[1] ?? "";
    comune = capMatch[2] ?? "";
    provincia = capMatch[3] ?? "";
  } else {
    comune = lastLine;
  }

  return { indirizzo, cap, comune, provincia, nazione: "IT" };
}

export default router;
