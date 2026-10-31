type InvoiceCustomer = {
  ragioneSociale?: string | null;
  partitaIva?: string | null;
  codiceFiscale?: string | null;
  indirizzo?: string | null;
  cap?: string | null;
  comune?: string | null;
};

/** Check the exact customer linked by ID, never a namesake or invented data. */
export function invoiceCustomerError(customer: InvoiceCustomer | null): string | null {
  if (!customer) return "Cliente collegato non trovato: verificare il cliente selezionato nella bozza.";
  const filled = (value: string | null | undefined) => !!value?.trim();
  const missing: string[] = [];
  if (!filled(customer.partitaIva) && !filled(customer.codiceFiscale)) missing.push("codice fiscale oppure P.IVA");
  if (!filled(customer.indirizzo)) missing.push("indirizzo");
  if (!filled(customer.cap)) missing.push("CAP");
  if (!filled(customer.comune)) missing.push("comune");
  return missing.length
    ? `Cliente collegato «${customer.ragioneSociale?.trim() || "senza denominazione"}»: dati mancanti: ${missing.join(", ")}.`
    : null;
}
