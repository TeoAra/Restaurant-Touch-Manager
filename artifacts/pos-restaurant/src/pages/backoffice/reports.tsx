import {
  useGetDashboardSummary,
  useGetSalesByDay,
  useGetTopProducts,
} from "@workspace/api-client-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { TrendingUp, ShoppingCart, TableProperties, Euro } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

function StatCard({ label, value, icon: Icon, sub }: { label: string; value: string; icon: React.ElementType; sub?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="p-2 bg-primary/15 rounded-lg">
          <Icon className="h-5 w-5 text-primary" />
        </div>
      </div>
      <div className="text-2xl font-bold text-foreground">{value}</div>
      <div className="text-sm text-muted-foreground mt-1">{label}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

export default function ReportsPage() {
  const { data: summary } = useGetDashboardSummary();
  const { data: salesByDay = [] } = useGetSalesByDay();
  const { data: topProducts = [] } = useGetTopProducts();

  const chartData = salesByDay.slice(-14).map((d) => ({
    date: new Date(d.date).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" }),
    revenue: parseFloat(d.revenue),
    orders: d.orders,
  }));

  const maxRevenue = Math.max(...topProducts.map((p) => parseFloat(p.totalRevenue)), 1);

  return (
    <div className="flex flex-col h-full">
      <div className="p-6 border-b border-border shrink-0">
        <h1 className="text-2xl font-bold text-foreground">Report e Statistiche</h1>
        <p className="text-muted-foreground text-sm mt-1">Andamento vendite e prodotti top</p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-6 space-y-6">
          {/* KPI cards */}
          {summary && (
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
              <StatCard label="Incasso oggi" value={`€ ${summary.todayRevenue}`} icon={Euro} />
              <StatCard label="Ordini oggi" value={String(summary.todayOrders)} icon={ShoppingCart} />
              <StatCard label="Ordini aperti" value={String(summary.openOrders)} icon={TrendingUp} />
              <StatCard label="Tavoli occupati" value={`${summary.occupiedTables}/${summary.totalTables}`} icon={TableProperties} sub={`Valore medio: € ${summary.avgOrderValue}`} />
            </div>
          )}

          {/* Sales chart */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-bold text-foreground mb-4">Vendite ultimi 14 giorni</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 19% 15%)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(215 20.2% 65.1%)" }} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(215 20.2% 65.1%)" }} tickFormatter={(v) => `€${v}`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(222 20% 11%)", border: "1px solid hsl(217 19% 15%)", borderRadius: "8px" }}
                    labelStyle={{ color: "hsl(210 40% 98%)" }}
                    formatter={(v: number) => [`€ ${v.toFixed(2)}`, "Incasso"]}
                  />
                  <Bar dataKey="revenue" fill="hsl(38 92% 50%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Top products */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-bold text-foreground mb-4">Prodotti piu venduti</h3>
            <div className="space-y-3">
              {topProducts.length === 0 ? (
                <div className="text-center text-muted-foreground py-4 text-sm">Nessun dato disponibile</div>
              ) : topProducts.map((p, i) => (
                <div key={p.productId} className="flex items-center gap-3">
                  <div className="text-muted-foreground font-mono text-sm w-5 shrink-0">{i + 1}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-foreground text-sm truncate">{p.productName}</div>
                    <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${(parseFloat(p.totalRevenue) / maxRevenue) * 100}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-primary font-bold text-sm">€ {p.totalRevenue}</div>
                    <div className="text-muted-foreground text-xs">{p.totalQuantity} pz</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
