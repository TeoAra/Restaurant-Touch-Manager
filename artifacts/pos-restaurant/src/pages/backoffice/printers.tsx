import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Printer, Wifi, WifiOff, CheckCircle2, XCircle, Loader2, Receipt, Search } from "lucide-react";
import { BackofficeShell } from "@/components/BackofficeShell";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

type PrinterT = {
  id: number;
  name: string;
  ip: string;
  port: number;
  subnet: string | null;
  model: string | null;
  isFiscale: boolean;
  matricola: string | null;
  departmentId: number | null;
  active: boolean;
};

type PrinterForm = {
  name: string;
  ip: string;
  port: number;
  subnet: string;
  model: string;
  isFiscale: boolean;
  matricola: string;
  active: boolean;
};

type TestResult = { id: number; ok: boolean; ms?: number; error?: string } | null;

const empty: PrinterForm = {
  name: "",
  ip: "192.168.1.",
  port: 9100,
  subnet: "255.255.255.0",
  model: "",
  isFiscale: false,
  matricola: "",
  active: true,
};

async function fetchPrinters(): Promise<PrinterT[]> {
  const res = await fetch(`${API}/printers`);
  if (!res.ok) throw new Error("Errore");
  return res.json();
}

function FLabel({ children }: { children: React.ReactNode }) {
  return <Label className="text-xs text-slate-500 mb-1 block">{children}</Label>;
}

