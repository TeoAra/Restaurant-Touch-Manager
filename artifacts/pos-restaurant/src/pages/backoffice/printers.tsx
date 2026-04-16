import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Printer, Wifi, WifiOff } from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

type PrinterT = { id: number; name: string; ip: string; port: number; model: string | null; departmentId: number | null; active: boolean };
type PrinterForm = { name: string; ip: string; port: number; model: string; departmentId: string; active: boolean };

const empty: PrinterForm = { name: "", ip: "192.168.1.", port: 9100, model: "", departmentId: "", active: true };

async function fetchPrinters(): Promise<PrinterT[]> {
  const res = await fetch(`${API}/printers`);
  if (!res.ok) throw new Error("Errore");
  return res.json();
}

export default function PrintersPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: printers = [], isLoading } = useQuery({ queryKey: ["printers"], queryFn: fetchPrinters });

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

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Printer className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Stampanti</h1>
        </div>
        <Button onClick={openNew} className="gap-2"><Plus className="h-4 w-4" /> Nuova Stampante</Button>
      </div>

      <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
        <strong>Nota:</strong> L'integrazione TCP/IP con stampanti Sewoo ESC/POS è in sviluppo. Le stampanti configurate qui saranno attivate automaticamente quando il modulo di stampa sarà completato.
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">Caricamento...</div>
      ) : (
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Nome</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">IP:Porta</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Modello</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Stato</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {printers.map((p, i) => (
                <tr key={p.id} className={i % 2 === 0 ? "bg-card" : "bg-muted/20"}>
                  <td className="px-4 py-3 font-medium text-foreground">{p.name}</td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{p.ip}:{p.port}</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.model || "—"}</td>
                  <td className="px-4 py-3">
                    {p.active
                      ? <span className="flex items-center gap-1 text-emerald-600 text-xs"><Wifi className="h-3 w-3" />Attiva</span>
                      : <span className="flex items-center gap-1 text-muted-foreground text-xs"><WifiOff className="h-3 w-3" />Inattiva</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => remove.mutate(p.id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
              {printers.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Nessuna stampante configurata</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Modifica Stampante" : "Nuova Stampante"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Nome *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="es. Cucina ESC/POS" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Indirizzo IP *</Label>
                <Input value={form.ip} onChange={e => setForm(f => ({ ...f, ip: e.target.value }))} placeholder="192.168.1.100" />
              </div>
              <div className="space-y-1">
                <Label>Porta</Label>
                <Input type="number" value={form.port} onChange={e => setForm(f => ({ ...f, port: parseInt(e.target.value) || 9100 }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Modello</Label>
              <Input value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} placeholder="es. Sewoo LK-TL212" />
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
    </div>
  );
}
