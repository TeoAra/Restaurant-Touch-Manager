import { useListPayments, useListOrders } from "@workspace/api-client-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { CreditCard, Banknote, Wallet, Receipt } from "lucide-react";
import { BackofficeShell } from "@/components/BackofficeShell";

export default function PaymentsPage() {
  const { data: payments = [], isLoading } = useListPayments();
  const { data: orders = [] } = useListOrders({});

  const orderMap = new Map(orders.map((o) => [o.id, o]));

  const methodIcon = {
    cash: Banknote,
    card: CreditCard,
    other: Wallet,
  };

  const methodLabel = {
    cash: "Contanti",
    card: "Carta",
    other: "Altro",
  };

  const total = payments.reduce((sum, p) => sum + parseFloat(p.amount), 0);

  return (
    <BackofficeShell
      title="Storico Pagamenti"
      subtitle={`${payments.length} transazioni — Totale: € ${total.toFixed(2)}`}
      fixedHeight
    >
      <ScrollArea className="flex-1">
        <div className="p-6 space-y-2">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
            ))
          ) : payments.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">
              <Receipt className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <div className="text-lg font-medium">Nessun pagamento registrato</div>
            </div>
          ) : payments.map((p) => {
            const order = orderMap.get(p.orderId);
            const method = p.method as "cash" | "card" | "other";
            const Icon = methodIcon[method] ?? Wallet;
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
                      {methodLabel[method]}
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
