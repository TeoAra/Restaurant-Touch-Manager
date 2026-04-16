import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Pencil, Trash2, Package } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function CategoryForm({ initial, onSave, onClose }: { initial?: Category; onSave: (data: { name: string; color: string; sortOrder: number }) => void; onClose: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? "#f59e0b");
  const [sortOrder, setSortOrder] = useState(initial?.sortOrder ?? 0);

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
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Annulla</Button>
        <Button onClick={() => onSave({ name, color, sortOrder })} disabled={!name}>Salva</Button>
      </DialogFooter>
    </div>
  );
}

const IVA_RATES = ["4", "10", "22"] as const;

function ProductForm({ initial, categories, onSave, onClose }: {
  initial?: Product;
  categories: Category[];
  onSave: (data: { name: string; price: string; categoryId: number | null; description: string | null; available: boolean; sortOrder: number; iva: string; sku: string | null }) => void;
  onClose: () => void
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [price, setPrice] = useState(initial?.price ?? "");
  const [categoryId, setCategoryId] = useState<number | null>(initial?.categoryId ?? null);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [available, setAvailable] = useState(initial?.available ?? true);
  const [sortOrder, setSortOrder] = useState(initial?.sortOrder ?? 0);
  const [iva, setIva] = useState((initial as Product & { iva?: string })?.iva ?? "10");
  const [sku, setSku] = useState((initial as Product & { sku?: string })?.sku ?? "");

  return (
    <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label>Nome prodotto *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Es. Birra Chiara" className="mt-1" />
        </div>
        <div>
          <Label>Prezzo (€) *</Label>
          <Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" className="mt-1" />
        </div>
        <div>
          <Label>IVA %</Label>
          <select value={iva} onChange={(e) => setIva(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            {IVA_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
          </select>
        </div>
      </div>
      <div>
        <Label>Categoria</Label>
        <select value={categoryId ?? ""} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
          <option value="">Nessuna categoria</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <Label>Descrizione</Label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Facoltativa" className="mt-1" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>SKU / Codice</Label>
          <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="opzionale" className="mt-1 font-mono" />
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
        <Button onClick={() => onSave({ name, price, categoryId, description: description || null, available, sortOrder, iva, sku: sku || null })} disabled={!name || !price}>Salva</Button>
      </DialogFooter>
    </div>
  );
}

export default function MenuPage() {
  const [catDialog, setCatDialog] = useState<{ open: boolean; item?: Category }>({ open: false });
  const [prodDialog, setProdDialog] = useState<{ open: boolean; item?: Product }>({ open: false });
  const [filterCatId, setFilterCatId] = useState<number | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: categories = [] } = useListCategories();
  const { data: products = [] } = useListProducts(filterCatId != null ? { categoryId: filterCatId } : undefined);

  const createCat = useCreateCategory();
  const updateCat = useUpdateCategory();
  const deleteCat = useDeleteCategory();
  const createProd = useCreateProduct();
  const updateProd = useUpdateProduct();
  const deleteProd = useDeleteProduct();

  const handleSaveCategory = (data: { name: string; color: string; sortOrder: number }) => {
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

  const handleSaveProduct = (data: { name: string; price: string; categoryId: number | null; description: string | null; available: boolean; sortOrder: number; iva: string; sku: string | null }) => {
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
    <div className="flex flex-col h-full">
      <div className="p-6 border-b border-border shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Gestione Menu</h1>
          <p className="text-muted-foreground text-sm mt-1">{products.length} prodotti, {categories.length} categorie</p>
        </div>
      </div>

      <Tabs defaultValue="products" className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 border-b border-border shrink-0">
          <TabsList className="mb-0">
            <TabsTrigger value="products">Prodotti</TabsTrigger>
            <TabsTrigger value="categories">Categorie</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="products" className="flex-1 overflow-hidden m-0 flex flex-col">
          <div className="px-6 pt-4 pb-2 flex items-center justify-between shrink-0">
            <div className="flex gap-2 flex-wrap">
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
            <Button size="sm" className="gap-1" onClick={() => setProdDialog({ open: true })}>
              <Plus className="h-4 w-4" /> Aggiungi
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="px-6 pb-6 space-y-2">
              {filteredProducts.map((p) => {
                const cat = categories.find(c => c.id === p.categoryId);
                return (
                  <div key={p.id} className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{p.name}</span>
                        {!p.available && <Badge variant="outline" className="text-xs text-muted-foreground">Non disponibile</Badge>}
                        {cat && (
                          <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: cat.color + "30", color: cat.color }}>
                            {cat.name}
                          </span>
                        )}
                      </div>
                      {p.description && <div className="text-xs text-muted-foreground mt-0.5">{p.description}</div>}
                    </div>
                    <div className="text-primary font-bold">€ {p.price}</div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setProdDialog({ open: true, item: p })}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDeleteProd(p.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
              {filteredProducts.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <Package className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <div>Nessun prodotto trovato</div>
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="categories" className="flex-1 overflow-hidden m-0 flex flex-col">
          <div className="px-6 pt-4 pb-2 flex justify-end shrink-0">
            <Button size="sm" className="gap-1" onClick={() => setCatDialog({ open: true })}>
              <Plus className="h-4 w-4" /> Aggiungi
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="px-6 pb-6 space-y-2">
              {categories.map((c) => (
                <div key={c.id} className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border">
                  <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                  <div className="flex-1">
                    <div className="font-medium text-foreground">{c.name}</div>
                    <div className="text-xs text-muted-foreground">Ordine: {c.sortOrder}</div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCatDialog({ open: true, item: c })}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDeleteCat(c.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      <Dialog open={catDialog.open} onOpenChange={(o) => !o && setCatDialog({ open: false })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{catDialog.item ? "Modifica Categoria" : "Nuova Categoria"}</DialogTitle>
          </DialogHeader>
          <CategoryForm
            initial={catDialog.item}
            onSave={handleSaveCategory}
            onClose={() => setCatDialog({ open: false })}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={prodDialog.open} onOpenChange={(o) => !o && setProdDialog({ open: false })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{prodDialog.item ? "Modifica Prodotto" : "Nuovo Prodotto"}</DialogTitle>
          </DialogHeader>
          <ProductForm
            initial={prodDialog.item}
            categories={categories}
            onSave={handleSaveProduct}
            onClose={() => setProdDialog({ open: false })}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
