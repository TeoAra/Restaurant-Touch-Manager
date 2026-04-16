import { useState, useCallback, useEffect, useRef } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Users, Plus, Minus, CreditCard, Banknote, Wallet,
  ShoppingBag, Truck, Clock, Send, FileText, Divide,
  ChevronLeft, Search, X, UtensilsCrossed, Zap, ArrowLeft
} from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

// ─── Settings hook ────────────────────────────────────────────────────────────
function useSettings() {
  return useQuery<Record<string, string>>({
    queryKey: ["settings"],
    queryFn: () => fetch(`${API}/settings`).then(r => r.json()),
    staleTime: 30000,
  });
}

// ─── Visual table card (GOODFOOD style) ───────────────────────────────────────
function TableCard({ table, onClick, isSelected }: {
  table: TableStatus & { roomName?: string };
  onClick: () => void;
  isSelected: boolean;
}) {
  const status = table.status as "free" | "occupied" | "reserved";
  const seats = table.seats || 4;

  const statusStyle = {
    free:     { border: "border-slate-200",   bg: "bg-white",         badge: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500", label: "Libero" },
    occupied: { border: "border-orange-300",  bg: "bg-orange-50",     badge: "bg-orange-100 text-orange-700",   dot: "bg-orange-500",  label: "Occupato" },
    reserved: { border: "border-blue-300",    bg: "bg-blue-50",       badge: "bg-blue-100 text-blue-700",       dot: "bg-blue-500",    label: "Riservato" },
  }[status];

  const seatDotColor = {
    free: "bg-slate-300",
    occupied: "bg-orange-400",
    reserved: "bg-blue-400",
  }[status];

  // Distribute seats visually: top + bottom
  const topSeats = Math.ceil(seats / 2);
  const bottomSeats = Math.floor(seats / 2);

  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex flex-col items-center gap-0 group transition-all duration-200 active:scale-95",
        isSelected && "scale-95"
      )}
    >
      {/* Top seat dots */}
      <div className="flex gap-1.5 mb-1.5 h-4">
        {Array.from({ length: Math.min(topSeats, 5) }).map((_, i) => (
          <div key={i} className={cn("h-4 w-4 rounded-full shadow-sm border border-white", seatDotColor)} />
        ))}
      </div>

      {/* Table card */}
      <div className={cn(
        "w-full rounded-2xl border-2 p-4 shadow-sm transition-all duration-200",
        "group-hover:shadow-lg group-hover:-translate-y-0.5",
        statusStyle.bg, statusStyle.border,
        isSelected && "ring-4 ring-primary ring-offset-2 shadow-xl"
      )}>
        {/* Status dot */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-xl font-bold text-slate-800">{table.name}</span>
          <div className={cn("h-2.5 w-2.5 rounded-full", statusStyle.dot)} />
        </div>

        <div className={cn("inline-flex px-2 py-0.5 rounded-full text-xs font-semibold mb-2", statusStyle.badge)}>
          {statusStyle.label}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-xs text-slate-400">
            <Users className="h-3 w-3" />
            <span>{seats}</span>
          </div>
          {table.activeOrderTotal && (
            <span className="text-sm font-bold text-primary">€{table.activeOrderTotal}</span>
          )}
        </div>

        {table.activeOrderCreatedAt && (
          <div className="flex items-center gap-1 text-[10px] text-slate-400 mt-1">
            <Clock className="h-2.5 w-2.5" />
            {new Date(table.activeOrderCreatedAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
          </div>
        )}
      </div>

      {/* Bottom seat dots */}
      <div className="flex gap-1.5 mt-1.5 h-4">
        {Array.from({ length: Math.min(bottomSeats, 5) }).map((_, i) => (
          <div key={i} className={cn("h-4 w-4 rounded-full shadow-sm border border-white", seatDotColor)} />
        ))}
      </div>
    </button>
  );
}

// ─── Dialogs ─────────────────────────────────────────────────────────────────
function PaymentDialog({ open, onClose, total, onPay }: {
  open: boolean; onClose: () => void; total: number;
  onPay: (method: string, amountGiven?: number) => void;
}) {
  const [method, setMethod] = useState<"cash" | "card" | "other">("cash");
  const [given, setGiven] = useState("");
  const change = method === "cash" && given ? Math.max(0, parseFloat(given) - total) : 0;
  const methods = [
    { id: "cash" as const, label: "Contanti", icon: Banknote, color: "text-emerald-600" },
    { id: "card" as const, label: "Carta/POS", icon: CreditCard, color: "text-blue-600" },
    { id: "other" as const, label: "Altro", icon: Wallet, color: "text-purple-600" },
  ];
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Pagamento</DialogTitle></DialogHeader>
        <div className="space-y-4 py-1">
          <div className="text-center py-4 bg-slate-50 rounded-xl">
            <p className="text-sm text-slate-500 mb-1">Totale da pagare</p>
            <p className="text-4xl font-bold text-slate-900">€ {total.toFixed(2)}</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {methods.map(m => (
              <button key={m.id} onClick={() => setMethod(m.id)}
                className={cn("flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 transition-all",
                  method === m.id ? "border-primary bg-orange-50" : "border-slate-200 hover:border-slate-300")}>
                <m.icon className={cn("h-6 w-6", m.color)} />
                <span className="text-xs font-medium text-slate-700">{m.label}</span>
              </button>
            ))}
          </div>
          {method === "cash" && (
            <>
              <div>
                <Label className="mb-1 block">Importo ricevuto</Label>
                <Input type="number" step="0.01" placeholder="0.00" value={given}
                  onChange={e => setGiven(e.target.value)} className="text-xl text-center h-12" />
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {[5, 10, 20, 50].map(v => (
                  <button key={v} onClick={() => setGiven(v.toString())}
                    className="py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-sm font-semibold text-slate-700 transition-colors">
                    €{v}
                  </button>
                ))}
              </div>
              {parseFloat(given) >= total && (
                <div className="flex justify-between items-center p-3 bg-emerald-50 rounded-lg">
                  <span className="text-sm font-medium text-emerald-700">Resto</span>
                  <span className="text-xl font-bold text-emerald-700">€ {change.toFixed(2)}</span>
                </div>
              )}
            </>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1">Annulla</Button>
          <Button onClick={() => onPay(method, parseFloat(given) || total)}
            disabled={method === "cash" && parseFloat(given) < total} className="flex-1">
            Incassa € {total.toFixed(2)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CoversDialog({ open, onClose, tableName, onConfirm }: {
  open: boolean; onClose: () => void; tableName: string; onConfirm: (covers: number) => void;
}) {
  const [covers, setCovers] = useState(2);
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xs">
        <DialogHeader><DialogTitle>Coperti — {tableName}</DialogTitle></DialogHeader>
        <div className="py-4 text-center space-y-4">
          <p className="text-sm text-muted-foreground">Numero di coperti</p>
          <div className="flex items-center justify-center gap-5">
            <button onClick={() => setCovers(c => Math.max(1, c - 1))}
              className="h-12 w-12 rounded-full border-2 border-slate-200 flex items-center justify-center hover:border-primary active:scale-90 transition-all">
              <Minus className="h-5 w-5" />
            </button>
            <span className="text-6xl font-bold w-20 text-center">{covers}</span>
            <button onClick={() => setCovers(c => c + 1)}
              className="h-12 w-12 rounded-full border-2 border-slate-200 flex items-center justify-center hover:border-primary active:scale-90 transition-all">
              <Plus className="h-5 w-5" />
            </button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annulla</Button>
          <Button onClick={() => onConfirm(covers)} className="flex-1">Apri Tavolo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RomanaDialog({ open, onClose, total }: { open: boolean; onClose: () => void; total: number }) {
  const [people, setPeople] = useState(2);
  const share = people > 0 ? total / people : 0;
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xs">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Divide className="h-4 w-4" /> Divisione alla Romana</DialogTitle></DialogHeader>
        <div className="py-3 text-center space-y-4">
          <div className="text-3xl font-bold">€ {total.toFixed(2)}</div>
          <div className="flex items-center justify-center gap-4">
            <button onClick={() => setPeople(p => Math.max(1, p - 1))}
              className="h-10 w-10 rounded-full border-2 border-slate-200 flex items-center justify-center hover:border-primary transition-all">
              <Minus className="h-4 w-4" />
            </button>
            <span className="text-3xl font-bold w-10 text-center">{people}</span>
            <button onClick={() => setPeople(p => p + 1)}
              className="h-10 w-10 rounded-full border-2 border-slate-200 flex items-center justify-center hover:border-primary transition-all">
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <div className="p-4 bg-orange-50 rounded-xl">
            <p className="text-sm text-slate-600 mb-1">Ognuno paga</p>
            <p className="text-3xl font-bold text-primary">€ {share.toFixed(2)}</p>
          </div>
        </div>
        <DialogFooter><Button onClick={onClose} className="w-full">Chiudi</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PrecontoDialog({ open, onClose, order, items }: {
  open: boolean; onClose: () => void;
  order: { tableName?: string | null; covers?: number; total: string; createdAt: string } | null;
  items: Array<{ productName: string; quantity: number; unitPrice: string; subtotal: string }>;
}) {
  if (!order) return null;
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><FileText className="h-4 w-4" /> Preconto</DialogTitle></DialogHeader>
        <div className="py-1 space-y-3 font-mono text-sm">
          <div className="text-center border-b border-dashed border-slate-200 pb-3">
            <div className="font-bold text-base">{order.tableName || "Scontrino Rapido"}</div>
            <div className="text-xs text-slate-400">{new Date(order.createdAt).toLocaleString("it-IT")}</div>
            {order.covers && <div className="text-xs text-slate-400">Coperti: {order.covers}</div>}
          </div>
          <div className="space-y-1 max-h-52 overflow-y-auto">
            {items.map((item, i) => (
              <div key={i} className="flex justify-between">
                <span>{item.quantity}x {item.productName}</span>
                <span>€ {parseFloat(item.subtotal).toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="border-t-2 border-slate-300 pt-2 flex justify-between text-base font-bold">
            <span>TOTALE</span>
            <span>€ {parseFloat(order.total).toFixed(2)}</span>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose} className="w-full">Chiudi</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Legend badge ─────────────────────────────────────────────────────────────
function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={cn("h-3 w-3 rounded-full", color)} />
      <span className="text-xs text-slate-500">{label}</span>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function FrontOffice() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: settings = {} } = useSettings();

  const enableAsporto = settings["enable_asporto"] === "true";
  const enableDelivery = settings["enable_delivery"] === "true";

  // State
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);
  const [activeRoomFilter, setActiveRoomFilter] = useState<string>("all");
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [quickOrderId, setQuickOrderId] = useState<number | null>(null);
  const [isQuickMode, setIsQuickMode] = useState<"rapida" | "asporto" | "delivery" | null>(null);

  // Dialog state
  const [showPayment, setShowPayment] = useState(false);
  const [showCovers, setShowCovers] = useState(false);
  const [showRomana, setShowRomana] = useState(false);
  const [showPreconto, setShowPreconto] = useState(false);
  const [pendingTableId, setPendingTableId] = useState<number | null>(null);

  // Auto-send comanda on table switch
  const prevTableIdRef = useRef<number | null>(null);
  const hasDraftItemsRef = useRef(false);

  const { data: tablesStatus = [] } = useGetTablesStatus();
  const { data: categories = [] } = useListCategories();
  const { data: products = [] } = useListProducts({ categoryId: selectedCategoryId ?? undefined });

  const activeTableEntry = tablesStatus.find(t => t.id === selectedTableId);
  const activeOrderId = isQuickMode
    ? quickOrderId ?? undefined
    : (activeTableEntry?.activeOrderId as number | undefined);

  const { data: activeOrder } = useGetOrder(activeOrderId!, { query: { enabled: !!activeOrderId } });
  const items = activeOrder?.items ?? [];
  const total = parseFloat(activeOrder?.total ?? "0");
  const hasDraftItems = items.some(i => (i as never as { status: string }).status === "draft");

  const addItem = useAddOrderItem();
  const updateItem = useUpdateOrderItem();
  const deleteItem = useDeleteOrderItem();
  const createPayment = useCreatePayment();

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: getGetTablesStatusQueryKey() });
    if (activeOrderId) qc.invalidateQueries({ queryKey: getGetOrderQueryKey(activeOrderId) });
    qc.invalidateQueries({ queryKey: getListOrdersQueryKey() });
  }, [qc, activeOrderId]);

  const sendComandaForOrder = useCallback(async (orderId: number) => {
    await fetch(`${API}/orders/${orderId}/send-comanda`, { method: "POST" }).catch(() => {});
  }, []);

  useEffect(() => { hasDraftItemsRef.current = hasDraftItems; }, [hasDraftItems]);

  // Auto-send on table switch
  useEffect(() => {
    const prevId = prevTableIdRef.current;
    if (prevId !== null && prevId !== selectedTableId && hasDraftItemsRef.current) {
      const prevOrderId = tablesStatus.find(t => t.id === prevId)?.activeOrderId as number | undefined;
      if (prevOrderId) {
        sendComandaForOrder(prevOrderId).then(() => {
          qc.invalidateQueries({ queryKey: getGetTablesStatusQueryKey() });
          toast({ title: "Comanda inviata", description: "Tavolo precedente: righe inviate al reparto" });
        });
      }
    }
    prevTableIdRef.current = selectedTableId;
  }, [selectedTableId]);

  // Rooms derived from tables
  const rooms = Array.from(
    new Map(
      tablesStatus
        .filter(t => (t as TableStatus & { roomName?: string }).roomName)
        .map(t => [(t as TableStatus & { roomName?: string }).roomName!, (t as TableStatus & { roomName?: string }).roomName!])
    ).values()
  );

  const filteredTables = tablesStatus.filter(t => {
    if (activeRoomFilter === "all") return true;
    return (t as TableStatus & { roomName?: string }).roomName === activeRoomFilter;
  });

  // Stats
  const freeCount = filteredTables.filter(t => t.status === "free").length;
  const occupiedCount = filteredTables.filter(t => t.status === "occupied").length;

  // Open table
  async function handleTableClick(table: TableStatus) {
    setIsQuickMode(null);
    setQuickOrderId(null);
    if (table.status === "free" && !table.activeOrderId) {
      setPendingTableId(table.id);
      setShowCovers(true);
    } else {
      setSelectedTableId(table.id);
      setSelectedCategoryId(null);
    }
  }

  async function handleOpenTable(covers: number) {
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
      refresh();
    } catch { toast({ title: "Errore apertura tavolo", variant: "destructive" }); }
    finally { setPendingTableId(null); }
  }

  // Quick modes (no table)
  async function handleQuickMode(mode: "rapida" | "asporto" | "delivery") {
    setSelectedTableId(null);
    const notes = mode === "rapida" ? "Scontrino Rapido" : mode === "asporto" ? "Asporto" : "Delivery";
    const res = await fetch(`${API}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tableId: null, covers: 1, notes }),
    });
    const order = await res.json();
    setIsQuickMode(mode);
    setQuickOrderId(order.id);
    setSelectedCategoryId(null);
    refresh();
  }

  // Exit order mode
  function handleExitOrder() {
    setSelectedTableId(null);
    setIsQuickMode(null);
    setQuickOrderId(null);
    setSelectedCategoryId(null);
    refresh();
  }

  // Add product
  async function handleAddProduct(productId: number) {
    if (!activeOrderId) { toast({ title: "Seleziona prima un tavolo", variant: "destructive" }); return; }
    const existing = items.find(i => i.productId === productId);
    if (existing) {
      await updateItem.mutateAsync({ orderId: activeOrderId, itemId: existing.id, data: { quantity: existing.quantity + 1 } });
    } else {
      await addItem.mutateAsync({ orderId: activeOrderId, data: { productId, quantity: 1 } });
    }
    refresh();
  }

  async function handleQty(itemId: number, qty: number) {
    if (!activeOrderId) return;
    if (qty <= 0) await deleteItem.mutateAsync({ orderId: activeOrderId, itemId });
    else await updateItem.mutateAsync({ orderId: activeOrderId, itemId, data: { quantity: qty } });
    refresh();
  }

  async function handleSendComanda() {
    if (!activeOrderId) return;
    const res = await fetch(`${API}/orders/${activeOrderId}/send-comanda`, { method: "POST" });
    const data = await res.json();
    refresh();
    toast({ title: "Comanda inviata", description: `${data.sentItems} righe inviate` });
  }

  async function handlePay(method: string, amountGiven?: number) {
    if (!activeOrderId) return;
    setShowPayment(false);
    await createPayment.mutateAsync({
      data: { orderId: activeOrderId, method, amount: total.toFixed(2), amountGiven: amountGiven?.toFixed(2) } as never
    });
    handleExitOrder();
    refresh();
    toast({ title: "Pagamento registrato", description: `€ ${total.toFixed(2)} — ${method}` });
  }

  const visibleProducts = productSearch
    ? products.filter(p => p.name.toLowerCase().includes(productSearch.toLowerCase()))
    : products;

  const isOrderMode = selectedTableId !== null || isQuickMode !== null;
  const orderLabel = isQuickMode === "rapida" ? "Scontrino Rapido"
    : isQuickMode === "asporto" ? "Asporto"
    : isQuickMode === "delivery" ? "Delivery"
    : activeTableEntry?.name ?? "";

  const modeIcon = isQuickMode === "rapida" ? Zap
    : isQuickMode === "asporto" ? ShoppingBag
    : isQuickMode === "delivery" ? Truck
    : null;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#f4f6fa]">

      {/* ══ TOP BAR ══════════════════════════════════════════════════════════ */}
      <div className="h-14 bg-white border-b border-slate-200 flex items-center gap-3 px-5 shrink-0">
        {isOrderMode && (
          <button onClick={handleExitOrder}
            className="flex items-center gap-1.5 text-slate-500 hover:text-primary transition-colors mr-1">
            <ArrowLeft className="h-5 w-5" />
            <span className="text-sm font-medium">Mappa</span>
          </button>
        )}

        {/* Room tabs (only in mappa mode) */}
        {!isOrderMode && (
          <div className="flex items-center gap-1.5 flex-1 overflow-x-auto">
            {["all", ...rooms].map(room => (
              <button key={room} onClick={() => setActiveRoomFilter(room)}
                className={cn(
                  "px-4 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition-all border",
                  activeRoomFilter === room
                    ? "bg-primary text-white border-primary shadow-sm"
                    : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                )}>
                {room === "all" ? "Tutte le sale" : room}
              </button>
            ))}
          </div>
        )}

        {/* Order mode: table label */}
        {isOrderMode && (
          <div className="flex items-center gap-2 flex-1">
            {modeIcon && <div className="h-8 w-8 rounded-lg bg-orange-100 flex items-center justify-center">
              {modeIcon && <modeIcon className="h-4 w-4 text-primary" />}
            </div>}
            <div>
              <span className="font-bold text-slate-800">{orderLabel}</span>
              {activeOrder?.covers && (
                <span className="ml-2 text-xs text-slate-400 inline-flex items-center gap-0.5">
                  <Users className="h-3 w-3" /> {activeOrder.covers} coperti
                </span>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 ml-auto shrink-0">
          {/* Quick actions (always visible) */}
          <button onClick={() => handleQuickMode("rapida")}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-sm font-semibold border border-emerald-200 hover:bg-emerald-100 active:scale-95 transition-all">
            <Zap className="h-4 w-4" /> Bevuta Rapida
          </button>
          {enableAsporto && (
            <button onClick={() => handleQuickMode("asporto")}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-orange-50 text-primary text-sm font-semibold border border-orange-200 hover:bg-orange-100 active:scale-95 transition-all">
              <ShoppingBag className="h-4 w-4" /> Asporto
            </button>
          )}
          {enableDelivery && (
            <button onClick={() => handleQuickMode("delivery")}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-50 text-blue-700 text-sm font-semibold border border-blue-200 hover:bg-blue-100 active:scale-95 transition-all">
              <Truck className="h-4 w-4" /> Delivery
            </button>
          )}
        </div>
      </div>

      {/* ══ MAIN CONTENT ══════════════════════════════════════════════════════ */}
      {!isOrderMode ? (
        /* ── TABLE MAP MODE ─────────────────────────────────────────────── */
        <div className="flex-1 overflow-y-auto">
          {/* Legend & stats */}
          <div className="flex items-center justify-between px-6 pt-5 pb-3">
            <div className="flex items-center gap-5">
              <LegendDot color="bg-slate-300" label={`Liberi: ${freeCount}`} />
              <LegendDot color="bg-orange-400" label={`Occupati: ${occupiedCount}`} />
              <LegendDot color="bg-blue-400" label="Riservati" />
            </div>
            <div className="text-sm text-slate-400">
              {filteredTables.length} tavoli
            </div>
          </div>

          {/* Table grid */}
          <div className="px-6 pb-6 grid gap-6" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
            {filteredTables.map(table => (
              <TableCard
                key={table.id}
                table={table as TableStatus & { roomName?: string }}
                onClick={() => handleTableClick(table)}
                isSelected={table.id === selectedTableId}
              />
            ))}
          </div>
        </div>
      ) : (
        /* ── ORDER MODE ─────────────────────────────────────────────────── */
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* Left: Category drill-down + Products */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden border-r border-slate-200">
            {/* Search + category breadcrumb */}
            <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-100 shrink-0">
              {selectedCategoryId && (
                <button onClick={() => setSelectedCategoryId(null)}
                  className="flex items-center gap-1 text-primary hover:text-primary/80 shrink-0">
                  <ChevronLeft className="h-5 w-5" />
                  <span className="text-sm font-semibold">Categorie</span>
                </button>
              )}
              {selectedCategoryId && <div className="h-5 w-px bg-slate-200 shrink-0" />}
              {selectedCategoryId && (
                <span className="font-bold text-slate-700 text-sm shrink-0">
                  {categories.find(c => c.id === selectedCategoryId)?.name}
                </span>
              )}
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input value={productSearch} onChange={e => setProductSearch(e.target.value)}
                  placeholder={selectedCategoryId ? "Cerca prodotto..." : "Cerca nel menu..."}
                  className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" />
                {productSearch && (
                  <button onClick={() => setProductSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2">
                    <X className="h-3.5 w-3.5 text-slate-400" />
                  </button>
                )}
              </div>
            </div>

            <ScrollArea className="flex-1">
              {productSearch ? (
                <div className="p-4 grid grid-cols-3 gap-3">
                  {visibleProducts.filter(p => p.available).map(p => (
                    <ProductCard key={p.id} product={p} onAdd={handleAddProduct} />
                  ))}
                  {visibleProducts.length === 0 && <EmptyState label="Nessun prodotto trovato" />}
                </div>
              ) : !selectedCategoryId ? (
                <div className="p-4 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
                  {categories.map(cat => (
                    <button key={cat.id} onClick={() => setSelectedCategoryId(cat.id)}
                      className="bg-white rounded-2xl border-2 border-slate-200 p-5 text-left shadow-sm hover:border-primary hover:shadow-md active:scale-95 transition-all group min-h-[110px] flex flex-col justify-between">
                      <div className="h-11 w-11 rounded-xl flex items-center justify-center mb-3"
                        style={{ backgroundColor: cat.color ? `${cat.color}22` : "#f59e0b22" }}>
                        <UtensilsCrossed className="h-5 w-5" style={{ color: cat.color || "#f59e0b" }} />
                      </div>
                      <div>
                        <div className="font-bold text-slate-800 group-hover:text-primary transition-colors">{cat.name}</div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="p-4 grid grid-cols-3 gap-3">
                  {visibleProducts.filter(p => p.available).map(p => (
                    <ProductCard key={p.id} product={p} onAdd={handleAddProduct} />
                  ))}
                  {visibleProducts.filter(p => p.available).length === 0 && (
                    <EmptyState label="Nessun prodotto in questa categoria" />
                  )}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Right: Order panel */}
          <div className="w-80 flex flex-col bg-white shrink-0">
            <div className="px-4 py-3 border-b border-slate-100 shrink-0">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-800">Comanda</span>
                {activeOrderId && <span className="text-xs text-slate-400 font-mono">#{activeOrderId}</span>}
              </div>
            </div>

            <ScrollArea className="flex-1 min-h-0">
              {items.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full py-12 text-slate-400">
                  <UtensilsCrossed className="h-10 w-10 mb-3 opacity-25" />
                  <p className="text-sm text-center text-slate-400">Seleziona una categoria<br />e aggiungi prodotti</p>
                </div>
              ) : (
                <div className="p-3 space-y-2">
                  {items.map(item => {
                    const isDraft = (item as never as { status: string }).status === "draft";
                    return (
                      <div key={item.id} className={cn(
                        "flex items-center gap-2 p-2.5 rounded-xl border",
                        isDraft ? "bg-orange-50 border-orange-200" : "bg-slate-50 border-slate-200"
                      )}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1">
                            <span className="text-xs font-semibold text-slate-800 truncate">{item.productName}</span>
                            {!isDraft && <span className="shrink-0 text-[10px] px-1 rounded-full bg-emerald-100 text-emerald-700">✓</span>}
                          </div>
                          <span className="text-[10px] text-slate-400">€{parseFloat(item.unitPrice).toFixed(2)} cad.</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button onClick={() => handleQty(item.id, item.quantity - 1)}
                            className="h-7 w-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center hover:bg-red-50 hover:border-red-200 transition-colors active:scale-90">
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="w-5 text-center text-xs font-bold">{item.quantity}</span>
                          <button onClick={() => handleQty(item.id, item.quantity + 1)}
                            className="h-7 w-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center hover:bg-emerald-50 hover:border-emerald-200 transition-colors active:scale-90">
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                        <span className="text-xs font-bold text-slate-700 w-14 text-right shrink-0">
                          €{parseFloat(item.subtotal).toFixed(2)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>

            {/* Order footer */}
            <div className="p-3 border-t border-slate-200 space-y-2 shrink-0">
              {items.length > 0 && (
                <div className="flex justify-between items-center px-1 pb-1">
                  <span className="text-sm font-semibold text-slate-600">Totale</span>
                  <span className="text-xl font-bold text-primary">€ {total.toFixed(2)}</span>
                </div>
              )}
              <button onClick={handleSendComanda} disabled={!hasDraftItems}
                className={cn(
                  "w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold border-2 transition-all",
                  hasDraftItems
                    ? "border-primary text-primary hover:bg-primary hover:text-white active:scale-95"
                    : "border-slate-200 text-slate-300 cursor-not-allowed"
                )}>
                <Send className="h-4 w-4" />
                Invia Comanda
                {hasDraftItems && (
                  <span className="ml-1 bg-primary text-white text-[10px] px-1.5 rounded-full">
                    {items.filter(i => (i as never as { status: string }).status === "draft").length}
                  </span>
                )}
              </button>
              <div className="grid grid-cols-2 gap-1.5">
                <button onClick={() => setShowPreconto(true)} disabled={items.length === 0}
                  className="flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 active:scale-95 transition-all disabled:opacity-40">
                  <FileText className="h-3.5 w-3.5" /> Preconto
                </button>
                <button onClick={() => setShowRomana(true)} disabled={items.length === 0}
                  className="flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 active:scale-95 transition-all disabled:opacity-40">
                  <Divide className="h-3.5 w-3.5" /> Romana
                </button>
              </div>
              <button onClick={() => setShowPayment(true)} disabled={items.length === 0}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary text-white text-base font-bold shadow-md hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-40">
                <CreditCard className="h-5 w-5" />
                {items.length > 0 ? `Paga € ${total.toFixed(2)}` : "Paga"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dialogs */}
      <CoversDialog open={showCovers} onClose={() => { setShowCovers(false); setPendingTableId(null); }}
        tableName={tablesStatus.find(t => t.id === pendingTableId)?.name ?? ""} onConfirm={handleOpenTable} />
      <PaymentDialog open={showPayment} onClose={() => setShowPayment(false)} total={total} onPay={handlePay} />
      <RomanaDialog open={showRomana} onClose={() => setShowRomana(false)} total={total} />
      <PrecontoDialog open={showPreconto} onClose={() => setShowPreconto(false)}
        order={activeOrder as never} items={items as never} />
    </div>
  );
}

function ProductCard({ product, onAdd }: {
  product: { id: number; name: string; description?: string | null; price: string; available: boolean };
  onAdd: (id: number) => void;
}) {
  return (
    <button onClick={() => onAdd(product.id)}
      className="bg-white rounded-xl border-2 border-slate-200 p-4 text-left shadow-sm hover:border-primary hover:shadow-md active:scale-95 transition-all group min-h-[90px] flex flex-col justify-between">
      <div className="font-semibold text-sm text-slate-800 leading-tight group-hover:text-primary transition-colors">{product.name}</div>
      {product.description && <div className="text-[11px] text-slate-400 truncate mt-0.5">{product.description}</div>}
      <div className="text-base font-bold text-primary mt-2">€ {parseFloat(product.price).toFixed(2)}</div>
    </button>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="col-span-3 flex flex-col items-center justify-center h-40 text-slate-400">
      <UtensilsCrossed className="h-8 w-8 mb-2 opacity-25" />
      <span className="text-sm">{label}</span>
    </div>
  );
}
