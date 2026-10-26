import { validDate } from "./reservations";

export function rtReference(input: { numeroChiusura?: unknown; numeroDocumentoRt?: unknown; dataDocumento?: unknown }) {
  const closure = Number(input.numeroChiusura);
  const document = Number(input.numeroDocumentoRt);
  if (!Number.isSafeInteger(closure) || closure < 1 || closure > 9999 ||
      !Number.isSafeInteger(document) || document < 1 || document > 9999) {
    throw new Error("Inserisci chiusura Z e numero documento reali della RT (1–9999). Il numero interno non è un riferimento fiscale.");
  }
  if (!validDate(input.dataDocumento)) throw new Error("Inserisci la data reale del documento fiscale");
  const [year, month, day] = input.dataDocumento.split("-");
  return {
    closure, document, date: input.dataDocumento,
    command: `"${String(closure).padStart(4, "0")}-${String(document).padStart(4, "0")}-${day}${month}${year}"105M`,
  };
}

export function rtDate(value: string): string | null {
  if (!/^\d{6}$/.test(value)) return null;
  const date = `20${value.slice(4, 6)}-${value.slice(2, 4)}-${value.slice(0, 2)}`;
  return validDate(date) ? date : null;
}

export function cancellationConfirmed(before: { annulli: number; chiusura: number }, after: { annulli: number; chiusura: number; stato: number } | null) {
  return !!after && after.stato === 0 && after.chiusura === before.chiusura && after.annulli === before.annulli + 1;
}
