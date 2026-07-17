import {
  useGetDashboardSummary,
  useGetSalesByDay,
  useGetTopProducts,
} from "@workspace/api-client-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { TrendingUp, ShoppingCart, TableProperties, Euro, Receipt, Clock, Download } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BackofficeShell } from "@/components/BackofficeShell";
import { useEffect, useState } from "react";
import { downloadCsv, itNum } from "@/lib/csv";

function ExportCsvButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <Download className="h-3.5 w-3.5" />
      Esporta CSV
    </button>
  );
}

const API = (import.meta.env.BASE_URL || "/") + "api";

type IvaRow = { aliquota: string; imponibile: string; iva: string; totale: string; orders: number };
type SospesoRow = { id: number; tableName: string | null; total: string; sospesoNote: string | null; createdAt: string };

function IvaReportSection() {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + "01";
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<IvaRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`${API}/fiscal/iva-report?from=${from}&to=${to}`)
      .then(r => r.json())
      .then(d => setRows(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, [from, to]);

  const totImponibile = rows.reduce((s, r) => s + parseFloat(r.imponibile || "0"), 0);
  const totIva = rows.reduce((s, r) => s + parseFloat(r.iva || "0"), 0);
  const totTotale = rows.reduce((s, r) => s + parseFloat(r.totale || "0"), 0);

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h3 className="font-bold text-foreground flex items-center gap-2">
          <Receipt className="h-4 w-4 text-primary" /> Report IVA per aliquota
        </h3>
        <div className="flex items-center gap-2 text-sm">
          <label className="text-muted-foreground">Dal</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="bg-background border border-border rounded-md px-2 py-1 text-sm" />
          <label className="text-muted-foreground">al</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="bg-background border border-border rounded-md px-2 py-1 text-sm" />
          <ExportCsvButton
            disabled={rows.length === 0}
            onClick={() => downloadCsv(
              `report-iva_${from}_${to}.csv`,
              ["Aliquota %", "Imponibile", "IVA", "Totale", "Scontrini"],
              [
                ...rows.map(r => [r.aliquota, itNum(r.imponibile), itNum(r.iva), itNum(r.totale), r.orders]),
                ["TOTALE", itNum(totImponibile), itNum(totIva), itNum(totTotale), ""],
              ],
            )}
          />
        </div>
      </div>
      {loading ? (
        <div className="text-center text-muted-foreground py-6 text-sm">Caricamento…</div>
      ) : rows.length === 0 ? (
        <div className="text-center text-muted-foreground py-6 text-sm">Nessun incasso nel periodo selezionato</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                <th className="py-2">Aliquota</th>
                <th className="py-2 text-right">Imponibile</th>
                <th className="py-2 text-right">IVA</th>
                <th className="py-2 text-right">Totale</th>
                <th className="py-2 text-right">Scontrini</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.aliquota} className="border-b border-border/50">
                  <td className="py-2 font-mono">{r.aliquota}%</td>
                  <td className="py-2 text-right">€ {parseFloat(r.imponibile).toFixed(2)}</td>
                  <td className="py-2 text-right text-amber-600">€ {parseFloat(r.iva).toFixed(2)}</td>
                  <td className="py-2 text-right font-semibold">€ {parseFloat(r.totale).toFixed(2)}</td>
                  <td className="py-2 text-right text-muted-foreground">{r.orders}</td>
                </tr>
              ))}
              <tr className="font-bold bg-muted/30">
                <td className="py-2">TOTALE</td>
                <td className="py-2 text-right">€ {totImponibile.toFixed(2)}</td>
                <td className="py-2 text-right text-amber-700">€ {totIva.toFixed(2)}</td>
                <td className="py-2 text-right text-primary">€ {totTotale.toFixed(2)}</td>
                <td className="py-2 text-right">—</td>
              </tr>
            </tbody>
          </table>
          <p className="text-[11px] text-muted-foreground mt-3">
            Calcolo basato sull'aliquota IVA configurata per ogni prodotto. Utile per liquidazione mensile/trimestrale.
          </p>
        </div>
      )}
    </div>
  );
}

