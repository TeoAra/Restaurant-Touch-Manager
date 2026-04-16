import { Link, useLocation } from "wouter";
import { LayoutDashboard, Receipt, Settings, UtensilsCrossed, Package, LayoutGrid, BarChart3, CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const [location] = useLocation();

  const navItems = [
    { href: "/", icon: LayoutDashboard, label: "Front Office" },
    { href: "/orders", icon: Receipt, label: "Active Orders" },
    { href: "/backoffice", icon: Settings, label: "Back Office" },
  ];

  const backOfficeItems = [
    { href: "/backoffice/menu", icon: UtensilsCrossed, label: "Menu" },
    { href: "/backoffice/tables", icon: LayoutGrid, label: "Tables" },
    { href: "/backoffice/reports", icon: BarChart3, label: "Reports" },
    { href: "/backoffice/payments", icon: CreditCard, label: "Payments" },
  ];

  const isBackOffice = location.startsWith("/backoffice");

  return (
    <div className="w-64 bg-sidebar border-r border-border h-screen flex flex-col shrink-0">
      <div className="h-16 flex items-center px-6 border-b border-border shrink-0">
        <div className="flex items-center gap-2 text-primary font-bold text-xl">
          <UtensilsCrossed className="h-6 w-6" />
          <span>RestoPOS</span>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto py-4 flex flex-col gap-2 px-3">
        <div className="space-y-1 mb-4">
          <div className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Main</div>
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className={cn(
              "flex items-center gap-3 px-3 py-3 rounded-md transition-colors font-medium hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              location === item.href ? "bg-sidebar-accent text-sidebar-accent-foreground border-l-2 border-primary" : "text-muted-foreground"
            )}>
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          ))}
        </div>

        {isBackOffice && (
          <div className="space-y-1 mt-4">
            <div className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Management</div>
            {backOfficeItems.map((item) => (
              <Link key={item.href} href={item.href} className={cn(
                "flex items-center gap-3 px-3 py-3 rounded-md transition-colors font-medium hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                location === item.href ? "bg-sidebar-accent text-sidebar-accent-foreground border-l-2 border-primary" : "text-muted-foreground"
              )}>
                <item.icon className="h-5 w-5" />
                {item.label}
              </Link>
            ))}
          </div>
        )}
      </div>
      
      <div className="p-4 border-t border-border shrink-0">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">
            A
          </div>
          <div>
            <div className="font-medium text-sm text-foreground">Admin User</div>
            <div className="text-xs text-muted-foreground">Manager</div>
          </div>
        </div>
      </div>
    </div>
  );
}
