import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BackofficeShell } from "@/components/BackofficeShell";
import { Plus, Pencil, Trash2, MessageSquare, GripVertical } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

type KpComment = { id: number; text: string; sortOrder: number; active: boolean };

const PRESETS = [
  "Senza sale", "Senza aglio", "Senza cipolla", "Senza piccante", "Poco cotto",
  "Molto cotto", "Al sangue", "Senza lattosio", "Senza glutine", "Vegetariano",
  "Vegano", "Allergia arachidi", "Senza maionese", "Extra salsa", "Separato",
];

export default function KpCommentsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<KpComment | null>(null);
  const [deleting, setDeleting] = useState<KpComment | null>(null);
  const [newText, setNewText] = useState("");

  const { data: comments = [] } = useQuery<KpComment[]>({
    queryKey: ["kp-comments"],
    queryFn: () => fetch(`${API}/kp-comments`).then(r => r.json()),
  });

  const create = useMutation({
    mutationFn: (body: { text: string; sortOrder?: number }) => fetch(`${API}/kp-comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["kp-comments"] }); setShowForm(false); setNewText(""); toast({ title: "Commento aggiunto" }); },
  });

  const update = useMutation({
    mutationFn: ({ id, ...body }: Partial<KpComment> & { id: number }) => fetch(`${API}/kp-comments/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["kp-comments"] }); setEditing(null); toast({ title: "Commento aggiornato" }); },
  });

  const remove = useMutation({
    mutationFn: (id: number) => fetch(`${API}/kp-comments/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["kp-comments"] }); setDeleting(null); toast({ title: "Commento eliminato" }); },
  });

  const existingTexts = new Set(comments.map(c => c.text.toLowerCase()));

  return (
    <BackofficeShell title="Commenti Cucina" subtitle="Note rapide predefinite per la cucina (KP)">
      <div className="p-4 max-w-xl mx-auto space-y-4">
        <button onClick={() => setShowForm(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-primary text-primary font-semibold hover:bg-orange-50 transition-all">
          <Plus className="h-4 w-4" /> Nuovo Commento
        </button>

        {comments.length === 0 && (
          <div className="text-center py-8 text-slate-400">
            <MessageSquare className="h-10 w-10 mx-auto mb-3 opacity-25" />
            <p className="text-sm">Nessun commento cucina configurato</p>
          </div>
        )}

        <div className="space-y-2">
          {comments.map(c => (
            <div key={c.id} className={`bg-white rounded-xl border shadow-sm p-3 flex items-center gap-2 ${!c.active && "opacity-50"}`}>
              <GripVertical className="h-4 w-4 text-slate-300 shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold text-slate-700">{c.text}</span>
                {!c.active && <span className="ml-2 text-[10px] px-1 rounded bg-slate-100 text-slate-500">Inattivo</span>}
              </div>
              <button onClick={() => setEditing(c)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-primary transition-colors">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setDeleting(c)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/* Quick presets */}
        <div>
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Aggiungi rapido dai preset</div>
          <div className="flex flex-wrap gap-2">
            {PRESETS.filter(p => !existingTexts.has(p.toLowerCase())).map(p => (
              <button key={p} onClick={() => create.mutate({ text: p, sortOrder: comments.length })}
                className="px-3 py-1.5 rounded-full border border-slate-200 text-xs font-semibold text-slate-600 hover:border-primary hover:text-primary hover:bg-orange-50 transition-all">
                + {p}
              </button>
            ))}
          </div>
        </div>

        <Dialog open={showForm} onOpenChange={setShowForm}>
          <DialogContent>
            <DialogHeader><DialogTitle>Nuovo Commento Cucina</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Testo commento</label>
                <input value={newText} onChange={e => setNewText(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  placeholder="es. Senza glutine" />
              </div>
              <DialogFooter>
                <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">Annulla</button>
                <button onClick={() => create.mutate({ text: newText, sortOrder: comments.length })}
                  disabled={!newText.trim()}
                  className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-bold hover:bg-primary/90 disabled:opacity-40">
                  Aggiungi
                </button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={!!editing} onOpenChange={v => !v && setEditing(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Modifica Commento</DialogTitle></DialogHeader>
            {editing && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Testo</label>
                  <input defaultValue={editing.text}
                    id="edit-kp-text"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none" />
                </div>
                <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer">
                  <input type="checkbox" defaultChecked={editing.active} id="edit-kp-active" className="w-4 h-4 accent-primary" />
                  Attivo
                </label>
                <DialogFooter>
                  <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">Annulla</button>
                  <button onClick={() => {
                    const t = (document.getElementById("edit-kp-text") as HTMLInputElement)?.value;
                    const a = (document.getElementById("edit-kp-active") as HTMLInputElement)?.checked;
                    update.mutate({ id: editing.id, text: t, active: a });
                  }} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-bold hover:bg-primary/90">Salva</button>
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!deleting} onOpenChange={v => !v && setDeleting(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Elimina commento</AlertDialogTitle>
              <AlertDialogDescription>Eliminare "{deleting?.text}"?</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annulla</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleting && remove.mutate(deleting.id)} className="bg-red-500 hover:bg-red-600">Elimina</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </BackofficeShell>
  );
}