function SospesiSection() {
  const [rows, setRows] = useState<SospesoRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    fetch(`${API}/fiscal/sospesi`)
      .then(r => r.json())
      .then(d => setRows(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  };
  useEffect(refresh, []);

  const totale = rows.reduce((s, r) => s + parseFloat(r.total || "0"), 0);

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-foreground flex items-center gap-2">
          <Clock className="h-4 w-4 text-yellow-500" /> Conti Sospesi
        </h3>
        <div className="text-sm text-muted-foreground">
          {rows.length} conti — <span className="text-foreground font-semibold">€ {totale.toFixed(2)}</span> da incassare
        </div>
      </div>
      {loading ? (
        <div className="text-center text-muted-foreground py-6 text-sm">Caricamento…</div>
      ) : rows.length === 0 ? (
        <div className="text-center text-muted-foreground py-6 text-sm">Nessun conto sospeso</div>
      ) : (
        <div className="space-y-2">
          {rows.map(r => (
            <div key={r.id} className="flex items-center gap-3 p-3 rounded-lg border border-yellow-200 bg-yellow-50">
              <div className="flex-1">
                <div className="font-semibold text-sm text-slate-800">
                  {r.sospesoNote || `Ordine #${r.id}`}
                  {r.tableName && <span className="ml-2 text-xs text-slate-500">— Tav. {r.tableName}</span>}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {new Date(r.createdAt).toLocaleString("it-IT")}
                </div>
              </div>
              <div className="text-right">
                <div className="font-bold text-yellow-800">€ {parseFloat(r.total).toFixed(2)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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

const RANGE_OPTIONS = [7, 14, 30, 90] as const;

export default function ReportsPage() {
  const { data: summary } = useGetDashboardSummary();
  const [rangeDays, setRangeDays] = useState<number>(14);
  const { data: salesByDay = [] } = useGetSalesByDay({ days: rangeDays });

  // Filtro periodo per prodotti più venduti (vuoto = tutto lo storico)
  const [tpFrom, setTpFrom] = useState("");
  const [tpTo, setTpTo] = useState("");
  const { data: topProducts = [] } = useGetTopProducts(
    tpFrom || tpTo ? { from: tpFrom || undefined, to: tpTo || undefined } : undefined,
  );

  const chartData = salesByDay.map((d) => ({
    date: new Date(d.date).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" }),
    revenue: parseFloat(d.revenue),
    orders: d.orders,
  }));

  const maxRevenue = Math.max(...topProducts.map((p) => parseFloat(p.totalRevenue)), 1);

  return (
    <BackofficeShell title="Report e Statistiche" subtitle="Andamento vendite e prodotti top" fixedHeight>
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
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <h3 className="font-bold text-foreground">Vendite ultimi {rangeDays} giorni</h3>
              <div className="flex items-center gap-2">
                <div className="flex rounded-lg border border-border overflow-hidden">
                  {RANGE_OPTIONS.map(d => (
                    <button
                      key={d}
                      onClick={() => setRangeDays(d)}
                      className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                        rangeDays === d
                          ? "bg-primary text-white"
                          : "bg-background text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {d}gg
                    </button>
                  ))}
                </div>
                <ExportCsvButton
                  disabled={chartData.length === 0}
                  onClick={() => downloadCsv(
                    `vendite-${rangeDays}gg.csv`,
                    ["Data", "Incasso", "Ordini"],
                    salesByDay.map(d => [d.date, itNum(d.revenue), d.orders]),
                  )}
                />
              </div>
            </div>
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

          {/* Report IVA */}
          <IvaReportSection />

          {/* Conti sospesi */}
          <SospesiSection />

          {/* Top products */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <h3 className="font-bold text-foreground">Prodotti più venduti</h3>
              <div className="flex items-center gap-2 text-sm">
                <label className="text-muted-foreground">Dal</label>
                <input type="date" value={tpFrom} onChange={e => setTpFrom(e.target.value)}
                  className="bg-background border border-border rounded-md px-2 py-1 text-sm" />
                <label className="text-muted-foreground">al</label>
                <input type="date" value={tpTo} onChange={e => setTpTo(e.target.value)}
                  className="bg-background border border-border rounded-md px-2 py-1 text-sm" />
                {(tpFrom || tpTo) && (
                  <button
                    onClick={() => { setTpFrom(""); setTpTo(""); }}
                    className="text-xs text-muted-foreground hover:text-foreground underline"
                  >
                    Tutto
                  </button>
                )}
                <ExportCsvButton
                  disabled={topProducts.length === 0}
                  onClick={() => downloadCsv(
                    `top-prodotti${tpFrom ? `_${tpFrom}` : ""}${tpTo ? `_${tpTo}` : ""}.csv`,
                    ["Posizione", "Prodotto", "Quantità", "Incasso"],
                    topProducts.map((p, i) => [i + 1, p.productName, p.totalQuantity, itNum(p.totalRevenue)]),
                  )}
                />
              </div>
            </div>
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
    </BackofficeShell>
  );
}
