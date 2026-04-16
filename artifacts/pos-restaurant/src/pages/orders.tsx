import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListOrders,
  getListOrdersQueryKey,
  useGetOrder,
  getGetOrderQueryKey,
  useUpdateOrder,
  getGetTablesStatusQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Clock, MapPin, Receipt, X, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

function timeSince(date: string) {
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (diff < 60) return `${diff}s fa`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m fa`;
  return `${Math.floor(diff / 3600)}h fa`;
}

function OrderDetailDialog({ orderId, open, onClose }: { orderId: number; open: boolean; onClose: () => void }) {
  const { data: order } = useGetOrder(orderId, {
    query: { enabled: open && !!orderId, queryKey: getGetOrderQueryKey(orderId) },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Dettaglio Comanda #{orderId}</DialogTitle>
        </DialogHeader>
        {order && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              {order.tableName && (
                <div className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  <span>{order.tableName}</span>
                </div>
              )}
              <div className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                <span>{new Date(order.createdAt).toLocaleString("it-IT")}</span>
              </div>
            </div>
            <Separator />
            <div className="space-y-2">
              {order.items?.map((item) => (
                <div key={item.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-md bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">
                      {item.quantity}
                    </span>
                    <span className="font-medium">{item.productName}</span>
                    {item.notes && <span className="text-muted-foreground text-xs">({item.notes})</span>}
                  </div>
                  <span className="font-medium text-primary">€ {item.subtotal}</span>
                </div>
              ))}
            </div>
            <Separator />
            <div className="flex justify-between font-bold text-lg">
              <span>Totale</span>
              <span className="text-primary">€ {order.total}</span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function OrdersPage() {
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: openOrders = [], isLoading } = useListOrders({ status: "open" }, {
    query: { queryKey: getListOrdersQueryKey({ status: "open" }) },
  });

  const updateOrder = useUpdateOrder();

  const handleCancel = (orderId: number) => {
    updateOrder.mutate(
      { id: orderId, data: { status: "cancelled" } },
      {
        onSuccess: () => {
          toast({ title: "Ordine annullato" });
          queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetTablesStatusQueryKey() });
        },
      }
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-6 border-b border-border shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Ordini Attivi</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {openOrders.length} {openOrders.length === 1 ? "comanda aperta" : "comande aperte"}
            </p>
          </div>
          <Badge variant="secondary" className="text-base px-4 py-2">
            {openOrders.length} attivi
          </Badge>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-36 rounded-xl bg-muted animate-pulse" />
            ))
          ) : openOrders.length === 0 ? (
            <div className="col-span-full text-center py-20 text-muted-foreground">
              <Receipt className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <div className="text-lg font-medium">Nessun ordine aperto</div>
              <div className="text-sm mt-1">Gli ordini attivi appariranno qui</div>
            </div>
          ) : (
            openOrders.map((order) => (
              <div
                key={order.id}
                className="rounded-xl border-2 border-border bg-card p-4 hover:border-primary/30 transition-colors"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="font-bold text-foreground text-base">
                      {order.tableName ?? "Asporto"}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {timeSince(order.createdAt)}
                    </div>
                  </div>
                  <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">Aperto</Badge>
                </div>
                <div className="text-2xl font-bold text-primary mb-3">€ {order.total}</div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1"
                    onClick={() => setSelectedOrderId(order.id)}
                  >
                    <Receipt className="h-4 w-4" />
                    Dettaglio
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30"
                    onClick={() => handleCancel(order.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {selectedOrderId && (
        <OrderDetailDialog
          orderId={selectedOrderId}
          open={!!selectedOrderId}
          onClose={() => setSelectedOrderId(null)}
        />
      )}
    </div>
  );
}
