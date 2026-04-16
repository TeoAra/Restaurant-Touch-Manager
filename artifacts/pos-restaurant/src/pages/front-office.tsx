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
  ChevronLeft, Search, X, UtensilsCrossed, Zap, Map as MapIcon,
  AlertTriangle, CheckCircle2,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

// Grid constants matching back-office planimetria
const CELL = 80;
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
type FETable = TableStatus & { roomName?: string; posX?: number; posY?: number; shape?: string; elementType?: string };

function FloorElement({ t, isSelected, onClick }: {
  t: FETable; isSelected: boolean; onClick?: () => void;
}) {
  const { w, h } = getElementSize(t);
  const et = t.elementType ?? "table";
  const sh = t.shape ?? "square";
  const isDecor = et !== "table";
  const isRound = sh === "round" && !isDecor;
  const status = t.status as "free" | "occupied" | "reserved";

  const statusBg = {
    free:     "bg-white border-slate-300 hover:border-primary hover:shadow-md",
    occupied: "bg-orange-50 border-orange-400 hover:border-orange-500",
    reserved: "bg-blue-50 border-blue-400",
  }[status] ?? "bg-white border-slate-200";

  const statusDot = {
    free:     "bg-emerald-500",
    occupied: "bg-orange-500",
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

  return (
    <button
      disabled={isDecor}
      onClick={isDecor ? undefined : onClick}
      className={cn(
        "absolute flex items-center justify-center border-2 select-none transition-all active:scale-95",
        isDecor ? decorStyle : cn(statusBg),
        isRound ? "rounded-full" : "rounded-xl",
        isSelected && !isDecor ? "ring-4 ring-primary ring-offset-2 shadow-xl scale-105" : "",
        !isDecor && status === "free" && "cursor-pointer",
        !isDecor && status === "occupied" && "cursor-pointer",
      )}
      style={{ width: w * CELL - 6, height: h * CELL - 6 }}
    >
      {isDecor ? (
        <span className={cn("text-xs font-bold tracking-widest", et === "pianta" && "text-xl")}>{decorLabel}</span>
      ) : (
        <div className="flex flex-col items-center justify-center w-full h-full px-1">
          <div className={cn("h-2 w-2 rounded-full mb-1", statusDot)} />
          <span className="text-[11px] font-bold text-slate-800 text-center leading-tight truncate w-full px-1">{t.name}</span>
          {!isRound && (
            <span className="text-[9px] text-slate-400 mt-0.5 flex items-center gap-0.5">
              <Users className="h-2 w-2 inline" />{t.seats}
            </span>
          )}
          {t.activeOrderTotal && (
            <span className="text-[10px] font-bold text-primary mt-0.5">€{t.activeOrderTotal}</span>
          )}
          {t.activeOrderCreatedAt && (
            <span className="text-[9px] text-slate-400 flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />
              {new Date(t.activeOrderCreatedAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

// ─── Table Map Modal ──────────────────────────────────────────────────────────
function TableMapModal({ open, onClose, tablesStatus, selectedTableId, onTableClick }: {
  open: boolean;
  onClose: () => void;
  tablesStatus: FETable[];
  selectedTableId: number | null;
  onTableClick: (t: FETable) => void;
}) {
  const [roomFilter, setRoomFilter] = useState<string | null>(null);

  const rooms = Array.from(new Map(
    tablesStatus
      .filter(t => t.roomName)
      .map(t => [t.roomName!, t.roomName!])
  ).values());

  const filtered = tablesStatus.filter(t =>
    roomFilter === null || t.roomName === roomFilter
  );

  const freeCount = filtered.filter(t => t.elementType !== "table" ? false : t.status === "free").length;
  const occupiedCount = filtered.filter(t => t.elementType !== "table" ? false : t.status === "occupied").length;

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-[95vw] w-[1100px] max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-5 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <MapIcon className="h-5 w-5 text-primary" /> Mappa Tavoli
            </DialogTitle>
            <div className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1.5 text-emerald-600">
                <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Liberi: {freeCount}
              </span>
              <span className="flex items-center gap-1.5 text-orange-600">
                <div className="h-2.5 w-2.5 rounded-full bg-orange-500" /> Occupati: {occupiedCount}
              </span>
            </div>
          </div>
          {rooms.length > 0 && (
            <div className="flex gap-1.5 mt-3 flex-wrap">
              {rooms.map(r => (
                <button key={r} onClick={() => setRoomFilter(roomFilter === r ? null : r)}
                  className={cn("px-3 py-1.5 rounded-full text-xs font-semibold transition-all",
                    roomFilter === r ? "bg-primary text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>
                  {r}
                </button>
              ))}
            </div>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-auto p-4">
          <div className="overflow-auto border border-slate-200 rounded-2xl bg-[#f8fafc] inline-block">
            <div className="relative select-none" style={{ width: COLS * CELL, height: ROWS * CELL }}>
              {/* Grid lines */}
              {Array.from({ length: ROWS + 1 }).map((_, i) => (
                <div key={`h${i}`} className="absolute left-0 right-0 border-b border-slate-200/60" style={{ top: i * CELL }} />
              ))}
              {Array.from({ length: COLS + 1 }).map((_, i) => (
                <div key={`v${i}`} className="absolute top-0 bottom-0 border-r border-slate-200/60" style={{ left: i * CELL }} />
              ))}

              {/* Elements */}
              {filtered.map(t => (
                <div key={t.id} className="absolute" style={{ left: (t.posX ?? 0) * CELL + 3, top: (t.posY ?? 0) * CELL + 3 }}>
                  <FloorElement
                    t={t}
                    isSelected={t.id === selectedTableId}
                    onClick={() => { onTableClick(t); }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Payment Dialog ───────────────────────────────────────────────────────────
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

// ─── Covers Dialog (allows 0) ─────────────────────────────────────────────────
function CoversDialog({ open, onClose, tableName, onConfirm }: {
  open: boolean; onClose: () => void; tableName: string; onConfirm: (covers: number) => void;
}) {
  const [covers, setCovers] = useState(2);
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xs">
        <DialogHeader><DialogTitle>Coperti — {tableName}</DialogTitle></DialogHeader>
        <div className="py-4 text-center space-y-4">
          <p className="text-sm text-muted-foreground">Numero di coperti (0 = nessun coperto)</p>
          <div className="flex items-center justify-center gap-5">
            <button onClick={() => setCovers(c => Math.max(0, c - 1))}
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

// ─── Romana Dialog ────────────────────────────────────────────────────────────
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

// ─── Preconto Dialog ──────────────────────────────────────────────────────────
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
            {order.covers != null && <div className="text-xs text-slate-400">Coperti: {order.covers}</div>}
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

// ─── Split Bill Dialog ────────────────────────────────────────────────────────
function SplitBillDialog({ open, onClose, items, onPay, coverPrice, coverCount }: {
  open: boolean; onClose: () => void;
  items: Array<{ id: number; productName: string; quantity: number; unitPrice: string; subtotal: string }>;
  onPay: (method: string, amount: number, itemIds: number[]) => void;
  coverPrice: number; coverCount: number;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [method, setMethod] = useState<"cash" | "card" | "other">("cash");
  function toggleItem(id: number) {
    setSelected(s => { const ns = new Set(s); ns.has(id) ? ns.delete(id) : ns.add(id); return ns; });
  }
  const selectedItems = items.filter(i => selected.has(i.id));
  const itemsTotal = selectedItems.reduce((sum, i) => sum + parseFloat(i.subtotal), 0);
  const itemsFraction = items.length > 0 ? selectedItems.length / items.length : 0;
  const splitCoverTotal = coverPrice > 0 ? Math.round(coverCount * coverPrice * itemsFraction * 100) / 100 : 0;
  const splitTotal = itemsTotal + splitCoverTotal;
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Divide className="h-4 w-4" /> Conto Separato</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          <div className="flex justify-between items-center text-xs text-slate-500">
            <span>Seleziona gli articoli da pagare</span>
            <div className="flex gap-2">
              <button onClick={() => setSelected(new Set(items.map(i => i.id)))} className="text-primary hover:underline">Tutti</button>
              <button onClick={() => setSelected(new Set())} className="text-slate-400 hover:underline">Nessuno</button>
            </div>
          </div>
          <div className="space-y-1.5 max-h-52 overflow-y-auto">
            {items.map(item => (
              <button key={item.id} onClick={() => toggleItem(item.id)}
                className={cn("w-full flex items-center gap-2.5 p-2.5 rounded-lg border-2 text-left transition-all",
                  selected.has(item.id) ? "border-primary bg-orange-50" : "border-slate-200 bg-white hover:border-slate-300")}>
                <div className={cn("h-4 w-4 rounded border-2 flex items-center justify-center shrink-0",
                  selected.has(item.id) ? "border-primary bg-primary" : "border-slate-300")}>
                  {selected.has(item.id) && <span className="text-white text-[10px] font-bold">✓</span>}
                </div>
                <span className="flex-1 text-xs font-medium text-slate-800">{item.quantity}× {item.productName}</span>
                <span className="text-xs font-bold text-slate-700 shrink-0">€ {parseFloat(item.subtotal).toFixed(2)}</span>
              </button>
            ))}
          </div>
          {selected.size > 0 && (
            <div className="space-y-1 p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
              <div className="flex justify-between text-slate-400">
                <span>Prodotti</span><span>€ {itemsTotal.toFixed(2)}</span>
              </div>
              {splitCoverTotal > 0 && (
                <div className="flex justify-between text-slate-400">
                  <span>Coperti (quota)</span><span>€ {splitCoverTotal.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-slate-800 pt-1 border-t border-slate-200">
                <span>Totale separato</span><span className="text-primary">€ {splitTotal.toFixed(2)}</span>
              </div>
            </div>
          )}
          {selected.size > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-500 mb-2">Metodo di pagamento</div>
              <div className="grid grid-cols-3 gap-1.5">
                {(["cash", "card", "other"] as const).map(m => {
                  const icons = { cash: <Banknote className="h-3.5 w-3.5" />, card: <CreditCard className="h-3.5 w-3.5" />, other: <Wallet className="h-3.5 w-3.5" /> };
                  const labels = { cash: "Contanti", card: "Carta", other: "Altro" };
                  return (
                    <button key={m} onClick={() => setMethod(m)}
                      className={cn("flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-semibold border-2 transition-colors",
                        method === m ? "border-primary bg-orange-50 text-primary" : "border-slate-200 text-slate-600")}>
                      {icons[m]} {labels[m]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annulla</Button>
          <Button onClick={() => { onPay(method, splitTotal, [...selected]); onClose(); }} disabled={selected.size === 0}>
            Incassa € {splitTotal.toFixed(2)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Product Card ─────────────────────────────────────────────────────────────
function ProductCard({ product, onAdd }: {
  product: { id: number; name: string; price: string; available: boolean };
  onAdd: (id: number) => void;
}) {
  return (
    <button onClick={() => onAdd(product.id)}
      className="bg-white rounded-xl border-2 border-slate-200 p-4 text-left shadow-sm hover:border-primary hover:shadow-md active:scale-95 transition-all group min-h-[90px] flex flex-col justify-between">
      <div className="font-semibold text-sm text-slate-800 leading-tight group-hover:text-primary transition-colors">{product.name}</div>
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

// ─── Phase Indicator ──────────────────────────────────────────────────────────
function PhaseIndicator({ phase }: { phase: 1 | 2 | 3 | 4 }) {
  const phases = [
    { n: 1, label: "Prodotti" },
    { n: 2, label: "Tavolo" },
    { n: 3, label: "Comanda" },
    { n: 4, label: "Cassa" },
  ];
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-100 shrink-0">
      {phases.map((p, i) => (
        <div key={p.n} className="flex items-center">
          <div className={cn(
            "flex items-center gap-1 text-xs font-semibold",
            p.n < phase ? "text-emerald-600" : p.n === phase ? "text-primary" : "text-slate-300"
          )}>
            {p.n < phase ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <div className={cn("h-5 w-5 rounded-full border-2 flex items-center justify-center text-[10px] font-bold",
                p.n === phase ? "border-primary text-primary bg-orange-50" : "border-slate-300 text-slate-300")}>
                {p.n}
              </div>
            )}
            {p.label}
          </div>
          {i < phases.length - 1 && <div className="w-4 h-px bg-slate-200 mx-1.5" />}
        </div>
      ))}
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
  const coverPrice = parseFloat(settings["cover_price"] || "0");

  // State
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [quickOrderId, setQuickOrderId] = useState<number | null>(null);
  const [isQuickMode, setIsQuickMode] = useState<"rapida" | "asporto" | "delivery" | null>(null);

  // Dialog state
  const [showPayment, setShowPayment] = useState(false);
  const [showCovers, setShowCovers] = useState(false);
  const [showRomana, setShowRomana] = useState(false);
  const [showPreconto, setShowPreconto] = useState(false);
  const [showSplitBill, setShowSplitBill] = useState(false);
  const [showTableMap, setShowTableMap] = useState(false);
  const [pendingTableId, setPendingTableId] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ itemId: number; name: string } | null>(null);

  const { data: tablesStatus = [] } = useGetTablesStatus();
  const { data: categories = [] } = useListCategories();
  const { data: products = [] } = useListProducts({ categoryId: selectedCategoryId ?? undefined });

  const activeTableEntry = tablesStatus.find(t => t.id === selectedTableId) as FETable | undefined;
  const activeOrderId = isQuickMode
    ? quickOrderId ?? undefined
    : (activeTableEntry?.activeOrderId as number | undefined);

  const { data: activeOrder } = useGetOrder(activeOrderId!, { query: { enabled: !!activeOrderId } });
  const items = activeOrder?.items ?? [];
  const subtotal = parseFloat(activeOrder?.total ?? "0");
  const coverCount = isQuickMode ? 0 : (activeOrder?.covers ?? 0);
  const coverTotal = coverPrice > 0 && coverCount > 0 ? coverCount * coverPrice : 0;
  const total = subtotal + coverTotal;
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
    setIsQuickMode(null);
    setQuickOrderId(null);
    setShowTableMap(false);
    if (!table.activeOrderId) {
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
    refresh();
  }

  async function handleAddProduct(productId: number) {
    if (!activeOrderId) {
      setShowTableMap(true);
      toast({ title: "Prima seleziona un tavolo", variant: "destructive" });
      return;
    }
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
    if (qty <= 0) {
      const item = items.find(i => i.id === itemId);
      if (item && (item as never as { status: string }).status === "sent") {
        setDeleteConfirm({ itemId, name: item.productName });
        return;
      }
      await deleteItem.mutateAsync({ orderId: activeOrderId, itemId });
    } else {
      await updateItem.mutateAsync({ orderId: activeOrderId, itemId, data: { quantity: qty } });
    }
    refresh();
  }

  async function confirmDelete(notify: boolean) {
    if (!deleteConfirm || !activeOrderId) return;
    if (notify) {
      await fetch(`${API}/orders/${activeOrderId}/items/${deleteConfirm.itemId}/void`, { method: "POST" }).catch(() => {});
      toast({ title: "Avviso inviato al reparto", description: "Comanda di annullamento generata" });
    }
    await deleteItem.mutateAsync({ orderId: activeOrderId, itemId: deleteConfirm.itemId });
    refresh();
    setDeleteConfirm(null);
  }

  async function handleSendComanda() {
    if (!activeOrderId) return;
    const res = await fetch(`${API}/orders/${activeOrderId}/send-comanda`, { method: "POST" });
    const data = await res.json();
    refresh();
    toast({ title: "Comanda inviata", description: `${data.sentItems} righe inviate ai reparti` });
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

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#f4f6fa]">

      {/* ══ TOP BAR ══════════════════════════════════════════════════════════ */}
      <div className="h-14 bg-white border-b border-slate-200 flex items-center gap-3 px-4 shrink-0">

        {/* Table / mode indicator button */}
        <button
          onClick={() => {
            if (isQuickMode) { handleExitOrder(); return; }
            setShowTableMap(true);
          }}
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-xl border-2 text-sm font-semibold transition-all",
            activeOrderId || isQuickMode
              ? "border-primary bg-orange-50 text-primary hover:bg-orange-100"
              : "border-slate-200 text-slate-500 hover:border-primary hover:text-primary"
          )}
        >
          {ModeIcon ? <ModeIcon className="h-4 w-4" /> : <MapIcon className="h-4 w-4" />}
          {activeOrderId || isQuickMode ? (
            <span>{orderLabel}{coverCount > 0 ? ` · ${coverCount} cop.` : ""}</span>
          ) : (
            <span>Mappa Tavoli</span>
          )}
        </button>

        {/* Divider */}
        <div className="h-6 w-px bg-slate-200" />

        {/* Quick actions */}
        <div className="flex items-center gap-2">
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

      {/* ══ MAIN: always 2-panel ══════════════════════════════════════════════ */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Left: Categories + Products ───────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden border-r border-slate-200">
          {/* Search + breadcrumb */}
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
                {categories.length === 0 && (
                  <div className="col-span-3 flex flex-col items-center justify-center h-40 text-slate-400">
                    <UtensilsCrossed className="h-8 w-8 mb-2 opacity-25" />
                    <p className="text-sm">Nessuna categoria disponibile</p>
                  </div>
                )}
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

        {/* ── Right: Order panel ────────────────────────────────────────── */}
        <div className="w-80 flex flex-col bg-white shrink-0">

          {/* Phase indicator */}
          <PhaseIndicator phase={currentPhase} />

          {/* Table / order header */}
          <div className="px-4 py-3 border-b border-slate-100 shrink-0">
            <button
              onClick={() => !isQuickMode && setShowTableMap(true)}
              className={cn(
                "w-full flex items-center justify-between p-2.5 rounded-xl border-2 transition-all text-left",
                activeOrderId
                  ? "border-primary bg-orange-50"
                  : "border-dashed border-slate-300 hover:border-primary hover:bg-orange-50/50"
              )}
            >
              <div className="flex items-center gap-2">
                {ModeIcon ? <ModeIcon className="h-4 w-4 text-primary" /> : <MapIcon className="h-4 w-4 text-slate-400" />}
                <div>
                  {activeOrderId ? (
                    <>
                      <div className="text-sm font-bold text-primary">{orderLabel}</div>
                      <div className="text-xs text-slate-500 flex items-center gap-1">
                        <Users className="h-3 w-3" /> {coverCount} coperti
                        {activeOrderId && <span className="font-mono ml-1 text-slate-400">#{activeOrderId}</span>}
                      </div>
                    </>
                  ) : (
                    <span className="text-sm font-semibold text-slate-400">Seleziona tavolo dalla mappa</span>
                  )}
                </div>
              </div>
              {activeOrderId && (
                <button onClick={e => { e.stopPropagation(); handleExitOrder(); }}
                  className="text-xs text-slate-400 hover:text-red-500 transition-colors px-1.5 py-0.5 rounded hover:bg-red-50">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </button>
          </div>

          {/* Items list */}
          <ScrollArea className="flex-1 min-h-0">
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-12 text-slate-400">
                <UtensilsCrossed className="h-10 w-10 mb-3 opacity-25" />
                <p className="text-sm text-center text-slate-400">
                  {activeOrderId
                    ? "Seleziona una categoria\ne aggiungi prodotti"
                    : "Apri un tavolo o seleziona\nuna modalità rapida"}
                </p>
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
                          {!isDraft && <span className="shrink-0 text-[10px] px-1 rounded-full bg-emerald-100 text-emerald-700">✓ inv.</span>}
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
              <div className="space-y-1 px-1 pb-1">
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Prodotti</span>
                  <span>€ {subtotal.toFixed(2)}</span>
                </div>
                {coverTotal > 0 && (
                  <div className="flex justify-between text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      Coperti ({coverCount} × €{coverPrice.toFixed(2)})
                    </span>
                    <span>€ {coverTotal.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-0.5 border-t border-slate-100">
                  <span className="text-sm font-semibold text-slate-600">Totale</span>
                  <span className="text-xl font-bold text-primary">€ {total.toFixed(2)}</span>
                </div>
              </div>
            )}

            {/* Send comanda */}
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

            {/* Secondary actions */}
            <div className="grid grid-cols-3 gap-1.5">
              <button onClick={() => setShowPreconto(true)} disabled={items.length === 0}
                className="flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 active:scale-95 transition-all disabled:opacity-40">
                <FileText className="h-3.5 w-3.5" /> Preconto
              </button>
              <button onClick={() => setShowSplitBill(true)} disabled={items.length < 2}
                className="flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 active:scale-95 transition-all disabled:opacity-40">
                <Divide className="h-3.5 w-3.5" /> Separato
              </button>
              <button onClick={() => setShowRomana(true)} disabled={items.length === 0}
                className="flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 active:scale-95 transition-all disabled:opacity-40">
                <Users className="h-3.5 w-3.5" /> Romana
              </button>
            </div>

            {/* Pay */}
            <button onClick={() => setShowPayment(true)} disabled={items.length === 0}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary text-white text-base font-bold shadow-md hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-40">
              <CreditCard className="h-5 w-5" />
              {items.length > 0 ? `Paga € ${total.toFixed(2)}` : "Paga"}
            </button>
          </div>
        </div>
      </div>

      {/* ══ MODALS ═══════════════════════════════════════════════════════════ */}

      {/* Table map modal */}
      <TableMapModal
        open={showTableMap}
        onClose={() => setShowTableMap(false)}
        tablesStatus={tablesStatus as FETable[]}
        selectedTableId={selectedTableId}
        onTableClick={handleTableClick}
      />

      {/* Covers dialog */}
      <CoversDialog
        open={showCovers}
        onClose={() => { setShowCovers(false); setPendingTableId(null); }}
        tableName={tablesStatus.find(t => t.id === pendingTableId)?.name ?? ""}
        onConfirm={handleOpenTable}
      />

      {/* Delete sent item confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={o => !o && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" /> Articolo già inviato
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 text-sm text-slate-600">
            <strong>"{deleteConfirm?.name}"</strong> è già stato inviato al reparto.
            <br />Vuoi inviare un avviso di cancellazione al reparto?
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

      {/* Payment dialog */}
      <PaymentDialog open={showPayment} onClose={() => setShowPayment(false)} total={total} onPay={handlePay} />

      {/* Other dialogs */}
      <RomanaDialog open={showRomana} onClose={() => setShowRomana(false)} total={total} />
      <PrecontoDialog open={showPreconto} onClose={() => setShowPreconto(false)}
        order={activeOrder as never} items={items as never} />
      <SplitBillDialog
        open={showSplitBill}
        onClose={() => setShowSplitBill(false)}
        items={items as never}
        coverPrice={coverPrice}
        coverCount={coverCount}
        onPay={(method, amount) => handlePay(method, amount)}
      />
    </div>
  );
}
