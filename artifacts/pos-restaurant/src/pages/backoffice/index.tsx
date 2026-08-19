import { Link } from "wouter";
import { UtensilsCrossed, LayoutGrid, BarChart3, CreditCard, ArrowRight, BookOpen, Layers, Printer, Settings, Users, Receipt, FileText, User, Tag, Zap, Bike, Package, Sun, BadgePercent, SlidersHorizontal, CalendarDays, Sparkles, ShieldCheck, Activity, TrendingUp, TrendingDown, ChartNoAxesCombined } from "lucide-react";
import { useGetDashboardSummary, useGetSalesByDay } from "@workspace/api-client-react";
import { ResponsiveContainer, BarChart, Bar, Tooltip, XAxis } from "recharts";
import { BackofficeShell } from "@/components/BackofficeShell";

// Variazione % rispetto a un periodo precedente (null se il confronto non ha senso)
function calcDelta(cur?: string, prev?: string): number | null {
  const c = parseFloat(cur ?? "");
  const p = parseFloat(prev ?? "");
  if (isNaN(c) || isNaN(p) || p === 0) return null;
  return ((c - p) / p) * 100;
}

function DeltaBadge({ pct, label }: { pct: number | null; label: string }) {
  if (pct == null) return <div className="text-[10px] text-slate-400 mt-0.5">{label}: n.d.</div>;
  const up = pct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <div className={`flex items-center gap-1 text-[10px] font-semibold mt-0.5 ${up ? "text-emerald-600" : "text-red-500"}`}>
      <Icon className="h-3 w-3" />
      <span>{up ? "+" : ""}{pct.toFixed(0)}% {label}</span>
    </div>
  );
}

const sections = [
  // Database prodotti
  { href: "/backoffice/menu", icon: BookOpen, label: "Menu", description: "Categorie e prodotti", color: "bg-amber-50 text-amber-600 border-amber-200" },
  { href: "/backoffice/variazioni", icon: SlidersHorizontal, label: "Variazioni", description: "Modificatori per categoria", color: "bg-lime-50 text-lime-700 border-lime-200" },
  { href: "/backoffice/combo", icon: Package, label: "Combo", description: "Menu e prodotti composti", color: "bg-orange-50 text-orange-600 border-orange-200" },
  { href: "/backoffice/aliquote-iva", icon: BadgePercent, label: "Aliquote IVA", description: "Reparti fiscali", color: "bg-red-50 text-red-600 border-red-200" },

  // Sconti e promozioni
  { href: "/backoffice/sconti", icon: Tag, label: "Sconti", description: "Tipi di sconto", color: "bg-pink-50 text-pink-600 border-pink-200" },
  { href: "/backoffice/promozioni", icon: Zap, label: "Promozioni", description: "Offerte automatiche", color: "bg-purple-50 text-purple-600 border-purple-200" },
  { href: "/backoffice/happy-hour", icon: Sun, label: "Happy Hour", description: "Fasce orarie speciali", color: "bg-yellow-50 text-yellow-600 border-yellow-200" },

  // Sala e tavoli
  { href: "/backoffice/prenotazioni", icon: CalendarDays, label: "Prenotazioni", description: "Calendario tavoli", color: "bg-blue-50 text-blue-600 border-blue-200" },
  { href: "/backoffice/tables", icon: LayoutGrid, label: "Tavoli", description: "Planimetria e sale", color: "bg-indigo-50 text-indigo-600 border-indigo-200" },
  { href: "/backoffice/rooms", icon: Layers, label: "Sale", description: "Gestione ambienti", color: "bg-violet-50 text-violet-600 border-violet-200" },

  // Cucina e stampa
  { href: "/backoffice/printers", icon: Printer, label: "Stampanti", description: "Configurazione", color: "bg-slate-50 text-slate-600 border-slate-200" },

  // Delivery
  { href: "/backoffice/fattorini", icon: Bike, label: "Fattorini", description: "Rider consegne", color: "bg-cyan-50 text-cyan-600 border-cyan-200" },

  // Report e cassa
  { href: "/backoffice/reports", icon: BarChart3, label: "Report", description: "Statistiche e vendite", color: "bg-green-50 text-green-600 border-green-200" },
  { href: "/backoffice/marginalita", icon: ChartNoAxesCombined, label: "Marginalità", description: "Costi e prodotti redditizi", color: "bg-emerald-50 text-emerald-600 border-emerald-200" },
  { href: "/backoffice/payments", icon: CreditCard, label: "Pagamenti", description: "Storico transazioni", color: "bg-purple-50 text-purple-600 border-purple-200" },
  { href: "/backoffice/fiscale", icon: Receipt, label: "Fiscale", description: "Scontrini e Z-Report", color: "bg-red-50 text-red-600 border-red-200" },

  // Clienti e fatture
  { href: "/backoffice/clienti", icon: User, label: "Clienti", description: "Anagrafica fatturazione", color: "bg-cyan-50 text-cyan-600 border-cyan-200" },
  { href: "/backoffice/fatture", icon: FileText, label: "Fatture", description: "FatturaPA elettronica", color: "bg-violet-50 text-violet-600 border-violet-200" },

  // Gestione
  { href: "/backoffice/users", icon: Users, label: "Utenti", description: "Accessi e PIN", color: "bg-teal-50 text-teal-600 border-teal-200" },
  { href: "/backoffice/settings", icon: Settings, label: "Impostazioni", description: "Configurazione app", color: "bg-orange-50 text-orange-600 border-orange-200" },
  { href: "/backoffice/audit", icon: ShieldCheck, label: "Audit Log", description: "Storico azioni sensibili", color: "bg-rose-50 text-rose-600 border-rose-200" },
  { href: "/backoffice/funzioni", icon: Sparkles, label: "Funzioni", description: "Attiva funzionalità opzionali", color: "bg-fuchsia-50 text-fuchsia-600 border-fuchsia-200" },
];

