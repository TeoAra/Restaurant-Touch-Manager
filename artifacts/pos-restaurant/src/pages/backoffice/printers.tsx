import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Printer, Wifi, WifiOff, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { BackofficeShell } from "@/components/BackofficeShell";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

type PrinterT = { id: number; name: string; ip: string; port: number; model: string | null; departmentId: number | null; active: boolean };
type PrinterForm = { name: string; ip: string; port: number; model: string; departmentId: string; active: boolean };
type AppSettings = Record<string, string>;
type TestResult = { ok: boolean; error?: string } | null;

const empty: PrinterForm = { name: "", ip: "192.168.1.", port: 9100, model: "", departmentId: "", active: true };

async function fetchPrinters(): Promise<PrinterT[]> {
  const res = await fetch(`${API}/printers`);
  if (!res.ok) throw new Error("Errore");
  return res.json();
}
function fetchSettings(): Promise<AppSettings> {
  return fetch(`${API}/settings`).then(r => r.json());
}

function FLabel({ children }: { children: React.ReactNode }) {
  return <Label className="text-xs text-slate-500 mb-1 block">{children}</Label>;
}

function StatusBadge({ result, label }: { result: TestResult; label: string }) {
  if (!result) return <span className="text-xs text-slate-400">{label}: —</span>;
  if (result.ok) return (
    <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
      <CheckCircle2 className="h-3.5 w-3.5" /> {label}: Raggiunta
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
      <XCircle className="h-3.5 w-3.5" /> {label}: {result.error ?? "Non raggiunta"}
    </span>
  );
}