export default function PrintersPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: printers = [], isLoading } = useQuery({ queryKey: ["printers"], queryFn: fetchPrinters });

  // Dialog
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PrinterT | null>(null);
  const [form, setForm] = useState<PrinterForm>(empty);

  const create = useMutation({
    mutationFn: (data: PrinterForm) =>
      fetch(`${API}/printers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          port: Number(data.port),
          subnet: data.subnet || null,
          model: data.model || null,
          matricola: data.isFiscale && data.matricola ? data.matricola : null,
          departmentId: null,
        }),
      }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["printers"] }); setOpen(false); toast({ title: "Stampante aggiunta" }); },
  });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: number; data: PrinterForm }) =>
      fetch(`${API}/printers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          port: Number(data.port),
          subnet: data.subnet || null,
          model: data.model || null,
          matricola: data.isFiscale && data.matricola ? data.matricola : null,
          departmentId: null,
        }),
      }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["printers"] }); setOpen(false); toast({ title: "Stampante aggiornata" }); },
  });

  const remove = useMutation({
    mutationFn: (id: number) => fetch(`${API}/printers/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["printers"] }); toast({ title: "Stampante eliminata" }); },
  });

  function openNew() { setEditing(null); setForm(empty); setOpen(true); }
  function openEdit(p: PrinterT) {
    setEditing(p);
    setForm({
      name: p.name,
      ip: p.ip,
      port: p.port,
      subnet: p.subnet ?? "255.255.255.0",
      model: p.model ?? "",
      isFiscale: p.isFiscale,
      matricola: p.matricola ?? "",
      active: p.active,
    });
    setOpen(true);
  }

  function handleSave() {
    if (editing) update.mutate({ id: editing.id, data: form });
    else create.mutate(form);
  }

  // Test all printers
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<Map<number, TestResult>>(new Map());
  const [testingId, setTestingId] = useState<number | null>(null);

  // Test IP diretto
  const [directIp, setDirectIp] = useState("192.168.8.");
  const [directPort, setDirectPort] = useState("9100");
  const [directResult, setDirectResult] = useState<{ ok: boolean; ms?: number; error?: string } | null>(null);
  const [directTesting, setDirectTesting] = useState(false);

  // Test CGI RT fiscale
  const [cgiResults, setCgiResults] = useState<Map<number, { ok: boolean; ms?: number; error?: string; url?: string; body?: string } | null>>(new Map());
  const [cgiTestingId, setCgiTestingId] = useState<number | null>(null);

  async function runCgiTest(printer: PrinterT) {
    setCgiTestingId(printer.id);
    setCgiResults(prev => new Map(prev).set(printer.id, null));
    try {
      const resp = await fetch(`${API}/fiscal/diagnostica`);
      const data = await resp.json() as { testConnessioneRt?: { ok: boolean; ms?: number; error?: string; url?: string; body?: string } };
      const r = data.testConnessioneRt ?? { ok: false, error: "Nessun risultato" };
      setCgiResults(prev => new Map(prev).set(printer.id, r));
    } catch {
      setCgiResults(prev => new Map(prev).set(printer.id, { ok: false, error: "Errore di rete" }));
    } finally {
      setCgiTestingId(null);
    }
  }

  async function runTestAll() {
    setTesting(true);
    setTestResults(new Map());
    try {
      const resp = await fetch(`${API}/printers/test-all`);
      const data = await resp.json() as { results: Array<{ id: number; ok: boolean; ms?: number; error?: string }> };
      const map = new Map<number, TestResult>();
      for (const r of data.results) map.set(r.id, r);
      setTestResults(map);
    } catch {
      toast({ title: "Errore test connessioni", variant: "destructive" });
    } finally {
      setTesting(false);
    }
  }

  async function runTestSingle(id: number) {
    setTestingId(id);
    try {
      const resp = await fetch(`${API}/printers/${id}/test`);
      const data = await resp.json() as { id: number; ok: boolean; ms?: number; error?: string };
      setTestResults(prev => new Map(prev).set(id, data));
    } catch {
      toast({ title: "Errore test", variant: "destructive" });
    } finally {
      setTestingId(null);
    }
  }

  async function runDirectTest() {
    if (!directIp.trim()) return;
    setDirectTesting(true);
    setDirectResult(null);
    try {
      const resp = await fetch(`${API}/printers/test-ip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip: directIp.trim(), port: parseInt(directPort) || 9100 }),
      });
      const data = await resp.json();
      setDirectResult(data);
    } catch {
      setDirectResult({ ok: false, error: "Errore di rete" });
    } finally {
      setDirectTesting(false);
    }
  }

  const activePrinters = printers.filter(p => p.active);

  return (
    <BackofficeShell
      title="Stampanti"
      subtitle={`${printers.length} stampant${printers.length === 1 ? "e" : "i"} configurate`}
      actions={
        <Button size="sm" onClick={openNew} className="gap-1.5">
          <Plus className="h-4 w-4" /> Nuova
        </Button>
      }
    >
      <div className="p-4 md:p-6 max-w-2xl space-y-4">

        {isLoading ? (
          <div className="flex items-center gap-2 text-slate-400 py-10 justify-center">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Caricamento...</span>
          </div>
        ) : printers.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <Printer className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <div className="text-sm font-medium">Nessuna stampante configurata</div>
            <div className="text-xs mt-1">Aggiungi la prima stampante con il pulsante in alto</div>
          </div>
        ) : (
          <div className="space-y-3">
            {printers.map(p => {
              const result = testResults.get(p.id);
              return (
                <div key={p.id} className={cn(
                  "bg-white border-2 rounded-2xl p-4 shadow-sm transition-all",
                  p.isFiscale ? "border-red-200" : "border-slate-200",
                  !p.active && "opacity-60"
                )}>
                  <div className="flex items-start gap-3">
                    {/* Icon */}
                    <div className={cn(
                      "h-10 w-10 rounded-xl flex items-center justify-center shrink-0",
                      p.isFiscale ? "bg-red-50" : "bg-blue-50"
                    )}>
                      {p.isFiscale
                        ? <Receipt className="h-5 w-5 text-red-600" />
                        : <Printer className="h-5 w-5 text-blue-600" />}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-800 text-sm">{p.name}</span>
                        {p.isFiscale && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">
                            RT FISCALE
                          </span>
                        )}
                        {!p.active && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                            Inattiva
                          </span>
                        )}
                      </div>

                      {/* Network info */}
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        <span className="text-xs font-mono text-slate-500">{p.ip}:{p.port}</span>
                        {p.subnet && (
                          <span className="text-xs text-slate-400">Subnet: {p.subnet}</span>
                        )}
                        {p.model && (
                          <span className="text-xs text-slate-400">{p.model}</span>
                        )}
                      </div>

                      {/* Matricola fiscale */}
                      {p.isFiscale && p.matricola && (
                        <div className="text-xs text-red-600 font-mono mt-0.5">Matricola: {p.matricola}</div>
                      )}

                      {/* Test TCP result badge */}
                      {result && (
                        <div className="mt-1.5">
                          {result.ok ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                              <CheckCircle2 className="h-3 w-3" />
                              TCP OK {result.ms != null ? `(${result.ms}ms)` : ""}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                              <XCircle className="h-3 w-3" />
                              TCP KO: {result.error ?? "errore"}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Test CGI RT result */}
                      {p.isFiscale && cgiResults.has(p.id) && (
                        <div className="mt-1.5">
                          {(() => {
                            const cr = cgiResults.get(p.id);
                            if (!cr) return <span className="text-[11px] text-slate-400">CGI in corso...</span>;
                            return cr.ok ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                                <CheckCircle2 className="h-3 w-3" />
                                CGI RT OK {cr.ms != null ? `(${cr.ms}ms)` : ""}
                              </span>
                            ) : (
                              <div className="space-y-0.5">
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                                  <XCircle className="h-3 w-3" />
                                  CGI KO: {cr.error ?? "errore"}
                                </span>
                                {cr.url && <div className="text-[10px] text-slate-400 font-mono pl-1">{cr.url}</div>}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      {p.isFiscale && (
                        <button
                          onClick={() => runCgiTest(p)}
                          disabled={cgiTestingId === p.id}
                          title="Testa CGI RT (porta 80)"
                          className="h-8 px-2 flex items-center gap-1 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors disabled:opacity-40 text-[11px] font-semibold">
                          {cgiTestingId === p.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Receipt className="h-3.5 w-3.5" />}
                          CGI
                        </button>
                      )}
                      <button
                        onClick={() => runTestSingle(p.id)}
                        disabled={testingId === p.id}
                        title="Testa connessione TCP"
                        className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors disabled:opacity-40">
                        {testingId === p.id
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Wifi className="h-4 w-4" />}
                      </button>
                      <button
                        onClick={() => openEdit(p)}
                        className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => remove.mutate(p.id)}
                        className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Test tutte le connessioni */}
        {activePrinters.length > 0 && (
          <div className="pt-2">
            <Button
              variant="outline"
              className="w-full gap-2 h-12 rounded-2xl border-2 border-dashed"
              onClick={runTestAll}
              disabled={testing}
            >
              {testing
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Test in corso...</>
                : <><Wifi className="h-4 w-4" /> Testa tutte le connessioni ({activePrinters.length})</>
              }
            </Button>
            {testResults.size > 0 && (
              <div className="mt-2 text-xs text-center text-slate-400">
                {[...testResults.values()].filter(r => r?.ok).length} / {testResults.size} raggiungibili
              </div>
            )}
          </div>
        )}

        {/* Test IP diretto */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
          <div className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
            <Search className="h-3.5 w-3.5" /> Test connessione IP diretto
          </div>
          <p className="text-xs text-slate-500">
            Verifica la raggiungibilità di una stampante sulla rete prima di aggiungerla.
            Porta ESC/POS standard: <span className="font-mono font-semibold">9100</span>.
          </p>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label className="text-xs text-slate-500 mb-1 block">Indirizzo IP</Label>
              <Input
                value={directIp}
                onChange={e => setDirectIp(e.target.value)}
                placeholder="192.168.8.192"
                className="font-mono text-sm h-9"
              />
            </div>
            <div className="w-20">
              <Label className="text-xs text-slate-500 mb-1 block">Porta</Label>
              <Input
                value={directPort}
                onChange={e => setDirectPort(e.target.value)}
                className="font-mono text-sm h-9 text-center"
              />
            </div>
            <Button
              onClick={runDirectTest}
              disabled={directTesting || !directIp.trim()}
              className="h-9 gap-1.5 shrink-0"
            >
              {directTesting
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Wifi className="h-4 w-4" />}
              {directTesting ? "..." : "Testa"}
            </Button>
          </div>
          {directResult && (
            <div className={cn(
              "flex items-center gap-2 text-sm font-semibold rounded-xl px-4 py-3 border",
              directResult.ok
                ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                : "bg-red-50 border-red-200 text-red-700"
            )}>
              {directResult.ok
                ? <><CheckCircle2 className="h-4 w-4 shrink-0" /> Raggiunta! Risposta in {directResult.ms}ms — porta {directPort} aperta</>
                : <><XCircle className="h-4 w-4 shrink-0" /> Non raggiungibile: {directResult.error ?? "timeout"}</>
              }
            </div>
          )}
        </div>
      </div>

      {/* Dialog nuova/modifica stampante */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing ? "Modifica Stampante" : "Nuova Stampante"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">

            <div className="space-y-1">
              <FLabel>Nome *</FLabel>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="es. Cucina, Bar, Cassa RT"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <FLabel>Indirizzo IP *</FLabel>
                <Input
                  value={form.ip}
                  onChange={e => setForm(f => ({ ...f, ip: e.target.value }))}
                  placeholder="192.168.1.100"
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-1">
                <FLabel>Porta TCP</FLabel>
                <Input
                  type="number"
                  value={form.port}
                  onChange={e => setForm(f => ({ ...f, port: parseInt(e.target.value) || 9100 }))}
                  className="font-mono text-sm"
                />
              </div>
            </div>

            <div className="space-y-1">
              <FLabel>Subnet mask</FLabel>
              <Input
                value={form.subnet}
                onChange={e => setForm(f => ({ ...f, subnet: e.target.value }))}
                placeholder="255.255.255.0"
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-1">
              <FLabel>Modello</FLabel>
              <Input
                value={form.model}
                onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
                placeholder="es. DTR DFront RT, Sewoo SLK-TS400"
              />
            </div>

            {/* Fiscale */}
            <div className="flex items-center gap-3 py-1">
              <Checkbox
                id="fiscale"
                checked={form.isFiscale}
                onCheckedChange={v => setForm(f => ({
                  ...f,
                  isFiscale: v === true,
                  port: v === true ? 80 : (f.port === 80 ? 9100 : f.port),
                }))}
              />
              <Label htmlFor="fiscale" className="cursor-pointer font-medium text-sm">
                Stampante fiscale (RT)
              </Label>
            </div>

            {form.isFiscale && (
              <div className="space-y-1 pl-7">
                <FLabel>Matricola fiscale</FLabel>
                <Input
                  value={form.matricola}
                  onChange={e => setForm(f => ({ ...f, matricola: e.target.value }))}
                  placeholder="es. RT-XXXXXXXXXX"
                  className="font-mono text-sm"
                />
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <Switch
                checked={form.active}
                onCheckedChange={v => setForm(f => ({ ...f, active: v }))}
              />
              <Label className="text-sm">Stampante attiva</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Annulla</Button>
            <Button onClick={handleSave} disabled={!form.name || !form.ip}>
              {editing ? "Salva" : "Aggiungi"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BackofficeShell>
  );
}
