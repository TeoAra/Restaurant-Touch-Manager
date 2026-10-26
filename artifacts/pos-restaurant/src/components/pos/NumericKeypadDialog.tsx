import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Delete, Lock } from "lucide-react";

export type KeypadField = {
  key: string;
  label: string;
  value: string;
  prefix?: string;        // e.g. "€"
  decimals?: number;      // 0 = integer only
  locked?: boolean;       // read-only (price lock)
  min?: number;
  max?: number;
  hint?: string;
};

type Props = {
  open: boolean;
  title: string;
  subtitle?: string;
  fields: KeypadField[];
  confirmLabel?: string;
  busy?: boolean;
  /** Optional computed line shown under the fields, e.g. total */
  summary?: (values: Record<string, number>) => string;
  onClose: () => void;
  onConfirm: (values: Record<string, string>) => void;
};

function toNum(s: string) { const n = parseFloat(s.replace(",", ".")); return Number.isFinite(n) ? n : 0; }

export function NumericKeypadDialog({ open, title, subtitle, fields, confirmLabel = "Conferma", busy, summary, onClose, onConfirm }: Props) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [active, setActive] = useState("");
  const [fresh, setFresh] = useState(true); // next digit replaces the value

  useEffect(() => {
    if (!open) return;
    const v: Record<string, string> = {};
    fields.forEach(f => { v[f.key] = f.value; });
    setVals(v);
    setActive((fields.find(f => !f.locked) ?? fields[0])?.key ?? "");
    setFresh(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const field = fields.find(f => f.key === active);

  function press(k: string) {
    if (!field || field.locked) return;
    const dec = field.decimals ?? 0;
    setVals(prev => {
      let cur = fresh ? "" : (prev[field.key] ?? "");
      if (k === "C") return { ...prev, [field.key]: "0" };
      if (k === "<") { cur = (prev[field.key] ?? "").slice(0, -1); return { ...prev, [field.key]: cur || "0" }; }
      if (k === ".") {
        if (dec === 0 || cur.includes(".")) return prev;
        cur = (cur || "0") + ".";
      } else {
        if (cur === "0") cur = "";
        cur += k;
        const [, d = ""] = cur.split(".");
        if (d.length > dec) return prev;
        if (cur.replace(".", "").length > 7) return prev;
      }
      return { ...prev, [field.key]: cur };
    });
    setFresh(false);
  }

  const nums: Record<string, number> = {};
  fields.forEach(f => { nums[f.key] = toNum(vals[f.key] ?? f.value); });
  const invalid = fields.some(f => {
    const n = nums[f.key];
    return (f.min != null && n < f.min) || (f.max != null && n > f.max);
  });

  function confirm() {
    if (invalid || busy) return;
    const out: Record<string, string> = {};
    fields.forEach(f => {
      const n = nums[f.key];
      out[f.key] = (f.decimals ?? 0) > 0 ? n.toFixed(f.decimals) : String(Math.round(n));
    });
    onConfirm(out);
  }

  const keys = ["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "<"];

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-sm w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-1.5rem)] overflow-y-auto p-4 gap-3" data-testid="dialog-keypad">
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
          {subtitle && <div className="text-xs text-slate-600">{subtitle}</div>}
        </DialogHeader>

        <div className={cn("grid gap-2", fields.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
          {fields.map(f => (
            <button key={f.key} type="button" disabled={f.locked}
              data-testid={`keypad-field-${f.key}`}
              onClick={() => { setActive(f.key); setFresh(true); }}
              className={cn(
                "rounded-xl border-2 px-3 py-2 text-left min-h-[64px]",
                active === f.key ? "border-primary bg-[#edf5e9]" : "border-slate-300 bg-white",
                f.locked && "opacity-80 bg-slate-100",
              )}>
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-600 flex items-center gap-1">
                {f.label}{f.locked && <Lock className="h-3 w-3" />}
              </div>
              <div className="text-2xl font-extrabold text-slate-900 tabular-nums">
                {f.prefix}{vals[f.key] ?? f.value}
              </div>
              {f.locked && <div className="text-[10px] text-slate-600">Bloccato: solo amministratore</div>}
              {!f.locked && f.hint && <div className="text-[10px] text-slate-600">{f.hint}</div>}
            </button>
          ))}
        </div>

        {summary && (
          <div className="rounded-lg bg-[#174f43] text-white px-3 py-2 text-sm font-bold flex justify-between" data-testid="keypad-summary">
            {summary(nums)}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          {keys.map(k => (
            <button key={k} type="button" data-testid={`keypad-key-${k === "<" ? "back" : k}`}
              disabled={k === "." && (field?.decimals ?? 0) === 0}
              onClick={() => press(k)}
              className="h-14 rounded-xl border-2 border-slate-300 bg-white text-slate-900 text-2xl font-bold active:bg-[#edf5e9] disabled:opacity-30 flex items-center justify-center">
              {k === "<" ? <Delete className="h-6 w-6" /> : k === "." ? "," : k}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button type="button" onClick={() => press("C")} data-testid="keypad-clear"
            className="h-12 rounded-xl border-2 border-slate-300 bg-slate-100 text-slate-800 font-bold">Azzera</button>
          <button type="button" onClick={onClose} data-testid="keypad-cancel"
            className="h-12 rounded-xl border-2 border-slate-300 bg-white text-slate-800 font-bold">Annulla</button>
          <button type="button" onClick={confirm} disabled={invalid || busy} data-testid="keypad-confirm"
            className="h-12 rounded-xl bg-[#174f43] text-white font-bold disabled:opacity-40">{confirmLabel}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
