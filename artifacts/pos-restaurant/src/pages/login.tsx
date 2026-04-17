import { useState } from "react";
import { UtensilsCrossed, Delete } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const KEYS = ["1","2","3","4","5","6","7","8","9","","0","⌫"];

export default function LoginPage() {
  const { login } = useAuth();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleKey(k: string) {
    if (loading) return;
    if (k === "⌫") { setPin(p => p.slice(0, -1)); setError(""); return; }
    if (!k) return;
    const newPin = pin + k;
    setPin(newPin);
    setError("");

    if (newPin.length === 4) {
      setLoading(true);
      const result = await login(newPin);
      setLoading(false);
      if (!result.success) {
        setError(result.error || "PIN non valido");
        setTimeout(() => setPin(""), 500);
      }
    }
  }

  return (
    <div className="min-h-screen bg-[#f4f6fa] flex items-center justify-center">
      <div className="bg-white rounded-3xl shadow-xl p-8 w-80 flex flex-col items-center gap-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div className="h-14 w-14 rounded-2xl bg-primary flex items-center justify-center shadow-md">
            <UtensilsCrossed className="h-7 w-7 text-white" />
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-slate-800">Hello<span className="text-primary">Table</span></div>
            <div className="text-sm text-slate-400 mt-0.5">Inserisci il tuo PIN</div>
          </div>
        </div>

        {/* PIN display */}
        <div className="flex gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={cn(
              "h-14 w-14 rounded-xl border-2 flex items-center justify-center transition-all",
              pin.length > i
                ? "border-primary bg-primary/10"
                : "border-slate-200 bg-slate-50",
              error && "border-red-400 bg-red-50"
            )}>
              {pin.length > i && <div className={cn("h-4 w-4 rounded-full", error ? "bg-red-400" : "bg-primary")} />}
            </div>
          ))}
        </div>

        {error && (
          <p className="text-sm text-red-500 font-medium -mt-2 text-center">{error}</p>
        )}

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-2.5 w-full">
          {KEYS.map((k, i) => (
            <button key={i} onClick={() => handleKey(k)}
              disabled={!k || loading || pin.length >= 4}
              className={cn(
                "h-14 rounded-xl text-xl font-bold transition-all active:scale-90",
                k === "⌫"
                  ? "bg-red-50 text-red-500 hover:bg-red-100 border border-red-200"
                  : k
                  ? "bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200"
                  : "invisible"
              )}>
              {k === "⌫" ? <Delete className="h-5 w-5 mx-auto" /> : k}
            </button>
          ))}
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            Verifica in corso...
          </div>
        )}
      </div>
    </div>
  );
}
