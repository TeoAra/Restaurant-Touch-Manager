import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useGetTablesStatus,
  getGetTablesStatusQueryKey,
  useGetOrder,
  getGetOrderQueryKey,
  useListCategories,
  useListProducts,
  getListOrdersQueryKey,
  useAddOrderItem,
  useUpdateOrderItem,
  useDeleteOrderItem,
  useCreatePayment,
} from "@workspace/api-client-react";
import type { TableStatus } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Users, Plus, Minus, CreditCard, Banknote, Wallet,
  ShoppingBag, Truck, Clock, Send, FileText, Divide,
  ChevronLeft, ChevronRight, Search, X, UtensilsCrossed, Zap, Map as MapIcon,
  AlertTriangle, CheckCircle2, User, LogOut, Building2, Pencil,
  ArrowRightFromLine, ArrowLeftRight, GitMerge, ReceiptText, Trash2, BadgePercent, StickyNote, Ticket,
  ScrollText, Hash, Euro, RefreshCw, CalendarClock, ArrowRight, BookOpen,
  Loader2, XCircle, Printer,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Link } from "wouter";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

// Grid constants matching back-office planimetria
const CELL = 96;
const COLS = 12;
const ROWS = 8;

// ─── Settings hook ────────────────────────────────────────────────────────────
function useSettings() {
  return useQuery<Record<string, string>>({
    queryKey: ["settings"],
    queryFn: () => fetch(`${API}/settings`).then(r => r.json()),
    staleTime: 30000,
  });
}

// ─── Terminali POS abilitati ─────────────────────────────────────────────────
// Nuove chiavi pos_pax_enabled / pos_mypos_enabled; fallback alla vecchia pos_type.
type PosTerminalId = "pax" | "mypos";
const POS_TERMINAL_LABEL: Record<PosTerminalId, string> = {
  pax: "Nexi PAX D230",
  mypos: "myPOS Go",
};
function enabledPosTerminals(s: Record<string, string>): PosTerminalId[] {
  const legacy = s["pos_type"] ?? "none";
  const pax = s["pos_pax_enabled"] != null ? s["pos_pax_enabled"] === "true" : legacy === "pax";
  const mypos = s["pos_mypos_enabled"] != null ? s["pos_mypos_enabled"] === "true" : legacy === "mypos";
  const out: PosTerminalId[] = [];
  if (pax) out.push("pax");
  if (mypos) out.push("mypos");
  return out;
}

