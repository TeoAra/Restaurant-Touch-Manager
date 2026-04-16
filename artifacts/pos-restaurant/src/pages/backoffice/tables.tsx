import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useListTables, useCreateTable, useUpdateTable, useDeleteTable, getListTablesQueryKey,
} from "@workspace/api-client-react";
import type { Table } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Users, LayoutGrid, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, TouchSensor,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;
type Room = { id: number; name: string };

function useRooms() {
  return useQuery<Room[]>({ queryKey: ["rooms"], queryFn: () => fetch(`${API}/rooms`).then(r => r.json()) });
}

const statusConfig = {
  free: { label: "Libero", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  occupied: { label: "Occupato", cls: "bg-orange-50 text-orange-700 border-orange-200" },
  reserved: { label: "Riservato", cls: "bg-blue-50 text-blue-700 border-blue-200" },
};

function SortableTableCard({ table, rooms, onEdit, onDelete }: {
  table: Table & { sortOrder?: number; roomId?: number };
  rooms: Room[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: table.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1, zIndex: isDragging ? 10 : undefined };
  const status = (table.status as "free" | "occupied" | "reserved") ?? "free";
  const cfg = statusConfig[status];
  const roomName = rooms.find(r => r.id === table.roomId)?.name;

  return (
    <div ref={setNodeRef} style={style}
      className="bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md transition-shadow flex items-center gap-3 p-4">
      <button {...attributes} {...listeners}
        className="touch-none cursor-grab active:cursor-grabbing p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 shrink-0 transition-colors">
        <GripVertical className="h-5 w-5" />
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-800">{table.name}</span>
          <Badge variant="outline" className={cn("text-xs", cfg.cls)}>{cfg.label}</Badge>
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
          <span className="flex items-center gap-0.5"><Users className="h-3 w-3" /> {table.seats} posti</span>
          <span>N°{table.number}</span>
          {roomName && <span className="text-primary/70">· {roomName}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button onClick={onEdit} className="p-2 rounded-lg text-slate-500 hover:text-primary hover:bg-orange-50 transition-colors">
          <Pencil className="h-4 w-4" />
        </button>
        <button onClick={onDelete} className="p-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function TableForm({ initial, rooms, onSave, onClose }: {
  initial?: Table & { roomId?: number };
  rooms: Room[];
  onSave: (data: { number: number; name: string; seats: number; status: "free" | "occupied" | "reserved"; roomId: number | null }) => void;
  onClose: () => void;
}) {
  const [number, setNumber] = useState(initial?.number ?? 1);
  const [name, setName] = useState(initial?.name ?? "");
  const [seats, setSeats] = useState(initial?.seats ?? 4);
  const [status, setStatus] = useState<"free" | "occupied" | "reserved">((initial?.status as never) ?? "free");
  const [roomId, setRoomId] = useState<number | null>(initial?.roomId ?? null);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Numero</Label>
          <Input type="number" value={number} onChange={e => setNumber(Number(e.target.value))} className="mt-1" />
        </div>
        <div>
          <Label>Posti</Label>
          <Input type="number" min={1} value={seats} onChange={e => setSeats(Number(e.target.value))} className="mt-1" />
        </div>
      </div>
      <div>
        <Label>Nome *</Label>
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="Es. Tavolo 1, Bancone A" className="mt-1" />
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
        <Label>Stato iniziale</Label>
        <div className="grid grid-cols-3 gap-2 mt-1">
          {(["free", "occupied", "reserved"] as const).map(s => (
            <button key={s} onClick={() => setStatus(s)}
              className={cn("py-2 rounded-lg text-sm font-medium border-2 transition-colors",
                status === s ? "border-primary bg-orange-50 text-primary" : "border-border bg-card text-muted-foreground")}>
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
  const [dialog, setDialog] = useState<{ open: boolean; item?: Table & { roomId?: number } }>({ open: false });
  const [localTables, setLocalTables] = useState<Array<Table & { roomId?: number; sortOrder?: number }>>([]);
  const [roomFilter, setRoomFilter] = useState<number | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: tables = [] } = useListTables();
  const { data: rooms = [] } = useRooms();
  const createTable = useCreateTable();
  const updateTable = useUpdateTable();
  const deleteTable = useDeleteTable();

  const displayTables = localTables.length > 0 ? localTables : (tables as Array<Table & { roomId?: number; sortOrder?: number }>);
  const filteredTables = roomFilter !== null
    ? displayTables.filter(t => t.roomId === roomFilter)
    : displayTables;

  const reorder = useCallback(async (newOrder: Array<Table & { sortOrder?: number }>) => {
    const items = newOrder.map((t, i) => ({ id: t.id, sortOrder: i + 1 }));
    await fetch(`${API}/tables/reorder`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(items) });
    qc.invalidateQueries({ queryKey: getListTablesQueryKey() });
  }, [qc]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 100, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const current = localTables.length > 0 ? localTables : (tables as Array<Table & { sortOrder?: number; roomId?: number }>);
    const oldIndex = current.findIndex(t => t.id === active.id);
    const newIndex = current.findIndex(t => t.id === over.id);
    const newOrder = arrayMove(current, oldIndex, newIndex);
    setLocalTables(newOrder);
    reorder(newOrder);
  }

  const handleSave = (data: { number: number; name: string; seats: number; status: "free" | "occupied" | "reserved"; roomId: number | null }) => {
    const opts = {
      onSuccess: () => {
        toast({ title: "Tavolo salvato" });
        qc.invalidateQueries({ queryKey: getListTablesQueryKey() });
        setLocalTables([]);
        setDialog({ open: false });
      },
      onError: () => toast({ title: "Errore", variant: "destructive" as const }),
    };
    if (dialog.item) updateTable.mutate({ id: dialog.item.id, data }, opts);
    else createTable.mutate({ data }, opts);
  };

  const handleDelete = (id: number) => {
    deleteTable.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Tavolo eliminato" });
        qc.invalidateQueries({ queryKey: getListTablesQueryKey() });
        setLocalTables([]);
      },
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-6 border-b border-border shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LayoutGrid className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-2xl font-bold text-foreground">Gestione Tavoli</h1>
              <p className="text-sm text-muted-foreground">Trascina per riordinare la disposizione</p>
            </div>
          </div>
          <Button className="gap-1" onClick={() => setDialog({ open: true })}>
            <Plus className="h-4 w-4" /> Nuovo Tavolo
          </Button>
        </div>
        {/* Room filter tabs */}
        <div className="flex gap-1.5 mt-4 overflow-x-auto">
          <button onClick={() => setRoomFilter(null)}
            className={cn("px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all",
              roomFilter === null ? "bg-primary text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>
            Tutte le sale
          </button>
          {rooms.map(r => (
            <button key={r.id} onClick={() => setRoomFilter(r.id)}
              className={cn("px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all",
                roomFilter === r.id ? "bg-primary text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>
              {r.name}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={filteredTables.map(t => t.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2 max-w-2xl">
              {filteredTables.map(table => (
                <SortableTableCard key={table.id} table={table} rooms={rooms}
                  onEdit={() => setDialog({ open: true, item: table })}
                  onDelete={() => handleDelete(table.id)} />
              ))}
              {filteredTables.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  Nessun tavolo in questa sala. Creane uno!
                </div>
              )}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <Dialog open={dialog.open} onOpenChange={o => !o && setDialog({ open: false })}>
        <DialogContent>
          <DialogHeader><DialogTitle>{dialog.item ? "Modifica Tavolo" : "Nuovo Tavolo"}</DialogTitle></DialogHeader>
          <TableForm initial={dialog.item} rooms={rooms} onSave={handleSave} onClose={() => setDialog({ open: false })} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
