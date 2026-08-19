import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  UtensilsCrossed, LayoutGrid, Receipt, Settings,
  ChefHat, BarChart3, CreditCard, Layers, Printer,
  BookOpen, Home, Users, LogOut, User, FileText, Tag, Zap, Sun,
  BadgePercent, SlidersHorizontal, CalendarDays, Sparkles, ShieldCheck, ChartNoAxesCombined,
  Package, Bike, MessageSquare, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

type NavEntry = {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
};

type NavGroup = {
  id: string;
  label: string;
  items: NavEntry[];
};

const cassaItems: NavEntry[] = [
  { href: "/", icon: Home, label: "Sala" },
];

const cassaAdminItems: NavEntry[] = [
  { href: "/orders", icon: Receipt, label: "Comande Attive" },
];

const adminGroups: NavGroup[] = [
  {
    id: "prodotti",
    label: "Prodotti & Menu",
    items: [
      { href: "/backoffice/menu", icon: BookOpen, label: "Menu" },
      { href: "/backoffice/variazioni", icon: SlidersHorizontal, label: "Variazioni" },
      { href: "/backoffice/combo", icon: Package, label: "Combo" },
      { href: "/backoffice/aliquote-iva", icon: BadgePercent, label: "Aliquote IVA" },
    ],
  },
  {
    id: "promo",
    label: "Sconti & Promozioni",
    items: [
      { href: "/backoffice/sconti", icon: Tag, label: "Sconti" },
      { href: "/backoffice/promozioni", icon: Zap, label: "Promozioni" },
      { href: "/backoffice/happy-hour", icon: Sun, label: "Happy Hour" },
    ],
  },
  {
    id: "sala",
    label: "Sala & Stampa",
    items: [
      { href: "/backoffice/prenotazioni", icon: CalendarDays, label: "Prenotazioni" },
      { href: "/backoffice/tables", icon: LayoutGrid, label: "Tavoli" },
      { href: "/backoffice/rooms", icon: Layers, label: "Sale" },
      { href: "/backoffice/departments", icon: ChefHat, label: "Reparti" },
      { href: "/backoffice/printers", icon: Printer, label: "Stampanti" },
      { href: "/backoffice/kp-comments", icon: MessageSquare, label: "Commenti Cucina" },
      { href: "/backoffice/fattorini", icon: Bike, label: "Fattorini" },
    ],
  },
  {
    id: "report",
    label: "Report & Cassa",
    items: [
      { href: "/backoffice/reports", icon: BarChart3, label: "Report" },
      { href: "/backoffice/marginalita", icon: ChartNoAxesCombined, label: "Marginalità" },
      { href: "/backoffice/payments", icon: CreditCard, label: "Pagamenti" },
      { href: "/backoffice/fiscale", icon: Receipt, label: "Fiscale" },
      { href: "/backoffice/audit", icon: ShieldCheck, label: "Audit Log" },
    ],
  },
  {
    id: "clienti",
    label: "Clienti & Fatture",
    items: [
      { href: "/backoffice/clienti", icon: User, label: "Clienti" },
      { href: "/backoffice/fatture", icon: FileText, label: "Fatture" },
    ],
  },
  {
    id: "sistema",
    label: "Sistema",
    items: [
      { href: "/backoffice/users", icon: Users, label: "Utenti" },
      { href: "/backoffice/settings", icon: Settings, label: "Impostazioni" },
      { href: "/backoffice/funzioni", icon: Sparkles, label: "Funzioni" },
    ],
  },
];

const STORAGE_KEY = "sidebar_open_groups";

function loadOpenGroups(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function NavItem({ href, icon: Icon, label, active }: NavEntry & { active: boolean }) {
  return (
    <Link href={href} className={cn(
      "flex items-center gap-3 px-3 rounded-lg transition-all text-sm font-medium min-h-[44px]",
      active
        ? "bg-primary text-white shadow-sm"
        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-white"
    )}>
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  );
}

export function Sidebar() {
  const [location] = useLocation();
  const { user, logout, isAdmin } = useAuth();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(loadOpenGroups);

  // Il gruppo che contiene la pagina attiva resta sempre aperto
  const activeGroupId = adminGroups.find(g => g.items.some(i => i.href === location))?.id;

  useEffect(() => {
    if (activeGroupId && openGroups[activeGroupId] === false) {
      setOpenGroups(prev => {
        const next = { ...prev, [activeGroupId]: true };
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroupId]);

  const toggleGroup = (id: string) => {
    setOpenGroups(prev => {
      const next = { ...prev, [id]: !(prev[id] ?? true) };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  return (
    <div className="w-56 bg-sidebar h-screen flex flex-col shrink-0 select-none">
      {/* Logo */}
      <div className="h-14 flex items-center gap-2.5 px-5 shrink-0 border-b border-sidebar-border">
        <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
          <UtensilsCrossed className="h-4 w-4 text-white" />
        </div>
        <span className="font-bold text-white text-base tracking-tight">Hello<span className="text-orange-200">Table</span></span>
      </div>

      {/* Nav */}
      <div className="flex-1 overflow-y-auto py-3 px-3 space-y-0.5">
        {/* Cassa — sempre visibile */}
        <div className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider px-3 mb-1.5">Cassa</div>
        {cassaItems.map(item => (
          <NavItem key={item.href} {...item} active={location === item.href} />
        ))}
        {isAdmin && cassaAdminItems.map(item => (
          <NavItem key={item.href} {...item} active={location === item.href} />
        ))}

        {/* Gestione — solo admin */}
        {isAdmin && (
          <>
            <div className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider px-3 mt-4 mb-1.5">Gestione</div>
            <NavItem href="/backoffice" icon={BarChart3} label="Dashboard" active={location === "/backoffice"} />

            {adminGroups.map(group => {
              const isOpen = (openGroups[group.id] ?? true) || group.id === activeGroupId;
              const hasActive = group.id === activeGroupId;
              return (
                <div key={group.id} className="pt-1">
                  <button
                    onClick={() => toggleGroup(group.id)}
                    className={cn(
                      "w-full flex items-center justify-between px-3 rounded-lg min-h-[40px] text-xs font-semibold uppercase tracking-wider transition-colors",
                      hasActive && !isOpen
                        ? "text-orange-300"
                        : "text-sidebar-foreground/50 hover:text-white hover:bg-sidebar-accent/50"
                    )}
                  >
                    <span className="truncate">{group.label}</span>
                    <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", !isOpen && "-rotate-90")} />
                  </button>
                  {isOpen && (
                    <div className="space-y-0.5 mt-0.5">
                      {group.items.map(item => (
                        <NavItem key={item.href} {...item} active={location === item.href} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Footer: utente + logout */}
      <div className="p-3 border-t border-sidebar-border shrink-0 space-y-1">
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg">
          <div className="h-8 w-8 rounded-full bg-primary/30 flex items-center justify-center shrink-0">
            <Users className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-white truncate">{user?.name}</div>
            <div className="text-xs text-sidebar-foreground/60 capitalize">{user?.role === "admin" ? "Amministratore" : "Dipendente"}</div>
          </div>
        </div>
        <button onClick={logout}
          className="w-full flex items-center gap-2 px-3 rounded-lg min-h-[44px] text-sidebar-foreground/60 hover:text-white hover:bg-sidebar-accent transition-colors text-sm">
          <LogOut className="h-4 w-4" />
          Esci
        </button>
      </div>
    </div>
  );
}
