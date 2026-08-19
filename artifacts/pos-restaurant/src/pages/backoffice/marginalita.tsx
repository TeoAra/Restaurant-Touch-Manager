import { type FormEvent, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BadgeEuro, ChartNoAxesCombined, CirclePlus, Factory, PackagePlus, RefreshCw, ReceiptText, Settings2, TrendingDown, TrendingUp, Utensils } from "lucide-react";
import { BackofficeShell } from "@/components/BackofficeShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useGetKitchenAnalytics, useListCategories, useListProducts } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

const API = (import.meta.env.BASE_URL || "/") + "api/marginality";
const today = new Date().toISOString().slice(0, 10);

type ProductMargin = {
  productId: number;
  productName: string;
  quantity: number;
  grossRevenue: string;
  contribution: string;
  contributionPercent: string;
};
type Overview = {
  orderCount: number;
  incompleteOrders: number;
  totals: Record<string, string>;
  mostProfitableProducts: ProductMargin[];
  lossMakingProducts: ProductMargin[];
  incomplete: Array<{ orderId: number; calculatedAt?: string; missingData: string[] }>;
};
type Ingredient = { id: number; name: string; baseUnit: string; currentUnitCost: string; vatRate: string; active: boolean };
type RecipeProduct = { id: number; name: string; price: string; categoryId?: number | null; sortOrder: number };
type RecipeCategory = { id: number; name: string; sortOrder: number };
type RecipeProductGroup = { id: number | null; name: string; products: RecipeProduct[] };
type Catalog = {
  ingredients: Ingredient[];
  categories: RecipeCategory[];
  products: RecipeProduct[];
  recipes: Array<{ id: number; productId: number; yieldQuantity: string; preparationMinutes: number; validFrom: string; version: number }>;
  recipeItems: Array<{ recipeId: number; ingredientId: number; quantity: string; wastePercentage: string }>;
  configurations: Array<{ id: number; validFrom: string; electricityCostPerKwh: string; fixedCostsMonthly: string; productiveHoursMonthly: string; ownerHourlyCost: string }>;
  utilityTypes: Array<{ id: number; code: string; name: string; measurementUnit: string; active: boolean }>;
  utilityBills: Array<{ id: number; utilityTypeId: number; periodStart: string; periodEnd: string; totalCost: string; consumptionQuantity: string }>;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Operazione non riuscita");
  return data as T;
}

function euro(value?: string): string {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(value ?? 0));
}

function Card({ label, value, detail, tone = "primary" }: { label: string; value: string; detail: string; tone?: "primary" | "good" | "bad" }) {
  const color = tone === "good" ? "text-emerald-700 bg-emerald-50 border-emerald-100" : tone === "bad" ? "text-red-700 bg-red-50 border-red-100" : "text-primary bg-orange-50 border-orange-100";
  return (
    <div className={`rounded-2xl border p-4 ${color}`}>
      <div className="text-[11px] uppercase tracking-wide font-bold opacity-70">{label}</div>
      <div className="text-2xl font-black mt-1">{value}</div>
      <div className="text-xs mt-1 opacity-75">{detail}</div>
    </div>
  );
}

function SimpleInput({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label className="block text-xs font-semibold text-slate-600">{label}<input {...props} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary" /></label>;
}

function SubmitButton({ children }: { children: React.ReactNode }) {
  return <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90"><CirclePlus className="h-4 w-4" />{children}</button>;
}

function groupMenuProducts(products: RecipeProduct[], categories: RecipeCategory[]): RecipeProductGroup[] {
  const productsByCategory = new Map<number, RecipeProduct[]>();
  const uncategorized: RecipeProduct[] = [];

  for (const product of products) {
    if (product.categoryId == null) {
      uncategorized.push(product);
      continue;
    }
    productsByCategory.set(product.categoryId, [...(productsByCategory.get(product.categoryId) ?? []), product]);
  }

  const sortProducts = (rows: RecipeProduct[]) => [...rows].sort(
    (left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "it"),
  );
  const groups: RecipeProductGroup[] = [...categories]
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "it"))
    .map(category => ({ id: category.id, name: category.name, products: sortProducts(productsByCategory.get(category.id) ?? []) }))
    .filter(group => group.products.length > 0);

  if (uncategorized.length) groups.push({ id: null, name: "Senza categoria", products: sortProducts(uncategorized) });
  return groups;
}

