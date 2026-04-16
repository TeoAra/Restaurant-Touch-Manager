import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTablesStatus,
  getGetTablesStatusQueryKey,
  useGetOrder,
  getGetOrderQueryKey,
  useListCategories,
  useListProducts,
  getListOrdersQueryKey,
  useCreateOrder,
  useAddOrderItem,
  useUpdateOrderItem,
  useDeleteOrderItem,
  useUpdateOrder,
  useCreatePayment,
} from "@workspace/api-client-react";
import type { TableStatus } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Users, Plus, Minus, Trash2, CreditCard, Banknote, Wallet,
  ShoppingBag, Clock, Send, FileText, Divide, ChevronRight, Search, X
} from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

// ─── Table Card ─────────────────────────────────────────────────────────────
function TableCard({ table, isSelected, onClick }: { table: TableStatus; isSelected: boolean; onClick: () => void }) {
  const status = table.status as "free" | "occupied" | "reserved";
  const statusConfig = {
    free: { bg: "bg-white border-slate-200 hover:border-emerald-300 hover:shadow-md", dot: "bg-emerald-500", label: "Libero", labelCls: "text-emerald-600 bg-emerald-50" },
    occupied: { bg: "bg-white border-slate-200 hover:border-orange-300 hover:shadow-md", dot: "bg-orange-500", label: "Occupato", labelCls: "text-orange-600 bg-orange-50" },
    reserved: { bg: "bg-white border-slate-200 hover:border-blue-300 hover:shadow-md", dot: "bg-blue-500", label: "Riservato", labelCls: "text-blue-600 bg-blue-50" },
  };
  const cfg = statusConfig[status];

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full p-3.5 rounded-xl border-2 text-left transition-all active:scale-95 shadow-sm",
        cfg.bg,
        isSelected && "border-primary ring-2 ring-primary/20 shadow-md"
      )}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="font-bold text-sm text-slate-800">{table.name}</div>
          <div className="flex items-center gap-1 text-slate-400 text-xs mt-0.5">
            <Users className="h-3 w-3" />
            <span>{table.seats} posti</span>
          </div>
        </div>
        <div className={cn("w-2 h-2 rounded-full mt-1.5", cfg.dot)} />
      </div>
      <div className="flex items-center justify-between mt-2.5">
        <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", cfg.labelCls)}>{cfg.label}</span>
        {table.activeOrderTotal && (
          <span className="text-sm font-bold text-primary">€ {table.activeOrderTotal}</span>
        )}
      </div>
      {table.activeOrderCreatedAt && (
        <div className="flex items-center gap-1 mt-1 text-xs text-slate-400">
          <Clock className="h-3 w-3" />
          <span>{new Date(table.activeOrderCreatedAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      )}
    </button>
  );
}

