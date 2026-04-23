import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Check, SlidersHorizontal } from "lucide-react";
import { BackofficeShell } from "@/components/BackofficeShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

type ModifierType = "plus" | "minus" | "note" | "both";

function toggleTypeDir(current: ModifierType, dir: "plus" | "minus"): ModifierType {
  const hasPlus  = current === "plus"  || current === "both";
  const hasMinus = current === "minus" || current === "both";
  if (dir === "plus") {
    if (hasPlus)  return hasMinus ? "minus" : "plus"; // can't deselect last
    return hasMinus ? "both" : "plus";
  } else {
    if (hasMinus) return hasPlus ? "plus" : "minus";
    return hasPlus ? "both" : "minus";
  }
}
type Modifier = { id: number; label: string; type: ModifierType; priceExtra: string; categoryIds: number[] };
type Category = { id: number; name: string; color: string };

const TYPE_CONFIG: Record<ModifierType, { label: string; icon: string; bg: string; text: string; border: string }> = {
  plus:  { label: "+ Aggiunta",  icon: "+", bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-300" },
  minus: { label: "− Rimozione", icon: "−", bg: "bg-red-50",     text: "text-red-700",     border: "border-red-300"     },
  note:  { label: "✎ Commento",  icon: "✎", bg: "bg-slate-50",   text: "text-slate-600",   border: "border-slate-300"   },
  both:  { label: "± Entrambi",  icon: "±", bg: "bg-violet-50",  text: "text-violet-700",  border: "border-violet-300"  },
};

function useModifiers() {
  return useQuery<Modifier[]>({
    queryKey: ["modifiers"],
    queryFn: () => fetch(`${API}/modifiers`).then(r => r.json()),
  });
}

function useCategories() {
  return useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: () => fetch(`${API}/categories`).then(r => r.json()),
  });
}

const EMPTY: Omit<Modifier, "id"> = { label: "", type: "plus", priceExtra: "0.00", categoryIds: [] };

