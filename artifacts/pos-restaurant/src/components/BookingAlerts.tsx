import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CalendarClock } from "lucide-react";

const API = `${import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}/api`;

export function BookingAlerts() {
  const { data } = useQuery<unknown[]>({
    queryKey: ["reservations", "pending", "alerts"],
    queryFn: async () => {
      const r = await fetch(`${API}/reservations?status=pending`, { credentials: "include" });
      if (!r.ok) throw new Error("pending");
      const d = await r.json();
      return Array.isArray(d) ? d : [];
    },
    refetchInterval: 15000,
    retry: false,
  });
  const count = Array.isArray(data) ? data.length : 0;
  if (count === 0) return null;
  return (
    <Link href="/backoffice/prenotazioni"
      className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-full bg-amber-500 text-white pl-3 pr-4 h-12 shadow-lg font-bold text-sm"
      data-testid="link-booking-alerts">
      <CalendarClock className="h-5 w-5" />
      {count} {count === 1 ? "richiesta" : "richieste"} di prenotazione
    </Link>
  );
}
