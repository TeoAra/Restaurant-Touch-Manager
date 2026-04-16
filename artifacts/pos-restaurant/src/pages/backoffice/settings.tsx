import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings2, ShoppingBag, Truck, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

type AppSettings = Record<string, string>;

function fetchSettings(): Promise<AppSettings> {
  return fetch(`${API}/settings`).then(r => r.json());
}

function SettingRow({ title, description, icon: Icon, settingKey, value, onToggle }: {
  title: string; description: string;
  icon: React.ComponentType<{ className?: string }>;
  settingKey: string; value: boolean;
  onToggle: (key: string, value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between p-5 bg-white rounded-xl border border-slate-200 shadow-sm">
      <div className="flex items-center gap-4">
        <div className="h-11 w-11 rounded-xl bg-orange-50 flex items-center justify-center">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <div className="font-semibold text-slate-800">{title}</div>
          <div className="text-sm text-slate-400 mt-0.5">{description}</div>
        </div>
      </div>
      <button
        onClick={() => onToggle(settingKey, !value)}
        className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${value ? "bg-primary" : "bg-slate-200"}`}
      >
        <span className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${value ? "translate-x-5" : "translate-x-0"}`} />
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: settings = {} } = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });

  const toggle = useMutation({
    mutationFn: ({ key, value }: { key: string; value: boolean }) =>
      fetch(`${API}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: value ? "true" : "false" }),
      }).then(r => r.json()),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast({ title: vars.value ? "Funzionalità abilitata" : "Funzionalità disabilitata" });
    },
  });

  const getBool = (key: string) => settings[key] === "true";

  const settingDefs = [
    {
      key: "enable_asporto",
      title: "Asporto",
      description: "Permette di creare ordini da asporto (take away) senza assegnare un tavolo",
      icon: ShoppingBag,
    },
    {
      key: "enable_delivery",
      title: "Delivery / Consegna a domicilio",
      description: "Abilita la modalità consegna a domicilio con indirizzo cliente",
      icon: Truck,
    },
  ];

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-8">
        <Settings2 className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Impostazioni</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Configura le funzionalità opzionali del sistema</p>
        </div>
      </div>

      <div className="space-y-3 mb-8">
        <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 px-1">Modalità ordine</h2>
        <div className="space-y-2">
          {settingDefs.map(s => (
            <SettingRow key={s.key} title={s.title} description={s.description}
              icon={s.icon} settingKey={s.key}
              value={getBool(s.key)}
              onToggle={(key, value) => toggle.mutate({ key, value })} />
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 px-1">Cassa rapida</h2>
        <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="h-11 w-11 rounded-xl bg-emerald-50 flex items-center justify-center">
              <Zap className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <div className="font-semibold text-slate-800">Bevuta Rapida / Scontrino Immediato</div>
              <div className="text-sm text-slate-400 mt-0.5">
                Sempre disponibile in cassa — crea uno scontrino immediato senza assegnare un tavolo. Ideale per clienti al banco o bevute veloci.
              </div>
            </div>
            <div className="ml-auto shrink-0">
              <span className="px-2.5 py-1 text-xs font-semibold bg-emerald-50 text-emerald-700 rounded-full border border-emerald-200">Sempre attivo</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
