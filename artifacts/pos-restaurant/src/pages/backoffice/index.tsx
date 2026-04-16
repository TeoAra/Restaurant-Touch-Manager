import { Link } from "wouter";
import { UtensilsCrossed, LayoutGrid, BarChart3, CreditCard, ArrowRight, BookOpen, Layers, ChefHat, Printer, Settings, Users, Receipt, FileText, User } from "lucide-react";
import { useGetDashboardSummary } from "@workspace/api-client-react";
import { BackofficeShell } from "@/components/BackofficeShell";

const sections = [
  { href: "/backoffice/menu", icon: BookOpen, label: "Menu", description: "Categorie e prodotti", color: "bg-amber-50 text-amber-600 border-amber-200" },
  { href: "/backoffice/tables", icon: LayoutGrid, label: "Tavoli", description: "Planimetria e sale", color: "bg-blue-50 text-blue-600 border-blue-200" },
  { href: "/backoffice/rooms", icon: Layers, label: "Sale", description: "Gestione ambienti", color: "bg-indigo-50 text-indigo-600 border-indigo-200" },
  { href: "/backoffice/departments", icon: ChefHat, label: "Reparti", description: "Cucina, bar, ecc.", color: "bg-rose-50 text-rose-600 border-rose-200" },
  { href: "/backoffice/printers", icon: Printer, label: "Stampanti", description: "Configurazione", color: "bg-slate-50 text-slate-600 border-slate-200" },
  { href: "/backoffice/reports", icon: BarChart3, label: "Report", description: "Statistiche e vendite", color: "bg-green-50 text-green-600 border-green-200" },
  { href: "/backoffice/payments", icon: CreditCard, label: "Pagamenti", description: "Storico transazioni", color: "bg-purple-50 text-purple-600 border-purple-200" },
  { href: "/backoffice/fiscale", icon: Receipt, label: "Fiscale", description: "Scontrini e Z-Report", color: "bg-red-50 text-red-600 border-red-200" },
  { href: "/backoffice/clienti", icon: User, label: "Clienti", description: "Anagrafica fatturazione", color: "bg-cyan-50 text-cyan-600 border-cyan-200" },
  { href: "/backoffice/fatture", icon: FileText, label: "Fatture", description: "FatturaPA elettronica", color: "bg-violet-50 text-violet-600 border-violet-200" },
  { href: "/backoffice/users", icon: Users, label: "Utenti", description: "Accessi e PIN", color: "bg-teal-50 text-teal-600 border-teal-200" },
  { href: "/backoffice/settings", icon: Settings, label: "Impostazioni", description: "Configurazione app", color: "bg-orange-50 text-orange-600 border-orange-200" },
];

export default function BackOfficeIndex() {
  const { data: summary } = useGetDashboardSummary();

  return (
    <BackofficeShell title="Back Office" subtitle="Gestione ristorante" isRoot>
      <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">

        {/* KPI strip */}
        {summary && (
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Incasso oggi", value: `€ ${summary.todayRevenue}`, accent: true },
              { label: "Ordini oggi", value: String(summary.todayOrders), accent: false },
              { label: "Tavoli occupati", value: `${summary.occupiedTables}/${summary.totalTables}`, accent: false },
            ].map(k => (
              <div key={k.label} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                <div className="text-[11px] text-slate-400 mb-1">{k.label}</div>
                <div className={`text-xl font-bold ${k.accent ? "text-primary" : "text-slate-800"}`}>{k.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Section grid — 3 cols on mobile, adaptive */}
        <div className="grid grid-cols-3 gap-3">
          {sections.map((s) => (
            <Link key={s.href} href={s.href}>
              <div className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 bg-white hover:scale-[1.02] active:scale-95 transition-all cursor-pointer shadow-sm ${s.color}`}>
                <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${s.color}`}>
                  <s.icon className="h-6 w-6" />
                </div>
                <div className="text-center">
                  <div className="text-sm font-bold text-slate-800 leading-tight">{s.label}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5 leading-tight hidden sm:block">{s.description}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>

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
