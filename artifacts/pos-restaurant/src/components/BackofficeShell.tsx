import { Link } from "wouter";
import { ChevronLeft, LogOut, UtensilsCrossed } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { ReactNode } from "react";

export function BackofficeShell({
  title,
  subtitle,
  actions,
  children,
  backHref = "/backoffice",
  isRoot = false,
  fixedHeight = false,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  backHref?: string;
  isRoot?: boolean;
  fixedHeight?: boolean;
}) {
  const { user, logout } = useAuth();

  return (
    <div className="flex flex-col h-screen bg-[#f4f6fa]">
      <header className="h-14 bg-white border-b border-slate-200 flex items-center gap-3 px-4 shrink-0">
        {isRoot ? (
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <UtensilsCrossed className="h-4 w-4 text-white" />
          </div>
        ) : (
          <Link href={backHref}>
            <button className="h-9 w-9 rounded-lg border-2 border-slate-200 flex items-center justify-center hover:border-primary hover:text-primary transition-colors shrink-0">
              <ChevronLeft className="h-5 w-5" />
            </button>
          </Link>
        )}

        <div className="flex-1 min-w-0">
          <h1 className="font-bold text-slate-900 text-base leading-tight truncate">{title}</h1>
          {subtitle && <p className="text-xs text-slate-400 leading-tight truncate">{subtitle}</p>}
        </div>

        {actions && <div className="flex items-center gap-2">{actions}</div>}

        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden sm:flex flex-col text-right">
            <span className="text-xs font-semibold text-slate-700 leading-tight">{user?.name}</span>
            <span className="text-[10px] text-slate-400 leading-tight">
              {user?.role === "admin" ? "Amministratore" : "Dipendente"}
            </span>
          </div>
          <button
            onClick={logout}
            className="h-9 w-9 rounded-lg border-2 border-slate-200 flex items-center justify-center hover:border-red-300 hover:text-red-500 transition-colors"
            title="Esci"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className={cn(
        "flex-1 min-h-0",
        fixedHeight ? "overflow-hidden flex flex-col" : "overflow-y-auto"
      )}>
        {children}
      </div>
    </div>
  );
}
