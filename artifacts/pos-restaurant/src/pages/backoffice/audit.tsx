import { useEffect, useMemo, useState } from "react";
import { BackofficeShell } from "@/components/BackofficeShell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, Filter, X } from "lucide-react";

const API = "/api";

type AuditRow = {
  id: number;
  userId: number | null;
  userName: string | null;
  action: string;
  entityType: string | null;
  entityId: number | null;
  details: unknown;
  createdAt: string;
};

const ACTIONS = [
  { value: "", label: "Tutte le azioni" },
  { value: "order.cancel", label: "Annullamento ordine" },
  { value: "order.discount", label: "Sconto applicato" },
  { value: "order.sospeso", label: "Conto sospeso" },
  { value: "item.delete", label: "Cancellazione articolo" },
  { value: "item.void", label: "Storno articolo" },
  { value: "drawer.open", label: "Apertura cassetto" },
  { value: "payment.refund", label: "Rimborso" },
];

const ENTITY_TYPES = [
  { value: "", label: "Tutti i tipi" },
  { value: "order", label: "Ordine" },
  { value: "item", label: "Articolo" },
  { value: "payment", label: "Pagamento" },
  { value: "drawer", label: "Cassetto" },
];

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function actionLabel(a: string): string {
  return ACTIONS.find(x => x.value === a)?.label ?? a;
}

function actionTone(a: string): string {
  if (a.startsWith("order.cancel") || a.startsWith("item.delete") || a.startsWith("item.void")) return "bg-red-50 text-red-700 border-red-200";
  if (a.startsWith("order.discount") || a.startsWith("payment.refund")) return "bg-amber-50 text-amber-700 border-amber-200";
  if (a.startsWith("order.sospeso")) return "bg-blue-50 text-blue-700 border-blue-200";
  if (a.startsWith("drawer")) return "bg-purple-50 text-purple-700 border-purple-200";
  return "bg-slate-50 text-slate-700 border-slate-200";
}

function summarizeDetails(d: unknown): string {
  if (!d || typeof d !== "object") return "";
  const obj = d as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof obj.tableId === "number") parts.push(`tavolo #${obj.tableId}`);
  if (typeof obj.total === "string" || typeof obj.total === "number") parts.push(`€ ${obj.total}`);
  if (typeof obj.items === "number") parts.push(`${obj.items} art.`);
  if (typeof obj.reason === "string" && obj.reason) parts.push(`motivo: ${obj.reason}`);
  if (typeof obj.amount === "string" || typeof obj.amount === "number") parts.push(`importo € ${obj.amount}`);
  if (typeof obj.discountType === "string") parts.push(`sconto ${obj.discountType} ${obj.discountValue ?? ""}`);
  return parts.join(" · ");
}

export default function AuditPage() {
  const today = new Date().toISOString().split("T")[0];
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().split("T")[0];
  const [from, setFrom] = useState(sevenDaysAgo);
  const [to, setTo] = useState(today);
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [user, setUser] = useState("");
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", `${from}T00:00:00`);
      if (to) params.set("to", `${to}T23:59:59`);
      if (action) params.set("action", action);
      if (entityType) params.set("entityType", entityType);
      params.set("limit", "500");
      const r = await fetch(`${API}/audit?${params.toString()}`);
      const data: AuditRow[] = await r.json();
      setRows(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const q = user.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => (r.userName ?? "").toLowerCase().includes(q));
  }, [rows, user]);

  const reset = () => {
    setFrom(sevenDaysAgo);
    setTo(today);
    setAction("");
    setEntityType("");
    setUser("");
  };

  return (
    <BackofficeShell title="Audit Log" subtitle="Storico azioni sensibili (sconti, storni, annullamenti, cassetto)">
      <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
        {/* Filtri */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="h-4 w-4 text-slate-500" />
            <span className="text-sm font-bold text-slate-700">Filtri</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <Label className="text-xs">Da</Label>
              <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">A</Label>
              <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Azione</Label>
              <Select value={action || "__all"} onValueChange={v => setAction(v === "__all" ? "" : v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTIONS.map(a => (
                    <SelectItem key={a.value || "__all"} value={a.value || "__all"}>{a.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Tipo entità</Label>
              <Select value={entityType || "__all"} onValueChange={v => setEntityType(v === "__all" ? "" : v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPES.map(a => (
                    <SelectItem key={a.value || "__all"} value={a.value || "__all"}>{a.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Cameriere / utente</Label>
              <Input placeholder="Es. Mario" value={user} onChange={e => setUser(e.target.value)} className="mt-1" />
            </div>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <Button onClick={load} disabled={loading} size="sm">
              {loading ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />Caricamento…</> : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Aggiorna</>}
            </Button>
            <Button variant="outline" size="sm" onClick={reset}>
              <X className="h-3.5 w-3.5 mr-1.5" />Azzera filtri
            </Button>
            <span className="text-xs text-slate-500 ml-auto">{filtered.length} risultati</span>
          </div>
        </div>

        {/* Tabella */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-400">
              {loading ? "Caricamento…" : "Nessun evento nel periodo / filtri selezionati."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-4 py-2 font-semibold text-slate-600 text-xs uppercase tracking-wide">Data/Ora</th>
                    <th className="text-left px-4 py-2 font-semibold text-slate-600 text-xs uppercase tracking-wide">Utente</th>
                    <th className="text-left px-4 py-2 font-semibold text-slate-600 text-xs uppercase tracking-wide">Azione</th>
                    <th className="text-left px-4 py-2 font-semibold text-slate-600 text-xs uppercase tracking-wide">Entità</th>
                    <th className="text-left px-4 py-2 font-semibold text-slate-600 text-xs uppercase tracking-wide">Dettagli</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => (
                    <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-2 text-slate-700 whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                      <td className="px-4 py-2 text-slate-700">{r.userName ?? <span className="text-slate-400">—</span>}</td>
                      <td className="px-4 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded-md border text-xs font-semibold ${actionTone(r.action)}`}>
                          {actionLabel(r.action)}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-600 text-xs">
                        {r.entityType ?? "—"}{r.entityId ? ` #${r.entityId}` : ""}
                      </td>
                      <td className="px-4 py-2 text-slate-600 text-xs">{summarizeDetails(r.details) || <span className="text-slate-400">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </BackofficeShell>
  );
}
