import { type FormEvent, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BadgeEuro, ChartNoAxesCombined, CirclePlus, Factory, PackagePlus, RefreshCw, ReceiptText, Settings2, TrendingDown, TrendingUp, Utensils, Beer, Link2, GlassWater } from "lucide-react";
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
  recommendations: Array<{ tone: "critical" | "attention" | "opportunity"; title: string; explanation: string; action: string }>;
};
type Ingredient = { id: number; name: string; baseUnit: string; currentUnitCost: string; vatRate: string; unitSizeG?: string | null; sliceWeightG?: string | null; active: boolean };
type RecipeProduct = { id: number; name: string; price: string; categoryId?: number | null; sortOrder: number };
type RecipeCategory = { id: number; name: string; sortOrder: number };
type RecipeProductGroup = { id: number | null; name: string; products: RecipeProduct[] };
type MenuVariation = { id: number; productId: number; name: string; options: string | Array<{ name: string; priceExtra?: string }>; required: boolean; sortOrder: number };
type Catalog = {
  ingredients: Ingredient[];
  categories: RecipeCategory[];
  products: RecipeProduct[];
  productVariations: MenuVariation[];
  recipes: Array<{ id: number; productId: number; validFrom: string; version: number }>;
  recipeItems: Array<{ recipeId: number; ingredientId: number; quantity: string; wastePercentage: string }>;
  configurations: Array<{ id: number; validFrom: string; electricityCostPerKwh: string; fixedCostsMonthly: string; rentMonthly: string; taxRegisterAnnual: string; chamberFeeAnnual: string; coverCostPerCover: string; ownerHourlyCost: string }>;
  coverCostItems: Array<{ id: number; name: string; purchaseQuantity: string; purchaseUnit: string; purchasePrice: string; quantityPerCover: string; applicationScope: "cover" | "fried_order"; active: boolean }>;
  utilityTypes: Array<{ id: number; code: string; name: string; measurementUnit: string; active: boolean }>;
  utilityBills: Array<{ id: number; utilityTypeId: number; periodStart: string; periodEnd: string; consumptionQuantity: string; variableCost: string; fixedCost: string; taxesAndFees: string; totalCost: string; variableUnitCost: string | null; totalUnitCost: string | null }>;
  beverageLines?: Array<{ id: number; name: string; lineType: 'beer'|'bib'; purchasePriceNet: string; vatRate: string; sourceVolumeLiters: string; lossPercentage: string; dilutionWaterRatio: string; co2CostPerLiter: string; coolerKwhPerLiter: string; cellarKwhPerLiter: string; active: boolean; currentSupplyValidFrom: string | null }>;
  beverageLineSupplyHistory?: Array<{ id: number; beverageLineId: number; purchasePriceNet: string; sourceVolumeLiters: string; validFrom: string }>;
  beverageProductMappings?: Array<{ id: number; productId: number; beverageLineId: number; servingVolumeLiters: string }>;
  beverageCostPreviews?: Array<{ beverageLineId: number; costPerLiter: string; sourceCostPerLiter: string; waterCostPerLiter: string; co2CostPerLiter: string; energyCostPerLiter: string; missingData: string[] }>;
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

function euro(value?: string | number): string {
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

// Costo per grammo e per fetta calcolati dal prezzo d'acquisto:
// currentUnitCost è il prezzo dell'unità (es. €/kg), unitSizeG il peso di
// quell'unità in grammi, sliceWeightG il peso di una fetta.
function ingredientCostDetail(item: Ingredient): string | null {
  const unitSize = Number(item.unitSizeG ?? 0);
  if (!(unitSize > 0)) return null;
  const costPerGram = Number(item.currentUnitCost) / unitSize;
  const sliceWeight = Number(item.sliceWeightG ?? 0);
  if (sliceWeight > 0) {
    const costPerSlice = costPerGram * sliceWeight;
    return `${costPerSlice.toLocaleString("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 3 })}/fetta (${sliceWeight} g)`;
  }
  return `${(costPerGram * 100).toLocaleString("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 3 })}/hg`;
}

// Unità di misura contestuale per la quantità in ricetta.
function ingredientQuantityUnit(item: Ingredient | undefined): string {
  if (!item) return "Q.tà";
  if (Number(item.sliceWeightG ?? 0) > 0) return "fette";
  if (Number(item.unitSizeG ?? 0) > 0) return "g";
  return item.baseUnit;
}

function coverCostDetail(item: Catalog["coverCostItems"][number]): { unitCost: number; coverCost: number } {
  const unitCost = Number(item.purchasePrice) / Number(item.purchaseQuantity);
  return { unitCost, coverCost: unitCost * Number(item.quantityPerCover) };
}

function variationOptions(value: MenuVariation["options"]): Array<{ name: string; priceExtra?: string }> {
  if (Array.isArray(value)) return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((option): option is { name: string; priceExtra?: string } => typeof option === "object" && option !== null && typeof (option as { name?: unknown }).name === "string")
      : [];
  } catch {
    return [];
  }
}

function BeverageLineForm({ onSubmit }: { onSubmit: (data: Record<string, unknown>) => Promise<boolean> }) {
  const [lineType, setLineType] = useState<"beer" | "bib">("beer");

  return (
    <form onSubmit={async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const data: Record<string, unknown> = Object.fromEntries(form);
      data.active = form.get("active") === "on";
      if (await onSubmit(data)) {
        event.currentTarget.reset();
        setLineType("beer");
      }
    }} className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
      <h2 className="flex items-center gap-2 font-bold"><Beer className="h-4 w-4 text-primary" /> Nuova linea bevande</h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <SimpleInput label="Nome linea (es. Bionda Spina)" name="name" required />
        <label className="block text-xs font-semibold text-slate-600">
          Tipo impianto
          <select
            name="lineType"
            value={lineType}
            onChange={event => setLineType(event.target.value as "beer" | "bib")}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary"
          >
            <option value="beer">Fusto birra</option>
            <option value="bib">Bag in Box (Post-mix)</option>
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SimpleInput label="Prezzo acquisto netto (€)" name="purchasePriceNet" inputMode="decimal" required placeholder="0.00" />
        <SimpleInput label="IVA acquisto (%)" name="vatRate" inputMode="decimal" defaultValue="22" required />
        <SimpleInput label={`Volume ${lineType === "beer" ? "fusto" : "sacca"} (litri)`} name="sourceVolumeLiters" inputMode="decimal" required placeholder={lineType === "beer" ? "30" : "10"} />
        <SimpleInput label="Perdita stimata (Spreco %)" name="lossPercentage" inputMode="decimal" defaultValue="3" required />
      </div>
      <SimpleInput label="Prezzo e volume validi dal" name="validFrom" type="date" defaultValue={today} required />

      {lineType === "bib" && (
        <div className="grid gap-3 sm:grid-cols-1">
          <SimpleInput label="Rapporto diluizione acqua (L per 1 L di sciroppo)" name="dilutionWaterRatio" inputMode="decimal" defaultValue="5.4" required />
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <SimpleInput label="Costo CO2 (€/L erogato)" name="co2CostPerLiter" inputMode="decimal" defaultValue="0" />
        <SimpleInput label="Consumo Cooler (kWh/L)" name="coolerKwhPerLiter" inputMode="decimal" defaultValue="0" />
        <SimpleInput label="Consumo Cella (kWh/L)" name="cellarKwhPerLiter" inputMode="decimal" defaultValue="0" />
      </div>

      <label className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer pt-2">
        <input type="checkbox" name="active" defaultChecked className="rounded border-slate-300 text-primary focus:ring-primary h-4 w-4" />
        Linea attiva
      </label>

      <SubmitButton>Salva linea</SubmitButton>
    </form>
  );
}

function BeverageSupplyUpdateForm({ line, onSubmit }: {
  line: NonNullable<Catalog["beverageLines"]>[number];
  onSubmit: (data: Record<string, unknown>) => Promise<boolean>;
}) {
  return (
    <form
      key={`${line.id}-${line.purchasePriceNet}-${line.sourceVolumeLiters}-${line.currentSupplyValidFrom ?? "legacy"}`}
      onSubmit={async event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        if (await onSubmit(Object.fromEntries(form))) event.currentTarget.reset();
      }}
      className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3"
    >
      <div className="mb-2 text-xs font-bold text-slate-800">Registra nuova fornitura</div>
      <p className="mb-3 text-xs text-slate-600">Prezzo e volume restano tracciati dalla data indicata; le marginalità già calcolate non cambiano.</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <SimpleInput label="Prezzo netto (€)" name="purchasePriceNet" inputMode="decimal" defaultValue={line.purchasePriceNet} required />
        <SimpleInput label={`Volume ${line.lineType === "beer" ? "fusto" : "sacca"} (L)`} name="sourceVolumeLiters" inputMode="decimal" defaultValue={line.sourceVolumeLiters} required />
        <SimpleInput label="Valida dal" name="validFrom" type="date" defaultValue={today} required />
      </div>
      <button type="submit" className="mt-3 min-h-10 rounded-lg bg-primary px-3 text-xs font-bold text-white hover:bg-primary/90">Salva fornitura</button>
    </form>
  );
}

function BeverageLineSettingsForm({ line, onSubmit }: {
  line: NonNullable<Catalog["beverageLines"]>[number];
  onSubmit: (data: Record<string, unknown>) => Promise<boolean>;
}) {
  return (
    <form
      key={`${line.id}-${line.name}-${line.lineType}-${line.vatRate}-${line.lossPercentage}-${line.dilutionWaterRatio}-${line.co2CostPerLiter}-${line.coolerKwhPerLiter}-${line.cellarKwhPerLiter}`}
      onSubmit={async event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        if (await onSubmit(Object.fromEntries(form))) event.currentTarget.reset();
      }}
      className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3"
    >
      <div className="mb-2 text-xs font-bold text-slate-800">Modifica parametri linea</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <SimpleInput label="Nome linea" name="name" defaultValue={line.name} required />
        <label className="block text-xs font-semibold text-slate-600">
          Tipo impianto
          <select name="lineType" defaultValue={line.lineType} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary">
            <option value="beer">Fusto birra</option>
            <option value="bib">Bag in Box (Post-mix)</option>
          </select>
        </label>
        <SimpleInput label="IVA acquisto (%)" name="vatRate" inputMode="decimal" defaultValue={line.vatRate} required />
        <SimpleInput label="Perdita stimata (%)" name="lossPercentage" inputMode="decimal" defaultValue={line.lossPercentage} required />
        <SimpleInput label="Rapporto acqua BIB (L/L)" name="dilutionWaterRatio" inputMode="decimal" defaultValue={line.dilutionWaterRatio} required />
        <SimpleInput label="Costo CO₂ (€/L)" name="co2CostPerLiter" inputMode="decimal" defaultValue={line.co2CostPerLiter} required />
        <SimpleInput label="Cooler (kWh/L)" name="coolerKwhPerLiter" inputMode="decimal" defaultValue={line.coolerKwhPerLiter} required />
        <SimpleInput label="Cella (kWh/L)" name="cellarKwhPerLiter" inputMode="decimal" defaultValue={line.cellarKwhPerLiter} required />
      </div>
      <button type="submit" className="mt-3 min-h-10 rounded-lg bg-slate-800 px-3 text-xs font-bold text-white hover:bg-slate-700">Salva parametri</button>
    </form>
  );
}

