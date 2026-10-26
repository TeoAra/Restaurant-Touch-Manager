import { ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { BookingAlerts } from "@/components/BookingAlerts";

export function Layout({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  return <>{children}{isAdmin && <BookingAlerts />}</>;
}
