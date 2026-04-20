import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2, X, Phone, Users, CalendarDays, Clock } from "lucide-react";
import { BackofficeShell } from "@/components/BackofficeShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

type Res = {
  id: number; tableId: number | null; tableName: string | null;
  date: string; time: string; covers: number;
  guestName: string; phone: string | null; notes: string | null;
  status: string;
};
type Table = { id: number; name: string };

const MONTHS_IT = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
const DAYS_IT = ["Lu","Ma","Me","Gi","Ve","Sa","Do"];
const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  confirmed: { label: "Confermata", bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  arrived:   { label: "Arrivata",   bg: "bg-blue-50",    text: "text-blue-700",    dot: "bg-blue-500"    },
  cancelled: { label: "Annullata",  bg: "bg-red-50",     text: "text-red-700",     dot: "bg-red-400"     },
  noshow:    { label: "No-show",    bg: "bg-orange-50",  text: "text-orange-700",  dot: "bg-orange-400"  },
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function formatDateIT(d: string) {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function useReservations(from: string, to: string) {
  return useQuery<Res[]>({
    queryKey: ["reservations", from, to],
    queryFn: () => fetch(`${API}/reservations?from=${from}&to=${to}`).then(r => r.json()),
    staleTime: 30000,
  });
}
function useTables() {
  return useQuery<Table[]>({
    queryKey: ["tables"],
    queryFn: () => fetch(`${API}/tables`).then(r => r.json()),
  });
}

const EMPTY_FORM = { tableId: "" as string, date: todayStr(), time: "20:00", covers: 2, guestName: "", phone: "", notes: "" };

export default function PrenotazioniPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const today = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(todayStr());

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const lastOfMonth = new Date(viewYear, viewMonth + 1, 0);
  const fromStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-01`;
  const toStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(lastOfMonth.getDate()).padStart(2, "0")}`;

  const { data: allRes = [] } = useReservations(fromStr, toStr);
  const { data: tables = [] } = useTables();

  const dayRes = useMemo(() => {
    const map: Record<string, Res[]> = {};
    allRes.forEach(r => { if (!map[r.date]) map[r.date] = []; map[r.date].push(r); });
    return map;
  }, [allRes]);

  const selectedDayRes = selectedDate ? (dayRes[selectedDate] ?? []) : [];

  // Calendar grid
  const startDow = (firstOfMonth.getDay() + 6) % 7; // Mon=0
  const daysInMonth = lastOfMonth.getDate();
  const cells: (number | null)[] = [...Array(startDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  // Dialog
  const [dialog, setDialog] = useState<{ open: boolean; item?: Res }>({ open: false });
  const [form, setForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM);

  function openNew() {
    setForm({ ...EMPTY_FORM, date: selectedDate ?? todayStr() });
    setDialog({ open: true });
  }
  function openEdit(r: Res) {
    setForm({ tableId: r.tableId ? String(r.tableId) : "", date: r.date, time: r.time, covers: r.covers, guestName: r.guestName, phone: r.phone ?? "", notes: r.notes ?? "" });
    setDialog({ open: true, item: r });
  }
  function close() { setDialog({ open: false }); }

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        tableId: form.tableId ? parseInt(form.tableId) : null,
        date: form.date, time: form.time, covers: form.covers,
        guestName: form.guestName.trim(), phone: form.phone.trim() || null, notes: form.notes.trim() || null,
      };
      if (dialog.item) {
        const r = await fetch(`${API}/reservations/${dialog.item.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
        return r.json();
      } else {
        const r = await fetch(`${API}/reservations`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
        return r.json();
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reservations"] });
      toast({ title: dialog.item ? "Prenotazione aggiornata" : "Prenotazione creata" });
      close();
    },
    onError: (e: unknown) => toast({ title: "Errore", description: (e as Error).message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) => fetch(`${API}/reservations/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reservations"] }); toast({ title: "Eliminata" }); },
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      fetch(`${API}/reservations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reservations"] }),
  });

  const prevMonth = () => { if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); } else setViewMonth(m => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); } else setViewMonth(m => m + 1); };

  return (
    <BackofficeShell
      title="Prenotazioni"
      subtitle="Calendario tavoli"
      actions={<Button size="sm" onClick={openNew} className="gap-1.5"><Plus className="h-4 w-4" /> Nuova</Button>}
    >
      <div className="flex flex-col md:flex-row h-full min-h-0">

        {/* Calendar panel */}
        <div className="md:w-80 shrink-0 bg-white border-b md:border-b-0 md:border-r border-slate-200 p-4 flex flex-col gap-4">
          {/* Month nav */}
          <div className="flex items-center gap-2">
            <button onClick={prevMonth} className="h-9 w-9 rounded-xl border-2 border-slate-200 flex items-center justify-center hover:border-primary hover:text-primary transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="flex-1 text-center font-bold text-slate-800">
              {MONTHS_IT[viewMonth]} {viewYear}
            </div>
            <button onClick={nextMonth} className="h-9 w-9 rounded-xl border-2 border-slate-200 flex items-center justify-center hover:border-primary hover:text-primary transition-colors">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 text-center">
            {DAYS_IT.map(d => (
              <div key={d} className="text-[10px] font-bold text-slate-400 py-1">{d}</div>
            ))}
          </div>

          {/* Calendar cells */}
          <div className="grid grid-cols-7 gap-y-1">
            {cells.map((day, idx) => {
              if (!day) return <div key={idx} />;
              const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const res = dayRes[dateStr] ?? [];
              const isToday = dateStr === todayStr();
              const isSelected = dateStr === selectedDate;
              const hasActive = res.some(r => r.status !== "cancelled");
              return (
                <button key={idx} onClick={() => setSelectedDate(dateStr)}
                  className={cn(
                    "h-10 rounded-xl flex flex-col items-center justify-center transition-all relative",
                    isSelected ? "bg-primary text-white shadow-md" :
                    isToday ? "border-2 border-primary text-primary font-bold" :
                    "hover:bg-slate-100 text-slate-700"
                  )}>
                  <span className="text-sm font-semibold leading-none">{day}</span>
                  {hasActive && (
                    <div className={cn(
                      "absolute bottom-1 h-1.5 w-1.5 rounded-full",
                      isSelected ? "bg-white" : "bg-primary"
                    )} />
                  )}
                </button>
              );
            })}
          </div>

          {/* Month summary */}
          <div className="mt-auto pt-3 border-t border-slate-100">
            <div className="text-xs text-slate-500 font-semibold mb-2">Riepilogo mese</div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Totale", value: allRes.filter(r => r.status !== "cancelled").length },
                { label: "Coperti", value: allRes.filter(r => r.status !== "cancelled").reduce((s, r) => s + r.covers, 0) },
              ].map(k => (
                <div key={k.label} className="bg-slate-50 rounded-xl p-3 text-center">
                  <div className="text-[10px] text-slate-400">{k.label}</div>
                  <div className="text-xl font-bold text-slate-800">{k.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Day detail panel */}
        <div className="flex-1 min-h-0 overflow-y-auto bg-[#f4f6fa] p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-bold text-slate-800 text-lg">
                {selectedDate ? formatDateIT(selectedDate) : "—"}
              </h2>
              <p className="text-xs text-slate-400">
                {selectedDayRes.filter(r => r.status !== "cancelled").length} prenotazioni · {selectedDayRes.filter(r => r.status !== "cancelled").reduce((s, r) => s + r.covers, 0)} coperti
              </p>
            </div>
            <Button size="sm" onClick={openNew} variant="outline" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Aggiungi
            </Button>
          </div>

          {selectedDayRes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <CalendarDays className="h-10 w-10 mb-3 opacity-20" />
              <p className="font-semibold">Nessuna prenotazione</p>
              <p className="text-sm mt-1">Premi "Nuova" per aggiungerne una</p>
            </div>
          ) : (
            <div className="space-y-3">
              {[...selectedDayRes].sort((a, b) => a.time.localeCompare(b.time)).map(r => {
                const st = STATUS_CONFIG[r.status] ?? STATUS_CONFIG.confirmed;
                return (
                  <div key={r.id} className={cn("bg-white rounded-2xl border-2 border-slate-200 p-4 shadow-sm", r.status === "cancelled" && "opacity-50")}>
                    <div className="flex items-start gap-3">
                      {/* Time badge */}
                      <div className="flex flex-col items-center justify-center bg-primary/10 rounded-xl px-3 py-2 shrink-0 min-w-[52px]">
                        <Clock className="h-3 w-3 text-primary mb-0.5" />
                        <span className="text-sm font-bold text-primary">{r.time}</span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-900 text-base">{r.guestName}</span>
                          <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-semibold flex items-center gap-1", st.bg, st.text)}>
                            <span className={cn("h-1.5 w-1.5 rounded-full", st.dot)} />
                            {st.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          <span className="flex items-center gap-1 text-xs text-slate-500">
                            <Users className="h-3 w-3" /> {r.covers} coperti
                          </span>
                          {r.tableName && (
                            <span className="text-xs text-slate-500 font-medium">Tavolo {r.tableName}</span>
                          )}
                          {r.phone && (
                            <span className="flex items-center gap-1 text-xs text-slate-500">
                              <Phone className="h-3 w-3" /> {r.phone}
                            </span>
                          )}
                        </div>
                        {r.notes && (
                          <div className="mt-1.5 text-xs italic text-slate-400 truncate">{r.notes}</div>
                        )}
                      </div>

                      <div className="flex flex-col gap-1 shrink-0">
                        <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-primary transition-colors">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => del.mutate(r.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Status buttons */}
                    {r.status !== "cancelled" && (
                      <div className="flex gap-1.5 mt-3 pt-3 border-t border-slate-100 flex-wrap">
                        {(["confirmed", "arrived", "noshow", "cancelled"] as const).filter(s => s !== r.status).map(s => {
                          const c = STATUS_CONFIG[s];
                          return (
                            <button key={s} onClick={() => changeStatus.mutate({ id: r.id, status: s })}
                              className={cn("text-[10px] px-2.5 py-1.5 rounded-lg font-semibold transition-all border", c.bg, c.text, "border-transparent hover:opacity-80")}>
                              → {c.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Edit / New dialog */}
      <Dialog open={dialog.open} onOpenChange={o => !o && close()}>
        <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialog.item ? "Modifica prenotazione" : "Nuova prenotazione"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">Data *</Label>
                <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="h-9" />
              </div>
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">Orario *</Label>
                <Input type="time" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} className="h-9" />
              </div>
            </div>
            <div>
              <Label className="text-xs text-slate-500 mb-1 block">Nome ospite *</Label>
              <Input value={form.guestName} onChange={e => setForm(f => ({ ...f, guestName: e.target.value }))} placeholder="Es. Rossi Mario" className="h-9" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">Coperti</Label>
                <Input type="number" min={1} max={50} value={form.covers} onChange={e => setForm(f => ({ ...f, covers: parseInt(e.target.value) || 2 }))} className="h-9" />
              </div>
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">Telefono</Label>
                <Input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+39 …" className="h-9" />
              </div>
            </div>
            <div>
              <Label className="text-xs text-slate-500 mb-1 block">Tavolo <span className="text-slate-300">(opzionale)</span></Label>
              <select
                value={form.tableId}
                onChange={e => setForm(f => ({ ...f, tableId: e.target.value }))}
                className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              >
                <option value="">— Da assegnare —</option>
                {tables.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs text-slate-500 mb-1 block">Note</Label>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2} placeholder="Allergie, occasione speciale…"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm resize-none outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close}>Annulla</Button>
            <Button onClick={() => save.mutate()} disabled={!form.guestName.trim() || !form.date || !form.time || save.isPending}>
              {save.isPending ? "Salvataggio…" : "Salva"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BackofficeShell>
  );
}
