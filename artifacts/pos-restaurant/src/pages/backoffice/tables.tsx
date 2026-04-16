import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Plus, Pencil, Trash2, Users, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

type Room = { id: number; name: string };

function useRooms() {
  return useQuery<Room[]>({ queryKey: ["rooms"], queryFn: () => fetch(`${API}/rooms`).then(r => r.json()) });
}

function TableForm({ initial, rooms, onSave, onClose }: {
  initial?: Table;
  rooms: Room[];
  onSave: (data: { number: number; name: string; seats: number; status: "free" | "occupied" | "reserved"; roomId: number | null }) => void;
  onClose: () => void
}) {
  const [number, setNumber] = useState(initial?.number ?? 1);
  const [name, setName] = useState(initial?.name ?? "");
  const [seats, setSeats] = useState(initial?.seats ?? 4);
  const [status, setStatus] = useState<"free" | "occupied" | "reserved">(
    (initial?.status as "free" | "occupied" | "reserved") ?? "free"
  );
  const [roomId, setRoomId] = useState<number | null>((initial as Table & { roomId?: number })?.roomId ?? null);

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
        <Label>Nome *</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Es. Tavolo 1, Bancone A" className="mt-1" />
      </div>
      <div>
        <Label>Sala</Label>
        <select value={roomId ?? ""} onChange={e => setRoomId(e.target.value ? Number(e.target.value) : null)}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
          <option value="">Nessuna sala</option>
          {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>
      <div>
        <Label>Stato</Label>
        <div className="grid grid-cols-3 gap-2 mt-1">
          {(["free", "occupied", "reserved"] as const).map((s) => (
            <button key={s} onClick={() => setStatus(s)}
              className={cn("py-2 rounded-lg text-sm font-medium border-2 transition-colors",
                status === s ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground")}>
              {s === "free" ? "Libero" : s === "occupied" ? "Occupato" : "Riservato"}
            </button>
          ))}
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Annulla</Button>
        <Button onClick={() => onSave({ number, name, seats, status, roomId })} disabled={!name}>Salva</Button>
      </DialogFooter>
    </div>
  );
}

export default function TablesPage() {
  const [dialog, setDialog] = useState<{ open: boolean; item?: Table }>({ open: false });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: tables = [] } = useListTables();
  const { data: rooms = [] } = useRooms();
  const createTable = useCreateTable();
  const updateTable = useUpdateTable();
  const deleteTable = useDeleteTable();

  const handleSave = (data: { number: number; name: string; seats: number; status: "free" | "occupied" | "reserved"; roomId: number | null }) => {
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
    free: { label: "Libero", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    occupied: { label: "Occupato", cls: "bg-orange-50 text-orange-700 border-orange-200" },
    reserved: { label: "Riservato", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  };

  // Group by room
  const roomMap = new Map(rooms.map(r => [r.id, r.name]));

  return (
    <div className="flex flex-col h-full">
      <div className="p-6 border-b border-border shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LayoutGrid className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Gestione Tavoli</h1>
            <p className="text-muted-foreground text-sm">{tables.length} tavoli configurati</p>
          </div>
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
            const roomId = (t as Table & { roomId?: number }).roomId;
            return (
              <div key={t.id} className="bg-card border border-border rounded-xl p-4 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-bold text-foreground text-base">{t.name}</div>
                    <div className="flex items-center gap-1 text-muted-foreground text-xs mt-0.5">
                      <Users className="h-3 w-3" />
                      <span>{t.seats} posti · N°{t.number}</span>
                    </div>
                    {roomId && <div className="text-xs text-primary/70 mt-1">{roomMap.get(roomId) ?? ""}</div>}
                  </div>
                  <Badge variant="outline" className={cfg.cls}>{cfg.label}</Badge>
                </div>
                <div className="flex gap-1 mt-3 justify-end">
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
            rooms={rooms}
            onSave={handleSave}
            onClose={() => setDialog({ open: false })}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
