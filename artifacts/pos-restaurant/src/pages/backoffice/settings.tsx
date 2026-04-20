import { useState, useEffect, memo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings2, ShoppingBag, Truck, Zap, Users, Building2 } from "lucide-react";
import { BackofficeShell } from "@/components/BackofficeShell";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

const DField = memo(function DField({ label, val, setVal, placeholder, className }: {
  label: string; val: string; setVal: (v: string) => void; placeholder?: string; className?: string;
}) {
  return (
    <div className={className}>
      <Label className="text-xs text-slate-500 mb-1 block">{label}</Label>
      <Input value={val} onChange={e => setVal(e.target.value)} placeholder={placeholder} className="h-9 text-sm" />
    </div>
  );
});

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

  const [coverPrice, setCoverPrice] = useState("");
  useEffect(() => { if (settings.cover_price !== undefined) setCoverPrice(settings.cover_price); }, [settings.cover_price]);

  const [ditaForm, setDittaForm] = useState({ ragione_sociale: "", partita_iva: "", codice_fiscale: "", indirizzo: "", cap: "", comune: "", provincia: "", regime_fiscale: "RF01" });
  useEffect(() => {
    if (Object.keys(settings).length > 0) {
      setDittaForm(f => ({
        ragione_sociale: settings.ragione_sociale ?? f.ragione_sociale,
        partita_iva: settings.partita_iva ?? f.partita_iva,
        codice_fiscale: settings.codice_fiscale ?? f.codice_fiscale,
        indirizzo: settings.indirizzo ?? f.indirizzo,
        cap: settings.cap ?? f.cap,
        comune: settings.comune ?? f.comune,
        provincia: settings.provincia ?? f.provincia,
        regime_fiscale: settings.regime_fiscale ?? "RF01",
      }));
    }
  }, [settings]);

  async function saveMultiple(pairs: Record<string, string>) {
    for (const [key, value] of Object.entries(pairs)) {
      await fetch(`${API}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
    }
    qc.invalidateQueries({ queryKey: ["settings"] });
  }

  const saveCoverPrice = useMutation({
    mutationFn: () => fetch(`${API}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "cover_price", value: coverPrice }),
    }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings"] }); toast({ title: "Prezzo coperto salvato" }); },
  });

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

  const REGIME_FISCALE_OPTIONS = [
    { v: "RF01", l: "RF01 – Ordinario" }, { v: "RF02", l: "RF02 – Contribuenti minimi" },
    { v: "RF04", l: "RF04 – Agricoltura speciale" }, { v: "RF05", l: "RF05 – Vendita sali e tabacchi" },
    { v: "RF10", l: "RF10 – Attività sportive" }, { v: "RF17", l: "RF17 – Agriturismo" },
    { v: "RF18", l: "RF18 – Vendita a domicilio" }, { v: "RF19", l: "RF19 – Regime forfetario" },
  ];

  return (
    <BackofficeShell title="Impostazioni" subtitle="Funzionalità e configurazione sistema">
    <div className="p-4 md:p-6 max-w-2xl space-y-8">

      {/* Dati ditta per fatturazione */}
      <div className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 px-1 flex items-center gap-2">
          <Building2 className="h-3.5 w-3.5" /> Dati Azienda (per Fatturazione Elettronica)
        </h2>
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3">
          <div className="grid grid-cols-1 gap-3">
            <DField label="Ragione Sociale / Denominazione" val={ditaForm.ragione_sociale} setVal={v => setDittaForm(f => ({ ...f, ragione_sociale: v }))} placeholder="Ristorante La Pergola S.r.l." />
            <div className="grid grid-cols-2 gap-3">
              <DField label="Partita IVA" val={ditaForm.partita_iva} setVal={v => setDittaForm(f => ({ ...f, partita_iva: v }))} placeholder="12345678901" />
              <DField label="Codice Fiscale" val={ditaForm.codice_fiscale} setVal={v => setDittaForm(f => ({ ...f, codice_fiscale: v }))} placeholder="RSSMRA80A01H501U" />
            </div>
            <DField label="Indirizzo" val={ditaForm.indirizzo} setVal={v => setDittaForm(f => ({ ...f, indirizzo: v }))} placeholder="Via Roma 1" />
            <div className="grid grid-cols-3 gap-3">
              <DField label="CAP" val={ditaForm.cap} setVal={v => setDittaForm(f => ({ ...f, cap: v }))} placeholder="00100" />
              <DField label="Comune" val={ditaForm.comune} setVal={v => setDittaForm(f => ({ ...f, comune: v }))} placeholder="Roma" className="col-span-2" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <DField label="Provincia" val={ditaForm.provincia} setVal={v => setDittaForm(f => ({ ...f, provincia: v }))} placeholder="RM" />
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">Regime Fiscale</Label>
                <select value={ditaForm.regime_fiscale} onChange={e => setDittaForm(f => ({ ...f, regime_fiscale: e.target.value }))}
                  className="w-full h-9 px-3 rounded-md border border-slate-200 text-sm bg-white">
                  {REGIME_FISCALE_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
              </div>
            </div>
          </div>
          <div className="flex justify-end pt-1">
            <Button size="sm" onClick={async () => { await saveMultiple(ditaForm); toast({ title: "Dati azienda salvati" }); }}>
              Salva Dati Azienda
            </Button>
          </div>
        </div>
      </div>

      {/* Cover charge */}
      <div className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 px-1">Prezzi</h2>
        <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="h-11 w-11 rounded-xl bg-blue-50 flex items-center justify-center">
                <Users className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <div className="font-semibold text-slate-800">Prezzo Coperto</div>
                <div className="text-sm text-slate-400 mt-0.5">Addebito per coperto aggiunto automaticamente al conto (0 = disabilitato)</div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-slate-500 text-sm font-medium">€</span>
              <Input type="number" min="0" step="0.50" value={coverPrice}
                onChange={e => setCoverPrice(e.target.value)}
                className="w-24 text-right font-mono" />
              <Button size="sm" onClick={() => saveCoverPrice.mutate()}>Salva</Button>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
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
    </BackofficeShell>
  );
}
