import { Link } from "wouter";
import { UtensilsCrossed, LayoutGrid, BarChart3, CreditCard, ArrowRight } from "lucide-react";
import { useGetDashboardSummary } from "@workspace/api-client-react";

const sections = [
  {
    href: "/backoffice/menu",
    icon: UtensilsCrossed,
    title: "Gestione Menu",
    description: "Categorie, prodotti e prezzi",
    color: "from-amber-500/20 to-amber-500/5 border-amber-500/30",
    iconColor: "text-amber-500",
  },
  {
    href: "/backoffice/tables",
    icon: LayoutGrid,
    title: "Gestione Tavoli",
    description: "Layout sala e configurazione",
    color: "from-blue-500/20 to-blue-500/5 border-blue-500/30",
    iconColor: "text-blue-400",
  },
  {
    href: "/backoffice/reports",
    icon: BarChart3,
    title: "Report e Statistiche",
    description: "Vendite, incassi e trend",
    color: "from-green-500/20 to-green-500/5 border-green-500/30",
    iconColor: "text-green-400",
  },
  {
    href: "/backoffice/payments",
    icon: CreditCard,
    title: "Storico Pagamenti",
    description: "Transazioni e metodi di pagamento",
    color: "from-purple-500/20 to-purple-500/5 border-purple-500/30",
    iconColor: "text-purple-400",
  },
];

export default function BackOfficeIndex() {
  const { data: summary } = useGetDashboardSummary();

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Back Office</h1>
        <p className="text-muted-foreground text-sm mt-1">Gestione e configurazione del ristorante</p>
      </div>

      {summary && (
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="text-muted-foreground text-xs mb-1">Incasso oggi</div>
            <div className="text-2xl font-bold text-primary">€ {summary.todayRevenue}</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="text-muted-foreground text-xs mb-1">Ordini oggi</div>
            <div className="text-2xl font-bold text-foreground">{summary.todayOrders}</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="text-muted-foreground text-xs mb-1">Tavoli occupati</div>
            <div className="text-2xl font-bold text-foreground">{summary.occupiedTables}/{summary.totalTables}</div>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {sections.map((s) => (
          <Link key={s.href} href={s.href}>
            <div className={`bg-gradient-to-br ${s.color} border rounded-xl p-6 cursor-pointer hover:scale-[1.01] transition-all group`}>
              <div className="flex items-center justify-between mb-4">
                <div className={`p-3 rounded-xl bg-background/20 ${s.iconColor}`}>
                  <s.icon className="h-6 w-6" />
                </div>
                <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
              </div>
              <h3 className="font-bold text-foreground text-lg">{s.title}</h3>
              <p className="text-muted-foreground text-sm mt-1">{s.description}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