export default function MarginalitaPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [from, setFrom] = useState(() => today.slice(0, 8) + "01");
  const [to, setTo] = useState(today);
  const [recalculateOrderId, setRecalculateOrderId] = useState("");
  const overview = useQuery<Overview>({
    queryKey: ["marginality-overview", from, to],
    queryFn: () => request<Overview>(`/overview?from=${from}&to=${to}`),
  });
  const catalog = useQuery<Catalog>({
    queryKey: ["marginality-catalog"],
    queryFn: () => request<Catalog>("/catalog"),
  });
  // Recipes must use the same menu hierarchy maintained in Backoffice → Menu,
  // not a copied product list maintained separately for marginality.
  const { data: menuCategories = [] } = useListCategories();
  const { data: menuProducts = [] } = useListProducts();

  const { data: kitchenAnalytics } = useGetKitchenAnalytics({ from, to });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["marginality-overview"] }),
      queryClient.invalidateQueries({ queryKey: ["marginality-catalog"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/kitchen/analytics"] }),
    ]);
  };
  const submit = async (path: string, body: unknown, success: string) => {
    try {
      await request(path, { method: "POST", body: JSON.stringify(body) });
      toast({ title: success });
      await refresh();
      return true;
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : "Errore salvataggio", variant: "destructive" });
      return false;
    }
  };
  const totals = overview.data?.totals ?? {};
  const contribution = Number(totals.contributionMargin ?? 0);
  const management = Number(totals.managementResult ?? 0);
  const recipesByProduct = useMemo(() => {
    const latestByProduct = new Map<number, Catalog["recipes"][number]>();
    for (const recipe of catalog.data?.recipes ?? []) {
      if (!latestByProduct.has(recipe.productId)) latestByProduct.set(recipe.productId, recipe);
    }
    return latestByProduct;
  }, [catalog.data?.recipes]);
  const recipeProductGroups = useMemo(
    () => groupMenuProducts(menuProducts, menuCategories),
    [menuProducts, menuCategories],
  );

  return (
    <BackofficeShell
      title="Marginalità"
      subtitle="Ricavi, costi e risultato gestionale per comanda"
      fixedHeight
      actions={<button onClick={() => void refresh()} className="h-9 w-9 rounded-lg border-2 border-slate-200 grid place-items-center hover:border-primary" title="Aggiorna"><RefreshCw className="h-4 w-4" /></button>}
    >
      <div className="h-full overflow-y-auto p-4 md:p-6">
        <Tabs defaultValue="overview" className="max-w-6xl mx-auto">
          <TabsList className="w-full justify-start overflow-x-auto h-auto gap-1 p-1">
            <TabsTrigger value="overview">Analisi</TabsTrigger>
            <TabsTrigger value="production">Produzione</TabsTrigger>
            <TabsTrigger value="ingredients">Ingredienti</TabsTrigger>
            <TabsTrigger value="recipes">Ricette</TabsTrigger>
            <TabsTrigger value="costs">Costi</TabsTrigger>
            <TabsTrigger value="utilities">Utenze</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-5">
            <section className="flex flex-wrap gap-3 items-end rounded-xl border border-slate-200 bg-white p-4">
              <SimpleInput label="Dal" type="date" value={from} onChange={event => setFrom(event.target.value)} />
              <SimpleInput label="Al" type="date" value={to} onChange={event => setTo(event.target.value)} />
              <div className="text-xs text-slate-500 pb-2">I calcoli usano le comande pagate nel periodo e lo storico dei costi.</div>
            </section>
            {overview.isLoading ? <div className="text-center py-16 text-slate-400">Caricamento marginalità…</div> : (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Card label="Ricavi lordi" value={euro(totals.grossRevenue)} detail={`${overview.data?.orderCount ?? 0} comande calcolate`} />
                  <Card label="Margine contribuzione" value={euro(totals.contributionMargin)} detail="Imponibile meno costi variabili e commissioni" tone={contribution >= 0 ? "good" : "bad"} />
                  <Card label="Risultato gestionale" value={euro(totals.managementResult)} detail="Dopo lavoro, indiretti e costi fissi allocati" tone={management >= 0 ? "good" : "bad"} />
                  <Card label="Costo ingredienti" value={euro(totals.ingredientCost)} detail={`Packaging ${euro(totals.packagingCost)} · Commissioni ${euro(totals.paymentFee)}`} />
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                  <div className="flex gap-2 font-bold text-slate-800"><ChartNoAxesCombined className="h-4 w-4 text-primary" /> Come leggere il risultato</div>
                  <p className="mt-2">Margine di contribuzione = ricavi netti IVA − ingredienti − packaging − olio/energia − commissioni. Il risultato gestionale sottrae anche manodopera, costi indiretti e quota costi fissi.</p>
                </div>
                <div className="grid gap-5 lg:grid-cols-2">
                  <ProductList title="Più redditizi" icon={<TrendingUp className="h-4 w-4 text-emerald-600" />} rows={overview.data?.mostProfitableProducts ?? []} empty="Aggiungi ricette e completa i primi calcoli per vedere i prodotti migliori." />
                  <ProductList title="In perdita" icon={<TrendingDown className="h-4 w-4 text-red-600" />} rows={overview.data?.lossMakingProducts ?? []} empty="Nessun prodotto in perdita nel periodo calcolato." danger />
                </div>
                <section className="grid gap-5 lg:grid-cols-[1.3fr_.7fr]">
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <h3 className="flex items-center gap-2 font-bold text-amber-900"><AlertTriangle className="h-4 w-4" /> Comande con dati incompleti ({overview.data?.incompleteOrders ?? 0})</h3>
                    <div className="mt-3 space-y-2">
                      {(overview.data?.incomplete ?? []).length === 0 ? <p className="text-sm text-amber-800">Tutte le comande calcolate hanno dati completi.</p> : overview.data?.incomplete.slice(0, 8).map(row => (
                        <div key={row.orderId} className="rounded-lg bg-white/70 px-3 py-2 text-sm"><b>Comanda #{row.orderId}</b><span className="ml-2 text-amber-800">{row.missingData.join(" · ")}</span></div>
                      ))}
                    </div>
                  </div>
                  <form onSubmit={async event => {
                    event.preventDefault();
                    const id = Number(recalculateOrderId);
                    if (!Number.isInteger(id) || id <= 0) {
                      toast({ title: "Inserisci un numero comanda valido", variant: "destructive" });
                      return;
                    }
                    if (await submit(`/orders/${id}/recalculate`, undefined, "Ricalcolo messo in coda")) setRecalculateOrderId("");
                  }} className="rounded-xl border border-slate-200 bg-white p-4">
                    <h3 className="flex items-center gap-2 font-bold text-slate-800"><RefreshCw className="h-4 w-4 text-primary" /> Ricalcolo storico</h3>
                    <p className="mt-2 text-xs text-slate-500">Crea una nuova versione immutabile usando i costi configurati oggi; non modifica gli snapshot precedenti.</p>
                    <div className="mt-3 flex gap-2"><input value={recalculateOrderId} onChange={event => setRecalculateOrderId(event.target.value)} placeholder="N. comanda" inputMode="numeric" className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-sm" /><SubmitButton>Ricalcola</SubmitButton></div>
                  </form>
                </section>
              </>
            )}
          </TabsContent>

          <TabsContent value="production" className="space-y-5">
            <section className="flex flex-wrap gap-3 items-end rounded-xl border border-slate-200 bg-white p-4">
              <SimpleInput label="Dal" type="date" value={from} onChange={event => setFrom(event.target.value)} />
              <SimpleInput label="Al" type="date" value={to} onChange={event => setTo(event.target.value)} />
              <div className="text-xs text-slate-500 pb-2">Analisi delle tempistiche di preparazione completate nel periodo.</div>
            </section>

            {!kitchenAnalytics ? (
              <div className="text-center py-16 text-slate-400">Caricamento dati di produzione...</div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Card
                    label="Carico attuale"
                    value={kitchenAnalytics.currentLoad.toString()}
                    detail="Articoli inviati o in preparazione adesso"
                  />
                  <Card
                    label="Tempo medio reale"
                    value={kitchenAnalytics.averageActualPrepMinutes != null ? `${kitchenAnalytics.averageActualPrepMinutes.toFixed(1)} min` : "N/D"}
                    detail="Dall'avvio della preparazione allo stato pronto"
                  />
                  <Card
                    label="Scostamento vs atteso"
                    value={kitchenAnalytics.expectedVsActualVarianceMinutes != null ? `${kitchenAnalytics.expectedVsActualVarianceMinutes > 0 ? '+' : ''}${kitchenAnalytics.expectedVsActualVarianceMinutes.toFixed(1)} min` : "N/D"}
                    detail="Differenza media rispetto ai tempi ricetta"
                    tone={kitchenAnalytics.expectedVsActualVarianceMinutes != null && kitchenAnalytics.expectedVsActualVarianceMinutes > 0 ? "bad" : "good"}
                  />
                  <Card
                    label="Articoli in ritardo"
                    value={kitchenAnalytics.delayedCount.toString()}
                    detail="Articoli attivi oltre il tempo ricetta"
                    tone={kitchenAnalytics.delayedCount > 0 ? "bad" : "primary"}
                  />
                </div>

                <div className="grid gap-5 lg:grid-cols-2">
                  <section className="rounded-xl border border-slate-200 bg-white p-4">
                    <h3 className="flex items-center gap-2 font-bold text-slate-800">Prestazioni per Categoria</h3>
                    <div className="mt-4 space-y-3">
                      {kitchenAnalytics.categorySummaries.length === 0 ? (
                        <p className="py-4 text-sm text-slate-400">Nessun dato disponibile nel periodo.</p>
                      ) : (
                        kitchenAnalytics.categorySummaries.map(cat => (
                          <div key={cat.categoryId} className="flex items-center justify-between border-b border-slate-100 pb-2 text-sm last:border-0">
                            <div>
                              <b>{cat.categoryName}</b>
                              <div className="text-xs text-slate-500">{cat.deliveredCount} completati su {cat.totalCount}</div>
                            </div>
                            <div className="font-bold text-right">
                              {cat.avgActualPrepMinutes ? `${cat.avgActualPrepMinutes.toFixed(1)} min` : "N/D"}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </section>

                  <section className="rounded-xl border border-slate-200 bg-white p-4">
                    <h3 className="flex items-center gap-2 font-bold text-slate-800">Dettaglio Prodotti (Top 10 Lenti)</h3>
                    <div className="mt-4 space-y-3">
                      {kitchenAnalytics.productSummaries.length === 0 ? (
                        <p className="py-4 text-sm text-slate-400">Nessun dato disponibile nel periodo.</p>
                      ) : (
                        [...kitchenAnalytics.productSummaries]
                          .sort((a, b) => (b.avgActualPrepMinutes || 0) - (a.avgActualPrepMinutes || 0))
                          .slice(0, 10)
                          .map(prod => {
                            const isSlow = prod.avgActualPrepMinutes && prod.expectedPrepMinutes && prod.avgActualPrepMinutes > prod.expectedPrepMinutes;
                            return (
                              <div key={prod.productId} className="flex items-center justify-between border-b border-slate-100 pb-2 text-sm last:border-0">
                                <div>
                                  <b>{prod.productName}</b>
                                  <div className="text-xs text-slate-500">{prod.categoryName || "Senza categoria"} • {prod.deliveredCount} completati</div>
                                </div>
                                <div className="text-right flex flex-col items-end">
                                  <span className={cn("font-bold", isSlow ? "text-red-600" : "text-emerald-700")}>
                                    {prod.avgActualPrepMinutes != null ? `${prod.avgActualPrepMinutes.toFixed(1)} min` : "N/D"}
                                  </span>
                                  <span className="text-[10px] text-slate-400">Atteso: {prod.expectedPrepMinutes != null ? `${prod.expectedPrepMinutes} min` : "N/D"}</span>
                                </div>
                              </div>
                            );
                          })
                      )}
                    </div>
                  </section>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="ingredients" className="grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
            <form onSubmit={async event => {
              event.preventDefault(); const form = new FormData(event.currentTarget);
              if (await submit("/ingredients", Object.fromEntries(form), "Ingrediente salvato")) event.currentTarget.reset();
            }} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
              <h2 className="flex items-center gap-2 font-bold"><PackagePlus className="h-4 w-4 text-primary" /> Nuovo ingrediente</h2>
              <SimpleInput label="Nome" name="name" required placeholder="es. Mozzarella fior di latte" />
              <div className="grid grid-cols-2 gap-3"><SimpleInput label="Unità base" name="baseUnit" required placeholder="kg, l, pz" /><SimpleInput label="Costo per unità (€)" name="currentUnitCost" inputMode="decimal" required placeholder="0.000000" /></div>
              <SimpleInput label="IVA acquisto %" name="vatRate" inputMode="decimal" defaultValue="0" />
              <SubmitButton>Salva ingrediente</SubmitButton>
            </form>
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="font-bold">Ingredienti attivi</h2>
              <div className="mt-3 divide-y divide-slate-100">{(catalog.data?.ingredients ?? []).map(item => <div key={item.id} className="flex justify-between gap-4 py-2 text-sm"><span>{item.name}<small className="ml-2 text-slate-400">/{item.baseUnit}</small></span><b>{euro(item.currentUnitCost)}</b></div>) || <span />}</div>
              {!catalog.data?.ingredients.length && <p className="mt-4 text-sm text-slate-400">Nessun ingrediente inserito.</p>}
            </section>
          </TabsContent>

          <TabsContent value="recipes" className="grid gap-5 lg:grid-cols-[.9fr_1.1fr]">
            <RecipeForm productGroups={recipeProductGroups} ingredients={catalog.data?.ingredients ?? []} onSave={async data => submit("/recipes", data, "Ricetta salvata")} />
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="flex items-center gap-2 font-bold"><Utensils className="h-4 w-4 text-primary" /> Copertura del menu</h2>
              <p className="mt-1 text-xs text-slate-500">Elenco aggiornato direttamente dal Menu, raggruppato con lo stesso ordine delle categorie.</p>
              <div className="mt-3 space-y-4">{recipeProductGroups.length === 0 ? <p className="py-4 text-sm text-slate-400">Nessun prodotto disponibile nel Menu.</p> : recipeProductGroups.map(group => (
                <div key={group.id ?? "uncategorized"}>
                  <h3 className="border-b border-slate-100 pb-1 text-xs font-bold uppercase tracking-wide text-slate-500">{group.name}</h3>
                  <div className="mt-2 space-y-2">{group.products.map(product => {
                    const recipe = recipesByProduct.get(product.id);
                    return <div key={product.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2 text-sm"><span>{product.name}</span>{recipe ? <span className="shrink-0 text-emerald-700 font-semibold">Ricetta v{recipe.version} · {recipe.preparationMinutes} min</span> : <span className="shrink-0 text-amber-600">Ricetta mancante</span>}</div>;
                  })}</div>
                </div>
              ))}</div>
            </section>
          </TabsContent>

          <TabsContent value="costs">
            <form onSubmit={async event => {
              event.preventDefault(); const form = new FormData(event.currentTarget);
              if (await submit("/configurations", Object.fromEntries(form), "Configurazione costi salvata")) event.currentTarget.reset();
            }} className="rounded-xl border border-slate-200 bg-white p-4 max-w-3xl">
              <h2 className="flex items-center gap-2 font-bold"><Settings2 className="h-4 w-4 text-primary" /> Configurazione costi</h2>
              <p className="mt-1 text-xs text-slate-500">Valori validi dalla data indicata: i nuovi calcoli conserveranno la configurazione usata nello snapshot.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <SimpleInput label="Valida dal" name="validFrom" type="date" defaultValue={today} required />
                <SimpleInput label="Energia €/kWh" name="electricityCostPerKwh" defaultValue="0.30" inputMode="decimal" required />
                <SimpleInput label="Costi fissi mensili (€)" name="fixedCostsMonthly" defaultValue="0" inputMode="decimal" required />
                <SimpleInput label="Ore produttive mensili" name="productiveHoursMonthly" defaultValue="160" inputMode="decimal" required />
                <SimpleInput label="Costo orario manodopera (€)" name="ownerHourlyCost" defaultValue="0" inputMode="decimal" required />
                <SimpleInput label="Riserva imposte %" name="taxReservePercentage" defaultValue="0" inputMode="decimal" />
                <SimpleInput label="Commissione carta %" name="cardFeePercentage" defaultValue="0" inputMode="decimal" />
                <SimpleInput label="Commissione contanti %" name="cashFeePercentage" defaultValue="0" inputMode="decimal" />
                <SimpleInput label="Commissione ticket %" name="ticketFeePercentage" defaultValue="0" inputMode="decimal" />
                <SimpleInput label="Commissione altri %" name="otherFeePercentage" defaultValue="0" inputMode="decimal" />
                <SimpleInput label="Commissione fissa/transazione (€)" name="paymentFixedFee" defaultValue="0" inputMode="decimal" />
              </div>
              <div className="mt-4"><SubmitButton>Salva configurazione</SubmitButton></div>
            </form>
          </TabsContent>

          <TabsContent value="utilities" className="grid gap-5 lg:grid-cols-2">
            <section className="space-y-5">
              <form onSubmit={async event => {
                event.preventDefault(); const form = new FormData(event.currentTarget);
                if (await submit("/utility-types", Object.fromEntries(form), "Tipo utenza salvato")) event.currentTarget.reset();
              }} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                <h2 className="flex items-center gap-2 font-bold"><Factory className="h-4 w-4 text-primary" /> Tipo utenza</h2>
                <div className="grid grid-cols-3 gap-3"><SimpleInput label="Codice" name="code" required placeholder="energia" /><SimpleInput label="Nome" name="name" required placeholder="Energia elettrica" /><SimpleInput label="Unità" name="measurementUnit" required placeholder="kWh" /></div>
                <SubmitButton>Aggiungi utenza</SubmitButton>
              </form>
              <div className="rounded-xl border border-slate-200 bg-white p-4"><h2 className="font-bold">Utenze configurate</h2><div className="mt-3 space-y-2">{(catalog.data?.utilityTypes ?? []).map(item => <div key={item.id} className="flex justify-between text-sm"><span>{item.name}</span><span className="text-slate-400">{item.measurementUnit}</span></div>)}</div></div>
            </section>
            <form onSubmit={async event => {
              event.preventDefault(); const form = new FormData(event.currentTarget);
              if (await submit("/utility-bills", Object.fromEntries(form), "Bolletta registrata")) event.currentTarget.reset();
            }} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
              <h2 className="flex items-center gap-2 font-bold"><ReceiptText className="h-4 w-4 text-primary" /> Registra bolletta</h2>
              <label className="block text-xs font-semibold text-slate-600">Utenza<select required name="utilityTypeId" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><option value="">Seleziona…</option>{(catalog.data?.utilityTypes ?? []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <div className="grid grid-cols-2 gap-3"><SimpleInput label="Dal" name="periodStart" type="date" required /><SimpleInput label="Al" name="periodEnd" type="date" required /></div>
              <div className="grid grid-cols-2 gap-3"><SimpleInput label="Consumo" name="consumptionQuantity" inputMode="decimal" required /><SimpleInput label="Costo variabile (€)" name="variableCost" inputMode="decimal" required /></div>
              <div className="grid grid-cols-2 gap-3"><SimpleInput label="Costo fisso (€)" name="fixedCost" defaultValue="0" inputMode="decimal" required /><SimpleInput label="Tasse/oneri (€)" name="taxesAndFees" defaultValue="0" inputMode="decimal" /></div>
              <SimpleInput label="Totale bolletta (€)" name="totalCost" inputMode="decimal" required />
              <SubmitButton>Registra bolletta</SubmitButton>
            </form>
          </TabsContent>
        </Tabs>
      </div>
    </BackofficeShell>
  );
}

function ProductList({ title, icon, rows, empty, danger = false }: { title: string; icon: React.ReactNode; rows: ProductMargin[]; empty: string; danger?: boolean }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="flex items-center gap-2 font-bold text-slate-800">{icon}{title}</h3><div className="mt-3 space-y-2">{rows.length === 0 ? <p className="py-4 text-sm text-slate-400">{empty}</p> : rows.map(row => <div key={row.productId} className="flex items-center justify-between border-b border-slate-100 pb-2 text-sm last:border-0"><div><b>{row.productName}</b><span className="ml-2 text-xs text-slate-400">{row.quantity} pz · {euro(row.grossRevenue)} ricavi</span></div><div className={danger || Number(row.contribution) < 0 ? "font-bold text-red-600" : "font-bold text-emerald-700"}>{euro(row.contribution)} <small>({row.contributionPercent}%)</small></div></div>)}</div></section>;
}

function RecipeForm({ productGroups, ingredients, onSave }: { productGroups: RecipeProductGroup[]; ingredients: Ingredient[]; onSave: (data: unknown) => Promise<boolean> }) {
  const [items, setItems] = useState<Array<{ ingredientId: string; quantity: string; wastePercentage: string }>>([{ ingredientId: "", quantity: "", wastePercentage: "0" }]);
  return <form onSubmit={async event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const saved = await onSave({ ...Object.fromEntries(form), preparationMinutes: Number(form.get("preparationMinutes")), items: items.map(item => ({ ...item, ingredientId: Number(item.ingredientId) })) });
    if (saved) { event.currentTarget.reset(); setItems([{ ingredientId: "", quantity: "", wastePercentage: "0" }]); }
  }} className="rounded-xl border border-slate-200 bg-white p-4">
    <h2 className="flex items-center gap-2 font-bold"><Utensils className="h-4 w-4 text-primary" /> Nuova ricetta</h2>
    <p className="mt-1 text-xs text-slate-500">Scegli un prodotto dal Menu: gli ingredienti inseriti qui diventano anche le variazioni automatiche “Senza …” in cassa.</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="block text-xs font-semibold text-slate-600">Prodotto del Menu<select required name="productId" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><option value="">Seleziona…</option>{productGroups.map(group => <optgroup key={group.id ?? "uncategorized"} label={group.name}>{group.products.map(product => <option value={product.id} key={product.id}>{product.name}</option>)}</optgroup>)}</select></label>
      <SimpleInput label="Valida dal" name="validFrom" type="date" defaultValue={today} required />
      <SimpleInput label="Porzioni prodotte" name="yieldQuantity" defaultValue="1" inputMode="decimal" required />
      <SimpleInput label="Minuti preparazione/porzione" name="preparationMinutes" defaultValue="0" inputMode="numeric" required />
      <SimpleInput label="Packaging/porzione (€)" name="packagingCostPerUnit" defaultValue="0" inputMode="decimal" />
    </div>
    <div className="mt-4"><div className="text-xs font-bold uppercase tracking-wide text-slate-500">Ingredienti e variazioni</div><p className="mt-1 text-xs text-slate-500">Ogni ingrediente selezionato sarà proposto alla cassa come “Senza nome ingrediente”.</p>{items.map((item, index) => <div key={index} className="mt-2 grid grid-cols-[1fr_.5fr_.45fr_auto] gap-2"><select value={item.ingredientId} onChange={event => setItems(current => current.map((row, i) => i === index ? { ...row, ingredientId: event.target.value } : row))} required className="rounded-lg border border-slate-200 bg-white px-2 text-sm"><option value="">Ingrediente / variazione…</option>{ingredients.map(ingredient => <option value={ingredient.id} key={ingredient.id}>{ingredient.name} — Senza {ingredient.name}</option>)}</select><input value={item.quantity} onChange={event => setItems(current => current.map((row, i) => i === index ? { ...row, quantity: event.target.value } : row))} placeholder="Q.tà" required className="rounded-lg border border-slate-200 px-2 text-sm" /><input value={item.wastePercentage} onChange={event => setItems(current => current.map((row, i) => i === index ? { ...row, wastePercentage: event.target.value } : row))} placeholder="Scarto %" className="rounded-lg border border-slate-200 px-2 text-sm" /><button type="button" onClick={() => setItems(current => current.length > 1 ? current.filter((_, i) => i !== index) : current)} className="text-xs text-red-500">Rimuovi</button></div>)}
      <button type="button" onClick={() => setItems(current => [...current, { ingredientId: "", quantity: "", wastePercentage: "0" }])} className="mt-2 text-xs font-semibold text-primary">+ Aggiungi ingrediente</button></div>
    <div className="mt-4"><SubmitButton>Salva ricetta</SubmitButton></div>
  </form>;
}