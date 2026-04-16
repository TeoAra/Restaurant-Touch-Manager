import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BackofficeShell } from "@/components/BackofficeShell";
import { Plus, Pencil, Trash2, Tag, Percent, Euro } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

type Discount = {
  id: number; name: string; type: string; value: string;
  applicableTo: string; active: boolean;
};

const DISCOUNT_TYPES = [
  { value: "percent", label: "Percentuale (%)", icon: Percent },
  { value: "fixed", label: "Importo fisso (€)", icon: Euro },
];

const APPLICABLE_TO = [
  { value: "order", label: "Ordine intero" },
  { value: "item", label: "Singola riga" },
  { value: "category", label: "Categoria" },
];

function DiscountForm({ initial, onSave, onCancel }: {
  initial?: Partial<Discount>;
  onSave: (d: Partial<Discount>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState(initial?.type ?? "percent");
  const [value, setValue] = useState(initial?.value ?? "0");
  const [applicableTo, setApplicableTo] = useState(initial?.applicableTo ?? "order");
  const [active, setActive] = useState(initial?.active ?? true);

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Nome sconto</label>
        <input value={name} onChange={e => setName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none"
          placeholder="es. Sconto dipendenti" />
      </div>
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Tipo</label>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {DISCOUNT_TYPES.map(t => (
            <button key={t.value} onClick={() => setType(t.value)}
              className={`flex items-center gap-2 p-3 rounded-xl border-2 text-sm font-semibold transition-all ${type === t.value ? "border-primary bg-orange-50 text-primary" : "border-slate-200 text-slate-600 hover:border-primary/40"}`}>
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          Valore {type === "percent" ? "(%)" : "(€)"}
        </label>
        <input type="number" min="0" step="0.01" value={value} onChange={e => setValue(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none" />
      </div>
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Applicabile a</label>
        <select value={applicableTo} onChange={e => setApplicableTo(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none">
          {APPLICABLE_TO.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 cursor-pointer">
        <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="w-4 h-4 accent-primary" />
        Sconto attivo
      </label>
      <DialogFooter>
        <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">Annulla</button>
        <button onClick={() => onSave({ name, type, value, applicableTo, active })}
          disabled={!name.trim()}
          className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-bold hover:bg-primary/90 disabled:opacity-40">
          Salva
        </button>
      </DialogFooter>
    </div>
  );
}

export default function Sconti() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Discount | null>(null);
  const [deleting, setDeleting] = useState<Discount | null>(null);

  const { data: discounts = [] } = useQuery<Discount[]>({
    queryKey: ["discounts"],
    queryFn: () => fetch(`${API}/discounts`).then(r => r.json()),
  });

  const create = useMutation({
    mutationFn: (body: Partial<Discount>) => fetch(`${API}/discounts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["discounts"] }); setShowForm(false); toast({ title: "Sconto creato" }); },
  });

  const update = useMutation({
    mutationFn: ({ id, ...body }: Partial<Discount> & { id: number }) => fetch(`${API}/discounts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["discounts"] }); setEditing(null); toast({ title: "Sconto aggiornato" }); },
  });

  const remove = useMutation({
    mutationFn: (id: number) => fetch(`${API}/discounts/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["discounts"] }); setDeleting(null); toast({ title: "Sconto eliminato" }); },
  });

  return (
    <BackofficeShell title="Sconti" subtitle="Tipi di sconto configurabili">
      <div className="p-4 max-w-xl mx-auto space-y-4">
        <button onClick={() => setShowForm(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-primary text-primary font-semibold hover:bg-orange-50 transition-all">
          <Plus className="h-4 w-4" /> Nuovo Sconto
        </button>

        {discounts.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            <Tag className="h-10 w-10 mx-auto mb-3 opacity-25" />
            <p className="text-sm">Nessuno sconto configurato</p>
          </div>
        )}

        {discounts.map(d => (
          <div key={d.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
            <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${d.type === "percent" ? "bg-blue-50" : "bg-emerald-50"}`}>
              {d.type === "percent" ? <Percent className="h-5 w-5 text-blue-600" /> : <Euro className="h-5 w-5 text-emerald-600" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-800 text-sm">{d.name}</span>
                {!d.active && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">Inattivo</span>}
              </div>
              <div className="text-xs text-slate-400">
                {d.type === "percent" ? `${d.value}% — ` : `€${parseFloat(d.value).toFixed(2)} — `}
                {APPLICABLE_TO.find(a => a.value === d.applicableTo)?.label}
              </div>
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
            <DialogHeader><DialogTitle>Nuovo Sconto</DialogTitle></DialogHeader>
            <DiscountForm onSave={b => create.mutate(b)} onCancel={() => setShowForm(false)} />
          </DialogContent>
        </Dialog>

        <Dialog open={!!editing} onOpenChange={v => !v && setEditing(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Modifica Sconto</DialogTitle></DialogHeader>
            {editing && <DiscountForm initial={editing} onSave={b => update.mutate({ ...b, id: editing.id })} onCancel={() => setEditing(null)} />}
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!deleting} onOpenChange={v => !v && setDeleting(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Elimina sconto</AlertDialogTitle>
              <AlertDialogDescription>Eliminare "{deleting?.name}"? L'operazione è irreversibile.</AlertDialogDescription>
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
