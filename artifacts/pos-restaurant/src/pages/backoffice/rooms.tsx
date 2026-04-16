import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Layers, GripVertical } from "lucide-react";
import { BackofficeShell } from "@/components/BackofficeShell";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

type Room = { id: number; name: string; description: string | null; sortOrder: number };
type RoomForm = { name: string; description: string; sortOrder: number };
const empty: RoomForm = { name: "", description: "", sortOrder: 0 };

async function fetchRooms(): Promise<Room[]> {
  const res = await fetch(`${API}/rooms`);
  if (!res.ok) throw new Error("Errore caricamento sale");
  return res.json();
}

function SortableRoomRow({ room, onEdit, onDelete }: { room: Room; onEdit: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: room.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}
      className="flex items-center gap-3 p-4 bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md transition-shadow">
      <button {...attributes} {...listeners}
        className="touch-none cursor-grab active:cursor-grabbing p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
        <GripVertical className="h-5 w-5" />
      </button>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-slate-800">{room.name}</div>
        {room.description && <div className="text-xs text-slate-400 mt-0.5">{room.description}</div>}
      </div>
      <div className="flex items-center gap-1.5">
        <button onClick={onEdit}
          className="p-2 rounded-lg text-slate-500 hover:text-primary hover:bg-orange-50 transition-colors">
          <Pencil className="h-4 w-4" />
        </button>
        <button onClick={onDelete}
          className="p-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default function RoomsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: rooms = [], isLoading } = useQuery({ queryKey: ["rooms"], queryFn: fetchRooms });
  const [localRooms, setLocalRooms] = useState<Room[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Room | null>(null);
  const [form, setForm] = useState<RoomForm>(empty);

  // Keep local copy in sync
  const displayRooms = localRooms.length > 0 ? localRooms : rooms;

  const createRoom = useMutation({
    mutationFn: (data: RoomForm) =>
      fetch(`${API}/rooms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rooms"] }); setLocalRooms([]); setOpen(false); toast({ title: "Sala creata" }); },
  });
  const updateRoom = useMutation({
    mutationFn: ({ id, data }: { id: number; data: RoomForm }) =>
      fetch(`${API}/rooms/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rooms"] }); setLocalRooms([]); setOpen(false); toast({ title: "Sala aggiornata" }); },
  });
  const deleteRoom = useMutation({
    mutationFn: (id: number) => fetch(`${API}/rooms/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rooms"] }); setLocalRooms([]); toast({ title: "Sala eliminata" }); },
  });

  const reorderRooms = useCallback(async (newOrder: Room[]) => {
    const items = newOrder.map((r, i) => ({ id: r.id, sortOrder: i + 1 }));
    await fetch(`${API}/rooms/reorder`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(items) });
    qc.invalidateQueries({ queryKey: ["rooms"] });
  }, [qc]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 100, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const current = localRooms.length > 0 ? localRooms : rooms;
    const oldIndex = current.findIndex(r => r.id === active.id);
    const newIndex = current.findIndex(r => r.id === over.id);
    const newOrder = arrayMove(current, oldIndex, newIndex);
    setLocalRooms(newOrder);
    reorderRooms(newOrder);
  }

  function openNew() { setEditing(null); setForm({ ...empty, sortOrder: rooms.length + 1 }); setOpen(true); }
  function openEdit(r: Room) { setEditing(r); setForm({ name: r.name, description: r.description ?? "", sortOrder: r.sortOrder }); setOpen(true); }
  function handleSave() {
    if (editing) updateRoom.mutate({ id: editing.id, data: form });
    else createRoom.mutate(form);
  }

  return (
    <BackofficeShell
      title="Sale"
      subtitle="Trascina per riordinare le sale"
      actions={<Button size="sm" onClick={openNew} className="gap-1.5"><Plus className="h-4 w-4" /> Nuova</Button>}
    >
    <div className="p-4 md:p-6 max-w-2xl">

      {isLoading ? (
        <div className="text-muted-foreground">Caricamento...</div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={displayRooms.map(r => r.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {displayRooms.map(room => (
                <SortableRoomRow key={room.id} room={room}
                  onEdit={() => openEdit(room)}
                  onDelete={() => deleteRoom.mutate(room.id)} />
              ))}
              {displayRooms.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">Nessuna sala configurata</div>
              )}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Modifica Sala" : "Nuova Sala"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Nome *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="es. Sala Principale" />
            </div>
            <div className="space-y-1">
              <Label>Descrizione</Label>
              <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="opzionale" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Annulla</Button>
            <Button onClick={handleSave} disabled={!form.name}>{editing ? "Salva" : "Crea"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </BackofficeShell>
  );
}
