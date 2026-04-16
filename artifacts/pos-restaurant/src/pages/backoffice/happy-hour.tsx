import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BackofficeShell } from "@/components/BackofficeShell";
import { Plus, Pencil, Trash2, Clock, Sun } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

type HappyHour = {
  id: number; name: string; startTime: string; endTime: string;
  daysOfWeek: string; priceList: string; discountPercent: string; active: boolean;
};

const DAYS = [
  { n: 0, label: "D" }, { n: 1, label: "L" }, { n: 2, label: "M" },
  { n: 3, label: "M" }, { n: 4, label: "G" }, { n: 5, label: "V" }, { n: 6, label: "S" },
];

const PRICE_LISTS = [
  { value: "1", label: "Listino 1 (Servito)" },
  { value: "2", label: "Listino 2 (Asporto)" },
  { value: "3", label: "Listino 3 (Fidelity)" },
  { value: "4", label: "Listino 4 (Staff)" },
];

function HappyHourForm({ initial, onSave, onCancel }: {
  initial?: Partial<HappyHour>;
  onSave: (d: Partial<HappyHour>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [startTime, setStartTime] = useState(initial?.startTime ?? "17:00");
  const [endTime, setEndTime] = useState(initial?.endTime ?? "19:00");
  const [selectedDays, setSelectedDays] = useState<number[]>(
    (initial?.daysOfWeek ?? "1,2,3,4,5").split(",").map(Number)
  );
  const [priceList, setPriceList] = useState(initial?.priceList ?? "2");
  const [discountPercent, setDiscountPercent] = useState(initial?.discountPercent ?? "0");
  const [active, setActive] = useState(initial?.active ?? true);

  const toggleDay = (n: number) =>
    setSelectedDays(prev => prev.includes(n) ? prev.filter(d => d !== n) : [...prev, n]);

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Nome regola</label>
        <input value={name} onChange={e => setName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none"
          placeholder="es. Happy Hour Aperitivo" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Inizio</label>
          <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none" />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Fine</label>
          <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none" />
        </div>
      </div>
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Giorni</label>
        <div className="mt-1 flex gap-1">
          {DAYS.map(d => (
            <button key={d.n} onClick={() => toggleDay(d.n)}
              className={`flex-1 h-9 rounded-lg text-xs font-bold transition-all ${selectedDays.includes(d.n) ? "bg-primary text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
              {d.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Listino prezzi da applicare</label>
        <select value={priceList} onChange={e => setPriceList(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none">
          {PRICE_LISTS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </div>
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Sconto aggiuntivo (%)</label>
        <input type="number" min="0" max="100" step="1" value={discountPercent} onChange={e => setDiscountPercent(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none" />
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 cursor-pointer">
        <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="w-4 h-4 accent-primary" />
        Regola attiva
      </label>
      <DialogFooter>
        <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">Annulla</button>
        <button onClick={() => onSave({ name, startTime, endTime, daysOfWeek: selectedDays.join(","), priceList, discountPercent, active })}
          disabled={!name.trim() || selectedDays.length === 0}
          className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-bold hover:bg-primary/90 disabled:opacity-40">
          Salva
        </button>
      </DialogFooter>
    </div>
  );
}

const DAY_NAMES = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];

export default function HappyHourPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<HappyHour | null>(null);
  const [deleting, setDeleting] = useState<HappyHour | null>(null);

  const { data: rules = [] } = useQuery<HappyHour[]>({
    queryKey: ["happy-hour"],
    queryFn: () => fetch(`${API}/happy-hour`).then(r => r.json()),
  });

  const create = useMutation({
    mutationFn: (body: Partial<HappyHour>) => fetch(`${API}/happy-hour`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["happy-hour"] }); setShowForm(false); toast({ title: "Regola creata" }); },
  });

  const update = useMutation({
    mutationFn: ({ id, ...body }: Partial<HappyHour> & { id: number }) => fetch(`${API}/happy-hour/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["happy-hour"] }); setEditing(null); toast({ title: "Regola aggiornata" }); },
  });

  const remove = useMutation({
    mutationFn: (id: number) => fetch(`${API}/happy-hour/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["happy-hour"] }); setDeleting(null); toast({ title: "Regola eliminata" }); },
  });

  return (
    <BackofficeShell title="Happy Hour" subtitle="Fasce orarie con prezzi speciali">
      <div className="p-4 max-w-xl mx-auto space-y-4">
        <button onClick={() => setShowForm(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-primary text-primary font-semibold hover:bg-orange-50 transition-all">
          <Plus className="h-4 w-4" /> Nuova Regola Happy Hour
        </button>

        {rules.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            <Sun className="h-10 w-10 mx-auto mb-3 opacity-25" />
            <p className="text-sm">Nessuna regola happy hour configurata</p>
          </div>
        )}

        {rules.map(r => (
          <div key={r.id} className={`bg-white rounded-xl border shadow-sm p-4 ${r.active ? "border-slate-200" : "border-slate-100 opacity-60"}`}>
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                <Clock className="h-5 w-5 text-amber-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-bold text-slate-800 text-sm">{r.name}</span>
                  {!r.active && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">Inattivo</span>}
                </div>
                <div className="text-xs text-slate-500">
                  <span className="font-semibold text-primary">{r.startTime} – {r.endTime}</span>
                  {" · "}
                  {r.daysOfWeek.split(",").map(d => DAY_NAMES[Number(d)]).join(", ")}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  Listino {r.priceList}
                  {parseFloat(r.discountPercent) > 0 && ` + sconto ${r.discountPercent}%`}
                </div>
              </div>
              <div className="flex gap-1">
                <button onClick={() => setEditing(r)} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-primary transition-colors">
                  <Pencil className="h-4 w-4" />
                </button>
                <button onClick={() => setDeleting(r)} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ))}

        <Dialog open={showForm} onOpenChange={setShowForm}>
          <DialogContent>
            <DialogHeader><DialogTitle>Nuova Regola Happy Hour</DialogTitle></DialogHeader>
            <HappyHourForm onSave={b => create.mutate(b)} onCancel={() => setShowForm(false)} />
          </DialogContent>
        </Dialog>

        <Dialog open={!!editing} onOpenChange={v => !v && setEditing(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Modifica Regola</DialogTitle></DialogHeader>
            {editing && <HappyHourForm initial={editing} onSave={b => update.mutate({ ...b, id: editing.id })} onCancel={() => setEditing(null)} />}
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!deleting} onOpenChange={v => !v && setDeleting(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Elimina regola</AlertDialogTitle>
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
