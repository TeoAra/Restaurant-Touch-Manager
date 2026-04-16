import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BackofficeShell } from "@/components/BackofficeShell";
import { Plus, Pencil, Trash2, Package, ChevronDown, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

type Combo = { id: number; name: string; description?: string; price: string; available: boolean; sortOrder: number };
type ComboItem = { id: number; comboId: number; productId: number; productName: string; quantity: number; priceOverride?: string };
type Product = { id: number; name: string; price: string };

function ComboForm({ initial, onSave, onCancel }: {
  initial?: Partial<Combo>;
  onSave: (d: Partial<Combo>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [price, setPrice] = useState(initial?.price ?? "0.00");
  const [available, setAvailable] = useState(initial?.available ?? true);

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Nome combo</label>
        <input value={name} onChange={e => setName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none"
          placeholder="es. Menu Pranzo Completo" />
      </div>
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Descrizione</label>
        <input value={description} onChange={e => setDescription(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none"
          placeholder="Descrizione opzionale" />
      </div>
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Prezzo combo (€)</label>
        <input type="number" min="0" step="0.01" value={price} onChange={e => setPrice(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none" />
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 cursor-pointer">
        <input type="checkbox" checked={available} onChange={e => setAvailable(e.target.checked)} className="w-4 h-4 accent-primary" />
        Disponibile
      </label>
      <DialogFooter>
        <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">Annulla</button>
        <button onClick={() => onSave({ name, description: description || undefined, price, available })}
          disabled={!name.trim()}
          className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-bold hover:bg-primary/90 disabled:opacity-40">
          Salva
        </button>
      </DialogFooter>
    </div>
  );
}

function ComboDetail({ combo }: { combo: Combo }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [addingProduct, setAddingProduct] = useState(false);
  const [selProductId, setSelProductId] = useState<number | null>(null);
  const [qty, setQty] = useState(1);

  const { data: items = [] } = useQuery<ComboItem[]>({
    queryKey: ["combo-items", combo.id],
    queryFn: () => fetch(`${API}/combos/${combo.id}/items`).then(r => r.json()),
  });

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["products"],
    queryFn: () => fetch(`${API}/products`).then(r => r.json()),
    enabled: addingProduct,
  });

  const addItem = useMutation({
    mutationFn: (body: { productId: number; productName: string; quantity: number }) =>
      fetch(`${API}/combos/${combo.id}/items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["combo-items", combo.id] }); setAddingProduct(false); setSelProductId(null); toast({ title: "Prodotto aggiunto" }); },
  });

  const removeItem = useMutation({
    mutationFn: (itemId: number) => fetch(`${API}/combos/${combo.id}/items/${itemId}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["combo-items", combo.id] }); },
  });

  const selectedProduct = products.find(p => p.id === selProductId);

  return (
    <div className="mt-3 pl-4 border-l-2 border-orange-100 space-y-2">
      {items.map(item => (
        <div key={item.id} className="flex items-center gap-2 text-sm">
          <span className="bg-orange-100 text-primary font-bold text-xs px-1.5 py-0.5 rounded">{item.quantity}×</span>
          <span className="flex-1 text-slate-700">{item.productName}</span>
          <button onClick={() => removeItem.mutate(item.id)} className="h-6 w-6 flex items-center justify-center text-slate-300 hover:text-red-400 transition-colors">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
      {!addingProduct ? (
        <button onClick={() => setAddingProduct(true)}
          className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
          <Plus className="h-3 w-3" /> Aggiungi prodotto
        </button>
      ) : (
        <div className="bg-slate-50 rounded-lg p-3 space-y-2">
          <select value={selProductId ?? ""} onChange={e => setSelProductId(Number(e.target.value))}
            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:border-primary focus:outline-none">
            <option value="">— Seleziona prodotto —</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name} (€{parseFloat(p.price).toFixed(2)})</option>)}
          </select>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 shrink-0">Qtà:</label>
            <input type="number" min="1" value={qty} onChange={e => setQty(Number(e.target.value))}
              className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-sm focus:border-primary focus:outline-none" />
            <button onClick={() => setAddingProduct(false)} className="ml-auto text-xs text-slate-400 hover:text-slate-600">Annulla</button>
            <button onClick={() => selProductId && selectedProduct && addItem.mutate({ productId: selProductId, productName: selectedProduct.name, quantity: qty })}
              disabled={!selProductId}
              className="px-3 py-1 rounded-lg bg-primary text-white text-xs font-bold disabled:opacity-40">
              Aggiungi
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ComboPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Combo | null>(null);
  const [deleting, setDeleting] = useState<Combo | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data: combos = [] } = useQuery<Combo[]>({
    queryKey: ["combos"],
    queryFn: () => fetch(`${API}/combos`).then(r => r.json()),
  });

  const create = useMutation({
    mutationFn: (body: Partial<Combo>) => fetch(`${API}/combos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["combos"] }); setShowForm(false); toast({ title: "Combo creata" }); },
  });

  const update = useMutation({
    mutationFn: ({ id, ...body }: Partial<Combo> & { id: number }) => fetch(`${API}/combos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["combos"] }); setEditing(null); toast({ title: "Combo aggiornata" }); },
  });

  const remove = useMutation({
    mutationFn: (id: number) => fetch(`${API}/combos/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["combos"] }); setDeleting(null); toast({ title: "Combo eliminata" }); },
  });

  return (
    <BackofficeShell title="Combo / Menu" subtitle="Prodotti composti e menu fissi">
      <div className="p-4 max-w-xl mx-auto space-y-4">
        <button onClick={() => setShowForm(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-primary text-primary font-semibold hover:bg-orange-50 transition-all">
          <Plus className="h-4 w-4" /> Nuova Combo / Menu
        </button>

        {combos.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            <Package className="h-10 w-10 mx-auto mb-3 opacity-25" />
            <p className="text-sm">Nessuna combo configurata</p>
          </div>
        )}

        {combos.map(c => (
          <div key={c.id} className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="p-4 flex items-center gap-3">
              <button onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                className="h-10 w-10 rounded-xl bg-orange-50 flex items-center justify-center shrink-0 text-primary">
                {expanded === c.id ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-800 text-sm">{c.name}</span>
                  {!c.available && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">Non disponibile</span>}
                </div>
                <div className="text-xs text-slate-400">€ {parseFloat(c.price).toFixed(2)}{c.description && ` · ${c.description}`}</div>
              </div>
              <button onClick={() => setEditing(c)} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-primary transition-colors">
                <Pencil className="h-4 w-4" />
              </button>
              <button onClick={() => setDeleting(c)} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            {expanded === c.id && (
              <div className="px-4 pb-4">
                <ComboDetail combo={c} />
              </div>
            )}
          </div>
        ))}

        <Dialog open={showForm} onOpenChange={setShowForm}>
          <DialogContent>
            <DialogHeader><DialogTitle>Nuova Combo</DialogTitle></DialogHeader>
            <ComboForm onSave={b => create.mutate(b)} onCancel={() => setShowForm(false)} />
          </DialogContent>
        </Dialog>

        <Dialog open={!!editing} onOpenChange={v => !v && setEditing(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Modifica Combo</DialogTitle></DialogHeader>
            {editing && <ComboForm initial={editing} onSave={b => update.mutate({ ...b, id: editing.id })} onCancel={() => setEditing(null)} />}
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!deleting} onOpenChange={v => !v && setDeleting(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Elimina combo</AlertDialogTitle>
              <AlertDialogDescription>Eliminare "{deleting?.name}" con tutti i suoi prodotti? L'operazione è irreversibile.</AlertDialogDescription>
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
