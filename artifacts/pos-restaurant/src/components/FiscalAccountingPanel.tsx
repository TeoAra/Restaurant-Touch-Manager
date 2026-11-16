import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FiscalAccountingSummary } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";

const API = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;
const euro = (value: string) => Number(value).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
const date = (value: string) => new Date(value).toLocaleString("it-IT", { timeZone: "Europe/Rome" });
const methodNames: Record<string, string> = { cash: "Contanti", contanti: "Contanti", card: "Carta / POS", bancomat: "Carta / POS", satispay: "Satispay" };

export function FiscalAccountingTotals({ data }: { data: FiscalAccountingSummary }) {
  return <div className="space-y-3" data-testid="fiscal-accounting-totals">
    <p className="text-sm text-slate-600">
      {data.from ? <>Dall’ultima chiusura Z confermata: <strong>{date(data.from)}</strong></> : "Nessuna Z confermata salvata: è mostrato tutto lo storico disponibile, non un turno verificato."}
      {" · fino al "}{date(data.to)}
    </p>
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
      {[
        ["Documenti RT emessi", data.rtRecorded],
        ["Fatture (non inviate da RT)", data.invoices],
        ["Vendite senza duplicati", data.total],
        ["Pagamenti registrati", data.paymentsTotal],
      ].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs font-semibold text-slate-600">{label}</p>
        <p className="text-xl font-bold text-slate-950 mt-1 tabular-nums">{euro(value)}</p>
      </div>)}
    </div>
    <p className="text-xs text-slate-600">
      IVA gestionale: <strong>{euro(data.iva)}</strong>. Documenti RT al netto degli annulli registrati.
      {" "}Fatture emesse e bozze già incassate incluse; bozze non pagate e fatture annullate escluse.
      {" "}Le fatture non ancora incassate sono vendite, non denaro ricevuto.
      {Number(data.overlap) !== 0 && <> Sovrapposizione fatture/scontrini dello stesso ordine sottratta: <strong>{euro(data.overlap)}</strong>.</>}
    </p>
    {data.methods.length > 0 && <div className="flex flex-wrap gap-2 text-sm">
      {data.methods.map(m => <span key={m.method} className="border border-slate-200 rounded-lg px-3 py-2 bg-white">
        {methodNames[m.method] ?? m.method}: <strong>{euro(m.amount)}</strong>
      </span>)}
    </div>}
    {Number(data.paidDrafts) > 0 && <p className="text-sm text-amber-900 bg-amber-50 rounded-lg p-3">Fatture già incassate ancora in bozza: {euro(data.paidDrafts)}. Sono incluse nelle vendite anche se l’XML deve ancora essere completato.</p>}
    {(data.uncertainCount > 0 || Number(data.legacyTotal) > 0) && <p role="status" className="text-sm text-amber-900 bg-amber-50 rounded-lg p-3">
      Da riconciliare, non sommati alle vendite confermate: {data.uncertainCount} tentativi RT per {euro(data.uncertainTotal)};
      {" "}registrazioni storiche senza prova di emissione per {euro(data.legacyTotal)}. Non ripetere l’incasso per correggere il report.
    </p>}
    {data.historicalInvoiceDates && <p className="text-xs text-amber-900">Per le vecchie fatture senza data/ora di emissione registrata è usata la data di creazione: l’attribuzione storica al turno non è certificata.</p>}
    {data.rt && <div className="rounded-xl border border-slate-300 bg-white p-4 space-y-1" data-testid="rt-accounting-reading">
      <p className="font-semibold text-slate-950">Totale attuale letto dalla RT: {data.rt.total == null ? "non disponibile" : euro(data.rt.total)}</p>
      <p className="text-xs text-slate-500">Lettura del {date(data.rt.readAt)}</p>
      {data.rt.difference != null && <p className={Number(data.rt.difference) !== 0 ? "font-semibold text-amber-900" : "text-slate-700"}>
        Differenza RT − documenti registrati: {euro(data.rt.difference)}
      </p>}
      <p className="text-xs text-slate-600">{data.rt.message}</p>
    </div>}
    <p className="text-xs text-slate-500">Riepilogo gestionale: non modifica il rapporto X/Z fiscale della stampante e non certifica la ricezione all’AdE o allo SDI. Le chiusure fatte direttamente dalla RT non aggiornano automaticamente il periodo nel gestionale.</p>
  </div>;
}

export function FiscalAccountingPanel() {
  const [reading, setReading] = useState(false);
  const [live, setLive] = useState<FiscalAccountingSummary | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const query = useQuery<FiscalAccountingSummary>({
    queryKey: ["fiscal-accounting"],
    queryFn: async () => {
      const response = await fetch(`${API}/fiscal/accounting-summary`);
      if (!response.ok) throw new Error("Impossibile caricare il riepilogo del turno");
      return response.json();
    },
    refetchInterval: 30_000,
  });
  const read = async () => {
    setReading(true); setReadError(null);
    try {
      const response = await fetch(`${API}/fiscal/accounting-summary?readRt=1`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Lettura RT non riuscita");
      setLive(data);
    } catch (error) { setLive(null); setReadError((error as Error).message); }
    finally { setReading(false); }
  };
  // A physical reading remains a dated snapshot; do not mix it with newer DB totals.
  const validLive = live && live.lastClosure?.id === query.data?.lastClosure?.id ? live : null;
  const data = validLive ?? query.data;
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-bold text-slate-950">Dall’ultima chiusura Z</h2>
      <div className="flex gap-2">
        <Button variant="outline" disabled={reading || query.isFetching} onClick={() => { setLive(null); setReadError(null); void query.refetch(); }}>Aggiorna</Button>
        <Button disabled={reading} onClick={read}>{reading ? "Lettura…" : "Leggi totali RT"}</Button>
      </div>
    </div>
    {(readError || query.error) && <p role="alert" className="text-sm text-red-800">{readError ?? (query.error as Error).message}</p>}
    {!data && query.isLoading && <p className="text-sm text-slate-600">Caricamento riepilogo…</p>}
    {validLive && <p className="text-xs text-slate-600">I dati sotto sono una fotografia della lettura indicata. Premi Aggiorna per tornare ai dati correnti.</p>}
    {data && <FiscalAccountingTotals data={data} />}
  </section>;
}
