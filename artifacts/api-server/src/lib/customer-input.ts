// Older front-office builds used aliases that Drizzle's insert schema strips.
// Normalize before validation, preserving explicit canonical values (also null).
export function normalizeCustomerInput(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const data = { ...input } as Record<string, unknown>;
  const aliases: Record<string, string> = {
    sdiCode: "codiceDestinatario",
    indirizzoVia: "indirizzo",
    indirizzoCap: "cap",
    indirizzoComune: "comune",
    indirizzoProvince: "provincia",
  };
  for (const [alias, field] of Object.entries(aliases)) {
    if (Object.hasOwn(data, alias) && !Object.hasOwn(data, field)) data[field] = data[alias];
    delete data[alias];
  }
  return data;
}
