import { Ticket } from "lucide-react";

// Stessa sintassi usata dal dialogo lotteria avanzato: 8 caratteri A-Z/0-9.
export const isLotteryFormat = (c: string) => /^[A-Z0-9]{8}$/.test(c);

export function LotteryField({ value, onChange, onAdvanced }: {
  value: string; onChange: (v: string) => void; onAdvanced?: () => void;
}) {
  const valid = isLotteryFormat(value);
  return (
    <div className="rounded-xl border-2 border-slate-300 bg-white px-3 py-2 shrink-0" data-testid="lottery-field">
      <div className="flex items-center justify-between mb-1">
        <label htmlFor="input-lottery-code" className="text-[11px] font-bold uppercase tracking-wide text-slate-700 flex items-center gap-1">
          <Ticket className="h-3.5 w-3.5" /> Codice lotteria
        </label>
        {onAdvanced && <button type="button" onClick={onAdvanced} className="text-[11px] font-semibold text-[#1f2633] underline">Tastierino</button>}
      </div>
      <input id="input-lottery-code" data-testid="input-lottery-code" value={value} autoComplete="off" inputMode="text"
        placeholder="Scansiona o digita (8 caratteri)"
        onChange={e => onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
        className="w-full h-11 rounded-lg border border-slate-300 bg-slate-50 px-3 font-mono text-lg font-bold tracking-[0.25em] text-slate-900 outline-none focus:border-[#1f2633]" />
      <div data-testid="status-lottery-format" className={value ? (valid ? "text-xs mt-1 font-bold text-[#1f2633]" : "text-xs mt-1 font-bold text-[#a03f36]") : "text-xs mt-1 text-slate-600"}>
        {!value ? "Facoltativo. Inviato solo con questo pagamento." : valid ? "Formato valido (controllo solo sintattico, non verificato dall'Agenzia)" : `Formato non valido: ${value.length}/8, servono lettere maiuscole o numeri`}
      </div>
    </div>
  );
}
