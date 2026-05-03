import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeftRight, Ticket, Monitor, ListOrdered, Wallet, Sparkles, Award, Boxes, Lock, AlertTriangle, Wand2 } from "lucide-react";
import { BackofficeShell } from "@/components/BackofficeShell";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

type Settings = Record<string, string>;

type Feature = {
  key: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  status: "live" | "beta" | "soon";
};

const FEATURES: Feature[] = [
  {
    key: "feat_table_ops",
    title: "Operazioni tavolo avanzate",
    description: "Sposta ordine su altro tavolo, unisci due ordini, sposta singoli articoli tra conti.",
    icon: ArrowLeftRight,
    status: "live",
  },
  {
    key: "feat_buoni_pasto",
    title: "Buoni pasto",
    description: "Metodo di pagamento dedicato per ticket restaurant (Edenred, Pellegrini, Sodexo). Riga separata sullo scontrino.",
    icon: Ticket,
    status: "live",
  },
  {
    key: "feat_price_lock",
    title: "Blocco prezzi e sconti",
    description: "Solo l'amministratore può applicare sconti o modificare i prezzi al volo. I cassieri non vedono il pulsante Sconto.",
    icon: Lock,
    status: "live",
  },
  {
    key: "feat_alert_totale_anomalo",
    title: "Avviso totali anomali",
    description: "Chiede conferma prima di incassare scontrini sospetti (sotto € 1 o sopra € 500). Evita zeri di troppo o storni accidentali.",
    icon: AlertTriangle,
    status: "live",
  },
  {
    key: "feat_corsi",
    title: "Gestione corsi / portate",
    description: "Invio in cucina differito per corso (1°, 2°, dessert). Il cameriere decide quando far partire ogni portata.",
    icon: ListOrdered,
    status: "soon",
  },
  {
    key: "feat_kds",
    title: "Monitor cucina (KDS)",
    description: "Schermo touch in cucina con stato comande in preparazione/pronto e timer per piatto.",
    icon: Monitor,
    status: "soon",
  },
  {
    key: "feat_chiusura_turno",
    title: "Chiusura turno cassa",
    description: "Apertura/chiusura turno con fondo cassa, conteggio finale, scostamenti rispetto agli scontrini.",
    icon: Wallet,
    status: "soon",
  },
  {
    key: "feat_fidelity",
    title: "Tessera fedeltà a punti",
    description: "Cliente registrato accumula punti, sconto/regalo a soglia. Storico ordini per cliente.",
    icon: Award,
    status: "soon",
  },
  {
    key: "feat_magazzino",
    title: "Magazzino e ricettazione",
    description: "Scarico automatico delle materie prime alla vendita, soglie minime, alert riordino.",
    icon: Boxes,
    status: "soon",
  },
];

const STATUS_BADGE: Record<Feature["status"], { label: string; cls: string }> = {
  live: { label: "Disponibile", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  beta: { label: "Beta",        cls: "bg-amber-100 text-amber-700 border-amber-200" },
  soon: { label: "In arrivo",   cls: "bg-slate-100 text-slate-500 border-slate-200" },
};

export default function FunzioniPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  async function reopenWizard() {
    await fetch(`${API}/settings`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "onboarding_completed", value: "false" }),
    });
    qc.invalidateQueries({ queryKey: ["settings"] });
    setLocation("/onboarding");
  }

  const { data: settings = {} } = useQuery<Settings>({
    queryKey: ["settings"],
    queryFn: () => fetch(`${API}/settings`).then(r => r.json()),
  });

  const toggle = useMutation({
    mutationFn: ({ key, value }: { key: string; value: boolean }) =>
      fetch(`${API}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: value ? "true" : "false" }),
      }).then(r => r.json()),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast({ title: vars.value ? "Funzione attivata" : "Funzione disattivata" });
    },
  });

  const isOn = (k: string) => settings[k] === "true";

  return (
    <BackofficeShell title="Funzioni" subtitle="Attiva o disattiva funzionalità del POS">
      <div className="p-4 md:p-6 max-w-2xl space-y-4">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
          <Sparkles className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
          <div className="text-sm text-blue-900 leading-relaxed">
            Tutte le funzioni qui sono <b>opzionali</b>. Attiva solo quelle che ti servono per
            mantenere l'interfaccia del POS pulita. Le funzioni "In arrivo" sono in
            sviluppo e vanno attivate solo per provarle in anteprima.
          </div>
        </div>

        <div className="bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-200 rounded-xl p-4 flex items-center justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <Wand2 className="h-5 w-5 text-orange-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-semibold text-orange-900">Configurazione guidata</div>
              <div className="text-xs text-orange-700 mt-0.5">Ripeti il wizard di configurazione iniziale (dati attività, sale, menu, personale).</div>
            </div>
          </div>
          <Button size="sm" onClick={reopenWizard} className="bg-orange-500 hover:bg-orange-600 shrink-0">Riapri wizard</Button>
        </div>

        <div className="space-y-2">
          {FEATURES.map(f => {
            const on = isOn(f.key);
            const disabled = f.status === "soon";
            const badge = STATUS_BADGE[f.status];
            return (
              <div key={f.key} className={`flex items-center justify-between p-4 bg-white rounded-xl border-2 shadow-sm transition-all ${on ? "border-primary/40" : "border-slate-200"} ${disabled ? "opacity-70" : ""}`}>
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 ${on ? "bg-primary/10" : "bg-slate-100"}`}>
                    <f.icon className={`h-5 w-5 ${on ? "text-primary" : "text-slate-500"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-800 text-sm">{f.title}</span>
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${badge.cls}`}>{badge.label}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 leading-relaxed">{f.description}</div>
                  </div>
                </div>
                <button
                  disabled={disabled || toggle.isPending}
                  onClick={() => toggle.mutate({ key: f.key, value: !on })}
                  className={`relative inline-flex h-7 w-12 shrink-0 ml-3 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed ${on ? "bg-primary" : "bg-slate-200"}`}
                >
                  <span className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-md transition duration-200 ${on ? "translate-x-5" : "translate-x-0"}`} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </BackofficeShell>
  );
}