// Selettore terminale (mostrato solo se più di un terminale è abilitato)
function PosTerminalPicker({ terminals, value, onChange, compact }: {
  terminals: PosTerminalId[]; value: PosTerminalId | null;
  onChange: (t: PosTerminalId) => void; compact?: boolean;
}) {
  if (terminals.length < 2) return null;
  return (
    <div>
      <div className={cn("font-semibold text-slate-500 mb-1.5", compact ? "text-[10px]" : "text-xs")}>Terminale POS</div>
      <div className="grid grid-cols-2 gap-1.5">
        {terminals.map(t => (
          <button key={t} type="button" onClick={() => onChange(t)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-lg border-2 font-semibold transition-all active:scale-95",
              compact ? "py-2 text-[11px]" : "py-2.5 text-xs",
              value === t ? "border-primary bg-orange-50 text-primary" : "border-slate-200 text-slate-600 hover:border-slate-300"
            )}>
            <CreditCard className="h-3.5 w-3.5" /> {POS_TERMINAL_LABEL[t]}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Element size helper (matches back-office) ────────────────────────────────
function getElementSize(t: { elementType?: string; shape?: string }) {
  const et = t.elementType ?? "table";
  const sh = t.shape ?? "square";
  if (et === "banco") return { w: 3, h: 1 };
  if (et === "muro") return { w: 2, h: 1 };
  if (et === "pianta") return { w: 1, h: 1 };
  if (sh === "rectangle") return { w: 2, h: 1 };
  return { w: 1, h: 1 };
}

// ─── Floor plan element renderer ─────────────────────────────────────────────
type FETable = TableStatus & { roomName?: string; posX?: number; posY?: number; shape?: string; elementType?: string; rotation?: number; sizeScale?: number; prePrintedAt?: string | null };

type Reservation = {
  id: number; tableId: number | null; tableIds?: string | null; date: string; time: string;
  covers: number; guestName: string; phone?: string | null;
  notes?: string | null; status: string; tableName?: string | null;
};
function parseTableIds(r: Reservation): number[] {
  if (r.tableIds) { try { return JSON.parse(r.tableIds) as number[]; } catch { /**/ } }
  return r.tableId ? [r.tableId] : [];
}

function FloorElement({ t, isSelected, onClick, reservation, assignMode, moveMode }: {
  t: FETable; isSelected: boolean; onClick?: () => void;
  reservation?: Reservation; assignMode?: boolean; moveMode?: boolean;
}) {
  const { w, h } = getElementSize(t);
  const et = t.elementType ?? "table";
  const sh = t.shape ?? "square";
  const isDecor = et !== "table";
  const isRound = sh === "round" && !isDecor;
  const status = t.status as "free" | "occupied" | "reserved";
  const isTargetable = (assignMode || moveMode) && status === "free";

  // Calcolo durata occupazione (per evidenziare tavoli "fermi" da molto)
  let durataMin: number | null = null;
  if (t.activeOrderCreatedAt) {
    const ms = Date.now() - new Date(t.activeOrderCreatedAt).getTime();
    durataMin = Math.max(0, Math.floor(ms / 60000));
  }
  const durataLunga = durataMin !== null && durataMin >= 90; // > 1h30
  const prePrinted = !!t.prePrintedAt;
  // Colore tavolo occupato graduale in base al tempo (verde→giallo→arancione→rosso)
  // Se preconto stampato → blu (cliente in attesa di pagamento)
  let occupiedTone = "bg-orange-50 border-orange-400 hover:border-orange-500";
  let dotTone = "bg-orange-500";
  if (status === "occupied") {
    if (prePrinted) {
      occupiedTone = "bg-sky-50 border-sky-400 hover:border-sky-500";
      dotTone = "bg-sky-500";
    } else if (durataMin !== null) {
      if (durataMin < 30)        { occupiedTone = "bg-emerald-50 border-emerald-400 hover:border-emerald-500"; dotTone = "bg-emerald-500"; }
      else if (durataMin < 60)   { occupiedTone = "bg-yellow-50 border-yellow-400 hover:border-yellow-500";    dotTone = "bg-yellow-500"; }
      else if (durataMin < 90)   { occupiedTone = "bg-orange-50 border-orange-400 hover:border-orange-500";    dotTone = "bg-orange-500"; }
      else                       { occupiedTone = "bg-red-50 border-red-400 hover:border-red-500";              dotTone = "bg-red-500"; }
    }
  }

  const statusBg = isTargetable
    ? "bg-emerald-50 border-emerald-400 hover:border-emerald-600 hover:shadow-md animate-pulse"
    : {
        free:     "bg-white border-slate-300 hover:border-primary hover:shadow-md",
        occupied: occupiedTone,
        reserved: "bg-blue-50 border-blue-400 hover:border-blue-500",
      }[status] ?? "bg-white border-slate-200";

  const statusDot = {
    free:     "bg-emerald-500",
    occupied: dotTone,
    reserved: "bg-blue-500",
  }[status] ?? "bg-slate-400";

  const decorStyle = et === "banco" ? "bg-slate-700 border-slate-600 text-white cursor-default"
    : et === "pianta" ? "bg-emerald-100 border-emerald-400 text-emerald-800 cursor-default"
    : et === "muro"   ? "bg-slate-300 border-slate-400 text-slate-600 cursor-default"
    : "";

  const decorLabel = et === "banco" ? "BANCO"
    : et === "pianta" ? "🌿"
    : et === "muro"   ? "░░"
    : "";

  const accentStrip = isTargetable ? "bg-emerald-400"
    : status === "free" ? "bg-emerald-500"
    : status === "occupied" ? dotTone
    : "bg-blue-500";

  return (
    <button
      disabled={isDecor || ((assignMode || moveMode) && !isTargetable)}
      onClick={isDecor ? undefined : onClick}
      title={
        status === "occupied"
          ? prePrinted ? "Preconto stampato — in attesa di pagamento"
            : durataMin !== null ? `Tavolo occupato da ${durataMin} min` : "Tavolo occupato"
          : undefined
      }
      className={cn(
        "absolute border-2 select-none transition-all active:scale-95 shadow-sm overflow-hidden",
        isDecor ? cn(decorStyle, "flex items-center justify-center") : cn(statusBg),
        isRound ? "rounded-full" : "rounded-xl",
        isSelected && !isDecor ? "ring-4 ring-primary ring-offset-2 shadow-xl scale-105 z-10" : "",
        !isDecor && !assignMode && !moveMode && "cursor-pointer",
        isTargetable && "cursor-pointer",
        (assignMode || moveMode) && !isTargetable && !isDecor && "opacity-40",
        durataLunga && status === "occupied" && !prePrinted && "ring-2 ring-red-400",
        prePrinted && status === "occupied" && "ring-2 ring-sky-400 animate-pulse",
      )}
      style={{ width: w * CELL - 8, height: h * CELL - 8, transform: [t.rotation ? `rotate(${t.rotation}deg)` : "", (t.sizeScale && t.sizeScale !== 1) ? `scale(${t.sizeScale})` : ""].filter(Boolean).join(" ") || undefined }}
    >
      {isDecor ? (
        <span className={cn("text-sm font-bold tracking-widest", et === "pianta" && "text-2xl")}>{decorLabel}</span>
      ) : (
        /* inset-0 garantisce che il div riempia esattamente il button
           indipendentemente da rotazione / sizeScale */
        <div className="absolute inset-0 flex flex-col items-center justify-between p-1.5">
          {/* Striscia colorata status in cima */}
          {!isRound && <div className={cn("absolute top-0 left-0 right-0 h-[3px]", accentStrip)} />}

          {/* Top: status dot + posti */}
          <div className={cn("flex items-center justify-between w-full px-0.5", !isRound && "mt-[2px]")}>
            <div className={cn("h-2 w-2 rounded-full shrink-0 ring-[1.5px] ring-white shadow-sm", statusDot)} />
            <span className="text-[10px] text-slate-400 flex items-center gap-0.5 font-medium">
              <Users className="h-2.5 w-2.5" />{t.seats}
            </span>
          </div>

          {/* Centro: nome tavolo */}
          <div className="flex-1 flex items-center justify-center w-full min-h-0 overflow-hidden">
            <span className={cn(
              "font-extrabold text-slate-800 text-center leading-none truncate w-full px-0.5",
              t.name && t.name.length <= 3 ? "text-2xl" : t.name && t.name.length <= 5 ? "text-lg" : "text-sm",
            )}>{t.name}</span>
          </div>

          {/* Bottom: totale / prenotazione / libero */}
          {t.activeOrderTotal ? (
            <div className="w-full flex flex-col items-center gap-0.5">
              <span className="text-[13px] font-extrabold text-primary leading-none">€{t.activeOrderTotal}</span>
              {durataMin !== null && (
                <span className={cn(
                  "text-[9px] px-1.5 py-0.5 rounded-full font-bold leading-none flex items-center gap-0.5",
                  durataLunga ? "bg-red-100 text-red-600" : durataMin >= 60 ? "bg-orange-100 text-orange-600" : "bg-slate-100 text-slate-500",
                )}>
                  <Clock className="h-2 w-2" />
                  {durataMin < 60 ? `${durataMin}'` : `${Math.floor(durataMin / 60)}h${(durataMin % 60).toString().padStart(2, "0")}`}
                </span>
              )}
            </div>
          ) : reservation ? (
            <div className="w-full flex flex-col items-center gap-0.5 px-0.5">
              <span className="text-[10px] font-bold text-blue-700 truncate w-full text-center leading-none">
                {reservation.guestName.length > 10 ? reservation.guestName.slice(0, 9) + "…" : reservation.guestName}
              </span>
              <span className="text-[10px] text-blue-500 flex items-center gap-0.5 leading-none font-semibold">
                <CalendarClock className="h-2.5 w-2.5" />{reservation.time.slice(0, 5)}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <div className={cn("h-1.5 w-1.5 rounded-full", isTargetable ? "bg-emerald-400 animate-pulse" : "bg-emerald-500")} />
              <span className="text-[9px] text-emerald-600 font-bold uppercase tracking-wide">Libero</span>
            </div>
          )}
        </div>
      )}
    </button>
  );
}

// ─── Table Actions Dialog (sposta / unisci / sposta articoli) ────────────────
function TableActionsDialog({ open, onClose, order, items, tablesStatus, onDone }: {
  open: boolean; onClose: () => void;
  order: { id: number; tableId: number | null; tableName?: string | null } | null;
  items: Array<{ id: number; productName: string; quantity: number; subtotal: string }>;
  tablesStatus: FETable[];
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"menu" | "move" | "merge" | "moveItems">("menu");
  const [targetTableId, setTargetTableId] = useState<number | null>(null);
  const [targetOrderId, setTargetOrderId] = useState<number | null>(null);
  const [selectedItems, setSelectedItems] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) { setMode("menu"); setTargetTableId(null); setTargetOrderId(null); setSelectedItems([]); }
  }, [open]);

  if (!order) return null;

  const freeTables = tablesStatus.filter(t => (t.elementType ?? "table") === "table" && t.status === "free" && t.id !== order.tableId);
  const occupiedTables = tablesStatus.filter(t => (t.elementType ?? "table") === "table" && t.status === "occupied" && t.id !== order.tableId && t.activeOrderId);

  async function doMove() {
    if (!targetTableId) return;
    setBusy(true);
    try {
      const r = await fetch(`${API}/orders/${order!.id}/move-table`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId: targetTableId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Errore spostamento");
      toast({ title: "Tavolo spostato", description: `Ordine spostato sul nuovo tavolo` });
      onDone(); onClose();
    } catch (e) {
      toast({ title: "Spostamento fallito", description: String(e instanceof Error ? e.message : e), variant: "destructive" });
    } finally { setBusy(false); }
  }

  async function doMerge() {
    if (!targetOrderId) return;
    setBusy(true);
    try {
      // L'ordine corrente diventa il "destinatario"; il sourceOrderId è l'altro
      // ma per coerenza UI: il cameriere sceglie il tavolo SU CUI portare gli articoli.
      // Quindi qui l'ordine target dell'utente diventa il :id e il corrente è il source.
      const r = await fetch(`${API}/orders/${targetOrderId}/merge`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceOrderId: order!.id }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Errore unione");
      toast({ title: "Tavoli uniti", description: `Articoli spostati. Nuovo totale € ${data.newTotal}` });
      onDone(); onClose();
    } catch (e) {
      toast({ title: "Unione fallita", description: String(e instanceof Error ? e.message : e), variant: "destructive" });
    } finally { setBusy(false); }
  }

  async function doMoveItems() {
    if (!targetOrderId || selectedItems.length === 0) return;
    setBusy(true);
    try {
      const r = await fetch(`${API}/orders/${order!.id}/items/move`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toOrderId: targetOrderId, itemIds: selectedItems }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Errore spostamento articoli");
      toast({ title: "Articoli spostati", description: `${data.movedCount} articoli (€ ${data.movedAmount}) spostati` });
      onDone(); onClose();
    } catch (e) {
      toast({ title: "Spostamento fallito", description: String(e instanceof Error ? e.message : e), variant: "destructive" });
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5 text-primary" />
            {mode === "menu" && "Operazioni tavolo"}
            {mode === "move" && "Sposta su altro tavolo"}
            {mode === "merge" && "Unisci con altro tavolo"}
            {mode === "moveItems" && "Sposta articoli"}
          </DialogTitle>
        </DialogHeader>

        {mode === "menu" && (
          <div className="space-y-2 py-2">
            <button onClick={() => setMode("move")}
              className="w-full flex items-center gap-3 p-4 bg-white rounded-xl border-2 border-slate-200 hover:border-primary hover:bg-orange-50 transition-all text-left">
              <ArrowRightFromLine className="h-6 w-6 text-primary shrink-0" />
              <div>
                <div className="font-bold text-sm text-slate-800">Sposta tavolo</div>
                <div className="text-xs text-slate-500">L'intero ordine va su un tavolo libero</div>
              </div>
            </button>
            <button onClick={() => setMode("merge")} disabled={occupiedTables.length === 0}
              className="w-full flex items-center gap-3 p-4 bg-white rounded-xl border-2 border-slate-200 hover:border-primary hover:bg-orange-50 transition-all text-left disabled:opacity-40 disabled:cursor-not-allowed">
              <GitMerge className="h-6 w-6 text-primary shrink-0" />
              <div>
                <div className="font-bold text-sm text-slate-800">Unisci con altro tavolo</div>
                <div className="text-xs text-slate-500">Sposta tutto l'ordine su un tavolo già occupato</div>
              </div>
            </button>
            <button onClick={() => setMode("moveItems")} disabled={items.length === 0 || occupiedTables.length === 0}
              className="w-full flex items-center gap-3 p-4 bg-white rounded-xl border-2 border-slate-200 hover:border-primary hover:bg-orange-50 transition-all text-left disabled:opacity-40 disabled:cursor-not-allowed">
              <ArrowLeftRight className="h-6 w-6 text-primary shrink-0" />
              <div>
                <div className="font-bold text-sm text-slate-800">Sposta articoli</div>
                <div className="text-xs text-slate-500">Sposta singoli articoli su un altro conto aperto</div>
              </div>
            </button>
          </div>
        )}

        {mode === "move" && (
          <div className="space-y-2 py-1">
            <div className="text-xs text-slate-500 mb-2">Seleziona un tavolo libero:</div>
            <ScrollArea className="max-h-72">
              <div className="grid grid-cols-3 gap-2 pr-2">
                {freeTables.length === 0 ? (
                  <div className="col-span-3 text-center text-sm text-slate-400 py-6">Nessun tavolo libero disponibile</div>
                ) : freeTables.map(t => (
                  <button key={t.id} onClick={() => setTargetTableId(t.id)}
                    className={cn("p-3 rounded-xl border-2 transition-all flex flex-col items-center gap-1",
                      targetTableId === t.id ? "border-primary bg-orange-50 ring-2 ring-primary/30" : "border-slate-200 hover:border-slate-400")}>
                    <span className="font-bold text-base text-slate-800">{t.name}</span>
                    <span className="text-[10px] text-slate-500 flex items-center gap-1"><Users className="h-2.5 w-2.5" />{t.seats}</span>
                    {t.roomName && <span className="text-[9px] text-slate-400 truncate w-full text-center">{t.roomName}</span>}
                  </button>
                ))}
              </div>
            </ScrollArea>
            <DialogFooter className="gap-2 pt-3">
              <Button variant="outline" onClick={() => setMode("menu")}>Indietro</Button>
              <Button onClick={doMove} disabled={!targetTableId || busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sposta tavolo"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {mode === "merge" && (
          <div className="space-y-2 py-1">
            <div className="text-xs text-slate-500 mb-2">Tutti gli articoli verranno spostati sull'ordine selezionato:</div>
            <ScrollArea className="max-h-72">
              <div className="space-y-1 pr-2">
                {occupiedTables.length === 0 ? (
                  <div className="text-center text-sm text-slate-400 py-6">Nessun altro tavolo occupato</div>
                ) : occupiedTables.map(t => (
                  <button key={t.id} onClick={() => setTargetOrderId(t.activeOrderId ?? null)}
                    className={cn("w-full flex items-center justify-between p-3 rounded-xl border-2 transition-all",
                      targetOrderId === t.activeOrderId ? "border-primary bg-orange-50 ring-2 ring-primary/30" : "border-slate-200 hover:border-slate-400")}>
                    <div className="flex items-center gap-2">
                      <div className="h-9 w-9 rounded-lg bg-orange-100 flex items-center justify-center font-bold text-sm text-primary">{t.name}</div>
                      <div className="text-left">
                        <div className="text-xs font-semibold text-slate-700">{t.roomName ?? "Sala"}</div>
                        <div className="text-[10px] text-slate-400">Ordine #{t.activeOrderId}</div>
                      </div>
                    </div>
                    {t.activeOrderTotal && <span className="text-sm font-bold text-primary">€ {t.activeOrderTotal}</span>}
                  </button>
                ))}
              </div>
            </ScrollArea>
            <DialogFooter className="gap-2 pt-3">
              <Button variant="outline" onClick={() => setMode("menu")}>Indietro</Button>
              <Button onClick={doMerge} disabled={!targetOrderId || busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Unisci tavoli"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {mode === "moveItems" && (
          <div className="space-y-3 py-1">
            <div>
              <div className="text-xs text-slate-500 mb-1.5">1. Seleziona articoli da spostare:</div>
              <ScrollArea className="max-h-40 border rounded-lg">
                <div className="p-1">
                  {items.map(it => {
                    const checked = selectedItems.includes(it.id);
                    return (
                      <button key={it.id}
                        onClick={() => setSelectedItems(prev => prev.includes(it.id) ? prev.filter(x => x !== it.id) : [...prev, it.id])}
                        className={cn("w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm transition-colors",
                          checked ? "bg-orange-50 text-primary font-semibold" : "hover:bg-slate-50")}>
                        <div className={cn("h-4 w-4 rounded border-2 flex items-center justify-center shrink-0",
                          checked ? "bg-primary border-primary" : "border-slate-300")}>
                          {checked && <CheckCircle2 className="h-3 w-3 text-white" />}
                        </div>
                        <span className="flex-1 truncate">{it.quantity}× {it.productName}</span>
                        <span className="text-xs text-slate-500">€ {it.subtotal}</span>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-1.5">2. Seleziona ordine destinazione:</div>
              <ScrollArea className="max-h-40 border rounded-lg">
                <div className="p-1 space-y-1">
                  {occupiedTables.map(t => (
                    <button key={t.id} onClick={() => setTargetOrderId(t.activeOrderId ?? null)}
                      className={cn("w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm transition-colors",
                        targetOrderId === t.activeOrderId ? "bg-orange-50 text-primary font-semibold" : "hover:bg-slate-50")}>
                      <span className="h-7 w-7 rounded bg-orange-100 flex items-center justify-center text-xs font-bold">{t.name}</span>
                      <span className="flex-1">{t.roomName ?? "—"}</span>
                      {t.activeOrderTotal && <span className="text-xs text-slate-500">€ {t.activeOrderTotal}</span>}
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </div>
            <DialogFooter className="gap-2 pt-1">
              <Button variant="outline" onClick={() => setMode("menu")}>Indietro</Button>
              <Button onClick={doMoveItems} disabled={!targetOrderId || selectedItems.length === 0 || busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : `Sposta ${selectedItems.length} articol${selectedItems.length === 1 ? "o" : "i"}`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Table Map Modal ──────────────────────────────────────────────────────────
function TableMapPanel({ tablesStatus, selectedTableId, onTableClick, onBack }: {
  tablesStatus: FETable[];
  selectedTableId: number | null;
  onTableClick: (t: FETable) => void;
  onBack: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  // ── Reservations + date nav ───────────────────────────────────────────────
  const todayStr = new Date().toISOString().split("T")[0];
  const [mapDate, setMapDate] = useState(todayStr);
  const { data: reservations = [], refetch: refetchReservations } = useQuery<Reservation[]>({
    queryKey: ["reservations-map", mapDate],
    queryFn: () => fetch(`${API}/reservations?date=${mapDate}`).then(r => r.json()),
    refetchInterval: 60000,
  });

  const reservationByTableId = useMemo(() => {
    const m = new Map<number, Reservation>();
    for (const r of reservations) {
      for (const tid of parseTableIds(r)) m.set(tid, r);
    }
    return m;
  }, [reservations]);
  const unassigned = useMemo(
    () => reservations.filter(r => parseTableIds(r).length === 0 && r.status !== "cancelled").sort((a, b) => a.time.localeCompare(b.time)),
    [reservations]
  );
  const reservedCount = reservations.filter(r => r.status !== "cancelled").length;

  // ── New reservation form state ─────────────────────────────────────────────
  const [showNewRes, setShowNewRes] = useState(false);
  const [resForm, setResForm] = useState({ guestName: "", phone: "", time: "20:00", covers: 2, date: todayStr });
  const [resTableIds, setResTableIds] = useState<number[]>([]);
  const [resSaving, setResSaving] = useState(false);

  function toggleResTable(id: number) {
    setResTableIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function submitReservation() {
    if (!resForm.guestName.trim()) return;
    setResSaving(true);
    try {
      await fetch(`${API}/reservations`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guestName: resForm.guestName.trim(),
          phone: resForm.phone.trim() || null,
          time: resForm.time,
          covers: resForm.covers,
          tableIds: resTableIds,
          date: resForm.date || mapDate,
          status: "confirmed",
        }),
      });
      await refetchReservations();
      setShowNewRes(false);
      setResForm({ guestName: "", phone: "", time: "20:00", covers: 2, date: mapDate });
      setResTableIds([]);
    } finally { setResSaving(false); }
  }

  // ── Assign / Move mode ────────────────────────────────────────────────────
  const [assigningRes, setAssigningRes] = useState<Reservation | null>(null);
  const [movingRes, setMovingRes] = useState<Reservation | null>(null);
  const [reservationPopup, setReservationPopup] = useState<{ table: FETable; res: Reservation } | null>(null);
  const isActionMode = !!(assigningRes || movingRes);
  const actionRes = assigningRes ?? movingRes;

  async function applyTableToReservation(res: Reservation, tableId: number) {
    await fetch(`${API}/reservations/${res.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tableId }),
    });
    await refetchReservations();
    setAssigningRes(null);
    setMovingRes(null);
  }

  // ── Scale ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    function updateScale() {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      setContainerSize({ w, h });
      const allElements = tablesStatus;
      const minX = allElements.length ? Math.min(...allElements.map(t => t.posX ?? 0)) : 0;
      const minY = allElements.length ? Math.min(...allElements.map(t => t.posY ?? 0)) : 0;
      const maxX = allElements.length
        ? Math.max(...allElements.map(t => (t.posX ?? 0) - minX + getElementSize(t).w)) + 1
        : 6;
      const maxY = allElements.length
        ? Math.max(...allElements.map(t => (t.posY ?? 0) - minY + getElementSize(t).h)) + 1
        : 5;
      const canvasW = Math.max(maxX, 4) * CELL;
      const canvasH = Math.max(maxY, 3) * CELL;
      // Scala in modo che la mappa stia nel container, MA mai oltre la
      // dimensione naturale (max 1.0): con pochi tavoli evitiamo l'effetto
      // "tavolo gigante a tutto schermo". Se la mappa è più grande del
      // container, lasciamo scalare giù (overflow-auto gestisce lo scroll
      // se la cella diventa troppo piccola).
      const fitScale = Math.min(w / canvasW, h / canvasH);
      setScale(Math.min(fitScale, 1));
    }
    updateScale();
    const ro = new ResizeObserver(updateScale);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [tablesStatus.length]);

  const rooms = Array.from(new Map(
    tablesStatus.filter(t => t.roomName).map(t => [t.roomName!, t.roomName!])
  ).values());
  const [roomFilter, setRoomFilter] = useState<string | null>(() => rooms[0] ?? null);
  useEffect(() => {
    if (roomFilter === null && rooms.length > 0) setRoomFilter(rooms[0]);
  }, [rooms.join(",")]);

  const filtered = tablesStatus.filter(t => roomFilter === null || t.roomName === roomFilter);
  const freeCount = filtered.filter(t => t.elementType !== "table" ? false : t.status === "free").length;
  const occupiedCount = filtered.filter(t => t.elementType !== "table" ? false : t.status === "occupied").length;

  function handleMapClick(t: FETable) {
    if (isActionMode) {
      const isFutureDate = mapDate !== todayStr;
      if (t.elementType === "table" && (t.status === "free" || isFutureDate)) {
        applyTableToReservation(actionRes!, t.id);
      }
      return;
    }
    const res = reservationByTableId.get(t.id);
    if (res && !t.activeOrderId) {
      setReservationPopup({ table: t, res });
      return;
    }
    onTableClick(t);
  }

  return (
    <div className="relative flex flex-col h-full">
      {/* Panel header */}
      <div className="px-3 py-2 bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={onBack}
              className="h-9 w-9 rounded-lg border-2 border-slate-200 flex items-center justify-center hover:border-primary hover:text-primary transition-colors">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <MapIcon className="h-4 w-4 text-primary" />
                <span className="font-bold text-slate-800 text-sm">Mappa Tavoli</span>
              </div>
              {roomFilter && (
                <span className="text-xs text-primary font-semibold ml-6">{roomFilter}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            <div className="flex items-center gap-2 text-xs">
              <span className="flex items-center gap-1 text-emerald-600 font-semibold">
                <div className="h-2 w-2 rounded-full bg-emerald-500" /> {freeCount}
              </span>
              <span className="flex items-center gap-1 text-orange-500 font-semibold">
                <div className="h-2 w-2 rounded-full bg-orange-500" /> {occupiedCount}
              </span>
              {reservedCount > 0 && (
                <span className="flex items-center gap-1 text-blue-600 font-semibold">
                  <CalendarClock className="h-3 w-3" /> {reservedCount}
                </span>
              )}
            </div>
            <button onClick={() => { setShowNewRes(true); setResForm({ guestName: "", phone: "", time: "20:00", covers: 2, date: mapDate }); setResTableIds([]); }}
              className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white rounded-xl text-xs font-bold hover:bg-primary/90 active:scale-95 transition-all shrink-0">
              <CalendarClock className="h-3.5 w-3.5" /> Prenota
            </button>
          </div>
        </div>
        {rooms.length > 1 && (
          <div className="flex gap-1.5 mt-1.5 overflow-x-auto pb-0.5">
            {rooms.map(r => (
              <button key={r} onClick={() => setRoomFilter(r)}
                className={cn("px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all",
                  roomFilter === r ? "bg-primary text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>
                {r}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Assign / Move mode banner */}
      {isActionMode && (
        <div className="px-4 py-3 bg-emerald-50 border-b-2 border-emerald-400 shrink-0 flex items-center gap-3">
          <CalendarClock className="h-5 w-5 text-emerald-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-emerald-700">
              {assigningRes ? "Assegna prenotazione" : "Sposta prenotazione"}
            </div>
            <div className="text-[11px] text-emerald-600 truncate">
              {actionRes!.guestName} · {actionRes!.time.slice(0, 5)} · {actionRes!.covers} cop. — tocca un tavolo libero (lampeggiante)
            </div>
          </div>
          <button onClick={() => { setAssigningRes(null); setMovingRes(null); }}
            className="h-8 w-8 rounded-lg bg-emerald-100 flex items-center justify-center hover:bg-emerald-200 shrink-0">
            <X className="h-4 w-4 text-emerald-700" />
          </button>
        </div>
      )}

      {/* Unassigned reservations strip */}
      {!isActionMode && unassigned.length > 0 && (
        <div className="px-3 py-2 bg-blue-50 border-b border-blue-200 shrink-0">
          <div className="text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-1.5 flex items-center gap-1">
            <BookOpen className="h-3 w-3" /> {unassigned.length} prenotazione/i senza tavolo
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {unassigned.map(r => (
              <div key={r.id} className="shrink-0 bg-white border-2 border-blue-300 rounded-xl px-3 py-2 flex items-center gap-2 shadow-sm min-w-[160px]">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-slate-800 truncate">{r.guestName}</div>
                  <div className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                    <CalendarClock className="h-2.5 w-2.5" /> {r.time.slice(0, 5)} · {r.covers} cop.
                  </div>
                </div>
                <button onClick={() => setAssigningRes(r)}
                  className="shrink-0 px-2 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-[10px] font-bold transition-all active:scale-95 flex items-center gap-1">
                  <ArrowRight className="h-3 w-3" /> Assegna
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Floor plan */}
      <div ref={containerRef} className="flex-1 overflow-auto bg-[#f4f6fa] relative">
        {(() => {
          const allEl = filtered;
          const minX = allEl.length ? Math.min(...allEl.map(t => t.posX ?? 0)) : 0;
          const minY = allEl.length ? Math.min(...allEl.map(t => t.posY ?? 0)) : 0;
          // Grid always fills the full container — extend cols/rows beyond table extents
          const gridCols = scale > 0 ? Math.ceil(containerSize.w / (CELL * scale)) + 1 : 8;
          const gridRows = scale > 0 ? Math.ceil(containerSize.h / (CELL * scale)) + 1 : 6;
          const fullCanvasW = gridCols * CELL;
          const fullCanvasH = gridRows * CELL;
          return (
            <div
              className="bg-[#f8fafc] overflow-hidden w-full h-full"
            >
              <div
                className="relative select-none origin-top-left"
                style={{ width: fullCanvasW, height: fullCanvasH, transform: `scale(${scale})` }}
              >
                {Array.from({ length: gridRows + 1 }).map((_, i) => (
                  <div key={`h${i}`} className="absolute left-0 right-0 border-b border-slate-200/60" style={{ top: i * CELL }} />
                ))}
                {Array.from({ length: gridCols + 1 }).map((_, i) => (
                  <div key={`v${i}`} className="absolute top-0 bottom-0 border-r border-slate-200/60" style={{ left: i * CELL }} />
                ))}
                {filtered.map(t => (
                  <div key={t.id} className="absolute" style={{ left: ((t.posX ?? 0) - minX) * CELL + 3, top: ((t.posY ?? 0) - minY) * CELL + 3 }}>
                    <FloorElement
                      t={t}
                      isSelected={t.id === selectedTableId}
                      onClick={() => handleMapClick(t)}
                      reservation={reservationByTableId.get(t.id)}
                      assignMode={!!assigningRes}
                      moveMode={!!movingRes}
                    />
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Reservation popup (reserved table with no order) */}
      {reservationPopup && (
        <div className="absolute inset-0 bg-black/30 flex items-center justify-center z-50 p-4"
          onClick={() => setReservationPopup(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <div className="h-12 w-12 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
                <CalendarClock className="h-6 w-6 text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-slate-800 text-base">{reservationPopup.res.guestName}</div>
                <div className="text-sm text-slate-500 flex items-center gap-3 mt-0.5 flex-wrap">
                  <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{reservationPopup.res.time.slice(0, 5)}</span>
                  <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{reservationPopup.res.covers} coperti</span>
                </div>
                {reservationPopup.res.phone && (
                  <div className="text-xs text-slate-400 mt-0.5">{reservationPopup.res.phone}</div>
                )}
                {reservationPopup.res.notes && (
                  <div className="text-xs italic text-amber-600 mt-1 bg-amber-50 rounded-lg px-2 py-1">{reservationPopup.res.notes}</div>
                )}
                <div className="text-xs text-blue-600 font-semibold mt-1.5">
                  Tavolo: {reservationPopup.table.name}
                </div>
              </div>
              <button onClick={() => setReservationPopup(null)}
                className="h-8 w-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-slate-200 shrink-0">
                <X className="h-4 w-4 text-slate-500" />
              </button>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => { setReservationPopup(null); onTableClick(reservationPopup.table); }}
                className="w-full py-3 bg-primary text-white rounded-xl font-semibold text-sm hover:bg-primary/90 active:scale-95 transition-all flex items-center justify-center gap-2">
                <Send className="h-4 w-4" /> Avvia ordine
              </button>
              <button
                onClick={() => { setMovingRes(reservationPopup.res); setReservationPopup(null); }}
                className="w-full py-3 bg-blue-50 text-blue-700 border-2 border-blue-200 rounded-xl font-semibold text-sm hover:bg-blue-100 active:scale-95 transition-all flex items-center justify-center gap-2">
                <ArrowRight className="h-4 w-4" /> Sposta a un altro tavolo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Nuova prenotazione dialog ─────────────────────────────── */}
      {showNewRes && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setShowNewRes(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="px-5 py-4 bg-primary flex items-center justify-between">
              <div className="flex items-center gap-2 text-white">
                <CalendarClock className="h-5 w-5" />
                <span className="font-bold text-base">Nuova Prenotazione</span>
              </div>
              <button onClick={() => setShowNewRes(false)}
                className="h-8 w-8 rounded-lg bg-white/20 flex items-center justify-center hover:bg-white/30">
                <X className="h-4 w-4 text-white" />
              </button>
            </div>
            {/* Form */}
            <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
              {/* Nome */}
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 block">Nome ospite *</label>
                <input
                  type="text" placeholder="Es. Rossi Mario"
                  value={resForm.guestName}
                  onChange={e => setResForm(f => ({ ...f, guestName: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border-2 border-slate-200 focus:border-primary outline-none text-sm font-semibold"
                  autoFocus
                />
              </div>
              {/* Data */}
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 block">Data prenotazione</label>
                <input
                  type="date" value={resForm.date}
                  onChange={e => setResForm(f => ({ ...f, date: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border-2 border-slate-200 focus:border-primary outline-none text-sm font-semibold text-slate-800 bg-white"
                />
              </div>
              {/* Telefono + Ora */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-semibold text-slate-600 mb-1 block">Telefono</label>
                  <input
                    type="tel" placeholder="333 1234567"
                    value={resForm.phone}
                    onChange={e => setResForm(f => ({ ...f, phone: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl border-2 border-slate-200 focus:border-primary outline-none text-sm text-slate-800 bg-white"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 mb-1 block">Orario</label>
                  <input
                    type="time" value={resForm.time}
                    onChange={e => setResForm(f => ({ ...f, time: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl border-2 border-slate-200 focus:border-primary outline-none text-sm font-semibold text-slate-800 bg-white"
                  />
                </div>
              </div>
              {/* Coperti */}
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 block">Coperti</label>
                <div className="flex items-center gap-2">
                  <button onClick={() => setResForm(f => ({ ...f, covers: Math.max(1, f.covers - 1) }))}
                    className="h-9 w-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-700 font-bold text-lg shrink-0">−</button>
                  <span className="flex-1 text-center text-xl font-bold text-slate-800">{resForm.covers}</span>
                  <button onClick={() => setResForm(f => ({ ...f, covers: f.covers + 1 }))}
                    className="h-9 w-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-700 font-bold text-lg shrink-0">+</button>
                </div>
              </div>
              {/* Selezione tavoli */}
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1.5 block">
                  Tavoli {resTableIds.length > 0 && <span className="text-primary">({resTableIds.length} selezionati)</span>}
                </label>
                <div className="flex flex-wrap gap-2">
                  {tablesStatus
                    .filter(t => t.elementType !== "wall" && t.elementType !== "bar" && t.elementType !== "sofa")
                    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "it", { numeric: true }))
                    .map(t => {
                      const isSelected = resTableIds.includes(t.id);
                      const isOccupiedToday = t.status === "occupied" && (resForm.date === todayStr || !resForm.date);
                      const hasRes = reservationByTableId.has(t.id);
                      return (
                        <button key={t.id}
                          onClick={() => toggleResTable(t.id)}
                          className={cn(
                            "px-3 py-2 rounded-xl text-xs font-bold border-2 transition-all active:scale-95",
                            isSelected
                              ? "bg-primary border-primary text-white shadow-sm"
                              : isOccupiedToday
                                ? "bg-orange-50 border-orange-200 text-orange-700 hover:border-orange-400"
                                : hasRes
                                  ? "bg-blue-50 border-blue-300 text-blue-700 hover:border-blue-400"
                                  : "bg-slate-50 border-slate-200 text-slate-700 hover:border-primary hover:text-primary"
                          )}>
                          {t.name}
                          {isOccupiedToday && !isSelected && <span className="ml-1 text-[9px] opacity-70">occ</span>}
                          {hasRes && !isOccupiedToday && <span className="ml-1 text-[9px] text-blue-500">res</span>}
                        </button>
                      );
                    })}
                </div>
              </div>
            </div>
            {/* Footer */}
            <div className="px-5 py-4 border-t border-slate-100 flex gap-2">
              <button onClick={() => setShowNewRes(false)}
                className="flex-1 py-3 rounded-xl border-2 border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-all">
                Annulla
              </button>
              <button onClick={submitReservation} disabled={!resForm.guestName.trim() || resSaving}
                className="flex-1 py-3 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {resSaving ? <div className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" /> : <CalendarClock className="h-4 w-4" />}
                Conferma
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── User Menu Button ─────────────────────────────────────────────────────────
function UserMenuButton({ showUserMenu, setShowUserMenu }: {
  showUserMenu: boolean;
  setShowUserMenu: (v: boolean) => void;
}) {
  const { user, logout } = useAuth();
  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

  return (
    <div className="relative">
      <button
        onClick={() => setShowUserMenu(!showUserMenu)}
        className={cn(
          "h-9 w-9 rounded-xl border-2 flex items-center justify-center transition-all",
          showUserMenu
            ? "border-primary bg-primary/10 text-primary"
            : "border-slate-200 bg-white text-slate-500 hover:border-primary hover:text-primary"
        )}
        title={user?.name}
      >
        <User className="h-4 w-4" />
      </button>

      {showUserMenu && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
          {/* Dropdown */}
          <div className="absolute right-0 top-11 z-50 w-52 bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
            {/* User info */}
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                  <User className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-slate-800 text-sm truncate">{user?.name}</div>
                  <div className="text-xs text-slate-400">
                    {user?.role === "admin" ? "Amministratore" : "Cassiere"}
                  </div>
                </div>
              </div>
            </div>
            {/* Actions */}
            <div className="p-1.5">
              {user?.role === "admin" && (
                <Link href={`${BASE}/backoffice`}>
                  <button
                    onClick={() => setShowUserMenu(false)}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-700 hover:bg-primary/10 hover:text-primary transition-colors"
                  >
                    <Building2 className="h-4 w-4" />
                    Back Office
                  </button>
                </Link>
              )}
              <button
                onClick={() => { setShowUserMenu(false); logout(); }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Esci
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Payment Dialog ───────────────────────────────────────────────────────────
type SimpleCustomer = { id: number; ragioneSociale: string; partitaIva: string | null; codiceFiscale: string | null; sdiCode: string | null; pec: string | null; indirizzoVia: string | null; indirizzoCap: string | null; indirizzoComune: string | null; indirizzoProvince: string | null };

function CustomerCard({ c, selected, onSelect }: { c: SimpleCustomer; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full text-left px-4 py-3 rounded-xl border-2 transition-all active:scale-95",
        selected
          ? "border-emerald-600 bg-emerald-900/40"
          : "border-[#2d3044] bg-[#22263a] hover:border-primary/40",
      )}>
      <div className="font-semibold text-slate-200 text-sm">{c.ragioneSociale}</div>
      <div className="flex gap-3 mt-0.5">
        {c.partitaIva && <span className="text-[10px] text-slate-500 font-mono">P.IVA {c.partitaIva}</span>}
        {c.codiceFiscale && <span className="text-[10px] text-slate-500 font-mono">CF {c.codiceFiscale}</span>}
      </div>
    </button>
  );
}

// ─── New-customer mini-form (inside PaymentDialog) ────────────────────────────
type ViesStatus = "idle" | "loading" | "ok" | "error";

function NewCustomerForm({ onCreated, onCancel }: {
  onCreated: (c: SimpleCustomer) => void;
  onCancel: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [tipo, setTipo] = useState<"azienda" | "privato">("azienda");
  const [ragioneSociale, setRagioneSociale] = useState("");
  const [partitaIva, setPartitaIva] = useState("");
  const [codiceFiscale, setCodiceFiscale] = useState("");
  const [sdiCode, setSdiCode] = useState("");
  const [pec, setPec] = useState("");
  const [via, setVia] = useState("");
  const [cap, setCap] = useState("");
  const [comune, setComune] = useState("");
  const [provincia, setProvincia] = useState("");
  const [viesStatus, setViesStatus] = useState<ViesStatus>("idle");
  const [viesMsg, setViesMsg] = useState("");
  const { toast } = useToast();

  async function verificaPiva() {
    const piva = partitaIva.trim().replace(/\s/g, "");
    if (!piva) return toast({ title: "Inserisci la P.IVA prima di verificare", variant: "destructive" });
    setViesStatus("loading"); setViesMsg("");
    try {
      const vatParam = piva.toUpperCase().startsWith("IT") ? piva : `IT${piva}`;
      const resp = await fetch(`${API}/vies?vat=${encodeURIComponent(vatParam)}`);
      const data = await resp.json() as {
        valid?: boolean; source?: string; message?: string; error?: string;
        name?: string; parsed?: { indirizzo: string; cap: string; comune: string; provincia: string };
      };
      if (!resp.ok || data.error) { setViesStatus("error"); setViesMsg(data.error ?? "Errore nella verifica"); return; }
      if (!data.valid) { setViesStatus("error"); setViesMsg(data.message ?? "P.IVA non valida"); return; }
      setViesStatus("ok");
      if (data.source === "local") {
        setViesMsg("P.IVA valida ✓ — non iscritta al VIES (compila manualmente i dati)");
      } else {
        setViesMsg("P.IVA verificata VIES ✓");
        if (data.name && data.name !== "---") setRagioneSociale(data.name);
        if (data.parsed) {
          if (data.parsed.indirizzo) setVia(data.parsed.indirizzo);
          if (data.parsed.cap) setCap(data.parsed.cap);
          if (data.parsed.comune) setComune(data.parsed.comune);
          if (data.parsed.provincia) setProvincia(data.parsed.provincia);
        }
      }
    } catch { setViesStatus("error"); setViesMsg("Errore di rete"); }
    return;
  }

  async function save() {
    if (!ragioneSociale.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/customers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo,
          ragioneSociale: ragioneSociale.trim(),
          partitaIva: partitaIva.trim() || null,
          codiceFiscale: codiceFiscale.trim() || null,
          sdiCode: sdiCode.trim() || null,
          pec: pec.trim() || null,
          indirizzoVia: via.trim() || null,
          indirizzoCap: cap.trim() || null,
          indirizzoComune: comune.trim() || null,
          indirizzoProvince: provincia.trim() || null,
        }),
      });
      if (!res.ok) throw new Error();
      const c = await res.json();
      onCreated(c);
      toast({ title: "Cliente creato" });
    } catch {
      toast({ title: "Errore creazione cliente", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2.5 border-t border-primary/20 pt-2">
      <p className="text-xs font-semibold text-primary">Nuovo cliente</p>
      <div className="grid grid-cols-2 gap-1 rounded-lg overflow-hidden border border-slate-200">
        {(["azienda", "privato"] as const).map(t => (
          <button key={t} onClick={() => setTipo(t)}
            className={cn("py-1.5 text-xs font-semibold transition-colors capitalize",
              tipo === t ? "bg-primary text-white" : "bg-slate-50 text-slate-600 hover:bg-slate-100")}>
            {t === "azienda" ? "Azienda" : "Privato"}
          </button>
        ))}
      </div>
      <Input placeholder="Ragione sociale / Nome *" value={ragioneSociale} onChange={e => setRagioneSociale(e.target.value)} className="h-9 text-sm text-slate-100 bg-[#22263a] border-[#3d4157] placeholder:text-slate-600" />
      {/* P.IVA con validazione automatica al blur */}
      <div className="relative">
        <Input
          placeholder="P.IVA (es. 12345678901)"
          value={partitaIva}
          onChange={e => { setPartitaIva(e.target.value); setViesStatus("idle"); setViesMsg(""); }}
          onBlur={() => { if (partitaIva.trim().length >= 11) verificaPiva(); }}
          className={cn(
            "h-9 text-sm font-mono text-slate-100 bg-[#22263a] placeholder:text-slate-600 pr-8",
            viesStatus === "ok" && "border-emerald-500",
            viesStatus === "error" && "border-red-500",
            viesStatus !== "ok" && viesStatus !== "error" && "border-[#3d4157]"
          )}
        />
        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
          {viesStatus === "loading" && <Loader2 className="h-3.5 w-3.5 text-slate-500 animate-spin" />}
          {viesStatus === "ok" && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
          {viesStatus === "error" && <XCircle className="h-3.5 w-3.5 text-red-400" />}
        </div>
        {viesMsg && (
          <p className={cn("text-xs mt-1", viesStatus === "ok" ? "text-emerald-400" : "text-red-400")}>
            {viesMsg}
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder="Cod. Fiscale" value={codiceFiscale} onChange={e => setCodiceFiscale(e.target.value)} className="h-8 text-sm font-mono text-slate-100 bg-[#22263a] border-[#3d4157] placeholder:text-slate-600" />
        <Input placeholder="Cod. SDI" value={sdiCode} onChange={e => setSdiCode(e.target.value)} className="h-8 text-sm font-mono text-slate-100 bg-[#22263a] border-[#3d4157] placeholder:text-slate-600" />
      </div>
      <Input placeholder="PEC" value={pec} onChange={e => setPec(e.target.value)} className="h-8 text-sm text-slate-100 bg-[#22263a] border-[#3d4157] placeholder:text-slate-600" />
      <Input placeholder="Via / Indirizzo" value={via} onChange={e => setVia(e.target.value)} className="h-8 text-sm text-slate-100 bg-[#22263a] border-[#3d4157] placeholder:text-slate-600" />
      <div className="grid grid-cols-5 gap-2">
        <Input placeholder="CAP" value={cap} onChange={e => setCap(e.target.value)} className="h-8 text-sm col-span-2 text-slate-100 bg-[#22263a] border-[#3d4157] placeholder:text-slate-600" />
        <Input placeholder="Comune" value={comune} onChange={e => setComune(e.target.value)} className="h-8 text-sm col-span-2 text-slate-100 bg-[#22263a] border-[#3d4157] placeholder:text-slate-600" />
        <Input placeholder="PR" value={provincia} maxLength={2} onChange={e => setProvincia(e.target.value.toUpperCase())} className="h-8 text-sm text-center font-mono col-span-1 text-slate-100 bg-[#22263a] border-[#3d4157] placeholder:text-slate-600" />
      </div>
      <div className="flex gap-2 pt-1">
        <Button variant="outline" size="sm" className="flex-1 h-8" onClick={onCancel}>Annulla</Button>
        <Button size="sm" className="flex-1 h-8" disabled={!ragioneSociale.trim() || saving} onClick={save}>
          {saving ? "Salvataggio…" : "Crea cliente"}
        </Button>
      </div>
    </div>
  );
}

type PosPhase = "idle" | "waiting" | "manual_confirm" | "approved" | "declined";

// ─── Discount form (used in DiscountDialog) ─────────────────────────────────
function DiscountForm({ currentTotal, currentDiscount, currentType, currentReason, onApply, onRemove, onClose }: {
  currentTotal: number;
  currentDiscount: string;
  currentType: string | null;
  currentReason: string;
  onApply: (type: "percent" | "amount", value: string, reason: string) => void | Promise<void>;
  onRemove: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [type, setType] = useState<"percent" | "amount">((currentType as "percent" | "amount") ?? "percent");
  const [value, setValue] = useState(currentDiscount && parseFloat(currentDiscount) > 0 ? currentDiscount : "");
  const [reason, setReason] = useState(currentReason ?? "");
  const numValue = parseFloat(value) || 0;
  const newTotal = type === "percent"
    ? Math.max(0, currentTotal * (1 - numValue / 100))
    : Math.max(0, currentTotal - numValue);
  const hasExisting = parseFloat(currentDiscount) > 0;

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {(["percent", "amount"] as const).map(t => (
          <button key={t} onClick={() => setType(t)}
            className={cn(
              "flex-1 py-2 rounded-lg border-2 text-sm font-semibold transition-all",
              type === t ? "border-amber-500 bg-amber-50 text-amber-700" : "border-slate-200 text-slate-500 hover:border-slate-300"
            )}>
            {t === "percent" ? "% Percentuale" : "€ Importo fisso"}
          </button>
        ))}
      </div>
      <div>
        <Label>{type === "percent" ? "Sconto (%)" : "Sconto (€)"}</Label>
        <Input type="number" step={type === "percent" ? "1" : "0.01"} min="0"
          max={type === "percent" ? "100" : currentTotal}
          value={value} onChange={e => setValue(e.target.value)}
          placeholder="0" className="text-xl text-center h-12" autoFocus />
      </div>
      <div>
        <Label>Motivo (facoltativo)</Label>
        <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Es. cliente abituale, omaggio…" />
      </div>
      <div className="bg-slate-50 rounded-lg p-3 space-y-1 text-sm">
        <div className="flex justify-between text-slate-500"><span>Totale attuale</span><span>€ {currentTotal.toFixed(2)}</span></div>
        <div className="flex justify-between text-amber-700 font-semibold"><span>Sconto</span><span>− € {(currentTotal - newTotal).toFixed(2)}</span></div>
        <div className="flex justify-between font-bold text-base border-t border-slate-200 pt-1 mt-1"><span>Nuovo totale</span><span>€ {newTotal.toFixed(2)}</span></div>
      </div>
      <DialogFooter className="gap-2">
        {hasExisting && (
          <Button variant="outline" className="text-red-600 hover:bg-red-50" onClick={() => onRemove()}>Rimuovi</Button>
        )}
        <Button variant="outline" onClick={onClose}>Annulla</Button>
        <Button disabled={!numValue || numValue <= 0} onClick={() => onApply(type, value, reason.trim())}>
          Applica sconto
        </Button>
      </DialogFooter>
    </div>
  );
}

// ─── Sospeso form (used in SospesoDialog) ───────────────────────────────────
function SospesoForm({ total, onConfirm, onClose }: {
  total: number;
  onConfirm: (note: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  return (
    <div className="space-y-3">
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
        Il conto verrà sospeso e il tavolo liberato.
        Il cliente potrà pagare in seguito dalla sezione <b>Sospesi</b> in cassa.
      </div>
      <div className="text-center py-3 bg-slate-50 rounded-xl">
        <p className="text-sm text-slate-500 mb-1">Importo da incassare</p>
        <p className="text-3xl font-bold text-slate-900">€ {total.toFixed(2)}</p>
      </div>
      <div>
        <Label>Nome cliente / nota (consigliato)</Label>
        <Input value={note} onChange={e => setNote(e.target.value)}
          placeholder="Es. Mario Rossi — torna domani" autoFocus />
      </div>
      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={onClose}>Annulla</Button>
        <Button onClick={() => onConfirm(note.trim())} className="bg-yellow-600 hover:bg-yellow-700">
          Sospendi conto
        </Button>
      </DialogFooter>
    </div>
  );
}

function PaymentDialog({ open, onClose, total, orderId, orderItems, onPay }: {
  open: boolean; onClose: () => void; total: number; orderId?: number;
  orderItems?: Array<{ productName: string; quantity: number; unitPrice: string; subtotal: string }>;
  onPay: (method: string, amountGiven?: number, invoiceCustomerId?: number, ragioneSociale?: string) => void;
}) {
  const [method, setMethod] = useState<"cash" | "card" | "ticket" | "other">("cash");
  const [given, setGiven] = useState("");
  const [emittiFattura, setEmittiFattura] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customers, setCustomers] = useState<SimpleCustomer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<SimpleCustomer | null>(null);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [showNewCustomer, setShowNewCustomer] = useState(false);

  // ── Terminale POS ──────────────────────────────────────────────────────────
  const { data: pdSettings = {} } = useSettings();
  const posTerminals = enabledPosTerminals(pdSettings);
  const [posTerminal, setPosTerminal] = useState<PosTerminalId | null>(null);
  const activePosTerminal: PosTerminalId | null = posTerminal ?? posTerminals[0] ?? null;
  const [posPhase, setPosPhase] = useState<PosPhase>("idle");
  const [posError, setPosError] = useState<string | null>(null);
  const alertAnomalousPay = pdSettings["feat_alert_totale_anomalo"] === "true";
  const confirmAnomalousIfNeeded = (amt: number) => {
    if (!alertAnomalousPay) return true;
    if (amt < 1 || amt > 500) {
      const msg = amt < 1 ? "molto basso" : "molto alto";
      return window.confirm(`Totale ${msg}: € ${amt.toFixed(2)}\n\nConfermi l'incasso?`);
    }
    return true;
  };

  // ── Mancia opzionale (sommata al totale e inviata sulla RT) ───────────────
  const [manciaStr, setManciaStr] = useState("");
  const mancia = parseFloat(manciaStr) || 0;
  const totalConMancia = total + mancia;

  const change = method === "cash" && given ? Math.max(0, parseFloat(given) - totalConMancia) : 0;

  useEffect(() => {
    if (!open) {
      setGiven(""); setEmittiFattura(false); setSelectedCustomer(null);
      setCustomerSearch(""); setShowNewCustomer(false);
      setPosPhase("idle"); setPosError(null); setPosTerminal(null);
      setManciaStr("");
    }
  }, [open]);

  useEffect(() => {
    if (!emittiFattura) return;
    setLoadingCustomers(true);
    const url = customerSearch
      ? `${API}/customers?search=${encodeURIComponent(customerSearch)}`
      : `${API}/customers`;
    fetch(url).then(r => r.json()).then(data => {
      setCustomers(Array.isArray(data) ? data : []);
    }).finally(() => setLoadingCustomers(false));
  }, [emittiFattura, customerSearch]);

  const canPay = method !== "cash" || parseFloat(given) >= totalConMancia;
  const canConfirm = canPay && (!emittiFattura || selectedCustomer !== null);

  const buoniPastoOn = pdSettings["feat_buoni_pasto"] === "true";
  const methods = [
    { id: "cash" as const,   label: "Contanti",   icon: Banknote,   color: "text-emerald-600" },
    { id: "card" as const,   label: "Carta/POS",  icon: CreditCard, color: "text-blue-600" },
    ...(buoniPastoOn ? [{ id: "ticket" as const, label: "Buoni Pasto", icon: Ticket, color: "text-amber-600" }] : []),
    { id: "other" as const,  label: "Altro",      icon: Wallet,     color: "text-purple-600" },
  ];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm w-full">
        <DialogHeader><DialogTitle>Pagamento</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1 max-h-[85vh] overflow-y-auto">
          <div className="text-center py-3 bg-slate-50 rounded-xl">
            <p className="text-sm text-slate-500 mb-1">Totale da pagare</p>
            <p className="text-4xl font-bold text-slate-900">€ {totalConMancia.toFixed(2)}</p>
            {mancia > 0 && (
              <p className="text-[11px] text-emerald-600 mt-0.5">Conto € {total.toFixed(2)} + Mancia € {mancia.toFixed(2)}</p>
            )}
          </div>

          {/* ── Campo Mancia (opzionale) ───────────────────────────────── */}
          <div className="flex items-center gap-2 px-1">
            <Label className="text-xs text-slate-500 shrink-0">Mancia €</Label>
            <Input
              type="number" step="0.50" min="0"
              placeholder="0.00"
              value={manciaStr}
              onChange={e => setManciaStr(e.target.value)}
              className="h-8 text-sm flex-1"
            />
            {[1, 2, 5].map(v => (
              <button key={v} type="button" onClick={() => setManciaStr(String(v))}
                className="px-2 h-8 rounded-md bg-emerald-50 hover:bg-emerald-100 text-xs font-bold text-emerald-700">
                €{v}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            {methods.map(m => (
              <button key={m.id} onClick={() => setMethod(m.id)}
                className={cn("flex flex-col items-center gap-1 py-2 rounded-lg border-2 transition-all",
                  method === m.id ? "border-primary bg-orange-50" : "border-slate-200 hover:border-slate-300")}>
                <m.icon className={cn("h-4 w-4", m.color)} />
                <span className="text-[9px] font-medium text-slate-700 text-center leading-tight">{m.label}</span>
              </button>
            ))}
          </div>

          {method === "card" && (
            <PosTerminalPicker
              terminals={posTerminals}
              value={activePosTerminal}
              onChange={t => { setPosTerminal(t); setPosPhase("idle"); setPosError(null); }}
            />
          )}

          {method === "cash" && (
            <>
              <div>
                <Label className="mb-1 block">Importo ricevuto</Label>
                <Input type="number" step="0.01" placeholder="0.00" value={given}
                  onChange={e => setGiven(e.target.value)} className="text-xl text-center h-12" />
              </div>
              <div className="grid grid-cols-4 gap-1">
                {[5, 10, 20, 50].map(v => (
                  <button key={v} onClick={() => setGiven(v.toString())}
                    className="py-2 rounded-md bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 transition-colors">
                    €{v}
                  </button>
                ))}
              </div>
              {parseFloat(given) >= totalConMancia && (
                <div className="flex justify-between items-center p-3 bg-emerald-50 rounded-lg">
                  <span className="text-sm font-medium text-emerald-700">Resto</span>
                  <span className="text-xl font-bold text-emerald-700">€ {change.toFixed(2)}</span>
                </div>
              )}
            </>
          )}

          {/* Invoice toggle */}
          <div className={cn(
            "rounded-xl border-2 transition-all",
            emittiFattura ? "border-primary bg-orange-50" : "border-slate-200"
          )}>
            <div
              role="button" tabIndex={0}
              onClick={() => { setEmittiFattura(e => !e); setSelectedCustomer(null); setShowNewCustomer(false); }}
              onKeyDown={e => e.key === "Enter" && (setEmittiFattura(v => !v), setSelectedCustomer(null))}
              className="w-full flex items-center justify-between p-3 cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <ReceiptText className={cn("h-4 w-4", emittiFattura ? "text-primary" : "text-slate-400")} />
                <div>
                  <span className={cn("text-sm font-semibold", emittiFattura ? "text-primary" : "text-slate-600")}>
                    Documento Gestionale
                  </span>
                  <p className="text-[10px] text-slate-400 leading-tight">Scontrino NON FISCALE · XML per Passepartout</p>
                </div>
              </div>
              <Switch checked={emittiFattura} onCheckedChange={v => { setEmittiFattura(v); setSelectedCustomer(null); setShowNewCustomer(false); }} onClick={e => e.stopPropagation()} />
            </div>

            {emittiFattura && (
              <div className="border-t border-primary/20 px-3 pb-3 pt-2 space-y-2">
                {selectedCustomer ? (
                  <div className="flex items-center justify-between p-2 rounded-lg bg-white border border-primary/30">
                    <div>
                      <div className="text-sm font-semibold">{selectedCustomer.ragioneSociale}</div>
                      <div className="text-xs text-muted-foreground">{selectedCustomer.partitaIva || selectedCustomer.codiceFiscale || "–"}</div>
                    </div>
                    <button onClick={() => setSelectedCustomer(null)} className="p-1 rounded hover:bg-destructive/10 text-slate-400 hover:text-destructive">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : showNewCustomer ? (
                  <NewCustomerForm
                    onCreated={c => { setSelectedCustomer(c); setShowNewCustomer(false); }}
                    onCancel={() => setShowNewCustomer(false)}
                  />
                ) : (
                  <>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                      <Input
                        value={customerSearch}
                        onChange={e => setCustomerSearch(e.target.value)}
                        placeholder="Cerca cliente per nome o P.IVA…"
                        className="pl-8 h-9 text-sm"
                        autoFocus
                      />
                    </div>
                    {loadingCustomers ? (
                      <div className="text-xs text-muted-foreground text-center py-2">Caricamento…</div>
                    ) : customers.length > 0 ? (
                      <div className="space-y-1 max-h-36 overflow-y-auto">
                        {customers.map(c => (
                          <button key={c.id} onClick={() => setSelectedCustomer(c)}
                            className="w-full text-left p-2 rounded-lg hover:bg-white border border-transparent hover:border-primary/20 transition-all">
                            <div className="text-sm font-medium">{c.ragioneSociale}</div>
                            <div className="text-xs text-muted-foreground">{c.partitaIva || c.codiceFiscale || "–"}</div>
                          </button>
                        ))}
                      </div>
                    ) : customerSearch ? (
                      <div className="text-xs text-muted-foreground text-center py-1.5">Nessun cliente trovato</div>
                    ) : null}
                    <button
                      onClick={() => setShowNewCustomer(true)}
                      className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border-2 border-dashed border-slate-300 hover:border-primary text-sm text-slate-500 hover:text-primary transition-colors font-medium"
                    >
                      <Plus className="h-3.5 w-3.5" /> Crea nuovo cliente
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Terminale POS: fase waiting ───────────────────────────────── */}
        {(posPhase === "waiting" || posPhase === "manual_confirm") && (
          <div className="absolute inset-0 bg-white/95 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center gap-5 z-10 p-6">
            {posPhase === "waiting" ? (
              <>
                <div className="h-16 w-16 rounded-full bg-blue-50 border-4 border-blue-200 flex items-center justify-center animate-pulse">
                  <CreditCard className="h-7 w-7 text-blue-600" />
                </div>
                <div className="text-center">
                  <p className="font-bold text-lg text-slate-800">In attesa del terminale…</p>
                  <p className="text-sm text-slate-500 mt-1">
                    {activePosTerminal === "pax" ? "Avvicina/inserisci carta sul Nexi PAX D230" : "Inserisci l'importo sul terminale myPOS"}
                  </p>
                  <p className="text-2xl font-bold text-primary mt-2">€ {totalConMancia.toFixed(2)}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setPosPhase("idle")}>Annulla</Button>
              </>
            ) : (
              <>
                <div className="h-16 w-16 rounded-full bg-orange-50 border-4 border-orange-200 flex items-center justify-center">
                  <CreditCard className="h-7 w-7 text-primary" />
                </div>
                <div className="text-center">
                  <p className="font-bold text-lg text-slate-800">
                    Pagamento sul terminale {activePosTerminal ? POS_TERMINAL_LABEL[activePosTerminal] : "POS"}
                  </p>
                  <p className="text-sm text-slate-500 mt-1">Digita l'importo sul terminale e fai pagare il cliente</p>
                  <p className="text-3xl font-bold text-primary mt-2">€ {totalConMancia.toFixed(2)}</p>
                </div>
                <div className="flex gap-2 w-full">
                  <Button variant="outline" className="flex-1 h-9 text-sm" onClick={() => setPosPhase("idle")}>Annulla</Button>
                  <Button className="flex-1 h-9 text-sm" onClick={() => {
                    if (!confirmAnomalousIfNeeded(totalConMancia)) return;
                    if (mancia > 0 && orderId) {
                      fetch(`${API}/orders/${orderId}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ mancia: mancia.toFixed(2) }),
                      }).catch(() => {});
                    }
                    setPosPhase("idle");
                    onPay(method, parseFloat(given) || totalConMancia, emittiFattura && selectedCustomer ? selectedCustomer.id : undefined, emittiFattura ? (selectedCustomer?.ragioneSociale ?? undefined) : undefined);
                  }}>
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Pagamento ricevuto
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {posPhase === "declined" && posError && (
          <div className="space-y-2">
            <div className="flex items-start gap-2 p-3 bg-red-50 rounded-xl border border-red-200">
              <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-red-700">Terminale: transazione rifiutata</p>
                <p className="text-xs text-red-500 mt-0.5">{posError}</p>
              </div>
            </div>
            <Button variant="outline" className="w-full h-10 text-sm" onClick={() => {
              if (!confirmAnomalousIfNeeded(totalConMancia)) return;
              if (mancia > 0 && orderId) {
                fetch(`${API}/orders/${orderId}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ mancia: mancia.toFixed(2) }),
                }).catch(() => {});
              }
              setPosPhase("idle");
              onPay(method, parseFloat(given) || totalConMancia, emittiFattura && selectedCustomer ? selectedCustomer.id : undefined, emittiFattura ? (selectedCustomer?.ragioneSociale ?? undefined) : undefined);
            }}>
              <CheckCircle2 className="h-4 w-4 mr-2" /> Registra comunque incasso manuale
            </Button>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1">Annulla</Button>
          <Button
            onClick={async () => {
              const customerId = emittiFattura && selectedCustomer ? selectedCustomer.id : undefined;
              const ragSoc = emittiFattura ? (selectedCustomer?.ragioneSociale ?? undefined) : undefined;
              if (!confirmAnomalousIfNeeded(totalConMancia)) return;
              // Carta + terminale abilitato → chiama prima il POS
              if (method === "card" && activePosTerminal) {
                setPosPhase("waiting");
                setPosError(null);
                try {
                  const resp = await fetch(`${API}/pos/sale`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ amountCents: Math.round(totalConMancia * 100), orderId, terminal: activePosTerminal }),
                  });
                  const result = await resp.json();
                  if (result.manualConfirmRequired) {
                    setPosPhase("manual_confirm");
                    return;
                  }
                  if (result.approved) {
                    if (mancia > 0 && orderId) {
                      fetch(`${API}/orders/${orderId}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ mancia: mancia.toFixed(2) }),
                      }).catch(() => {});
                    }
                    setPosPhase("idle");
                    onPay(method, parseFloat(given) || totalConMancia, customerId, ragSoc);
                  } else {
                    setPosPhase("declined");
                    setPosError(result.error ?? result.responseMessage ?? "Transazione rifiutata");
                  }
                } catch (e) {
                  setPosPhase("declined");
                  // Messaggio user-friendly: non mostrare lo stack del JS al cassiere
                  const msg = e instanceof Error ? e.message : "";
                  setPosError(
                    msg.includes("fetch") || msg.includes("Failed")
                      ? "Impossibile contattare il terminale POS. Verifica la connessione di rete."
                      : (msg || "Errore comunicazione terminale POS")
                  );
                }
                return;
              }
              // Se c'è una mancia, salvala sull'ordine prima di pagare
              if (mancia > 0 && orderId) {
                fetch(`${API}/orders/${orderId}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ mancia: mancia.toFixed(2) }),
                }).catch(() => {});
              }
              onPay(method, parseFloat(given) || totalConMancia, customerId, ragSoc);
            }}
            disabled={!canConfirm || posPhase === "waiting"}
            className="flex-1"
          >
            {posPhase === "waiting"
              ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Terminale…</>
              : method === "card" && activePosTerminal
                ? <><CreditCard className="h-4 w-4 mr-2" />Avvia terminale</>
                : emittiFattura ? "Incassa + Fattura" : `Incassa € ${totalConMancia.toFixed(2)}`
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Covers Dialog (allows 0) ─────────────────────────────────────────────────
function CoversDialog({ open, onClose, tableName, onConfirm, initialCovers = 0, mode = "open" }: {
  open: boolean; onClose: () => void; tableName: string; onConfirm: (covers: number) => void;
  initialCovers?: number; mode?: "open" | "edit";
}) {
  const [covers, setCovers] = useState(initialCovers);
  useEffect(() => { if (open) setCovers(initialCovers); }, [open, initialCovers]);
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            {mode === "edit" ? "Modifica Coperti" : "Coperti"} — {tableName}
          </DialogTitle>
        </DialogHeader>
        <div className="py-4 text-center space-y-4">
          <p className="text-sm text-muted-foreground">Numero di coperti (0 = nessun coperto)</p>
          <div className="flex items-center justify-center gap-5">
            <button onClick={() => setCovers(c => Math.max(0, c - 1))}
              className="h-12 w-12 rounded-full border-2 border-slate-200 flex items-center justify-center hover:border-primary active:scale-90 transition-all">
              <Minus className="h-5 w-5" />
            </button>
            <span className="text-6xl font-bold w-20 text-center tabular-nums">{covers}</span>
            <button onClick={() => setCovers(c => c + 1)}
              className="h-12 w-12 rounded-full border-2 border-slate-200 flex items-center justify-center hover:border-primary active:scale-90 transition-all">
              <Plus className="h-5 w-5" />
            </button>
          </div>
          {/* Quick-select buttons */}
          <div className="flex items-center justify-center gap-2 flex-wrap">
            {[1,2,3,4,5,6,8,10].map(n => (
              <button key={n} onClick={() => setCovers(n)}
                className={cn("h-9 w-9 rounded-lg border-2 text-sm font-bold transition-all",
                  covers === n ? "border-primary bg-primary/10 text-primary" : "border-slate-200 text-slate-600 hover:border-slate-300")}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annulla</Button>
          <Button onClick={() => onConfirm(covers)} className="flex-1">
            {mode === "edit" ? "Salva" : "Apri Tavolo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Romana Dialog ────────────────────────────────────────────────────────────
// Ogni quota può avere metodo di pagamento diverso (contanti / carta).
// Ogni pagamento emette uno scontrino separato sulla RT (XonXoff).
// Il totale residuo scala ad ogni quota pagata.
// All'ultima quota l'ordine viene chiuso automaticamente.
type RomanaQuota = {
  n: number;               // 1-based
  importo: number;
  stato: "pending" | "paying" | "pos_waiting" | "pos_manual" | "paid" | "error";
  metodoPagamento?: "cash" | "card";
  rtOk?: boolean;
  rtError?: string;
  receiptId?: number;
};

function RomanaBody({ total, paidRomana = 0, orderId, tableName, onOrderClosed, onCancel }: {
  total: number; paidRomana?: number; orderId?: number; tableName?: string;
  onOrderClosed?: () => void;
  onCancel: () => void;
}) {
  const { data: rdSettings = {} } = useSettings();
  const rdPosTerminals = enabledPosTerminals(rdSettings);
  const [rdPosTerminal, setRdPosTerminal] = useState<PosTerminalId | null>(null);
  const rdActiveTerminal: PosTerminalId | null = rdPosTerminal ?? rdPosTerminals[0] ?? null;

  // Importo da incassare in questa sessione (totale ordine - già pagato con romana)
  const restante = Math.max(0, Math.round((total - paidRomana) * 100) / 100);
  const hasPagatiPrecedenti = paidRomana > 0.005;

  const [phase, setPhase] = useState<"preconto" | "setup" | "pagamento">(() => hasPagatiPrecedenti ? "setup" : "preconto");
  const [precontoPrinting, setPrecontoPrinting] = useState(false);
  const [precontoResult, setPrecontoResult] = useState<{ ok: boolean; error?: string | null } | null>(null);
  const [numSplits, setNumSplits] = useState(hasPagatiPrecedenti ? 1 : 2);

  async function stampaPrecontoRT() {
    if (!orderId) return;
    setPrecontoPrinting(true);
    setPrecontoResult(null);
    try {
      const res = await fetch(`${API}/orders/${orderId}/preconto`, { method: "POST" });
      const json = await res.json();
      setPrecontoResult({ ok: json.ok, error: json.error });
    } catch {
      setPrecontoResult({ ok: false, error: "Errore di rete" });
    } finally {
      setPrecontoPrinting(false);
    }
  }
  const [quote, setQuote] = useState<RomanaQuota[]>([]);

  function calcolaQuote(n: number): RomanaQuota[] {
    const baseCent = Math.floor((restante * 100) / n);
    const restoCent = Math.round(restante * 100) - baseCent * n;
    return Array.from({ length: n }, (_, i) => ({
      n: i + 1,
      importo: (baseCent + (i === n - 1 ? restoCent : 0)) / 100,
      stato: "pending" as const,
    }));
  }

  function avviaRomana() {
    setQuote(calcolaQuote(numSplits));
    setPhase("pagamento");
  }

  const totalePagatoInSession = quote.filter(q => q.stato === "paid").reduce((s, q) => s + q.importo, 0);
  const rimanente   = Math.max(0, restante - totalePagatoInSession);
  const tuttePagate = quote.length > 0 && quote.every(q => q.stato === "paid");
  const primaInAttesa = quote.find(q => q.stato === "pending");

  // Invia scontrino + chiude ordine se è l'ultima quota in assoluto
  async function emettiSconto(n: number, metodo: "cash" | "card", quotaImporto: number) {
    const isUltima = n === quote.length;
    const resp = await fetch(`${API}/fiscal/romana`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId,
        importo: quotaImporto.toFixed(2),
        metodoPagamento: metodo,
        quotaNum: n,
        quoteTotali: quote.length,
        tableName: tableName ?? "",
        isUltima,
      }),
    });
    const data = await resp.json();
    setQuote(prev => prev.map(q => q.n === n ? {
      ...q,
      stato: "paid",
      rtOk: data.rtOk,
      rtError: data.rtError,
      receiptId: data.receiptId,
    } : q));
    if (isUltima && data.orderClosed) {
      onOrderClosed?.();
    }
  }

  async function pagaQuota(n: number, metodo: "cash" | "card") {
    if (!orderId) return;
    const quota = quote.find(q => q.n === n)!;

    // ── Carta + terminale POS abilitato ───────────────────────────────────────
    if (metodo === "card" && rdActiveTerminal) {
      setQuote(prev => prev.map(q => q.n === n ? { ...q, stato: "pos_waiting", metodoPagamento: metodo } : q));
      try {
        const posResp = await fetch(`${API}/pos/sale`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amountCents: Math.round(quota.importo * 100),
            orderId,
            reference: `O${orderId}-Q${n}`,
            terminal: rdActiveTerminal,
          }),
        });
        const posData = await posResp.json();

        if (posData.manualConfirmRequired) {
          setQuote(prev => prev.map(q => q.n === n ? { ...q, stato: "pos_manual" } : q));
          return;
        }
        if (!posData.approved) {
          setQuote(prev => prev.map(q => q.n === n ? {
            ...q,
            stato: "error",
            rtError: posData.error ?? posData.responseMessage ?? "Terminale: transazione rifiutata",
          } : q));
          return;
        }
        setQuote(prev => prev.map(q => q.n === n ? { ...q, stato: "paying" } : q));
        await emettiSconto(n, metodo, quota.importo);
      } catch (e) {
        setQuote(prev => prev.map(q => q.n === n ? { ...q, stato: "error", rtError: String(e) } : q));
      }
      return;
    }

    // ── Contanti o terminale non configurato ─────────────────────────────────
    setQuote(prev => prev.map(q => q.n === n ? { ...q, stato: "paying", metodoPagamento: metodo } : q));
    try {
      await emettiSconto(n, metodo, quota.importo);
    } catch (e) {
      setQuote(prev => prev.map(q => q.n === n ? { ...q, stato: "error", rtError: String(e) } : q));
    }
  }

  async function confermaManuale(n: number) {
    const quota = quote.find(q => q.n === n)!;
    setQuote(prev => prev.map(q => q.n === n ? { ...q, stato: "paying" } : q));
    try {
      await emettiSconto(n, "card", quota.importo);
    } catch (e) {
      setQuote(prev => prev.map(q => q.n === n ? { ...q, stato: "error", rtError: String(e) } : q));
    }
  }

  const MetodoPulsanti = ({ quotaN, disabled }: { quotaN: number; disabled: boolean }) => (
    <div className="flex gap-1.5 shrink-0 flex-wrap">
      <button
        disabled={disabled}
        onClick={() => pagaQuota(quotaN, "cash")}
        className={cn(
          "flex items-center gap-1 px-2.5 py-2 rounded-xl text-xs font-bold border-2 transition-all active:scale-95",
          disabled ? "opacity-40 cursor-not-allowed border-slate-200 text-slate-400"
                   : "border-emerald-400 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
        )}>
        <Banknote className="h-3.5 w-3.5" /> Contanti
      </button>
      <button
        disabled={disabled}
        onClick={() => pagaQuota(quotaN, "card")}
        className={cn(
          "flex items-center gap-1 px-2.5 py-2 rounded-xl text-xs font-bold border-2 transition-all active:scale-95",
          disabled ? "opacity-40 cursor-not-allowed border-slate-200 text-slate-400"
                   : "border-blue-400 bg-blue-50 text-blue-700 hover:bg-blue-100"
        )}>
        <CreditCard className="h-3.5 w-3.5" /> Carta
      </button>
    </div>
  );

  const minSplits = hasPagatiPrecedenti ? 1 : 2;

  return (
    <>
        {/* ── Fase 1: stampa preconto prima di scegliere la divisione ─────── */}
        {phase === "preconto" && (
          <>
            <div className="py-3 text-center space-y-4">
              {/* Totale da dividere */}
              <div className="bg-slate-50 rounded-xl py-3 px-4">
                <p className="text-xs text-slate-500 mb-0.5">Totale da dividere</p>
                <p className="text-4xl font-bold text-slate-900">€ {restante.toFixed(2)}</p>
                {tableName && <p className="text-xs text-slate-400 mt-0.5">{tableName}</p>}
              </div>

              {/* Pulsante stampa RT */}
              <div className="space-y-3 px-1">
                <p className="text-sm text-slate-600 font-medium">
                  Stampa il preconto da mostrare al cliente prima di dividere il conto:
                </p>
                <button
                  onClick={stampaPrecontoRT}
                  disabled={precontoPrinting || !orderId}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-white rounded-xl font-semibold text-sm hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-50">
                  {precontoPrinting
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Printer className="h-4 w-4" />}
                  {precontoPrinting ? "Stampa in corso…" : "Stampa Preconto RT"}
                </button>
              </div>

              {/* Risultato stampa */}
              {precontoResult && (
                <div className={cn(
                  "text-center text-xs font-semibold px-3 py-2.5 rounded-xl border",
                  precontoResult.ok
                    ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                    : "bg-amber-50 border-amber-200 text-amber-700"
                )}>
                  {precontoResult.ok
                    ? "✓ Preconto stampato sulla RT"
                    : `⚠ RT: ${precontoResult.error ?? "non disponibile"}`}
                </div>
              )}
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={onCancel} className="flex-1">
                Annulla
              </Button>
              <Button onClick={() => setPhase("setup")} className="flex-1">
                Avanti — Scegli divisione →
              </Button>
            </DialogFooter>
          </>
        )}

        {phase === "setup" && (
          <>
            <div className="py-3 text-center space-y-4">

              {/* Banner "già pagato" (solo se ci sono pagamenti precedenti) */}
              {hasPagatiPrecedenti && (
                <div className="flex items-center justify-between rounded-xl bg-green-50 border border-green-200 px-4 py-2.5 text-sm">
                  <span className="text-green-700 font-medium">Già incassato</span>
                  <span className="font-bold text-green-800">€ {paidRomana.toFixed(2)}</span>
                </div>
              )}

              {/* Restante da incassare */}
              <div className="bg-slate-50 rounded-xl py-3 px-4">
                <p className="text-xs text-slate-500 mb-0.5">
                  {hasPagatiPrecedenti ? "Restante da incassare" : "Totale da dividere"}
                </p>
                <p className="text-4xl font-bold text-slate-900">€ {restante.toFixed(2)}</p>
                {hasPagatiPrecedenti && (
                  <p className="text-[11px] text-slate-400 mt-0.5">Totale ordine € {total.toFixed(2)}</p>
                )}
              </div>

              {/* Stepper persone */}
              <div className="space-y-2">
                <p className="text-sm font-semibold text-slate-600">
                  {hasPagatiPrecedenti ? "Quante quote rimaste?" : "Numero di persone"}
                </p>
                <div className="flex items-center justify-center gap-5">
                  <button onClick={() => setNumSplits(p => Math.max(minSplits, p - 1))}
                    className="h-12 w-12 rounded-full border-2 border-slate-200 flex items-center justify-center hover:border-primary active:scale-90 transition-all text-slate-700">
                    <Minus className="h-5 w-5" />
                  </button>
                  <span className="text-5xl font-bold w-16 text-center tabular-nums">{numSplits}</span>
                  <button onClick={() => setNumSplits(p => Math.min(20, p + 1))}
                    className="h-12 w-12 rounded-full border-2 border-slate-200 flex items-center justify-center hover:border-primary active:scale-90 transition-all text-slate-700">
                    <Plus className="h-5 w-5" />
                  </button>
                </div>
                {/* Quick-select */}
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  {(hasPagatiPrecedenti ? [1,2,3,4,5] : [2,3,4,5,6,8]).map(n => (
                    <button key={n} onClick={() => setNumSplits(n)}
                      className={cn("h-9 w-9 rounded-lg border-2 text-sm font-bold transition-all",
                        numSplits === n ? "border-primary bg-orange-50 text-primary" : "border-slate-200 text-slate-600 hover:border-slate-300")}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quota stimata */}
              <div className="p-4 bg-orange-50 border border-orange-200 rounded-xl">
                <p className="text-sm text-slate-600 mb-1">
                  {numSplits === 1 ? "Paga tutto il restante" : "Ognuno paga circa"}
                </p>
                <p className="text-4xl font-bold text-primary">
                  € {numSplits > 0 ? (restante / numSplits).toFixed(2) : "0.00"}
                </p>
              </div>

              {/* Nota se si può aggiungere merce */}
              {hasPagatiPrecedenti && (
                <p className="text-xs text-slate-400 text-center">
                  Puoi chiudere, aggiungere merce e tornare qui — il restante si aggiornerà automaticamente.
                </p>
              )}
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={onCancel} className="flex-1">
                {hasPagatiPrecedenti ? "Chiudi / aggiungi merce" : "Annulla"}
              </Button>
              <Button onClick={avviaRomana} className="flex-1" disabled={!orderId || restante <= 0}>
                {hasPagatiPrecedenti ? "Continua →" : "Avvia divisione →"}
              </Button>
            </DialogFooter>
          </>
        )}

        {phase === "pagamento" && (
          <>
            <div className="space-y-3 py-1 max-h-[70vh] overflow-y-auto">
              {/* Residuo sessione corrente */}
              <div className={cn(
                "rounded-xl px-4 py-2.5 text-center transition-all",
                tuttePagate
                  ? "bg-green-50 border border-green-200"
                  : "bg-orange-50 border border-orange-200"
              )}>
                {tuttePagate ? (
                  <div className="flex items-center justify-center gap-2 text-green-700 font-bold">
                    <CheckCircle2 className="h-5 w-5" /> Conto chiuso — tutti hanno pagato
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-slate-500">Da incassare</p>
                    <p className="text-3xl font-bold text-primary">€ {rimanente.toFixed(2)}</p>
                    {hasPagatiPrecedenti && (
                      <p className="text-[11px] text-slate-400">Già pagato precedentemente: € {paidRomana.toFixed(2)}</p>
                    )}
                  </>
                )}
              </div>

              <PosTerminalPicker compact terminals={rdPosTerminals} value={rdActiveTerminal} onChange={setRdPosTerminal} />

              {/* Lista quote */}
              <div className="space-y-2">
                {quote.map(q => {
                  const isPaying    = q.stato === "paying";
                  const isPaid      = q.stato === "paid";
                  const isError     = q.stato === "error";
                  const isPending   = q.stato === "pending";
                  const isPosWait   = q.stato === "pos_waiting";
                  const isPosManual = q.stato === "pos_manual";
                  const isNext      = primaInAttesa?.n === q.n;
                  const isBusy      = isPaying || isPosWait || isPosManual;

                  return (
                    <div key={q.n} className={cn(
                      "rounded-xl border-2 p-3 transition-all",
                      isPaid      ? "border-green-300 bg-green-50"
                      : isError   ? "border-red-300 bg-red-50"
                      : isPosWait ? "border-blue-300 bg-blue-50"
                      : isPosManual ? "border-amber-300 bg-amber-50"
                      : isNext    ? "border-primary bg-orange-50"
                      : "border-slate-200 bg-white opacity-60"
                    )}>
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "h-9 w-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0",
                          isPaid      ? "bg-green-500 text-white"
                          : isError   ? "bg-red-400 text-white"
                          : isPosWait ? "bg-blue-500 text-white animate-pulse"
                          : isPosManual ? "bg-amber-500 text-white"
                          : isNext    ? "bg-primary text-white"
                          : "bg-slate-200 text-slate-500"
                        )}>
                          {isPaid ? <CheckCircle2 className="h-4 w-4" />
                           : isPosWait ? <CreditCard className="h-4 w-4" />
                           : isPosManual ? <CreditCard className="h-4 w-4" />
                           : q.n}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span className={cn("font-bold text-lg",
                              isPaid ? "text-green-700"
                              : isPosWait ? "text-blue-700"
                              : isPosManual ? "text-amber-700"
                              : "text-slate-800")}>
                              € {q.importo.toFixed(2)}
                            </span>
                            {isPaid && q.metodoPagamento && (
                              <span className={cn("text-xs font-semibold px-1.5 py-0.5 rounded-full",
                                q.metodoPagamento === "cash"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : "bg-blue-100 text-blue-700")}>
                                {q.metodoPagamento === "cash" ? "Contanti" : "Carta"}
                              </span>
                            )}
                          </div>
                          {isPosWait && (
                            <p className="text-[10px] text-blue-600">
                              {rdActiveTerminal === "pax" ? "Avvicina/inserisci carta sul Nexi PAX D230…" : "Attesa terminale…"}
                            </p>
                          )}
                          {isPosManual && (
                            <p className="text-[10px] text-amber-600">
                              Digita € {q.importo.toFixed(2)} sul {rdActiveTerminal ? POS_TERMINAL_LABEL[rdActiveTerminal] : "terminale POS"}
                            </p>
                          )}
                          {isPaid && !q.rtOk && (
                            <p className="text-[10px] text-amber-600">RT non risposta — scontrino solo nel gestionale</p>
                          )}
                          {isError && (
                            <p className="text-[10px] text-red-600 truncate">{q.rtError}</p>
                          )}
                        </div>

                        {(isPaying || isPosWait) && (
                          <div className="shrink-0 text-xs text-slate-400 flex items-center gap-1">
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            {isPosWait ? "POS…" : "Invio…"}
                          </div>
                        )}
                        {isPosManual && (
                          <button
                            onClick={() => confermaManuale(q.n)}
                            className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold border-2 border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100 active:scale-95 transition-all">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Confermato
                          </button>
                        )}
                        {(isPending || isError) && !isBusy && (
                          <MetodoPulsanti quotaN={q.n} disabled={!isNext && isPending} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <DialogFooter className="gap-2">
              {tuttePagate ? (
                <Button className="w-full" onClick={onCancel}>
                  <CheckCircle2 className="h-4 w-4 mr-2" /> Chiudi
                </Button>
              ) : (
                <>
                  <Button variant="outline" onClick={() => setPhase("setup")}>← Modifica</Button>
                  <Button variant="outline" onClick={onCancel} className="flex-1 text-slate-600">Chiudi senza pagare</Button>
                </>
              )}
            </DialogFooter>
          </>
        )}
    </>
  );
}

// ─── Romana Dialog (thin wrapper attorno a RomanaBody) ────────────────────────
function RomanaDialog({ open, onClose, total, paidRomana = 0, orderId, tableName, onOrderClosed }: {
  open: boolean; onClose: () => void;
  total: number; paidRomana?: number; orderId?: number; tableName?: string;
  onOrderClosed?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Divide className="h-4 w-4 text-primary" /> Pagamento alla Romana
          </DialogTitle>
        </DialogHeader>
        {open && (
          <RomanaBody
            total={total}
            paidRomana={paidRomana}
            orderId={orderId}
            tableName={tableName}
            onOrderClosed={onOrderClosed}
            onCancel={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Preconto Dialog ──────────────────────────────────────────────────────────
function PrecontoDialog({ open, onClose, order, items, orderId, coverPrice, coverCount }: {
  open: boolean; onClose: () => void;
  orderId?: number;
  order: { tableName?: string | null; covers?: number; total: string; createdAt: string } | null;
  items: Array<{ productName: string; quantity: number; unitPrice: string; subtotal: string }>;
  coverPrice: number;
  coverCount: number;
}) {
  const [printing, setPrinting] = useState(false);
  const [printResult, setPrintResult] = useState<{ ok: boolean; error?: string | null } | null>(null);

  useEffect(() => {
    if (open) setPrintResult(null);
  }, [open]);

  if (!order) return null;

  const covers = coverCount;
  const coverTotal = covers > 0 && coverPrice > 0 ? covers * coverPrice : 0;
  const grandTotal = parseFloat(order.total) + coverTotal;

  async function handleStampa() {
    if (!orderId) return;
    setPrinting(true);
    setPrintResult(null);
    try {
      const res = await fetch(`${API}/orders/${orderId}/preconto`, { method: "POST" });
      const json = await res.json();
      setPrintResult({ ok: json.ok, error: json.error });
    } catch (e) {
      setPrintResult({ ok: false, error: "Errore di rete" });
    } finally {
      setPrinting(false);
    }
  }

  function handleBrowserPrint() {
    if (!order) return;
    const ragSoc = order.tableName || "Scontrino Rapido";
    const dataOra = new Date(order.createdAt).toLocaleString("it-IT");
    const righe = items.map(i =>
      `<tr><td>${i.quantity}x ${i.productName}</td><td style="text-align:right">€ ${parseFloat(i.subtotal).toFixed(2)}</td></tr>`
    ).join("");
    const coverRow = coverTotal > 0
      ? `<tr><td>${covers}x Coperto</td><td style="text-align:right">€ ${coverTotal.toFixed(2)}</td></tr>`
      : "";
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Preconto</title>
<style>body{font-family:monospace;max-width:300px;margin:auto;padding:16px;font-size:13px}
h2{text-align:center;margin:0}p{text-align:center;margin:4px 0;font-size:11px;color:#555}
table{width:100%;border-collapse:collapse;margin:8px 0}
tr td{padding:2px 0}hr{border:1px dashed #999}
.total{font-weight:bold;font-size:15px;border-top:2px solid #333;padding-top:6px}
.footer{text-align:center;font-size:10px;color:#888;margin-top:12px}
@media print{body{margin:0}}</style></head><body>
<h2>${ragSoc}</h2><p>${dataOra}</p>
${covers > 0 ? `<p>${covers} coperti${coverPrice > 0 ? ` × €${coverPrice.toFixed(2)}` : ""}</p>` : ""}
<hr><table>${righe}${coverRow}</table><hr>
<table><tr class="total"><td>TOTALE</td><td style="text-align:right">€ ${grandTotal.toFixed(2)}</td></tr></table>
<div class="footer">DOCUMENTO NON VALIDO AI FINI FISCALI</div>
</body></html>`;
    const w = window.open("", "_blank", "width=400,height=600");
    if (w) { w.document.write(html); w.document.close(); w.focus(); w.print(); }
  }

  const safeGrandTotal = isNaN(grandTotal) ? coverTotal : grandTotal;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="w-[min(22rem,calc(100vw-1.5rem))] max-w-none p-5">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><FileText className="h-4 w-4" /> Preconto</DialogTitle></DialogHeader>
        <div className="space-y-3 font-mono text-sm">
          <div className="text-center border-b border-dashed border-slate-200 pb-3">
            <div className="font-bold text-base">{order.tableName || "Scontrino Rapido"}</div>
            <div className="text-xs text-slate-400">{new Date(order.createdAt).toLocaleString("it-IT")}</div>
            {covers > 0 && (
              <div className="text-xs text-slate-500">
                {covers} coperti{coverPrice > 0 ? ` × €${coverPrice.toFixed(2)} = €${coverTotal.toFixed(2)}` : ""}
              </div>
            )}
          </div>
          <div className="space-y-1 max-h-44 overflow-y-auto">
            {items.map((item, i) => {
              const sub = parseFloat(item.subtotal);
              return (
                <div key={i} className="flex justify-between gap-2">
                  <span className="truncate">{item.quantity}x {item.productName}</span>
                  <span className="shrink-0">€ {isNaN(sub) ? "—" : sub.toFixed(2)}</span>
                </div>
              );
            })}
            {coverTotal > 0 && (
              <div className="flex justify-between gap-2 text-slate-500">
                <span>{covers}x Coperto</span>
                <span className="shrink-0">€ {coverTotal.toFixed(2)}</span>
              </div>
            )}
          </div>
          <div className="border-t-2 border-slate-300 pt-2 flex justify-between gap-2 text-base font-bold">
            <span>TOTALE</span>
            <span className="shrink-0">€ {safeGrandTotal.toFixed(2)}</span>
          </div>
          {printResult && (
            <div className={cn("text-center text-xs font-semibold px-3 py-2 rounded-lg", printResult.ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>
              {printResult.ok ? "✓ Preconto stampato sulla RT" : `RT: ${printResult.error ?? "non disponibile"} — usa Stampa Browser`}
            </div>
          )}
        </div>
        {/* Footer compatto su 2 righe: evita overflow su schermi piccoli */}
        <div className="flex flex-col gap-2 mt-1">
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleBrowserPrint} className="flex-1 gap-1.5 text-sm">
              <Printer className="h-3.5 w-3.5" /> Browser
            </Button>
            {orderId && (
              <Button onClick={handleStampa} disabled={printing} className="flex-1 gap-1.5 text-sm">
                {printing ? <span className="animate-spin">⏳</span> : <Printer className="h-3.5 w-3.5" />}
                {printing ? "Stampa…" : "Stampa RT"}
              </Button>
            )}
          </div>
          <Button variant="outline" onClick={onClose} className="w-full text-sm">Chiudi</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Split Bill: body riusabile (dialog + tab "tot" inline) ───────────────────
function SplitBillBody({ items, onPay, onCancel, coverPrice, coverCount, orderId }: {
  items: Array<{ id: number; productName: string; quantity: number; unitPrice: string; subtotal: string }>;
  onPay: (method: string, amount: number, itemIds: number[], coversToDeduct: number) => void;
  onCancel: () => void;
  coverPrice: number; coverCount: number; orderId?: number;
}) {
  const coverRows = coverPrice > 0 && coverCount > 0
    ? Array.from({ length: coverCount }, (_, i) => ({
        id: -(i + 1),
        productName: "Coperto",
        quantity: 1,
        unitPrice: coverPrice.toFixed(2),
        isCover: true,
      }))
    : [];
  const allRows = [...items.map(i => ({ ...i, isCover: false })), ...coverRows];

  // qty[id] = selected quantity for this row (0 = not included)
  const [qty, setQty] = useState<Record<number, number>>({});
  const [method, setMethod] = useState<"cash" | "card" | "ticket" | "other">("cash");
  const { data: sbSettings = {} } = useSettings();
  const sbBuoniPastoOn = sbSettings["feat_buoni_pasto"] === "true";

  // ── Terminale POS (pagamento carta) ────────────────────────────────────────
  const sbPosTerminals = enabledPosTerminals(sbSettings);
  const [sbPosTerminal, setSbPosTerminal] = useState<PosTerminalId | null>(null);
  const sbActiveTerminal: PosTerminalId | null = sbPosTerminal ?? sbPosTerminals[0] ?? null;
  const [sbPosPhase, setSbPosPhase] = useState<"idle" | "waiting" | "manual_confirm" | "declined">("idle");
  const [sbPosError, setSbPosError] = useState<string | null>(null);

  function doIncassaFinale() {
    const ids = allRows.filter(r => (qty[r.id] ?? 0) > 0 && !r.isCover).map(r => r.id);
    const coversToDeduct = coverRows.filter(r => (qty[r.id] ?? 0) > 0).length;
    setSbPosPhase("idle");
    onPay(method, splitTotal, ids, coversToDeduct);
  }

  async function handleIncassa() {
    if (method === "card" && sbActiveTerminal) {
      setSbPosPhase("waiting");
      setSbPosError(null);
      try {
        const resp = await fetch(`${API}/pos/sale`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amountCents: Math.round(splitTotal * 100), orderId, terminal: sbActiveTerminal }),
        });
        const result = await resp.json();
        if (result.manualConfirmRequired) { setSbPosPhase("manual_confirm"); return; }
        if (result.approved) { doIncassaFinale(); return; }
        setSbPosPhase("declined");
        setSbPosError(result.error ?? result.responseMessage ?? "Transazione rifiutata");
      } catch {
        setSbPosPhase("declined");
        setSbPosError("Impossibile contattare il terminale POS. Verifica la connessione di rete.");
      }
      return;
    }
    doIncassaFinale();
  }

  function setRowQty(id: number, val: number, max: number) {
    setQty(q => ({ ...q, [id]: Math.min(max, Math.max(0, val)) }));
  }
  function selectAll() {
    setQty(Object.fromEntries(allRows.map(r => [r.id, r.quantity])));
  }
  function selectNone() { setQty({}); }

  const splitTotal = allRows.reduce((sum, r) => {
    const q = qty[r.id] ?? 0;
    return sum + q * parseFloat(r.unitPrice);
  }, 0);
  const hasSelection = allRows.some(r => (qty[r.id] ?? 0) > 0);

  return (
    <>
      <div className="space-y-3 py-1">
        <div className="flex justify-between items-center text-xs text-slate-500">
          <span>Seleziona le voci da pagare</span>
          <div className="flex gap-2">
            <button onClick={selectAll} className="text-primary hover:underline">Tutte</button>
            <button onClick={selectNone} className="text-slate-400 hover:underline">Nessuna</button>
          </div>
        </div>
          <div className="space-y-1.5 max-h-64 overflow-y-auto pr-0.5">
            {allRows.map(row => {
              const selected = qty[row.id] ?? 0;
              const unitPrice = parseFloat(row.unitPrice);
              const rowTotal = selected * unitPrice;
              const isActive = selected > 0;
              return (
                <div key={row.id} className={cn(
                  "flex items-center gap-2 p-2.5 rounded-lg border-2 transition-all",
                  isActive ? "border-primary bg-orange-50" : "border-slate-200 bg-white"
                )}>
                  {/* Name + price */}
                  <div className="flex-1 min-w-0">
                    <div className={cn("text-xs font-semibold truncate", row.isCover ? "text-slate-500 italic" : "text-slate-800")}>
                      {row.isCover && <Users className="inline h-3 w-3 mr-1" />}
                      {row.productName}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      €{unitPrice.toFixed(2)} cad. · max {row.quantity}
                    </div>
                  </div>

                  {/* Qty stepper */}
                  {row.quantity === 1 ? (
                    /* Simple toggle for qty=1 */
                    <button
                      onClick={() => setRowQty(row.id, selected === 0 ? 1 : 0, 1)}
                      className={cn("h-7 w-7 rounded-lg border-2 flex items-center justify-center transition-all",
                        isActive ? "border-primary bg-primary text-white" : "border-slate-300 hover:border-primary")}
                    >
                      {isActive ? <span className="text-[11px] font-bold">✓</span> : <span className="text-xs text-slate-400">·</span>}
                    </button>
                  ) : (
                    /* Stepper for qty>1 */
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => setRowQty(row.id, selected - 1, row.quantity)}
                        className="h-7 w-7 rounded-lg border-2 border-slate-200 flex items-center justify-center hover:border-primary hover:text-primary transition-all text-slate-600">
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className={cn("w-8 text-center text-sm font-bold tabular-nums",
                        isActive ? "text-primary" : "text-slate-400")}>
                        {selected}/{row.quantity}
                      </span>
                      <button onClick={() => setRowQty(row.id, selected + 1, row.quantity)}
                        className="h-7 w-7 rounded-lg border-2 border-slate-200 flex items-center justify-center hover:border-primary hover:text-primary transition-all text-slate-600">
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                  )}

                  {/* Row total */}
                  <span className={cn("text-xs font-bold w-14 text-right shrink-0",
                    isActive ? "text-primary" : "text-slate-300")}>
                    € {rowTotal.toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>

          {hasSelection && (
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
              <div className="flex justify-between font-bold text-slate-800">
                <span>Totale separato</span>
                <span className="text-primary text-sm">€ {splitTotal.toFixed(2)}</span>
              </div>
            </div>
          )}

          {hasSelection && (
            <div>
              <div className="text-xs font-semibold text-slate-500 mb-2">Metodo di pagamento</div>
              <div className={cn("grid gap-1.5", sbBuoniPastoOn ? "grid-cols-4" : "grid-cols-3")}>
                {((sbBuoniPastoOn ? ["cash", "card", "ticket", "other"] : ["cash", "card", "other"]) as Array<"cash"|"card"|"ticket"|"other">).map(m => {
                  const icons = { cash: <Banknote className="h-3.5 w-3.5" />, card: <CreditCard className="h-3.5 w-3.5" />, ticket: <Ticket className="h-3.5 w-3.5" />, other: <Wallet className="h-3.5 w-3.5" /> };
                  const labels = { cash: "Contanti", card: "Carta", ticket: "Buoni", other: "Altro" };
                  return (
                    <button key={m} onClick={() => setMethod(m)}
                      className={cn("flex items-center justify-center gap-1 py-2 rounded-lg text-[10px] font-semibold border-2 transition-colors",
                        method === m ? "border-primary bg-orange-50 text-primary" : "border-slate-200 text-slate-600")}>
                      {icons[m]} {labels[m]}
                    </button>
                  );
                })}
              </div>
              {method === "card" && (
                <div className="mt-2">
                  <PosTerminalPicker compact terminals={sbPosTerminals} value={sbActiveTerminal}
                    onChange={t => { setSbPosTerminal(t); setSbPosPhase("idle"); setSbPosError(null); }} />
                </div>
              )}
            </div>
          )}

          {sbPosPhase === "manual_confirm" && (
            <div className="p-3 bg-amber-50 rounded-xl border-2 border-amber-300 space-y-2">
              <p className="text-xs font-bold text-amber-800 text-center">
                Digita € {splitTotal.toFixed(2)} sul {sbActiveTerminal ? POS_TERMINAL_LABEL[sbActiveTerminal] : "terminale POS"} e fai pagare il cliente
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1 h-9 text-xs" onClick={() => setSbPosPhase("idle")}>Annulla</Button>
                <Button size="sm" className="flex-1 h-9 text-xs" onClick={doIncassaFinale}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Pagamento ricevuto
                </Button>
              </div>
            </div>
          )}

          {sbPosPhase === "declined" && sbPosError && (
            <div className="p-3 bg-red-50 rounded-xl border border-red-200 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-xs text-red-600">{sbPosError}</p>
              </div>
              <Button variant="outline" size="sm" className="w-full h-9 text-xs" onClick={doIncassaFinale}>
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Registra comunque incasso manuale
              </Button>
            </div>
          )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Annulla</Button>
        <Button
          onClick={handleIncassa}
          disabled={!hasSelection || sbPosPhase === "waiting"}
        >
          {sbPosPhase === "waiting"
            ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Terminale…</>
            : method === "card" && sbActiveTerminal
              ? <><CreditCard className="h-4 w-4 mr-2" />Avvia terminale € {splitTotal.toFixed(2)}</>
              : <>Incassa € {splitTotal.toFixed(2)}</>
          }
        </Button>
      </DialogFooter>
    </>
  );
}

// ─── Split Bill Dialog (thin wrapper attorno a SplitBillBody) ─────────────────
function SplitBillDialog({ open, onClose, items, onPay, coverPrice, coverCount }: {
  open: boolean; onClose: () => void;
  items: Array<{ id: number; productName: string; quantity: number; unitPrice: string; subtotal: string }>;
  onPay: (method: string, amount: number, itemIds: number[], coversToDeduct: number) => void;
  coverPrice: number; coverCount: number;
}) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Divide className="h-4 w-4" /> Conto Separato</DialogTitle></DialogHeader>
        {open && (
          <SplitBillBody
            items={items}
            coverPrice={coverPrice}
            coverCount={coverCount}
            onPay={(m, a, ids, c) => { onPay(m, a, ids, c); onClose(); }}
            onCancel={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Item Edit Dialog (solo modifica prezzo) ──────────────────────────────────
type EditableItem = { id: number; productName: string; quantity: number; unitPrice: string; notes?: string | null; status: string };

function ItemEditDialog({ open, onClose, item, onSave }: {
  open: boolean; onClose: () => void;
  item: EditableItem | null;
  onSave: (itemId: number, unitPrice: string) => void;
}) {
  const [price, setPrice] = useState("");

  useEffect(() => {
    if (open && item) {
      setPrice(parseFloat(item.unitPrice).toFixed(2));
    }
  }, [open, item]);

  if (!item) return null;

  const originalPrice = parseFloat(item.unitPrice);
  const currentPrice = parseFloat(price) || 0;
  const priceDiff = currentPrice - originalPrice;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-primary" />
            Modifica Prezzo
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50 rounded-xl">
            <div className="flex-1">
              <div className="font-semibold text-slate-800 text-sm">{item.productName}</div>
              <div className="text-xs text-slate-400">{item.quantity}× · Prezzo originale: €{originalPrice.toFixed(2)}</div>
            </div>
            {item.status === "sent" && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">Inviato</span>
            )}
          </div>

          {/* Modifica prezzo */}
          <div>
            <Label className="text-xs font-semibold text-slate-500 mb-1 block">
              Prezzo unitario
              {Math.abs(priceDiff) > 0.001 && (
                <span className={cn("ml-1.5 text-xs", priceDiff > 0 ? "text-emerald-600" : "text-red-500")}>
                  ({priceDiff > 0 ? "+" : ""}{priceDiff.toFixed(2)}€)
                </span>
              )}
            </Label>
            <div className="flex items-center gap-2">
              <span className="text-slate-500 text-sm">€</span>
              <Input
                type="number" step="0.01" min="0"
                value={price}
                onChange={e => setPrice(e.target.value)}
                className="text-center font-bold"
              />
              {Math.abs(priceDiff) > 0.001 && (
                <button onClick={() => setPrice(originalPrice.toFixed(2))}
                  className="text-xs text-slate-400 hover:text-primary whitespace-nowrap">
                  Ripristina
                </button>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annulla</Button>
          <Button onClick={() => { onSave(item.id, parseFloat(price).toFixed(2)); onClose(); }}>Salva</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Category Button (MOito-style large colored tile) ─────────────────────────
type PosCategory = { id: number; name: string; color?: string | null };
function CategoryButton({ cat, onClick }: { cat: PosCategory; onClick: () => void }) {
  const bg = cat.color ?? "#64748b";
  return (
    <button onClick={onClick}
      className="rounded-xl flex flex-col items-center justify-center p-3 min-h-[80px] active:scale-95 transition-all shadow-sm select-none"
      style={{ backgroundColor: bg }}>
      <span className="text-white font-bold text-sm text-center leading-tight uppercase tracking-wide drop-shadow">{cat.name}</span>
    </button>
  );
}

// ─── Product Card ──────────────────────────────────────────────────────────────
type PosProduct = { id: number; name: string; price: string; price2?: string; price3?: string; price4?: string; available: boolean; allergeni?: string | null };
function ProductCard({ product, onAdd, activePriceList, onToggleEsaurito }: {
  product: PosProduct;
  activePriceList: number;
  onAdd: (id: number, unitPrice: string) => void;
  onToggleEsaurito?: (id: number, available: boolean) => void;
}) {
  const priceFields = ["price", "price2", "price3", "price4"] as const;
  const fieldVal = product[priceFields[activePriceList]];
  const rawPrice = (fieldVal && parseFloat(fieldVal) > 0) ? fieldVal : product.price;
  const displayPrice = parseFloat(rawPrice || "0");
  const isAvailable = (product as unknown as { available?: boolean }).available !== false;

  // Long-press per toggle Esaurito
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const startPress = () => {
    longPressed.current = false;
    if (!onToggleEsaurito) return;
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      onToggleEsaurito(product.id, !isAvailable);
    }, 600);
  };
  const cancelPress = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  };

  return (
    <button
      onClick={() => { if (!longPressed.current && isAvailable) onAdd(product.id, rawPrice); }}
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onContextMenu={(e) => { e.preventDefault(); onToggleEsaurito?.(product.id, !isAvailable); }}
      className={cn(
        "relative bg-[#22263a] rounded-xl border-2 p-3 text-left hover:shadow-lg hover:shadow-primary/10 active:scale-95 transition-all group min-h-[88px] flex flex-col justify-between",
        isAvailable ? "border-[#2d3044] hover:border-primary" : "border-red-900 opacity-60 grayscale"
      )}
      title={isAvailable ? "Tocca a lungo per segnare come Esaurito" : "Esaurito — tocca a lungo per ripristinare"}
    >
      {!isAvailable && (
        <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded-md bg-red-700 text-white text-[9px] font-bold uppercase tracking-wide">Esaurito</span>
      )}
      {product.allergeni && product.allergeni.trim() && (
        <span
          className="absolute top-1 left-1 h-4 w-4 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center shadow-md ring-1 ring-red-300"
          title={`Allergeni: ${product.allergeni}`}
        >!</span>
      )}
      <div className="font-semibold text-sm text-slate-200 leading-snug group-hover:text-primary transition-colors line-clamp-3">{product.name}</div>
      <div className="text-base font-bold text-primary mt-2">€ {displayPrice.toFixed(2)}</div>
    </button>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="col-span-full flex flex-col items-center justify-center h-40 text-slate-400">
      <UtensilsCrossed className="h-8 w-8 mb-2 opacity-25" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

// ─── Inline Payment Panel (TOT tab) ────────────────────────────────────────────
const DENOMINATIONS = [200, 100, 50, 20, 10, 5, 2, 1, 0.5];
function InlinePaymentPanel({ total, onPay, disabled, alertAnomalous, orderId }: {
  total: number;
  disabled: boolean;
  onPay: (method: string, amountGiven?: number) => void;
  alertAnomalous?: boolean;
  orderId?: number;
}) {
  const handleConfirmedPay = (method: string, amount?: number) => {
    if (alertAnomalous && (total < 1 || total > 500)) {
      const reason = total < 1 ? "molto basso" : "molto alto";
      if (!window.confirm(`Totale ${reason}: € ${total.toFixed(2)}\n\nConfermi l'incasso?`)) return;
    }
    onPay(method, amount);
  };
  const [method, setMethod] = useState<"cash" | "card" | "ticket" | "other">("cash");
  const [given, setGiven] = useState("");
  const givenNum = parseFloat(given) || 0;
  const change = method === "cash" && givenNum >= total ? givenNum - total : 0;
  const canPay = !disabled && total > 0 && (method !== "cash" || givenNum >= total);

  // ── Terminale POS (pagamento carta) ────────────────────────────────────────
  const { data: ipSettings = {} } = useSettings();
  const ipPosTerminals = enabledPosTerminals(ipSettings);
  const [ipPosTerminal, setIpPosTerminal] = useState<PosTerminalId | null>(null);
  const ipActiveTerminal: PosTerminalId | null = ipPosTerminal ?? ipPosTerminals[0] ?? null;
  const [ipPosPhase, setIpPosPhase] = useState<"idle" | "waiting" | "manual_confirm" | "declined">("idle");
  const [ipPosError, setIpPosError] = useState<string | null>(null);
  const ipAttemptRef = useRef(0);

  async function handleIncassaClick() {
    if (method === "card" && ipActiveTerminal) {
      if (alertAnomalous && (total < 1 || total > 500)) {
        const reason = total < 1 ? "molto basso" : "molto alto";
        if (!window.confirm(`Totale ${reason}: € ${total.toFixed(2)}\n\nConfermi l'incasso?`)) return;
      }
      const attempt = ++ipAttemptRef.current;
      setIpPosPhase("waiting");
      setIpPosError(null);
      try {
        const resp = await fetch(`${API}/pos/sale`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amountCents: Math.round(total * 100), orderId, terminal: ipActiveTerminal }),
        });
        const result = await resp.json();
        if (attempt !== ipAttemptRef.current) return; // annullato dall'utente: ignora esito tardivo
        if (result.manualConfirmRequired) { setIpPosPhase("manual_confirm"); return; }
        if (result.approved) { setIpPosPhase("idle"); onPay(method, undefined); return; }
        setIpPosPhase("declined");
        setIpPosError(result.error ?? result.responseMessage ?? "Transazione rifiutata");
      } catch {
        if (attempt !== ipAttemptRef.current) return;
        setIpPosPhase("declined");
        setIpPosError("Impossibile contattare il terminale POS. Verifica la connessione di rete.");
      }
      return;
    }
    handleConfirmedPay(method, method === "cash" ? givenNum : undefined);
  }

  return (
    <div className="flex-1 overflow-hidden bg-[#f4f6fa] p-3 flex flex-col gap-2.5 relative">
      {/* Total */}
      <div className="bg-slate-800 rounded-2xl px-4 py-3 text-center shrink-0">
        <div className="text-[10px] text-slate-400 uppercase tracking-widest mb-0.5">Totale da pagare</div>
        <div className="text-4xl font-bold text-white font-mono">€ {total.toFixed(2)}</div>
      </div>

      {/* Method selector */}
      <div className="grid grid-cols-3 gap-2 shrink-0">
        {([["cash","CONTANTI","text-emerald-500"],["card","BANCOMAT","text-blue-500"],["other","ALTRO","text-purple-500"]] as const).map(([id, label, col]) => (
          <button key={id} onClick={() => { setMethod(id as typeof method); setIpPosPhase("idle"); setIpPosError(null); }}
            className={cn("py-2.5 rounded-xl font-bold text-sm border-2 transition-all active:scale-95",
              method === id ? "border-primary bg-primary text-white shadow-lg" : "border-slate-200 bg-white text-slate-700 hover:border-primary")}>
            <div className={cn("text-lg mb-0.5", method === id ? "text-white" : col)}>
              {id === "cash" ? "💵" : id === "card" ? "💳" : "💼"}
            </div>
            {label}
          </button>
        ))}
      </div>

      {/* Scelta terminale POS (solo carta, più terminali abilitati) */}
      {method === "card" && (
        <div className="shrink-0">
          <PosTerminalPicker compact terminals={ipPosTerminals} value={ipActiveTerminal}
            onChange={t => { setIpPosTerminal(t); setIpPosPhase("idle"); setIpPosError(null); }} />
        </div>
      )}

      {/* Errore terminale + fallback manuale */}
      {ipPosPhase === "declined" && ipPosError && (
        <div className="p-3 bg-red-50 rounded-xl border border-red-200 space-y-2 shrink-0">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
            <p className="text-xs text-red-600">{ipPosError}</p>
          </div>
          <Button variant="outline" size="sm" className="w-full h-9 text-xs"
            onClick={() => { setIpPosPhase("idle"); onPay(method, undefined); }}>
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Registra comunque incasso manuale
          </Button>
        </div>
      )}

      {/* Cash input */}
      {method === "cash" && (
        <>
          <div className="bg-white rounded-2xl border-2 border-slate-200 px-4 py-2.5 shrink-0">
            <div className="text-[10px] text-slate-500 mb-1 font-semibold uppercase tracking-wide">Importo ricevuto</div>
            <Input type="number" step="0.01" placeholder="0.00" value={given}
              onChange={e => setGiven(e.target.value)}
              className="text-2xl font-bold text-center h-11 border-0 bg-slate-50 rounded-xl" />
          </div>
          {/* Denomination buttons */}
          <div className="grid grid-cols-5 gap-1 shrink-0">
            {DENOMINATIONS.map(d => (
              <button key={d} onClick={() => setGiven(d.toString())}
                className="py-1.5 rounded-lg bg-white border-2 border-slate-200 text-xs font-bold text-slate-700 hover:border-primary hover:text-primary active:scale-90 transition-all">
                {d >= 1 ? `€${d}` : `${(d * 100).toFixed(0)}¢`}
              </button>
            ))}
          </div>
          {givenNum >= total && total > 0 && (
            <div className="flex justify-between items-center px-4 py-2.5 bg-emerald-50 border-2 border-emerald-200 rounded-2xl shrink-0">
              <span className="text-sm font-semibold text-emerald-700">Resto</span>
              <span className="text-2xl font-bold text-emerald-700 font-mono">€ {change.toFixed(2)}</span>
            </div>
          )}
        </>
      )}

      {/* Confirm */}
      <button
        disabled={!canPay || ipPosPhase === "waiting"}
        onClick={handleIncassaClick}
        className={cn(
          "w-full py-3 rounded-xl text-base font-bold transition-all active:scale-95 mt-auto shrink-0",
          canPay && ipPosPhase !== "waiting" ? "bg-primary text-white shadow-lg hover:bg-primary/90" : "bg-slate-200 text-slate-400 cursor-not-allowed"
        )}>
        {disabled ? "Nessun ordine aperto"
          : ipPosPhase === "waiting" ? "TERMINALE…"
          : canPay
            ? (method === "card" && ipActiveTerminal ? `AVVIA TERMINALE  € ${total.toFixed(2)}` : `INCASSA  € ${total.toFixed(2)}`)
            : "Inserire importo"}
      </button>

      {/* Overlay attesa / conferma manuale terminale */}
      {(ipPosPhase === "waiting" || ipPosPhase === "manual_confirm") && (
        <div className="absolute inset-0 z-20 bg-white/95 flex flex-col items-center justify-center gap-4 p-4 rounded-none">
          {ipPosPhase === "waiting" ? (
            <>
              <div className="h-16 w-16 rounded-full bg-blue-50 border-4 border-blue-200 flex items-center justify-center animate-pulse">
                <CreditCard className="h-7 w-7 text-blue-600" />
              </div>
              <div className="text-center">
                <p className="font-bold text-lg text-slate-800">In attesa del terminale…</p>
                <p className="text-sm text-slate-500 mt-1">
                  {ipActiveTerminal === "pax" ? "Avvicina/inserisci carta sul Nexi PAX D230" : "Inserisci l'importo sul terminale myPOS"}
                </p>
                <p className="text-2xl font-bold text-primary mt-2">€ {total.toFixed(2)}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => { ipAttemptRef.current++; setIpPosPhase("idle"); }}>Annulla</Button>
            </>
          ) : (
            <>
              <div className="h-16 w-16 rounded-full bg-orange-50 border-4 border-orange-200 flex items-center justify-center">
                <CreditCard className="h-7 w-7 text-primary" />
              </div>
              <div className="text-center">
                <p className="font-bold text-lg text-slate-800">
                  Pagamento sul terminale {ipActiveTerminal ? POS_TERMINAL_LABEL[ipActiveTerminal] : "POS"}
                </p>
                <p className="text-sm text-slate-500 mt-1">Digita l'importo sul terminale e fai pagare il cliente</p>
                <p className="text-3xl font-bold text-primary mt-2">€ {total.toFixed(2)}</p>
              </div>
              <div className="flex gap-2 w-full max-w-xs">
                <Button variant="outline" className="flex-1 h-10 text-sm" onClick={() => setIpPosPhase("idle")}>Annulla</Button>
                <Button className="flex-1 h-10 text-sm" onClick={() => { setIpPosPhase("idle"); onPay(method, undefined); }}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Pagamento ricevuto
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function FrontOffice() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: settings = {} } = useSettings();
  const { user: foUser } = useAuth();
  const foIsAdmin = foUser?.role === "admin";
  const priceLocked = settings["feat_price_lock"] === "true" && !foIsAdmin;

  const coverPrice = parseFloat(settings["cover_price"] || "0");

  // State
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [quickOrderId, setQuickOrderId] = useState<number | null>(null);
  const [isQuickMode, setIsQuickMode] = useState<"rapida" | "asporto" | "delivery" | null>(null);
  const [isAssigningTable, setIsAssigningTable] = useState(false);
  const [assignPendingTableId, setAssignPendingTableId] = useState<number | null>(null);

  // Move / merge dialog
  const [moveMergeDialog, setMoveMergeDialog] = useState<{
    type: "move" | "merge"; fromTable: FETable; toTable: FETable;
  } | null>(null);

  // MOito-style state
  const [numBuffer, setNumBuffer] = useState(""); // numpad buffer
  const [numpadMode, setNumpadMode] = useState<"qty" | "price">("qty"); // what the numpad applies to
  const [activePriceList, setActivePriceList] = useState(0); // 0=Servito 1=Asporto 2=Fidelity 3=Staff
  const [rightTab, setRightTab] = useState<"grp" | "art" | "var" | "tavl" | "clnt" | "tot">("tavl");
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [mobilePanel, setMobilePanel] = useState<"left" | "right">("right");

  // Log console
  type LogEntry = { id: number; ts: string; level: "info" | "warn" | "error"; msg: string };
  const [showLog, setShowLog] = useState(false);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const logIdRef = useRef(0);
  const addLog = useCallback((level: "info" | "warn" | "error", msg: string) => {
    const entry: LogEntry = { id: ++logIdRef.current, ts: new Date().toLocaleTimeString("it-IT"), level, msg };
    setLogEntries(prev => [entry, ...prev].slice(0, 80));
  }, []);

  // KP resend after item modification
  const [kpResendPending, setKpResendPending] = useState(false);

  // Invoice customer (selected in CLNT tab)
  const [invoiceCustomer, setInvoiceCustomer] = useState<SimpleCustomer | null>(null);
  const [invoiceNumero, setInvoiceNumero] = useState("");
  const [invoiceAnno, setInvoiceAnno] = useState(String(new Date().getFullYear()));
  const [clntSearch, setClntSearch] = useState("");
  const [clntResults, setClntResults] = useState<SimpleCustomer[]>([]);
  const [clntSearching, setClntSearching] = useState(false);
  const [showNewClntForm, setShowNewClntForm] = useState(false);
  const { data: allCustomers = [] } = useQuery<SimpleCustomer[]>({
    queryKey: ["customers-all"],
    queryFn: () => fetch(`${API}/customers`).then(r => r.json()),
  });

  // Dialog state
  const [showPayment, setShowPayment] = useState(false);
  const [showCovers, setShowCovers] = useState(false);
  const [showEditCovers, setShowEditCovers] = useState(false);
  const [showRomana, setShowRomana] = useState(false);
  const [showPreconto, setShowPreconto] = useState(false);
  const [showSplitBill, setShowSplitBill] = useState(false);
  // Modalità pagamento mostrata nella tab "tot": full = pagamento intero, split = conto separato inline, romana = romana inline
  const [paymentMode, setPaymentMode] = useState<"full" | "split" | "romana">("full");
  const [showLotteria, setShowLotteria] = useState(false);
  const [lotteriaCodice, setLotteriaCodice] = useState(""); // codice confermato per l'ordine attivo
  const [lotteriaInput, setLotteriaInput] = useState("");   // input nel dialog
  const [lotteriaLoading, setLotteriaLoading] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [pendingTableId, setPendingTableId] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ itemId: number; name: string } | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [showDiscount, setShowDiscount] = useState(false);
  const [showSospeso, setShowSospeso] = useState(false);
  const [showTableActions, setShowTableActions] = useState(false);
  const [editingItem, setEditingItem] = useState<EditableItem | null>(null);
  const [kpComment, setKpComment] = useState("");
  const [kpSaving, setKpSaving] = useState(false);
  const [modifierPicker, setModifierPicker] = useState<{ productId: number; productName: string; unitPrice: string; itemId?: number } | null>(null);
  const [selectedModifierIds, setSelectedModifierIds] = useState<Set<number>>(new Set());
  const [pickerKpNote, setPickerKpNote] = useState("");
  const [pickerModFilter, setPickerModFilter] = useState<"all" | "plus" | "minus">("all");
  const [varModFilter, setVarModFilter] = useState<"all" | "plus" | "minus">("all");
  const [selectedItemCategoryId, setSelectedItemCategoryId] = useState<number | null>(null);

  const { data: tablesStatus = [] } = useGetTablesStatus();
  const { data: categories = [] } = useListCategories();
  const { data: products = [] } = useListProducts();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [comandaBanner, setComandaBanner] = useState<string | null>(null);

  type FEModifier = { id: number; label: string; type: string; priceExtra: string };
  const { data: categoryModifiers = [] } = useQuery<FEModifier[]>({
    queryKey: ["category-modifiers", selectedCategoryId],
    queryFn: () => selectedCategoryId
      ? fetch(`${API}/modifiers/by-category/${selectedCategoryId}`).then(r => r.json())
      : Promise.resolve([]),
    enabled: !!selectedCategoryId,
    staleTime: 30000,
  });

  const { data: selectedItemModifiers = [] } = useQuery<FEModifier[]>({
    queryKey: ["category-modifiers-item", selectedItemCategoryId],
    queryFn: () => selectedItemCategoryId
      ? fetch(`${API}/modifiers/by-category/${selectedItemCategoryId}`).then(r => r.json())
      : Promise.resolve([]),
    enabled: !!selectedItemCategoryId,
    staleTime: 30000,
  });

  const activeTableEntry = tablesStatus.find(t => t.id === selectedTableId) as FETable | undefined;
  const activeOrderId = isQuickMode
    ? quickOrderId ?? undefined
    : (activeTableEntry?.activeOrderId as number | undefined);

  const { data: activeOrder } = useGetOrder(activeOrderId!, { enabled: !!activeOrderId } as never);
  const items = activeOrder?.items ?? [];
  const subtotal = parseFloat(activeOrder?.total ?? "0");
  const coverCount = isQuickMode ? 0 : ((activeOrder as unknown as { covers?: number })?.covers ?? 0);
  const coverTotal = coverPrice > 0 && coverCount > 0 ? coverCount * coverPrice : 0;
  const total = subtotal + coverTotal;
  const paidRomana = parseFloat((activeOrder as unknown as { paidRomana?: string })?.paidRomana ?? "0");
  // Importo residuo dopo eventuali quote alla romana già pagate
  const totalNettoRomana = Math.max(0, Math.round((total - paidRomana) * 100) / 100);
  const hasDraftItems = items.some(i => (i as never as { status: string }).status === "draft");
  const hasSentItems = items.some(i => (i as never as { status: string }).status === "sent");

  const addItem = useAddOrderItem();
  const updateItem = useUpdateOrderItem();
  const deleteItem = useDeleteOrderItem();
  const createPayment = useCreatePayment();

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: getGetTablesStatusQueryKey() });
    if (activeOrderId) qc.invalidateQueries({ queryKey: getGetOrderQueryKey(activeOrderId) });
    qc.invalidateQueries({ queryKey: getListOrdersQueryKey() });
  }, [qc, activeOrderId]);

  const prevTableIdRef = useRef<number | null>(null);
  const hasDraftItemsRef = useRef(false);
  useEffect(() => { hasDraftItemsRef.current = hasDraftItems; }, [hasDraftItems]);

  const selectedItem = items.find(i => i.id === selectedItemId);
  useEffect(() => {
    if (!selectedItem) { setSelectedItemCategoryId(null); return; }
    fetch(`${API}/products/${selectedItem.productId}`)
      .then(r => r.ok ? r.json() : null)
      .then(p => setSelectedItemCategoryId(p?.categoryId ?? null))
      .catch(() => setSelectedItemCategoryId(null));
  }, [selectedItem?.productId]);

  useEffect(() => {
    setKpComment((selectedItem as never as { notes?: string | null })?.notes ?? "");
  }, [selectedItemId]);

  const sendComandaForOrder = useCallback(async (orderId: number) => {
    await fetch(`${API}/orders/${orderId}/send-comanda`, { method: "POST" }).catch(() => {});
  }, []);

  useEffect(() => {
    const prevId = prevTableIdRef.current;
    if (prevId !== null && prevId !== selectedTableId && hasDraftItemsRef.current) {
      const prevOrderId = (tablesStatus.find(t => t.id === prevId) as FETable | undefined)?.activeOrderId as number | undefined;
      if (prevOrderId) {
        sendComandaForOrder(prevOrderId).then(() => {
          qc.invalidateQueries({ queryKey: getGetTablesStatusQueryKey() });
          toast({ title: "Comanda inviata", description: "Tavolo precedente: righe inviate al reparto" });
        });
      }
    }
    prevTableIdRef.current = selectedTableId;
  }, [selectedTableId]);

  useEffect(() => {
    if (!selectedTableId && !isQuickMode) {
      setSelectedItemId(null);
      setSelectedCategoryId(null);
      setSelectedItemCategoryId(null);
      setKpComment("");
      setNumBuffer("");
      // Reset modalità pagamento quando si lascia il tavolo, così la prossima apertura parte sempre su "Totale"
      setPaymentMode("full");
    }
  }, [selectedTableId, isQuickMode]);

  // Current phase (1=products, 2=table, 3=comanda sent, 4=payment)
  const currentPhase: 1 | 2 | 3 | 4 =
    showPayment ? 4
    : hasSentItems && !hasDraftItems ? 3
    : activeOrderId ? 2
    : 1;

  const orderLabel = isQuickMode === "rapida" ? "Scontrino Rapido"
    : isQuickMode === "asporto" ? "Asporto"
    : isQuickMode === "delivery" ? "Delivery"
    : activeTableEntry?.name ?? "";

  const ModeIcon = isQuickMode === "rapida" ? Zap
    : isQuickMode === "asporto" ? ShoppingBag
    : isQuickMode === "delivery" ? Truck
    : null;

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleTableClick(table: FETable) {
    const et = (table as FETable).elementType ?? "table";
    if (et !== "table") return;

    // "Assegna Tavolo" mode OR quick mode with active order → move order to table
    if ((isAssigningTable || isQuickMode) && quickOrderId) {
      if (table.activeOrderId) {
        toast({ title: "Tavolo occupato", description: "Scegli un tavolo libero per spostare l'ordine", variant: "destructive" });
        return;
      }
      setAssignPendingTableId(table.id);
      setPendingTableId(table.id);
      setShowCovers(true);
      return;
    }

    setIsQuickMode(null);
    setQuickOrderId(null);
    setRightTab("grp");
    if (!table.activeOrderId) {
      setPendingTableId(table.id);
      setShowCovers(true);
    } else {
      setSelectedTableId(table.id);
      setSelectedCategoryId(null);
    }
  }

  function handleMapTableClick(table: FETable) {
    if (table.elementType !== "table") { handleTableClick(table); return; }
    const activeTs = tablesStatus as FETable[];
    const fromTable = activeTs.find(t => t.id === selectedTableId);
    const hasActiveOrder = !!(fromTable?.activeOrderId) && activeOrderId != null;

    if (hasActiveOrder && fromTable && table.id !== selectedTableId) {
      if (!table.activeOrderId) {
        setMoveMergeDialog({ type: "move", fromTable, toTable: table });
      } else {
        setMoveMergeDialog({ type: "merge", fromTable, toTable: table });
      }
      return;
    }
    handleTableClick(table);
  }

  async function handleMoveTable() {
    if (!moveMergeDialog || !activeOrderId) return;
    const { toTable } = moveMergeDialog;
    setMoveMergeDialog(null);
    try {
      await fetch(`${API}/orders/${activeOrderId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId: toTable.id }),
      });
      setSelectedTableId(toTable.id);
      setRightTab("grp");
      setMobilePanel("left");
      refresh();
      toast({ title: "Ordine spostato", description: `Tavolo ${toTable.name}` });
    } catch {
      toast({ title: "Errore spostamento", variant: "destructive" });
    }
  }

  async function handleMergeTable() {
    if (!moveMergeDialog || !activeOrderId) return;
    const { toTable } = moveMergeDialog;
    if (!toTable.activeOrderId) return;
    setMoveMergeDialog(null);
    try {
      await fetch(`${API}/orders/${activeOrderId}/merge-into/${toTable.activeOrderId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
      });
      setSelectedTableId(toTable.id);
      setRightTab("grp");
      setMobilePanel("left");
      refresh();
      toast({ title: "Conti unificati", description: `Tutti gli articoli ora su ${toTable.name}` });
    } catch {
      toast({ title: "Errore unificazione", variant: "destructive" });
    }
  }

  async function handleAssignToTable(covers: number) {
    if (!assignPendingTableId || !quickOrderId) return;
    setShowCovers(false);
    try {
      await fetch(`${API}/orders/${quickOrderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId: assignPendingTableId, covers }),
      });
      await fetch(`${API}/orders/${quickOrderId}/covers`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ covers }),
      });
      setSelectedTableId(assignPendingTableId);
      setIsQuickMode(null);
      setQuickOrderId(null);
      setIsAssigningTable(false);
      setAssignPendingTableId(null);
      setPendingTableId(null);
      setRightTab("grp");
      setMobilePanel("left");
      refresh();
      toast({ title: "Ordine assegnato al tavolo" });
    } catch {
      toast({ title: "Errore assegnazione", variant: "destructive" });
    }
  }

  async function handleOpenTable(covers: number) {
    if (assignPendingTableId) { await handleAssignToTable(covers); return; }
    if (!pendingTableId) return;
    setShowCovers(false);
    try {
      const res = await fetch(`${API}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId: pendingTableId, covers }),
      });
      if (!res.ok) throw new Error();
      setSelectedTableId(pendingTableId);
      setSelectedCategoryId(null);
      setRightTab("grp");
      setMobilePanel("left");
      refresh();
    } catch { toast({ title: "Errore apertura tavolo", variant: "destructive" }); }
    finally { setPendingTableId(null); }
  }

  async function handleEditCovers(newCovers: number) {
    if (!activeOrderId) return;
    setShowEditCovers(false);
    try {
      const res = await fetch(`${API}/orders/${activeOrderId}/covers`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ covers: newCovers }),
      });
      if (!res.ok) throw new Error();
      qc.invalidateQueries({ queryKey: getGetOrderQueryKey(activeOrderId) });
      refresh();
      toast({ title: `Coperti aggiornati: ${newCovers}` });
    } catch { toast({ title: "Errore aggiornamento coperti", variant: "destructive" }); }
  }

  async function handleQuickMode(mode: "rapida" | "asporto" | "delivery") {
    setSelectedTableId(null);
    const notes = mode === "rapida" ? "Scontrino Rapido" : mode === "asporto" ? "Asporto" : "Delivery";
    const res = await fetch(`${API}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tableId: null, covers: 0, notes }),
    });
    const order = await res.json();
    setIsQuickMode(mode);
    setQuickOrderId(order.id);
    setSelectedCategoryId(null);
    refresh();
  }

  function handleExitOrder() {
    setSelectedTableId(null);
    setIsQuickMode(null);
    setQuickOrderId(null);
    setSelectedCategoryId(null);
    setLotteriaCodice("");
    setLotteriaInput("");
    setInvoiceCustomer(null);
    setSelectedItemId(null);
    setNumBuffer("");
    refresh();
  }

  async function handleLotteria() {
    const codice = lotteriaInput.toUpperCase().trim();
    if (!/^[A-Z0-9]{8}$/.test(codice)) return;
    setLotteriaLoading(true);
    try {
      // Codice puramente locale, viaggia col PROSSIMO pagamento via body.lotteria
      // e poi viene cancellato (one-shot). Niente persistenza globale lato server:
      // altrimenti la RT riceverebbe lo stesso codice sugli scontrini successivi
      // (errore 137 "codice lotteria già usato").
      setLotteriaCodice(codice);
      setShowLotteria(false);
      toast({ title: "Codice lotteria pronto", description: `${codice} sarà incluso nel prossimo scontrino` });
    } finally {
      setLotteriaLoading(false);
    }
  }

  async function handleCancelOrder() {
    if (!activeOrderId) return;
    const reason = cancelReason.trim();
    try {
      await fetch(`${API}/orders/${activeOrderId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason || null }),
      });
      toast({ title: "Ordine annullato", description: reason ? `Motivo: ${reason}` : "Il tavolo è stato liberato" });
    } catch {
      toast({ title: "Errore durante l'annullamento", variant: "destructive" });
    }
    setShowCancelConfirm(false);
    setCancelReason("");
    handleExitOrder();
  }

  function handleNumpadKey(key: string) {
    if (key === "X") { setNumBuffer(""); return; }
    if (key === ".") { if (!numBuffer.includes(".")) setNumBuffer(b => b + "."); return; }
    setNumBuffer(b => (b.length < 5 ? b + key : b));
  }

  async function doAddProduct(productId: number, unitPrice: string, mods: FEModifier[], notes?: string) {
    // If numBuffer has a value, use it as the price override (not quantity)
    const priceOverride = numBuffer ? parseFloat(numBuffer) : null;
    const qty = 1;
    if (priceOverride !== null && !isNaN(priceOverride) && priceOverride > 0) {
      unitPrice = priceOverride.toFixed(2);
    }
    setNumBuffer("");
    let orderId = activeOrderId;
    if (!orderId) {
      const res = await fetch(`${API}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId: null, covers: 0, notes: "Scontrino Rapido" }),
      });
      const order = await res.json();
      setIsQuickMode("rapida");
      setQuickOrderId(order.id);
      setSelectedTableId(null);
      setMobilePanel("left");
      orderId = order.id;
    }
    const modJson = JSON.stringify(mods.map(m => ({ id: m.id, label: m.label, type: m.type, priceExtra: m.priceExtra })));
    const effectivePrice = mods.reduce((acc, m) => acc + parseFloat(m.priceExtra || "0"), parseFloat(unitPrice));
    const finalPrice = effectivePrice.toFixed(2);
    const kpNote = notes?.trim() || undefined;
    // Only merge into existing item if no modifiers and no KP note
    const existing = (mods.length === 0 && !kpNote) ? items.find(i =>
      i.productId === productId &&
      (i as never as { phase: number }).phase === activePriceList &&
      i.unitPrice === unitPrice &&
      ((i as never as { modifiers?: string }).modifiers ?? "[]") === "[]" &&
      !(i as never as { notes?: string }).notes &&
      (i as never as { status: string }).status === "draft"
    ) : null;
    if (existing && orderId === activeOrderId && qty === 1) {
      await updateItem.mutateAsync({ orderId: orderId!, itemId: existing.id, data: { quantity: existing.quantity + 1 } });
    } else {
      await addItem.mutateAsync({ orderId: orderId!, data: { productId, quantity: qty, unitPrice: finalPrice, phase: activePriceList, modifiers: modJson, notes: kpNote ?? null } as never });
    }
    refresh();
  }

  async function handleAddProduct(productId: number, unitPrice: string) {
    await doAddProduct(productId, unitPrice, [], undefined);
  }

  async function confirmModifiers(withMods: boolean) {
    if (!modifierPicker) return;
    if (modifierPicker.itemId && activeOrderId) {
      // Editing an existing item's modifiers
      const availableMods = selectedItemModifiers.length > 0 ? selectedItemModifiers : categoryModifiers;
      const mods = withMods ? availableMods.filter(m => selectedModifierIds.has(m.id)) : [];
      const baseItem = items.find(i => i.id === modifierPicker.itemId);
      const basePrice = parseFloat((baseItem as never as { productPrice?: string })?.productPrice || baseItem?.unitPrice || modifierPicker.unitPrice);
      const priceAdj = mods.reduce((acc, m) => acc + parseFloat(m.priceExtra || "0"), 0);
      const newPrice = Math.max(0, basePrice + priceAdj).toFixed(2);
      await fetch(`${API}/orders/${activeOrderId}/items/${modifierPicker.itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modifiers: JSON.stringify(mods.map(m => ({ id: m.id, label: m.label, type: m.type, priceExtra: m.priceExtra }))),
          unitPrice: newPrice,
          notes: pickerKpNote.trim() || null,
        }),
      });
      refresh();
      setModifierPicker(null);
    } else {
      // Adding a new item
      const mods = withMods ? categoryModifiers.filter(m => selectedModifierIds.has(m.id)) : [];
      setModifierPicker(null);
      await doAddProduct(modifierPicker.productId, modifierPicker.unitPrice, mods, pickerKpNote);
    }
  }

  async function handleQty(itemId: number, qty: number) {
    if (!activeOrderId) return;
    const item = items.find(i => i.id === itemId);
    const wasSent = item && (item as never as { status: string }).status === "sent";
    if (qty <= 0) {
      // Conferma sempre la cancellazione (sia draft che sent) per evitare tap accidentali
      setDeleteConfirm({ itemId, name: item?.productName ?? "Articolo" });
      return;
    } else {
      addLog("info", `Qtà modificata: ${item?.productName} → ${qty}`);
      await updateItem.mutateAsync({ orderId: activeOrderId, itemId, data: { quantity: qty } });
      if (wasSent) setKpResendPending(true);
    }
    refresh();
  }

  async function confirmDelete(notify: boolean) {
    if (!deleteConfirm || !activeOrderId) return;
    const item = items.find(i => i.id === deleteConfirm.itemId);
    const wasSent = item && (item as never as { status: string }).status === "sent";
    if (notify && wasSent) {
      await fetch(`${API}/orders/${activeOrderId}/items/${deleteConfirm.itemId}/void`, { method: "POST" }).catch(() => {});
      toast({ title: "Avviso inviato al reparto", description: "Comanda di annullamento generata" });
    }
    addLog("info", `Articolo rimosso: ${deleteConfirm.name}`);
    await deleteItem.mutateAsync({ orderId: activeOrderId, itemId: deleteConfirm.itemId });
    refresh();
    setDeleteConfirm(null);
  }

  function selectNextAfter(removedId: number) {
    const idx = items.findIndex(i => i.id === removedId);
    const remaining = items.filter(i => i.id !== removedId);
    if (remaining.length === 0) {
      setSelectedItemId(null);
    } else {
      const nextIdx = Math.min(idx, remaining.length - 1);
      setSelectedItemId(remaining[nextIdx].id);
    }
    setNumBuffer("");
    setNumpadMode("qty");
  }

  function handleDeleteSelected() {
    if (!selectedItemId) return;
    const item = items.find(i => i.id === selectedItemId);
    if (!item) return;
    const wasSent = (item as never as { status: string }).status === "sent";
    selectNextAfter(selectedItemId);
    if (wasSent) {
      setDeleteConfirm({ itemId: item.id, name: item.productName });
    } else {
      handleQty(item.id, 0);
    }
  }

  /**
   * Espandi tutto: itera su TUTTI gli articoli del tavolo con qty>1 e li
   * separa in righe singole da 1. Utile come step preparatorio prima di un
   * conto separato o di una romana, così ogni voce diventa selezionabile.
   */
  async function handleExplodeAll() {
    if (!activeOrderId) return;
    const explodable = items.filter(i => i.quantity > 1);
    if (explodable.length === 0) {
      toast({ title: "Niente da esplodere", description: "Tutti gli articoli hanno già quantità 1" });
      return;
    }
    try {
      let totalNewRows = 0;
      for (const it of explodable) {
        const qty = it.quantity;
        await fetch(`${API}/orders/${activeOrderId}/items/${it.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quantity: 1 }),
        });
        for (let i = 1; i < qty; i++) {
          await fetch(`${API}/orders/${activeOrderId}/items`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              productId: it.productId,
              quantity: 1,
              unitPrice: it.unitPrice,
              phase: (it as never as { phase?: string }).phase ?? "F1",
              notes: (it as never as { notes?: string | null }).notes ?? null,
              modifiers: (it as never as { modifiers?: string }).modifiers ?? "[]",
            }),
          });
          totalNewRows++;
        }
      }
      setSelectedItemId(null);
      setNumBuffer("");
      refresh();
      addLog("info", `Esplosi ${explodable.length} articoli in ${explodable.length + totalNewRows} righe singole`);
      toast({ title: "Articoli esplosi", description: `${explodable.length + totalNewRows} righe da 1 pronte per conto separato` });
    } catch {
      addLog("error", "Errore durante l'esplosione articoli");
      toast({ title: "Errore esplosione", variant: "destructive" });
    }
  }

  async function handleSaveItemEdit(itemId: number, unitPrice: string) {
    if (!activeOrderId) return;
    await updateItem.mutateAsync({
      orderId: activeOrderId,
      itemId,
      data: { unitPrice } as never,
    });
    refresh();
    toast({ title: "Prezzo aggiornato" });
  }

  async function handleSendComanda() {
    if (!activeOrderId) return;
    try {
      const res = await fetch(`${API}/orders/${activeOrderId}/send-comanda`, { method: "POST" });
      if (!res.ok) throw new Error();
      const data = await res.json() as { sentItems: number; phases?: string };
      refresh();
      const phaseDesc = data.phases
        ? `${data.sentItems} art. — fasi: ${data.phases}`
        : `${data.sentItems} articoli`;
      addLog("info", `Comanda inviata — ${orderLabel} — ${phaseDesc}`);
      toast({ title: "Comanda inviata ai reparti", description: phaseDesc });
      setComandaBanner(`Comanda inviata · ${orderLabel} · ${phaseDesc}`);
      setTimeout(() => setComandaBanner(null), 2200);
      setSelectedTableId(null);
      setSelectedCategoryId(null);
      setSelectedItemId(null);
      setNumBuffer("");
    } catch (e) {
      addLog("error", `Errore invio comanda — ${String(e)}`);
      toast({ title: "Errore invio comanda", variant: "destructive" });
    }
  }

  async function applyNumpadToSelectedItem(forceMode?: "qty" | "price") {
    if (!selectedItemId || !numBuffer || !activeOrderId) return;
    const effectiveMode = forceMode ?? numpadMode;
    const val = parseFloat(numBuffer);
    if (isNaN(val) || val <= 0) { setNumBuffer(""); return; }
    if (effectiveMode === "qty") {
      const qty = Math.max(1, Math.round(val));
      setNumBuffer("");
      await handleQty(selectedItemId, qty);
    } else {
      setNumBuffer("");
      await fetch(`${API}/orders/${activeOrderId}/items/${selectedItemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unitPrice: val.toFixed(2) }),
      });
      const item = items.find(i => i.id === selectedItemId);
      addLog("info", `Prezzo modificato: ${item?.productName} → €${val.toFixed(2)}`);
      refresh();
      if (item && (item as never as { status: string }).status === "sent") setKpResendPending(true);
    }
  }

  async function handlePay(method: string, amountGiven?: number, invoiceCustomerId?: number, ragioneSocialeCliente?: string, itemIds?: number[], coversToDeduct = 0) {
    if (!activeOrderId) return;
    setShowPayment(false);
    const isGestionale = !!invoiceCustomerId;
    const isSplitPay = !!(itemIds?.length || coversToDeduct > 0);

    // Se ci sono quote alla romana già pagate, il pagamento normale deve usare il restante
    const effectiveTotal = paidRomana > 0 && !isSplitPay && !isGestionale
      ? totalNettoRomana
      : total;
    const payAmount = amountGiven !== undefined ? amountGiven : effectiveTotal;

    // ── Caso speciale: pagamento finale dopo romana parziale ─────────────────
    // Usa la route /fiscal/romana come ultima quota per emettere lo scontrino
    // corretto (solo il restante) e chiudere l'ordine.
    if (paidRomana > 0 && !isSplitPay && !isGestionale) {
      // Snapshot one-shot del codice lotteria: viene incluso in QUESTO pagamento
      // e poi cancellato così non si propaga ad altri ordini/scontrini.
      const lotteriaOneShot = lotteriaCodice || undefined;
      if (lotteriaOneShot) { setLotteriaCodice(""); setLotteriaInput(""); }
      try {
        const resp = await fetch(`${API}/fiscal/romana`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: activeOrderId,
            importo: payAmount.toFixed(2),
            metodoPagamento: method,
            quotaNum: 1,
            quoteTotali: 1,
            tableName: orderLabel ?? "",
            isUltima: true,
            lotteria: lotteriaOneShot,
          }),
        });
        const data = await resp.json();
        if (data.rtOk) {
          addLog("info", `RT OK — scontrino #${data.receiptId ?? "-"} — €${payAmount.toFixed(2)} ${method} (finale romana)`);
          toast({ title: "Scontrino fiscale emesso", description: `€${payAmount.toFixed(2)} — ${method}` });
        } else {
          addLog("error", `RT ERRORE (finale romana) — ${data.rtError ?? "errore sconosciuto"}`);
          toast({ title: "Scontrino non inviato alla RT", description: data.rtError ?? "Errore sconosciuto", variant: "destructive" });
        }
        if (data.orderClosed) handleExitOrder();
      } catch (e) {
        toast({ title: "Errore pagamento", description: String(e), variant: "destructive" });
      }
      refresh();
      toast({ title: "Pagamento registrato", description: `€ ${payAmount.toFixed(2)} — ${method}` });
      return;
    }

    // ── Pagamento normale (nessuna romana parziale precedente) ───────────────
    // Snapshot one-shot del codice lotteria: viene incluso in QUESTO pagamento
    // e poi cancellato così non si propaga ai successivi (anche su conto separato,
    // dove non passa per handleExitOrder).
    const lotteriaOneShot = lotteriaCodice || undefined;
    if (lotteriaOneShot) { setLotteriaCodice(""); setLotteriaInput(""); }

    // ── Payload fattura: inviato INSIEME al pagamento ─────────────────────
    // Il server crea pagamento + fattura nella stessa transazione: la fattura
    // non può più andare persa se il browser si blocca dopo il pagamento.
    let invoicePayload: Record<string, unknown> | undefined;
    if (invoiceCustomerId && items.length > 0) {
      const righe = items.map(i => ({
        descrizione: (i as never as { productName: string }).productName,
        quantita: (i as never as { quantity: number }).quantity,
        prezzoUnitario: (i as never as { unitPrice: string }).unitPrice,
        aliquotaIva: "22",
        // `importo` è il totale riga richiesto dall'XML FatturaPA (PrezzoTotale)
        importo: (i as never as { subtotal: string }).subtotal,
        imponibile: (i as never as { subtotal: string }).subtotal,
      }));
      const imponibile = righe.reduce((s, r) => s + parseFloat(r.imponibile || "0"), 0);
      const iva = imponibile * 0.22;
      const nParsed = parseInt(invoiceNumero, 10);
      const aParsed = parseInt(invoiceAnno, 10);
      invoicePayload = {
        customerId: invoiceCustomerId,
        orderId: activeOrderId,
        tipoDocumento: "TD01",
        imponibile: imponibile.toFixed(2),
        aliquotaIva: "22",
        iva: iva.toFixed(2),
        totale: (imponibile + iva).toFixed(2),
        righe,
        ...(!isNaN(nParsed) && invoiceNumero ? { numero: nParsed } : {}),
        ...(!isNaN(aParsed) && invoiceAnno ? { anno: aParsed } : {}),
      };
    }

    let paymentRes: unknown;
    try {
      paymentRes = await createPayment.mutateAsync({
      data: {
        orderId: activeOrderId,
        method,
        amount: payAmount.toFixed(2),
        change: method === "cash" && amountGiven !== undefined && amountGiven > effectiveTotal ? (amountGiven - effectiveTotal).toFixed(2) : undefined,
        lotteria: lotteriaOneShot,
        nonFiscale: isGestionale || undefined,
        ragioneSocialeCliente: ragioneSocialeCliente || undefined,
        // ── Conto separato: passa esplicitamente articoli + coperti pagati
        // e flag `partial` così il backend NON chiude l'ordine intero anche
        // quando l'utente paga solo coperti (caso senza itemIds).
        itemIds: itemIds && itemIds.length > 0 ? itemIds : undefined,
        coversCount: coversToDeduct > 0 ? coversToDeduct : undefined,
        partial: isSplitPay || undefined,
        invoice: invoicePayload,
        } as never
      });
    } catch (e) {
      addLog("error", `Pagamento FALLITO: ${e instanceof Error ? e.message : String(e)}`);
      toast({
        title: "Pagamento NON registrato",
        description: `${e instanceof Error ? e.message : String(e)} — l'ordine resta aperto, riprova.`,
        variant: "destructive",
      });
      refresh();
      return;
    }
    // Mostra risultato RT
    const fiscal = (paymentRes as never as { fiscal?: { rtOk?: boolean; rtError?: string; rtIp?: string; receiptId?: number; nonFiscale?: boolean } }).fiscal;
    if (fiscal) {
      if (fiscal.rtOk) {
        if (fiscal.nonFiscale) {
          addLog("info", `RT OK — documento NON FISCALE @ ${fiscal.rtIp ?? "RT"} — €${payAmount.toFixed(2)} ${method}`);
          toast({ title: "Documento non fiscale emesso", description: `RT ${fiscal.rtIp ?? ""} — documento gestionale` });
        } else {
          addLog("info", `RT OK — scontrino #${fiscal.receiptId} @ ${fiscal.rtIp ?? "RT"} — €${payAmount.toFixed(2)} ${method}`);
          toast({ title: "Scontrino fiscale emesso", description: `RT ${fiscal.rtIp ?? ""} — ricevuta #${fiscal.receiptId}` });
        }
      } else {
        addLog("error", `RT ERRORE — ${fiscal.rtError ?? "errore sconosciuto"}`);
        toast({
          title: isGestionale ? "Documento non inviato alla RT" : "Scontrino non inviato alla RT",
          description: fiscal.rtError ?? "Errore sconosciuto — controlla i log del server",
          variant: "destructive",
        });
      }
    } else {
      addLog("info", `Pagamento €${payAmount.toFixed(2)} — ${method} — ${orderLabel}`);
    }
    setInvoiceCustomer(null);
    if (invoicePayload) {
      // ── Fattura creata dal server insieme al pagamento ──────────────────
      // Qui gestiamo solo il download dell'XML: la fattura è GIÀ salvata sul
      // server (stessa transazione del pagamento), quindi anche se il download
      // fallisce resta recuperabile da Backoffice → Fatture.
      const invData = (paymentRes as never as {
        invoice?: { id: number; numero: number; anno: number; xml?: string; fileName?: string; emitError?: string; numeroFallback?: boolean };
      }).invoice;
      if (invData) {
        if (invData.numeroFallback) {
          addLog("error", `Numero fattura manuale già usato — assegnato automaticamente ${invData.numero}/${invData.anno}`);
        }
        if (invData.xml && invData.fileName) {
          try {
            const blob = new Blob([invData.xml], { type: "application/xml" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = invData.fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          } catch { /* download fallito: XML comunque recuperabile dal Backoffice */ }
          toast({ title: "Fattura emessa", description: `N. ${invData.numero}/${invData.anno} — XML scaricato` });
        } else {
          addLog("error", `Fattura ${invData.numero}/${invData.anno} salvata ma XML non generato${invData.emitError ? ` (${invData.emitError})` : ""}`);
          toast({
            title: "Fattura salvata ma non emessa",
            description: `N. ${invData.numero}/${invData.anno} — scarica l'XML da Backoffice → Fatture.`,
            variant: "destructive",
          });
        }
      } else {
        // Non dovrebbe succedere: il server avrebbe fallito l'intero pagamento
        addLog("error", "Risposta pagamento senza dati fattura — verifica in Backoffice → Fatture");
        toast({
          title: "Verifica fattura",
          description: "Controlla in Backoffice → Fatture che la fattura sia presente.",
          variant: "destructive",
        });
      }
      // Reset SEMPRE i campi fattura: un numero manuale obsoleto non deve
      // propagarsi al pagamento successivo.
      setInvoiceNumero("");
      setInvoiceAnno(String(new Date().getFullYear()));
      setInvoiceCustomer(null);
    } else if (isSplitPay) {
      // Elimina articoli pagati nel conto separato
      if (itemIds?.length) {
        await Promise.all(itemIds.map(itemId =>
          fetch(`${API}/orders/${activeOrderId}/items/${itemId}`, { method: "DELETE" }).catch(() => {})
        ));
      }
      // Scala i coperti pagati nel conto separato
      if (coversToDeduct > 0) {
        const newCovers = Math.max(0, coverCount - coversToDeduct);
        await fetch(`${API}/orders/${activeOrderId}/covers`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ covers: newCovers }),
        }).catch(() => {});
      }
    }
    if (!isSplitPay) handleExitOrder();
    refresh();
    toast({ title: "Pagamento registrato", description: `€ ${payAmount.toFixed(2)} — ${method}` });
  }

  const searchQ = productSearch.trim().toLowerCase();
  const visibleProducts = (searchQ
    ? products.filter(p => p.name.toLowerCase().includes(searchQ))
    : (selectedCategoryId != null
        ? products.filter(p => (p as unknown as { categoryId?: number }).categoryId === selectedCategoryId)
        : products)
  ).filter(p => p.available !== false);

  // ── Keyboard shortcut: "/" focuses product search, Esc clears it ─────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const editable = tag === "INPUT" || tag === "TEXTAREA" || (t?.isContentEditable ?? false);
      if (e.key === "/" && !editable && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setRightTab("art");
        setTimeout(() => searchInputRef.current?.focus(), 0);
      } else if (e.key === "Escape" && t === searchInputRef.current) {
        setProductSearch("");
        searchInputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Price list labels ────────────────────────────────────────────────────────
  const phaseLabels = ["F1", "F2", "F3", "F4"];

  // ── Numpad keys ─────────────────────────────────────────────────────────────
  const numpadKeys = ["7","8","9","4","5","6","1","2","3","X","0","."];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen overflow-hidden bg-[#151922] relative">
      {comandaBanner && (
        <div className="absolute top-0 left-0 right-0 z-50 bg-emerald-600 text-white text-center font-bold py-2.5 shadow-lg animate-in slide-in-from-top duration-200">
          ✓ {comandaBanner}
        </div>
      )}

      {/* ══ LEFT PANEL ════════════════════════════════════════════════════════ */}
      <div className={cn(
        "flex-col bg-[#1c2030] shrink-0 border-r border-[#37415c]",
        "w-full sm:w-[320px] lg:w-[340px]",
        mobilePanel === "left" ? "flex" : "hidden sm:flex"
      )}>

        {/* Header */}
        <div className="flex items-center justify-between px-2 py-1.5 border-b border-[#37415c] shrink-0 bg-[#171b27]">
          {/* Table name / brand — click to send comanda when drafts exist */}
          <button
            disabled={!activeOrderId && !selectedTableId}
            onClick={hasDraftItems ? handleSendComanda : () => setSelectedTableId(null)}
            className={cn(
              "min-w-0 flex-1 text-left px-2 py-1.5 rounded-lg transition-all select-none",
              activeOrderId && hasDraftItems
                ? "border-2 border-amber-500 bg-amber-900/30 hover:bg-amber-900/50 active:scale-95 cursor-pointer"
                : activeOrderId || selectedTableId
                  ? "border-2 border-[#49546f] bg-transparent hover:bg-[#242b3b] active:scale-95 cursor-pointer"
                  : "border-2 border-transparent cursor-default"
            )}>
            {activeOrderId ? (
              <div className="flex items-center gap-2">
                <div className="min-w-0">
                  <div className={cn(
                    "font-bold text-sm truncate flex items-center gap-1.5",
                    hasDraftItems ? "text-amber-400" : isQuickMode ? "text-blue-400" : "text-primary"
                  )}>
                    {hasDraftItems ? <Send className="h-3.5 w-3.5 shrink-0" /> : (ModeIcon ? <ModeIcon className="h-3.5 w-3.5 shrink-0 inline" /> : null)}
                    {orderLabel}
                  </div>
                  <div className="text-[10px] text-slate-400 flex items-center gap-1">
                    {coverCount > 0 && <span>{coverCount} cop.</span>}
                    {hasDraftItems && <span className="text-amber-500 font-semibold">· {items.filter(i => (i as never as { status: string }).status === "draft").length} da inviare — tocca per inviare</span>}
                  </div>
                </div>
                {hasDraftItems && (
                  <span className="ml-auto shrink-0 bg-amber-500 text-[#0f1117] text-[10px] font-extrabold rounded-full w-5 h-5 flex items-center justify-center animate-pulse">
                    {items.filter(i => (i as never as { status: string }).status === "draft").length}
                  </span>
                )}
              </div>
            ) : (
              <span className="font-bold text-slate-300 text-sm">
                Hello<span className="text-primary">Table</span>
              </span>
            )}
          </button>

          <div className="flex items-center gap-1 shrink-0 ml-1">
            <button onClick={() => setShowLog(v => !v)}
              className={cn(
                "h-8 w-8 rounded-lg flex items-center justify-center transition-colors relative",
                showLog ? "bg-primary/20 text-primary" : "text-slate-500 hover:text-slate-300 hover:bg-[#2d3044]"
              )}>
              <ScrollText className="h-3.5 w-3.5" />
              {logEntries.some(e => e.level === "error") && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500" />
              )}
            </button>
            <button onClick={() => { setRightTab("tavl"); setMobilePanel("right"); }}
              className={cn(
                "h-8 w-8 rounded-lg flex items-center justify-center transition-colors",
                rightTab === "tavl"
                  ? "bg-primary/20 text-primary"
                  : "text-slate-500 hover:text-slate-300 hover:bg-[#2d3044]"
              )}>
              <MapIcon className="h-3.5 w-3.5" />
            </button>
            <UserMenuButton showUserMenu={showUserMenu} setShowUserMenu={setShowUserMenu} />
          </div>
        </div>

        {/* Totale */}
        <div className="px-2.5 pt-2 pb-1 shrink-0">
          <div className="bg-[#171b27] rounded-xl px-3 py-2 flex items-center justify-between border border-[#37415c]">
            <div>
              {numBuffer ? (
                <div className="text-sm font-bold text-primary leading-none flex items-center gap-1">
                  {selectedItemId
                    ? (numpadMode === "price" ? <Euro className="h-3 w-3" /> : <Hash className="h-3 w-3" />)
                    : <Euro className="h-3 w-3" />}
                  {numBuffer}
                </div>
              ) : (
                <div className="text-[11px] font-medium text-slate-500">
                  {selectedItemId ? (
                    <span className="text-primary font-semibold">
                      {numpadMode === "price" ? "€ prezzo" : "qtà"} — inserisci valore
                    </span>
                  ) : activeOrderId ? "Ordine in corso" : "Nessun ordine"}
                </div>
              )}
              {coverTotal > 0 && (
                <div className="text-[10px] text-slate-500 mt-0.5">+€{coverTotal.toFixed(2)} cop.</div>
              )}
            </div>
            <div className="text-right">
              <div className="text-lg font-bold text-white font-mono tabular-nums">€{total.toFixed(2)}</div>
            </div>
          </div>
        </div>

        {/* Fasi F1–F4 */}
        <div className="px-2.5 pb-1 flex gap-1 shrink-0">
          {phaseLabels.map((label, i) => (
            <button key={i} onClick={() => setActivePriceList(i)}
              className={cn(
                "flex-1 py-1.5 rounded-md text-[11px] font-semibold transition-all",
                activePriceList === i
                  ? "bg-primary text-white shadow-sm"
                  : "bg-[#2a3143] text-slate-300 hover:bg-[#34405a] hover:text-slate-200"
              )}>
              {label}
            </button>
          ))}
        </div>

        {/* Codice lotteria scontrini — riga fissa sopra gli articoli */}
        {lotteriaCodice && (
          <div className="mx-2.5 mb-1 px-3 py-2 bg-amber-900/30 border border-amber-700/50 rounded-xl flex items-center gap-2 shrink-0">
            <Ticket className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <span className="text-[11px] text-amber-300 font-mono font-bold tracking-[0.2em]">{lotteriaCodice}</span>
            <span className="text-[9px] text-amber-600 ml-auto font-semibold uppercase tracking-wider">Lotteria</span>
          </div>
        )}

        {/* Lista articoli ordine */}
        <ScrollArea className="flex-1 min-h-0" onClick={() => setSelectedItemId(null)}>
          <div className="px-2.5 pb-1 space-y-0.5 pt-0.5">
            {items.length === 0 ? (
              <div className="text-center py-8 text-slate-600">
                <UtensilsCrossed className="h-7 w-7 mx-auto mb-2" />
                <div className="text-[11px]">
                  {activeOrderId ? "Seleziona prodotti dal menu" : "Seleziona un tavolo dalla mappa"}
                </div>
              </div>
            ) : (() => {
              // Raggruppa per fase e inserisce separatori visivi
              const phLabels = ["F1", "F2", "F3", "F4"];
              const grouped = new Map<number, typeof items>();
              for (const item of items) {
                const ph = (item as never as { phase?: number }).phase ?? 0;
                if (!grouped.has(ph)) grouped.set(ph, []);
                grouped.get(ph)!.push(item);
              }
              const phases = Array.from(grouped.keys()).sort((a, b) => a - b);
              const multiPhase = phases.length > 1;
              return phases.map(ph => (
                <div key={ph}>
                  {multiPhase && (
                    <div className="flex items-center gap-2 py-1 my-0.5">
                      <div className="h-px flex-1 bg-[#3a3f58]" />
                      <span className="text-[8px] font-bold text-slate-500 tracking-widest px-1 py-0.5 rounded bg-[#252840]">{phLabels[ph] ?? `F${ph + 1}`}</span>
                      <div className="h-px flex-1 bg-[#3a3f58]" />
                    </div>
                  )}
                  {grouped.get(ph)!.map(item => {
                const isDraft = (item as never as { status: string }).status === "draft";
                const itemNotes = (item as never as { notes?: string | null }).notes;
                const itemStatus = (item as never as { status: string }).status;
                const isSelected = item.id === selectedItemId;
                return (
                  <div key={item.id}
                    onClick={e => {
                      e.stopPropagation();
                      if (isSelected) {
                        // secondo tap: apre tab VAR
                        setRightTab("var");
                      } else {
                        setSelectedItemId(item.id);
                        setNumBuffer("");
                        setNumpadMode("qty");
                      }
                    }}
                    className={cn(
                      "rounded-lg px-2.5 py-1.5 cursor-pointer transition-all select-none border",
                      isSelected
                        ? "border-primary bg-primary/15 ring-1 ring-primary/40"
                        : isDraft
                          ? "bg-[#2a1f0d] border-amber-800/60 hover:border-amber-600"
                          : "bg-[#22263a] border-[#2d3044] hover:border-[#3a3f58]"
                    )}>
                    <div className="flex items-center gap-1.5">
                      <span className={cn(
                        "flex-1 text-[12px] font-semibold truncate",
                        isSelected ? "text-primary" : isDraft ? "text-amber-200" : "text-slate-200"
                      )}>{item.productName}</span>
                      {!isDraft && <span className="text-[10px] text-emerald-500 shrink-0 font-bold">✓</span>}
                      <span className={cn(
                        "text-xs font-bold shrink-0 tabular-nums",
                        isSelected ? "text-primary" : "text-slate-100"
                      )}>€{parseFloat(item.subtotal).toFixed(2)}</span>
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-[10px] flex-1" style={{ color: isSelected ? 'rgb(148,163,184)' : 'rgb(100,116,139)' }}>
                        €{parseFloat(item.unitPrice).toFixed(2)} × {item.quantity}
                        {isSelected && <span className="ml-1.5 text-[9px] text-primary/70 font-semibold">↑ tap → VAR</span>}
                      </span>
                      <button
                        onClick={e => { e.stopPropagation(); setEditingItem({ id: item.id, productName: item.productName, quantity: item.quantity, unitPrice: item.unitPrice, notes: itemNotes, status: itemStatus }); }}
                        className={cn(
                        "h-9 w-9 rounded-md flex items-center justify-center transition-colors shrink-0",
                          isSelected ? "hover:bg-primary/30 active:bg-primary/40" : "hover:bg-[#3a3f58] active:bg-[#444a6a]"
                        )}>
                        <Pencil className={cn("h-4 w-4", isSelected ? "text-primary" : "text-slate-400")} />
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={e => { e.stopPropagation(); handleQty(item.id, item.quantity - 1); }}
                          className="h-9 w-9 rounded-md flex items-center justify-center hover:bg-red-900/40 active:bg-red-900/60 transition-colors">
                          <Minus className="h-4 w-4 text-red-400" />
                        </button>
                        <span className="w-6 text-center text-sm font-bold text-slate-200 tabular-nums">{item.quantity}</span>
                        <button onClick={e => { e.stopPropagation(); handleQty(item.id, item.quantity + 1); }}
                          className="h-9 w-9 rounded-md flex items-center justify-center hover:bg-emerald-900/40 active:bg-emerald-900/60 transition-colors">
                          <Plus className="h-4 w-4 text-emerald-400" />
                        </button>
                      </div>
                    </div>
                    {itemNotes && (
                      <div className="mt-0.5 text-[9px] text-amber-500 italic truncate">{itemNotes}</div>
                    )}
                    {(() => {
                      try {
                        const mods: Array<{ label: string; type: string }> = JSON.parse((item as never as { modifiers?: string }).modifiers ?? "[]");
                        if (!mods.length) return null;
                        return (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {mods.map((m, idx) => (
                              <span key={idx} className={cn(
                                "text-[9px] px-1.5 py-0.5 rounded font-medium",
                                m.type === "plus" ? "bg-emerald-900/60 text-emerald-400" :
                                m.type === "minus" ? "bg-red-900/60 text-red-400" :
                                "bg-[#2d3044] text-slate-400"
                              )}>
                                {m.type === "plus" ? "+" : m.type === "minus" ? "−" : "✎"} {m.label}
                              </span>
                            ))}
                          </div>
                        );
                      } catch { return null; }
                    })()}
                  </div>
                );
              })}
            </div>
          ));
        })()}

        {/* ── Riga coperti interattiva ── */}
        {coverPrice > 0 && activeOrderId && !isQuickMode && (
          <div
            onClick={e => e.stopPropagation()}
            className="mt-1 rounded-lg px-2.5 py-1.5 border border-dashed border-[#3a3f58] bg-[#1e2235] flex items-center gap-2"
          >
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Users className="h-3 w-3 text-slate-400 shrink-0" />
                Coperto
                {coverCount > 0 && (
                  <span className="text-slate-500 font-mono">× {coverCount} = €{coverTotal.toFixed(2)}</span>
                )}
              </div>
              {coverCount === 0 && <div className="text-[10px] text-slate-600 mt-0.5">€{coverPrice.toFixed(2)} cad. — nessun coperto</div>}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={(e) => { e.stopPropagation(); handleEditCovers(Math.max(0, coverCount - 1)); }}
                className="h-7 w-7 rounded-lg bg-[#252840] border border-[#3a3f58] text-slate-300 hover:bg-[#2d3349] hover:text-white active:scale-95 transition-all flex items-center justify-center text-base font-bold">
                −
              </button>
              <span className="text-sm font-bold text-white w-6 text-center tabular-nums">{coverCount}</span>
              <button
                onClick={(e) => { e.stopPropagation(); handleEditCovers(coverCount + 1); }}
                className="h-7 w-7 rounded-lg bg-[#252840] border border-[#3a3f58] text-slate-300 hover:bg-[#2d3349] hover:text-white active:scale-95 transition-all flex items-center justify-center text-base font-bold">
                +
              </button>
            </div>
          </div>
        )}

          </div>
        </ScrollArea>

        {/* Tastierino + bottoni rapidi laterali */}
        <div className="px-2.5 pb-1 shrink-0 flex gap-1.5">

          {/* Numpad compatto 3×4 */}
          <div className="flex-1 flex flex-col gap-1">
            {/* Mode bar: always visible so user can set Qtà/Prezzo BEFORE picking a product */}
            <div className="flex gap-1">
              <button
                onClick={async () => {
                  setNumpadMode("qty");
                  if (numBuffer && selectedItemId) await applyNumpadToSelectedItem("qty");
                }}
                className={cn(
                  "flex-1 h-8 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition-all active:scale-95",
                  numpadMode === "qty" && numBuffer
                    ? "bg-primary text-white shadow-sm ring-2 ring-primary/40 animate-pulse"
                    : numpadMode === "qty"
                      ? "bg-primary text-white shadow-sm"
                      : "bg-[#252840] text-slate-400 hover:bg-[#2d3044]"
                )}>
                <Hash className="h-3 w-3" /> Imposta Qtà
              </button>
              <button
                onClick={async () => {
                  setNumpadMode("price");
                  if (numBuffer && selectedItemId) await applyNumpadToSelectedItem("price");
                }}
                className={cn(
                  "flex-1 h-8 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition-all active:scale-95",
                  numpadMode === "price" && numBuffer
                    ? "bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-500/40 animate-pulse"
                    : numpadMode === "price"
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "bg-[#252840] text-slate-400 hover:bg-[#2d3044]"
                )}>
                <Euro className="h-3 w-3" /> Imposta Prezzo
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1 flex-1">
              {numpadKeys.map(k => (
                <button key={k} onClick={() => handleNumpadKey(k)}
                  className={cn(
                    "h-9 rounded-lg font-bold text-sm transition-all active:scale-90 select-none",
                    k === "X"
                      ? "bg-red-900/60 text-red-400 hover:bg-red-900/80"
                      : "bg-[#252840] text-slate-200 hover:bg-[#2d3044]"
                  )}>
                  {k === "X" ? "⌫" : k}
                </button>
              ))}
            </div>
          </div>

          {/* Bottoni azione — 2 colonne × 4 righe */}
          <div className="grid grid-cols-2 gap-1 w-[116px] shrink-0">
            {/* Riga 1 */}
            <button
              disabled={!activeOrderId || items.length === 0 || priceLocked}
              onClick={() => setShowDiscount(true)}
              title={priceLocked ? "Sconto bloccato — solo amministratore" : "Applica uno sconto al totale del conto (% o € fissi)"}
              className="h-10 rounded-lg flex items-center justify-center bg-amber-700 text-amber-100 hover:bg-amber-600 text-[10px] font-bold transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed leading-tight">
              {priceLocked ? "🔒 Sconto" : "Sconto"}
            </button>
            <button
              disabled={items.length === 0 && !activeOrderId}
              onClick={() => { setLotteriaInput(lotteriaCodice); setShowLotteria(true); }}
              title="Inserisci il codice Lotteria degli Scontrini del cliente"
              className={cn(
                "h-10 rounded-lg flex items-center justify-center text-[10px] font-bold transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed relative leading-tight",
                lotteriaCodice
                  ? "bg-green-800 text-green-200 hover:bg-green-700 ring-1 ring-green-500"
                  : "bg-blue-800 text-blue-200 hover:bg-blue-700"
              )}>
              Lotteria
              {lotteriaCodice && (
                <span className="absolute -top-1 -right-1 bg-green-500 text-white text-[9px] font-bold rounded-full px-1 leading-4">✓</span>
              )}
            </button>

            {/* Riga 2 */}
            <button
              disabled={items.length === 0}
              onClick={() => setShowPreconto(true)}
              title="Stampa il preconto (ricevuta non fiscale) per il cliente"
              className="h-10 rounded-lg flex items-center justify-center bg-[#252840] text-slate-300 hover:bg-[#2d3044] text-[10px] font-bold transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed leading-tight">
              Preconto
            </button>
            <button
              disabled={items.length < 2}
              onClick={() => { setPaymentMode("split"); setRightTab("tot"); setMobilePanel("right"); }}
              title="Conto separato: apre nella tab Tot, scegli quali articoli pagare in scontrini distinti"
              className="h-10 rounded-lg flex items-center justify-center bg-purple-800 text-purple-200 hover:bg-purple-700 text-[10px] font-bold transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed leading-tight">
              Conto Sep.
            </button>

            {/* Riga 3 */}
            <button
              disabled={items.length === 0}
              onClick={() => { setPaymentMode("romana"); setRightTab("tot"); setMobilePanel("right"); }}
              title="Pagamento alla romana: apre nella tab Tot, dividi il totale in N quote uguali"
              className="h-10 rounded-lg flex items-center justify-center bg-green-800 text-green-200 hover:bg-green-700 text-[10px] font-bold transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed leading-tight">
              Romana
            </button>
            <button
              disabled={!items.some(i => i.quantity > 1)}
              onClick={handleExplodeAll}
              title="Espandi: ogni articolo con qty>1 viene separato in righe da 1 (utile per conto separato/romana)"
              className="h-10 rounded-lg flex items-center justify-center bg-indigo-800 text-indigo-200 hover:bg-indigo-700 text-[10px] font-bold transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed leading-tight">
              Espandi
            </button>

            {/* Riga 4 */}
            <button
              disabled={!selectedItemId}
              onClick={handleDeleteSelected}
              title="Cancella l'articolo selezionato dall'ordine"
              className="h-10 rounded-lg flex items-center justify-center bg-red-900/80 text-red-300 hover:bg-red-800 text-[10px] font-bold transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed leading-tight">
              Cancella
            </button>
            {activeOrderId ? (
              <button
                onClick={() => setShowCancelConfirm(true)}
                title="Annulla l'intero ordine (registrato in audit log)"
                className="h-10 rounded-lg flex items-center justify-center bg-red-950 text-red-400 hover:bg-red-900 text-[10px] font-bold transition-all active:scale-95 leading-tight border border-red-900">
                Annulla Ord.
              </button>
            ) : (
              <button
                onClick={() => handleQuickMode("rapida")}
                title="Cassa rapida: vendita banco senza tavolo (per asporto, caffè veloce, ecc.)"
                className="h-10 rounded-lg flex items-center justify-center bg-orange-800 text-orange-200 hover:bg-orange-700 text-[10px] font-bold transition-all active:scale-95 leading-tight">
                Rapida
              </button>
            )}

            {/* Riga 5 — Sospeso e Cassetto */}
            <button
              disabled={!activeOrderId || items.length === 0}
              onClick={() => setShowSospeso(true)}
              title="Conto sospeso: il cliente paga in un secondo momento (visibile in backoffice)"
              className="h-10 rounded-lg flex items-center justify-center bg-yellow-800 text-yellow-100 hover:bg-yellow-700 text-[10px] font-bold transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed leading-tight">
              Sospeso
            </button>
            <button
              onClick={async () => {
                if (foUser?.role !== "admin") {
                  toast({ title: "Operazione riservata", description: "Solo gli amministratori possono aprire il cassetto", variant: "destructive" });
                  return;
                }
                try {
                  const r = await fetch(`${API}/fiscal/open-drawer`, {
                    method: "POST",
                    headers: {
                      "x-user-role": "admin",
                      "x-user-id": String(foUser.id ?? ""),
                      "x-user-name": foUser.name ?? "",
                    },
                  });
                  const data = await r.json();
                  if (data.ok) {
                    addLog("info", "Cassetto aperto");
                    toast({ title: "Cassetto aperto" });
                  } else {
                    toast({ title: "Cassetto non aperto", description: data.error ?? "Stampante fiscale non disponibile", variant: "destructive" });
                  }
                } catch {
                  toast({ title: "Errore comunicazione RT", description: "Verifica la connessione alla stampante fiscale", variant: "destructive" });
                }
              }}
              title="Apri il cassetto della cassa (comando alla stampante fiscale)"
              className="h-10 rounded-lg flex items-center justify-center bg-slate-700 text-slate-200 hover:bg-slate-600 text-[10px] font-bold transition-all active:scale-95 leading-tight">
              Cassetto
            </button>

            {/* Riga 6 — Tavolo (sposta/unisci/sposta articoli) — feature flag */}
            {settings["feat_table_ops"] === "true" && (
              <button
                disabled={!activeOrderId}
                onClick={() => setShowTableActions(true)}
                title="Sposta tavolo, unisci con un altro tavolo o sposta singoli articoli"
                className="col-span-2 h-10 rounded-lg flex items-center justify-center gap-1.5 bg-indigo-800 text-indigo-100 hover:bg-indigo-700 text-[10px] font-bold transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed leading-tight">
                <ArrowLeftRight className="h-3.5 w-3.5" />
                Tavolo
              </button>
            )}
          </div>
        </div>

        {/* Console Log Panel */}
        {showLog && (
          <div className="mx-2.5 mb-1 shrink-0 rounded-xl bg-[#0a0c12] border border-[#2d3044] overflow-hidden" style={{ maxHeight: 160 }}>
            <div className="flex items-center justify-between px-3 py-1.5 bg-[#12151e] border-b border-[#2d3044]">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <ScrollText className="h-3 w-3" /> Console
              </span>
              <button onClick={() => setLogEntries([])} className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors">
                Pulisci
              </button>
            </div>
            <div className="overflow-y-auto font-mono" style={{ maxHeight: 115 }}>
              {logEntries.length === 0 ? (
                <div className="px-3 py-3 text-[10px] text-slate-600 text-center">Nessun evento registrato</div>
              ) : (
                logEntries.map(e => (
                  <div key={e.id} className={cn(
                    "flex items-start gap-2 px-3 py-0.5 border-b border-[#1a1d2a] last:border-0",
                    e.level === "error" ? "bg-red-950/30" : e.level === "warn" ? "bg-amber-950/20" : ""
                  )}>
                    <span className="text-slate-600 text-[9px] shrink-0 pt-0.5 tabular-nums">{e.ts}</span>
                    <span className={cn(
                      "text-[10px] leading-relaxed",
                      e.level === "error" ? "text-red-400" : e.level === "warn" ? "text-amber-400" : "text-slate-400"
                    )}>{e.msg}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Bottone CASSA */}
        <div className="px-2.5 pb-20 sm:pb-2.5 shrink-0">
          <button
            onClick={() => { setRightTab("tot"); setMobilePanel("right"); }}
            disabled={items.length === 0}
            className="w-full py-3 rounded-xl bg-primary text-white font-bold text-sm tracking-wide hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-lg shadow-primary/20">
            Cassa · €{total.toFixed(2)}
          </button>
        </div>
      </div>

      {/* ══ RIGHT PANEL ═══════════════════════════════════════════════════════ */}
      <div className={cn(
        "flex-1 flex flex-col overflow-hidden bg-[#151827]",
        mobilePanel === "right" ? "flex" : "hidden sm:flex"
      )}>

        {/* Tab bar: GRP | ART | VAR | TAVL | CLNT | TOT */}
        <div className="flex bg-[#151922] border-b border-[#37415c] shrink-0">
          {(["grp","art","var","tavl","clnt","tot"] as const).map((tab) => {
            const labels: Record<string, string> = { grp:"GRP", art:"ART", var:"VAR", tavl:"TAVL", clnt:"CLNT", tot:"TOT" };
            const active = rightTab === tab;
            const hasBadge = tab === "clnt" && !!invoiceCustomer;
            return (
              <button key={tab} onClick={() => setRightTab(tab)}
                className={cn(
                  "flex-1 h-14 flex items-center justify-center transition-all border-b-2 text-xs tracking-wide relative",
                  active
                    ? "font-bold text-primary border-primary bg-primary/10"
                    : "font-medium text-slate-500 border-transparent hover:text-slate-300 hover:bg-[#1a1d2a]"
                )}>
                {labels[tab]}
                {hasBadge && (
                  <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-500" />
                )}
              </button>
            );
          })}
        </div>

        {/* ── GRP: category grid */}
        {rightTab === "grp" && (
          <ScrollArea className="flex-1 bg-[#151827]">
            <div className="p-4 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))" }}>
              {categories.map(cat => (
                <CategoryButton key={cat.id} cat={cat} onClick={() => {
                  setSelectedCategoryId(cat.id);
                  setRightTab("art");
                  setProductSearch("");
                }} />
              ))}
              {categories.length === 0 && (
                <div className="col-span-full text-center py-16 text-slate-600">
                  <UtensilsCrossed className="h-10 w-10 mx-auto mb-3 opacity-20" />
                  <div className="text-sm">Nessuna categoria nel menu</div>
                </div>
              )}
            </div>
          </ScrollArea>
        )}

        {/* ── ART: products grid */}
        {rightTab === "art" && (
          <div className="flex-1 flex flex-col overflow-hidden bg-[#151827]">
            {/* Sub-header */}
            <div className="px-4 py-2.5 bg-[#0f1117] border-b border-[#2d3044] flex items-center gap-2 shrink-0">
              <button onClick={() => { setSelectedCategoryId(null); setRightTab("grp"); }}
                className="h-9 w-9 rounded-xl border-2 border-[#2d3044] flex items-center justify-center hover:border-primary hover:text-primary transition-colors text-slate-500 shrink-0">
                <ChevronLeft className="h-5 w-5" />
              </button>
              {selectedCategoryId && (
                <span className="font-bold text-sm shrink-0" style={{
                  color: categories.find(c => c.id === selectedCategoryId)?.color ?? "#94a3b8"
                }}>
                  {categories.find(c => c.id === selectedCategoryId)?.name}
                </span>
              )}
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-600" />
                <input ref={searchInputRef} value={productSearch} onChange={e => setProductSearch(e.target.value)}
                  placeholder="Cerca prodotto in tutto il menu… (premi /)"
                  className="w-full pl-8 pr-16 py-2 bg-[#1a1d2a] border border-[#2d3044] rounded-lg text-sm outline-none focus:border-primary text-slate-200 placeholder:text-slate-600" />
                {productSearch && (
                  <button onClick={() => setProductSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-500 hover:text-slate-300 px-1.5 py-0.5 rounded border border-slate-700">
                    ESC
                  </button>
                )}
              </div>
              {numBuffer && !selectedItemId && (
                <div className="px-3 py-1.5 rounded-xl bg-primary text-white font-bold text-sm shrink-0 animate-pulse flex items-center gap-0.5">
                  €{numBuffer}
                </div>
              )}
            </div>
            <ScrollArea className="flex-1">
              <div className="p-3 grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))" }}>
                {visibleProducts.map(p => (
                  <ProductCard
                    key={p.id}
                    product={p as PosProduct}
                    activePriceList={activePriceList}
                    onAdd={handleAddProduct}
                    onToggleEsaurito={async (id, available) => {
                      try {
                        await fetch(`${API}/products/${id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ available }),
                        });
                        addLog("info", `${available ? "Disponibile" : "Esaurito"}: ${p.name}`);
                        toast({ title: available ? "Prodotto disponibile" : "Prodotto segnato Esaurito" });
                        await refresh();
                      } catch {
                        toast({ title: "Errore aggiornamento prodotto", variant: "destructive" });
                      }
                    }}
                  />
                ))}
                {visibleProducts.length === 0 && (
                  <div className="col-span-full text-center py-16 text-slate-600">
                    <UtensilsCrossed className="h-8 w-8 mx-auto mb-2 opacity-25" />
                    <div className="text-sm">Nessun prodotto disponibile</div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* ── VAR: variazioni per articolo selezionato */}
        {rightTab === "var" && (
          <ScrollArea className="flex-1 bg-[#151827]">
            <div className="p-3 space-y-3">
              {!selectedItem ? (
                <div className="text-center py-20 text-slate-600">
                  <div className="text-5xl mb-3 opacity-30">✦</div>
                  <div className="text-sm font-semibold text-slate-500">Seleziona un articolo dall'ordine</div>
                  <div className="text-xs text-slate-600 mt-1">Le variazioni disponibili appariranno qui</div>
                </div>
              ) : (
                <>
                  {/* Product info card */}
                  <div className="px-4 py-3 bg-[#22263a] rounded-2xl border-2 border-primary/40">
                    <div className="font-bold text-slate-200">{selectedItem.productName}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {selectedItem.quantity}× · €{parseFloat(selectedItem.unitPrice).toFixed(2)} cad.
                    </div>
                    {(selectedItem as never as { notes?: string | null }).notes && (
                      <div className="text-xs italic text-amber-400 mt-1 truncate">
                        {(selectedItem as never as { notes?: string | null }).notes}
                      </div>
                    )}
                  </div>

                  {/* Applied modifiers */}
                  {(() => {
                    try {
                      const applied: Array<{ id: number; label: string; type: string; priceExtra: string }> =
                        JSON.parse((selectedItem as never as { modifiers?: string }).modifiers ?? "[]");
                      if (!applied.length) return null;
                      return (
                        <div className="space-y-1.5">
                          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1">Variazioni applicate</div>
                          {applied.map((m, i) => {
                            const icon = m.type === "plus" ? "+" : m.type === "minus" ? "−" : "✎";
                            const bg = m.type === "plus" ? "bg-emerald-900/50 border-emerald-700 text-emerald-300"
                              : m.type === "minus" ? "bg-red-900/50 border-red-700 text-red-300"
                              : "bg-[#22263a] border-[#2d3044] text-slate-400";
                            return (
                              <div key={i} className={cn("flex items-center gap-3 px-4 py-3 rounded-xl border-2", bg)}>
                                <span className="font-bold text-base w-5 text-center shrink-0">{icon}</span>
                                <span className="font-semibold flex-1">{m.label}</span>
                                {parseFloat(m.priceExtra) !== 0 && (
                                  <span className="text-xs font-mono shrink-0">
                                    {parseFloat(m.priceExtra) > 0 ? "+" : ""}€{parseFloat(m.priceExtra).toFixed(2)}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    } catch { return null; }
                  })()}

                  {/* Available category modifiers */}
                  {selectedItemModifiers.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex-1">Variazioni disponibili</div>
                        {(["all", "plus", "minus"] as const).map(f => (
                          <button key={f} onClick={() => setVarModFilter(f)}
                            className={cn(
                              "px-3 py-1 rounded-full text-[10px] font-bold border transition-all",
                              varModFilter === f
                                ? f === "plus" ? "bg-emerald-600 border-emerald-600 text-white"
                                  : f === "minus" ? "bg-red-600 border-red-600 text-white"
                                  : "bg-[#3a3f58] border-[#4a4f6a] text-white"
                                : "bg-transparent border-[#2d3044] text-slate-500 hover:border-slate-500"
                            )}>
                            {f === "all" ? "Tutte" : f === "plus" ? "+ Agg." : "− Rim."}
                          </button>
                        ))}
                      </div>
                      {selectedItemModifiers.filter(m =>
                        varModFilter === "all" ||
                        m.type === varModFilter ||
                        m.type === "both"
                      ).map(mod => {
                        const currentMods: Array<{ id: number; label: string; type: string; priceExtra: string }> = (() => {
                          try { return JSON.parse((selectedItem as never as { modifiers?: string }).modifiers ?? "[]"); } catch { return []; }
                        })();

                        async function applyMod(direction: string, remove: boolean) {
                          if (!activeOrderId || !selectedItem) return;
                          let next: typeof currentMods;
                          if (remove) {
                            next = currentMods.filter(m => !(m.id === mod.id && m.type === direction));
                          } else {
                            next = [...currentMods, { id: mod.id, label: mod.label, type: direction, priceExtra: mod.priceExtra }];
                          }
                          const priceAdj = next.reduce((acc, m) => acc + parseFloat(m.priceExtra || "0"), 0);
                          const basePrice = parseFloat((selectedItem as never as { productPrice: string }).productPrice || selectedItem.unitPrice);
                          const newPrice = Math.max(0, basePrice + priceAdj).toFixed(2);
                          await fetch(`${API}/orders/${activeOrderId}/items/${selectedItem.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ modifiers: JSON.stringify(next), unitPrice: newPrice }),
                          });
                          refresh();
                        }

                        if (mod.type === "both") {
                          const appliedPlus  = currentMods.some(m => m.id === mod.id && m.type === "plus");
                          const appliedMinus = currentMods.some(m => m.id === mod.id && m.type === "minus");
                          return (
                            <div key={mod.id} className="space-y-1">
                              <div className="text-[10px] font-semibold text-violet-400 px-1 flex items-center gap-1">
                                <span className="text-violet-500 font-bold">±</span> {mod.label}
                                {parseFloat(mod.priceExtra) !== 0 && (
                                  <span className="text-[9px] font-mono text-slate-500 ml-1">
                                    {parseFloat(mod.priceExtra) > 0 ? "+" : ""}€{parseFloat(mod.priceExtra).toFixed(2)}
                                  </span>
                                )}
                              </div>
                              <div className="grid grid-cols-2 gap-1.5">
                                <button
                                  onClick={() => applyMod("plus", appliedPlus)}
                                  className={cn(
                                    "flex items-center justify-center gap-2 px-3 py-3 rounded-xl border-2 font-bold transition-all active:scale-95 text-sm",
                                    appliedPlus
                                      ? "bg-emerald-600 border-emerald-500 text-white"
                                      : "bg-[#1a3028] border-emerald-800 text-emerald-400 hover:border-emerald-600"
                                  )}>
                                  <span className="text-base">+</span>
                                  <span className="text-xs font-semibold truncate">{mod.label}</span>
                                  {appliedPlus && <span className="text-xs shrink-0">✓</span>}
                                </button>
                                <button
                                  onClick={() => applyMod("minus", appliedMinus)}
                                  className={cn(
                                    "flex items-center justify-center gap-2 px-3 py-3 rounded-xl border-2 font-bold transition-all active:scale-95 text-sm",
                                    appliedMinus
                                      ? "bg-red-600 border-red-500 text-white"
                                      : "bg-[#2a1a1a] border-red-800 text-red-400 hover:border-red-600"
                                  )}>
                                  <span className="text-base">−</span>
                                  <span className="text-xs font-semibold truncate">{mod.label}</span>
                                  {appliedMinus && <span className="text-xs shrink-0">✓</span>}
                                </button>
                              </div>
                            </div>
                          );
                        }

                        const isApplied = currentMods.some(m => m.id === mod.id && m.type === mod.type);
                        const icon = mod.type === "plus" ? "+" : mod.type === "minus" ? "−" : "✎";
                        const colorOn = mod.type === "plus"
                          ? "bg-emerald-600 border-emerald-500 text-white"
                          : mod.type === "minus"
                            ? "bg-red-600 border-red-500 text-white"
                            : "bg-[#3a3f58] border-[#4a4f6a] text-white";
                        const colorOff = mod.type === "plus"
                          ? "bg-[#1a3028] border-emerald-800 text-emerald-400 hover:border-emerald-600"
                          : mod.type === "minus"
                            ? "bg-[#2a1a1a] border-red-800 text-red-400 hover:border-red-600"
                            : "bg-[#22263a] border-[#2d3044] text-slate-400 hover:border-[#3a3f58]";
                        return (
                          <button key={mod.id}
                            onClick={() => applyMod(mod.type, isApplied)}
                            className={cn(
                              "w-full flex items-center gap-3 px-4 py-4 rounded-xl border-2 font-semibold transition-all active:scale-95 text-left",
                              isApplied ? colorOn : colorOff
                            )}>
                            <span className="text-xl font-bold w-6 text-center shrink-0">{icon}</span>
                            <span className="flex-1 text-sm">{mod.label}</span>
                            {parseFloat(mod.priceExtra) !== 0 && (
                              <span className="text-xs font-mono shrink-0">
                                {parseFloat(mod.priceExtra) > 0 ? "+" : ""}€{parseFloat(mod.priceExtra).toFixed(2)}
                              </span>
                            )}
                            {isApplied && <span className="text-xs font-bold shrink-0 ml-1">✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {selectedItemModifiers.length === 0 && selectedItemCategoryId && (
                    <div className="text-center py-6 text-slate-300 text-xs italic">
                      Nessuna variazione configurata per questa categoria
                    </div>
                  )}

                  {/* ── Commento KP ── */}
                  <div className="bg-white rounded-2xl border-2 border-teal-200 p-3 space-y-2">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-teal-600">
                      <span>💬</span>
                      <span>Commento KP</span>
                      <span className="ml-auto text-[9px] font-normal text-slate-300 normal-case tracking-normal">Solo cucina · non su scontrino</span>
                    </div>
                    <textarea
                      value={kpComment}
                      onChange={e => setKpComment(e.target.value)}
                      rows={2}
                      placeholder="Es. senza cipolla, ben cotto, allergia…"
                      className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl resize-none outline-none focus:ring-2 focus:ring-teal-300 focus:border-teal-400 placeholder:text-slate-300"
                    />
                    <button
                      disabled={kpSaving}
                      onClick={async () => {
                        if (!activeOrderId || !selectedItem) return;
                        setKpSaving(true);
                        await fetch(`${API}/orders/${activeOrderId}/items/${selectedItem.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ notes: kpComment }),
                        });
                        refresh();
                        setKpSaving(false);
                      }}
                      className="w-full py-2 rounded-xl bg-teal-500 hover:bg-teal-600 active:scale-95 text-white text-xs font-bold transition-all disabled:opacity-50">
                      {kpSaving ? "Salvataggio…" : "Conferma commento"}
                    </button>
                  </div>

                  {/* Modifica prezzo */}
                  <button
                    onClick={() => setEditingItem({
                      id: selectedItem.id,
                      productName: selectedItem.productName,
                      quantity: selectedItem.quantity,
                      unitPrice: selectedItem.unitPrice,
                      notes: (selectedItem as never as { notes?: string | null }).notes,
                      status: (selectedItem as never as { status: string }).status,
                    })}
                    className="w-full py-3 rounded-2xl border-2 border-dashed border-slate-200 text-slate-400 font-semibold text-sm hover:border-slate-400 hover:text-slate-600 transition-all active:scale-95">
                    ✎ Modifica prezzo…
                  </button>
                </>
              )}
            </div>
          </ScrollArea>
        )}

        {/* ── TAVL: table map — occupa tutto lo spazio */}
        {rightTab === "tavl" && (
          <div className="flex-1 overflow-hidden">
            <TableMapPanel
              tablesStatus={tablesStatus as FETable[]}
              selectedTableId={selectedTableId}
              onTableClick={(t) => {
                handleMapTableClick(t);
                if (!moveMergeDialog && t.activeOrderId && t.id === selectedTableId) {
                  setRightTab("grp");
                  setMobilePanel("left");
                }
              }}
              onBack={() => setRightTab("grp")}
            />
          </div>
        )}

        {/* ── CLNT: client/invoice selection */}
        {rightTab === "clnt" && (
          <div className="flex-1 flex flex-col overflow-hidden bg-[#151827]">
            {/* Selected customer banner */}
            {invoiceCustomer && (
              <div className="mx-3 mt-3 px-4 py-3 bg-emerald-900/40 border-2 border-emerald-600 rounded-xl shrink-0">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-emerald-400 font-bold uppercase tracking-wider mb-0.5 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Cliente fattura attivo
                    </div>
                    <div className="font-bold text-emerald-200 truncate">{invoiceCustomer.ragioneSociale}</div>
                    {invoiceCustomer.partitaIva && (
                      <div className="text-[11px] text-emerald-400 font-mono">P.IVA {invoiceCustomer.partitaIva}</div>
                    )}
                    {invoiceCustomer.codiceFiscale && (
                      <div className="text-[11px] text-emerald-400 font-mono">CF {invoiceCustomer.codiceFiscale}</div>
                    )}
                  </div>
                  <button
                    onClick={() => { setInvoiceCustomer(null); setInvoiceNumero(""); setInvoiceAnno(String(new Date().getFullYear())); }}
                    className="h-7 w-7 rounded-lg bg-emerald-900/60 hover:bg-emerald-900 flex items-center justify-center shrink-0 transition-colors">
                    <X className="h-3.5 w-3.5 text-emerald-400" />
                  </button>
                </div>

                {/* N° fattura opzionale */}
                <div className="mt-2.5 flex items-center gap-2">
                  <span className="text-[10px] text-emerald-500 font-bold whitespace-nowrap shrink-0">N° fattura:</span>
                  <input
                    value={invoiceNumero}
                    onChange={e => setInvoiceNumero(e.target.value.replace(/\D/g, ""))}
                    placeholder="auto"
                    maxLength={6}
                    className="w-14 text-center font-mono text-xs bg-[#0d1a14] border border-emerald-700 rounded-lg px-2 py-1.5 text-emerald-200 placeholder:text-emerald-800 outline-none focus:border-emerald-500 transition-colors"
                    title="Numero progressivo (lascia vuoto per automatico)"
                  />
                  <span className="text-emerald-500 font-bold text-sm shrink-0">/</span>
                  <input
                    value={invoiceAnno}
                    onChange={e => setInvoiceAnno(e.target.value.replace(/\D/g, ""))}
                    maxLength={4}
                    className="w-16 text-center font-mono text-xs bg-[#0d1a14] border border-emerald-700 rounded-lg px-2 py-1.5 text-emerald-200 outline-none focus:border-emerald-500 transition-colors"
                    title="Anno"
                  />
                </div>

                <div className="mt-2 text-[10px] text-emerald-500 bg-emerald-900/40 rounded-lg px-3 py-1.5">
                  Al pagamento la fattura viene emessa e l'XML scaricato automaticamente
                </div>
              </div>
            )}

            {/* Search + create bar */}
            <div className="px-3 pt-3 pb-2 shrink-0 space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <input
                  value={clntSearch}
                  onChange={async e => {
                    const q = e.target.value;
                    setClntSearch(q);
                    if (q.length < 2) { setClntResults([]); return; }
                    setClntSearching(true);
                    try {
                      const res = await fetch(`${API}/customers?q=${encodeURIComponent(q)}`);
                      setClntResults(await res.json());
                    } catch { /* noop */ }
                    setClntSearching(false);
                  }}
                  placeholder="Cerca cliente per nome, P.IVA o CF…"
                  className="w-full pl-9 pr-3 py-2.5 bg-[#1a1d2a] border border-[#2d3044] rounded-xl text-sm outline-none focus:border-primary text-slate-200 placeholder:text-slate-600"
                />
                {clntSearching && <RefreshCw className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500 animate-spin" />}
              </div>
              <button
                onClick={() => { setShowNewClntForm(v => !v); setClntSearch(""); setClntResults([]); }}
                className={cn(
                  "w-full py-2 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all active:scale-95 border",
                  showNewClntForm
                    ? "bg-[#22263a] border-[#2d3044] text-slate-400"
                    : "bg-primary/10 border-primary/30 text-primary hover:bg-primary/20"
                )}>
                <Plus className="h-4 w-4" />
                {showNewClntForm ? "Annulla" : "Crea nuovo cliente"}
              </button>
            </div>

            <ScrollArea className="flex-1">
              <div className="px-3 pb-4 space-y-2">

                {/* New customer inline form */}
                {showNewClntForm && (
                  <div className="bg-[#1a1d2a] border border-[#2d3044] rounded-xl p-4">
                    <NewCustomerForm
                      onCreated={c => {
                        setInvoiceCustomer(c as unknown as SimpleCustomer);
                        setShowNewClntForm(false);
                        setClntSearch("");
                        setClntResults([]);
                        addLog("info", `Cliente creato: ${c.ragioneSociale}`);
                        toast({ title: "Cliente creato", description: `${c.ragioneSociale} — pronto per la fattura` });
                      }}
                      onCancel={() => setShowNewClntForm(false)}
                    />
                  </div>
                )}

                {/* Risultati ricerca (quando l'utente ha digitato 2+ caratteri) */}
                {clntSearch.length >= 2 && (
                  <div className="space-y-1.5">
                    {clntResults.length > 0 ? (
                      <>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 px-1">
                          Risultati ricerca ({clntResults.length})
                        </div>
                        {clntResults.map(c => (
                          <CustomerCard key={c.id} c={c} selected={invoiceCustomer?.id === c.id}
                            onSelect={() => { setInvoiceCustomer(c); setClntSearch(""); setClntResults([]); addLog("info", `Cliente selezionato per fattura: ${c.ragioneSociale}`); }} />
                        ))}
                      </>
                    ) : !clntSearching && (
                      <div className="text-center py-6 text-slate-600 text-xs">Nessun cliente trovato</div>
                    )}
                  </div>
                )}

                {/* Lista tutti i clienti (default, quando non si sta cercando) */}
                {!showNewClntForm && clntSearch.length < 2 && (
                  <div className="space-y-1.5">
                    {allCustomers.length > 0 ? (
                      <>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 px-1">
                          Tutti i clienti ({allCustomers.length})
                        </div>
                        {allCustomers.map(c => (
                          <CustomerCard key={c.id} c={c} selected={invoiceCustomer?.id === c.id}
                            onSelect={() => { setInvoiceCustomer(c); addLog("info", `Cliente selezionato per fattura: ${c.ragioneSociale}`); }} />
                        ))}
                      </>
                    ) : (
                      <div className="text-center py-16 text-slate-600">
                        <ReceiptText className="h-10 w-10 mx-auto mb-3 opacity-20" />
                        <div className="text-sm font-semibold text-slate-500">Nessun cliente</div>
                        <div className="text-xs text-slate-600 mt-1 max-w-[240px] mx-auto">
                          Crea il primo cliente per emettere fatture elettroniche
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* ── TOT: payment hub (Totale | Separato | Romana) ─────────────────── */}
        {rightTab === "tot" && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Invoice customer indicator */}
            {invoiceCustomer && (
              <div className="mx-3 mt-2 px-2.5 py-1.5 bg-emerald-900/40 border border-emerald-700 rounded-xl flex items-center gap-2 shrink-0">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-emerald-400 font-bold">Fattura a:</div>
                  <div className="text-[11px] text-emerald-200 font-semibold truncate">{invoiceCustomer.ragioneSociale}</div>
                </div>
                <button onClick={() => setInvoiceCustomer(null)}
                  className="text-emerald-500 hover:text-emerald-300 transition-colors shrink-0">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Selettore modalità pagamento */}
            <div className="mx-3 mt-2 grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl shrink-0">
              {([
                { id: "full",   label: "Totale",   icon: <Wallet className="h-3.5 w-3.5" /> },
                { id: "split",  label: "Separato", icon: <Divide className="h-3.5 w-3.5" /> },
                { id: "romana", label: "Romana",   icon: <Users className="h-3.5 w-3.5" /> },
              ] as const).map(m => (
                <button key={m.id} onClick={() => setPaymentMode(m.id)}
                  className={cn(
                    "flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-95",
                    paymentMode === m.id
                      ? "bg-white text-primary shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  )}>
                  {m.icon} {m.label}
                </button>
              ))}
            </div>

            {/* Modalità: pagamento intero */}
            {paymentMode === "full" && (
              <InlinePaymentPanel
                key={`pay-${activeOrderId ?? "none"}`}
                total={total}
                disabled={items.length === 0}
                alertAnomalous={settings["feat_alert_totale_anomalo"] === "true"}
                orderId={activeOrderId ?? undefined}
                onPay={(method, amountGiven) => handlePay(method, amountGiven, invoiceCustomer?.id, invoiceCustomer?.ragioneSociale ?? undefined)}
              />
            )}

            {/* Modalità: conto separato inline */}
            {paymentMode === "split" && (
              <div className="flex-1 overflow-y-auto p-3 bg-[#f4f6fa]">
                {items.length < 2 ? (
                  <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-slate-500 text-sm">
                    Servono almeno 2 articoli per il conto separato.
                    <div className="mt-2 text-xs text-slate-400">
                      Suggerimento: usa <strong>Espandi</strong> per separare gli articoli con quantità maggiore di 1.
                    </div>
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl border border-slate-200 p-3">
                    <SplitBillBody
                      key={`split-${activeOrderId}`}
                      items={items as never}
                      coverPrice={coverPrice}
                      coverCount={coverCount}
                      orderId={activeOrderId ?? undefined}
                      onPay={(method, amount, ids, coversToDeduct) => {
                        handlePay(method, amount, undefined, undefined, ids, coversToDeduct);
                      }}
                      onCancel={() => setPaymentMode("full")}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Modalità: romana inline */}
            {paymentMode === "romana" && (
              <div className="flex-1 overflow-y-auto p-3 bg-[#f4f6fa]">
                {items.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-slate-500 text-sm">
                    Nessun ordine attivo.
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl border border-slate-200 p-3">
                    <RomanaBody
                      key={`romana-${activeOrderId}`}
                      total={total}
                      paidRomana={parseFloat((activeOrder as unknown as { paidRomana?: string })?.paidRomana ?? "0")}
                      orderId={activeOrderId}
                      tableName={orderLabel}
                      onOrderClosed={() => {
                        setPaymentMode("full");
                        setSelectedTableId(null);
                        setIsQuickMode(null);
                        setQuickOrderId(null);
                        refresh();
                      }}
                      onCancel={() => setPaymentMode("full")}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ══ MOBILE BOTTOM TAB BAR ═════════════════════════════════════════════ */}
      <div className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-900 border-t border-slate-700 flex"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <button onClick={() => setMobilePanel("left")}
          className={cn("flex-1 flex flex-col items-center gap-1 py-3 text-xs font-bold transition-colors",
            mobilePanel === "left" ? "text-primary" : "text-slate-500")}>
          <div className="relative">
            <FileText className="h-5 w-5" />
            {items.length > 0 && (
              <span className="absolute -top-1.5 -right-2 bg-primary text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                {items.length}
              </span>
            )}
          </div>
          Ordine{total > 0 ? ` · €${total.toFixed(2)}` : ""}
        </button>
        <button onClick={() => setMobilePanel("right")}
          className={cn("flex-1 flex flex-col items-center gap-1 py-3 text-xs font-bold transition-colors",
            mobilePanel === "right" ? "text-primary" : "text-slate-500")}>
          <UtensilsCrossed className="h-5 w-5" />
          Menu
        </button>
      </div>

      {/* ══ MODALS ════════════════════════════════════════════════════════════ */}

      <ItemEditDialog
        open={!!editingItem}
        onClose={() => setEditingItem(null)}
        item={editingItem}
        onSave={handleSaveItemEdit}
      />

      {/* ── Lotteria degli Scontrini ─────────────────────────────────────────── */}
      <Dialog open={showLotteria} onOpenChange={o => !o && setShowLotteria(false)}>
        <DialogContent className="max-w-md w-[calc(100vw-2rem)] sm:w-full p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Ticket className="h-5 w-5 text-blue-600" /> Codice Lotteria Scontrini
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-slate-500 leading-relaxed">
              Il cliente fornisce il codice di 8 caratteri dalla app <strong>Lotteria degli Scontrini</strong>.
              Verrà trasmesso alla RT e registrato dall'Agenzia delle Entrate.
            </p>

            {/* Display del codice — 8 celle uniformi */}
            <div className="grid grid-cols-8 gap-1 sm:gap-1.5 mx-auto max-w-[320px]">
              {Array.from({ length: 8 }).map((_, i) => {
                const ch = lotteriaInput[i] ?? "";
                return (
                  <div key={i} className={cn(
                    "aspect-square flex items-center justify-center font-mono text-xl sm:text-2xl font-bold rounded-lg border-2",
                    ch ? "bg-slate-50 border-blue-400 text-slate-800" : "bg-slate-50 border-slate-200 text-slate-300",
                    i === lotteriaInput.length && lotteriaInput.length < 8 && "border-blue-500 ring-2 ring-blue-200",
                  )}>
                    {ch || "·"}
                  </div>
                );
              })}
            </div>

            {/* Tastiera alfanumerica — grid uniforme 10 colonne */}
            <div className="space-y-1">
              {[
                ["1","2","3","4","5","6","7","8","9","0"],
                ["Q","W","E","R","T","Y","U","I","O","P"],
                ["A","S","D","F","G","H","J","K","L","⌫"],
              ].map((row, ri) => (
                <div key={ri} className="grid grid-cols-10 gap-1">
                  {row.map(k => (
                    <button
                      key={k}
                      type="button"
                      onPointerDown={e => {
                        e.preventDefault();
                        if (k === "⌫") { setLotteriaInput(p => p.slice(0, -1)); return; }
                        if (lotteriaInput.length < 8) setLotteriaInput(p => p + k);
                      }}
                      className={cn(
                        "h-10 sm:h-11 rounded-lg text-sm font-bold select-none active:scale-95 transition-all",
                        k === "⌫" ? "bg-amber-100 hover:bg-amber-200 text-amber-800"
                                  : "bg-slate-100 hover:bg-slate-200 text-slate-800",
                      )}>
                      {k}
                    </button>
                  ))}
                </div>
              ))}
              {/* Riga ZXCVBNM centrata + Cancella */}
              <div className="grid grid-cols-10 gap-1">
                <div /> {/* spacer per centrare */}
                {["Z","X","C","V","B","N","M"].map(k => (
                  <button
                    key={k}
                    type="button"
                    onPointerDown={e => {
                      e.preventDefault();
                      if (lotteriaInput.length < 8) setLotteriaInput(p => p + k);
                    }}
                    className="h-10 sm:h-11 rounded-lg text-sm font-bold select-none active:scale-95 transition-all bg-slate-100 hover:bg-slate-200 text-slate-800">
                    {k}
                  </button>
                ))}
                <button
                  type="button"
                  onPointerDown={e => { e.preventDefault(); setLotteriaInput(""); }}
                  className="col-span-2 h-10 sm:h-11 rounded-lg text-xs font-bold select-none active:scale-95 transition-all bg-red-100 hover:bg-red-200 text-red-700">
                  Pulisci
                </button>
              </div>
            </div>

            {lotteriaCodice && (
              <div className="text-xs text-center text-green-700 bg-green-50 border border-green-200 rounded-lg py-2 px-3">
                Codice attivo: <span className="font-mono tracking-widest font-bold">{lotteriaCodice}</span>
                <button className="ml-2 underline text-red-500" onPointerDown={() => { setLotteriaCodice(""); setLotteriaInput(""); }}>Rimuovi</button>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 mt-2 flex-row">
            <Button variant="outline" onClick={() => setShowLotteria(false)} className="flex-1">Chiudi</Button>
            <Button
              onClick={handleLotteria}
              disabled={lotteriaInput.length !== 8 || lotteriaLoading}
              className="flex-1 gap-1.5 bg-blue-600 hover:bg-blue-700 h-9 text-sm">
              {lotteriaLoading
                ? <><RefreshCw className="h-4 w-4 animate-spin" /> Invio…</>
                : <><Ticket className="h-4 w-4" /> Invia ({lotteriaInput.length}/8)</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CoversDialog
        open={showCovers}
        onClose={() => { setShowCovers(false); setPendingTableId(null); }}
        tableName={tablesStatus.find(t => t.id === pendingTableId)?.name ?? ""}
        onConfirm={handleOpenTable}
        mode="open"
      />

      <CoversDialog
        open={showEditCovers}
        onClose={() => setShowEditCovers(false)}
        tableName={orderLabel}
        initialCovers={coverCount}
        onConfirm={handleEditCovers}
        mode="edit"
      />

      <Dialog open={!!deleteConfirm} onOpenChange={o => !o && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" /> Articolo già inviato
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 text-sm text-slate-600">
            <strong>"{deleteConfirm?.name}"</strong> è già stato inviato al reparto.
            <br />Vuoi inviare un avviso di cancellazione?
          </div>
          <DialogFooter className="flex flex-col gap-2">
            <Button variant="outline" onClick={() => confirmDelete(false)} className="w-full">
              Elimina senza avvisare
            </Button>
            <Button onClick={() => confirmDelete(true)} className="w-full">
              <Send className="h-4 w-4 mr-2" /> Invia avviso al reparto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PaymentDialog
        open={showPayment}
        onClose={() => setShowPayment(false)}
        total={totalNettoRomana}
        orderId={activeOrderId}
        orderItems={items as never}
        onPay={handlePay}
      />

      {/* ── Dialog Sconto al volo ───────────────────────────────────────── */}
      <Dialog open={showDiscount} onOpenChange={o => !o && setShowDiscount(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Sconto sul totale</DialogTitle></DialogHeader>
          <DiscountForm
            currentTotal={total}
            currentDiscount={(activeOrder as unknown as { discountValue?: string })?.discountValue ?? "0.00"}
            currentType={(activeOrder as unknown as { discountType?: string | null })?.discountType ?? null}
            currentReason={(activeOrder as unknown as { discountReason?: string | null })?.discountReason ?? ""}
            onApply={async (type, value, reason) => {
              if (!activeOrderId) return;
              try {
                await fetch(`${API}/orders/${activeOrderId}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ discountType: type, discountValue: value, discountReason: reason }),
                });
                addLog("info", `Sconto applicato: ${type === "percent" ? value + "%" : "€" + value}${reason ? " — " + reason : ""}`);
                toast({ title: "Sconto applicato" });
                setShowDiscount(false);
                refresh();
              } catch {
                toast({ title: "Errore applicazione sconto", variant: "destructive" });
              }
            }}
            onRemove={async () => {
              if (!activeOrderId) return;
              await fetch(`${API}/orders/${activeOrderId}`, {
                method: "PATCH", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ discountType: null, discountValue: "0.00", discountReason: null }),
              });
              addLog("info", "Sconto rimosso");
              toast({ title: "Sconto rimosso" });
              setShowDiscount(false);
              refresh();
            }}
            onClose={() => setShowDiscount(false)}
          />
        </DialogContent>
      </Dialog>

      {/* ── Dialog Conto Sospeso ────────────────────────────────────────── */}
      <Dialog open={showSospeso} onOpenChange={o => !o && setShowSospeso(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Conto Sospeso</DialogTitle></DialogHeader>
          <SospesoForm
            total={total}
            onConfirm={async (note) => {
              if (!activeOrderId) return;
              try {
                await fetch(`${API}/orders/${activeOrderId}`, {
                  method: "PATCH", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ sospeso: true, sospesoNote: note || null }),
                });
                addLog("info", `Conto sospeso — €${total.toFixed(2)}${note ? " — " + note : ""}`);
                toast({ title: "Conto sospeso", description: `Tavolo liberato. Importo €${total.toFixed(2)} da incassare.` });
                setShowSospeso(false);
                handleExitOrder();
                refresh();
              } catch {
                toast({ title: "Errore sospensione conto", variant: "destructive" });
              }
            }}
            onClose={() => setShowSospeso(false)}
          />
        </DialogContent>
      </Dialog>

      <RomanaDialog
        open={showRomana}
        onClose={() => setShowRomana(false)}
        total={total}
        paidRomana={parseFloat((activeOrder as unknown as { paidRomana?: string })?.paidRomana ?? "0")}
        orderId={activeOrderId}
        tableName={orderLabel}
        onOrderClosed={() => {
          setShowRomana(false);
          setSelectedTableId(null);
          setIsQuickMode(null);
          setQuickOrderId(null);
          refresh();
        }}
      />
      <TableActionsDialog
        open={showTableActions}
        onClose={() => setShowTableActions(false)}
        order={activeOrder ? { id: activeOrder.id, tableId: activeOrder.tableId ?? null, tableName: activeOrder.tableName ?? null } : null}
        items={items as never}
        tablesStatus={tablesStatus}
        onDone={() => { refresh(); setSelectedTableId(null); }}
      />

      <PrecontoDialog open={showPreconto} onClose={() => setShowPreconto(false)}
        order={activeOrder as never} items={items as never}
        orderId={activeOrderId}
        coverPrice={coverPrice}
        coverCount={coverCount} />
      <SplitBillDialog
        open={showSplitBill}
        onClose={() => setShowSplitBill(false)}
        items={items as never}
        coverPrice={coverPrice}
        coverCount={coverCount}
        onPay={(method, amount, itemIds, coversToDeduct) => handlePay(method, amount, undefined, undefined, itemIds, coversToDeduct)}
      />

      {/* ── Modifier Picker ─────────────────────────────────────────── */}
      {(() => {
        const isEditing = !!modifierPicker?.itemId;
        const pickerMods = isEditing
          ? (selectedItemModifiers.length > 0 ? selectedItemModifiers : categoryModifiers)
          : categoryModifiers;
        return (
          <Dialog open={!!modifierPicker} onOpenChange={o => !o && setModifierPicker(null)}>
            <DialogContent className="max-w-sm p-0 overflow-hidden rounded-2xl">
              {/* Header */}
              <div className="px-5 pt-5 pb-3 border-b border-slate-100">
                <div className="font-bold text-slate-800 text-base leading-snug">{modifierPicker?.productName}</div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {isEditing ? "Modifica variazioni e note" : "Seleziona variazioni (opzionale)"}
                </div>
              </div>

              <div className="px-4 py-3 space-y-3 max-h-[60vh] overflow-y-auto">
                {/* Filtri tipo variazione */}
                {pickerMods.length > 0 && (
                  <div className="flex gap-2">
                    {(["all", "plus", "minus"] as const).map(f => {
                      const labels = { all: "Tutte", plus: "+ Aggiungi", minus: "− Rimuovi" };
                      const hasMods = f === "all" || pickerMods.some(m => m.type === f);
                      if (!hasMods) return null;
                      return (
                        <button
                          key={f}
                          onClick={() => setPickerModFilter(f)}
                          className={cn(
                            "px-3 py-1 rounded-full text-xs font-semibold border transition-all",
                            pickerModFilter === f
                              ? f === "plus" ? "bg-emerald-500 border-emerald-500 text-white"
                                : f === "minus" ? "bg-red-500 border-red-500 text-white"
                                : "bg-primary border-primary text-white"
                              : "bg-white border-slate-200 text-slate-500 hover:border-slate-400"
                          )}>
                          {labels[f]}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Lista variazioni filtrate */}
                {pickerMods.length > 0 ? (
                  <div className="space-y-2">
                    {pickerMods
                      .filter(m => pickerModFilter === "all" || m.type === pickerModFilter)
                      .map(m => {
                        const checked = selectedModifierIds.has(m.id);
                        const typeIcon = m.type === "plus" ? "+" : m.type === "minus" ? "−" : "✎";
                        const colorOn = m.type === "plus"
                          ? "bg-emerald-500 border-emerald-500 text-white"
                          : m.type === "minus"
                            ? "bg-red-500 border-red-500 text-white"
                            : "bg-slate-700 border-slate-700 text-white";
                        const colorOff = m.type === "plus"
                          ? "border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
                          : m.type === "minus"
                            ? "border-red-200 text-red-700 bg-red-50 hover:bg-red-100"
                            : "border-slate-200 text-slate-600 bg-slate-50 hover:bg-slate-100";
                        return (
                          <button key={m.id}
                            onClick={() => setSelectedModifierIds(prev => {
                              const next = new Set(prev);
                              if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
                              return next;
                            })}
                            className={cn(
                              "w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 font-medium transition-all text-left active:scale-95",
                              checked ? colorOn : colorOff
                            )}>
                            <span className="text-base font-bold shrink-0 w-5 text-center">{typeIcon}</span>
                            <span className="flex-1 text-sm">{m.label}</span>
                            {parseFloat(m.priceExtra) !== 0 && (
                              <span className="text-xs font-mono shrink-0">
                                {parseFloat(m.priceExtra) > 0 ? "+" : ""}€{parseFloat(m.priceExtra).toFixed(2)}
                              </span>
                            )}
                            {checked && <span className="text-xs font-bold shrink-0">✓</span>}
                          </button>
                        );
                      })}
                  </div>
                ) : (
                  <div className="text-center py-4 text-slate-300 text-xs italic">Nessuna variazione per questa categoria</div>
                )}

                {/* Commento KP */}
                <div className="pt-1">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-teal-600 mb-1.5 flex items-center gap-1">
                    <span>💬</span> Commento KP
                    <span className="ml-auto text-[9px] font-normal text-slate-300 normal-case tracking-normal">Solo cucina · non su scontrino</span>
                  </div>
                  <textarea
                    value={pickerKpNote}
                    onChange={e => setPickerKpNote(e.target.value)}
                    rows={2}
                    placeholder="Es. senza cipolla, ben cotto, allergia…"
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl resize-none outline-none focus:ring-2 focus:ring-teal-300 focus:border-teal-400 placeholder:text-slate-300"
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="px-4 pb-5 pt-2 flex gap-2 border-t border-slate-100">
                {isEditing ? (
                  <>
                    <Button variant="outline" className="flex-1 h-12 rounded-xl text-sm" onClick={() => confirmModifiers(false)}>
                      Rimuovi tutte
                    </Button>
                    <Button className="flex-1 h-12 rounded-xl text-sm font-bold" onClick={() => confirmModifiers(true)}>
                      {selectedModifierIds.size > 0 ? `Salva (${selectedModifierIds.size})` : "Salva"}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="outline" className="flex-1 h-12 rounded-xl" onClick={() => confirmModifiers(false)}>
                      Senza variazioni
                    </Button>
                    <Button className="flex-1 h-12 rounded-xl text-sm font-bold" onClick={() => confirmModifiers(true)}>
                      {selectedModifierIds.size > 0 ? `Aggiungi (${selectedModifierIds.size})` : "Aggiungi"}
                    </Button>
                  </>
                )}
              </div>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* KP Resend prompt */}
      <AlertDialog open={kpResendPending} onOpenChange={setKpResendPending}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-amber-500" />
              Reinviare comanda al reparto?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Hai modificato un articolo già inviato. Vuoi reinviare la comanda aggiornata ai reparti?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setKpResendPending(false)}>No, ignora</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => { await handleSendComanda(); setKpResendPending(false); }}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              <Send className="h-4 w-4 mr-2" /> Sì, reinvia
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-red-500" />
              Annulla tutto l'ordine?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {items.length > 0
                ? `Verranno eliminati ${items.length} prodott${items.length === 1 ? "o" : "i"} e il tavolo verrà liberato.`
                : "Il tavolo verrà liberato. L'azione non è reversibile."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1">
            <Label className="text-xs text-slate-600">Motivo (opzionale, registrato in audit log)</Label>
            <textarea
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              placeholder="Es. errore cucina, cliente cambia idea, doppio ordine…"
              className="mt-1 w-full text-sm border border-slate-300 rounded-lg px-2.5 py-2 outline-none focus:border-primary resize-none"
              rows={2}
              maxLength={200}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setCancelReason("")}>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancelOrder}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Sì, annulla ordine
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─ Move / Merge table confirmation ─ */}
      <AlertDialog open={!!moveMergeDialog} onOpenChange={open => { if (!open) setMoveMergeDialog(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {moveMergeDialog?.type === "move" ? (
                <><ArrowRight className="h-5 w-5 text-blue-500" /> Sposta ordine</>
              ) : (
                <><Users className="h-5 w-5 text-orange-500" /> Unifica conti</>
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {moveMergeDialog?.type === "move" ? (
                <>
                  Vuoi spostare l'ordine di <strong>{moveMergeDialog.fromTable.name}</strong> al tavolo libero <strong>{moveMergeDialog.toTable.name}</strong>?
                  <br />Tutti gli articoli seguiranno il nuovo tavolo.
                </>
              ) : (
                <>
                  Vuoi unificare il conto di <strong>{moveMergeDialog?.fromTable.name}</strong> su <strong>{moveMergeDialog?.toTable.name}</strong>?
                  <br />Gli articoli di {moveMergeDialog?.fromTable.name} verranno aggiunti all'ordine di {moveMergeDialog?.toTable.name}.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setMoveMergeDialog(null)}>Annulla</AlertDialogCancel>
            <AlertDialogAction
              className={moveMergeDialog?.type === "move" ? "bg-blue-600 hover:bg-blue-700" : "bg-orange-600 hover:bg-orange-700"}
              onClick={() => moveMergeDialog?.type === "move" ? handleMoveTable() : handleMergeTable()}>
              {moveMergeDialog?.type === "move" ? "Sposta ordine" : "Unifica su " + moveMergeDialog?.toTable.name}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

