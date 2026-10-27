import type { StatusQ, Status2X } from "./fiscal-printer";

type Reading<T> = { ok: boolean; status: T | null };
export type ZBaseline = { serial: string; closure: number; source: "Q" | "2X" };
type ZReadiness = { ready: true; baseline: ZBaseline } | { ready: false; error: string };

/** 2X supplies identity and machine errors. Q is preferred for its RT counter,
 * but is not supported by every firmware. Never combine the two counters. */
export function zReadiness(q: Reading<StatusQ>, identity: Reading<Status2X>): ZReadiness {
  const fail = (reason: string): ZReadiness => ({ ready: false, error: `${reason} Chiusura Z non inviata.` });
  if (!identity.ok || !identity.status) return fail("Stato ECR 2X non leggibile: verificare collegamento e protocollo RT.");
  const s = identity.status;
  if (!s.matricola.trim()) return fail("La RT non ha restituito la matricola.");
  if (!/^\d+$/.test(s.errCode) || Number(s.errCode) !== 0) return fail(`La RT segnala errore ${s.errCode || "non leggibile"}: controllare il display della stampante.`);
  if (s.carta) return fail("Carta esaurita nella RT: ripristinare il rotolo.");
  if (s.scontrinoAperto || (q.status && [1, 2].includes(q.status.stato))) return fail("Scontrino fiscale aperto o in pagamento: completarlo o annullarlo dalla funzione dedicata.");
  if (s.nonFiscaleAperto || q.status?.stato === 3) return fail("Documento non fiscale aperto: completarlo dalla funzione dedicata.");
  if (q.status && ![0, 1, 2, 3].includes(q.status.stato)) return fail(`Stato scontrino RT non riconosciuto (${q.status.stato}).`);
  const source = q.ok && q.status ? "Q" : "2X";
  const closure = source === "Q" ? q.status!.chiusura : (/^\d+$/.test(s.numChiusura) ? Number(s.numChiusura) : NaN);
  if (!Number.isSafeInteger(closure) || closure < 0 || closure >= 9999) return fail("Contatore chiusure RT non valido o a fine numerazione: verificare sulla stampante.");
  return { ready: true, baseline: { serial: s.matricola.trim(), closure, source } };
}

/** Same source and same physical RT, closed and healthy, exactly one Z ahead. */
export function zConfirmed(baseline: ZBaseline, q: Reading<StatusQ>, identity: Reading<Status2X>): boolean {
  if (!identity.ok || !identity.status) return false;
  const s = identity.status;
  if (s.matricola.trim() !== baseline.serial || !/^\d+$/.test(s.errCode) || Number(s.errCode) !== 0 ||
      s.scontrinoAperto || s.nonFiscaleAperto || s.carta) return false;
  if (q.status && q.status.stato !== 0) return false;
  if (baseline.source === "Q") return q.ok && !!q.status && q.status.chiusura === baseline.closure + 1;
  return /^\d+$/.test(s.numChiusura) && Number(s.numChiusura) === baseline.closure + 1;
}
