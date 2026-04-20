import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { BackofficeShell } from "@/components/BackofficeShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Receipt, AlertTriangle, BarChart3, CheckCircle2, XCircle, Printer, RefreshCw, Search, Activity, FileText, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

type FiscalReceipt = {
  id: number; numero: number; anno: number; data: string; orderId?: number;
  importo: string; iva: string; metodoPagamento: string; annullato: boolean;
  annullatoAt?: string; motivoAnnullo?: string; printerRef?: string; printerSerial?: string;
};

type ReportResult = {
  tipo: "X" | "Z";
  data: string; anno: number; scontrini: number; totale: string; totale_iva: string;
  printer?: { ok: boolean; status?: number; body?: string; error?: string };
  printer_name?: string; printer_matricola?: string; simulated: boolean;
};

type PrinterStatus = {
  found: boolean;
  error?: string;
  printer?: { name: string; ip: string; model?: string; matricola?: string };
  connection?: { ok: boolean; status?: number; body?: string; error?: string };
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

function usePrinterStatus() {
  return useQuery<PrinterStatus>({
    queryKey: ["fiscal_printer_status"],
    queryFn: () => fetch(`${API}/fiscal/printer-status`).then(r => r.json()),
    staleTime: 30_000,
  });
}

// Mappature IVA→reparto configurabili
const REPARTI_CONFIG = [
  { key: "rt_reparto_22", label: "IVA 22%", default: "2" },
  { key: "rt_reparto_10", label: "IVA 10%", default: "1" },
  { key: "rt_reparto_5",  label: "IVA 5%",  default: "1" },
  { key: "rt_reparto_4",  label: "IVA 4%",  default: "1" },
  { key: "rt_reparto_0",  label: "IVA 0%",  default: "1" },
];

export default function FiscalePage() {
  const [tab, setTab] = useState<"receipts" | "xreport" | "zreport">("receipts");
  const [searchNumero, setSearchNumero] = useState("");
  const [searchAnno, setSearchAnno] = useState(String(new Date().getFullYear()));
  const [searchParams, setSearchParams] = useState<{ anno?: number; numero?: number }>({});
  const [voidDialog, setVoidDialog] = useState<{ open: boolean; receipt?: FiscalReceipt }>({ open: false });
  const [motivo, setMotivo] = useState("");
  const [voidChiusura, setVoidChiusura] = useState("");
  const [voidDocumento, setVoidDocumento] = useState("");
  const [voidData, setVoidData] = useState("");
  const [reportResult, setReportResult] = useState<ReportResult | null>(null);
  const [xLoading, setXLoading] = useState(false);
  const [zLoading, setZLoading] = useState(false);
  const [repartiEdit, setRepartiEdit] = useState<Record<string, string>>({});
  const [repartiOpen, setRepartiOpen] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: receipts = [] } = useReceipts(searchParams);
  const { data: printerStatus, refetch: refetchPrinter } = usePrinterStatus();
  const { data: settings = {} } = useQuery<Record<string, string>>({
    queryKey: ["settings"],
    queryFn: () => fetch(`${API}/settings`).then(r => r.json()),
  });
  const saveSetting = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      fetch(`${API}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

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
      body: JSON.stringify({
        motivo: motivo || "Annullo operatore",
        numeroChiusura: voidChiusura ? Number(voidChiusura) : undefined,
        numeroDocumentoRt: voidDocumento ? Number(voidDocumento) : undefined,
        dataDocumento: voidData || voidDialog.receipt.data,
      }),
    });
    if (!resp.ok) return toast({ title: "Errore annullo", variant: "destructive" });
    const data = await resp.json();
    qc.invalidateQueries({ queryKey: ["fiscal_receipts"] });
    setVoidDialog({ open: false });
    setMotivo("");
    setVoidChiusura("");
    setVoidDocumento("");
    setVoidData("");
    toast({
      title: "Scontrino annullato",
      description: data.printer?.ok
        ? "Annullo inviato alla stampante fiscale"
        : data.printer
          ? "Annullo registrato (stampante non raggiunta)"
          : "Annullo registrato (nessuna stampante fiscale configurata)",
    });
  }

  async function handleXReport() {
    setXLoading(true);
    setReportResult(null);
    try {
      const resp = await fetch(`${API}/fiscal/x-report`, { method: "POST" });
      const data: ReportResult = await resp.json();
      setReportResult(data);
      toast({ title: "Report X eseguito" });
    } catch {
      toast({ title: "Errore report X", variant: "destructive" });
    } finally {
      setXLoading(false);
    }
  }

  async function handleZReport() {
    setZLoading(true);
    setReportResult(null);
    try {
      const resp = await fetch(`${API}/fiscal/z-report`, { method: "POST" });
      const data: ReportResult = await resp.json();
      setReportResult(data);
      toast({ title: "Chiusura fiscale eseguita" });
    } catch {
      toast({ title: "Errore chiusura fiscale", variant: "destructive" });
    } finally {
      setZLoading(false);
    }
  }

  const printerOk = printerStatus?.found && printerStatus.connection?.ok;

  return (
    <BackofficeShell title="Gestione Fiscale" subtitle="Scontrini, Report X, Chiusura Z">
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">

        {/* Stato stampante fiscale */}
        <div className={cn(
          "rounded-xl border px-4 py-3 flex items-center gap-3 text-sm",
          !printerStatus ? "bg-slate-50 border-slate-200 text-slate-400"
            : printerStatus.found
              ? printerOk ? "bg-green-50 border-green-200 text-green-800" : "bg-amber-50 border-amber-200 text-amber-800"
              : "bg-red-50 border-red-200 text-red-700"
        )}>
          <Printer className="h-4 w-4 shrink-0" />
          <div className="flex-1 min-w-0">
            {!printerStatus
              ? "Verifica stampante fiscale…"
              : !printerStatus.found
                ? "Nessuna stampante fiscale (RT) configurata — imposta una stampante con spunta «Fiscale» in Stampanti"
                : (
                  <span>
                    <span className="font-semibold">{printerStatus.printer?.name}</span>
                    {printerStatus.printer?.model && <span className="text-xs ml-1.5 opacity-70">{printerStatus.printer.model}</span>}
                    {printerStatus.printer?.matricola && <span className="text-xs ml-1.5 font-mono opacity-70">Matr. {printerStatus.printer.matricola}</span>}
                    <span className="ml-2">{printerOk ? "— connessa" : "— non raggiungibile"}</span>
                  </span>
                )
            }
          </div>
          <button onClick={() => refetchPrinter()} className="shrink-0 text-xs underline opacity-60 hover:opacity-100">Verifica</button>
        </div>

        {/* Configurazione Reparti RT */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            onClick={() => {
              if (!repartiOpen) {
                const init: Record<string, string> = {};
                for (const r of REPARTI_CONFIG) init[r.key] = settings[r.key] ?? r.default;
                setRepartiEdit(init);
              }
              setRepartiOpen(v => !v);
            }}
          >
            <div className="flex items-center gap-2"><Settings2 className="h-4 w-4 text-slate-400" /> Reparti RT (IVA → N° Reparto)</div>
            <span className="text-slate-400 text-xs">{repartiOpen ? "▲" : "▼"}</span>
          </button>
          {repartiOpen && (
            <div className="border-t border-slate-100 px-4 py-3 space-y-3">
              <p className="text-xs text-slate-500">
                Associa ogni aliquota IVA al numero di <strong>reparto</strong> programmato sulla RT.
                Errore <code className="bg-slate-100 px-1 rounded">13 PLU non trovato</code> = reparto non configurato sulla stampante.
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {REPARTI_CONFIG.map(({ key, label, default: def }) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-xs text-slate-500">{label}</Label>
                    <Input
                      type="number" min="1" max="99"
                      value={repartiEdit[key] ?? settings[key] ?? def}
                      onChange={e => setRepartiEdit(prev => ({ ...prev, [key]: e.target.value }))}
                      className="h-9 font-mono text-center text-sm"
                    />
                  </div>
                ))}
              </div>
              <Button
                size="sm"
                onClick={async () => {
                  for (const [key, value] of Object.entries(repartiEdit)) {
                    if (value) await saveSetting.mutateAsync({ key, value });
                  }
                  toast({ title: "Reparti RT salvati" });
                  setRepartiOpen(false);
                }}
                disabled={saveSetting.isPending}
              >
                Salva reparti
              </Button>
            </div>
          )}
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          {[
            { k: "receipts", l: "Scontrini & Annulli", icon: Receipt },
            { k: "xreport", l: "Report X", icon: FileText },
            { k: "zreport", l: "Chiusura Z", icon: BarChart3 },
          ].map(({ k, l, icon: Icon }) => (
            <button key={k} onClick={() => { setTab(k as typeof tab); setReportResult(null); }}
              className={cn("flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors",
                tab === k ? "bg-white shadow-sm text-slate-800" : "text-slate-500 hover:text-slate-700")}>
              <Icon className="h-4 w-4 shrink-0" /> {l}
            </button>
          ))}
        </div>

        {/* ── TAB: SCONTRINI ─────────────────────────────────────────────── */}
        {tab === "receipts" && (
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <p className="text-sm font-semibold text-slate-700 mb-3">Ricerca scontrino</p>
              <div className="flex gap-2 items-end flex-wrap">
                <div>
                  <Label className="text-xs text-slate-500 mb-1 block">Anno</Label>
                  <Input className="h-9 w-24 text-sm" value={searchAnno} onChange={e => setSearchAnno(e.target.value)} placeholder={String(new Date().getFullYear())} />
                </div>
                <div>
                  <Label className="text-xs text-slate-500 mb-1 block">Numero</Label>
                  <Input className="h-9 w-32 text-sm" value={searchNumero} onChange={e => setSearchNumero(e.target.value)} placeholder="es. 42" type="number" />
                </div>
                <Button onClick={handleSearch} className="gap-1.5"><Search className="h-4 w-4" /> Cerca</Button>
                <Button variant="outline" onClick={handleReset}>Reset</Button>
              </div>
            </div>

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
                      <span className="text-slate-400">IVA € {parseFloat(r.iva || "0").toFixed(2)}</span>
                      {r.printerRef && <span>RT: {r.printerRef}</span>}
                      {r.printerSerial && <span className="font-mono text-[10px]">Matr. {r.printerSerial}</span>}
                      {r.annullato && r.motivoAnnullo && <span className="text-red-500">Motivo: {r.motivoAnnullo}</span>}
                    </div>
                  </div>
                  {!r.annullato && (
                    <button onClick={() => {
                        setVoidDialog({ open: true, receipt: r });
                        setMotivo("");
                        setVoidChiusura("");
                        setVoidDocumento(String(r.numero));
                        setVoidData(r.data);
                      }}
                      className="shrink-0 px-3 py-1.5 text-xs font-semibold text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5" /> Annulla
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── TAB: REPORT X ──────────────────────────────────────────────── */}
        {tab === "xreport" && (
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm text-center space-y-4">
              <div className="h-16 w-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto">
                <Activity className="h-8 w-8 text-blue-600" />
              </div>
              <div>
                <h3 className="font-bold text-lg text-slate-800">Report X — Lettura di Giornata</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Visualizza i totali del giorno senza azzerare i contatori della stampante fiscale.<br />
                  Operazione ripetibile in qualsiasi momento.
                </p>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700 text-left">
                <div className="flex items-center gap-2 font-semibold mb-1"><FileText className="h-3.5 w-3.5" /> Non azzera nulla</div>
                <p>Il Report X è una lettura di controllo. Puoi richiederlo quante volte vuoi durante la giornata. Non sostituisce il Report Z di chiusura.</p>
              </div>
              <Button size="lg" onClick={handleXReport} disabled={xLoading}
                className="w-full gap-2 text-base bg-blue-600 hover:bg-blue-700">
                {xLoading ? <RefreshCw className="h-5 w-5 animate-spin" /> : <Activity className="h-5 w-5" />}
                {xLoading ? "Lettura in corso…" : "Esegui Report X"}
              </Button>
            </div>
            <ReportResultCard result={reportResult} />
          </div>
        )}

        {/* ── TAB: CHIUSURA Z ────────────────────────────────────────────── */}
        {tab === "zreport" && (
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm text-center space-y-4">
              <div className="h-16 w-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto">
                <BarChart3 className="h-8 w-8 text-amber-600" />
              </div>
              <div>
                <h3 className="font-bold text-lg text-slate-800">Chiusura Fiscale Giornaliera (Z)</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Esegue il Report Z sulla stampante RT e azzera i contatori del giorno.<br />
                  Da eseguire una sola volta a fine giornata, dopo l'ultimo incasso.
                </p>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700 text-left">
                <div className="flex items-center gap-2 font-semibold mb-1"><AlertTriangle className="h-3.5 w-3.5" /> Operazione irreversibile</div>
                <p>La chiusura Z azzera i totali giornalieri della stampante fiscale e invia i dati all'Agenzia delle Entrate. Eseguire solo a fine servizio.</p>
              </div>
              <Button size="lg" onClick={handleZReport} disabled={zLoading}
                className="w-full gap-2 text-base bg-amber-600 hover:bg-amber-700 text-white">
                {zLoading ? <RefreshCw className="h-5 w-5 animate-spin" /> : <Printer className="h-5 w-5" />}
                {zLoading ? "Elaborazione…" : "Esegui Chiusura Z"}
              </Button>
            </div>
            <ReportResultCard result={reportResult} />
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
                <div className="font-bold text-slate-800">Scontrino N° {voidDialog.receipt.numero}/{voidDialog.receipt.anno}</div>
                <div className="text-slate-600 mt-0.5">Data: {voidDialog.receipt.data} — Importo: <span className="font-semibold">€ {voidDialog.receipt.importo}</span></div>
              </div>
            )}

            {/* Dati RT obbligatori per annullo */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-3">
              <p className="text-xs font-semibold text-amber-800 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Dati RT — presenti sullo scontrino cartaceo
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs text-slate-600 mb-1 block">N° Chiusura (Z)</Label>
                  <Input
                    value={voidChiusura}
                    onChange={e => setVoidChiusura(e.target.value.replace(/\D/g, ""))}
                    placeholder="es. 42"
                    className="h-9 text-sm font-mono text-center"
                  />
                </div>
                <div>
                  <Label className="text-xs text-slate-600 mb-1 block">N° Documento RT</Label>
                  <Input
                    value={voidDocumento}
                    onChange={e => setVoidDocumento(e.target.value.replace(/\D/g, ""))}
                    placeholder="es. 734"
                    className="h-9 text-sm font-mono text-center"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs text-slate-600 mb-1 block">Data documento</Label>
                <Input
                  type="date"
                  value={voidData}
                  onChange={e => setVoidData(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs text-slate-500 mb-1 block">Motivo annullo</Label>
              <Input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Es. errore importo, reso merce, ecc." className="h-9 text-sm" />
            </div>
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

function ReportResultCard({ result }: { result: ReportResult | null }) {
  if (!result) return null;
  const isX = result.tipo === "X";
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3">
      <div className="flex items-center gap-2 font-semibold text-slate-800">
        <CheckCircle2 className="h-5 w-5 text-green-600" />
        Report {result.tipo} — {result.data}
        {result.printer_name && <span className="text-xs font-normal text-slate-400 ml-1">({result.printer_name}{result.printer_matricola ? ` · Matr. ${result.printer_matricola}` : ""})</span>}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-slate-50 rounded-lg p-3 text-center border border-slate-200">
          <div className="text-2xl font-bold text-slate-800">{result.scontrini}</div>
          <div className="text-xs text-slate-500">Scontrini</div>
        </div>
        <div className="bg-orange-50 rounded-lg p-3 text-center border border-orange-200">
          <div className="text-xl font-bold text-primary">€ {parseFloat(result.totale).toFixed(2)}</div>
          <div className="text-xs text-slate-500">Totale lordo</div>
        </div>
        <div className="bg-blue-50 rounded-lg p-3 text-center border border-blue-200">
          <div className="text-xl font-bold text-blue-700">€ {parseFloat(result.totale_iva || "0").toFixed(2)}</div>
          <div className="text-xs text-slate-500">di cui IVA</div>
        </div>
      </div>
      {result.simulated && (
        <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200">
          Nessuna stampante fiscale raggiunta — configurare una stampante con spunta «Fiscale» in Stampanti
        </p>
      )}
      {result.printer && !result.simulated && (
        <p className={cn("text-xs rounded-lg px-3 py-2 border", result.printer.ok
          ? "text-green-700 bg-green-50 border-green-200"
          : "text-red-600 bg-red-50 border-red-200")}>
          Stampante: {result.printer.ok
            ? `${isX ? "Lettura" : "Chiusura"} inviata correttamente`
            : `Errore: ${result.printer.error ?? "Non raggiungibile"}`}
        </p>
      )}
    </div>
  );
}
