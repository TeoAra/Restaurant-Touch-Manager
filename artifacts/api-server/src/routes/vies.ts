import { Router } from "express";

const router = Router();

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
      valid?: boolean;
      name?: string;
      address?: string;
      countryCode?: string;
      vatNumber?: string;
    };

    if (!data.valid) {
      return res.json({ valid: false, message: "P.IVA non valida o non trovata nel VIES" });
    }

    const parsed = parseViesAddress(data.address ?? "");

    res.json({
      valid: true,
      vatNumber: vatNum,
      country,
      name: data.name ?? "",
      address: data.address ?? "",
      parsed,
    });
  } catch (err: unknown) {
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
