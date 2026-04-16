import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ChefHat, Plus, Pencil, Trash2, Printer, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { BackofficeShell } from "@/components/BackofficeShell";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

type Department = { id: number; name: string; code: string; productionType: string; printerId?: number | null };
type Printer = { id: number; name: string; ipAddress?: string };
type DeptForm = { name: string; code: string; productionType: string; printerId: number | null };
const empty: DeptForm = { name: "", code: "", productionType: "kitchen", printerId: null };

const prodTypes = [
  { value: "kitchen", label: "Cucina" },
  { value: "bar", label: "Bar" },
  { value: "other", label: "Altro" },
];

export default function DepartmentsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: departments = [], isLoading } = useQuery<Department[]>({
    queryKey: ["departments"],
    queryFn: () => fetch(`${API}/departments`).then(r => r.json()),
  });
  const { data: printers = [] } = useQuery<Printer[]>({
    queryKey: ["printers"],
    queryFn: () => fetch(`${API}/printers`).then(r => r.json()),
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [form, setForm] = useState<DeptForm>(empty);

  const createDept = useMutation({
    mutationFn: (data: DeptForm) => fetch(`${API}/departments`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["departments"] }); setOpen(false); toast({ title: "Reparto creato" }); },
  });
  const updateDept = useMutation({
    mutationFn: ({ id, data }: { id: number; data: DeptForm }) => fetch(`${API}/departments/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["departments"] }); setOpen(false); toast({ title: "Reparto aggiornato" }); },
  });
  const deleteDept = useMutation({
    mutationFn: (id: number) => fetch(`${API}/departments/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["departments"] }); toast({ title: "Reparto eliminato" }); },
  });

  function openNew() { setEditing(null); setForm(empty); setOpen(true); }
  function openEdit(d: Department) {
    setEditing(d);
    setForm({ name: d.name, code: d.code, productionType: d.productionType, printerId: d.printerId ?? null });
    setOpen(true);
  }
  function handleSave() {
    if (editing) updateDept.mutate({ id: editing.id, data: form });
    else createDept.mutate(form);
  }

  const getPrinterName = (id?: number | null) => id ? printers.find(p => p.id === id)?.name ?? "—" : "Nessuna";

  return (
    <BackofficeShell
      title="Reparti"
      subtitle="Collega ogni reparto alla stampante di produzione"
      actions={<Button size="sm" onClick={openNew} className="gap-1.5"><Plus className="h-4 w-4" /> Nuovo</Button>}
    >
    <div className="p-4 md:p-6 max-w-2xl">

      <div className="flex items-start gap-3 p-4 bg-orange-50 border border-orange-200 rounded-xl mb-5">
        <Link2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
        <div>
          <div className="font-semibold text-slate-800 text-sm">Sincronizzazione Reparti-Stampanti</div>
          <div className="text-xs text-slate-600 mt-0.5">
            Ogni reparto riceve le comande tramite la sua stampante. I prodotti devono essere assegnati al reparto corretto per far arrivare la comanda al punto giusto (cucina, bar, ecc.).
          </div>
        </div>
      </div>

      {isLoading ? <p className="text-muted-foreground">Caricamento...</p> : (
        <div className="space-y-2">
          {departments.map(d => {
            const printerName = getPrinterName(d.printerId);
            const typeLabel = prodTypes.find(t => t.value === d.productionType)?.label ?? d.productionType;
            return (
              <div key={d.id} className="flex items-center gap-4 p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
                <div className="h-10 w-10 rounded-xl bg-orange-50 flex items-center justify-center shrink-0">
                  <ChefHat className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-800">{d.name}</span>
                    <span className="text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-md font-mono">{d.code}</span>
                    <span className="text-xs text-slate-500">{typeLabel}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Printer className="h-3 w-3 text-slate-400" />
                    <span className={cn("text-xs", d.printerId ? "text-emerald-600 font-medium" : "text-slate-400")}>
                      {d.printerId ? `Stampante: ${printerName}` : "Nessuna stampante collegata"}
                    </span>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => openEdit(d)}
                    className="p-2 rounded-lg text-slate-500 hover:text-primary hover:bg-orange-50 transition-colors">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => deleteDept.mutate(d.id)}
                    className="p-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
          {departments.length === 0 && <p className="text-center py-12 text-muted-foreground">Nessun reparto. Creane uno!</p>}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Modifica Reparto" : "Nuovo Reparto"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Nome *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Es. Cucina" className="mt-1" />
              </div>
              <div>
                <Label>Codice *</Label>
                <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="Es. KIT" className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Tipo produzione</Label>
              <div className="grid grid-cols-3 gap-2 mt-1">
                {prodTypes.map(t => (
                  <button key={t.value} onClick={() => setForm(f => ({ ...f, productionType: t.value }))}
                    className={cn("py-2 rounded-lg text-sm font-medium border-2 transition-colors",
                      form.productionType === t.value
                        ? "border-primary bg-orange-50 text-primary"
                        : "border-border text-muted-foreground")}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="flex items-center gap-2">
                <Printer className="h-4 w-4" /> Stampante collegata
              </Label>
              <select value={form.printerId ?? ""}
                onChange={e => setForm(f => ({ ...f, printerId: e.target.value ? Number(e.target.value) : null }))}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value="">Nessuna stampante</option>
                {printers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {printers.length === 0 && (
                <p className="text-xs text-slate-400 mt-1">Nessuna stampante — aggiungila nella sezione Stampanti</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Annulla</Button>
            <Button onClick={handleSave} disabled={!form.name || !form.code}>{editing ? "Salva" : "Crea"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </BackofficeShell>
  );
}