const GROUPS = [
  { label: "Prodotti & Menu", range: [0, 4] },
  { label: "Sconti & Promozioni", range: [4, 7] },
  { label: "Sala & Stampa", range: [7, 12] },
  { label: "Report & Cassa", range: [12, 16] },
  { label: "Clienti & Gestione", range: [16, 22] },
];

export default function BackOfficeIndex() {
  // Auto-refresh ogni 30s per dashboard live
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: summary, dataUpdatedAt } = useGetDashboardSummary({ query: { refetchInterval: 30_000 } as any });
  const { data: sales7 = [] } = useGetSalesByDay({ days: 7 });
  const lastUpdate = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

  const deltaIeri = calcDelta(summary?.todayRevenue, summary?.yesterdayRevenue);
  const deltaSettimana = calcDelta(summary?.todayRevenue, summary?.lastWeekRevenue);
  const spark = sales7.map(d => ({
    label: new Date(d.date).toLocaleDateString("it-IT", { weekday: "short" }),
    revenue: parseFloat(d.revenue),
  }));

  return (
    <BackofficeShell title="Back Office" subtitle="Gestione ristorante" isRoot>
      <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">

        {/* KPI strip — dashboard live */}
        {summary && (
          <div>
            <div className="flex items-center justify-between mb-2 px-1">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <Activity className="h-3 w-3 text-emerald-500 animate-pulse" />
                <span>Live · aggiornato alle {lastUpdate}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                <div className="text-[11px] text-slate-400 mb-1">Incasso oggi</div>
                <div className="text-xl font-bold text-primary">€ {summary.todayRevenue}</div>
                <DeltaBadge pct={deltaIeri} label="vs ieri" />
                <DeltaBadge pct={deltaSettimana} label={`vs ${new Date().toLocaleDateString("it-IT", { weekday: "short" })} scorso`} />
              </div>
              {[
                { label: "Ordini chiusi", value: String(summary.todayOrders), sub: summary.yesterdayOrders != null ? `ieri: ${summary.yesterdayOrders}` : undefined },
                { label: "Scontrino medio", value: `€ ${summary.avgOrderValue}`, sub: undefined },
                { label: "Ordini aperti", value: String(summary.openOrders), sub: undefined },
                { label: "Tavoli occupati", value: `${summary.occupiedTables}/${summary.totalTables}`, sub: undefined },
              ].map(k => (
                <div key={k.label} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                  <div className="text-[11px] text-slate-400 mb-1">{k.label}</div>
                  <div className="text-xl font-bold text-slate-800">{k.value}</div>
                  {k.sub && <div className="text-[10px] text-slate-400 mt-0.5">{k.sub}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Andamento ultimi 7 giorni */}
        {spark.length > 0 && spark.some(s => s.revenue > 0) && (
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
            <div className="text-[11px] text-slate-400 mb-2">Incassi ultimi 7 giorni</div>
            <div className="h-20">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={spark} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} interval={0} />
                  <Tooltip
                    cursor={{ fill: "rgba(0,0,0,0.04)" }}
                    contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
                    formatter={(v: number) => [`€ ${v.toFixed(2)}`, "Incasso"]}
                  />
                  <Bar dataKey="revenue" fill="hsl(27 96% 51%)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Groups */}
        {GROUPS.map(g => (
          <div key={g.label}>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 px-1">{g.label}</div>
            <div className="grid grid-cols-3 gap-2.5">
              {sections.slice(g.range[0], g.range[1]).map((s) => (
                <Link key={s.href} href={s.href}>
                  <div className={`flex flex-col items-center gap-2 p-3 rounded-2xl border-2 bg-white hover:scale-[1.02] active:scale-95 transition-all cursor-pointer shadow-sm ${s.color}`}>
                    <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${s.color}`}>
                      <s.icon className="h-5 w-5" />
                    </div>
                    <div className="text-center">
                      <div className="text-xs font-bold text-slate-800 leading-tight">{s.label}</div>
                      <div className="text-[9px] text-slate-400 mt-0.5 leading-tight hidden sm:block">{s.description}</div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}

        {/* Sala shortcut */}
        <Link href="/">
          <div className="flex items-center gap-3 p-4 bg-primary text-white rounded-2xl shadow-md hover:bg-primary/90 active:scale-95 transition-all cursor-pointer">
            <UtensilsCrossed className="h-6 w-6 shrink-0" />
            <div>
              <div className="font-bold text-sm">Vai alla Cassa</div>
              <div className="text-xs text-white/70">Front-office e presa comande</div>
            </div>
            <ArrowRight className="h-5 w-5 ml-auto" />
          </div>
        </Link>
      </div>
    </BackofficeShell>
  );
}
