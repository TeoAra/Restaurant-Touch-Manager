import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BackofficeShell } from "@/components/BackofficeShell";
import { Plus, Pencil, Trash2, Zap, Calendar, Clock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

type Promotion = {
  id: number; name: string; description?: string; type: string; value: string;
  minAmount: string; startDate?: string; endDate?: string; daysOfWeek?: string;
  startTime?: string; endTime?: string; categoryIds?: string; productIds?: string; active: boolean;
};

const PROMO_TYPES = [
  { value: "discount_percent", label: "Sconto %" },
  { value: "discount_fixed", label: "Sconto €" },
  { value: "free_item", label: "Articolo omaggio" },
  { value: "buy_x_get_y", label: "Prendi X paghi Y" },
];

const DAYS = [
  { n: 0, label: "Dom" }, { n: 1, label: "Lun" }, { n: 2, label: "Mar" },
  { n: 3, label: "Mer" }, { n: 4, label: "Gio" }, { n: 5, label: "Ven" }, { n: 6, label: "Sab" },
];

function PromoForm({ initial, onSave, onCancel }: {
  initial?: Partial<Promotion>;
  onSave: (d: Partial<Promotion>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [type, setType] = useState(initial?.type ?? "discount_percent");
  const [value, setValue] = useState(initial?.value ?? "0");
  const [minAmount, setMinAmount] = useState(initial?.minAmount ?? "0");
  const [startDate, setStartDate] = useState(initial?.startDate ?? "");
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");
  const [startTime, setStartTime] = useState(initial?.startTime ?? "");
  const [endTime, setEndTime] = useState(initial?.endTime ?? "");
  const [selectedDays, setSelectedDays] = useState<number[]>(
    initial?.daysOfWeek ? initial.daysOfWeek.split(",").map(Number) : [0,1,2,3,4,5,6]
  );
  const [active, setActive] = useState(initial?.active ?? true);

  const toggleDay = (n: number) =>
    setSelectedDays(prev => prev.includes(n) ? prev.filter(d => d !== n) : [...prev, n]);

  return (
    <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Nome promozione</label>
        <input value={name} onChange={e => setName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none"
          placeholder="es. 2x1 Birre" />
      </div>
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Descrizione</label>
        <input value={description} onChange={e => setDescription(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none"
          placeholder="Descrizione opzionale" />
      </div>
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Tipo promozione</label>
        <div className="mt-1 grid grid-cols-2 gap-1.5">
          {PROMO_TYPES.map(t => (
            <button key={t.value} onClick={() => setType(t.value)}
              className={`p-2 rounded-lg border-2 text-xs font-semibold transition-all ${type === t.value ? "border-primary bg-orange-50 text-primary" : "border-slate-200 text-slate-600"}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Valore</label>
          <input type="number" min="0" step="0.01" value={value} onChange={e => setValue(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none" />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Min. ordine €</label>
          <input type="number" min="0" step="0.01" value={minAmount} onChange={e => setMinAmount(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Data inizio</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none" />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Data fine</label>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Ora inizio</label>
          <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none" />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Ora fine</label>
          <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none" />
        </div>
      </div>
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Giorni validi</label>
        <div className="mt-1 flex gap-1">
          {DAYS.map(d => (
            <button key={d.n} onClick={() => toggleDay(d.n)}
              className={`flex-1 h-8 rounded-lg text-[10px] font-bold transition-all ${selectedDays.includes(d.n) ? "bg-primary text-white" : "bg-slate-100 text-slate-500"}`}>
              {d.label.slice(0,1)}
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 cursor-pointer">
        <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="w-4 h-4 accent-primary" />
        Promozione attiva
      </label>
      <DialogFooter>
        <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">Annulla</button>
        <button onClick={() => onSave({ name, description: description || undefined, type, value, minAmount, startDate: startDate || undefined, endDate: endDate || undefined, startTime: startTime || undefined, endTime: endTime || undefined, daysOfWeek: selectedDays.join(","), active })}
          disabled={!name.trim()}
          className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-bold hover:bg-primary/90 disabled:opacity-40">
          Salva
        </button>
      </DialogFooter>
    </div>
  );
}

export default function Promozioni() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Promotion | null>(null);
  const [deleting, setDeleting] = useState<Promotion | null>(null);

  const { data: promos = [] } = useQuery<Promotion[]>({
    queryKey: ["promotions"],
    queryFn: () => fetch(`${API}/promotions`).then(r => r.json()),
  });

  const create = useMutation({
    mutationFn: (body: Partial<Promotion>) => fetch(`${API}/promotions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["promotions"] }); setShowForm(false); toast({ title: "Promozione creata" }); },
  });

  const update = useMutation({
    mutationFn: ({ id, ...body }: Partial<Promotion> & { id: number }) => fetch(`${API}/promotions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["promotions"] }); setEditing(null); toast({ title: "Promozione aggiornata" }); },
  });

  const remove = useMutation({
    mutationFn: (id: number) => fetch(`${API}/promotions/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["promotions"] }); setDeleting(null); toast({ title: "Promozione eliminata" }); },
  });

  const typeLabel = (t: string) => PROMO_TYPES.find(p => p.value === t)?.label ?? t;

  return (
    <BackofficeShell title="Promozioni" subtitle="Offerte e sconti automatici">
      <div className="p-4 max-w-xl mx-auto space-y-4">
        <button onClick={() => setShowForm(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-primary text-primary font-semibold hover:bg-orange-50 transition-all">
          <Plus className="h-4 w-4" /> Nuova Promozione
        </button>

        {promos.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            <Zap className="h-10 w-10 mx-auto mb-3 opacity-25" />
            <p className="text-sm">Nessuna promozione configurata</p>
          </div>
        )}

        {promos.map(p => (
          <div key={p.id} className={`bg-white rounded-xl border shadow-sm p-4 ${!p.active && "opacity-60"}`}>
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-purple-50 flex items-center justify-center shrink-0">
                <Zap className="h-5 w-5 text-purple-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-bold text-slate-800 text-sm">{p.name}</span>
                  {!p.active && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">Inattivo</span>}
                </div>
                <div className="text-xs text-slate-500">
                  {typeLabel(p.type)} · valore: {p.value}
                  {parseFloat(p.minAmount) > 0 && ` · min €${p.minAmount}`}
                </div>
                {(p.startDate || p.startTime) && (
                  <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                    {p.startDate && <><Calendar className="h-3 w-3" /> {p.startDate}{p.endDate && ` – ${p.endDate}`}</>}
                    {p.startTime && <><Clock className="h-3 w-3 ml-1" /> {p.startTime}{p.endTime && ` – ${p.endTime}`}</>}
                  </div>
                )}
              </div>
              <div className="flex gap-1">
                <button onClick={() => setEditing(p)} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-primary transition-colors">
                  <Pencil className="h-4 w-4" />
                </button>
                <button onClick={() => setDeleting(p)} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ))}

        <Dialog open={showForm} onOpenChange={setShowForm}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Nuova Promozione</DialogTitle></DialogHeader>
            <PromoForm onSave={b => create.mutate(b)} onCancel={() => setShowForm(false)} />
          </DialogContent>
        </Dialog>

        <Dialog open={!!editing} onOpenChange={v => !v && setEditing(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Modifica Promozione</DialogTitle></DialogHeader>
            {editing && <PromoForm initial={editing} onSave={b => update.mutate({ ...b, id: editing.id })} onCancel={() => setEditing(null)} />}
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!deleting} onOpenChange={v => !v && setDeleting(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Elimina promozione</AlertDialogTitle>
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
