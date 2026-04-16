import { useState } from "react";
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
import { Users, Plus, Minus, Trash2, CreditCard, Banknote, Wallet, ShoppingBag, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

function TableCard({ table, isSelected, onClick }: { table: TableStatus; isSelected: boolean; onClick: () => void }) {
  const statusColors = {
    free: "border-green-500/40 bg-green-500/5 hover:bg-green-500/10",
    occupied: "border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10",
    reserved: "border-blue-500/40 bg-blue-500/5 hover:bg-blue-500/10",
  };
  const statusDot = {
    free: "bg-green-500",
    occupied: "bg-amber-500",
    reserved: "bg-blue-500",
  };
  const statusLabel = { free: "Libero", occupied: "Occupato", reserved: "Riservato" };
  const status = table.status as "free" | "occupied" | "reserved";

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full p-4 rounded-xl border-2 text-left transition-all active:scale-95",
        statusColors[status],
        isSelected && "ring-2 ring-primary ring-offset-2 ring-offset-background border-primary"
      )}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="font-bold text-base text-foreground">{table.name}</div>
          <div className="flex items-center gap-1 text-muted-foreground text-xs mt-0.5">
            <Users className="h-3 w-3" />
            <span>{table.seats} posti</span>
          </div>
        </div>
        <div className={cn("w-2.5 h-2.5 rounded-full mt-1", statusDot[status])} />
      </div>
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-muted-foreground">{statusLabel[status]}</span>
        {table.activeOrderTotal && (
          <span className="text-sm font-bold text-primary">€ {table.activeOrderTotal}</span>
        )}
      </div>
      {table.activeOrderCreatedAt && (
        <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>{new Date(table.activeOrderCreatedAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      )}
    </button>
  );
}

