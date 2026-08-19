import React, { useEffect, useState, useMemo } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetKitchenBoard,
  getGetKitchenBoardQueryKey,
  useGetKitchenCategories,
  useUpdateKitchenItemStatus,
  useKitchenBulkStart,
  useKitchenBulkReady,
  KitchenOrderItemStatus
} from "@workspace/api-client-react";
import { CheckCircle2, ChevronRight, Play, AlertCircle, ChefHat, LayoutGrid, RefreshCw, Timer } from "lucide-react";
import { cn } from "@/lib/utils";

// Minimal custom shell for kitchen to maximize screen space
export default function KitchenPage() {
  const queryClient = useQueryClient();
  const [selectedPhase, setSelectedPhase] = useState<number | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [actionError, setActionError] = useState<string | null>(null);

  // Polling every 3 seconds
  const { data: board, isLoading, isError, isFetching, refetch } = useGetKitchenBoard({
    query: {
      refetchInterval: 3000,
      refetchOnWindowFocus: true,
      queryKey: getGetKitchenBoardQueryKey()
    }
  });

  const { data: categories = [] } = useGetKitchenCategories();

  const updateStatus = useUpdateKitchenItemStatus();
  const bulkStart = useKitchenBulkStart();
  const bulkReady = useKitchenBulkReady();

  // Tick every second for live timers
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleStatusChange = async (itemId: number, nextStatus: KitchenOrderItemStatus) => {
    if (updateStatus.isPending) return;
    try {
      setActionError(null);
      await updateStatus.mutateAsync({
        itemId,
        data: { status: nextStatus as any }
      });
      await queryClient.invalidateQueries({ queryKey: getGetKitchenBoardQueryKey() });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Impossibile aggiornare lo stato");
    }
  };

  const handleBulkStart = async (orderId: number) => {
    if (bulkStart.isPending) return;
    try {
      setActionError(null);
      await bulkStart.mutateAsync({
        orderId,
        data: { phase: selectedPhase ?? undefined }
      });
      await queryClient.invalidateQueries({ queryKey: getGetKitchenBoardQueryKey() });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Impossibile avviare la preparazione");
    }
  };

  const handleBulkReady = async (orderId: number) => {
    if (bulkReady.isPending) return;
    try {
      setActionError(null);
      await bulkReady.mutateAsync({
        orderId,
        data: { phase: selectedPhase ?? undefined }
      });
      await queryClient.invalidateQueries({ queryKey: getGetKitchenBoardQueryKey() });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Impossibile completare la preparazione");
    }
  };

  // Derived filtered data
  const filteredOrders = useMemo(() => {
    if (!board) return [];

    return board.map(order => {
      // Filter items in the order
      const items = order.items.filter(item => {
        if (item.status === "draft" || item.status === "delivered") return false;
        if (selectedPhase !== null && item.phase !== selectedPhase) return false;
        if (selectedCategory !== null && item.categoryId !== selectedCategory) return false;
        return true;
      });
      return { ...order, items };
    }).filter(order => order.items.length > 0);
  }, [board, selectedPhase, selectedCategory]);

  const uniquePhases = useMemo(() => {
    const phases = new Set<number>();
    board?.forEach(o => o.items.forEach(i => phases.add(i.phase)));
    return Array.from(phases).sort((a, b) => a - b);
  }, [board]);

  const formatElapsed = (isoString: string | null | undefined) => {
    if (!isoString) return "0:00";
    const elapsedMs = currentTime - new Date(isoString).getTime();
    if (elapsedMs < 0) return "0:00";
    const mins = Math.floor(elapsedMs / 60000);
    const secs = Math.floor((elapsedMs % 60000) / 1000);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const isDelayed = (isoString: string | null | undefined, expectedMins: number | null | undefined) => {
    if (!isoString || !expectedMins) return false;
    const elapsedMins = (currentTime - new Date(isoString).getTime()) / 60000;
    return elapsedMins > expectedMins;
  };

  const timerStart = (item: {
    status: KitchenOrderItemStatus;
    preparingAt?: string | null;
    sentAt?: string | null;
    createdAt: string;
  }) => item.status === "preparing"
    ? item.preparingAt || item.sentAt || item.createdAt
    : item.sentAt || item.createdAt;

  if (isError && !board) {
    return (
      <div className="flex h-[100dvh] w-full items-center justify-center bg-zinc-950 text-red-400">
        <div className="text-center space-y-4">
          <AlertCircle className="w-12 h-12 mx-auto opacity-50" />
          <h2 className="text-xl font-bold">Errore di connessione</h2>
          <p className="opacity-75">Impossibile caricare il monitor cucina</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mx-auto flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 font-bold text-red-200 transition-colors hover:bg-red-500/20"
          >
            <RefreshCw className="h-4 w-4" />
            Riprova
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-[#0d1117] text-slate-200 overflow-hidden font-sans selection:bg-teal-500/30">
      {/* Header */}
      <header className="flex-none flex items-center justify-between px-4 py-3 bg-[#161b22] border-b border-zinc-800 shadow-sm z-10">
        <div className="flex items-center gap-3">
          <Link href="/" className="p-2 -ml-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors block">
            <ChevronRight className="w-6 h-6 rotate-180" />
          </Link>
          <div className="flex items-center gap-2">
            <div className="bg-teal-500/20 p-1.5 rounded-md border border-teal-500/30">
              <ChefHat className="w-5 h-5 text-teal-400" />
            </div>
            <h1 className="text-lg font-bold tracking-tight text-white hidden sm:block">Produzione</h1>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center gap-4 px-4 overflow-hidden">
          {/* Phase Filter */}
          <div className="flex bg-zinc-900 rounded-lg p-1 border border-zinc-800 shrink-0">
            <button
              onClick={() => setSelectedPhase(null)}
              className={cn("px-3 py-1.5 rounded-md text-sm font-bold transition-colors whitespace-nowrap", 
                selectedPhase === null ? "bg-teal-600 text-white shadow" : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              Tutte Uscite
            </button>
            {uniquePhases.map(phase => (
              <button
                key={phase}
                onClick={() => setSelectedPhase(phase)}
                className={cn("px-3 py-1.5 rounded-md text-sm font-bold transition-colors whitespace-nowrap", 
                  selectedPhase === phase ? "bg-teal-600 text-white shadow" : "text-zinc-400 hover:text-zinc-200"
                )}
              >
                F{phase + 1}
              </button>
            ))}
          </div>

          {/* Category Filter */}
          <div className="flex gap-2 overflow-x-auto hide-scrollbar shrink-1">
            <button
              onClick={() => setSelectedCategory(null)}
              className={cn("px-3 py-1.5 rounded-lg text-sm font-bold border transition-colors whitespace-nowrap", 
                selectedCategory === null 
                  ? "bg-indigo-600/20 border-indigo-500/50 text-indigo-300" 
                  : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-800"
              )}
            >
              <LayoutGrid className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
              Tutte
            </button>
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={cn("px-3 py-1.5 rounded-lg text-sm font-bold border transition-colors whitespace-nowrap", 
                  selectedCategory === cat.id 
                    ? "bg-indigo-600/20 border-indigo-500/50 text-indigo-300" 
                    : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-800"
                )}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center text-right border-l border-zinc-800 pl-4 shrink-0">
          <div>
            <div className="flex items-center justify-end gap-1.5 text-[10px] uppercase font-bold tracking-widest text-zinc-500">
              <span className={cn("h-1.5 w-1.5 rounded-full", isError ? "bg-red-400" : isFetching ? "bg-amber-400" : "bg-teal-400")} />
              {isError ? "Offline" : isFetching ? "Sincronizzo" : "Live"}
            </div>
            <div className={cn("font-mono text-sm font-bold tabular-nums", isError ? "text-red-400" : "text-teal-400")}>
              {new Date(currentTime).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
          </div>
        </div>
      </header>

      {(actionError || (isError && board)) && (
        <div className="flex flex-none items-center justify-between gap-3 border-b border-red-900/50 bg-red-950/70 px-4 py-2 text-sm font-semibold text-red-200">
          <span>{actionError || "Connessione interrotta: visualizzi gli ultimi dati disponibili."}</span>
          <button type="button" onClick={() => { setActionError(null); void refetch(); }} className="flex shrink-0 items-center gap-1.5 rounded-md border border-red-500/30 px-2.5 py-1 text-xs font-bold hover:bg-red-500/10">
            <RefreshCw className="h-3.5 w-3.5" />
            Riprova
          </button>
        </div>
      )}

      {/* Main Board */}
      <main className="flex-1 overflow-x-auto overflow-y-hidden p-4 hide-scrollbar">
        {isLoading && !board ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-4 opacity-50">
              <div className="w-8 h-8 border-4 border-teal-500 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-sm font-bold tracking-widest uppercase">Sincronizzazione...</span>
            </div>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center opacity-30">
              <CheckCircle2 className="w-16 h-16 mx-auto mb-4" />
              <h2 className="text-2xl font-bold">{categories.length === 0 ? "Cucina da configurare" : "Tutto pulito"}</h2>
              <p className="mt-2 text-lg">
                {categories.length === 0
                  ? "Assegna una categoria alla stampante di un reparto Cucina nel Backoffice."
                  : "Nessuna comanda in attesa"}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex h-full gap-4">
            {filteredOrders.map((order: any) => {
              const hasSent = order.items.some((i: any) => i.status === "sent");
              const hasPreparing = order.items.some((i: any) => i.status === "preparing");
              const allReady = order.items.every((i: any) => i.status === "ready");

              // Determine longest elapsed time for this order
              const earliestItem = order.items
                .filter((i: any) => i.status !== "ready")
                .sort((a: any, b: any) => new Date(timerStart(a)).getTime() - new Date(timerStart(b)).getTime())[0];
              
              const orderDelayed = earliestItem ? isDelayed(timerStart(earliestItem), earliestItem.expectedPrepMinutes) : false;

              return (
                <div key={order.orderId} className={cn(
                  "flex-none w-[320px] sm:w-[340px] flex flex-col rounded-xl overflow-hidden border-2 bg-[#1c2128]",
                  allReady ? "border-emerald-500/50" : orderDelayed ? "border-red-500/50" : "border-zinc-700/50"
                )}>
                  {/* Order Header */}
                  <div className={cn(
                    "px-4 py-3 border-b flex justify-between items-start",
                    allReady ? "bg-emerald-950/30 border-emerald-900/50" : orderDelayed ? "bg-red-950/30 border-red-900/50" : "bg-[#22272e] border-zinc-700/50"
                  )}>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xl font-black text-white">{order.tableName || "Asporto"}</span>
                        <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">#{order.orderId}</span>
                      </div>
                      <div className="text-xs font-semibold text-zinc-400 mt-1 flex items-center gap-1.5">
                        <span>{order.covers} coperti</span>
                        <span className="w-1 h-1 rounded-full bg-zinc-600" />
                        <span className="uppercase tracking-wider">{order.modalita}</span>
                      </div>
                    </div>
                    {earliestItem && (
                      <div className={cn(
                        "text-right font-mono text-lg font-bold tabular-nums px-2 py-1 rounded-lg border",
                        orderDelayed ? "bg-red-950/50 text-red-400 border-red-900/50 animate-pulse" : "bg-zinc-900/50 text-zinc-300 border-zinc-700/50"
                      )}>
                         {formatElapsed(timerStart(earliestItem))}
                      </div>
                    )}
                  </div>
                  
                  {order.notes && (
                    <div className="px-3 py-2 bg-amber-950/30 border-b border-amber-900/30 text-amber-200/90 text-sm font-semibold flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 opacity-70" />
                      <span>{order.notes}</span>
                    </div>
                  )}

                  {/* Bulk Actions */}
                  <div className="flex p-2 gap-2 bg-[#22272e] border-b border-zinc-700/50">
                    <button 
                      onClick={() => handleBulkStart(order.orderId)}
                      disabled={!hasSent || bulkStart.isPending}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-indigo-600/20 text-indigo-400 font-bold text-xs uppercase tracking-wider hover:bg-indigo-600/30 transition-colors disabled:opacity-30 disabled:pointer-events-none border border-indigo-500/20"
                    >
                      <Play className="w-4 h-4" /> Prepara
                    </button>
                    <button 
                      onClick={() => handleBulkReady(order.orderId)}
                      disabled={!hasPreparing || bulkReady.isPending}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-600/20 text-emerald-400 font-bold text-xs uppercase tracking-wider hover:bg-emerald-600/30 transition-colors disabled:opacity-30 disabled:pointer-events-none border border-emerald-500/20"
                    >
                      <CheckCircle2 className="w-4 h-4" /> Pronti
                    </button>
                  </div>

                  {/* Order Items */}
                  <div className="flex-1 overflow-y-auto p-2 space-y-2 hide-scrollbar">
                    {order.items.map((item: any) => {
                       const delayed = isDelayed(timerStart(item), item.expectedPrepMinutes);
                      
                      let statusColor = "bg-zinc-800/50 text-zinc-300 border-zinc-700";
                      let statusIcon = null;
                      let nextStatus: KitchenOrderItemStatus = "sent";

                      if (item.status === "draft" || item.status === "sent") {
                        nextStatus = "preparing";
                        if (delayed) statusColor = "bg-red-950/40 text-red-200 border-red-900/50";
                      } else if (item.status === "preparing") {
                        statusColor = "bg-indigo-950/40 text-indigo-200 border-indigo-900/50";
                        statusIcon = <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />;
                        nextStatus = "ready";
                        if (delayed) statusColor = "bg-rose-950/40 text-rose-200 border-rose-900/50";
                      } else if (item.status === "ready") {
                        statusColor = "bg-emerald-950/30 text-emerald-200 border-emerald-900/40 opacity-60";
                        statusIcon = <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
                        nextStatus = "delivered";
                      }

                      return (
                        <div 
                          key={item.id} 
                          onClick={() => void handleStatusChange(item.id, nextStatus)}
                          className={cn(
                            "group flex flex-col p-3 rounded-lg border-2 cursor-pointer transition-all active:scale-[0.98] select-none",
                            statusColor,
                            item.status !== "ready" && "hover:border-zinc-500",
                            updateStatus.isPending && "pointer-events-none opacity-60"
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2 flex-1">
                              <div className="font-mono font-bold text-lg leading-none mt-0.5 min-w-[1.5rem]">
                                {item.quantity}×
                              </div>
                              <div className="flex-1">
                                <div className="font-bold text-[15px] leading-tight text-white group-hover:text-teal-300 transition-colors">
                                  {item.productName}
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                   <span className="text-[10px] font-bold uppercase tracking-widest opacity-60">Fase {item.phase + 1}</span>
                                  {item.status !== "ready" && (
                                    <span className="flex items-center gap-1 text-[11px] font-mono opacity-70">
                                      <Timer className="w-3 h-3" />
                                       {formatElapsed(timerStart(item))}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="shrink-0 pt-0.5">
                              {statusIcon}
                            </div>
                          </div>
                          
                          {/* Modifiers & Notes */}
                          {(item.modifiers || item.notes) && (
                            <div className="mt-2.5 pt-2.5 border-t border-white/10 space-y-1.5">
                              {item.modifiers?.map((m: any, i: number) => (
                                <div key={i} className={cn(
                                  "text-sm font-bold flex items-center gap-1.5",
                                  m.type === 'minus' ? "text-rose-400" : "text-emerald-400"
                                )}>
                                  <span className="text-lg leading-none">{m.type === 'minus' ? '−' : '+'}</span>
                                  {m.label}
                                </div>
                              ))}
                              {item.notes && (
                                <div className="text-sm font-semibold text-amber-300 flex items-start gap-1.5">
                                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 opacity-80" />
                                  <span className="leading-snug">{item.notes}</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
      
      {/* Global CSS for hiding scrollbars but keeping functionality */}
      <style>{`
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}
