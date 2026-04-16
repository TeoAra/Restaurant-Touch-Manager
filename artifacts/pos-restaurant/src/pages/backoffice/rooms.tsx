import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Layers } from "lucide-react";

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

export default function RoomsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: rooms = [], isLoading } = useQuery({ queryKey: ["rooms"], queryFn: fetchRooms });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Room | null>(null);
  const [form, setForm] = useState<RoomForm>(empty);

  const createRoom = useMutation({
    mutationFn: (data: RoomForm) =>
      fetch(`${API}/rooms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rooms"] }); setOpen(false); toast({ title: "Sala creata" }); },
  });
  const updateRoom = useMutation({
    mutationFn: ({ id, data }: { id: number; data: RoomForm }) =>
      fetch(`${API}/rooms/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rooms"] }); setOpen(false); toast({ title: "Sala aggiornata" }); },
  });
  const deleteRoom = useMutation({
    mutationFn: (id: number) => fetch(`${API}/rooms/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rooms"] }); toast({ title: "Sala eliminata" }); },
  });

  function openNew() { setEditing(null); setForm(empty); setOpen(true); }
  function openEdit(r: Room) { setEditing(r); setForm({ name: r.name, description: r.description ?? "", sortOrder: r.sortOrder }); setOpen(true); }
  function handleSave() {
    if (editing) updateRoom.mutate({ id: editing.id, data: form });
    else createRoom.mutate(form);
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Layers className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Sale</h1>
        </div>
        <Button onClick={openNew} className="gap-2"><Plus className="h-4 w-4" /> Nuova Sala</Button>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">Caricamento...</div>
      ) : (
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Nome</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Descrizione</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Ordine</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rooms.map((room, i) => (
                <tr key={room.id} className={i % 2 === 0 ? "bg-card" : "bg-muted/20"}>
                  <td className="px-4 py-3 font-medium text-foreground">{room.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{room.description || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{room.sortOrder}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(room)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => deleteRoom.mutate(room.id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
              {rooms.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">Nessuna sala configurata</td></tr>
              )}
            </tbody>
          </table>
        </div>
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
            <div className="space-y-1">
              <Label>Ordine visualizzazione</Label>
              <Input type="number" value={form.sortOrder} onChange={e => setForm(f => ({ ...f, sortOrder: parseInt(e.target.value) || 0 }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Annulla</Button>
            <Button onClick={handleSave} disabled={!form.name}>{editing ? "Salva" : "Crea"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