function PaymentDialog({
  open,
  onClose,
  orderId,
  total,
}: {
  open: boolean;
  onClose: () => void;
  orderId: number;
  total: string;
}) {
  const [method, setMethod] = useState<"cash" | "card" | "other">("cash");
  const [cashAmount, setCashAmount] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createPayment = useCreatePayment();

  const totalNum = parseFloat(total);
  const cashNum = parseFloat(cashAmount) || 0;
  const change = method === "cash" ? Math.max(0, cashNum - totalNum).toFixed(2) : null;

  const handlePay = () => {
    if (method === "cash" && cashNum < totalNum) {
      toast({ title: "Importo insufficiente", variant: "destructive" });
      return;
    }
    createPayment.mutate(
      {
        data: {
          orderId,
          method,
          amount: method === "cash" ? cashAmount : total,
          change: change && parseFloat(change) > 0 ? change : null,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Pagamento registrato" });
          queryClient.invalidateQueries({ queryKey: getGetTablesStatusQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
          onClose();
        },
        onError: () => toast({ title: "Errore nel pagamento", variant: "destructive" }),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pagamento Conto</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-center">
            <div className="text-3xl font-bold text-primary">€ {total}</div>
            <div className="text-sm text-muted-foreground mt-1">Totale da pagare</div>
          </div>
          <div>
            <Label className="mb-2 block">Metodo di pagamento</Label>
            <div className="grid grid-cols-3 gap-2">
              {(["cash", "card", "other"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMethod(m)}
                  className={cn(
                    "flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all",
                    method === m ? "border-primary bg-primary/10" : "border-border bg-card"
                  )}
                >
                  {m === "cash" ? <Banknote className="h-6 w-6" /> : m === "card" ? <CreditCard className="h-6 w-6" /> : <Wallet className="h-6 w-6" />}
                  <span className="text-xs font-medium">{m === "cash" ? "Contanti" : m === "card" ? "Carta" : "Altro"}</span>
                </button>
              ))}
            </div>
          </div>
          {method === "cash" && (
            <div>
              <Label htmlFor="cash">Contanti ricevuti</Label>
              <Input
                id="cash"
                type="number"
                step="0.01"
                min={total}
                placeholder={`Min. € ${total}`}
                value={cashAmount}
                onChange={(e) => setCashAmount(e.target.value)}
                className="mt-1 text-lg"
              />
              {cashNum >= totalNum && cashNum > 0 && (
                <div className="mt-2 p-2 bg-green-500/10 border border-green-500/30 rounded-md text-center">
                  <span className="text-green-400 font-bold">Resto: € {change}</span>
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annulla</Button>
          <Button onClick={handlePay} disabled={createPayment.isPending} className="flex-1">
            {createPayment.isPending ? "Registrazione..." : "Conferma Pagamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function FrontOffice() {
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: tablesStatus = [], isLoading: loadingTables } = useGetTablesStatus();
  const { data: categories = [] } = useListCategories();
  const { data: products = [] } = useListProducts(
    selectedCategoryId != null ? { categoryId: selectedCategoryId } : undefined
  );

  const selectedTable = tablesStatus.find((t) => t.id === selectedTableId);
  const activeOrderId = selectedTable?.activeOrderId ?? null;

  const { data: activeOrder } = useGetOrder(activeOrderId ?? 0, {
    query: { enabled: !!activeOrderId, queryKey: getGetOrderQueryKey(activeOrderId ?? 0) },
  });

  const createOrder = useCreateOrder();
  const addItem = useAddOrderItem();
  const updateItem = useUpdateOrderItem();
  const deleteItem = useDeleteOrderItem();

  const handleSelectTable = (table: TableStatus) => {
    setSelectedTableId(table.id);
  };

  const handleNewOrder = () => {
    if (!selectedTableId) return;
    createOrder.mutate(
      { data: { tableId: selectedTableId, notes: null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetTablesStatusQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
        },
        onError: () => toast({ title: "Errore nella creazione dell'ordine", variant: "destructive" }),
      }
    );
  };

  const handleTakeaway = () => {
    createOrder.mutate(
      { data: { tableId: null, notes: "Asporto" } },
      {
        onSuccess: (newOrder) => {
          toast({ title: "Ordine asporto creato" });
          queryClient.invalidateQueries({ queryKey: getGetTablesStatusQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
        },
        onError: () => toast({ title: "Errore", variant: "destructive" }),
      }
    );
  };

  const handleAddProduct = (productId: number) => {
    if (!activeOrderId) return;
    const existingItem = activeOrder?.items?.find((i) => i.productId === productId);
    if (existingItem) {
      updateItem.mutate(
        { orderId: activeOrderId, itemId: existingItem.id, data: { quantity: existingItem.quantity + 1 } },
        { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(activeOrderId) }) }
      );
    } else {
      addItem.mutate(
        { orderId: activeOrderId, data: { productId, quantity: 1 } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(activeOrderId) });
            queryClient.invalidateQueries({ queryKey: getGetTablesStatusQueryKey() });
          },
        }
      );
    }
  };

  const handleUpdateQty = (itemId: number, qty: number) => {
    if (!activeOrderId) return;
    if (qty <= 0) {
      deleteItem.mutate(
        { orderId: activeOrderId, itemId },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(activeOrderId) });
            queryClient.invalidateQueries({ queryKey: getGetTablesStatusQueryKey() });
          },
        }
      );
    } else {
      updateItem.mutate(
        { orderId: activeOrderId, itemId, data: { quantity: qty } },
        { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(activeOrderId) }) }
      );
    }
  };

  const filteredProducts = selectedCategoryId != null
    ? products.filter((p) => p.categoryId === selectedCategoryId)
    : products;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: Tables grid */}
      <div className="w-72 shrink-0 border-r border-border flex flex-col bg-card/30">
        <div className="p-4 border-b border-border shrink-0 flex items-center justify-between">
          <h2 className="font-bold text-foreground">Sala</h2>
          <Button variant="outline" size="sm" onClick={handleTakeaway} className="text-xs gap-1">
            <ShoppingBag className="h-3.5 w-3.5" />
            Asporto
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-3 grid grid-cols-2 gap-2">
            {loadingTables ? (
              Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
              ))
            ) : (
              tablesStatus.map((table) => (
                <TableCard
                  key={table.id}
                  table={table}
                  isSelected={selectedTableId === table.id}
                  onClick={() => handleSelectTable(table)}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Center: Menu / products */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Category tabs */}
        <div className="border-b border-border shrink-0">
          <ScrollArea orientation="horizontal">
            <div className="flex gap-2 p-3">
              <button
                onClick={() => setSelectedCategoryId(null)}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors",
                  selectedCategoryId === null
                    ? "bg-primary text-primary-foreground"
                    : "bg-card hover:bg-accent text-muted-foreground"
                )}
              >
                Tutti
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategoryId(cat.id)}
                  className={cn(
                    "px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors",
                    selectedCategoryId === cat.id
                      ? "bg-primary text-primary-foreground"
                      : "bg-card hover:bg-accent text-muted-foreground"
                  )}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Products grid */}
        <ScrollArea className="flex-1">
          <div className="p-4 grid grid-cols-3 xl:grid-cols-4 gap-3">
            {filteredProducts.map((product) => {
              const qty = activeOrder?.items?.find((i) => i.productId === product.id)?.quantity ?? 0;
              return (
                <button
                  key={product.id}
                  onClick={() => activeOrderId ? handleAddProduct(product.id) : toast({ title: "Seleziona un tavolo e avvia la comanda" })}
                  disabled={!product.available}
                  className={cn(
                    "relative p-3 rounded-xl border-2 text-left transition-all active:scale-95",
                    product.available
                      ? "border-border bg-card hover:border-primary/50 hover:bg-accent"
                      : "border-border/30 bg-card/30 opacity-50 cursor-not-allowed"
                  )}
                >
                  {qty > 0 && (
                    <div className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                      {qty}
                    </div>
                  )}
                  <div className="font-semibold text-foreground text-sm leading-tight mb-1">{product.name}</div>
                  {product.description && (
                    <div className="text-xs text-muted-foreground mb-2 line-clamp-1">{product.description}</div>
                  )}
                  <div className="text-primary font-bold text-base">€ {product.price}</div>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* Right: Order panel */}
      <div className="w-80 shrink-0 border-l border-border flex flex-col bg-card/20">
        <div className="p-4 border-b border-border shrink-0">
          <h2 className="font-bold text-foreground">
            {selectedTable ? selectedTable.name : "Comanda"}
          </h2>
          {selectedTable && (
            <div className="text-xs text-muted-foreground mt-0.5">
              {selectedTable.seats} posti • {selectedTable.status === "free" ? "Libero" : selectedTable.status === "occupied" ? "Occupato" : "Riservato"}
            </div>
          )}
        </div>

        {!selectedTableId ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm px-4 text-center">
            Seleziona un tavolo per iniziare la comanda
          </div>
        ) : !activeOrderId ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 p-4">
            <div className="text-muted-foreground text-sm text-center">Nessuna comanda aperta per questo tavolo</div>
            <Button onClick={handleNewOrder} disabled={createOrder.isPending} className="w-full gap-2">
              <Plus className="h-4 w-4" />
              Nuova Comanda
            </Button>
          </div>
        ) : (
          <>
            <ScrollArea className="flex-1">
              <div className="p-3 space-y-2">
                {!activeOrder?.items?.length ? (
                  <div className="text-center text-muted-foreground text-sm py-8">
                    Aggiungi prodotti dalla lista
                  </div>
                ) : (
                  activeOrder.items.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 p-2 rounded-lg bg-card border border-border">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">{item.productName}</div>
                        <div className="text-xs text-muted-foreground">€ {item.unitPrice} x {item.quantity}</div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleUpdateQty(item.id, item.quantity - 1)}
                          className="w-7 h-7 rounded-md bg-muted flex items-center justify-center hover:bg-destructive/20 transition-colors"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="w-6 text-center text-sm font-bold">{item.quantity}</span>
                        <button
                          onClick={() => handleUpdateQty(item.id, item.quantity + 1)}
                          className="w-7 h-7 rounded-md bg-muted flex items-center justify-center hover:bg-primary/20 transition-colors"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => handleUpdateQty(item.id, 0)}
                          className="w-7 h-7 rounded-md bg-muted flex items-center justify-center hover:bg-destructive/20 transition-colors ml-1"
                        >
                          <Trash2 className="h-3 w-3 text-muted-foreground" />
                        </button>
                      </div>
                      <div className="text-sm font-bold text-primary w-14 text-right shrink-0">
                        € {item.subtotal}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>

            <div className="border-t border-border p-4 space-y-3 shrink-0">
              <Separator />
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground text-sm">Totale</span>
                <span className="text-2xl font-bold text-primary">€ {activeOrder?.total ?? "0.00"}</span>
              </div>
              <Button
                onClick={() => setPaymentOpen(true)}
                className="w-full h-12 text-base font-bold gap-2"
                disabled={!activeOrder?.items?.length}
              >
                <CreditCard className="h-5 w-5" />
                Paga
              </Button>
            </div>
          </>
        )}
      </div>

      {activeOrderId && activeOrder && (
        <PaymentDialog
          open={paymentOpen}
          onClose={() => {
            setPaymentOpen(false);
            setSelectedTableId(null);
          }}
          orderId={activeOrderId}
          total={activeOrder.total}
        />
      )}
    </div>
  );
}
