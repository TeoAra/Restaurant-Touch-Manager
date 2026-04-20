import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useListCategories,
  useListProducts,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
  getListCategoriesQueryKey,
  getListProductsQueryKey,
} from "@workspace/api-client-react";
import type { Category, Product } from "@workspace/api-client-react";
import { BackofficeShell } from "@/components/BackofficeShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Pencil, Trash2, Package, Settings2, X, GripVertical, ChevronDown, ChevronUp, ChevronRight, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

// ── Types ─────────────────────────────────────────────────────────────────────
type VariationOption = { name: string; priceExtra: string };
type VariationGroup = {
  id: number;
  productId: number;
  name: string;
  options: VariationOption[];
  required: boolean;
  sortOrder: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
async function fetchVariations(productId: number): Promise<VariationGroup[]> {
  const res = await fetch(`${API}/products/${productId}/variations`);
  if (!res.ok) return [];
  const rows = await res.json();
  return rows.map((r: VariationGroup & { options: string }) => ({
    ...r,
    options: typeof r.options === "string" ? JSON.parse(r.options) : r.options,
  }));
}

async function saveVariation(productId: number, data: Omit<VariationGroup, "id" | "productId">): Promise<VariationGroup> {
  const res = await fetch(`${API}/products/${productId}/variations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const row = await res.json();
  return { ...row, options: typeof row.options === "string" ? JSON.parse(row.options) : row.options };
}

async function updateVariation(productId: number, varId: number, data: Partial<Omit<VariationGroup, "id" | "productId">>): Promise<void> {
  await fetch(`${API}/products/${productId}/variations/${varId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

async function deleteVariation(productId: number, varId: number): Promise<void> {
  await fetch(`${API}/products/${productId}/variations/${varId}`, { method: "DELETE" });
}

// ── CategoryForm ──────────────────────────────────────────────────────────────
type SimplePrinter = { id: number; name: string };
function CategoryForm({ initial, printers, onSave, onClose }: {
  initial?: Category;
  printers: SimplePrinter[];
  onSave: (data: { name: string; color: string; sortOrder: number; printerId: number | null }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? "#f59e0b");
  const [sortOrder, setSortOrder] = useState(initial?.sortOrder ?? 0);
  const [printerId, setPrinterId] = useState<number | null>((initial as Category & { printerId?: number | null })?.printerId ?? null);

  return (
    <div className="space-y-4">
      <div>
        <Label>Nome</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Es. Birre" className="mt-1" />
      </div>
      <div>
        <Label>Colore</Label>
        <div className="flex items-center gap-2 mt-1">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-10 h-10 rounded cursor-pointer border border-border bg-transparent" />
          <Input value={color} onChange={(e) => setColor(e.target.value)} className="font-mono" />
        </div>
      </div>
      <div>
        <Label>Ordine visualizzazione</Label>
        <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} className="mt-1" />
      </div>
      <div>
        <Label>Stampante comanda</Label>
        <select
          value={printerId ?? ""}
          onChange={e => setPrinterId(e.target.value ? Number(e.target.value) : null)}
          className="mt-1 w-full h-9 px-3 rounded-md border border-slate-200 text-sm bg-white"
        >
          <option value="">— Nessuna stampante —</option>
          {printers.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <p className="text-[11px] text-slate-400 mt-1">
          Le comande di questa categoria vengono stampate su questa stampante
        </p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Annulla</Button>
        <Button onClick={() => onSave({ name, color, sortOrder, printerId })} disabled={!name}>Salva</Button>
      </DialogFooter>
    </div>
  );
}

const IVA_RATES = ["4", "10", "22"] as const;

// ── ProductForm ───────────────────────────────────────────────────────────────
type ProductExt = Product & { iva?: string; sku?: string; barcode?: string; price2?: string; price3?: string; price4?: string };

function ProductForm({ initial, categories, onSave, onClose }: {
  initial?: Product;
  categories: Category[];
  onSave: (data: { name: string; price: string; price2: string; price3: string; price4: string; categoryId: number | null; description: string | null; available: boolean; sortOrder: number; iva: string; sku: string | null; barcode: string | null }) => void;
  onClose: () => void
}) {
  const ext = initial as ProductExt | undefined;
  const [name, setName] = useState(ext?.name ?? "");
  const [price, setPrice] = useState(ext?.price ?? "");
  const [price2, setPrice2] = useState(ext?.price2 ?? "0.00");
  const [price3, setPrice3] = useState(ext?.price3 ?? "0.00");
  const [price4, setPrice4] = useState(ext?.price4 ?? "0.00");
  const [categoryId, setCategoryId] = useState<number | null>(ext?.categoryId ?? null);
  const [description, setDescription] = useState(ext?.description ?? "");
  const [available, setAvailable] = useState(ext?.available ?? true);
  const [sortOrder, setSortOrder] = useState(ext?.sortOrder ?? 0);
  const [iva, setIva] = useState(ext?.iva ?? "10");
  const [sku, setSku] = useState(ext?.sku ?? "");
  const [barcode, setBarcode] = useState(ext?.barcode ?? "");

  return (
    <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label>Nome prodotto *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Es. Birra Chiara" className="mt-1" />
        </div>
        <div>
          <Label>IVA %</Label>
          <select value={iva} onChange={(e) => setIva(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            {IVA_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
          </select>
        </div>
        <div>
          <Label>Categoria</Label>
          <select value={categoryId ?? ""} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="">Nessuna</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {/* 4 listini prezzi */}
      <div>
        <Label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Listini Prezzi (€)</Label>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          {[
            { label: "1 — Servito", val: price, set: setPrice },
            { label: "2 — Asporto", val: price2, set: setPrice2 },
            { label: "3 — Fidelity", val: price3, set: setPrice3 },
            { label: "4 — Staff", val: price4, set: setPrice4 },
          ].map(({ label, val, set }) => (
            <div key={label}>
              <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{label}</label>
              <Input type="number" step="0.01" min="0" value={val} onChange={e => set(e.target.value)} placeholder="0.00" className="mt-0.5 text-sm" />
            </div>
          ))}
        </div>
      </div>

      <div>
        <Label>Descrizione</Label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Facoltativa" className="mt-1" />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label>SKU / Codice</Label>
          <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="opz." className="mt-1 font-mono text-sm" />
        </div>
        <div>
          <Label>Barcode</Label>
          <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="EAN13…" className="mt-1 font-mono text-sm" />
        </div>
        <div>
          <Label>Ordine</Label>
          <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} className="mt-1" />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Switch checked={available} onCheckedChange={setAvailable} id="available" />
        <Label htmlFor="available">Disponibile</Label>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Annulla</Button>
        <Button onClick={() => onSave({ name, price, price2, price3, price4, categoryId, description: description || null, available, sortOrder, iva, sku: sku || null, barcode: barcode || null })} disabled={!name || !price}>Salva</Button>
      </DialogFooter>
    </div>
  );
}

// ── VariationOptionEditor ─────────────────────────────────────────────────────
function VariationOptionEditor({
  options,
  onChange,
}: {
  options: VariationOption[];
  onChange: (opts: VariationOption[]) => void;
}) {
  return (
    <div className="space-y-2">
      {options.map((opt, i) => (
        <div key={i} className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            placeholder="Nome opzione"
            value={opt.name}
            onChange={e => {
              const next = [...options];
              next[i] = { ...next[i], name: e.target.value };
              onChange(next);
            }}
            className="flex-1 h-9 text-sm"
          />
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-xs text-muted-foreground">+€</span>
            <Input
              type="number"
              step="0.01"
              placeholder="0.00"
              value={opt.priceExtra}
              onChange={e => {
                const next = [...options];
                next[i] = { ...next[i], priceExtra: e.target.value };
                onChange(next);
              }}
              className="w-20 h-9 text-sm text-right"
            />
          </div>
          <button
            onClick={() => onChange(options.filter((_, j) => j !== i))}
            className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="w-full gap-1 text-xs h-8 border-dashed"
        onClick={() => onChange([...options, { name: "", priceExtra: "0" }])}
      >
        <Plus className="h-3.5 w-3.5" /> Aggiungi opzione
      </Button>
    </div>
  );
}

// ── VariationGroupCard ────────────────────────────────────────────────────────
function VariationGroupCard({
  group,
  productId,
  onSaved,
  onDeleted,
}: {
  group: VariationGroup;
  productId: number;
  onSaved: (updated: VariationGroup) => void;
  onDeleted: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState(group.name);
  const [required, setRequired] = useState(group.required);
  const [options, setOptions] = useState<VariationOption[]>(group.options);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const isDirty =
    name !== group.name ||
    required !== group.required ||
    JSON.stringify(options) !== JSON.stringify(group.options);

  async function handleSave() {
    setSaving(true);
    try {
      await updateVariation(productId, group.id, { name, required, options });
      onSaved({ ...group, name, required, options });
      toast({ title: "Variazione salvata" });
      setExpanded(false);
    } catch {
      toast({ title: "Errore salvataggio", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    await deleteVariation(productId, group.id);
    onDeleted(group.id);
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-foreground">{group.name || "Senza nome"}</span>
            {group.required && (
              <Badge variant="secondary" className="text-xs">Obbligatoria</Badge>
            )}
            <span className="text-xs text-muted-foreground">{group.options.length} opzioni</span>
          </div>
          {!expanded && group.options.length > 0 && (
            <div className="text-xs text-muted-foreground mt-0.5 truncate">
              {group.options.map(o => o.name).join(", ")}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setExpanded(e => !e)}
            className="p-1.5 rounded hover:bg-accent transition-colors text-muted-foreground"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <button
            onClick={handleDelete}
            className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-3 pb-3 pt-2 space-y-3 bg-muted/20">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Nome gruppo *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} className="mt-1 h-9" placeholder="Es. Cottura, Taglia…" />
            </div>
            <div className="flex items-center gap-2 pt-5">
              <Switch checked={required} onCheckedChange={setRequired} id={`req-${group.id}`} />
              <Label htmlFor={`req-${group.id}`} className="text-sm">Selezione obbligatoria</Label>
            </div>
          </div>
          <div>
            <Label className="text-xs mb-2 block">Opzioni</Label>
            <VariationOptionEditor options={options} onChange={setOptions} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => { setExpanded(false); setName(group.name); setRequired(group.required); setOptions(group.options); }}>
              Annulla
            </Button>
            <Button size="sm" disabled={!isDirty || saving || !name} onClick={handleSave}>
              {saving ? "Salvataggio…" : "Salva"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── VariationsDialog ──────────────────────────────────────────────────────────
function VariationsDialog({ product, open, onClose }: { product: Product; open: boolean; onClose: () => void }) {
  const [groups, setGroups] = useState<VariationGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRequired, setNewRequired] = useState(false);
  const [newOptions, setNewOptions] = useState<VariationOption[]>([]);
  const [showNewForm, setShowNewForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchVariations(product.id).then(data => {
      setGroups(data);
      setLoading(false);
    });
  }, [open, product.id]);

  async function handleAddGroup() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const group = await saveVariation(product.id, {
        name: newName.trim(),
        options: newOptions,
        required: newRequired,
        sortOrder: groups.length,
      });
      setGroups(g => [...g, group]);
      setNewName("");
      setNewRequired(false);
      setNewOptions([]);
      setShowNewForm(false);
      toast({ title: "Variazione aggiunta" });
    } catch {
      toast({ title: "Errore", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5 text-primary" />
            Variazioni — {product.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
          {loading ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Caricamento…</div>
          ) : groups.length === 0 && !showNewForm ? (
            <div className="text-center py-8 text-muted-foreground">
              <Settings2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Nessuna variazione definita</p>
              <p className="text-xs mt-1">Aggiungi gruppi come "Cottura", "Taglia", "Aggiunta"</p>
            </div>
          ) : (
            <>
              {groups.map(g => (
                <VariationGroupCard
                  key={g.id}
                  group={g}
                  productId={product.id}
                  onSaved={updated => setGroups(prev => prev.map(x => x.id === updated.id ? updated : x))}
                  onDeleted={id => setGroups(prev => prev.filter(x => x.id !== id))}
                />
              ))}
            </>
          )}

          {showNewForm && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 pb-3 pt-2 space-y-3">
              <p className="text-sm font-medium text-primary">Nuovo gruppo variazione</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Nome gruppo *</Label>
                  <Input
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="Es. Cottura, Taglia…"
                    className="mt-1 h-9"
                    autoFocus
                  />
                </div>
                <div className="flex items-center gap-2 pt-5">
                  <Switch checked={newRequired} onCheckedChange={setNewRequired} id="new-req" />
                  <Label htmlFor="new-req" className="text-sm">Obbligatoria</Label>
                </div>
              </div>
              <div>
                <Label className="text-xs mb-2 block">Opzioni</Label>
                <VariationOptionEditor options={newOptions} onChange={setNewOptions} />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={() => { setShowNewForm(false); setNewName(""); setNewOptions([]); setNewRequired(false); }}>
                  Annulla
                </Button>
                <Button size="sm" disabled={!newName.trim() || saving} onClick={handleAddGroup}>
                  {saving ? "Salvataggio…" : "Aggiungi"}
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {!showNewForm && (
            <Button variant="outline" className="gap-1" onClick={() => setShowNewForm(true)}>
              <Plus className="h-4 w-4" /> Nuovo gruppo
            </Button>
          )}
          <Button onClick={onClose}>Chiudi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── ProductVariationsInline ───────────────────────────────────────────────────
function ProductVariationsInline({ product, categories }: { product: Product; categories: Category[] }) {
  const [expanded, setExpanded] = useState(false);
  const [groups, setGroups] = useState<VariationGroup[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRequired, setNewRequired] = useState(false);
  const [newOptions, setNewOptions] = useState<VariationOption[]>([]);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const cat = categories.find(c => c.id === product.categoryId);

  async function load() {
    if (loaded) return;
    setLoading(true);
    const data = await fetchVariations(product.id);
    setGroups(data);
    setLoaded(true);
    setLoading(false);
  }

  function toggle() {
    if (!expanded) load();
    setExpanded(e => !e);
  }

  async function handleAddGroup() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const group = await saveVariation(product.id, { name: newName.trim(), options: newOptions, required: newRequired, sortOrder: groups.length });
      setGroups(g => [...g, group]);
      setNewName(""); setNewRequired(false); setNewOptions([]); setShowNewForm(false);
      toast({ title: "Variazione aggiunta" });
    } catch { toast({ title: "Errore", variant: "destructive" }); }
    finally { setSaving(false); }
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header row — click to expand */}
      <button
        onClick={toggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-foreground">{product.name}</span>
            {cat && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: cat.color + "28", color: cat.color }}>
                {cat.name}
              </span>
            )}
          </div>
          {!expanded && (
            <span className="text-xs text-muted-foreground">
              {loaded ? `${groups.length} gruppi variazione` : "Tocca per vedere le variazioni"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-primary font-semibold">€ {product.price}</span>
          {expanded
            ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground" />
          }
        </div>
      </button>

      {/* Variations panel */}
      {expanded && (
        <div className="border-t border-border bg-muted/10 px-4 pb-4 pt-3 space-y-3">
          {loading && <div className="text-center py-4 text-sm text-muted-foreground">Caricamento…</div>}

          {!loading && groups.length === 0 && !showNewForm && (
            <div className="text-center py-4 text-muted-foreground">
              <Settings2 className="h-8 w-8 mx-auto mb-2 opacity-25" />
              <p className="text-xs">Nessun gruppo variazione — es. Cottura, Taglia, Aggiunta</p>
            </div>
          )}

          {!loading && groups.map(g => (
            <VariationGroupCard
              key={g.id}
              group={g}
              productId={product.id}
              onSaved={updated => setGroups(prev => prev.map(x => x.id === updated.id ? updated : x))}
              onDeleted={id => setGroups(prev => prev.filter(x => x.id !== id))}
            />
          ))}

          {showNewForm && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 pb-3 pt-2 space-y-3">
              <p className="text-sm font-semibold text-primary">Nuovo gruppo variazione</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Nome gruppo *</Label>
                  <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Es. Cottura, Taglia…" className="mt-1 h-9" autoFocus />
                </div>
                <div className="flex items-center gap-2 pt-5">
                  <Switch checked={newRequired} onCheckedChange={setNewRequired} id={`nr-${product.id}`} />
                  <Label htmlFor={`nr-${product.id}`} className="text-sm">Obbligatoria</Label>
                </div>
              </div>
              <div>
                <Label className="text-xs mb-2 block">Opzioni</Label>
                <VariationOptionEditor options={newOptions} onChange={setNewOptions} />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={() => { setShowNewForm(false); setNewName(""); setNewOptions([]); setNewRequired(false); }}>
                  Annulla
                </Button>
                <Button size="sm" disabled={!newName.trim() || saving} onClick={handleAddGroup}>
                  {saving ? "Salvataggio…" : "Aggiungi"}
                </Button>
              </div>
            </div>
          )}

          {!showNewForm && !loading && (
            <Button variant="outline" size="sm" className="gap-1 w-full border-dashed" onClick={() => setShowNewForm(true)}>
              <Plus className="h-4 w-4" /> Aggiungi gruppo variazione
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ── MenuPage ──────────────────────────────────────────────────────────────────
export default function MenuPage() {
  const [catDialog, setCatDialog] = useState<{ open: boolean; item?: Category }>({ open: false });
  const [prodDialog, setProdDialog] = useState<{ open: boolean; item?: Product }>({ open: false });
  const [variationsDialog, setVariationsDialog] = useState<{ open: boolean; product?: Product }>({ open: false });
  const [filterCatId, setFilterCatId] = useState<number | null>(null);
  const [varSearch, setVarSearch] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: categories = [] } = useListCategories();
  const { data: products = [] } = useListProducts(filterCatId != null ? { categoryId: filterCatId } : undefined);
  const { data: allProducts = [] } = useListProducts();
  const { data: printers = [] } = useQuery<SimplePrinter[]>({ queryKey: ["printers"], queryFn: () => fetch(`${API}/printers`).then(r => r.json()) });

  const createCat = useCreateCategory();
  const updateCat = useUpdateCategory();
  const deleteCat = useDeleteCategory();
  const createProd = useCreateProduct();
  const updateProd = useUpdateProduct();
  const deleteProd = useDeleteProduct();

  const handleSaveCategory = (data: { name: string; color: string; sortOrder: number; printerId: number | null }) => {
    const opts = {
      onSuccess: () => {
        toast({ title: "Categoria salvata" });
        queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
        setCatDialog({ open: false });
      },
      onError: () => toast({ title: "Errore", variant: "destructive" as const }),
    };
    if (catDialog.item) {
      updateCat.mutate({ id: catDialog.item.id, data }, opts);
    } else {
      createCat.mutate({ data }, opts);
    }
  };

  const handleSaveProduct = (data: { name: string; price: string; price2: string; price3: string; price4: string; categoryId: number | null; description: string | null; available: boolean; sortOrder: number; iva: string; sku: string | null; barcode: string | null }) => {
    const opts = {
      onSuccess: () => {
        toast({ title: "Prodotto salvato" });
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
        setProdDialog({ open: false });
      },
      onError: () => toast({ title: "Errore", variant: "destructive" as const }),
    };
    if (prodDialog.item) {
      updateProd.mutate({ id: prodDialog.item.id, data }, opts);
    } else {
      createProd.mutate({ data }, opts);
    }
  };

  const handleDeleteCat = (id: number) => {
    deleteCat.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Categoria eliminata" });
        queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
      },
    });
  };

  const handleDeleteProd = (id: number) => {
    deleteProd.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Prodotto eliminato" });
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
      },
    });
  };

  const filteredProducts = filterCatId != null ? products.filter(p => p.categoryId === filterCatId) : products;

  return (
    <BackofficeShell
      title="Gestione Menu"
      subtitle={`${products.length} prodotti, ${categories.length} categorie`}
      fixedHeight
    >
      <Tabs defaultValue="products" className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 sm:px-6 border-b border-border shrink-0">
          <TabsList className="mb-0">
            <TabsTrigger value="products">Prodotti</TabsTrigger>
            <TabsTrigger value="categories">Categorie</TabsTrigger>
            <TabsTrigger value="variations">Variazioni</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="products" className="flex-1 overflow-hidden m-0 flex flex-col">
          <div className="px-4 sm:px-6 pt-4 pb-2 flex items-center justify-between shrink-0 gap-2">
            <div className="flex gap-1.5 flex-wrap flex-1 min-w-0">
              <button
                onClick={() => setFilterCatId(null)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filterCatId === null ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}
              >
                Tutti
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setFilterCatId(c.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filterCatId === c.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}
                >
                  {c.name}
                </button>
              ))}
            </div>
            <Button size="sm" className="gap-1 shrink-0" onClick={() => setProdDialog({ open: true })}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Aggiungi</span>
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="px-4 sm:px-6 pb-6 space-y-2">
              {filteredProducts.map((p) => {
                const cat = categories.find(c => c.id === p.categoryId);
                return (
                  <div key={p.id} className="flex items-center gap-2 sm:gap-3 p-3 rounded-lg bg-card border border-border">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-foreground text-sm">{p.name}</span>
                        {!p.available && <Badge variant="outline" className="text-xs text-muted-foreground">Non disp.</Badge>}
                        {cat && (
                          <span className="text-xs px-2 py-0.5 rounded-full hidden sm:inline" style={{ backgroundColor: cat.color + "30", color: cat.color }}>
                            {cat.name}
                          </span>
                        )}
                      </div>
                      {p.description && <div className="text-xs text-muted-foreground mt-0.5 truncate">{p.description}</div>}
                    </div>
                    <div className="text-primary font-bold text-sm shrink-0">€ {p.price}</div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        title="Variazioni"
                        onClick={() => setVariationsDialog({ open: true, product: p })}
                        className="h-8 w-8 flex items-center justify-center rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                      >
                        <Settings2 className="h-4 w-4" />
                      </button>
                      <button
                        title="Modifica"
                        onClick={() => setProdDialog({ open: true, item: p })}
                        className="h-8 w-8 flex items-center justify-center rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        title="Elimina"
                        onClick={() => handleDeleteProd(p.id)}
                        className="h-8 w-8 flex items-center justify-center rounded hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
              {filteredProducts.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <Package className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <div className="text-sm">Nessun prodotto trovato</div>
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="categories" className="flex-1 overflow-hidden m-0 flex flex-col">
          <div className="px-4 sm:px-6 pt-4 pb-2 flex justify-end shrink-0">
            <Button size="sm" className="gap-1" onClick={() => setCatDialog({ open: true })}>
              <Plus className="h-4 w-4" /> Aggiungi
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="px-4 sm:px-6 pb-6 space-y-2">
              {categories.map((c) => {
                const assignedPrinter = c.printerId ? printers.find(p => p.id === c.printerId) : null;
                return (
                <div key={c.id} className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border">
                  <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-foreground text-sm">{c.name}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground">Ordine: {c.sortOrder}</span>
                      {assignedPrinter ? (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                          🖨 {assignedPrinter.name}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-300 italic">nessuna stampante</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => setCatDialog({ open: true, item: c })} className="h-8 w-8 flex items-center justify-center rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button onClick={() => handleDeleteCat(c.id)} className="h-8 w-8 flex items-center justify-center rounded hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ── Tab: Variazioni ─────────────────────────────────────────────── */}
        <TabsContent value="variations" className="flex-1 overflow-hidden m-0 flex flex-col">
          <div className="px-4 sm:px-6 pt-4 pb-2 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={varSearch}
                onChange={e => setVarSearch(e.target.value)}
                placeholder="Cerca prodotto…"
                className="w-full pl-8 pr-3 py-2 rounded-lg border border-input bg-background text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Clicca su un prodotto per espandere e gestire i suoi gruppi variazione (es. Cottura, Taglia, Aggiunta).
            </p>
          </div>
          <ScrollArea className="flex-1">
            <div className="px-4 sm:px-6 pb-6 space-y-2">
              {allProducts
                .filter(p => !varSearch || p.name.toLowerCase().includes(varSearch.toLowerCase()))
                .map(p => (
                  <ProductVariationsInline key={p.id} product={p} categories={categories} />
                ))
              }
              {allProducts.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <Package className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <div className="text-sm">Nessun prodotto nel menu</div>
                  <div className="text-xs mt-1">Aggiungi prima i prodotti nel tab Prodotti</div>
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* Category dialog */}
      <Dialog open={catDialog.open} onOpenChange={(o) => !o && setCatDialog({ open: false })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{catDialog.item ? "Modifica Categoria" : "Nuova Categoria"}</DialogTitle>
          </DialogHeader>
          <CategoryForm initial={catDialog.item} printers={printers} onSave={handleSaveCategory} onClose={() => setCatDialog({ open: false })} />
        </DialogContent>
      </Dialog>

      {/* Product dialog */}
      <Dialog open={prodDialog.open} onOpenChange={(o) => !o && setProdDialog({ open: false })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{prodDialog.item ? "Modifica Prodotto" : "Nuovo Prodotto"}</DialogTitle>
          </DialogHeader>
          <ProductForm initial={prodDialog.item} categories={categories} onSave={handleSaveProduct} onClose={() => setProdDialog({ open: false })} />
        </DialogContent>
      </Dialog>

      {/* Variations dialog */}
      {variationsDialog.product && (
        <VariationsDialog
          product={variationsDialog.product}
          open={variationsDialog.open}
          onClose={() => setVariationsDialog({ open: false })}
        />
      )}
    </BackofficeShell>
  );
}
