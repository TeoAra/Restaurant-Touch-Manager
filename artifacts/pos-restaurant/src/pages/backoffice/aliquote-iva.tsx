import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BackofficeShell } from "@/components/BackofficeShell";
import { Plus, Pencil, Trash2, Receipt } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

type Department = {
  id: number; name: string; ivaRate: string; color?: string;
};

function DeptForm({ initial, onSave, onCancel }: {
  initial?: Partial<Department>;
  onSave: (d: Partial<Department>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [ivaRate, setIvaRate] = useState(initial?.ivaRate ?? "10");
  const [color, setColor] = useState(initial?.color ?? "#f59e0b");

  const STANDARD_RATES = ["0", "4", "5", "10", "22"];

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Nome reparto IVA</label>
        <input value={name} onChange={e => setName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none"
          placeholder="es. Reparto IVA 10%" />
      </div>
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Aliquota IVA (%)</label>
        <div className="mt-1 grid grid-cols-5 gap-1.5 mb-2">
          {STANDARD_RATES.map(r => (
            <button key={r} onClick={() => setIvaRate(r)}
              className={`py-2 rounded-lg text-sm font-bold transition-all ${ivaRate === r ? "bg-primary text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
              {r}%
            </button>
          ))}
        </div>
        <input type="number" min="0" max="100" step="0.1" value={ivaRate} onChange={e => setIvaRate(e.target.value)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none"
          placeholder="Aliquota personalizzata" />
      </div>
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Colore</label>
        <div className="mt-1 flex items-center gap-3">
          <input type="color" value={color} onChange={e => setColor(e.target.value)}
            className="h-10 w-16 rounded-lg border border-slate-200 cursor-pointer" />
          <span className="text-sm text-slate-500">{color}</span>
        </div>
      </div>
      <DialogFooter>
        <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">Annulla</button>
        <button onClick={() => onSave({ name, ivaRate, color })}
          disabled={!name.trim()}
          className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-bold hover:bg-primary/90 disabled:opacity-40">
          Salva
        </button>
      </DialogFooter>
    </div>
  );
}

export default function AliquoteIva() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [deleting, setDeleting] = useState<Department | null>(null);

  const { data: depts = [] } = useQuery<Department[]>({
    queryKey: ["departments"],
    queryFn: () => fetch(`${API}/departments`).then(r => r.json()),
  });

  const create = useMutation({
    mutationFn: (body: Partial<Department>) => fetch(`${API}/departments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["departments"] }); setShowForm(false); toast({ title: "Reparto IVA creato" }); },
  });

  const update = useMutation({
    mutationFn: ({ id, ...body }: Partial<Department> & { id: number }) => fetch(`${API}/departments/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["departments"] }); setEditing(null); toast({ title: "Reparto IVA aggiornato" }); },
  });

  const remove = useMutation({
    mutationFn: (id: number) => fetch(`${API}/departments/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["departments"] }); setDeleting(null); toast({ title: "Reparto eliminato" }); },
  });

  return (
    <BackofficeShell title="Aliquote IVA" subtitle="Reparti fiscali e aliquote IVA">
      <div className="p-4 max-w-xl mx-auto space-y-4">
        <div className="bg-blue-50 rounded-xl border border-blue-200 p-3 text-xs text-blue-700">
          <strong>Aliquote standard Italy:</strong> 0% (esente), 4% (beni prima necessità), 5% (alcuni servizi), 10% (alimenti/ristorazione), 22% (ordinaria)
        </div>

        <button onClick={() => setShowForm(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-primary text-primary font-semibold hover:bg-orange-50 transition-all">
          <Plus className="h-4 w-4" /> Nuovo Reparto IVA
        </button>

        {depts.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            <Receipt className="h-10 w-10 mx-auto mb-3 opacity-25" />
            <p className="text-sm">Nessun reparto IVA configurato</p>
          </div>
        )}

        {depts.map(d => (
          <div key={d.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0 text-white font-bold text-sm"
              style={{ backgroundColor: d.color || "#f59e0b" }}>
              {d.ivaRate}%
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-slate-800 text-sm">{d.name}</div>
              <div className="text-xs text-slate-400">IVA {d.ivaRate}%</div>
            </div>
            <button onClick={() => setEditing(d)} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-primary transition-colors">
              <Pencil className="h-4 w-4" />
            </button>
            <button onClick={() => setDeleting(d)} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}

        <Dialog open={showForm} onOpenChange={setShowForm}>
          <DialogContent>
            <DialogHeader><DialogTitle>Nuovo Reparto IVA</DialogTitle></DialogHeader>
            <DeptForm onSave={b => create.mutate(b)} onCancel={() => setShowForm(false)} />
          </DialogContent>
        </Dialog>

        <Dialog open={!!editing} onOpenChange={v => !v && setEditing(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Modifica Reparto IVA</DialogTitle></DialogHeader>
            {editing && <DeptForm initial={editing} onSave={b => update.mutate({ ...b, id: editing.id })} onCancel={() => setEditing(null)} />}
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!deleting} onOpenChange={v => !v && setDeleting(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Elimina reparto IVA</AlertDialogTitle>
              <AlertDialogDescription>Eliminare "{deleting?.name}"? I prodotti associati perderanno il reparto. L'operazione è irreversibile.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annulla</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleting && remove.mutate(deleting.id)} className="bg-red-500 hover:bg-red-600">Elimina</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </BackofficeShell>
  );
}
