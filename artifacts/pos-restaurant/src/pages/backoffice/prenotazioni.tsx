import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft, ChevronRight, Plus, Pencil, Trash2, X,
  Phone, Users, CalendarDays, Clock, List, Map as MapIcon, Check, Copy, Globe, MessageCircle, Hourglass,
} from "lucide-react";
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
  id: number; tableId: number | null; tableIds?: string | null; tableName: string | null;
  date: string; time: string; covers: number;
  guestName: string; phone: string | null; notes: string | null;
  status: string; durationMinutes?: number; source?: string;
};
type FETable = {
  id: number; name: string; status?: string;
  posX?: number; posY?: number; shape?: string; elementType?: string;
  roomName?: string; capacity?: number;
};
type Table = { id: number; name: string };

const MONTHS_IT = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
const DAYS_IT = ["Lu","Ma","Me","Gi","Ve","Sa","Do"];
const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  pending:   { label: "Da confermare", bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
  completed: { label: "Completata", bg: "bg-slate-100", text: "text-slate-600", dot: "bg-slate-400" },
  confirmed: { label: "Confermata", bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  arrived:   { label: "Arrivata",   bg: "bg-blue-50",    text: "text-blue-700",    dot: "bg-blue-500"    },
  cancelled: { label: "Annullata",  bg: "bg-red-50",     text: "text-red-700",     dot: "bg-red-400"     },
  noshow:    { label: "No-show",    bg: "bg-orange-50",  text: "text-orange-700",  dot: "bg-orange-400"  },
};

const CELL = 80;
const SHARE_URL = `${window.location.origin}${BASE}/prenota`;

async function apiCall(method: string, url: string, body?: unknown) {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).error ?? msg; } catch { /**/ }
    throw new Error(msg);
  }
  return r.json().catch(() => ({}));
}

function todayStr() { return new Date().toISOString().slice(0, 10); }
function formatDateIT(d: string) {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}
function formatDateFull(d: string) {
  const dt = new Date(d + "T00:00:00");
  const days = ["Domenica","Lunedì","Martedì","Mercoledì","Giovedì","Venerdì","Sabato"];
  return `${days[dt.getDay()]} ${dt.getDate()} ${MONTHS_IT[dt.getMonth()]} ${dt.getFullYear()}`;
}
function parseResTableIds(r: Res): number[] {
  if (r.tableIds) { try { return JSON.parse(r.tableIds) as number[]; } catch { /**/ } }
  return r.tableId ? [r.tableId] : [];
}
function getElemSize(t: FETable) {
  const et = t.elementType ?? "table";
  if (et === "wall") return { w: 2, h: 1 };
  if (et === "sofa") return { w: 2, h: 1 };
  return { w: 1, h: 1 };
}

function useReservations(from: string, to: string) {
  return useQuery<Res[]>({
    queryKey: ["reservations", from, to],
    queryFn: () => apiCall("GET", `${API}/reservations?from=${from}&to=${to}`),
    staleTime: 30000,
  });
}
function usePending() {
  return useQuery<Res[]>({
    queryKey: ["reservations", "pending"],
    queryFn: () => apiCall("GET", `${API}/reservations?status=pending`),
    refetchInterval: 15000,
  });
}
function useOnlineSetting() {
  return useQuery<boolean>({
    queryKey: ["settings", "online_booking_enabled"],
    queryFn: async () => {
      const d = await apiCall("GET", `${API}/settings`);
      if (Array.isArray(d)) return d.find((x: { key: string }) => x.key === "online_booking_enabled")?.value === "true";
      return (d as Record<string, unknown>)?.online_booking_enabled === "true";
    },
  });
}
function useTables() {
  return useQuery<Table[]>({
    queryKey: ["tables"],
    queryFn: () => fetch(`${API}/tables`).then(r => r.json()),
  });
}
function useTableLayout() {
  return useQuery<FETable[]>({
    queryKey: ["tables-status"],
    queryFn: () => fetch(`${API}/dashboard/tables-status`).then(r => r.json()),
    staleTime: 60000,
  });
}

const EMPTY_FORM = { tableIds: [] as number[], durationMinutes: 120, date: todayStr(), time: "20:00", covers: 2, guestName: "", phone: "", notes: "" };