export default function VarkazioniPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: modifiers = [] } = useModifiers();
  const { data: categories = [] } = useCategories();

  const [dialog, setDialog] = useState<{ open: boolean; item?: Modifier }>({ open: false });
  const [form, setForm] = useState<Omit<Modifier, "id">>(EMPTY);

  function openNew() { setForm(EMPTY); setDialog({ open: true }); }
  function openEdit(m: Modifier) {
    setForm({ label: m.label, type: m.type, priceExtra: m.priceExtra, categoryIds: m.categoryIds });
    setDialog({ open: true, item: m });
  }
  function close() { setDialog({ open: false }); }

  function toggleCategory(catId: number) {
    setForm(f => ({
      ...f,
      categoryIds: f.categoryIds.includes(catId)
        ? f.categoryIds.filter(id => id !== catId)
        : [...f.categoryIds, catId],
    }));
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload = { ...form };
      if (dialog.item) {
        const r = await fetch(`${API}/modifiers/${dialog.item.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
        return r.json();
      } else {
        const r = await fetch(`${API}/modifiers`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
        return r.json();
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["modifiers"] });
      toast({ title: dialog.item ? "Variazione aggiornata" : "Variazione creata" });
      close();
    },
    onError: (err: unknown) => {
      toast({ title: "Errore", description: (err as Error).message, variant: "destructive" });
    },
  });

  const del = useMutation({
    mutationFn: (id: number) => fetch(`${API}/modifiers/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["modifiers"] }); toast({ title: "Variazione eliminata" }); },
  });

  const grouped: Record<ModifierType, Modifier[]> = { plus: [], minus: [], note: [], both: [] };
  modifiers.forEach(m => { if (grouped[m.type]) grouped[m.type].push(m); });

  return (
    <BackofficeShell
      title="Variazioni"
      subtitle="Modificatori per categoria — applicabili in cassa"
      actions={
        <Button size="sm" onClick={openNew} className="gap-1.5">
          <Plus className="h-4 w-4" /> Nuova variazione
        </Button>
      }
    >
      <div className="p-4 md:p-6 max-w-2xl space-y-6">

        {modifiers.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <SlidersHorizontal className="h-10 w-10 mb-3 opacity-30" />
            <p className="font-semibold">Nessuna variazione</p>
            <p className="text-sm mt-1">Crea una variazione e associala alle categorie</p>
          </div>
        )}

        {(["both", "plus", "minus", "note"] as ModifierType[]).map(type => {
          const list = grouped[type];
          if (list.length === 0) return null;
          const cfg = TYPE_CONFIG[type];
          return (
            <div key={type} className="space-y-2">
              <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 px-1 flex items-center gap-2">
                <span className={cn("inline-flex h-5 w-5 rounded items-center justify-center text-xs font-bold", cfg.bg, cfg.text)}>
                  {cfg.icon}
                </span>
                {cfg.label}
                {type === "both" && (
                  <span className="text-[10px] normal-case font-normal text-slate-400">
                    — appare sia come + che − in cassa
                  </span>
                )}
              </h2>
              {list.map(m => {
                const catNames = m.categoryIds
                  .map(cid => categories.find(c => c.id === cid)?.name)
                  .filter(Boolean);
                return (
                  <div key={m.id}
                    className={cn("flex items-center gap-3 p-4 bg-white rounded-xl border-2 shadow-sm", cfg.border)}>
                    <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0 font-bold text-lg", cfg.bg, cfg.text)}>
                      {cfg.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-800">{m.label}</div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {type === "both" && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-600 font-semibold">
                            + e −
                          </span>
                        )}
                        {parseFloat(m.priceExtra) !== 0 && (
                          <span className="text-xs font-mono text-slate-500">
                            {parseFloat(m.priceExtra) > 0 ? "+" : ""}€{parseFloat(m.priceExtra).toFixed(2)}
                          </span>
                        )}
                        {catNames.length > 0 ? (
                          catNames.map(name => (
                            <span key={name} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">
                              {name}
                            </span>
                          ))
                        ) : (
                          <span className="text-[10px] text-slate-300 italic">nessuna categoria</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => openEdit(m)}
                        className="p-2 rounded-lg text-slate-400 hover:text-primary hover:bg-orange-50 transition-colors">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => del.mutate(m.id)}
                        className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <Dialog open={dialog.open} onOpenChange={o => !o && close()}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialog.item ? "Modifica variazione" : "Nuova variazione"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Tipo */}
            <div>
              <Label className="text-xs text-slate-500 mb-2 block">Tipo</Label>
              <div className="flex gap-2">
                {/* + e − come toggle indipendenti */}
                {(["plus", "minus"] as const).map(dir => {
                  const active = form.type === dir || form.type === "both";
                  const cfg = TYPE_CONFIG[dir];
                  return (
                    <button key={dir}
                      onClick={() => setForm(f => ({ ...f, type: toggleTypeDir(f.type === "note" ? "plus" : f.type, dir) }))}
                      className={cn(
                        "flex-1 py-3 rounded-xl text-sm font-semibold border-2 flex flex-col items-center gap-1 transition-all",
                        active
                          ? cn("border-current shadow-sm", cfg.bg, cfg.text)
                          : "border-slate-200 text-slate-400 hover:border-slate-300"
                      )}>
                      <span className="text-2xl font-bold leading-none">{cfg.icon}</span>
                      <span className="text-xs">{dir === "plus" ? "Aggiunta" : "Rimozione"}</span>
                    </button>
                  );
                })}
                {/* Commento — esclusivo */}
                <button
                  onClick={() => setForm(f => ({ ...f, type: "note" }))}
                  className={cn(
                    "flex-1 py-3 rounded-xl text-sm font-semibold border-2 flex flex-col items-center gap-1 transition-all",
                    form.type === "note"
                      ? cn("border-current shadow-sm", TYPE_CONFIG.note.bg, TYPE_CONFIG.note.text)
                      : "border-slate-200 text-slate-400 hover:border-slate-300"
                  )}>
                  <span className="text-2xl font-bold leading-none">✎</span>
                  <span className="text-xs">Commento</span>
                </button>
              </div>
              {form.type === "both" && (
                <p className="text-[11px] text-violet-600 mt-2 px-1 bg-violet-50 rounded-lg py-2">
                  <strong>± Entrambi selezionati</strong> — in cassa apparirà con due tasti separati: <strong>+</strong> e <strong>−</strong>
                </p>
              )}
            </div>

            {/* Label */}
            <div>
              <Label className="text-xs text-slate-500 mb-1 block">Testo della variazione *</Label>
              <Input
                value={form.label}
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                placeholder={
                  form.type === "plus" ? "es. extra formaggio" :
                  form.type === "minus" ? "es. senza cipolla" :
                  form.type === "both" ? "es. cipolla (poi scegli + o −)" :
                  "es. al dente"
                }
                className="h-9"
              />
            </div>

            {/* Prezzo extra (opzionale) */}
            <div>
              <Label className="text-xs text-slate-500 mb-1 block">
                Variazione prezzo
                <span className="text-slate-300 ml-1">(opzionale)</span>
              </Label>
              <div className="flex items-center gap-2">
                <span className="text-slate-400 text-sm">€</span>
                <Input
                  type="number"
                  step="0.10"
                  value={form.priceExtra}
                  onChange={e => setForm(f => ({ ...f, priceExtra: e.target.value }))}
                  className="h-9 w-28 font-mono text-right"
                  placeholder="0.00"
                />
                <span className="text-xs text-slate-400">(negativo per sconto)</span>
              </div>
            </div>

            {/* Categorie */}
            <div>
              <Label className="text-xs text-slate-500 mb-2 block">
                Categorie associate
                <span className="text-slate-300 ml-1">(seleziona dove applicare)</span>
              </Label>
              {categories.length === 0 ? (
                <p className="text-xs text-slate-400 italic">Nessuna categoria disponibile</p>
              ) : (
                <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-1">
                  {categories.map(cat => {
                    const checked = form.categoryIds.includes(cat.id);
                    return (
                      <button key={cat.id} onClick={() => toggleCategory(cat.id)}
                        className={cn(
                          "flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-sm font-medium transition-all text-left",
                          checked
                            ? "border-primary bg-orange-50 text-primary"
                            : "border-slate-200 text-slate-600 hover:border-slate-300"
                        )}>
                        <div className={cn(
                          "h-4 w-4 rounded flex items-center justify-center shrink-0 border-2 transition-colors",
                          checked ? "bg-primary border-primary" : "border-slate-300"
                        )}>
                          {checked && <Check className="h-2.5 w-2.5 text-white" />}
                        </div>
                        <span className="truncate">{cat.name}</span>
                        {cat.color && (
                          <span className="h-2.5 w-2.5 rounded-full shrink-0 ml-auto"
                            style={{ backgroundColor: cat.color }} />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={close}>Annulla</Button>
            <Button onClick={() => save.mutate()} disabled={!form.label.trim() || save.isPending}>
              {save.isPending ? "Salvataggio..." : "Salva"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BackofficeShell>
  );
}
