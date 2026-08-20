import { useMemo, useState } from "react";
import { useListPayments, useListOrders } from "@workspace/api-client-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { CreditCard, Banknote, Wallet, Receipt, Ticket, Download } from "lucide-react";
import { BackofficeShell } from "@/components/BackofficeShell";
import { downloadCsv, itNum } from "@/lib/csv";

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
              <div key={p.id} className="flex items-center gap-4 p-4 rounded-xl bg-card border border-border">
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
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </BackofficeShell>
  );
}
