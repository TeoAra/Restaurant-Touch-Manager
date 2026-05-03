import type { Request, Response, NextFunction } from "express";

/**
 * Guard pragmatico per endpoint sensibili (apertura cassetto, chiusura Z, etc.).
 *
 * Limite noto: il backend POS attuale non gestisce sessioni server-side autentiche.
 * L'app è pensata per LAN del ristorante. Questo middleware richiede header
 * `x-user-role: admin` impostato dal client (Layout/AuthContext) per:
 *  1. Negare chiamate dirette da tool/scanner che non passano dal frontend.
 *  2. Permettere all'audit log di tracciare chi (header `x-user-id`/`x-user-name`)
 *     ha eseguito l'azione fisica sul cassetto.
 *
 * In futuro (cloud / vendita esterna) sostituire con vera sessione/JWT.
 */
export function requireAdminHeader(req: Request, res: Response, next: NextFunction) {
  const role = String(req.header("x-user-role") ?? "").toLowerCase();
  if (role !== "admin") {
    return res.status(403).json({ ok: false, error: "Operazione riservata all'amministratore" });
  }
  // Espone i dati utente alla session "fittizia" per logAudit
  const userId = Number(req.header("x-user-id"));
  const userName = req.header("x-user-name") ?? null;
  (req as unknown as { session?: { userId?: number; userName?: string | null } }).session = {
    userId: Number.isFinite(userId) && userId > 0 ? userId : undefined,
    userName: typeof userName === "string" ? userName : null,
  };
  next();
  return;
}