function BeverageMappingForm({ beverageLineId, menuProducts, onSubmit }: {
  beverageLineId: number;
  menuProducts: RecipeProduct[];
  onSubmit: (data: Record<string, unknown>) => Promise<boolean>;
}) {
  return (
    <form onSubmit={async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const data: Record<string, unknown> = Object.fromEntries(form);
      data.beverageLineId = beverageLineId;
      data.productId = Number(data.productId);
      if (await onSubmit(data)) {
        event.currentTarget.reset();
      }
    }} className="mt-3 flex flex-wrap items-end gap-2 p-3 bg-slate-50 rounded-lg border border-slate-100">
      <label className="block text-xs font-semibold text-slate-600 flex-1 min-w-[200px]">
        Collega formato Menu
        <select name="productId" required className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-primary">
          <option value="">Seleziona prodotto...</option>
          {menuProducts.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <div className="w-24 shrink-0">
        <SimpleInput label="Litri erogati" name="servingVolumeLiters" inputMode="decimal" required placeholder="0.4" />
      </div>
      <button type="submit" className="h-[38px] px-3 rounded-lg bg-slate-800 text-white text-xs font-semibold hover:bg-slate-700 flex items-center justify-center" title="Collega prodotto"><Link2 className="h-4 w-4" /></button>
    </form>
  );
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
  const updateBeverageLine = async (lineId: number, body: unknown, success: string) => {
    try {
      await request(`/beverage-lines/${lineId}`, { method: "PATCH", body: JSON.stringify(body) });
      toast({ title: success });
      await refresh();
      return true;
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : "Errore aggiornamento linea", variant: "destructive" });
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
            <TabsTrigger value="beverage">Bevande</TabsTrigger>
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
                <section className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                  <h3 className="flex items-center gap-2 font-bold text-slate-800"><BadgeEuro className="h-4 w-4 text-primary" /> Assistente marginalità locale</h3>
                  <p className="mt-1 text-xs text-slate-600">Suggerimenti calcolati sui tuoi ricavi, costi e snapshot: ogni indicazione riporta il motivo e l’azione consigliata.</p>
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    {(overview.data?.recommendations ?? []).map((recommendation, index) => {
                      const tone = recommendation.tone === "critical" ? "border-red-200 bg-red-50 text-red-950" : recommendation.tone === "attention" ? "border-amber-200 bg-amber-50 text-amber-950" : "border-emerald-200 bg-emerald-50 text-emerald-950";
                      return <div key={`${recommendation.title}-${index}`} className={`rounded-xl border p-3 text-sm ${tone}`}><b>{recommendation.title}</b><p className="mt-1 opacity-90">{recommendation.explanation}</p><p className="mt-2 font-semibold">Cosa fare: {recommendation.action}</p></div>;
                    })}
                  </div>
                </section>
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
              <div className="grid grid-cols-2 gap-3"><SimpleInput label="Peso confezione in grammi (opz.)" name="unitSizeG" inputMode="decimal" placeholder="es. 1000 per 1 kg" /><SimpleInput label="Peso fetta/pezzo in grammi (opz.)" name="sliceWeightG" inputMode="decimal" placeholder="es. 20" /></div>
              <p className="text-xs text-slate-500">Con questi pesi il costo per grammo e per fetta si calcola da solo: in ricetta basterà indicare quante fette usi.</p>
              <SubmitButton>Salva ingrediente</SubmitButton>
            </form>
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="font-bold">Ingredienti attivi</h2>
              <div className="mt-3 divide-y divide-slate-100">{(catalog.data?.ingredients ?? []).map(item => {
                const detail = ingredientCostDetail(item);
                return <div key={item.id} className="flex justify-between gap-4 py-2 text-sm"><span>{item.name}<small className="ml-2 text-slate-400">/{item.baseUnit}</small>{detail && <small className="ml-2 text-emerald-700">{detail}</small>}</span><b>{euro(item.currentUnitCost)}</b></div>;
              }) || <span />}</div>
              {!catalog.data?.ingredients.length && <p className="mt-4 text-sm text-slate-400">Nessun ingrediente inserito.</p>}
              <MenuVariationIngredients
                products={menuProducts}
                variations={catalog.data?.productVariations ?? []}
              />
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
                    return <div key={product.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2 text-sm"><span>{product.name}</span>{recipe ? <span className="shrink-0 text-emerald-700 font-semibold">Ricetta v{recipe.version}</span> : <span className="shrink-0 text-amber-600">Ricetta mancante</span>}</div>;
                  })}</div>
                </div>
              ))}</div>
            </section>
          </TabsContent>

          <TabsContent value="costs" className="space-y-5">
            <form onSubmit={async event => {
              event.preventDefault(); const form = new FormData(event.currentTarget);
              if (await submit("/configurations", Object.fromEntries(form), "Configurazione costi salvata")) event.currentTarget.reset();
            }} className="rounded-xl border border-slate-200 bg-white p-4 max-w-3xl">
              <h2 className="flex items-center gap-2 font-bold"><Settings2 className="h-4 w-4 text-primary" /> Configurazione costi</h2>
              <p className="mt-1 text-xs text-slate-500">Valori validi dalla data indicata: i nuovi calcoli conserveranno la configurazione usata nello snapshot.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <SimpleInput label="Valida dal" name="validFrom" type="date" defaultValue={today} required />
                <SimpleInput label="Affitto mensile (€)" name="rentMonthly" defaultValue="0" inputMode="decimal" />
                <SimpleInput label="Registro imposte annuale (€)" name="taxRegisterAnnual" defaultValue="0" inputMode="decimal" />
                <SimpleInput label="Diritto camerale annuale (€)" name="chamberFeeAnnual" defaultValue="0" inputMode="decimal" />
                <SimpleInput label="Altri costi fissi mensili (€)" name="fixedCostsMonthly" defaultValue="0" inputMode="decimal" />
                <SimpleInput label="Energia €/kWh senza bolletta (fallback)" name="electricityCostPerKwh" defaultValue="0" inputMode="decimal" />
                <SimpleInput label="Costo orario manodopera (€)" name="ownerHourlyCost" defaultValue="0" inputMode="decimal" />
                <SimpleInput label="Riserva imposte %" name="taxReservePercentage" defaultValue="0" inputMode="decimal" />
                <SimpleInput label="Commissione carta %" name="cardFeePercentage" defaultValue="0" inputMode="decimal" />
                <SimpleInput label="Commissione contanti %" name="cashFeePercentage" defaultValue="0" inputMode="decimal" />
                <SimpleInput label="Commissione ticket %" name="ticketFeePercentage" defaultValue="0" inputMode="decimal" />
                <SimpleInput label="Commissione altri %" name="otherFeePercentage" defaultValue="0" inputMode="decimal" />
                <SimpleInput label="Commissione fissa/transazione (€)" name="paymentFixedFee" defaultValue="0" inputMode="decimal" />
              </div>
              <p className="mt-3 text-xs text-slate-500">Affitto, registro imposte, diritto camerale e altri fissi sono ripartiti sui coperti effettivamente serviti. Le ore produttive mensili non vengono più richieste.</p>
              <div className="mt-4"><SubmitButton>Salva configurazione</SubmitButton></div>
            </form>
            <section className="grid gap-5 lg:grid-cols-[.9fr_1.1fr]">
              <form onSubmit={async event => {
                event.preventDefault(); const form = new FormData(event.currentTarget);
                if (await submit("/cover-cost-items", Object.fromEntries(form), "Componente del coperto salvato")) event.currentTarget.reset();
              }} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                <h2 className="flex items-center gap-2 font-bold"><PackagePlus className="h-4 w-4 text-primary" /> Componenti del coperto</h2>
                <p className="text-xs text-slate-500">Tovaglietta, tovaglioli e porta posate sono per persona. Le quattro salse standard vengono applicate una sola volta alle comande con fritti.</p>
                <SimpleInput label="Componente" name="name" required placeholder="Tovaglietta, Tovagliolo, Maionese…" list="cover-item-presets" />
                <datalist id="cover-item-presets"><option value="Tovaglietta" /><option value="Tovagliolo" /><option value="Porta posate" /><option value="Maionese" /><option value="Ketchup" /><option value="Senape" /><option value="Salsa BBQ" /></datalist>
                <div className="grid grid-cols-2 gap-3"><SimpleInput label="Quantità confezione" name="purchaseQuantity" inputMode="decimal" required placeholder="es. 100" /><SimpleInput label="Unità" name="purchaseUnit" required defaultValue="pz" placeholder="pz, ml…" /></div>
                <div className="grid grid-cols-2 gap-3"><SimpleInput label="Prezzo confezione (€)" name="purchasePrice" inputMode="decimal" required placeholder="0,00" /><SimpleInput label="Quantità per coperto" name="quantityPerCover" inputMode="decimal" required defaultValue="1" /></div>
                <p className="text-xs text-slate-500">Regola del locale: Maionese, Ketchup, Senape e Salsa BBQ vengono salvate automaticamente come <b>2 porzioni ciascuna per comanda con fritti</b>: 8 bustine totali, indipendentemente dai coperti.</p>
                <SubmitButton>Aggiungi componente</SubmitButton>
              </form>
              <section className="rounded-xl border border-slate-200 bg-white p-4">
                <h2 className="font-bold">Costo coperto calcolato</h2>
                <p className="mt-1 text-xs text-slate-500">Le voci per coperto seguono le persone sedute. Le salse incluse vengono aggiunte una sola volta quando una ricetta della comanda usa la friggitrice.</p>
                <div className="mt-3 divide-y divide-slate-100">{(catalog.data?.coverCostItems ?? []).map(item => {
                  const detail = coverCostDetail(item);
                  const scopeLabel = item.applicationScope === "fried_order" ? "per comanda con fritti" : "per coperto";
                  return <div key={item.id} className="flex justify-between gap-4 py-2 text-sm"><span><b>{item.name}</b><small className="ml-2 text-slate-500">{item.quantityPerCover} {item.purchaseUnit} {scopeLabel} · {euro(detail.unitCost)}/{item.purchaseUnit}</small></span><b>{euro(detail.coverCost)} {scopeLabel}</b></div>;
                })}</div>
                {!catalog.data?.coverCostItems.length && <p className="mt-4 text-sm text-slate-400">Aggiungi tovaglietta, tovaglioli, porta posate e salse per calcolare i costi del servizio.</p>}
              </section>
            </section>
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
               <div className="grid grid-cols-2 gap-3"><SimpleInput label="Consumo (kWh, m³, …)" name="consumptionQuantity" inputMode="decimal" required /><SimpleInput label="Costo variabile (€)" name="variableCost" inputMode="decimal" required /></div>
              <div className="grid grid-cols-2 gap-3"><SimpleInput label="Costo fisso (€)" name="fixedCost" defaultValue="0" inputMode="decimal" required /><SimpleInput label="Tasse/oneri (€)" name="taxesAndFees" defaultValue="0" inputMode="decimal" /></div>
               <p className="text-xs text-slate-500">Il totale e il prezzo per kWh/m³ sono calcolati automaticamente dalle voci inserite, per evitare errori di trascrizione.</p>
              <SubmitButton>Registra bolletta</SubmitButton>
            </form>
             <section className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2">
               <h2 className="font-bold">Prezzi calcolati dalle bollette</h2>
               <p className="mt-1 text-xs text-slate-500">Il costo variabile serve per confrontare i consumi; il costo totale include quota fissa e oneri. Le bollette valide sono ripartite per coperto.</p>
               <div className="mt-3 divide-y divide-slate-100">{(catalog.data?.utilityBills ?? []).map(bill => {
                 const utility = (catalog.data?.utilityTypes ?? []).find(item => item.id === bill.utilityTypeId);
                 const unit = utility?.measurementUnit ?? "unità";
                 return <div key={bill.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><span><b>{utility?.name ?? "Utenza"}</b><small className="ml-2 text-slate-400">{bill.periodStart} → {bill.periodEnd} · {bill.consumptionQuantity} {unit}</small></span><span className="text-right"><b>{bill.variableUnitCost == null ? "—" : `${euro(bill.variableUnitCost)}/${unit}`}</b><small className="ml-2 text-slate-500">variabile · {bill.totalUnitCost == null ? "—" : `${euro(bill.totalUnitCost)}/${unit}`} totale</small></span></div>;
               })}</div>
               {!catalog.data?.utilityBills.length && <p className="mt-3 text-sm text-slate-400">Nessuna bolletta registrata.</p>}
             </section>
          </TabsContent>

          <TabsContent value="beverage" className="grid gap-5 lg:grid-cols-[.9fr_1.1fr]">
            <div className="space-y-5">
              <BeverageLineForm onSubmit={async data => submit("/beverage-lines", data, "Linea bevande salvata")} />
            </div>

            <section className="space-y-4">
              <h2 className="font-bold flex items-center gap-2"><GlassWater className="h-4 w-4 text-primary" /> Linee attive e costi</h2>

              {!catalog.data?.beverageLines || catalog.data.beverageLines.length === 0 ? (
                <p className="text-sm text-slate-500 bg-white p-4 rounded-xl border border-slate-200">Nessuna linea alla spina configurata.</p>
              ) : (
                catalog.data.beverageLines.map(line => {
                  const preview = catalog.data?.beverageCostPreviews?.find(item => item.beverageLineId === line.id);
                  const mappings = catalog.data?.beverageProductMappings?.filter(item => item.beverageLineId === line.id) ?? [];
                  const supplies = (catalog.data?.beverageLineSupplyHistory ?? []).filter(item => item.beverageLineId === line.id);

                  return (
                    <div key={line.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                      <div className="flex items-start justify-between border-b border-slate-100 bg-slate-50/50 p-4">
                        <div>
                          <h3 className="flex items-center gap-2 font-bold text-slate-800">
                            {line.name}
                            {!line.active && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">Inattiva</span>}
                          </h3>
                          <div className="mt-1 text-xs text-slate-500">
                            {line.lineType === "beer" ? "Fusto birra" : "Bag in Box"} · {line.sourceVolumeLiters} L · {euro(line.purchasePriceNet)} + IVA
                            {Number(line.lossPercentage) > 0 ? ` · ${line.lossPercentage}% spreco` : ""}
                          </div>
                        </div>

                        {preview && (
                          <div className="text-right">
                            <div className="text-sm font-black text-slate-800">{euro(preview.costPerLiter)} <span className="text-[10px] font-normal text-slate-500">/L</span></div>
                            {preview.missingData.length > 0 ? (
                              <div className="mt-1 flex items-center justify-end gap-1 text-[10px] font-semibold text-amber-600">
                                <AlertTriangle className="h-3 w-3" /> Dati parziali
                              </div>
                            ) : (
                              <div className="mt-1 text-[10px] font-semibold text-emerald-600">Costo completo</div>
                            )}
                          </div>
                        )}
                      </div>

                      {preview && preview.missingData.length > 0 && (
                        <div className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-800">
                          <b>Attenzione:</b> per un calcolo completo manca: {preview.missingData.join(", ")}.
                        </div>
                      )}

                      <div className="p-4">
                          <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                            <div className="rounded-lg border border-slate-100 bg-slate-50 p-2"><div className="mb-1 text-slate-500">Materia prima</div><div className="font-semibold">{euro(preview?.sourceCostPerLiter)}/L</div></div>
                            {line.lineType === "bib" && <div className="rounded-lg border border-slate-100 bg-slate-50 p-2"><div className="mb-1 text-slate-500">Acqua ({line.dilutionWaterRatio}:1)</div><div className="font-semibold">{euro(preview?.waterCostPerLiter)}/L</div></div>}
                            <div className="rounded-lg border border-slate-100 bg-slate-50 p-2"><div className="mb-1 text-slate-500">CO₂</div><div className="font-semibold">{euro(preview?.co2CostPerLiter)}/L</div></div>
                            <div className="rounded-lg border border-slate-100 bg-slate-50 p-2"><div className="mb-1 text-slate-500">Energia</div><div className="font-semibold">{euro(preview?.energyCostPerLiter)}/L</div></div>
                          </div>

                          <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-700">Formati collegati</h4>
                          {mappings.length === 0 ? <p className="mb-3 text-xs text-slate-400">Nessun prodotto menu collegato a questa linea.</p> : (
                            <div className="mb-3 space-y-1">
                              {mappings.map(mapping => {
                                const product = menuProducts.find(item => item.id === mapping.productId);
                                const costPerServing = preview ? Number(preview.costPerLiter) * Number(mapping.servingVolumeLiters) : 0;
                                return <div key={mapping.id} className="flex items-center justify-between rounded-lg border border-transparent px-2 py-1.5 text-sm hover:bg-slate-50"><div><span className="font-medium text-slate-800">{product?.name || `Prodotto #${mapping.productId}`}</span><span className="ml-2 text-xs text-slate-500">{mapping.servingVolumeLiters} L</span></div><div className="font-semibold text-slate-700">{euro(costPerServing)}</div></div>;
                              })}
                            </div>
                          )}

                          {line.active ? (
                            <BeverageMappingForm beverageLineId={line.id} menuProducts={menuProducts} onSubmit={data => submit("/beverage-product-mappings", data, "Prodotto collegato")} />
                          ) : (
                            <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Riattiva la linea prima di collegare nuovi prodotti Menu.</p>
                          )}
                          <BeverageSupplyUpdateForm
                            line={line}
                            onSubmit={data => updateBeverageLine(line.id, data, "Fornitura beverage aggiornata")}
                          />
                          <BeverageLineSettingsForm
                            line={line}
                            onSubmit={data => updateBeverageLine(line.id, data, "Parametri linea aggiornati")}
                          />
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                            <div className="text-xs text-slate-500">
                              {line.active ? "Linea disponibile per nuove associazioni." : "Linea disattivata: resta disponibile per lo storico."}
                            </div>
                            <button
                              type="button"
                              onClick={() => void updateBeverageLine(line.id, { active: !line.active }, line.active ? "Linea beverage disattivata" : "Linea beverage riattivata")}
                              className={cn("min-h-9 rounded-lg px-3 text-xs font-bold", line.active ? "bg-slate-100 text-slate-700 hover:bg-slate-200" : "bg-emerald-600 text-white hover:bg-emerald-700")}
                            >
                              {line.active ? "Disattiva linea" : "Riattiva linea"}
                            </button>
                          </div>
                          <div className="mt-3 border-t border-slate-100 pt-3">
                            <h4 className="text-xs font-bold uppercase tracking-wide text-slate-700">Storico forniture</h4>
                            {supplies.length === 0 ? (
                              <p className="mt-1 text-xs text-slate-400">Nessuna decorrenza registrata: il costo iniziale resta disponibile per lo storico.</p>
                            ) : (
                              <div className="mt-2 space-y-1">
                                {supplies.map(supply => (
                                  <div key={supply.id} className="flex items-center justify-between rounded-md bg-slate-50 px-2 py-1.5 text-xs">
                                    <span className="text-slate-600">Dal {new Date(`${supply.validFrom}T00:00:00`).toLocaleDateString("it-IT")}</span>
                                    <span className="font-semibold text-slate-800">{euro(supply.purchasePriceNet)} · {supply.sourceVolumeLiters} L</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                  );
                })
              )}
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </BackofficeShell>
  );
}

function MenuVariationIngredients({ products, variations }: { products: RecipeProduct[]; variations: MenuVariation[] }) {
  const productById = new Map(products.map(product => [product.id, product]));
  const variationsByProduct = new Map<number, MenuVariation[]>();
  for (const variation of variations) {
    if (!productById.has(variation.productId)) continue;
    variationsByProduct.set(variation.productId, [...(variationsByProduct.get(variation.productId) ?? []), variation]);
  }
  const rows = [...variationsByProduct.entries()]
    .map(([productId, productVariations]) => ({ product: productById.get(productId)!, variations: productVariations }))
    .sort((left, right) => left.product.sortOrder - right.product.sortOrder || left.product.name.localeCompare(right.product.name, "it"));

  return (
    <div className="mt-6 border-t border-slate-100 pt-5">
      <h3 className="flex items-center gap-2 font-bold text-slate-800"><Utensils className="h-4 w-4 text-primary" /> Prodotti già nelle variazioni</h3>
      <p className="mt-1 text-xs text-slate-500">Queste variazioni arrivano direttamente da Menu. Gli ingredienti della ricetta generano invece le variazioni automatiche “Senza …” e i relativi costi.</p>
      {rows.length === 0 ? (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-400">Nessun prodotto ha ancora variazioni configurate nel Menu.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {rows.map(({ product, variations: productVariations }) => (
            <div key={product.id} className="rounded-lg border border-slate-100 px-3 py-2.5">
              <div className="font-semibold text-sm text-slate-800">{product.name}</div>
              <div className="mt-2 space-y-1.5">
                {productVariations.map(variation => {
                  const options = variationOptions(variation.options);
                  return (
                    <div key={variation.id} className="text-xs text-slate-600">
                      <span className="font-semibold">{variation.name}</span>
                      {variation.required && <span className="ml-1.5 text-slate-400">(obbligatoria)</span>}
                      <span className="ml-2 text-slate-500">{options.length ? options.map(option => option.name).join(" · ") : "Nessuna opzione"}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProductList({ title, icon, rows, empty, danger = false }: { title: string; icon: React.ReactNode; rows: ProductMargin[]; empty: string; danger?: boolean }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="flex items-center gap-2 font-bold text-slate-800">{icon}{title}</h3><div className="mt-3 space-y-2">{rows.length === 0 ? <p className="py-4 text-sm text-slate-400">{empty}</p> : rows.map(row => <div key={row.productId} className="flex items-center justify-between border-b border-slate-100 pb-2 text-sm last:border-0"><div><b>{row.productName}</b><span className="ml-2 text-xs text-slate-400">{row.quantity} pz · {euro(row.grossRevenue)} ricavi</span></div><div className={danger || Number(row.contribution) < 0 ? "font-bold text-red-600" : "font-bold text-emerald-700"}>{euro(row.contribution)} <small>({row.contributionPercent}%)</small></div></div>)}</div></section>;
}

function RecipeForm({ productGroups, ingredients, onSave }: { productGroups: RecipeProductGroup[]; ingredients: Ingredient[]; onSave: (data: unknown) => Promise<boolean> }) {
  const [items, setItems] = useState<Array<{ ingredientId: string; quantity: string; wastePercentage: string }>>([{ ingredientId: "", quantity: "", wastePercentage: "0" }]);
  return <form onSubmit={async event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const saved = await onSave({ ...Object.fromEntries(form), items: items.map(item => ({ ...item, ingredientId: Number(item.ingredientId) })) });
    if (saved) { event.currentTarget.reset(); setItems([{ ingredientId: "", quantity: "", wastePercentage: "0" }]); }
  }} className="rounded-xl border border-slate-200 bg-white p-4">
    <h2 className="flex items-center gap-2 font-bold"><Utensils className="h-4 w-4 text-primary" /> Nuova ricetta</h2>
    <p className="mt-1 text-xs text-slate-500">Scegli un prodotto dal Menu: gli ingredienti inseriti qui diventano anche le variazioni automatiche “Senza …” in cassa.</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="block text-xs font-semibold text-slate-600">Prodotto del Menu<select required name="productId" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><option value="">Seleziona…</option>{productGroups.map(group => <optgroup key={group.id ?? "uncategorized"} label={group.name}>{group.products.map(product => <option value={product.id} key={product.id}>{product.name}</option>)}</optgroup>)}</select></label>
      <SimpleInput label="Valida dal" name="validFrom" type="date" defaultValue={today} required />
    </div>
    <div className="mt-4"><div className="text-xs font-bold uppercase tracking-wide text-slate-500">Ingredienti e variazioni</div><p className="mt-1 text-xs text-slate-500">Ogni ingrediente selezionato sarà proposto alla cassa come “Senza nome ingrediente”.</p>{items.map((item, index) => <div key={index} className="mt-2 grid grid-cols-[1fr_.5fr_.45fr_auto] gap-2"><select value={item.ingredientId} onChange={event => setItems(current => current.map((row, i) => i === index ? { ...row, ingredientId: event.target.value } : row))} required className="rounded-lg border border-slate-200 bg-white px-2 text-sm"><option value="">Ingrediente / variazione…</option>{ingredients.map(ingredient => <option value={ingredient.id} key={ingredient.id}>{ingredient.name} — Senza {ingredient.name}</option>)}</select><input value={item.quantity} onChange={event => setItems(current => current.map((row, i) => i === index ? { ...row, quantity: event.target.value } : row))} placeholder={ingredientQuantityUnit(ingredients.find(ingredient => String(ingredient.id) === item.ingredientId))} required className="rounded-lg border border-slate-200 px-2 text-sm" /><input value={item.wastePercentage} onChange={event => setItems(current => current.map((row, i) => i === index ? { ...row, wastePercentage: event.target.value } : row))} placeholder="Scarto %" className="rounded-lg border border-slate-200 px-2 text-sm" /><button type="button" onClick={() => setItems(current => current.length > 1 ? current.filter((_, i) => i !== index) : current)} className="text-xs text-red-500">Rimuovi</button></div>)}
      <button type="button" onClick={() => setItems(current => [...current, { ingredientId: "", quantity: "", wastePercentage: "0" }])} className="mt-2 text-xs font-semibold text-primary">+ Aggiungi ingrediente</button></div>
    <div className="mt-4"><SubmitButton>Salva ricetta</SubmitButton></div>
  </form>;
}