export default function PrintersPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: printers = [], isLoading } = useQuery({ queryKey: ["printers"], queryFn: fetchPrinters });
  const { data: settings = {} } = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });

  // ── Dialog stampante ESC/POS ────────────────────────────────────────────────
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PrinterT | null>(null);
  const [form, setForm] = useState<PrinterForm>(empty);

  const create = useMutation({
    mutationFn: (data: PrinterForm) =>
      fetch(`${API}/printers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...data, port: Number(data.port), departmentId: data.departmentId ? Number(data.departmentId) : null }) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["printers"] }); setOpen(false); toast({ title: "Stampante aggiunta" }); },
  });
  const update = useMutation({
    mutationFn: ({ id, data }: { id: number; data: PrinterForm }) =>
      fetch(`${API}/printers/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...data, port: Number(data.port), departmentId: data.departmentId ? Number(data.departmentId) : null }) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["printers"] }); setOpen(false); toast({ title: "Stampante aggiornata" }); },
  });
  const remove = useMutation({
    mutationFn: (id: number) => fetch(`${API}/printers/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["printers"] }); toast({ title: "Stampante eliminata" }); },
  });

  function openNew() { setEditing(null); setForm(empty); setOpen(true); }
  function openEdit(p: PrinterT) { setEditing(p); setForm({ name: p.name, ip: p.ip, port: p.port, model: p.model ?? "", departmentId: p.departmentId?.toString() ?? "", active: p.active }); setOpen(true); }
  function handleSave() {
    if (editing) update.mutate({ id: editing.id, data: form });
    else create.mutate(form);
  }

  // ── Stampanti fisse (DTR + Sewoo) da settings ───────────────────────────────
  const [fixedForm, setFixedForm] = useState({ dtr_ip: "", dtr_matricola: "", sewoo_ip: "", sewoo_port: "9100" });
  useEffect(() => {
    if (Object.keys(settings).length > 0) {
      setFixedForm(f => ({
        dtr_ip: settings.dtr_ip ?? f.dtr_ip,
        dtr_matricola: settings.dtr_matricola ?? f.dtr_matricola,
        sewoo_ip: settings.sewoo_ip ?? f.sewoo_ip,
        sewoo_port: settings.sewoo_port ?? "9100",
      }));
    }
  }, [settings]);

  const saveFixed = useMutation({
    mutationFn: async () => {
      for (const [key, value] of Object.entries(fixedForm)) {
        await fetch(`${API}/settings`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value }),
        });
      }
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onSuccess: () => toast({ title: "Impostazioni stampanti salvate" }),
  });

  // ── Test connessione ─────────────────────────────────────────────────────────
  const [testing, setTesting] = useState(false);
  const [testDtr, setTestDtr] = useState<TestResult>(null);
  const [testSewoo, setTestSewoo] = useState<TestResult>(null);

  async function runTest() {
    setTesting(true);
    setTestDtr(null);
    setTestSewoo(null);
    try {
      const resp = await fetch(`${API}/fiscal/printer-test`);
      const data = await resp.json();
      setTestDtr(data.dtr ?? { ok: false, error: "Non configurata" });
      setTestSewoo(data.sewoo ?? { ok: false, error: "Non configurata" });
    } catch {
      setTestDtr({ ok: false, error: "Errore di rete" });
      setTestSewoo({ ok: false, error: "Errore di rete" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <BackofficeShell
      title="Stampanti"
      subtitle="Configurazione stampanti fiscali e comande"
      actions={<Button size="sm" onClick={openNew} className="gap-1.5"><Plus className="h-4 w-4" /> Nuova ESC/POS</Button>}
    >
    <div className="p-4 md:p-6 max-w-2xl space-y-8">

      {/* ── Stampante Fiscale DTR ─────────────────────────────────────────────── */}
      <div className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 px-1 flex items-center gap-2">
          <Printer className="h-3.5 w-3.5 text-red-500" /> Stampante Fiscale RT
        </h2>
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-5">

          {/* DTR */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="h-8 w-8 bg-red-50 rounded-lg flex items-center justify-center shrink-0">
                <Printer className="h-4 w-4 text-red-600" />
              </div>
              <div>
                <div className="font-semibold text-sm text-slate-800">DTR DFront RT</div>
                <div className="text-xs text-slate-400">Stampante fiscale (RT) — collegamento IP</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FLabel>Indirizzo IP</FLabel>
                <Input value={fixedForm.dtr_ip} onChange={e => setFixedForm(f => ({ ...f, dtr_ip: e.target.value }))} placeholder="192.168.1.100" className="h-9 text-sm" />
              </div>
              <div>
                <FLabel>Matricola fiscale</FLabel>
                <Input value={fixedForm.dtr_matricola} onChange={e => setFixedForm(f => ({ ...f, dtr_matricola: e.target.value }))} placeholder="RT-XXXXXXXXXX" className="h-9 text-sm" />
              </div>
            </div>
          </div>

          {/* Sewoo */}
          <div className="border-t border-slate-100 pt-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-8 w-8 bg-blue-50 rounded-lg flex items-center justify-center shrink-0">
                <Printer className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <div className="font-semibold text-sm text-slate-800">Sewoo SLK-TS400EB</div>
                <div className="text-xs text-slate-400">Stampante comande — collegamento IP/Ethernet ESC/POS</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FLabel>Indirizzo IP</FLabel>
                <Input value={fixedForm.sewoo_ip} onChange={e => setFixedForm(f => ({ ...f, sewoo_ip: e.target.value }))} placeholder="192.168.1.101" className="h-9 text-sm" />
              </div>
              <div>
                <FLabel>Porta TCP</FLabel>
                <Input value={fixedForm.sewoo_port} onChange={e => setFixedForm(f => ({ ...f, sewoo_port: e.target.value }))} placeholder="9100" className="h-9 text-sm" />
              </div>
            </div>
          </div>

          {/* Test + risultati */}
          <div className="border-t border-slate-100 pt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={runTest} disabled={testing}>
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
                {testing ? "Test in corso..." : "Test connessione"}
              </Button>
              {(testDtr || testSewoo) && (
                <div className="flex flex-wrap gap-2">
                  <StatusBadge result={testDtr} label="DTR" />
                  <StatusBadge result={testSewoo} label="Sewoo" />
                </div>
              )}
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => saveFixed.mutate()} disabled={saveFixed.isPending}>
                {saveFixed.isPending ? "Salvataggio..." : "Salva Impostazioni"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Stampanti ESC/POS aggiuntive ──────────────────────────────────────── */}
      <div className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 px-1 flex items-center gap-2">
          <Printer className="h-3.5 w-3.5 text-blue-500" /> Stampanti ESC/POS Aggiuntive
        </h2>

        {isLoading ? (
          <div className="text-sm text-slate-400 px-1">Caricamento...</div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wide">Nome</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wide">IP:Porta</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wide">Modello</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wide">Stato</th>
                  <th className="px-4 py-3 w-20" />
                </tr>
              </thead>
              <tbody>
                {printers.map((p, i) => (
                  <tr key={p.id} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                    <td className="px-4 py-3 font-medium text-slate-800">{p.name}</td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-xs">{p.ip}:{p.port}</td>
                    <td className="px-4 py-3 text-slate-500">{p.model || "—"}</td>
                    <td className="px-4 py-3">
                      {p.active
                        ? <span className="flex items-center gap-1 text-emerald-600 text-xs font-medium"><Wifi className="h-3 w-3" />Attiva</span>
                        : <span className="flex items-center gap-1 text-slate-400 text-xs"><WifiOff className="h-3 w-3" />Inattiva</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => remove.mutate(p.id)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {printers.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-slate-400 text-sm">
                      Nessuna stampante aggiuntiva configurata
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>

    {/* Dialog nuova/modifica stampante ESC/POS */}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>{editing ? "Modifica Stampante" : "Nuova Stampante ESC/POS"}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Nome *</Label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="es. Cucina, Bar, Cassa 2" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Indirizzo IP *</Label>
              <Input value={form.ip} onChange={e => setForm(f => ({ ...f, ip: e.target.value }))} placeholder="192.168.1.100" />
            </div>
            <div className="space-y-1">
              <Label>Porta TCP</Label>
              <Input type="number" value={form.port} onChange={e => setForm(f => ({ ...f, port: parseInt(e.target.value) || 9100 }))} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Modello</Label>
            <Input value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} placeholder="es. Sewoo LK-TL212, Epson TM-T88" />
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={form.active} onCheckedChange={v => setForm(f => ({ ...f, active: v }))} />
            <Label>Stampante attiva</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Annulla</Button>
          <Button onClick={handleSave} disabled={!form.name || !form.ip}>{editing ? "Salva" : "Aggiungi"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </BackofficeShell>
  );
}
