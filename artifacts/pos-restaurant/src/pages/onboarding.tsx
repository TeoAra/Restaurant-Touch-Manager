import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  Building2, Receipt, LayoutGrid, UtensilsCrossed, Package,
  Users, Printer, CheckCircle2, ChevronRight, ChevronLeft, Loader2,
  PartyPopper, SkipForward, Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

type StepKey = "intro" | "attivita" | "cassa" | "sale" | "menu" | "prodotti" | "personale" | "stampanti" | "fine";

const STEPS: Array<{ key: StepKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: "intro", label: "Benvenuto", icon: PartyPopper },
  { key: "attivita", label: "Attività", icon: Building2 },
  { key: "cassa", label: "Cassa RT", icon: Receipt },
  { key: "sale", label: "Sale e tavoli", icon: LayoutGrid },
  { key: "menu", label: "Categorie", icon: UtensilsCrossed },
  { key: "prodotti", label: "Prodotti", icon: Package },
  { key: "personale", label: "Personale", icon: Users },
  { key: "stampanti", label: "Stampanti", icon: Printer },
  { key: "fine", label: "Fine", icon: CheckCircle2 },
];

const CATEGORIE_PRESET = [
  { name: "Antipasti", color: "#fb923c", iva: 10 },
  { name: "Primi", color: "#facc15", iva: 10 },
  { name: "Secondi", color: "#ef4444", iva: 10 },
  { name: "Contorni", color: "#22c55e", iva: 10 },
  { name: "Pizze", color: "#dc2626", iva: 10 },
  { name: "Insalate", color: "#84cc16", iva: 10 },
  { name: "Dolci", color: "#ec4899", iva: 10 },
  { name: "Bibite", color: "#3b82f6", iva: 22 },
  { name: "Birre", color: "#a16207", iva: 22 },
  { name: "Vini", color: "#7c2d12", iva: 22 },
  { name: "Caffetteria", color: "#78350f", iva: 10 },
  { name: "Amari", color: "#581c87", iva: 22 },
];

const TEMPLATES_PRODOTTI: Record<string, Array<{ name: string; price: number; cat: string }>> = {
  pizzeria: [
    { name: "Margherita", price: 6.00, cat: "Pizze" },
    { name: "Marinara", price: 5.00, cat: "Pizze" },
    { name: "Diavola", price: 8.00, cat: "Pizze" },
    { name: "4 Formaggi", price: 9.00, cat: "Pizze" },
    { name: "Capricciosa", price: 9.50, cat: "Pizze" },
    { name: "Bruschetta", price: 4.00, cat: "Antipasti" },
    { name: "Tiramisù", price: 5.00, cat: "Dolci" },
    { name: "Acqua naturale 0.5L", price: 1.50, cat: "Bibite" },
    { name: "Coca Cola 0.33", price: 3.00, cat: "Bibite" },
    { name: "Birra media", price: 5.00, cat: "Birre" },
    { name: "Caffè", price: 1.20, cat: "Caffetteria" },
  ],
  trattoria: [
    { name: "Antipasto della casa", price: 12.00, cat: "Antipasti" },
    { name: "Bruschetta mista", price: 6.00, cat: "Antipasti" },
    { name: "Spaghetti pomodoro", price: 9.00, cat: "Primi" },
    { name: "Penne all'arrabbiata", price: 9.00, cat: "Primi" },
    { name: "Tagliatelle al ragù", price: 11.00, cat: "Primi" },
    { name: "Tagliata di manzo", price: 18.00, cat: "Secondi" },
    { name: "Cotoletta alla milanese", price: 15.00, cat: "Secondi" },
    { name: "Patate fritte", price: 4.00, cat: "Contorni" },
    { name: "Insalata mista", price: 5.00, cat: "Contorni" },
    { name: "Tiramisù", price: 5.00, cat: "Dolci" },
    { name: "Acqua naturale 0.75L", price: 2.50, cat: "Bibite" },
    { name: "Vino della casa 0.5L", price: 8.00, cat: "Vini" },
    { name: "Caffè", price: 1.20, cat: "Caffetteria" },
  ],
  bar: [
    { name: "Caffè", price: 1.20, cat: "Caffetteria" },
    { name: "Cappuccino", price: 1.80, cat: "Caffetteria" },
    { name: "Cornetto", price: 1.50, cat: "Dolci" },
    { name: "Spremuta d'arancia", price: 4.00, cat: "Bibite" },
    { name: "Acqua naturale 0.5L", price: 1.50, cat: "Bibite" },
    { name: "Coca Cola 0.33", price: 3.00, cat: "Bibite" },
    { name: "Birra piccola", price: 4.00, cat: "Birre" },
    { name: "Toast prosciutto e formaggio", price: 4.50, cat: "Antipasti" },
    { name: "Aperol Spritz", price: 6.00, cat: "Amari" },
    { name: "Negroni", price: 8.00, cat: "Amari" },
  ],
};

