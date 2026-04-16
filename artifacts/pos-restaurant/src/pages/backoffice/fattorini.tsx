import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BackofficeShell } from "@/components/BackofficeShell";
import { Plus, Pencil, Trash2, Bike, Phone } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

type Courier = {
  id: number; name: string; phone?: string; vehicle: string; notes?: string; active: boolean;
};

const VEHICLES = [
  { value: "moto", label: "Moto / Scooter" },
  { value: "bici", label: "Bicicletta" },
  { value: "auto", label: "Auto" },
  { value: "piedi", label: "A piedi" },
];

function CourierForm({ initial, onSave, onCancel }: {
  initial?: Partial<Courier>;
  onSave: (d: Partial<Courier>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [vehicle, setVehicle] = useState(initial?.vehicle ?? "moto");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [active, setActive] = useState(initial?.active ?? true);

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Nome fattorino</label>
        <input value={name} onChange={e => setName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none"
          placeholder="es. Mario Rossi" />
      </div>
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Telefono</label>
        <input value={phone} onChange={e => setPhone(e.target.value)} type="tel"
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none"
          placeholder="es. 333 1234567" />
      </div>
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Mezzo</label>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {VEHICLES.map(v => (
            <button key={v.value} onClick={() => setVehicle(v.value)}
              className={`p-2.5 rounded-xl border-2 text-sm font-semibold transition-all ${vehicle === v.value ? "border-primary bg-orange-50 text-primary" : "border-slate-200 text-slate-600 hover:border-primary/40"}`}>
              {v.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Note</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none resize-none"
          placeholder="Note aggiuntive..." />
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 cursor-pointer">
        <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="w-4 h-4 accent-primary" />
        Fattorino attivo
      </label>
      <DialogFooter>
        <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">Annulla</button>
        <button onClick={() => onSave({ name, phone: phone || undefined, vehicle, notes: notes || undefined, active })}
          disabled={!name.trim()}
          className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-bold hover:bg-primary/90 disabled:opacity-40">
          Salva
        </button>
      </DialogFooter>
    </div>
  );
}

export default function Fattorini() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Courier | null>(null);
  const [deleting, setDeleting] = useState<Courier | null>(null);

  const { data: couriers = [] } = useQuery<Courier[]>({
    queryKey: ["couriers"],
    queryFn: () => fetch(`${API}/couriers`).then(r => r.json()),
  });

  const create = useMutation({
    mutationFn: (body: Partial<Courier>) => fetch(`${API}/couriers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["couriers"] }); setShowForm(false); toast({ title: "Fattorino aggiunto" }); },
  });

  const update = useMutation({
    mutationFn: ({ id, ...body }: Partial<Courier> & { id: number }) => fetch(`${API}/couriers/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["couriers"] }); setEditing(null); toast({ title: "Fattorino aggiornato" }); },
  });

  const remove = useMutation({
    mutationFn: (id: number) => fetch(`${API}/couriers/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["couriers"] }); setDeleting(null); toast({ title: "Fattorino eliminato" }); },
  });

  const active = couriers.filter(c => c.active);
  const inactive = couriers.filter(c => !c.active);

  return (
    <BackofficeShell title="Fattorini" subtitle="Gestione rider per consegne a domicilio">
      <div className="p-4 max-w-xl mx-auto space-y-4">
        <button onClick={() => setShowForm(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-primary text-primary font-semibold hover:bg-orange-50 transition-all">
          <Plus className="h-4 w-4" /> Nuovo Fattorino
        </button>

        {couriers.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            <Bike className="h-10 w-10 mx-auto mb-3 opacity-25" />
            <p className="text-sm">Nessun fattorino configurato</p>
          </div>
        )}

        {active.length > 0 && (
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Attivi ({active.length})</div>
            <div className="space-y-2">
              {active.map(c => (
                <div key={c.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                    <Bike className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-slate-800 text-sm">{c.name}</div>
                    <div className="text-xs text-slate-400 flex items-center gap-1">
                      {c.phone && <><Phone className="h-3 w-3" /> {c.phone} ·</>}
                      {VEHICLES.find(v => v.value === c.vehicle)?.label}
                    </div>
                  </div>
                  <button onClick={() => setEditing(c)} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-primary transition-colors">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => setDeleting(c)} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {inactive.length > 0 && (
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Inattivi ({inactive.length})</div>
            <div className="space-y-2">
              {inactive.map(c => (
                <div key={c.id} className="bg-slate-50 rounded-xl border border-slate-200 p-4 flex items-center gap-3 opacity-60">
                  <div className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                    <Bike className="h-5 w-5 text-slate-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-slate-600 text-sm">{c.name}</div>
                    <div className="text-xs text-slate-400">{VEHICLES.find(v => v.value === c.vehicle)?.label}</div>
                  </div>
                  <button onClick={() => setEditing(c)} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-primary transition-colors">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => setDeleting(c)} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <Dialog open={showForm} onOpenChange={setShowForm}>
          <DialogContent>
            <DialogHeader><DialogTitle>Nuovo Fattorino</DialogTitle></DialogHeader>
            <CourierForm onSave={b => create.mutate(b)} onCancel={() => setShowForm(false)} />
          </DialogContent>
        </Dialog>

        <Dialog open={!!editing} onOpenChange={v => !v && setEditing(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Modifica Fattorino</DialogTitle></DialogHeader>
            {editing && <CourierForm initial={editing} onSave={b => update.mutate({ ...b, id: editing.id })} onCancel={() => setEditing(null)} />}
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!deleting} onOpenChange={v => !v && setDeleting(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Elimina fattorino</AlertDialogTitle>
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
