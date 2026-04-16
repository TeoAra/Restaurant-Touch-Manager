import { useState, useCallback, useRef } from "react";
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
import { Plus, Pencil, Trash2, Users, LayoutGrid, List, Move } from "lucide-react";
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
type ExtTable = Table & { roomId?: number; sortOrder?: number; posX?: number; posY?: number; shape?: string; elementType?: string };

function useRooms() {
  return useQuery<Room[]>({ queryKey: ["rooms"], queryFn: () => fetch(`${API}/rooms`).then(r => r.json()) });
}

const GripVertical = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/>
    <circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/>
    <circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/>
  </svg>
);

// ── Sortable list row ─────────────────────────────────────────────────────────
function SortableRow({ table, rooms, onEdit, onDelete }: {
  table: ExtTable; rooms: Room[];
  onEdit: () => void; onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: table.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const status = (table.status as "free" | "occupied" | "reserved") ?? "free";
  const cfg = {
    free: "bg-emerald-50 text-emerald-700 border-emerald-200",
    occupied: "bg-orange-50 text-orange-700 border-orange-200",
    reserved: "bg-blue-50 text-blue-700 border-blue-200",
  }[status];
  const roomName = rooms.find(r => r.id === table.roomId)?.name;

  return (
    <div ref={setNodeRef} style={style}
      className="bg-white border border-slate-200 rounded-xl shadow-sm flex items-center gap-3 p-4">
      <button {...attributes} {...listeners}
        className="touch-none cursor-grab active:cursor-grabbing p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 shrink-0 transition-colors">
        <GripVertical className="h-5 w-5" />
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-800">{table.name}</span>
          <Badge variant="outline" className={cn("text-xs", cfg)}>
            {status === "free" ? "Libero" : status === "occupied" ? "Occupato" : "Riservato"}
          </Badge>
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
          <span className="flex items-center gap-0.5"><Users className="h-3 w-3" /> {table.seats}</span>
          <span>N°{table.number}</span>
          {roomName && <span className="text-primary/70">· {roomName}</span>}
        </div>
      </div>
      <div className="flex gap-1 shrink-0">
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

// ── Element size & shape helpers ──────────────────────────────────────────────
const CELL = 80;
const COLS = 12;
const ROWS = 8;

function getElementSize(t: { elementType?: string; shape?: string }) {
  const et = t.elementType ?? "table";
  const sh = t.shape ?? "square";
  if (et === "banco") return { w: 3, h: 1 };
  if (et === "muro") return { w: 2, h: 1 };
  if (et === "pianta") return { w: 1, h: 1 };
  if (sh === "rectangle") return { w: 2, h: 1 };
  return { w: 1, h: 1 };
}

function TableShape({ t, status, isSelected, isDragging, onMouseDown, onTouchStart, onEdit, onDelete }: {
  t: ExtTable; status: string; isSelected: boolean; isDragging: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void;
  onEdit: () => void; onDelete: (id: number) => void;
}) {
  const { w, h } = getElementSize(t);
  const et = t.elementType ?? "table";
  const sh = t.shape ?? "square";
  const isDecor = et !== "table";
  const isRound = sh === "round" && !isDecor;

  const statusBg = { free: "bg-emerald-50 border-emerald-300", occupied: "bg-orange-50 border-orange-300", reserved: "bg-blue-50 border-blue-300" }[status as "free" | "occupied" | "reserved"] ?? "bg-slate-50 border-slate-300";
  const statusDot = { free: "bg-emerald-500", occupied: "bg-orange-500", reserved: "bg-blue-500" }[status as "free" | "occupied" | "reserved"] ?? "bg-slate-400";

  const decorStyle = et === "banco" ? "bg-slate-700 border-slate-600 text-white"
    : et === "pianta" ? "bg-emerald-100 border-emerald-400 text-emerald-800"
    : et === "muro" ? "bg-slate-300 border-slate-400 text-slate-600"
    : "";

  const decorLabel = et === "banco" ? "BANCO"
    : et === "pianta" ? "🌿"
    : et === "muro" ? "░░"
    : "";

  return (
    <div
      className={cn(
        "absolute flex items-center justify-center group border-2 select-none transition-shadow",
        isDecor ? decorStyle : cn(statusBg, "bg-white"),
        isRound ? "rounded-full" : "rounded-xl",
        isDragging && "shadow-2xl ring-2 ring-primary opacity-90",
        isSelected && !isDecor && "ring-2 ring-primary",
        !isDecor && "cursor-grab active:cursor-grabbing hover:shadow-lg"
      )}
      style={{
        width: w * CELL - 6,
        height: h * CELL - 6,
      }}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
    >
      {isDecor ? (
        <span className={cn("text-xs font-bold tracking-widest", et === "pianta" ? "text-xl" : "")}>{decorLabel}</span>
      ) : (
        <div className="flex flex-col items-center justify-center w-full h-full p-1">
          <div className={cn("h-2 w-2 rounded-full mb-0.5", statusDot)} />
          <span className="text-[11px] font-bold text-slate-800 text-center leading-tight truncate px-1 w-full text-center">{t.name}</span>
          {!isRound && (
            <span className="text-[9px] text-slate-400 flex items-center gap-0.5 mt-0.5">
              <Users className="h-2 w-2 inline" />{t.seats}
            </span>
          )}
        </div>
      )}

      {/* Hover controls */}
      <div className={cn(
        "absolute -top-2 -right-2 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10",
        isDragging && "opacity-0"
      )}>
        {!isDecor && (
          <button onClick={e => { e.stopPropagation(); onEdit(); }}
            onMouseDown={e => e.stopPropagation()}
            className="h-5 w-5 rounded bg-white shadow border border-slate-200 flex items-center justify-center text-slate-500 hover:text-primary hover:border-primary transition-colors">
            <Pencil className="h-2.5 w-2.5" />
          </button>
        )}
        <button onClick={e => { e.stopPropagation(); onDelete(t.id); }}
          onMouseDown={e => e.stopPropagation()}
          className="h-5 w-5 rounded bg-white shadow border border-slate-200 flex items-center justify-center text-slate-400 hover:text-red-600 hover:border-red-200 transition-colors">
          <Trash2 className="h-2.5 w-2.5" />
        </button>
      </div>
    </div>
  );
}

function PositionEditor({ tables, rooms, onEdit, onDelete, onPositionChange }: {
  tables: ExtTable[];
  rooms: Room[];
  onEdit: (t: ExtTable) => void;
  onDelete: (id: number) => void;
  onPositionChange: (id: number, x: number, y: number) => void;
}) {
  const [roomFilter, setRoomFilter] = useState<number | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<{ id: number; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [localPos, setLocalPos] = useState<Record<number, { x: number; y: number }>>({});

  const filtered = tables.filter(t => roomFilter === null || t.roomId === roomFilter);

  function getPos(t: ExtTable) {
    return localPos[t.id] ?? { x: t.posX ?? 0, y: t.posY ?? 0 };
  }

  function onMouseDown(e: React.MouseEvent, t: ExtTable) {
    e.preventDefault();
    const pos = getPos(t);
    draggingRef.current = { id: t.id, startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    setDraggingId(t.id);
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!draggingRef.current) return;
    const { id, startX, startY, origX, origY } = draggingRef.current;
    const dx = Math.round((e.clientX - startX) / CELL);
    const dy = Math.round((e.clientY - startY) / CELL);
    const newX = Math.max(0, Math.min(COLS - 2, origX + dx));
    const newY = Math.max(0, Math.min(ROWS - 1, origY + dy));
    setLocalPos(p => ({ ...p, [id]: { x: newX, y: newY } }));
  }

  function onMouseUp() {
    if (!draggingRef.current) return;
    const { id } = draggingRef.current;
    const pos = localPos[id];
    if (pos) onPositionChange(id, pos.x, pos.y);
    draggingRef.current = null;
    setDraggingId(null);
  }

  function onTouchStart(e: React.TouchEvent, t: ExtTable) {
    const touch = e.touches[0];
    const pos = getPos(t);
    draggingRef.current = { id: t.id, startX: touch.clientX, startY: touch.clientY, origX: pos.x, origY: pos.y };
    setDraggingId(t.id);
  }

  function onTouchMove(e: React.TouchEvent) {
    if (!draggingRef.current) return;
    const touch = e.touches[0];
    const { id, startX, startY, origX, origY } = draggingRef.current;
    const dx = Math.round((touch.clientX - startX) / CELL);
    const dy = Math.round((touch.clientY - startY) / CELL);
    const newX = Math.max(0, Math.min(COLS - 2, origX + dx));
    const newY = Math.max(0, Math.min(ROWS - 1, origY + dy));
    setLocalPos(p => ({ ...p, [id]: { x: newX, y: newY } }));
  }

  function onTouchEnd() { onMouseUp(); }

  return (
    <div>
      {/* Room filter */}
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {rooms.map(r => (
          <button key={r.id} onClick={() => setRoomFilter(roomFilter === r.id ? null : r.id)}
            className={cn("px-3 py-1.5 rounded-full text-xs font-semibold transition-all",
              roomFilter === r.id ? "bg-primary text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>
            {r.name}
          </button>
        ))}
      </div>

      {/* Canvas */}
      <div className="overflow-auto border border-slate-200 rounded-2xl bg-[#f8fafc]">
        <div
          ref={canvasRef}
          className="relative select-none"
          style={{ width: COLS * CELL, height: ROWS * CELL, minWidth: COLS * CELL }}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {/* Grid lines */}
          {Array.from({ length: ROWS + 1 }).map((_, i) => (
            <div key={`h${i}`} className="absolute left-0 right-0 border-b border-slate-200/60"
              style={{ top: i * CELL }} />
          ))}
          {Array.from({ length: COLS + 1 }).map((_, i) => (
            <div key={`v${i}`} className="absolute top-0 bottom-0 border-r border-slate-200/60"
              style={{ left: i * CELL }} />
          ))}

          {/* Elements */}
          {filtered.map(t => {
            const pos = getPos(t);
            const isDragging = draggingId === t.id;
            const status = (t.status as "free" | "occupied" | "reserved") ?? "free";

            return (
              <div
                key={t.id}
                className={cn("absolute", isDragging ? "z-10" : "z-0")}
                style={{ left: pos.x * CELL + 3, top: pos.y * CELL + 3 }}
              >
                <TableShape
                  t={t}
                  status={status}
                  isSelected={false}
                  isDragging={isDragging}
                  onMouseDown={e => onMouseDown(e, t)}
                  onTouchStart={e => onTouchStart(e, t)}
                  onEdit={() => onEdit(t)}
                  onDelete={onDelete}
                />
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-slate-400 mt-2 flex items-center gap-1">
        <Move className="h-3 w-3" /> Trascina i tavoli per posizionarli nella planimetria
      </p>
    </div>
  );
}

// ── Form ──────────────────────────────────────────────────────────────────────
function TableForm({ initial, rooms, onSave, onClose, isDecorElement }: {
  initial?: ExtTable; rooms: Room[];
  onSave: (data: { number: number; name: string; seats: number; status: string; roomId: number | null; shape: string; elementType: string }) => void;
  onClose: () => void;
  isDecorElement?: boolean;
}) {
  const [number, setNumber] = useState(initial?.number ?? 1);
  const [name, setName] = useState(initial?.name ?? "");
  const [seats, setSeats] = useState(initial?.seats ?? 4);
  const [status, setStatus] = useState<string>(initial?.status ?? "free");
  const [roomId, setRoomId] = useState<number | null>(initial?.roomId ?? null);
  const [shape, setShape] = useState<string>(initial?.shape ?? "square");
  const elementType = initial?.elementType ?? (isDecorElement ? "banco" : "table");

  const isTable = elementType === "table";

  const shapes = [
    { id: "square", label: "Quadrato", icon: "■" },
    { id: "round", label: "Rotondo", icon: "●" },
    { id: "rectangle", label: "Rettangolare", icon: "▬" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Numero</Label>
          <Input type="number" value={number} onChange={e => setNumber(Number(e.target.value))} className="mt-1" />
        </div>
        <div>
          <Label>Posti</Label>
          <Input type="number" min={isTable ? 1 : 0} value={seats} onChange={e => setSeats(Number(e.target.value))} className="mt-1" />
        </div>
      </div>
      <div>
        <Label>Nome *</Label>
        <Input value={name} onChange={e => setName(e.target.value)} placeholder={isTable ? "Es. Tavolo 1" : "Es. Banco principale"} className="mt-1" />
      </div>
      {isTable && (
        <div>
          <Label>Forma</Label>
          <div className="grid grid-cols-3 gap-2 mt-1">
            {shapes.map(s => (
              <button key={s.id} onClick={() => setShape(s.id)}
                className={cn("py-2.5 rounded-lg text-sm font-medium border-2 transition-colors flex flex-col items-center gap-1",
                  shape === s.id ? "border-primary bg-orange-50 text-primary" : "border-border bg-card text-muted-foreground")}>
                <span className="text-lg">{s.icon}</span>
                <span className="text-xs">{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div>
        <Label>Sala</Label>
        <select value={roomId ?? ""} onChange={e => setRoomId(e.target.value ? Number(e.target.value) : null)}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
          <option value="">Nessuna sala</option>
          {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>
      {isTable && (
        <div>
          <Label>Stato</Label>
          <div className="grid grid-cols-3 gap-2 mt-1">
            {["free", "occupied", "reserved"].map(s => (
              <button key={s} onClick={() => setStatus(s)}
                className={cn("py-2 rounded-lg text-sm font-medium border-2 transition-colors",
                  status === s ? "border-primary bg-orange-50 text-primary" : "border-border bg-card text-muted-foreground")}>
                {s === "free" ? "Libero" : s === "occupied" ? "Occupato" : "Riservato"}
              </button>
            ))}
          </div>
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Annulla</Button>
        <Button onClick={() => onSave({ number, name, seats, status, roomId, shape, elementType })} disabled={!name}>Salva</Button>
      </DialogFooter>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TablesPage() {
  const [dialog, setDialog] = useState<{ open: boolean; item?: ExtTable }>({ open: false });
  const [localTables, setLocalTables] = useState<ExtTable[]>([]);
  const [view, setView] = useState<"list" | "map">("map");
  const [roomFilter, setRoomFilter] = useState<number | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: tables = [] } = useListTables();
  const { data: rooms = [] } = useRooms();
  const createTable = useCreateTable();
  const updateTable = useUpdateTable();
  const deleteTable = useDeleteTable();

  const allTables = localTables.length > 0 ? localTables : (tables as ExtTable[]);
  const listFiltered = roomFilter !== null ? allTables.filter(t => t.roomId === roomFilter) : allTables;

  const reorder = useCallback(async (newOrder: ExtTable[]) => {
    const items = newOrder.map((t, i) => ({ id: t.id, sortOrder: i + 1 }));
    await fetch(`${API}/tables/reorder`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(items) });
    qc.invalidateQueries({ queryKey: getListTablesQueryKey() });
  }, [qc]);

  const savePosition = useCallback(async (id: number, x: number, y: number) => {
    await fetch(`${API}/tables/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posX: x, posY: y }),
    });
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
    const current = localTables.length > 0 ? localTables : (tables as ExtTable[]);
    const oldIdx = current.findIndex(t => t.id === active.id);
    const newIdx = current.findIndex(t => t.id === over.id);
    const newOrder = arrayMove(current, oldIdx, newIdx);
    setLocalTables(newOrder);
    reorder(newOrder);
  }

  const handleSave = (data: { number: number; name: string; seats: number; status: string; roomId: number | null; shape: string; elementType: string }) => {
    const opts = {
      onSuccess: () => {
        toast({ title: dialog.item?.elementType !== "table" ? "Elemento salvato" : "Tavolo salvato" });
        qc.invalidateQueries({ queryKey: getListTablesQueryKey() });
        setLocalTables([]);
        setDialog({ open: false });
      },
    };
    if (dialog.item) updateTable.mutate({ id: dialog.item.id, data: data as never }, opts);
    else createTable.mutate({ data: data as never }, opts);
  };

  function handleAddDecor(elementType: "banco" | "pianta" | "muro") {
    const label = { banco: "Banco", pianta: "Pianta", muro: "Muro" }[elementType];
    const shape = elementType === "pianta" ? "round" : "rectangle";
    createTable.mutate({
      data: { number: 0, name: label, seats: 0, status: "free", elementType, shape, posX: 0, posY: 0 } as never
    }, {
      onSuccess: () => {
        toast({ title: `${label} aggiunto alla planimetria` });
        qc.invalidateQueries({ queryKey: getListTablesQueryKey() });
      }
    });
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-6 border-b border-border shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LayoutGrid className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-2xl font-bold text-foreground">Gestione Tavoli</h1>
              <p className="text-sm text-muted-foreground">
                {view === "list" ? "Trascina per riordinare" : "Trascina per posizionare nella planimetria"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex rounded-lg border border-slate-200 overflow-hidden">
              <button onClick={() => setView("map")}
                className={cn("flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors",
                  view === "map" ? "bg-primary text-white" : "bg-white text-slate-600 hover:bg-slate-50")}>
                <LayoutGrid className="h-4 w-4" /> Planimetria
              </button>
              <button onClick={() => setView("list")}
                className={cn("flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors",
                  view === "list" ? "bg-primary text-white" : "bg-white text-slate-600 hover:bg-slate-50")}>
                <List className="h-4 w-4" /> Lista
              </button>
            </div>
            {view === "map" && (
              <div className="flex gap-1">
                <button onClick={() => handleAddDecor("banco")}
                  className="px-3 py-2 rounded-lg text-xs font-semibold bg-slate-700 text-white hover:bg-slate-600 transition-colors">
                  + Banco
                </button>
                <button onClick={() => handleAddDecor("pianta")}
                  className="px-3 py-2 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-500 transition-colors">
                  🌿 Pianta
                </button>
                <button onClick={() => handleAddDecor("muro")}
                  className="px-3 py-2 rounded-lg text-xs font-semibold bg-slate-400 text-white hover:bg-slate-300 transition-colors">
                  ░ Muro
                </button>
              </div>
            )}
            <Button className="gap-1" onClick={() => setDialog({ open: true })}>
              <Plus className="h-4 w-4" /> Nuovo Tavolo
            </Button>
          </div>
        </div>

        {/* Room filter tabs (for list view) */}
        {view === "list" && rooms.length > 0 && (
          <div className="flex gap-1.5 mt-4 overflow-x-auto">
            {rooms.map(r => (
              <button key={r.id} onClick={() => setRoomFilter(roomFilter === r.id ? null : r.id)}
                className={cn("px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all",
                  roomFilter === r.id ? "bg-primary text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>
                {r.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto p-6">
        {view === "map" ? (
          <PositionEditor
            tables={allTables}
            rooms={rooms}
            onEdit={t => setDialog({ open: true, item: t })}
            onDelete={id => deleteTable.mutate({ id }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListTablesQueryKey() }); setLocalTables([]); } })}
            onPositionChange={savePosition}
          />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={listFiltered.map(t => t.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2 max-w-2xl">
                {listFiltered.map(t => (
                  <SortableRow key={t.id} table={t} rooms={rooms}
                    onEdit={() => setDialog({ open: true, item: t })}
                    onDelete={() => deleteTable.mutate({ id: t.id }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListTablesQueryKey() }); setLocalTables([]); } })} />
                ))}
                {listFiltered.length === 0 && <p className="text-center py-12 text-muted-foreground">Nessun tavolo</p>}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <Dialog open={dialog.open} onOpenChange={o => !o && setDialog({ open: false })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog.item
                ? dialog.item.elementType === "table" ? "Modifica Tavolo" : "Modifica Elemento"
                : "Nuovo Tavolo"}
            </DialogTitle>
          </DialogHeader>
          <TableForm initial={dialog.item} rooms={rooms} onSave={handleSave} onClose={() => setDialog({ open: false })} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