export default function OnboardingPage() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [stepIdx, setStepIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(true);

  // Stato esistente sul server (per idempotenza + badge "Già configurato")
  const [existing, setExisting] = useState<{
    rooms: Array<{ id: number; name: string }>;
    tables: Array<{ id: number; name: string; roomId: number }>;
    categories: Array<{ id: number; name: string }>;
    products: Array<{ id: number; name: string; categoryId: number }>;
    users: Array<{ id: number; name: string; role: string }>;
  }>({ rooms: [], tables: [], categories: [], products: [], users: [] });

  // Step Attività
  const [attivita, setAttivita] = useState({
    ragioneSociale: "", partitaIva: "", codiceFiscale: "",
    indirizzo: "", cap: "", comune: "", provincia: "",
    telefono: "", email: "",
  });
  const [viesStatus, setViesStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");

  // Step Cassa
  const [cassa, setCassa] = useState({ rtIp: "", codiceCassa: "1", aliquotaDefault: "10" });

  // Step Sale
  const [sale, setSale] = useState({ nomeSala: "Sala Principale", numTavoli: 12 });

  // Step Categorie
  const [catSelected, setCatSelected] = useState<string[]>(["Antipasti", "Primi", "Secondi", "Bibite", "Dolci", "Caffetteria"]);

  // Step Prodotti
  const [template, setTemplate] = useState<"none" | "pizzeria" | "trattoria" | "bar">("none");

  // Step Personale
  const [cassiere, setCassiere] = useState({ name: "", pin: "", role: "cashier" });

  // Refresh idempotenza: ricarica solo le liste collection (no settings)
  // Usato dopo ogni step di creazione per evitare duplicati su retry/back-forward
  // nella stessa sessione del wizard.
  async function refreshExistingCollections() {
    const results = await Promise.allSettled([
      fetch(`${API}/rooms`).then(r => r.json()),
      fetch(`${API}/tables`).then(r => r.json()),
      fetch(`${API}/categories`).then(r => r.json()),
      fetch(`${API}/products`).then(r => r.json()),
      fetch(`${API}/auth/users`).then(r => r.json()),
    ]);
    const pickArr = <T,>(r: PromiseSettledResult<unknown>, fallback: T[]): T[] =>
      r.status === "fulfilled" && Array.isArray(r.value) ? (r.value as T[]) : fallback;
    setExisting(prev => ({
      rooms: pickArr(results[0]!, prev.rooms),
      tables: pickArr(results[1]!, prev.tables),
      categories: pickArr(results[2]!, prev.categories),
      products: pickArr(results[3]!, prev.products),
      users: pickArr(results[4]!, prev.users),
    }));
  }

  // Pre-carica dati esistenti (per pre-popolare + idempotenza).
  // Usa allSettled: se un endpoint fallisce, gli altri popolano comunque
  // i campi corrispondenti (evita di perdere settings cassa per un errore
  // su /products, ecc.).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const results = await Promise.allSettled([
        fetch(`${API}/settings`).then(r => r.json()),
        fetch(`${API}/rooms`).then(r => r.json()),
        fetch(`${API}/tables`).then(r => r.json()),
        fetch(`${API}/categories`).then(r => r.json()),
        fetch(`${API}/products`).then(r => r.json()),
        fetch(`${API}/auth/users`).then(r => r.json()),
      ]);
      if (cancelled) return;
      const settingsR = results[0];
      if (settingsR?.status === "fulfilled" && settingsR.value && typeof settingsR.value === "object") {
        const s = settingsR.value as Record<string, string>;
        setAttivita(a => ({
          ragioneSociale: s["ristorante_ragione_sociale"] || a.ragioneSociale,
          partitaIva: s["ristorante_partita_iva"] || a.partitaIva,
          codiceFiscale: s["ristorante_codice_fiscale"] || a.codiceFiscale,
          indirizzo: s["ristorante_indirizzo"] || a.indirizzo,
          cap: s["ristorante_cap"] || a.cap,
          comune: s["ristorante_comune"] || a.comune,
          provincia: s["ristorante_provincia"] || a.provincia,
          telefono: s["ristorante_telefono"] || a.telefono,
          email: s["ristorante_email"] || a.email,
        }));
        setCassa(c => ({
          rtIp: s["rt_printer_ip"] || c.rtIp,
          codiceCassa: s["rt_codice_cassa"] || c.codiceCassa,
          aliquotaDefault: s["iva_default"] || c.aliquotaDefault,
        }));
      }
      const pickArr = <T,>(r: PromiseSettledResult<unknown> | undefined, fallback: T[]): T[] =>
        r?.status === "fulfilled" && Array.isArray(r.value) ? (r.value as T[]) : fallback;
      setExisting({
        rooms: pickArr(results[1], []),
        tables: pickArr(results[2], []),
        categories: pickArr(results[3], []),
        products: pickArr(results[4], []),
        users: pickArr(results[5], []),
      });
      setLoadingExisting(false);
    })();
    return () => { cancelled = true; };
  }, []);

  async function verificaPiva() {
    const piva = attivita.partitaIva.trim().replace(/\s/g, "");
    if (!piva) { toast({ title: "Inserisci la P.IVA prima di verificare", variant: "destructive" }); return; }
    setViesStatus("loading");
    try {
      const vatParam = piva.toUpperCase().startsWith("IT") ? piva : `IT${piva}`;
      const resp = await fetch(`${API}/vies?vat=${encodeURIComponent(vatParam)}`);
      const data = await resp.json() as {
        valid?: boolean; source?: string; name?: string;
        parsed?: { indirizzo: string; cap: string; comune: string; provincia: string };
      };
      if (!resp.ok || !data.valid) { setViesStatus("error"); toast({ title: "P.IVA non trovata sul VIES", description: "Compila i dati manualmente", variant: "destructive" }); return; }
      setViesStatus("ok");
      const updates: Partial<typeof attivita> = {};
      if (data.name && data.name !== "---") updates.ragioneSociale = data.name;
      if (data.parsed) {
        if (data.parsed.indirizzo) updates.indirizzo = data.parsed.indirizzo;
        if (data.parsed.cap) updates.cap = data.parsed.cap;
        if (data.parsed.comune) updates.comune = data.parsed.comune;
        if (data.parsed.provincia) updates.provincia = data.parsed.provincia;
      }
      setAttivita(a => ({ ...a, ...updates }));
      toast({ title: "Dati recuperati dal VIES" });
    } catch {
      setViesStatus("error");
      toast({ title: "Impossibile contattare il VIES", variant: "destructive" });
    }
  }

  async function patchSettings(payload: Record<string, string>) {
    await fetch(`${API}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  async function saveStepAttivita() {
    setBusy(true);
    try {
      await patchSettings({
        ristorante_ragione_sociale: attivita.ragioneSociale,
        ristorante_partita_iva: attivita.partitaIva,
        ristorante_codice_fiscale: attivita.codiceFiscale,
        ristorante_indirizzo: attivita.indirizzo,
        ristorante_cap: attivita.cap,
        ristorante_comune: attivita.comune,
        ristorante_provincia: attivita.provincia,
        ristorante_telefono: attivita.telefono,
        ristorante_email: attivita.email,
      });
      next();
    } finally { setBusy(false); }
  }

  async function saveStepCassa() {
    setBusy(true);
    try {
      await patchSettings({
        rt_printer_ip: cassa.rtIp,
        rt_codice_cassa: cassa.codiceCassa,
        iva_default: cassa.aliquotaDefault,
      });
      next();
    } finally { setBusy(false); }
  }

  async function saveStepSale() {
    setBusy(true);
    try {
      // Idempotenza: se esiste già una sala con stesso nome, riutilizzala
      const nomeSalaTrim = sale.nomeSala.trim();
      let roomId: number;
      const existingRoom = existing.rooms.find(
        r => r.name.toLowerCase() === nomeSalaTrim.toLowerCase()
      );
      let createdRoom = false;
      if (existingRoom) {
        roomId = existingRoom.id;
      } else {
        const roomResp = await fetch(`${API}/rooms`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: nomeSalaTrim, color: "#3b82f6", sortOrder: 0 }),
        });
        const room = await roomResp.json() as { id: number };
        roomId = room.id;
        createdRoom = true;
      }

      // Crea solo i tavoli mancanti (per nome, all'interno della stessa sala)
      const existingTableNames = new Set(
        existing.tables.filter(t => t.roomId === roomId).map(t => t.name)
      );
      let createdTables = 0;
      for (let i = 1; i <= sale.numTavoli; i++) {
        if (existingTableNames.has(String(i))) continue;
        await fetch(`${API}/tables`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roomId,
            name: String(i),
            capacity: 4,
            posX: 50 + (i - 1) % 6 * 90,
            posY: 50 + Math.floor((i - 1) / 6) * 90,
          }),
        });
        createdTables++;
      }
      qc.invalidateQueries({ queryKey: ["rooms"] });
      qc.invalidateQueries({ queryKey: ["tables"] });
      await refreshExistingCollections();
      const msg = createdRoom
        ? `Creata sala "${nomeSalaTrim}" con ${createdTables} tavoli`
        : createdTables > 0
          ? `Sala già esistente: aggiunti ${createdTables} tavoli`
          : `Sala "${nomeSalaTrim}" già configurata, nessuna modifica`;
      toast({ title: msg });
      next();
    } catch {
      toast({ title: "Errore creazione sala/tavoli", variant: "destructive" });
    } finally { setBusy(false); }
  }

  async function saveStepCategorie() {
    setBusy(true);
    try {
      const existingNames = new Set(existing.categories.map(c => c.name.toLowerCase()));
      let order = existing.categories.length;
      let created = 0;
      for (const name of catSelected) {
        if (existingNames.has(name.toLowerCase())) continue;
        const preset = CATEGORIE_PRESET.find(c => c.name === name);
        if (!preset) continue;
        await fetch(`${API}/categories`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: preset.name, color: preset.color, sortOrder: order++ }),
        });
        created++;
      }
      qc.invalidateQueries({ queryKey: ["categories"] });
      await refreshExistingCollections();
      toast({
        title: created > 0
          ? `Create ${created} categorie (${catSelected.length - created} già presenti)`
          : "Tutte le categorie selezionate erano già presenti",
      });
      next();
    } catch {
      toast({ title: "Errore creazione categorie", variant: "destructive" });
    } finally { setBusy(false); }
  }

  async function saveStepProdotti() {
    if (template === "none") { next(); return; }
    setBusy(true);
    try {
      // Recupera categorie aggiornate (potrebbero essere appena state create)
      const catResp = await fetch(`${API}/categories`);
      const cats = await catResp.json() as Array<{ id: number; name: string }>;
      const prodResp = await fetch(`${API}/products`);
      const prods = await prodResp.json() as Array<{ name: string; categoryId: number }>;
      const existingProdKeys = new Set(prods.map(p => `${p.categoryId}::${p.name.toLowerCase()}`));
      const items = TEMPLATES_PRODOTTI[template] || [];
      let created = 0;
      let skipped = 0;
      for (const p of items) {
        const cat = cats.find(c => c.name === p.cat);
        if (!cat) { skipped++; continue; }
        const key = `${cat.id}::${p.name.toLowerCase()}`;
        if (existingProdKeys.has(key)) { skipped++; continue; }
        await fetch(`${API}/products`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            categoryId: cat.id,
            name: p.name,
            price: p.price.toFixed(2),
            available: true,
          }),
        });
        created++;
      }
      qc.invalidateQueries({ queryKey: ["products"] });
      await refreshExistingCollections();
      toast({
        title: created > 0
          ? `Creati ${created} prodotti${skipped > 0 ? ` (${skipped} già presenti)` : ""}`
          : "Tutti i prodotti del template erano già presenti",
      });
      next();
    } catch {
      toast({ title: "Errore creazione prodotti", variant: "destructive" });
    } finally { setBusy(false); }
  }

  async function saveStepPersonale() {
    if (!cassiere.name.trim() && !cassiere.pin.trim()) { next(); return; }
    if (!cassiere.name.trim() || cassiere.pin.length !== 4) {
      toast({ title: "Compila nome e PIN a 4 cifre, oppure salta", variant: "destructive" });
      return;
    }
    // Idempotenza: skip se utente con stesso nome esiste già
    const nameTrim = cassiere.name.trim();
    if (existing.users.some(u => u.name.toLowerCase() === nameTrim.toLowerCase())) {
      toast({ title: `Utente "${nameTrim}" già esistente, saltato` });
      next();
      return;
    }
    setBusy(true);
    try {
      const resp = await fetch(`${API}/auth/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nameTrim,
          pin: cassiere.pin,
          role: cassiere.role,
        }),
      });
      if (!resp.ok) throw new Error();
      await refreshExistingCollections();
      toast({ title: `Cassiere "${nameTrim}" creato` });
      next();
    } catch {
      toast({ title: "Errore creazione utente", variant: "destructive" });
    } finally { setBusy(false); }
  }

  async function finalizza() {
    setBusy(true);
    try {
      await patchSettings({ onboarding_completed: "true" });
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["setup-status"] });
      toast({ title: "Configurazione completata!", description: "Buon servizio." });
      setLocation("/");
    } finally { setBusy(false); }
  }

  function next() { setStepIdx(i => Math.min(STEPS.length - 1, i + 1)); }
  function prev() { setStepIdx(i => Math.max(0, i - 1)); }
  function skip() { next(); }

  const step = STEPS[stepIdx]!;
  const progress = ((stepIdx) / (STEPS.length - 1)) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
        {/* Header con progresso */}
        <div className="bg-gradient-to-r from-orange-500 to-orange-600 text-white p-6">
          <div className="flex items-center gap-3 mb-2">
            <step.icon className="h-7 w-7" />
            <div>
              <div className="text-xs opacity-90 uppercase tracking-wide font-semibold">Configurazione iniziale · Passo {stepIdx + 1} di {STEPS.length}</div>
              <div className="text-2xl font-bold">{step.label}</div>
            </div>
          </div>
          {/* Barra progresso */}
          <div className="h-1.5 bg-white/20 rounded-full overflow-hidden mt-3">
            <div className="h-full bg-white transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
          {/* Step dots */}
          <div className="flex gap-1 mt-2 justify-between text-[10px] font-semibold">
            {STEPS.map((s, i) => (
              <div key={s.key} className={cn("flex flex-col items-center gap-1 flex-1", i === stepIdx ? "opacity-100" : "opacity-50")}>
                <div className={cn("h-2 w-2 rounded-full", i <= stepIdx ? "bg-white" : "bg-white/30")} />
                <span className="hidden sm:block">{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Contenuto step */}
        <div className="p-6 sm:p-8 min-h-[400px]">
          {step.key === "intro" && (
            <div className="text-center space-y-4 py-8">
              <PartyPopper className="h-16 w-16 text-orange-500 mx-auto" />
              <h2 className="text-3xl font-bold text-slate-800">Benvenuto in HelloTable!</h2>
              <p className="text-slate-600 max-w-md mx-auto">
                Configuriamo insieme il tuo locale in pochi minuti. Ti chiederemo i dati essenziali — potrai sempre modificarli più tardi dal Backoffice.
              </p>
              <div className="grid sm:grid-cols-3 gap-3 max-w-xl mx-auto pt-4">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="text-2xl font-bold text-orange-500">~10 min</div>
                  <div className="text-xs text-slate-500">tempo stimato</div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="text-2xl font-bold text-orange-500">7 step</div>
                  <div className="text-xs text-slate-500">guidati</div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="text-2xl font-bold text-orange-500">VIES</div>
                  <div className="text-xs text-slate-500">P.IVA automatica</div>
                </div>
              </div>
            </div>
          )}

          {step.key === "attivita" && (
            <div className="space-y-4">
              <p className="text-sm text-slate-500">Inserisci i dati della tua attività. Verranno stampati sugli scontrini e usati per le fatture elettroniche.</p>
              <div className="grid sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <Label>Partita IVA *</Label>
                  <div className="flex gap-2">
                    <Input value={attivita.partitaIva} onChange={e => setAttivita(a => ({ ...a, partitaIva: e.target.value }))} placeholder="12345678901" />
                    <Button type="button" onClick={verificaPiva} disabled={viesStatus === "loading"} variant="outline" size="sm" className="shrink-0">
                      {viesStatus === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Search className="h-4 w-4 mr-1" />VIES</>}
                    </Button>
                  </div>
                </div>
                <div>
                  <Label>Codice Fiscale</Label>
                  <Input value={attivita.codiceFiscale} onChange={e => setAttivita(a => ({ ...a, codiceFiscale: e.target.value }))} />
                </div>
              </div>
              <div>
                <Label>Ragione sociale / Nome locale *</Label>
                <Input value={attivita.ragioneSociale} onChange={e => setAttivita(a => ({ ...a, ragioneSociale: e.target.value }))} placeholder="Trattoria da Mario S.r.l." />
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <Label>Indirizzo</Label>
                  <Input value={attivita.indirizzo} onChange={e => setAttivita(a => ({ ...a, indirizzo: e.target.value }))} placeholder="Via Roma 12" />
                </div>
                <div>
                  <Label>CAP</Label>
                  <Input value={attivita.cap} onChange={e => setAttivita(a => ({ ...a, cap: e.target.value }))} />
                </div>
                <div>
                  <Label>Comune</Label>
                  <Input value={attivita.comune} onChange={e => setAttivita(a => ({ ...a, comune: e.target.value }))} />
                </div>
                <div>
                  <Label>Provincia</Label>
                  <Input value={attivita.provincia} onChange={e => setAttivita(a => ({ ...a, provincia: e.target.value }))} placeholder="MI" maxLength={2} />
                </div>
                <div>
                  <Label>Telefono</Label>
                  <Input value={attivita.telefono} onChange={e => setAttivita(a => ({ ...a, telefono: e.target.value }))} />
                </div>
                <div className="sm:col-span-2">
                  <Label>Email</Label>
                  <Input type="email" value={attivita.email} onChange={e => setAttivita(a => ({ ...a, email: e.target.value }))} />
                </div>
              </div>
            </div>
          )}

          {step.key === "cassa" && (
            <div className="space-y-4">
              <p className="text-sm text-slate-500">Configura il collegamento alla tua stampante fiscale (RT). Puoi sempre saltare e configurarla più tardi dal backoffice.</p>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label>IP della RT</Label>
                  <Input value={cassa.rtIp} onChange={e => setCassa(c => ({ ...c, rtIp: e.target.value }))} placeholder="192.168.1.100" />
                </div>
                <div>
                  <Label>Codice cassa</Label>
                  <Input value={cassa.codiceCassa} onChange={e => setCassa(c => ({ ...c, codiceCassa: e.target.value }))} />
                </div>
              </div>
              <div>
                <Label>Aliquota IVA predefinita</Label>
                <div className="grid grid-cols-3 gap-2 mt-1">
                  {["4", "10", "22"].map(a => (
                    <button key={a} onClick={() => setCassa(c => ({ ...c, aliquotaDefault: a }))}
                      className={cn("p-3 rounded-lg border-2 font-bold transition-all",
                        cassa.aliquotaDefault === a ? "border-orange-500 bg-orange-50 text-orange-700" : "border-slate-200 text-slate-600 hover:border-slate-300")}>
                      {a}%
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-400 mt-2">10% per ristorazione, 22% per bevande alcoliche, 4% per beni di prima necessità.</p>
              </div>
            </div>
          )}

          {step.key === "sale" && (
            <div className="space-y-4">
              {existing.rooms.length > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-center gap-2 text-sm text-emerald-800">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>Già configurato: <b>{existing.rooms.length}</b> sale, <b>{existing.tables.length}</b> tavoli. Procedi se vuoi aggiungerne altri (i duplicati verranno saltati).</span>
                </div>
              )}
              <p className="text-sm text-slate-500">Iniziamo con una sala. Potrai aggiungerne altre e disporre i tavoli sulla mappa dal backoffice.</p>
              <div>
                <Label>Nome della sala</Label>
                <Input value={sale.nomeSala} onChange={e => setSale(s => ({ ...s, nomeSala: e.target.value }))} placeholder="Sala Principale" />
              </div>
              <div>
                <Label>Numero di tavoli</Label>
                <div className="flex items-center gap-3 mt-1">
                  <button onClick={() => setSale(s => ({ ...s, numTavoli: Math.max(1, s.numTavoli - 1) }))}
                    className="h-12 w-12 rounded-lg border-2 border-slate-200 hover:border-orange-500 text-2xl font-bold">−</button>
                  <span className="text-5xl font-bold w-20 text-center tabular-nums">{sale.numTavoli}</span>
                  <button onClick={() => setSale(s => ({ ...s, numTavoli: Math.min(100, s.numTavoli + 1) }))}
                    className="h-12 w-12 rounded-lg border-2 border-slate-200 hover:border-orange-500 text-2xl font-bold">+</button>
                </div>
                <div className="flex gap-1.5 mt-3 flex-wrap">
                  {[6, 10, 12, 16, 20, 30].map(n => (
                    <button key={n} onClick={() => setSale(s => ({ ...s, numTavoli: n }))}
                      className={cn("px-3 py-1.5 rounded-lg border text-xs font-semibold",
                        sale.numTavoli === n ? "border-orange-500 bg-orange-50 text-orange-700" : "border-slate-200 text-slate-600")}>
                      {n} tavoli
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-400 mt-2">I tavoli verranno creati con 4 coperti di default e numerati progressivamente.</p>
              </div>
            </div>
          )}

          {step.key === "menu" && (
            <div className="space-y-4">
              {existing.categories.length > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-center gap-2 text-sm text-emerald-800">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>Già presenti <b>{existing.categories.length}</b> categorie. Le selezioni con nome già esistente verranno saltate.</span>
                </div>
              )}
              <p className="text-sm text-slate-500">Seleziona le categorie del tuo menu. Sceglile in base al tipo di locale — potrai modificarle e aggiungerne altre dopo.</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {CATEGORIE_PRESET.map(c => {
                  const sel = catSelected.includes(c.name);
                  return (
                    <button key={c.name}
                      onClick={() => setCatSelected(s => sel ? s.filter(x => x !== c.name) : [...s, c.name])}
                      className={cn("p-3 rounded-lg border-2 flex items-center gap-2 transition-all text-left",
                        sel ? "border-orange-500 bg-orange-50" : "border-slate-200 hover:border-slate-300")}>
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                      <span className={cn("text-sm font-semibold flex-1", sel ? "text-orange-800" : "text-slate-600")}>{c.name}</span>
                      {sel && <CheckCircle2 className="h-4 w-4 text-orange-500 shrink-0" />}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-slate-400">Selezionate: <strong>{catSelected.length}</strong> categorie</p>
            </div>
          )}

          {step.key === "prodotti" && (
            <div className="space-y-4">
              {existing.products.length > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-center gap-2 text-sm text-emerald-800">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>Hai già <b>{existing.products.length}</b> prodotti a menu. I template aggiungeranno solo quelli non ancora presenti.</span>
                </div>
              )}
              <p className="text-sm text-slate-500">Vuoi partire con un menu di esempio? Carichiamo qualche prodotto pronto, così puoi provare subito il sistema. Modificali poi dal backoffice.</p>
              <div className="grid sm:grid-cols-2 gap-3">
                {([
                  { key: "none", label: "Inizia vuoto", desc: "Inserisci tu i prodotti dal backoffice", emoji: "📝" },
                  { key: "pizzeria", label: "Pizzeria", desc: "11 prodotti: pizze classiche, bevande", emoji: "🍕" },
                  { key: "trattoria", label: "Trattoria", desc: "13 prodotti: primi, secondi, contorni", emoji: "🍝" },
                  { key: "bar", label: "Bar / Caffetteria", desc: "10 prodotti: caffè, brioche, drink", emoji: "☕" },
                ] as const).map(t => (
                  <button key={t.key} onClick={() => setTemplate(t.key)}
                    className={cn("p-4 rounded-xl border-2 text-left transition-all",
                      template === t.key ? "border-orange-500 bg-orange-50" : "border-slate-200 hover:border-slate-300")}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-2xl">{t.emoji}</span>
                      <span className="font-bold text-slate-800">{t.label}</span>
                      {template === t.key && <CheckCircle2 className="h-4 w-4 text-orange-500 ml-auto" />}
                    </div>
                    <div className="text-xs text-slate-500">{t.desc}</div>
                  </button>
                ))}
              </div>
              {template !== "none" && catSelected.length > 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                  ⚠️ Verranno importati solo i prodotti delle categorie che hai selezionato nel passo precedente.
                </p>
              )}
            </div>
          )}

          {step.key === "personale" && (
            <div className="space-y-4">
              {existing.users.length > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-center gap-2 text-sm text-emerald-800">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>Già configurati <b>{existing.users.length}</b> utenti. Lascia vuoto per saltare questo passo.</span>
                </div>
              )}
              <p className="text-sm text-slate-500">Hai già il tuo account amministratore. Vuoi aggiungere subito un cassiere o cameriere? Puoi farlo anche dopo dal backoffice → Utenti.</p>
              <div>
                <Label>Nome del dipendente</Label>
                <Input value={cassiere.name} onChange={e => setCassiere(c => ({ ...c, name: e.target.value }))} placeholder="Mario Rossi" />
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label>PIN (4 cifre)</Label>
                  <Input value={cassiere.pin} onChange={e => setCassiere(c => ({ ...c, pin: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
                    placeholder="1234" maxLength={4} className="font-mono text-lg tracking-widest" />
                </div>
                <div>
                  <Label>Ruolo</Label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    {[{ k: "cashier", l: "Cassiere" }, { k: "waiter", l: "Cameriere" }].map(r => (
                      <button key={r.k} onClick={() => setCassiere(c => ({ ...c, role: r.k }))}
                        className={cn("p-2 rounded-lg border-2 text-sm font-semibold",
                          cassiere.role === r.k ? "border-orange-500 bg-orange-50 text-orange-700" : "border-slate-200 text-slate-600")}>
                        {r.l}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <p className="text-xs text-slate-400">Lascia vuoto per saltare. Il PIN serve per accedere alla cassa.</p>
            </div>
          )}

          {step.key === "stampanti" && (
            <div className="space-y-4 text-center py-8">
              <Printer className="h-16 w-16 text-slate-400 mx-auto" />
              <h3 className="text-xl font-bold text-slate-700">Stampanti di reparto</h3>
              <p className="text-sm text-slate-500 max-w-md mx-auto">
                La configurazione delle stampanti di cucina e bar (per le comande) richiede di sapere gli IP esatti delle tue stampanti.<br /><br />
                Ti consigliamo di farlo con calma dal backoffice → <strong>Stampanti</strong>, dove potrai testare ogni stampante prima di assegnarla a una categoria.
              </p>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 max-w-md mx-auto text-left">
                <p className="text-xs text-blue-800">
                  💡 <strong>Suggerimento:</strong> Puoi assegnare ogni categoria a una stampante specifica (es. Pizze → stampante pizzeria, Bibite → stampante bar) per inviare in automatico le comande al reparto giusto.
                </p>
              </div>
            </div>
          )}

          {step.key === "fine" && (
            <div className="text-center space-y-4 py-8">
              <CheckCircle2 className="h-20 w-20 text-green-500 mx-auto" />
              <h2 className="text-3xl font-bold text-slate-800">Tutto pronto! 🎉</h2>
              <p className="text-slate-600 max-w-md mx-auto">
                La configurazione è completa. Puoi iniziare a prendere ordini subito.
              </p>
              <div className="grid sm:grid-cols-2 gap-3 max-w-xl mx-auto pt-4 text-left">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wide">Prossimi passi</div>
                  <ul className="text-sm text-slate-700 mt-1 space-y-1">
                    <li>• Personalizza la mappa dei tavoli</li>
                    <li>• Aggiungi varianti e modificatori</li>
                    <li>• Configura promozioni e happy hour</li>
                  </ul>
                </div>
                <div className="p-3 rounded-lg bg-orange-50 border border-orange-200">
                  <div className="text-xs font-bold text-orange-700 uppercase tracking-wide">Hai bisogno di aiuto?</div>
                  <p className="text-sm text-orange-800 mt-1">Trovi questo wizard sempre disponibile dal Backoffice → Funzioni → "Riapri configurazione guidata".</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer azioni */}
        <div className="border-t border-slate-200 p-4 flex items-center justify-between bg-slate-50">
          <Button variant="ghost" onClick={prev} disabled={stepIdx === 0 || busy}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Indietro
          </Button>
          <div className="flex gap-2">
            {(step.key === "cassa" || step.key === "personale" || step.key === "stampanti" || step.key === "prodotti") && (
              <Button variant="outline" onClick={skip} disabled={busy}>
                <SkipForward className="h-4 w-4 mr-1" /> Salta
              </Button>
            )}
            {step.key === "intro" && (
              <Button onClick={next} className="bg-orange-500 hover:bg-orange-600">
                Iniziamo <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
            {step.key === "attivita" && (
              <Button onClick={saveStepAttivita} disabled={!attivita.ragioneSociale.trim() || busy || loadingExisting} className="bg-orange-500 hover:bg-orange-600">
                {busy || loadingExisting ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Avanti <ChevronRight className="h-4 w-4 ml-1" /></>}
              </Button>
            )}
            {step.key === "cassa" && (
              <Button onClick={saveStepCassa} disabled={busy || loadingExisting} className="bg-orange-500 hover:bg-orange-600">
                {busy || loadingExisting ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Avanti <ChevronRight className="h-4 w-4 ml-1" /></>}
              </Button>
            )}
            {step.key === "sale" && (
              <Button onClick={saveStepSale} disabled={!sale.nomeSala.trim() || sale.numTavoli < 1 || busy || loadingExisting} className="bg-orange-500 hover:bg-orange-600">
                {busy || loadingExisting ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Crea sala <ChevronRight className="h-4 w-4 ml-1" /></>}
              </Button>
            )}
            {step.key === "menu" && (
              <Button onClick={saveStepCategorie} disabled={catSelected.length === 0 || busy || loadingExisting} className="bg-orange-500 hover:bg-orange-600">
                {busy || loadingExisting ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Crea categorie <ChevronRight className="h-4 w-4 ml-1" /></>}
              </Button>
            )}
            {step.key === "prodotti" && (
              <Button onClick={saveStepProdotti} disabled={busy || loadingExisting} className="bg-orange-500 hover:bg-orange-600">
                {busy || loadingExisting ? <Loader2 className="h-4 w-4 animate-spin" /> : <>{template === "none" ? "Avanti" : "Importa"} <ChevronRight className="h-4 w-4 ml-1" /></>}
              </Button>
            )}
            {step.key === "personale" && (
              <Button onClick={saveStepPersonale} disabled={busy || loadingExisting} className="bg-orange-500 hover:bg-orange-600">
                {busy || loadingExisting ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Avanti <ChevronRight className="h-4 w-4 ml-1" /></>}
              </Button>
            )}
            {step.key === "stampanti" && (
              <Button onClick={next} className="bg-orange-500 hover:bg-orange-600">
                Avanti <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
            {step.key === "fine" && (
              <Button onClick={finalizza} disabled={busy} className="bg-green-600 hover:bg-green-700">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Vai alla cassa <ChevronRight className="h-4 w-4 ml-1" /></>}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
