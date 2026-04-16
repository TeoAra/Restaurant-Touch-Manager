import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BackofficeShell } from "@/components/BackofficeShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Receipt, AlertTriangle, BarChart3, CheckCircle2, XCircle, Printer, RefreshCw, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

type FiscalReceipt = {
  id: number; numero: number; anno: number; data: string; orderId?: number;
  importo: string; iva: string; metodoPagamento: string; annullato: boolean;
  annullatoAt?: string; motivoAnnullo?: string; printerRef?: string;
};

type ZReportResult = {
  data: string; anno: number; scontrini: number; totale: string;
  printer?: { ok: boolean; status?: number; error?: string }; simulated: boolean;
};

function useReceipts(q?: { anno?: number; numero?: number }) {
  const params = new URLSearchParams();
  if (q?.anno) params.set("anno", String(q.anno));
  if (q?.numero) params.set("numero", String(q.numero));
  const queryStr = params.toString();
  return useQuery<FiscalReceipt[]>({
    queryKey: ["fiscal_receipts", queryStr],
    queryFn: () => fetch(`${API}/fiscal/receipts${queryStr ? `?${queryStr}` : ""}`).then(r => r.json()),
  });
}

export default function FiscalePage() {
  const [tab, setTab] = useState<"receipts" | "zreport">("receipts");
  const [searchNumero, setSearchNumero] = useState("");
  const [searchAnno, setSearchAnno] = useState(String(new Date().getFullYear()));
  const [searchParams, setSearchParams] = useState<{ anno?: number; numero?: number }>({});
  const [voidDialog, setVoidDialog] = useState<{ open: boolean; receipt?: FiscalReceipt }>({ open: false });
  const [motivo, setMotivo] = useState("");
  const [zResult, setZResult] = useState<ZReportResult | null>(null);
  const [zLoading, setZLoading] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: receipts = [] } = useReceipts(searchParams);

  function handleSearch() {
    setSearchParams({
      anno: searchAnno ? Number(searchAnno) : undefined,
      numero: searchNumero ? Number(searchNumero) : undefined,
    });
  }

  function handleReset() {
    setSearchNumero("");
    setSearchAnno(String(new Date().getFullYear()));
    setSearchParams({});
  }

  async function handleVoid() {
    if (!voidDialog.receipt) return;
    const resp = await fetch(`${API}/fiscal/receipts/${voidDialog.receipt.id}/void`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ motivo: motivo || "Annullo operatore" }),
    });
    if (!resp.ok) return toast({ title: "Errore annullo", variant: "destructive" });
    const data = await resp.json();
    qc.invalidateQueries({ queryKey: ["fiscal_receipts"] });
    setVoidDialog({ open: false });
    setMotivo("");
    const printerOk = data.printer?.ok;
    toast({
      title: "Scontrino annullato",
      description: printerOk ? "Annullo inviato alla stampante fiscale" : data.printer ? "Annullo registrato (stampante non raggiunta)" : "Annullo registrato (stampante non configurata)",
    });
  }

  async function handleZReport() {
    setZLoading(true);
    try {
      const resp = await fetch(`${API}/fiscal/z-report`, { method: "POST" });
      const data: ZReportResult = await resp.json();
      setZResult(data);
      toast({ title: "Chiusura fiscale eseguita" });
    } catch {
      toast({ title: "Errore chiusura fiscale", variant: "destructive" });
    } finally {
      setZLoading(false);
    }
  }

  return (
    <BackofficeShell title="Gestione Fiscale" subtitle="Scontrini, Z-Report, annulli">
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
        {/* Tab switcher */}
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          {[
            { k: "receipts", l: "Scontrini & Annulli", icon: Receipt },
            { k: "zreport", l: "Chiusura Fiscale (Z)", icon: BarChart3 },
          ].map(({ k, l, icon: Icon }) => (
            <button key={k} onClick={() => setTab(k as typeof tab)}
              className={cn("flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-colors",
                tab === k ? "bg-white shadow-sm text-slate-800" : "text-slate-500 hover:text-slate-700")}>
              <Icon className="h-4 w-4" /> {l}
            </button>
          ))}
        </div>

        {tab === "receipts" && (
          <div className="space-y-4">
            {/* Search bar */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <p className="text-sm font-semibold text-slate-700 mb-3">Ricerca scontrino (per numero e/o anno)</p>
              <div className="flex gap-2 items-end">
                <div>
                  <Label className="text-xs text-slate-500 mb-1 block">Anno</Label>
                  <Input className="h-9 w-24 text-sm" value={searchAnno} onChange={e => setSearchAnno(e.target.value)} placeholder={String(new Date().getFullYear())} />
                </div>
                <div>
                  <Label className="text-xs text-slate-500 mb-1 block">Numero scontrino</Label>
                  <Input className="h-9 w-32 text-sm" value={searchNumero} onChange={e => setSearchNumero(e.target.value)} placeholder="es. 42" type="number" />
                </div>
                <Button onClick={handleSearch} className="gap-1.5"><Search className="h-4 w-4" /> Cerca</Button>
                <Button variant="outline" onClick={handleReset}>Reset</Button>
              </div>
            </div>

            {/* Receipt list */}
            <div className="space-y-2">
              {receipts.length === 0 && (
                <div className="text-center py-10 text-slate-400">
                  <Receipt className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Nessuno scontrino trovato</p>
                </div>
              )}
              {receipts.map(r => (
                <div key={r.id} className={cn("bg-white border rounded-xl p-4 shadow-sm flex items-start gap-3",
                  r.annullato ? "border-red-200 bg-red-50/30" : "border-slate-200")}>
                  <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0",
                    r.annullato ? "bg-red-100 text-red-600" : "bg-green-100 text-green-700")}>
                    {r.annullato ? <XCircle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-800">N° {r.numero}/{r.anno}</span>
                      <Badge variant="outline" className={cn("text-xs", r.annullato ? "bg-red-50 text-red-600 border-red-200" : "bg-green-50 text-green-700 border-green-200")}>
                        {r.annullato ? "Annullato" : "Emesso"}
                      </Badge>
                      <span className="text-xs text-slate-500">{r.metodoPagamento}</span>
                    </div>
                    <div className="flex gap-x-4 gap-y-0.5 mt-0.5 text-xs text-slate-500 flex-wrap">
                      <span>{r.data}</span>
                      <span className="font-semibold text-slate-700">€ {r.importo}</span>
                      {r.printerRef && <span>Rif. printer: {r.printerRef}</span>}
                      {r.annullato && r.motivoAnnullo && <span className="text-red-500">Motivo: {r.motivoAnnullo}</span>}
                    </div>
                  </div>
                  {!r.annullato && (
                    <button onClick={() => { setVoidDialog({ open: true, receipt: r }); setMotivo(""); }}
                      className="shrink-0 px-3 py-1.5 text-xs font-semibold text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5" /> Annulla
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "zreport" && (
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm text-center space-y-4">
              <div className="h-16 w-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto">
                <BarChart3 className="h-8 w-8 text-amber-600" />
              </div>
              <div>
                <h3 className="font-bold text-lg text-slate-800">Chiusura Fiscale Giornaliera</h3>
                <p className="text-sm text-slate-500 mt-1">Esegue lo Z-Report sulla stampante DTR DFront RT e azzera i contatori del giorno.</p>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700 text-left">
                <div className="flex items-center gap-2 font-semibold mb-1"><AlertTriangle className="h-3.5 w-3.5" /> Attenzione</div>
                <p>La chiusura fiscale è un'operazione irreversibile. Eseguirla solo a fine giornata dopo l'ultimo incasso.</p>
              </div>
              <Button size="lg" onClick={handleZReport} disabled={zLoading}
                className="w-full gap-2 text-base">
                {zLoading ? <RefreshCw className="h-5 w-5 animate-spin" /> : <Printer className="h-5 w-5" />}
                {zLoading ? "Elaborazione…" : "Esegui Chiusura Z"}
              </Button>
            </div>

            {zResult && (
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3">
                <div className="flex items-center gap-2 font-semibold text-slate-800">
                  <CheckCircle2 className="h-5 w-5 text-green-600" /> Chiusura eseguita — {zResult.data}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-50 rounded-lg p-3 text-center border border-slate-200">
                    <div className="text-2xl font-bold text-slate-800">{zResult.scontrini}</div>
                    <div className="text-xs text-slate-500">Scontrini del giorno</div>
                  </div>
                  <div className="bg-orange-50 rounded-lg p-3 text-center border border-orange-200">
                    <div className="text-2xl font-bold text-primary">€ {parseFloat(zResult.totale).toFixed(2)}</div>
                    <div className="text-xs text-slate-500">Totale incassato</div>
                  </div>
                </div>
                {zResult.simulated && (
                  <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200">
                    Stampa simulata — configurare IP stampante DTR in Impostazioni &gt; Stampanti Fiscali
                  </p>
                )}
                {zResult.printer && !zResult.simulated && (
                  <p className={cn("text-xs rounded-lg px-3 py-2 border", zResult.printer.ok
                    ? "text-green-700 bg-green-50 border-green-200"
                    : "text-red-600 bg-red-50 border-red-200")}>
                    Stampante: {zResult.printer.ok ? "Chiusura inviata correttamente" : `Errore: ${zResult.printer.error}`}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Void dialog */}
      <Dialog open={voidDialog.open} onOpenChange={o => !o && setVoidDialog({ open: false })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" /> Annullo Scontrino
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {voidDialog.receipt && (
              <div className="bg-slate-50 rounded-xl p-3 text-sm border border-slate-200">
                <div className="font-bold text-slate-800">N° {voidDialog.receipt.numero}/{voidDialog.receipt.anno}</div>
                <div className="text-slate-600 mt-0.5">Data: {voidDialog.receipt.data} — Importo: <span className="font-semibold">€ {voidDialog.receipt.importo}</span></div>
              </div>
            )}
            <div>
              <Label className="text-xs text-slate-500 mb-1 block">Motivo annullo</Label>
              <Input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Es. errore importo, reso merce, ecc." className="h-9 text-sm" />
            </div>
            <p className="text-xs text-red-500">Questa operazione invierà il comando di annullo alla stampante fiscale DTR DFront RT se configurata.</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setVoidDialog({ open: false })}>Annulla</Button>
            <Button variant="destructive" onClick={handleVoid}>Conferma Annullo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BackofficeShell>
  );
}