// ── Mini floor map for reservations ──────────────────────────────────────────
function ResMapView({ tables, dayRes }: { tables: FETable[]; dayRes: Res[] }) {
  const [roomFilter, setRoomFilter] = useState<string | null>(null);

  const rooms = useMemo(() => {
    const s = new Set<string>();
    tables.forEach(t => { if (t.roomName) s.add(t.roomName); });
    return Array.from(s);
  }, [tables]);

  const filtered = useMemo(() => {
    const els = tables.filter(t => t.posX !== undefined && t.posY !== undefined);
    return roomFilter ? els.filter(t => t.roomName === roomFilter) : els;
  }, [tables, roomFilter]);

  // Map tableId → reservation(s) for this day
  const resByTable = useMemo(() => {
    const m = new Map<number, Res[]>();
    for (const r of dayRes.filter(x => x.status !== "cancelled")) {
      for (const tid of parseResTableIds(r)) {
        if (!m.has(tid)) m.set(tid, []);
        m.get(tid)!.push(r);
      }
    }
    return m;
  }, [dayRes]);

  const maxX = filtered.length ? Math.max(...filtered.map(t => (t.posX ?? 0) + getElemSize(t).w)) + 1 : 5;
  const maxY = filtered.length ? Math.max(...filtered.map(t => (t.posY ?? 0) + getElemSize(t).h)) + 1 : 4;

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <MapIcon className="h-10 w-10 mb-3 opacity-20" />
        <p className="text-sm">Nessuna planimetria disponibile</p>
      </div>
    );
  }

  return (
    <div>
      {rooms.length > 1 && (
        <div className="flex gap-1.5 mb-3 flex-wrap">
          <button onClick={() => setRoomFilter(null)}
            className={cn("px-3 py-1.5 rounded-full text-xs font-semibold transition-all",
              roomFilter === null ? "bg-primary text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>
            Tutte
          </button>
          {rooms.map(r => (
            <button key={r} onClick={() => setRoomFilter(r)}
              className={cn("px-3 py-1.5 rounded-full text-xs font-semibold transition-all",
                roomFilter === r ? "bg-primary text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>
              {r}
            </button>
          ))}
        </div>
      )}

      <div className="overflow-auto">
        <div
          className="relative border border-slate-200 rounded-2xl bg-slate-50 shrink-0"
          style={{ width: maxX * CELL, height: maxY * CELL, minWidth: 200 }}
        >
          {Array.from({ length: maxY + 1 }).map((_, i) => (
            <div key={`h${i}`} className="absolute left-0 right-0 border-b border-slate-200/60" style={{ top: i * CELL }} />
          ))}
          {Array.from({ length: maxX + 1 }).map((_, i) => (
            <div key={`v${i}`} className="absolute top-0 bottom-0 border-r border-slate-200/60" style={{ left: i * CELL }} />
          ))}

          {filtered.map(t => {
            const et = t.elementType ?? "table";
            const { w, h } = getElemSize(t);
            const x = (t.posX ?? 0) * CELL + 4;
            const y = (t.posY ?? 0) * CELL + 4;
            const tw = w * CELL - 8;
            const th = h * CELL - 8;
            const reservations = resByTable.get(t.id) ?? [];
            const hasRes = reservations.length > 0;
            const isDecorative = et === "wall" || et === "bar" || et === "sofa";
            const isCircle = t.shape === "circle";

            if (isDecorative) {
              return (
                <div key={t.id} className="absolute flex items-center justify-center"
                  style={{ left: x, top: y, width: tw, height: th }}>
                  <div className="w-full h-full rounded-lg bg-slate-200/70 flex items-center justify-center">
                    <span className="text-[9px] text-slate-400 font-medium">{t.name}</span>
                  </div>
                </div>
              );
            }

            return (
              <div key={t.id} className="absolute" style={{ left: x, top: y, width: tw, height: th }}>
                <div className={cn(
                  "w-full h-full flex flex-col items-center justify-center border-2 text-center p-1 transition-all",
                  isCircle ? "rounded-full" : "rounded-xl",
                  hasRes
                    ? "bg-blue-100 border-blue-400 shadow-sm"
                    : "bg-white border-slate-200"
                )}>
                  <span className={cn("text-[10px] font-bold leading-tight", hasRes ? "text-blue-700" : "text-slate-500")}>
                    {t.name}
                  </span>
                  {hasRes && (
                    <span className="text-[8px] text-blue-600 leading-tight mt-0.5 font-medium truncate w-full text-center px-0.5">
                      {reservations[0].guestName.split(" ")[0]}
                      {reservations.length > 1 ? ` +${reservations.length - 1}` : ""}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-4 mt-3 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded bg-blue-100 border border-blue-400" />
          Prenotato
        </span>
        <span className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded bg-white border border-slate-200" />
          Libero
        </span>
      </div>
    </div>
  );
}

export default function PrenotazioniPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const today = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(todayStr());
  const [detailView, setDetailView] = useState<"list" | "map">("list");

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const lastOfMonth = new Date(viewYear, viewMonth + 1, 0);
  const fromStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-01`;
  const toStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(lastOfMonth.getDate()).padStart(2, "0")}`;

  const resQ = useReservations(fromStr, toStr);
  const allRes = useMemo(() => (Array.isArray(resQ.data) ? resQ.data : []), [resQ.data]);
  const { data: tables = [] } = useTables();
  const pendingQ = usePending();
  const pending = useMemo(() => (Array.isArray(pendingQ.data) ? pendingQ.data : []), [pendingQ.data]);
  const { data: onlineEnabled = false } = useOnlineSetting();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { data: tableLayout = [] } = useTableLayout();

  const dayRes = useMemo(() => {
    const map: Record<string, Res[]> = {};
    allRes.forEach(r => { if (!map[r.date]) map[r.date] = []; map[r.date].push(r); });
    return map;
  }, [allRes]);

  const selectedDayAll = selectedDate ? (dayRes[selectedDate] ?? []) : [];
  const selectedDayRes = statusFilter === "all" ? selectedDayAll : selectedDayAll.filter(r => r.status === statusFilter);

  // Calendar grid
  const startDow = (firstOfMonth.getDay() + 6) % 7;
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
    setForm({ tableIds: parseResTableIds(r), durationMinutes: r.durationMinutes ?? 120, date: r.date, time: r.time, covers: r.covers, guestName: r.guestName, phone: r.phone ?? "", notes: r.notes ?? "" });
    setDialog({ open: true, item: r });
  }
  function close() { setDialog({ open: false }); }

  const refresh = () => qc.invalidateQueries({ queryKey: ["reservations"] });
  const errToast = (e: unknown) => toast({ title: "Errore", description: (e as Error).message, variant: "destructive" });

  const save = useMutation({
    mutationFn: (confirm?: boolean) => {
      const payload = {
        ...(confirm ? { status: "confirmed" } : {}),
        tableId: form.tableIds[0] ?? null, tableIds: form.tableIds,
        date: form.date, time: form.time, covers: form.covers, durationMinutes: form.durationMinutes,
        guestName: form.guestName.trim(), phone: form.phone.trim() || null, notes: form.notes.trim() || null,
      };
      return dialog.item
        ? apiCall("PATCH", `${API}/reservations/${dialog.item.id}`, payload)
        : apiCall("POST", `${API}/reservations`, payload);
    },
    onSuccess: () => { refresh(); toast({ title: dialog.item ? "Prenotazione aggiornata" : "Prenotazione creata" }); close(); },
    onError: errToast,
  });

  const del = useMutation({
    mutationFn: (id: number) => apiCall("DELETE", `${API}/reservations/${id}`),
    onSuccess: () => { refresh(); toast({ title: "Eliminata" }); },
    onError: errToast,
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => apiCall("PATCH", `${API}/reservations/${id}`, { status }),
    onSuccess: (_d, v) => { refresh(); toast({ title: v.status === "confirmed" ? "Prenotazione confermata" : v.status === "cancelled" ? "Prenotazione annullata" : "Stato aggiornato" }); },
    onError: errToast,
  });

  const setOnline = useMutation({
    mutationFn: (on: boolean) => apiCall("PATCH", `${API}/settings`, { key: "online_booking_enabled", value: on ? "true" : "false" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings"] }); toast({ title: "Impostazione salvata" }); },
    onError: errToast,
  });

  function jumpTo(r: Res) {
    setSelectedDate(r.date);
    const [y, m] = r.date.split("-").map(Number);
    setViewYear(y); setViewMonth(m - 1);
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(SHARE_URL); toast({ title: "Link copiato" }); }
    catch { toast({ title: "Copia non riuscita", description: SHARE_URL, variant: "destructive" }); }
  }

  const prevMonth = () => { if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); } else setViewMonth(m => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); } else setViewMonth(m => m + 1); };

  // Navigate selected date within calendar bounds
  function goPrevDay() {
    if (!selectedDate) return;
    const dt = new Date(selectedDate + "T00:00:00");
    dt.setDate(dt.getDate() - 1);
    const nd = dt.toISOString().slice(0, 10);
    setSelectedDate(nd);
    const nm = dt.getMonth(); const ny = dt.getFullYear();
    if (nm !== viewMonth || ny !== viewYear) { setViewMonth(nm); setViewYear(ny); }
  }
  function goNextDay() {
    if (!selectedDate) return;
    const dt = new Date(selectedDate + "T00:00:00");
    dt.setDate(dt.getDate() + 1);
    const nd = dt.toISOString().slice(0, 10);
    setSelectedDate(nd);
    const nm = dt.getMonth(); const ny = dt.getFullYear();
    if (nm !== viewMonth || ny !== viewYear) { setViewMonth(nm); setViewYear(ny); }
  }

  return (
    <BackofficeShell
      title="Prenotazioni"
      subtitle="Calendario tavoli"
      actions={<Button size="sm" onClick={openNew} className="gap-1.5"><Plus className="h-4 w-4" /> Nuova</Button>}
    >
      <div className="flex flex-col md:flex-row h-full min-h-0">

        {/* Calendar panel */}
        <div className="md:w-72 shrink-0 bg-white border-b md:border-b-0 md:border-r border-slate-200 p-4 flex flex-col gap-4">
          {/* Month nav */}
          <div className="flex items-center gap-2">
            <button onClick={prevMonth} className="h-9 w-9 rounded-xl border-2 border-slate-200 flex items-center justify-center hover:border-primary hover:text-primary transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="flex-1 text-center font-bold text-slate-800 text-sm">
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
              const activeCount = res.filter(r => r.status !== "cancelled").length;
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
                      "absolute bottom-1 text-[8px] font-bold",
                      isSelected ? "text-white/80" : "text-primary"
                    )}>{activeCount}</div>
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
                { label: "Prenotazioni", value: allRes.filter(r => r.status !== "cancelled").length },
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

          {/* Day header with date nav */}
          <div className="flex items-center gap-3 mb-4">
            <button onClick={goPrevDay}
              className="h-9 w-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center hover:border-primary hover:text-primary transition-colors shrink-0">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="flex-1 min-w-0">
              <h2 className="font-bold text-slate-800">
                {selectedDate ? formatDateFull(selectedDate) : "—"}
              </h2>
              <p className="text-xs text-slate-400">
                {selectedDayRes.filter(r => r.status !== "cancelled").length} prenotazioni
                {" · "}
                {selectedDayRes.filter(r => r.status !== "cancelled").reduce((s, r) => s + r.covers, 0)} coperti
              </p>
            </div>
            <button onClick={goNextDay}
              className="h-9 w-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center hover:border-primary hover:text-primary transition-colors shrink-0">
              <ChevronRight className="h-4 w-4" />
            </button>
            <Button size="sm" onClick={openNew} variant="outline" className="gap-1 shrink-0">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>

          {(resQ.isError || pendingQ.isError) && (
            <div className="mb-4 rounded-xl bg-red-50 text-red-700 text-sm p-3 flex items-center gap-3" data-testid="error-reservations">
              <span className="flex-1">
                {resQ.isError ? `Agenda non caricata: ${(resQ.error as Error).message}` : `Richieste non aggiornate: ${(pendingQ.error as Error).message}`}
              </span>
              <Button size="sm" variant="outline" onClick={() => { resQ.refetch(); pendingQ.refetch(); }}>Riprova</Button>
            </div>
          )}
          {resQ.isLoading && <div className="mb-4 h-16 rounded-xl bg-slate-200 animate-pulse" data-testid="loading-reservations" />}

          {/* Richieste in attesa */}
          {pending.length > 0 && (
            <div className="mb-4 rounded-2xl border-2 border-amber-300 bg-amber-50 p-3" data-testid="panel-pending">
              <div className="flex items-center gap-2 mb-2 text-amber-800 font-bold text-sm">
                <Hourglass className="h-4 w-4" /> Richieste da confermare ({pending.length})
              </div>
              <div className="space-y-2">
                {pending.map(r => (
                  <div key={r.id} className="bg-white rounded-xl p-3 flex flex-wrap items-center gap-3" data-testid={`row-pending-${r.id}`}>
                    <button onClick={() => jumpTo(r)} className="flex-1 min-w-[160px] text-left">
                      <div className="font-bold text-slate-800">{r.guestName}</div>
                      <div className="text-xs text-slate-500">{formatDateIT(r.date)} · {r.time.slice(0, 5)} · {r.covers} cop.{r.phone ? ` · ${r.phone}` : ""}</div>
                      {r.notes && <div className="text-xs italic text-slate-400 truncate">{r.notes}</div>}
                    </button>
                    <Button size="sm" variant="outline" className="h-10" onClick={() => openEdit(r)} data-testid={`button-assign-${r.id}`}>
                      Tavolo / modifica
                    </Button>
                    <Button size="sm" className="gap-1 h-10" disabled={changeStatus.isPending}
                      onClick={() => changeStatus.mutate({ id: r.id, status: "confirmed" })} data-testid={`button-confirm-${r.id}`}>
                      <Check className="h-4 w-4" /> Conferma
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1 h-10 text-red-600 border-red-200" disabled={changeStatus.isPending}
                      onClick={() => changeStatus.mutate({ id: r.id, status: "cancelled" })} data-testid={`button-reject-${r.id}`}>
                      <X className="h-4 w-4" /> Rifiuta
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Prenotazioni online */}
          <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-3 flex flex-wrap items-center gap-3">
            <Globe className="h-4 w-4 text-primary shrink-0" />
            <div className="flex-1 min-w-[200px]">
              <div className="text-sm font-bold text-slate-800">Prenotazioni online</div>
              <div className="text-[11px] text-slate-500 break-all">{SHARE_URL}</div>
              <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                <MessageCircle className="h-3 w-3" /> WhatsApp NON configurato — nessun messaggio inviato
              </div>
            </div>
            <Button size="sm" variant="outline" className="gap-1 h-9" onClick={copyLink} data-testid="button-copy-link"><Copy className="h-3.5 w-3.5" /> Copia link</Button>
            <button role="switch" aria-checked={onlineEnabled} disabled={setOnline.isPending}
              onClick={() => setOnline.mutate(!onlineEnabled)} data-testid="switch-online-booking"
              className={cn("h-9 px-4 rounded-full text-xs font-bold border-2 transition-colors",
                onlineEnabled ? "bg-primary text-white border-primary" : "bg-slate-100 text-slate-500 border-slate-200")}>
              {onlineEnabled ? "Attive" : "Disattivate"}
            </button>
          </div>

          {/* Filtro stato */}
          <div className="flex gap-1.5 mb-3 flex-wrap">
            {["all", "pending", "confirmed", "arrived", "completed", "noshow", "cancelled"].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)} data-testid={`filter-status-${s}`}
                className={cn("px-3 py-2 rounded-full text-xs font-semibold transition-all",
                  statusFilter === s ? "bg-primary text-white" : "bg-white border border-slate-200 text-slate-600")}>
                {s === "all" ? "Tutte" : STATUS_CONFIG[s].label}
              </button>
            ))}
          </div>

          {/* View toggle Lista / Mappa */}
          <div className="flex gap-1 bg-white rounded-xl p-1 shadow-sm border border-slate-200 mb-4 w-fit">
            <button onClick={() => setDetailView("list")}
              className={cn("flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all",
                detailView === "list" ? "bg-primary text-white shadow-sm" : "text-slate-500 hover:text-slate-700")}>
              <List className="h-3.5 w-3.5" /> Lista
            </button>
            <button onClick={() => setDetailView("map")}
              className={cn("flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all",
                detailView === "map" ? "bg-primary text-white shadow-sm" : "text-slate-500 hover:text-slate-700")}>
              <MapIcon className="h-3.5 w-3.5" /> Mappa
            </button>
          </div>

          {/* ── Vista Lista ───────────────────────────────────────────────── */}
          {detailView === "list" && (
            selectedDayRes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <CalendarDays className="h-10 w-10 mb-3 opacity-20" />
                <p className="font-semibold">Nessuna prenotazione</p>
                <p className="text-sm mt-1">Premi "Nuova" per aggiungerne una</p>
              </div>
            ) : (
              <div className="space-y-3">
                {[...selectedDayRes].sort((a, b) => a.time.localeCompare(b.time)).map(r => {
                  const st = STATUS_CONFIG[r.status] ?? STATUS_CONFIG.confirmed;
                  const tIds = parseResTableIds(r);
                  return (
                    <div key={r.id} className={cn("bg-white rounded-2xl border-2 border-slate-200 p-4 shadow-sm", r.status === "cancelled" && "opacity-50")}>
                      <div className="flex items-start gap-3">
                        <div className="flex flex-col items-center justify-center bg-primary/10 rounded-xl px-3 py-2 shrink-0 min-w-[52px]">
                          <Clock className="h-3 w-3 text-primary mb-0.5" />
                          <span className="text-sm font-bold text-primary">{r.time.slice(0,5)}</span>
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
                              <Users className="h-3 w-3" /> {r.covers} cop.
                            </span>
                            {tIds.length > 0 && (
                              <span className="text-xs text-slate-500 font-medium">
                                Tavolo {tIds.map(id => tables.find(t => t.id === id)?.name ?? (id === r.tableId ? r.tableName : null) ?? id).join(" + ")}
                              </span>
                            )}
                            <span className="text-xs text-slate-400">{r.durationMinutes ?? 120} min</span>
                            {r.source === "online" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 font-semibold">Online</span>}
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
                      {r.status !== "cancelled" && (
                        <div className="flex gap-1.5 mt-3 pt-3 border-t border-slate-100 flex-wrap">
                          {(["confirmed", "arrived", "completed", "noshow", "cancelled"] as const).filter(s => s !== r.status).map(s => {
                            const c = STATUS_CONFIG[s];
                            return (
                              <button key={s} onClick={() => changeStatus.mutate({ id: r.id, status: s })}
                                className={cn("text-xs px-3 py-2.5 rounded-lg font-semibold transition-all border", c.bg, c.text, "border-transparent hover:opacity-80")}>
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
            )
          )}

          {/* ── Vista Mappa ───────────────────────────────────────────────── */}
          {detailView === "map" && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
              <ResMapView tables={tableLayout} dayRes={selectedDayRes} />
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
              <Label className="text-xs text-slate-500 mb-1 block">Durata (minuti)</Label>
              <Input type="number" min={15} max={480} step={15} value={form.durationMinutes}
                onChange={e => setForm(f => ({ ...f, durationMinutes: parseInt(e.target.value) || 120 }))} className="h-9" data-testid="input-duration" />
            </div>
            <div>
              <Label className="text-xs text-slate-500 mb-1 block">Tavoli <span className="text-slate-300">(anche più di uno, opzionale)</span></Label>
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                {tables.map(t => {
                  const on = form.tableIds.includes(t.id);
                  return (
                    <button key={t.id} type="button" data-testid={`chip-table-${t.id}`}
                      onClick={() => setForm(f => ({ ...f, tableIds: on ? f.tableIds.filter(x => x !== t.id) : [...f.tableIds, t.id] }))}
                      className={cn("px-3 py-2 rounded-lg text-xs font-semibold border-2",
                        on ? "bg-primary text-white border-primary" : "bg-white border-slate-200 text-slate-600")}>
                      {t.name}
                    </button>
                  );
                })}
              </div>
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
            {dialog.item?.status === "pending" && (
              <Button variant="secondary" onClick={() => save.mutate(true)} disabled={!form.guestName.trim() || save.isPending} data-testid="button-save-confirm">
                Salva e conferma
              </Button>
            )}
            <Button onClick={() => save.mutate(false)} disabled={!form.guestName.trim() || !form.date || !form.time || save.isPending}>
              {save.isPending ? "Salvataggio…" : "Salva"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BackofficeShell>
  );
}
