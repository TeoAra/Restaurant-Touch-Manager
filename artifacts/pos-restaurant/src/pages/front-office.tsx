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
  ChevronLeft, Search, X, UtensilsCrossed, Zap, Map as MapIcon,
  AlertTriangle, CheckCircle2, User, LogOut, Building2, Pencil,
  ArrowRightFromLine, ReceiptText, Trash2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Link } from "wouter";

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
type FETable = TableStatus & { roomName?: string; posX?: number; posY?: number; shape?: string; elementType?: string; rotation?: number };

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
      style={{ width: w * CELL - 6, height: h * CELL - 6, rotate: t.rotation ? `${t.rotation}deg` : undefined }}
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
function TableMapPanel({ tablesStatus, selectedTableId, onTableClick, onBack }: {
  tablesStatus: FETable[];
  selectedTableId: number | null;
  onTableClick: (t: FETable) => void;
  onBack: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    function updateScale() {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth - 32;
      const h = containerRef.current.clientHeight - 32;
      const canvasW = COLS * CELL;
      const canvasH = ROWS * CELL;
      setScale(Math.min(1, w / canvasW, h / canvasH));
    }
    updateScale();
    const ro = new ResizeObserver(updateScale);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const rooms = Array.from(new Map(
    tablesStatus
      .filter(t => t.roomName)
      .map(t => [t.roomName!, t.roomName!])
  ).values());

  const [roomFilter, setRoomFilter] = useState<string | null>(() => rooms[0] ?? null);
  useEffect(() => {
    if (roomFilter === null && rooms.length > 0) setRoomFilter(rooms[0]);
  }, [rooms.join(",")]);

  const filtered = tablesStatus.filter(t =>
    roomFilter === null || t.roomName === roomFilter
  );

  const freeCount = filtered.filter(t => t.elementType !== "table" ? false : t.status === "free").length;
  const occupiedCount = filtered.filter(t => t.elementType !== "table" ? false : t.status === "occupied").length;

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="px-4 py-3 bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={onBack}
              className="h-9 w-9 rounded-lg border-2 border-slate-200 flex items-center justify-center hover:border-primary hover:text-primary transition-colors">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2">
              <MapIcon className="h-4 w-4 text-primary" />
              <span className="font-bold text-slate-800 text-sm">Mappa Tavoli</span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs shrink-0">
            <span className="flex items-center gap-1 text-emerald-600 font-semibold">
              <div className="h-2 w-2 rounded-full bg-emerald-500" /> {freeCount} liberi
            </span>
            <span className="flex items-center gap-1 text-orange-500 font-semibold">
              <div className="h-2 w-2 rounded-full bg-orange-500" /> {occupiedCount} occupati
            </span>
          </div>
        </div>
        {rooms.length > 1 && (
          <div className="flex gap-1.5 mt-2.5 overflow-x-auto pb-0.5">
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

      {/* Floor plan */}
      <div ref={containerRef} className="flex-1 overflow-hidden p-4 bg-[#f4f6fa] flex items-start justify-center">
        <div
          className="border border-slate-200 rounded-2xl bg-[#f8fafc] overflow-hidden shrink-0"
          style={{ width: COLS * CELL * scale, height: ROWS * CELL * scale }}
        >
          <div
            className="relative select-none origin-top-left"
            style={{ width: COLS * CELL, height: ROWS * CELL, transform: `scale(${scale})` }}
          >
            {Array.from({ length: ROWS + 1 }).map((_, i) => (
              <div key={`h${i}`} className="absolute left-0 right-0 border-b border-slate-200/60" style={{ top: i * CELL }} />
            ))}
            {Array.from({ length: COLS + 1 }).map((_, i) => (
              <div key={`v${i}`} className="absolute top-0 bottom-0 border-r border-slate-200/60" style={{ left: i * CELL }} />
            ))}
            {filtered.map(t => (
              <div key={t.id} className="absolute" style={{ left: (t.posX ?? 0) * CELL + 3, top: (t.posY ?? 0) * CELL + 3 }}>
                <FloorElement t={t} isSelected={t.id === selectedTableId} onClick={() => onTableClick(t)} />
              </div>
            ))}
          </div>
        </div>
      </div>
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

// ─── New-customer mini-form (inside PaymentDialog) ────────────────────────────
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
  const { toast } = useToast();

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
      <Input placeholder="Ragione sociale / Nome *" value={ragioneSociale} onChange={e => setRagioneSociale(e.target.value)} className="h-9 text-sm" />
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder="P.IVA" value={partitaIva} onChange={e => setPartitaIva(e.target.value)} className="h-8 text-sm font-mono" />
        <Input placeholder="Cod. Fiscale" value={codiceFiscale} onChange={e => setCodiceFiscale(e.target.value)} className="h-8 text-sm font-mono" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder="Cod. SDI" value={sdiCode} onChange={e => setSdiCode(e.target.value)} className="h-8 text-sm font-mono" />
        <Input placeholder="PEC" value={pec} onChange={e => setPec(e.target.value)} className="h-8 text-sm" />
      </div>
      <Input placeholder="Via / Indirizzo" value={via} onChange={e => setVia(e.target.value)} className="h-8 text-sm" />
      <div className="grid grid-cols-5 gap-2">
        <Input placeholder="CAP" value={cap} onChange={e => setCap(e.target.value)} className="h-8 text-sm col-span-2" />
        <Input placeholder="Comune" value={comune} onChange={e => setComune(e.target.value)} className="h-8 text-sm col-span-2" />
        <Input placeholder="PR" value={provincia} maxLength={2} onChange={e => setProvincia(e.target.value.toUpperCase())} className="h-8 text-sm text-center font-mono col-span-1" />
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

function PaymentDialog({ open, onClose, total, orderId, orderItems, onPay }: {
  open: boolean; onClose: () => void; total: number; orderId?: number;
  orderItems?: Array<{ productName: string; quantity: number; unitPrice: string; subtotal: string }>;
  onPay: (method: string, amountGiven?: number, invoiceCustomerId?: number) => void;
}) {
  const [method, setMethod] = useState<"cash" | "card" | "other">("cash");
  const [given, setGiven] = useState("");
  const [emittiFattura, setEmittiFattura] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customers, setCustomers] = useState<SimpleCustomer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<SimpleCustomer | null>(null);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [showNewCustomer, setShowNewCustomer] = useState(false);

  const change = method === "cash" && given ? Math.max(0, parseFloat(given) - total) : 0;

  useEffect(() => {
    if (!open) { setGiven(""); setEmittiFattura(false); setSelectedCustomer(null); setCustomerSearch(""); setShowNewCustomer(false); }
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

  const canPay = method !== "cash" || parseFloat(given) >= total;
  const canConfirm = canPay && (!emittiFattura || selectedCustomer !== null);

  const methods = [
    { id: "cash" as const, label: "Contanti", icon: Banknote, color: "text-emerald-600" },
    { id: "card" as const, label: "Carta/POS", icon: CreditCard, color: "text-blue-600" },
    { id: "other" as const, label: "Altro", icon: Wallet, color: "text-purple-600" },
  ];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm w-full">
        <DialogHeader><DialogTitle>Pagamento</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1 max-h-[85vh] overflow-y-auto">
          <div className="text-center py-3 bg-slate-50 rounded-xl">
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
                <span className={cn("text-sm font-semibold", emittiFattura ? "text-primary" : "text-slate-600")}>
                  Emetti Fattura Elettronica
                </span>
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

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1">Annulla</Button>
          <Button
            onClick={() => onPay(method, parseFloat(given) || total, emittiFattura && selectedCustomer ? selectedCustomer.id : undefined)}
            disabled={!canConfirm}
            className="flex-1"
          >
            {emittiFattura ? "Incassa + Fattura" : `Incassa € ${total.toFixed(2)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Covers Dialog (allows 0) ─────────────────────────────────────────────────
function CoversDialog({ open, onClose, tableName, onConfirm, initialCovers = 2, mode = "open" }: {
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
  const [method, setMethod] = useState<"cash" | "card" | "other">("cash");

  useEffect(() => {
    if (open) { setQty({}); setMethod("cash"); }
  }, [open]);

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
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Divide className="h-4 w-4" /> Conto Separato</DialogTitle></DialogHeader>
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
          <Button
            onClick={() => {
              const ids = allRows.filter(r => (qty[r.id] ?? 0) > 0 && !r.isCover).map(r => r.id);
              onPay(method, splitTotal, ids);
              onClose();
            }}
            disabled={!hasSelection}
          >
            Incassa € {splitTotal.toFixed(2)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Item Edit Dialog (note + modifica prezzo + variazioni) ───────────────────
type EditableItem = { id: number; productName: string; quantity: number; unitPrice: string; notes?: string | null; status: string };
function ItemEditDialog({ open, onClose, item, onSave }: {
  open: boolean; onClose: () => void;
  item: EditableItem | null;
  onSave: (itemId: number, notes: string, unitPrice: string) => void;
}) {
  const [notes, setNotes] = useState("");
  const [price, setPrice] = useState("");

  useEffect(() => {
    if (open && item) {
      setNotes(item.notes ?? "");
      setPrice(parseFloat(item.unitPrice).toFixed(2));
    }
  }, [open, item]);

  if (!item) return null;

  const originalPrice = parseFloat(item.unitPrice);
  const currentPrice = parseFloat(price) || 0;
  const priceDiff = currentPrice - originalPrice;

  const QUICK_MODS = [
    { label: "Senza cipolla", val: "- Senza cipolla", price: 0 },
    { label: "Senza glutine", val: "- Senza glutine", price: 0 },
    { label: "+ Salsa extra", val: "+ Salsa extra", price: 0.5 },
    { label: "+ Extra formaggio", val: "+ Extra formaggio", price: 1.0 },
    { label: "+ Doppio", val: "+ Doppio", price: 2.0 },
    { label: "Ben cotto", val: "· Ben cotto", price: 0 },
    { label: "Al sangue", val: "· Al sangue", price: 0 },
    { label: "Senza ghiaccio", val: "- Senza ghiaccio", price: 0 },
  ];

  function addMod(mod: { val: string; price: number }) {
    setNotes(n => n ? `${n}, ${mod.val}` : mod.val);
    if (mod.price !== 0) {
      setPrice(p => (parseFloat(p) + mod.price).toFixed(2));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-primary" />
            Modifica Riga
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

          {/* Variazioni rapide */}
          <div>
            <div className="text-xs font-semibold text-slate-500 mb-1.5">Variazioni rapide</div>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_MODS.map(m => (
                <button key={m.val} onClick={() => addMod(m)}
                  className="px-2.5 py-1 rounded-full border border-slate-200 text-xs text-slate-600 hover:border-primary hover:text-primary hover:bg-orange-50 transition-all">
                  {m.label}{m.price > 0 ? ` +€${m.price.toFixed(2)}` : ""}
                </button>
              ))}
            </div>
          </div>

          {/* Note libere */}
          <div>
            <Label className="text-xs font-semibold text-slate-500 mb-1 block">Note libere</Label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Es. senza sale, extra piccante…"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm resize-none outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
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
          <Button onClick={() => { onSave(item.id, notes, parseFloat(price).toFixed(2)); onClose(); }}>Salva</Button>
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
    <div className="col-span-full flex flex-col items-center justify-center h-40 text-slate-400">
      <UtensilsCrossed className="h-8 w-8 mb-2 opacity-25" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

// ─── Phase Indicator ──────────────────────────────────────────────────────────
function PhaseIndicator({ phase }: { phase: 1 | 2 | 3 | 4 }) {
  const phases = [
    { n: 1, label: "Tavolo" },
    { n: 2, label: "Prodotti" },
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
  const [isAssigningTable, setIsAssigningTable] = useState(false);
  const [assignPendingTableId, setAssignPendingTableId] = useState<number | null>(null);

  // Mobile panel toggle ("menu" | "order")
  const [mobilePanel, setMobilePanel] = useState<"menu" | "order">("menu");

  // Dialog state
  const [showPayment, setShowPayment] = useState(false);
  const [showCovers, setShowCovers] = useState(false);
  const [showEditCovers, setShowEditCovers] = useState(false);
  const [showRomana, setShowRomana] = useState(false);
  const [showPreconto, setShowPreconto] = useState(false);
  const [showSplitBill, setShowSplitBill] = useState(false);
  const [leftView, setLeftView] = useState<"categories" | "tablemap">("categories");
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [pendingTableId, setPendingTableId] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ itemId: number; name: string } | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [editingItem, setEditingItem] = useState<EditableItem | null>(null);

  const { data: tablesStatus = [] } = useGetTablesStatus();
  const { data: categories = [] } = useListCategories();
  const { data: products = [] } = useListProducts({ categoryId: selectedCategoryId ?? undefined });

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

    // "Assegna Tavolo" mode: move quick order to a real table
    if (isAssigningTable && quickOrderId) {
      if (table.activeOrderId) {
        toast({ title: "Tavolo occupato", description: "Scegli un tavolo libero", variant: "destructive" });
        return;
      }
      setAssignPendingTableId(table.id);
      setPendingTableId(table.id);
      setShowCovers(true);
      return;
    }

    setIsQuickMode(null);
    setQuickOrderId(null);
    setLeftView("categories");
    if (!table.activeOrderId) {
      setPendingTableId(table.id);
      setShowCovers(true);
    } else {
      setSelectedTableId(table.id);
      setSelectedCategoryId(null);
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
      setLeftView("categories");
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
    refresh();
  }

  async function handleCancelOrder() {
    if (!activeOrderId) return;
    try {
      await fetch(`${API}/orders/${activeOrderId}`, { method: "DELETE" });
      toast({ title: "Ordine annullato", description: "Il tavolo è stato liberato" });
    } catch {
      toast({ title: "Errore durante l'annullamento", variant: "destructive" });
    }
    setShowCancelConfirm(false);
    handleExitOrder();
  }

  async function handleAddProduct(productId: number) {
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
      setMobilePanel("order");
      orderId = order.id;
    }
    const existing = items.find(i => i.productId === productId);
    if (existing && orderId === activeOrderId) {
      await updateItem.mutateAsync({ orderId, itemId: existing.id, data: { quantity: existing.quantity + 1 } });
    } else {
      await addItem.mutateAsync({ orderId, data: { productId, quantity: 1 } });
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

  async function handleSaveItemEdit(itemId: number, notes: string, unitPrice: string) {
    if (!activeOrderId) return;
    await updateItem.mutateAsync({
      orderId: activeOrderId,
      itemId,
      data: { notes, unitPrice } as never,
    });
    refresh();
    toast({ title: "Riga aggiornata" });
  }

  async function handleSendComanda() {
    if (!activeOrderId) return;
    const res = await fetch(`${API}/orders/${activeOrderId}/send-comanda`, { method: "POST" });
    const data = await res.json();
    refresh();
    toast({ title: "Comanda inviata", description: `${data.sentItems} righe inviate ai reparti` });
  }

  async function handlePay(method: string, amountGiven?: number, invoiceCustomerId?: number) {
    if (!activeOrderId) return;
    setShowPayment(false);
    await createPayment.mutateAsync({
      data: { orderId: activeOrderId, method, amount: total.toFixed(2), amountGiven: amountGiven?.toFixed(2) } as never
    });
    if (invoiceCustomerId && items.length > 0) {
      try {
        const righe = items.map(i => ({
          descrizione: (i as never as { productName: string }).productName,
          quantita: (i as never as { quantity: number }).quantity,
          prezzoUnitario: (i as never as { unitPrice: string }).unitPrice,
          aliquotaIva: "22",
          imponibile: (i as never as { subtotal: string }).subtotal,
        }));
        const imponibile = righe.reduce((s, r) => s + parseFloat(r.imponibile || "0"), 0);
        const iva = imponibile * 0.22;
        const invRes = await fetch(`${API}/invoices`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerId: invoiceCustomerId,
            orderId: activeOrderId,
            tipoDocumento: "TD01",
            imponibile: imponibile.toFixed(2),
            aliquotaIva: "22",
            iva: iva.toFixed(2),
            totale: (imponibile + iva).toFixed(2),
            righe,
          }),
        });
        if (invRes.ok) {
          const inv = await invRes.json();
          await fetch(`${API}/invoices/${inv.id}/emit`, { method: "POST" });
          toast({ title: "Fattura emessa", description: `N. ${inv.numero}/${inv.anno}` });
        }
      } catch {
        toast({ title: "Pagamento OK — errore fattura", variant: "destructive" });
      }
    }
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
            setLeftView(leftView === "tablemap" ? "categories" : "tablemap");
          }}
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-xl border-2 text-sm font-semibold transition-all",
            leftView === "tablemap"
              ? "border-primary bg-primary/10 text-primary"
              : activeOrderId || isQuickMode
                ? "border-primary bg-orange-50 text-primary hover:bg-orange-100"
                : "border-slate-200 text-slate-500 hover:border-primary hover:text-primary"
          )}
        >
          {ModeIcon ? <ModeIcon className="h-4 w-4" /> : <MapIcon className="h-4 w-4" />}
          {activeOrderId || isQuickMode ? (
            <span className="hidden xs:inline">{orderLabel}{coverCount > 0 ? ` · ${coverCount} cop.` : ""}</span>
          ) : (
            <span className="hidden xs:inline">Mappa Tavoli</span>
          )}
        </button>

        {/* Divider */}
        <div className="h-6 w-px bg-slate-200" />

        {/* Quick actions */}
        <div className="flex items-center gap-1.5 md:gap-2">
          {enableAsporto && (
            <button onClick={() => handleQuickMode("asporto")}
              className="flex items-center gap-1.5 px-2.5 md:px-3 py-2 rounded-lg bg-orange-50 text-primary text-sm font-semibold border border-orange-200 hover:bg-orange-100 active:scale-95 transition-all">
              <ShoppingBag className="h-4 w-4" />
              <span className="hidden sm:inline">Asporto</span>
            </button>
          )}
          {enableDelivery && (
            <button onClick={() => handleQuickMode("delivery")}
              className="flex items-center gap-1.5 px-2.5 md:px-3 py-2 rounded-lg bg-blue-50 text-blue-700 text-sm font-semibold border border-blue-200 hover:bg-blue-100 active:scale-95 transition-all">
              <Truck className="h-4 w-4" />
              <span className="hidden sm:inline">Delivery</span>
            </button>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* User menu */}
        <UserMenuButton showUserMenu={showUserMenu} setShowUserMenu={setShowUserMenu} />
      </div>

      {/* ══ MAIN ═════════════════════════════════════════════════════════════ */}
      <div className="flex flex-1 min-h-0 overflow-hidden pb-14 md:pb-0">

        {/* ── Left: Categories + Products or Table Map ──────────────────── */}
        <div className={cn(
          "flex-1 flex flex-col min-w-0 overflow-hidden border-r border-slate-200",
          mobilePanel === "order" ? "hidden md:flex" : "flex"
        )}>
          {leftView === "tablemap" ? (
            <>
              {isAssigningTable && (
                <div className="flex items-center justify-between px-4 py-2 bg-amber-50 border-b border-amber-200 shrink-0">
                  <div className="flex items-center gap-2 text-amber-700 text-sm font-semibold">
                    <ArrowRightFromLine className="h-4 w-4" />
                    Seleziona il tavolo a cui assegnare l'ordine
                  </div>
                  <button
                    onClick={() => { setIsAssigningTable(false); setLeftView("categories"); }}
                    className="text-xs text-amber-600 hover:text-amber-800 font-medium px-2 py-1 rounded hover:bg-amber-100 transition-colors"
                  >
                    Annulla
                  </button>
                </div>
              )}
              <TableMapPanel
                tablesStatus={tablesStatus as FETable[]}
                selectedTableId={selectedTableId}
                onTableClick={handleTableClick}
                onBack={() => { setIsAssigningTable(false); setLeftView("categories"); }}
              />
            </>
          ) : (
          <>
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
              <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-3">
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
                  <div className="col-span-full flex flex-col items-center justify-center h-40 text-slate-400">
                    <UtensilsCrossed className="h-8 w-8 mb-2 opacity-25" />
                    <p className="text-sm">Nessuna categoria disponibile</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-3">
                {visibleProducts.filter(p => p.available).map(p => (
                  <ProductCard key={p.id} product={p} onAdd={handleAddProduct} />
                ))}
                {visibleProducts.filter(p => p.available).length === 0 && (
                  <EmptyState label="Nessun prodotto in questa categoria" />
                )}
              </div>
            )}
          </ScrollArea>
          </>
          )}
        </div>

        {/* ── Right: Order panel ────────────────────────────────────────── */}
        <div className={cn(
          "w-full md:w-80 flex flex-col bg-white shrink-0",
          mobilePanel === "menu" ? "hidden md:flex" : "flex"
        )}>

          {/* Phase indicator */}
          <PhaseIndicator phase={currentPhase} />

          {/* Table / order header */}
          <div className="px-4 py-3 border-b border-slate-100 shrink-0">
            <div
              role="button" tabIndex={0}
              onClick={() => !isQuickMode && !activeOrderId && setLeftView("tablemap")}
              onKeyDown={e => e.key === "Enter" && !isQuickMode && !activeOrderId && setLeftView("tablemap")}
              className={cn(
                "w-full flex items-center justify-between p-2.5 rounded-xl border-2 transition-all cursor-pointer",
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
                        {!isQuickMode && (
                          <button
                            onClick={e => { e.stopPropagation(); setShowEditCovers(true); }}
                            className="ml-0.5 h-4 w-4 flex items-center justify-center rounded hover:bg-orange-200 transition-colors"
                            title="Modifica coperti"
                          >
                            <Pencil className="h-2.5 w-2.5 text-primary" />
                          </button>
                        )}
                        
                        <span className="font-mono ml-1 text-slate-400">#{activeOrderId}</span>
                      </div>
                    </>
                  ) : (
                    <span className="text-sm font-semibold text-slate-400">Seleziona tavolo dalla mappa</span>
                  )}
                </div>
              </div>
              {activeOrderId && (
                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  <button
                    title="Annulla tutto l'ordine"
                    onClick={e => { e.stopPropagation(); setShowCancelConfirm(true); }}
                    className="h-7 w-7 flex items-center justify-center rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={e => { e.stopPropagation(); handleExitOrder(); }}
                    className="h-7 w-7 flex items-center justify-center rounded text-slate-400 hover:text-red-500 transition-colors hover:bg-red-50">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Assegna a Tavolo — banner visibile in quick mode */}
          {isQuickMode === "rapida" && activeOrderId && (
            <div className="px-4 py-2 shrink-0">
              <button
                onClick={() => {
                  setIsAssigningTable(true);
                  setLeftView("tablemap");
                  setMobilePanel("menu");
                }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-primary text-primary font-semibold text-sm hover:bg-orange-50 active:scale-95 transition-all"
              >
                <ArrowRightFromLine className="h-4 w-4" />
                Assegna a un Tavolo
              </button>
            </div>
          )}

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
                  const itemNotes = (item as never as { notes?: string | null }).notes;
                  const itemStatus = (item as never as { status: string }).status;
                  return (
                    <div key={item.id} className={cn(
                      "rounded-xl border",
                      isDraft ? "bg-orange-50 border-orange-200" : "bg-slate-50 border-slate-200"
                    )}>
                      <div className="flex items-center gap-2 p-2.5">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1">
                            <span className="text-xs font-semibold text-slate-800 truncate">{item.productName}</span>
                            {!isDraft && <span className="shrink-0 text-[10px] px-1 rounded-full bg-emerald-100 text-emerald-700">✓ inv.</span>}
                          </div>
                          <span className="text-[10px] text-slate-400">€{parseFloat(item.unitPrice).toFixed(2)} cad.</span>
                        </div>
                        {/* Edit button */}
                        <button
                          onClick={() => setEditingItem({ id: item.id, productName: item.productName, quantity: item.quantity, unitPrice: item.unitPrice, notes: itemNotes, status: itemStatus })}
                          className="h-7 w-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center hover:border-primary hover:text-primary transition-colors shrink-0"
                          title="Modifica riga"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
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
                      {/* Notes display */}
                      {itemNotes && (
                        <div className="px-3 pb-2 -mt-1">
                          <span className="text-[10px] text-slate-500 italic bg-white/70 px-2 py-0.5 rounded-full border border-slate-200">
                            {itemNotes}
                          </span>
                        </div>
                      )}
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
              <button onClick={() => setShowSplitBill(true)}
                disabled={(items.length + (coverPrice > 0 && coverCount > 0 ? coverCount : 0)) < 2}
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

      {/* ══ MOBILE BOTTOM TAB BAR (hidden on md+) ════════════════════════════ */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-slate-200 flex" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <button
          onClick={() => setMobilePanel("menu")}
          className={cn(
            "flex-1 flex flex-col items-center justify-center gap-1 py-3 text-xs font-semibold transition-colors",
            mobilePanel === "menu" ? "text-primary" : "text-slate-400"
          )}
        >
          <UtensilsCrossed className="h-5 w-5" />
          <span>Menu</span>
        </button>
        <button
          onClick={() => setMobilePanel("order")}
          className={cn(
            "flex-1 flex flex-col items-center justify-center gap-1 py-3 text-xs font-semibold transition-colors relative",
            mobilePanel === "order" ? "text-primary" : "text-slate-400"
          )}
        >
          <div className="relative">
            <FileText className="h-5 w-5" />
            {items.length > 0 && (
              <span className="absolute -top-1.5 -right-2 bg-primary text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                {items.length}
              </span>
            )}
          </div>
          <span>Ordine{total > 0 ? ` · €${total.toFixed(2)}` : ""}</span>
        </button>
      </div>

      {/* ══ MODALS ═══════════════════════════════════════════════════════════ */}

      {/* Item edit dialog */}
      <ItemEditDialog
        open={!!editingItem}
        onClose={() => setEditingItem(null)}
        item={editingItem}
        onSave={handleSaveItemEdit}
      />

      {/* Covers dialog — open table */}
      <CoversDialog
        open={showCovers}
        onClose={() => { setShowCovers(false); setPendingTableId(null); }}
        tableName={tablesStatus.find(t => t.id === pendingTableId)?.name ?? ""}
        onConfirm={handleOpenTable}
        mode="open"
      />

      {/* Covers dialog — edit existing order */}
      <CoversDialog
        open={showEditCovers}
        onClose={() => setShowEditCovers(false)}
        tableName={orderLabel}
        initialCovers={coverCount}
        onConfirm={handleEditCovers}
        mode="edit"
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
      <PaymentDialog
        open={showPayment}
        onClose={() => setShowPayment(false)}
        total={total}
        orderId={activeOrderId}
        orderItems={items as never}
        onPay={handlePay}
      />

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

      {/* Annulla tutto — conferma */}
      <AlertDialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-red-500" />
              Annulla tutto l'ordine?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {items.length > 0
                ? `Verranno eliminati ${items.length} prodott${items.length === 1 ? "o" : "i"} e il tavolo verrà liberato. L'azione non è reversibile.`
                : "Il tavolo verrà liberato. L'azione non è reversibile."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancelOrder}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Sì, annulla ordine
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
