import { Link, useLocation } from "wouter";
import {
  UtensilsCrossed, LayoutGrid, Receipt, Settings,
  ChefHat, BarChart3, CreditCard, Layers, Printer,
  BookOpen, Home, Users
} from "lucide-react";
import { cn } from "@/lib/utils";

const mainItems = [
  { href: "/", icon: Home, label: "Sala" },
  { href: "/orders", icon: Receipt, label: "Comande Attive" },
];

const adminItems = [
  { href: "/backoffice", icon: BarChart3, label: "Dashboard" },
  { href: "/backoffice/menu", icon: BookOpen, label: "Menu" },
  { href: "/backoffice/rooms", icon: Layers, label: "Sale" },
  { href: "/backoffice/tables", icon: LayoutGrid, label: "Tavoli" },
  { href: "/backoffice/departments", icon: ChefHat, label: "Reparti" },
  { href: "/backoffice/printers", icon: Printer, label: "Stampanti" },
  { href: "/backoffice/reports", icon: BarChart3, label: "Report" },
  { href: "/backoffice/payments", icon: CreditCard, label: "Pagamenti" },
  { href: "/backoffice/settings", icon: Settings, label: "Impostazioni" },
];

function NavItem({ href, icon: Icon, label, active }: { href: string; icon: React.ComponentType<{ className?: string }>; label: string; active: boolean }) {
  return (
    <Link href={href} className={cn(
      "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm font-medium",
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
  const isBackOffice = location.startsWith("/backoffice");

  return (
    <div className="w-56 bg-sidebar h-screen flex flex-col shrink-0 select-none">
      {/* Logo */}
      <div className="h-14 flex items-center gap-2.5 px-5 shrink-0 border-b border-sidebar-border">
        <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
          <UtensilsCrossed className="h-4 w-4 text-white" />
        </div>
        <span className="font-bold text-white text-base tracking-tight">RestoPOS</span>
      </div>

      {/* Nav */}
      <div className="flex-1 overflow-y-auto py-3 px-3 space-y-0.5">
        <div className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider px-3 mb-1.5">Cassa</div>
        {mainItems.map((item) => (
          <NavItem key={item.href} {...item} active={location === item.href} />
        ))}

        <div className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider px-3 mt-4 mb-1.5">Gestione</div>
        {adminItems.map((item) => (
          <NavItem key={item.href} {...item} active={location === item.href} />
        ))}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-sidebar-border shrink-0">
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-sidebar-accent cursor-pointer transition-colors">
          <div className="h-8 w-8 rounded-full bg-primary/30 flex items-center justify-center shrink-0">
            <Users className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-white truncate">Admin</div>
            <div className="text-xs text-sidebar-foreground/60 truncate">Manager</div>
          </div>
        </div>
      </div>
    </div>
  );
}
