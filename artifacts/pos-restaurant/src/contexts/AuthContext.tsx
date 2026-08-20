import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

export type AppUser = { id: number; name: string; role: "admin" | "employee" };

interface AuthContextValue {
  user: AppUser | null;
  login: (pin: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const SESSION_KEY = "restopos_session";

function loadSession(): AppUser | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(loadSession);

  const login = useCallback(async (pin: string) => {
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (!res.ok) {
        const data = await res.json();
        return { success: false, error: data.error || "PIN non valido" };
      }
      const userData: AppUser = await res.json();
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(userData));
      setUser(userData);
      return { success: true };
    } catch {
      return { success: false, error: "Errore di connessione" };
    }
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, isAdmin: user?.role === "admin" }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