// ─── Payment Dialog ──────────────────────────────────────────────────────────
function PaymentDialog({
  open, onClose, total, onPay
}: { open: boolean; onClose: () => void; total: number; onPay: (method: string, amountGiven?: number) => void }) {
  const [method, setMethod] = useState<"cash" | "card" | "other">("cash");
  const [given, setGiven] = useState("");

  const change = method === "cash" && given ? Math.max(0, parseFloat(given) - total) : 0;
  const methods = [
    { id: "cash", label: "Contanti", icon: Banknote, color: "text-emerald-600" },
    { id: "card", label: "Carta / POS", icon: CreditCard, color: "text-blue-600" },
    { id: "other", label: "Altro", icon: Wallet, color: "text-purple-600" },
  ] as const;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="text-lg">Pagamento</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="text-center p-4 bg-slate-50 rounded-xl">
            <div className="text-sm text-slate-500 mb-1">Totale da pagare</div>
            <div className="text-4xl font-bold text-foreground">€ {total.toFixed(2)}</div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {methods.map(m => (
              <button key={m.id} onClick={() => setMethod(m.id)}
                className={cn("flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all", method === m.id ? "border-primary bg-primary/5" : "border-slate-200 hover:border-slate-300")}>
                <m.icon className={cn("h-6 w-6", m.color)} />
                <span className="text-xs font-medium text-slate-700">{m.label}</span>
              </button>
            ))}
          </div>
          {method === "cash" && (
            <div className="space-y-2">
              <Label>Importo ricevuto</Label>
              <Input type="number" step="0.01" placeholder="0.00" value={given}
                onChange={e => setGiven(e.target.value)} className="text-lg text-center h-12" />
              {parseFloat(given) >= total && (
                <div className="flex justify-between p-3 bg-emerald-50 rounded-lg">
                  <span className="text-sm text-emerald-700 font-medium">Resto</span>
                  <span className="text-lg font-bold text-emerald-700">€ {change.toFixed(2)}</span>
                </div>
              )}
            </div>
          )}
          {/* Quick cash amounts */}
          {method === "cash" && (
            <div className="grid grid-cols-4 gap-1.5">
              {[5, 10, 20, 50].map(v => (
                <button key={v} onClick={() => setGiven(v.toString())}
                  className="py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-sm font-medium text-slate-700 transition-colors">
                  €{v}
                </button>
              ))}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1">Annulla</Button>
          <Button onClick={() => onPay(method, parseFloat(given) || total)}
            disabled={method === "cash" && parseFloat(given) < total}
            className="flex-1 bg-primary hover:bg-primary/90 text-white">
            Incassa € {total.toFixed(2)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Covers Dialog ───────────────────────────────────────────────────────────
function CoversDialog({ open, onClose, tableName, onConfirm }: {
  open: boolean; onClose: () => void; tableName: string; onConfirm: (covers: number) => void;
}) {
  const [covers, setCovers] = useState(2);
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xs">
        <DialogHeader><DialogTitle>Coperti — {tableName}</DialogTitle></DialogHeader>
        <div className="py-4 text-center space-y-4">
          <div className="text-sm text-muted-foreground">Quanti coperti?</div>
          <div className="flex items-center justify-center gap-4">
            <button onClick={() => setCovers(c => Math.max(1, c - 1))}
              className="h-12 w-12 rounded-full border-2 border-slate-300 flex items-center justify-center hover:border-primary transition-colors">
              <Minus className="h-5 w-5" />
            </button>
            <span className="text-5xl font-bold text-foreground w-16 text-center">{covers}</span>
            <button onClick={() => setCovers(c => c + 1)}
              className="h-12 w-12 rounded-full border-2 border-slate-300 flex items-center justify-center hover:border-primary transition-colors">
              <Plus className="h-5 w-5" />
            </button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annulla</Button>
          <Button onClick={() => onConfirm(covers)}>Apri Tavolo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Romana Dialog ───────────────────────────────────────────────────────────
function RomanaDialog({ open, onClose, total }: { open: boolean; onClose: () => void; total: number }) {
  const [people, setPeople] = useState(2);
  const share = people > 0 ? total / people : 0;
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xs">
        <DialogHeader><DialogTitle>Divisione alla Romana</DialogTitle></DialogHeader>
        <div className="py-4 text-center space-y-4">
          <div className="text-2xl font-bold text-foreground">€ {total.toFixed(2)}</div>
          <div className="text-sm text-muted-foreground">Totale conto</div>
          <div className="flex items-center justify-center gap-4 mt-4">
            <button onClick={() => setPeople(p => Math.max(1, p - 1))}
              className="h-10 w-10 rounded-full border-2 border-slate-300 flex items-center justify-center hover:border-primary transition-colors">
              <Minus className="h-4 w-4" />
            </button>
            <span className="text-3xl font-bold w-12 text-center">{people}</span>
            <button onClick={() => setPeople(p => p + 1)}
              className="h-10 w-10 rounded-full border-2 border-slate-300 flex items-center justify-center hover:border-primary transition-colors">
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <div className="text-sm text-slate-500">{people} {people === 1 ? "persona" : "persone"}</div>
          <div className="p-4 bg-primary/5 rounded-xl mt-2">
            <div className="text-sm text-slate-600 mb-1">Ciascuno paga</div>
            <div className="text-3xl font-bold text-primary">€ {share.toFixed(2)}</div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose} className="w-full">Chiudi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Preconto Dialog ─────────────────────────────────────────────────────────
function PrecontoDialog({ open, onClose, order, items }: {
  open: boolean; onClose: () => void;
  order: { tableName?: string | null; covers?: number; total: string; createdAt: string } | null;
  items: Array<{ productName: string; quantity: number; unitPrice: string; subtotal: string }>;
}) {
  if (!order) return null;
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Preconto</DialogTitle></DialogHeader>
        <div className="py-2 space-y-3">
          <div className="text-center border-b border-dashed border-slate-200 pb-3">
            <div className="font-bold text-lg">{order.tableName || "Asporto"}</div>
            <div className="text-xs text-slate-400">{new Date(order.createdAt).toLocaleString("it-IT")}</div>
            {order.covers && <div className="text-xs text-slate-500 mt-0.5">Coperti: {order.covers}</div>}
          </div>
          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {items.map((item, i) => (
              <div key={i} className="flex justify-between text-sm">
                <div className="flex gap-2">
                  <span className="text-slate-400 w-6 text-center">{item.quantity}x</span>
                  <span className="text-slate-700">{item.productName}</span>
                </div>
                <span className="font-medium text-slate-800">€ {item.subtotal}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-dashed border-slate-200 pt-3">
            <div className="flex justify-between text-lg font-bold">
              <span>TOTALE</span>
              <span>€ {parseFloat(order.total).toFixed(2)}</span>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="w-full">Chiudi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function FrontOffice() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [activeRoomFilter, setActiveRoomFilter] = useState<string>("all");
  const [productSearch, setProductSearch] = useState("");
  const [isAsporto, setIsAsporto] = useState(false);

  const [showPayment, setShowPayment] = useState(false);
  const [showCovers, setShowCovers] = useState(false);
  const [showRomana, setShowRomana] = useState(false);
  const [showPreconto, setShowPreconto] = useState(false);
  const [pendingTableId, setPendingTableId] = useState<number | null>(null);

  // API data
  const { data: tablesStatus = [] } = useGetTablesStatus();
  const { data: categories = [] } = useListCategories();
  const { data: products = [] } = useListProducts({ categoryId: selectedCategoryId ?? undefined });

  // Active order for selected table
  const activeOrderId = tablesStatus.find(t => t.id === selectedTableId)?.activeOrderId as number | undefined;
  const { data: activeOrder } = useGetOrder(activeOrderId!, { query: { enabled: !!activeOrderId } });

  const createOrder = useCreateOrder();
  const addItem = useAddOrderItem();
  const updateItem = useUpdateOrderItem();
  const deleteItem = useDeleteOrderItem();
  const updateOrder = useUpdateOrder();
  const createPayment = useCreatePayment();

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: getGetTablesStatusQueryKey() });
    if (activeOrderId) qc.invalidateQueries({ queryKey: getGetOrderQueryKey(activeOrderId) });
    qc.invalidateQueries({ queryKey: getListOrdersQueryKey() });
  }, [qc, activeOrderId]);

  // Derive rooms from tables
  const rooms = Array.from(new Set(tablesStatus.map(t => (t as TableStatus & { roomName?: string }).roomName).filter(Boolean))) as string[];

  // Filter tables by room
  const filteredTables = tablesStatus.filter(t => {
    const roomName = (t as TableStatus & { roomName?: string }).roomName;
    return activeRoomFilter === "all" || roomName === activeRoomFilter;
  });

  // Handle table click
  function handleTableClick(table: TableStatus) {
    if (isAsporto) setIsAsporto(false);
    if (table.status === "free" && !table.activeOrderId) {
      setPendingTableId(table.id);
      setShowCovers(true);
    } else {
      setSelectedTableId(table.id);
    }
  }

  // Open table with covers
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
      refresh();
      toast({ title: "Tavolo aperto" });
    } catch {
      toast({ title: "Errore apertura tavolo", variant: "destructive" });
    } finally {
      setPendingTableId(null);
    }
  }

  // Asporto order
  async function handleAsporto() {
    setIsAsporto(true);
    setSelectedTableId(null);
    // Create takeaway order without table
    const res = await fetch(`${API}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tableId: null, covers: 1 }),
    });
    const order = await res.json();
    // We don't set a selectedTableId since it's asporto
    refresh();
    toast({ title: "Ordine asporto creato", description: `#${order.id}` });
  }

  // Add product to order
  async function handleAddProduct(productId: number) {
    if (!activeOrderId && !isAsporto) {
      if (!selectedTableId) {
        toast({ title: "Seleziona un tavolo prima", variant: "destructive" }); return;
      }
    }
    if (!activeOrderId) return;

    const existing = activeOrder?.items?.find(i => i.productId === productId);
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
      await deleteItem.mutateAsync({ orderId: activeOrderId, itemId });
    } else {
      await updateItem.mutateAsync({ orderId: activeOrderId, itemId, data: { quantity: qty } });
    }
    refresh();
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
    const total = parseFloat(activeOrder?.total || "0");
    await createPayment.mutateAsync({ data: { orderId: activeOrderId, method, amount: total.toFixed(2), amountGiven: amountGiven?.toFixed(2) } as never });
    setSelectedTableId(null);
    refresh();
    toast({ title: "Pagamento registrato", description: `€ ${total.toFixed(2)} — ${method}` });
  }

  const items = activeOrder?.items ?? [];
  const total = parseFloat(activeOrder?.total ?? "0");
  const hasDraftItems = items.some(i => (i as never as { status: string }).status === "draft");
  const tableName = tablesStatus.find(t => t.id === selectedTableId)?.name;

  // Filter products by search
  const visibleProducts = productSearch
    ? products.filter(p => p.name.toLowerCase().includes(productSearch.toLowerCase()))
    : products;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* ── Left: Tables ── */}
      <div className="w-64 flex flex-col bg-white border-r border-slate-200 shrink-0">
        {/* Header */}
        <div className="h-14 flex items-center justify-between px-4 border-b border-slate-200">
          <span className="font-bold text-slate-800 text-base">Sala</span>
          <button onClick={handleAsporto}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors">
            <ShoppingBag className="h-3.5 w-3.5" />
            Asporto
          </button>
        </div>

        {/* Room filter tabs */}
        <div className="px-3 pt-2.5 pb-0">
          <div className="flex gap-1 overflow-x-auto pb-2.5 scrollbar-none">
            {["all", ...rooms].map(room => (
              <button key={room}
                onClick={() => setActiveRoomFilter(room)}
                className={cn(
                  "px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
                  activeRoomFilter === room
                    ? "bg-primary text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                )}>
                {room === "all" ? "Tutte" : room}
              </button>
            ))}
          </div>
        </div>

        {/* Tables grid */}
        <ScrollArea className="flex-1 px-3 py-2">
          <div className="space-y-2">
            {filteredTables.map(table => (
              <TableCard key={table.id} table={table}
                isSelected={table.id === selectedTableId}
                onClick={() => handleTableClick(table)} />
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* ── Center: Categories + Products ── */}
      <div className="flex-1 flex flex-col min-w-0 bg-background">
        {/* Category tabs */}
        <div className="h-14 flex items-center bg-white border-b border-slate-200 px-4 gap-2 overflow-x-auto shrink-0">
          <button
            onClick={() => setSelectedCategoryId(null)}
            className={cn("px-4 py-2 rounded-lg text-sm font-semibold transition-all whitespace-nowrap",
              !selectedCategoryId ? "bg-primary text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>
            Tutti
          </button>
          {categories.map(cat => (
            <button key={cat.id}
              onClick={() => setSelectedCategoryId(cat.id)}
              className={cn("px-4 py-2 rounded-lg text-sm font-semibold transition-all whitespace-nowrap",
                selectedCategoryId === cat.id ? "bg-primary text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>
              {cat.name}
            </button>
          ))}
        </div>

        {/* Search bar */}
        <div className="px-4 py-2.5 bg-white border-b border-slate-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              value={productSearch}
              onChange={e => setProductSearch(e.target.value)}
              placeholder="Cerca prodotto..."
              className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            />
            {productSearch && (
              <button onClick={() => setProductSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                <X className="h-4 w-4 text-slate-400 hover:text-slate-600" />
              </button>
            )}
          </div>
        </div>

        {/* Product grid */}
        <ScrollArea className="flex-1 p-4">
          <div className="grid grid-cols-3 gap-3">
            {visibleProducts.filter(p => p.available).map(product => (
              <button key={product.id}
                onClick={() => handleAddProduct(product.id)}
                className="bg-white rounded-xl border border-slate-200 p-4 text-left hover:border-primary hover:shadow-md active:scale-95 transition-all shadow-sm group">
                <div className="font-semibold text-slate-800 text-sm leading-tight mb-1 group-hover:text-primary transition-colors">
                  {product.name}
                </div>
                {product.description && (
                  <div className="text-xs text-slate-400 truncate mb-2">{product.description}</div>
                )}
                <div className="text-base font-bold text-primary">€ {parseFloat(product.price).toFixed(2)}</div>
              </button>
            ))}
          </div>
          {visibleProducts.length === 0 && (
            <div className="flex flex-col items-center justify-center h-40 text-slate-400">
              <Search className="h-8 w-8 mb-2 opacity-40" />
              <span className="text-sm">Nessun prodotto trovato</span>
            </div>
          )}
        </ScrollArea>
      </div>

      {/* ── Right: Order Panel ── */}
      <div className="w-80 flex flex-col bg-white border-l border-slate-200 shrink-0">
        {/* Header */}
        <div className="h-14 flex items-center justify-between px-4 border-b border-slate-200">
          <div>
            <div className="font-bold text-slate-800 text-sm">
              {tableName ? tableName : isAsporto ? "Asporto" : "Comanda"}
            </div>
            {activeOrder?.covers && (
              <div className="text-xs text-slate-400 flex items-center gap-1">
                <Users className="h-3 w-3" /> {activeOrder.covers} coperti
              </div>
            )}
          </div>
          {activeOrderId && (
            <span className="text-xs text-slate-400 font-mono">#{activeOrderId}</span>
          )}
        </div>

        {/* Items */}
        <ScrollArea className="flex-1">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-16 text-slate-400">
              <div className="h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
                <ShoppingBag className="h-6 w-6 opacity-50" />
              </div>
              <p className="text-sm">Seleziona un tavolo</p>
              <p className="text-xs mt-1">e aggiungi prodotti</p>
            </div>
          ) : (
            <div className="px-4 py-3 space-y-2">
              {items.map(item => {
                const itemStatus = (item as never as { status: string }).status;
                return (
                  <div key={item.id} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-slate-800 truncate">{item.productName}</span>
                        {itemStatus === "sent" && (
                          <span className="shrink-0 text-xs px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-600">Inviata</span>
                        )}
                        {itemStatus === "draft" && (
                          <span className="shrink-0 text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600">Bozza</span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400">€ {parseFloat(item.unitPrice).toFixed(2)} cad.</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => handleQty(item.id, item.quantity - 1)}
                        className="h-7 w-7 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors">
                        <Minus className="h-3 w-3 text-slate-600" />
                      </button>
                      <span className="w-6 text-center text-sm font-semibold text-slate-800">{item.quantity}</span>
                      <button onClick={() => handleQty(item.id, item.quantity + 1)}
                        className="h-7 w-7 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors">
                        <Plus className="h-3 w-3 text-slate-600" />
                      </button>
                    </div>
                    <div className="text-sm font-bold text-slate-800 w-14 text-right shrink-0">
                      € {parseFloat(item.subtotal).toFixed(2)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Footer with totals and actions */}
        {items.length > 0 && (
          <div className="border-t border-slate-200 p-4 space-y-3">
            {/* Subtotal row */}
            <div className="flex justify-between text-sm text-slate-500">
              <span>Subtotale</span>
              <span>€ {total.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-bold text-lg text-slate-900">
              <span>Totale</span>
              <span className="text-primary">€ {total.toFixed(2)}</span>
            </div>

            <Separator />

            {/* Action buttons */}
            <div className="grid grid-cols-2 gap-2">
              {/* Send comanda */}
              <Button
                variant="outline"
                disabled={!hasDraftItems}
                onClick={handleSendComanda}
                className="col-span-2 gap-2 h-11 border-2 border-primary text-primary hover:bg-primary hover:text-white font-semibold transition-all">
                <Send className="h-4 w-4" />
                Invia Comanda
                {hasDraftItems && <span className="ml-auto bg-primary text-white text-xs px-1.5 rounded-full">
                  {items.filter(i => (i as never as { status: string }).status === "draft").length}
                </span>}
              </Button>

              {/* Preconto */}
              <Button
                variant="outline"
                onClick={() => setShowPreconto(true)}
                className="gap-2 h-10 text-sm font-medium">
                <FileText className="h-4 w-4" />
                Preconto
              </Button>

              {/* Romana */}
              <Button
                variant="outline"
                onClick={() => setShowRomana(true)}
                className="gap-2 h-10 text-sm font-medium">
                <Divide className="h-4 w-4" />
                Romana
              </Button>

              {/* Pay */}
              <Button
                onClick={() => setShowPayment(true)}
                className="col-span-2 h-12 bg-primary hover:bg-primary/90 text-white font-bold text-base gap-2 shadow-md">
                <CreditCard className="h-5 w-5" />
                Paga € {total.toFixed(2)}
              </Button>
            </div>
          </div>
        )}

        {!selectedTableId && !isAsporto && (
          <div className="border-t border-slate-200 p-4 text-center text-sm text-slate-400">
            Seleziona un tavolo per iniziare
          </div>
        )}
      </div>

      {/* Dialogs */}
      <CoversDialog
        open={showCovers}
        onClose={() => { setShowCovers(false); setPendingTableId(null); }}
        tableName={tablesStatus.find(t => t.id === pendingTableId)?.name ?? ""}
        onConfirm={handleOpenTable}
      />
      <PaymentDialog
        open={showPayment}
        onClose={() => setShowPayment(false)}
        total={total}
        onPay={handlePay}
      />
      <RomanaDialog
        open={showRomana}
        onClose={() => setShowRomana(false)}
        total={total}
      />
      <PrecontoDialog
        open={showPreconto}
        onClose={() => setShowPreconto(false)}
        order={activeOrder as never}
        items={items as never}
      />
    </div>
  );
}
