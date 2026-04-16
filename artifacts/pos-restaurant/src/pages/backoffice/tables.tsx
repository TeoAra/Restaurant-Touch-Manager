import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListTables,
  useCreateTable,
  useUpdateTable,
  useDeleteTable,
  getListTablesQueryKey,
} from "@workspace/api-client-react";
import type { Table } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

function TableForm({ initial, onSave, onClose }: {
  initial?: Table;
  onSave: (data: { number: number; name: string; seats: number; status: "free" | "occupied" | "reserved" }) => void;
  onClose: () => void
}) {
  const [number, setNumber] = useState(initial?.number ?? 1);
  const [name, setName] = useState(initial?.name ?? "");
  const [seats, setSeats] = useState(initial?.seats ?? 4);
  const [status, setStatus] = useState<"free" | "occupied" | "reserved">(
    (initial?.status as "free" | "occupied" | "reserved") ?? "free"
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Numero</Label>
          <Input type="number" value={number} onChange={(e) => setNumber(Number(e.target.value))} className="mt-1" />
        </div>
        <div>
          <Label>Posti</Label>
          <Input type="number" min={1} value={seats} onChange={(e) => setSeats(Number(e.target.value))} className="mt-1" />
        </div>
      </div>
      <div>
        <Label>Nome</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Es. Tavolo 1, Bancone A" className="mt-1" />
      </div>
      <div>
        <Label>Stato</Label>
        <div className="grid grid-cols-3 gap-2 mt-1">
          {(["free", "occupied", "reserved"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={cn(
                "py-2 rounded-lg text-sm font-medium border-2 transition-colors",
                status === s ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground"
              )}
            >
              {s === "free" ? "Libero" : s === "occupied" ? "Occupato" : "Riservato"}
            </button>
          ))}
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Annulla</Button>
        <Button onClick={() => onSave({ number, name, seats, status })} disabled={!name}>Salva</Button>
      </DialogFooter>
    </div>
  );
}

export default function TablesPage() {
  const [dialog, setDialog] = useState<{ open: boolean; item?: Table }>({ open: false });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: tables = [] } = useListTables();
  const createTable = useCreateTable();
  const updateTable = useUpdateTable();
  const deleteTable = useDeleteTable();

  const handleSave = (data: { number: number; name: string; seats: number; status: "free" | "occupied" | "reserved" }) => {
    const opts = {
      onSuccess: () => {
        toast({ title: "Tavolo salvato" });
        queryClient.invalidateQueries({ queryKey: getListTablesQueryKey() });
        setDialog({ open: false });
      },
      onError: () => toast({ title: "Errore", variant: "destructive" as const }),
    };
    if (dialog.item) {
      updateTable.mutate({ id: dialog.item.id, data }, opts);
    } else {
      createTable.mutate({ data }, opts);
    }
  };

  const handleDelete = (id: number) => {
    deleteTable.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Tavolo eliminato" });
        queryClient.invalidateQueries({ queryKey: getListTablesQueryKey() });
      },
    });
  };

  const statusConfig = {
    free: { label: "Libero", cls: "bg-green-500/20 text-green-400 border-green-500/30" },
    occupied: { label: "Occupato", cls: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
    reserved: { label: "Riservato", cls: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-6 border-b border-border shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Gestione Tavoli</h1>
          <p className="text-muted-foreground text-sm mt-1">{tables.length} tavoli configurati</p>
        </div>
        <Button className="gap-1" onClick={() => setDialog({ open: true })}>
          <Plus className="h-4 w-4" /> Nuovo Tavolo
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {tables.map((t) => {
            const status = (t.status as "free" | "occupied" | "reserved") ?? "free";
            const cfg = statusConfig[status];
            return (
              <div key={t.id} className="bg-card border border-border rounded-xl p-4 flex items-center gap-4">
                <div className="flex-1">
                  <div className="font-bold text-foreground text-base">{t.name}</div>
                  <div className="flex items-center gap-1 text-muted-foreground text-xs mt-1">
                    <Users className="h-3 w-3" />
                    <span>{t.seats} posti</span>
                    <span className="ml-2 text-foreground/40">·</span>
                    <span>N°{t.number}</span>
                  </div>
                </div>
                <Badge variant="outline" className={cfg.cls}>{cfg.label}</Badge>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDialog({ open: true, item: t })}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDelete(t.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      <Dialog open={dialog.open} onOpenChange={(o) => !o && setDialog({ open: false })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog.item ? "Modifica Tavolo" : "Nuovo Tavolo"}</DialogTitle>
          </DialogHeader>
          <TableForm
            initial={dialog.item}
            onSave={handleSave}
            onClose={() => setDialog({ open: false })}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
