import { useMemo, useState } from "react";
import { useListPayments, useListOrders } from "@workspace/api-client-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CreditCard, Banknote, Wallet, Receipt, Ticket, Download, ChevronRight, Loader2 } from "lucide-react";
import { BackofficeShell } from "@/components/BackofficeShell";
import { downloadCsv, itNum } from "@/lib/csv";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

type OrderItem = {
  id: number;
  productName?: string | null;
  quantity: number;
  unitPrice: string;
  subtotal?: string | null;
  modifiers?: string | null;
};

type OrderDetail = {
  id: number;
  tableName?: string | null;
  covers?: number | null;
  total?: string | null;
  createdAt?: string;
  items: OrderItem[];
};

const methodIcon: Record<string, React.ElementType> = {
  cash: Banknote,
  card: CreditCard,
  ticket: Ticket,
  other: Wallet,
};

const methodLabel: Record<string, string> = {
  cash: "Contanti",
  card: "Carta",
  ticket: "Buoni Pasto",
  other: "Altro",
};

export default function PaymentsPage() {
  const { data: payments = [], isLoading } = useListPayments();
  const { data: orders = [] } = useListOrders({});

  // Filtri: periodo + metodo di pagamento
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [method, setMethod] = useState<string>("all");

  // Dettaglio ordine (cosa ha preso il cliente)
  const [detail, setDetail] = useState<{ open: boolean; loading: boolean; order?: OrderDetail; error?: string }>({ open: false, loading: false });

  async function openDetail(orderId: number) {
    setDetail({ open: true, loading: true });
    try {
      const res = await fetch(`${API}/orders/${orderId}`);
      if (!res.ok) throw new Error(`Ordine #${orderId} non trovato (${res.status})`);
      const order = await res.json() as OrderDetail;
      setDetail({ open: true, loading: false, order });
    } catch (e) {
      setDetail({ open: true, loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const orderMap = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);

  // Metodi effettivamente presenti nello storico (per il selettore)
  const availableMethods = useMemo(
    () => Array.from(new Set(payments.map(p => p.method))).sort(),
    [payments],
  );

  const filtered = useMemo(() => {
    return payments.filter(p => {
      if (method !== "all" && p.method !== method) return false;
      const d = new Date(p.createdAt);
      if (from && d < new Date(`${from}T00:00:00`)) return false;
      if (to) {
        const end = new Date(`${to}T00:00:00`);
        end.setDate(end.getDate() + 1);
        if (d >= end) return false;
      }
      return true;
    });
  }, [payments, method, from, to]);

  const total = filtered.reduce((sum, p) => sum + parseFloat(p.amount), 0);

  const exportCsv = () => {
    downloadCsv(
      `pagamenti${from ? `_${from}` : ""}${to ? `_${to}` : ""}.csv`,
      ["Data", "Ora", "Tavolo/Ordine", "Metodo", "Importo", "Resto"],
      filtered.map(p => {
        const order = orderMap.get(p.orderId);
        const d = new Date(p.createdAt);
        return [
          d.toLocaleDateString("it-IT"),
          d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }),
          order?.tableName ?? (order ? "Asporto" : `Ordine #${p.orderId}`),
          methodLabel[p.method] ?? p.method,
          itNum(p.amount),
          p.change && parseFloat(p.change) > 0 ? itNum(p.change) : "",
        ];
      }),
    );
  };

  return (
    <BackofficeShell
      title="Storico Pagamenti"
      subtitle={`${filtered.length} transazioni — Totale: € ${total.toFixed(2)}`}
      fixedHeight
    >
      {/* Barra filtri */}
      <div className="px-6 pt-4 flex items-center gap-2 flex-wrap text-sm">
        <label className="text-muted-foreground">Dal</label>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)}
          className="bg-background border border-border rounded-md px-2 py-1.5 text-sm" />
        <label className="text-muted-foreground">al</label>
        <input type="date" value={to} onChange={e => setTo(e.target.value)}
          className="bg-background border border-border rounded-md px-2 py-1.5 text-sm" />
        <div className="flex rounded-lg border border-border overflow-hidden ml-2">
          <button
            onClick={() => setMethod("all")}
            className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
              method === "all" ? "bg-primary text-white" : "bg-background text-muted-foreground hover:bg-muted"
            }`}
          >
            Tutti
          </button>
          {availableMethods.map(m => (
            <button
              key={m}
              onClick={() => setMethod(m)}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                method === m ? "bg-primary text-white" : "bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              {methodLabel[m] ?? m}
            </button>
          ))}
        </div>
        {(from || to || method !== "all") && (
          <button
            onClick={() => { setFrom(""); setTo(""); setMethod("all"); }}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Azzera filtri
          </button>
        )}
        <button
          onClick={exportCsv}
          disabled={filtered.length === 0}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download className="h-3.5 w-3.5" />
          Esporta CSV
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-6 space-y-2">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
            ))
          ) : filtered.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">
              <Receipt className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <div className="text-lg font-medium">
                {payments.length === 0 ? "Nessun pagamento registrato" : "Nessun pagamento nel periodo selezionato"}
              </div>
            </div>
          ) : filtered.map((p) => {
            const order = orderMap.get(p.orderId);
            const Icon = methodIcon[p.method] ?? Wallet;
            return (
              <button
                key={p.id}
                onClick={() => openDetail(p.orderId)}
                className="w-full text-left flex items-center gap-4 p-4 rounded-xl bg-card border border-border hover:border-primary/40 hover:bg-muted/40 transition-colors"
              >
                <div className="p-2.5 rounded-lg bg-primary/10 shrink-0">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-foreground text-sm">
                    {order?.tableName ?? (order ? "Asporto" : `Ordine #${p.orderId}`)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                    <Badge variant="outline" className="text-xs h-4 px-1.5">
                      {methodLabel[p.method] ?? p.method}
                    </Badge>
                    <span>{new Date(p.createdAt).toLocaleString("it-IT")}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-bold text-primary">€ {p.amount}</div>
                  {p.change && parseFloat(p.change) > 0 && (
                    <div className="text-xs text-muted-foreground">Resto: € {p.change}</div>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            );
          })}
        </div>
      </ScrollArea>

      {/* Dialog dettaglio ordine — cosa ha preso il cliente */}
      <Dialog open={detail.open} onOpenChange={o => !o && setDetail({ open: false, loading: false })}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {detail.order
                ? `Dettaglio ordine #${detail.order.id}${detail.order.tableName ? ` — ${detail.order.tableName}` : ""}`
                : "Dettaglio ordine"}
            </DialogTitle>
          </DialogHeader>
          {detail.loading ? (
            <div className="py-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : detail.error ? (
            <div className="py-6 text-sm text-destructive">{detail.error}</div>
          ) : detail.order ? (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground flex items-center gap-3">
                {detail.order.createdAt && <span>{new Date(detail.order.createdAt).toLocaleString("it-IT")}</span>}
                {typeof detail.order.covers === "number" && detail.order.covers > 0 && <span>Coperti: {detail.order.covers}</span>}
              </div>
              {detail.order.items.length === 0 ? (
                <div className="text-sm text-muted-foreground py-4">
                  Nessun articolo presente su questo ordine (possibile conto separato: gli articoli pagati vengono rimossi).
                </div>
              ) : (
                <div className="rounded-lg border border-border divide-y divide-border max-h-80 overflow-y-auto">
                  {detail.order.items.map(it => {
                    let mods: Array<{ label?: string }> = [];
                    try { mods = it.modifiers ? JSON.parse(it.modifiers) : []; } catch { mods = []; }
                    return (
                      <div key={it.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <span className="font-medium">{it.quantity}× {it.productName ?? "Articolo"}</span>
                          {mods.length > 0 && (
                            <div className="text-xs text-muted-foreground truncate">
                              {mods.map(m => m.label).filter(Boolean).join(", ")}
                            </div>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <div>€ {it.subtotal ?? (parseFloat(it.unitPrice) * it.quantity).toFixed(2)}</div>
                          {it.quantity > 1 && <div className="text-xs text-muted-foreground">€ {it.unitPrice} cad.</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {detail.order.total && (
                <div className="flex justify-between text-sm font-bold pt-1">
                  <span>Totale ordine</span>
                  <span className="text-primary">€ {detail.order.total}</span>
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </BackofficeShell>
  );
}
