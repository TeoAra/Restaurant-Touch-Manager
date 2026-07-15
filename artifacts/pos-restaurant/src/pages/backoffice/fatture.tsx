import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BackofficeShell } from "@/components/BackofficeShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Plus, Download, FileText, Trash2, Send, Users, ChevronRight,
  Building2, CheckCircle2, AlertCircle, Printer, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

type Invoice = {
  id: number; numero: number; anno: number; data: string; customerId?: number;
  tipoDocumento: string; imponibile: string; aliquotaIva: string; iva: string; totale: string;
  stato: string; ragioneSociale?: string; note?: string; righe?: string; orderId?: number;
};

type Customer = {
  id: number; ragioneSociale: string; tipo?: string; partitaIva?: string;
  codiceFiscale?: string; pec?: string; codiceDestinatario?: string;
  indirizzo?: string; cap?: string; comune?: string; provincia?: string; nazione?: string;
};

function useInvoices() {
  return useQuery<Invoice[]>({
    queryKey: ["invoices"],
    queryFn: () => fetch(`${API}/invoices`).then(r => r.json()),
  });
}

function useCustomers() {
  return useQuery<Customer[]>({
    queryKey: ["customers"],
    queryFn: () => fetch(`${API}/customers`).then(r => r.json()),
  });
}

type RigaFattura = { descrizione: string; quantita: string; prezzoUnitario: string; importo: string; aliquotaIva: string };

const STATO_CFG: Record<string, { label: string; cls: string }> = {
  bozza: { label: "Bozza", cls: "bg-slate-100 text-slate-600 border-slate-200" },
  emessa: { label: "Emessa", cls: "bg-green-50 text-green-700 border-green-200" },
  annullata: { label: "Annullata", cls: "bg-red-50 text-red-600 border-red-200" },
};

const TIPI_DOCUMENTO = [
  { v: "TD01", l: "TD01 – Fattura" },
  { v: "TD04", l: "TD04 – Nota di credito" },
  { v: "TD07", l: "TD07 – Fattura semplificata" },
];

const BLANK_CUSTOMER = {
  ragioneSociale: "", tipo: "privato", partitaIva: "", codiceFiscale: "",
  pec: "", codiceDestinatario: "0000000", indirizzo: "", cap: "", comune: "",
  provincia: "", nazione: "IT",
};

export default function FatturePage() {
  const [activeTab, setActiveTab] = useState<"fatture" | "clienti">("fatture");
  const [dialog, setDialog] = useState<{ open: boolean; item?: Invoice }>({ open: false });
  const [xmlDialog, setXmlDialog] = useState<{
    open: boolean; xml?: string; filename?: string; rtOk?: boolean; rtError?: string;
  }>({ open: false });
  const [customerDialog, setCustomerDialog] = useState<{ open: boolean; item?: Customer }>({ open: false });
  const [customerForm, setCustomerForm] = useState({ ...BLANK_CUSTOMER });
  const [customerSaving, setCustomerSaving] = useState(false);

  const [form, setForm] = useState({
    numero: "",
    customerId: "", tipoDocumento: "TD01", data: new Date().toISOString().slice(0, 10),
    aliquotaIva: "22", righe: [{ descrizione: "Servizi ristorazione", quantita: "1", prezzoUnitario: "", importo: "", aliquotaIva: "22" }] as RigaFattura[],
    note: "",
  });
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: invoices = [] } = useInvoices();
  const { data: customers = [] } = useCustomers();

  function calcRow(r: RigaFattura) {
    const q = parseFloat(r.quantita) || 1;
    const pu = parseFloat(r.prezzoUnitario) || 0;
    return { ...r, importo: (q * pu).toFixed(2) };
  }

  function totals() {
    const imponibile = form.righe.reduce((s, r) => s + (parseFloat(r.importo) || parseFloat(r.prezzoUnitario) * (parseFloat(r.quantita) || 1) || 0), 0);
    const aliq = parseFloat(form.aliquotaIva) || 22;
    const iva = imponibile * aliq / 100;
    return { imponibile: imponibile.toFixed(2), iva: iva.toFixed(2), totale: (imponibile + iva).toFixed(2) };
  }

  function updateRow(i: number, k: keyof RigaFattura, v: string) {
    setForm(f => {
      const righe = [...f.righe];
      righe[i] = calcRow({ ...righe[i], [k]: v });
      return { ...f, righe };
    });
  }

  function addRow() {
    setForm(f => ({
      ...f,
      righe: [...f.righe, { descrizione: "", quantita: "1", prezzoUnitario: "", importo: "", aliquotaIva: form.aliquotaIva }],
    }));
  }

  function removeRow(i: number) {
    setForm(f => ({ ...f, righe: f.righe.filter((_, idx) => idx !== i) }));
  }

  function openNew() {
    setForm({
      numero: "",
      customerId: "", tipoDocumento: "TD01", data: new Date().toISOString().slice(0, 10),
      aliquotaIva: "22", righe: [{ descrizione: "Servizi ristorazione", quantita: "1", prezzoUnitario: "", importo: "", aliquotaIva: "22" }],
      note: "",
    });
    setDialog({ open: true });
  }

  // Parsa formato "N" oppure "N/ANNO"
  function parseNumeroAnno(s: string): { numero?: number; anno?: number } {
    const trimmed = s.trim();
    if (!trimmed) return {};
    const slash = trimmed.indexOf("/");
    if (slash === -1) {
      const n = parseInt(trimmed, 10);
      return isNaN(n) ? {} : { numero: n };
    }
    const n = parseInt(trimmed.slice(0, slash), 10);
    const a = parseInt(trimmed.slice(slash + 1), 10);
    if (isNaN(n)) return {};
    return { numero: n, ...(isNaN(a) ? {} : { anno: a }) };
  }

  async function handleSave() {
    const t = totals();
    const parsed = parseNumeroAnno(form.numero);
    const body: Record<string, unknown> = {
      customerId: form.customerId ? Number(form.customerId) : undefined,
      tipoDocumento: form.tipoDocumento,
      data: form.data,
      aliquotaIva: form.aliquotaIva,
      imponibile: t.imponibile,
      iva: t.iva,
      totale: t.totale,
      righe: form.righe.map(r => ({ ...r, importo: r.importo || (parseFloat(r.prezzoUnitario) * (parseFloat(r.quantita) || 1)).toFixed(2) })),
      note: form.note || undefined,
      ...parsed,
    };

    const resp = await fetch(`${API}/invoices`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { error?: string };
      return toast({ title: err.error ?? "Errore creazione fattura", variant: "destructive" });
    }
    qc.invalidateQueries({ queryKey: ["invoices"] });
    setDialog({ open: false });
    toast({ title: "Fattura creata" });
    return;
  }

  async function handleEmit(id: number) {
    const resp = await fetch(`${API}/invoices/${id}/emit`, { method: "POST" });
    if (!resp.ok) return toast({ title: "Errore emissione", variant: "destructive" });
    const data = await resp.json() as { xml?: string; fileName?: string; rtOk?: boolean; rtError?: string };
    const inv = invoices.find(i => i.id === id);
    const anno = inv?.anno ?? new Date().getFullYear();
    const numero = inv?.numero ?? 0;
    const filename = data.fileName ?? `IT_fattura_${anno}_${String(numero).padStart(4, "0")}.xml`;
    setXmlDialog({ open: true, xml: data.xml, filename, rtOk: data.rtOk, rtError: data.rtError });
    qc.invalidateQueries({ queryKey: ["invoices"] });
    return;
  }

  async function downloadXml(id: number, numero: number, anno: number) {
    const resp = await fetch(`${API}/invoices/${id}/xml`);
    if (!resp.ok) return toast({ title: "Errore generazione XML", variant: "destructive" });
    const xml = await resp.text();
    const inv = invoices.find(i => i.id === id);
    const filename = `IT_fattura_${anno}_${String(numero).padStart(4, "0")}.xml`;
    triggerDownload(xml, inv ? `IT_fattura_${inv.anno}_${String(inv.numero).padStart(5, "0")}_001.xml` : filename);
    qc.invalidateQueries({ queryKey: ["invoices"] });
    return;
  }

  function triggerDownload(xml: string, filename: string) {
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDelete(id: number) {
    if (!confirm("Eliminare questa fattura?")) return;
    await fetch(`${API}/invoices/${id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["invoices"] });
    toast({ title: "Fattura eliminata" });
  }

  // ── Customer management ────────────────────────────────────────────────────
  function openNewCustomer() {
    setCustomerForm({ ...BLANK_CUSTOMER });
    setCustomerDialog({ open: true });
  }

  function openEditCustomer(c: Customer) {
    setCustomerForm({
      ragioneSociale: c.ragioneSociale ?? "",
      tipo: c.tipo ?? "privato",
      partitaIva: c.partitaIva ?? "",
      codiceFiscale: c.codiceFiscale ?? "",
      pec: c.pec ?? "",
      codiceDestinatario: c.codiceDestinatario ?? "0000000",
      indirizzo: c.indirizzo ?? "",
      cap: c.cap ?? "",
      comune: c.comune ?? "",
      provincia: c.provincia ?? "",
      nazione: c.nazione ?? "IT",
    });
    setCustomerDialog({ open: true, item: c });
  }

  async function handleSaveCustomer() {
    setCustomerSaving(true);
    try {
      const method = customerDialog.item ? "PATCH" : "POST";
      const url = customerDialog.item ? `${API}/customers/${customerDialog.item.id}` : `${API}/customers`;
      const resp = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...customerForm,
          codiceDestinatario: customerForm.codiceDestinatario || "0000000",
          nazione: customerForm.nazione || "IT",
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { error?: string };
        toast({ title: err.error ?? "Errore salvataggio cliente", variant: "destructive" });
        return;
      }
      qc.invalidateQueries({ queryKey: ["customers"] });
      setCustomerDialog({ open: false });
      toast({ title: customerDialog.item ? "Cliente aggiornato" : "Cliente aggiunto" });
    } finally {
      setCustomerSaving(false);
    }
  }

  async function handleDeleteCustomer(id: number) {
    if (!confirm("Eliminare questo cliente?")) return;
    await fetch(`${API}/customers/${id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["customers"] });
    toast({ title: "Cliente eliminato" });
  }

  const { imponibile, iva, totale } = totals();

  return (
    <BackofficeShell
      title="Fatture / Documenti Gestionali"
      subtitle="Generazione XML per Passepartout"
      actions={
        <div className="flex gap-2">
          {activeTab === "fatture" && (
            <Button size="sm" className="gap-1" onClick={openNew}>
              <Plus className="h-4 w-4" /> Nuova Fattura
            </Button>
          )}
          {activeTab === "clienti" && (
            <Button size="sm" className="gap-1" onClick={openNewCustomer}>
              <Plus className="h-4 w-4" /> Aggiungi Cliente
            </Button>
          )}
        </div>
      }
    >
      {/* Tab bar */}
      <div className="border-b border-slate-200 bg-white px-4 md:px-6">
        <div className="flex gap-0">
          {(["fatture", "clienti"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors",
                activeTab === tab
                  ? "border-primary text-primary"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              )}
            >
              {tab === "fatture" ? <FileText className="h-4 w-4" /> : <Users className="h-4 w-4" />}
              {tab === "fatture" ? "Fatture" : "Clienti"}
              {tab === "fatture" && invoices.length > 0 && (
                <span className="ml-1 bg-slate-100 text-slate-600 text-xs px-1.5 py-0.5 rounded-full">{invoices.length}</span>
              )}
              {tab === "clienti" && customers.length > 0 && (
                <span className="ml-1 bg-slate-100 text-slate-600 text-xs px-1.5 py-0.5 rounded-full">{customers.length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-3">

        {/* ── TAB: FATTURE ────────────────────────────────────────────────── */}
        {activeTab === "fatture" && (
          <>
            {invoices.length === 0 && (
              <div className="text-center py-16 text-slate-400">
                <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">Nessuna fattura</p>
                <p className="text-sm">Clicca "Nuova Fattura" per iniziare</p>
              </div>
            )}
            {invoices.map(inv => {
              const stato = STATO_CFG[inv.stato] ?? STATO_CFG.bozza;
              return (
                <div key={inv.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
                      <FileText className="h-5 w-5 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-800">
                          {inv.tipoDocumento} {inv.anno}/{String(inv.numero).padStart(4, "0")}
                        </span>
                        <Badge variant="outline" className={cn("text-xs", stato.cls)}>{stato.label}</Badge>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5">
                        <span>{inv.data}</span>
                        {inv.ragioneSociale && <span className="font-medium text-slate-700">{inv.ragioneSociale}</span>}
                        <span className="font-semibold text-primary">€ {inv.totale}</span>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0 flex-wrap">
                      {inv.stato === "bozza" && (
                        <button onClick={() => handleEmit(inv.id)}
                          className="p-2 rounded-lg text-slate-500 hover:text-green-600 hover:bg-green-50 transition-colors" title="Emetti fattura + stampa gestionale">
                          <Send className="h-4 w-4" />
                        </button>
                      )}
                      <button onClick={() => downloadXml(inv.id, inv.numero, inv.anno)}
                        className="p-2 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="Scarica XML Passepartout">
                        <Download className="h-4 w-4" />
                      </button>
                      {inv.stato === "bozza" && (
                        <button onClick={() => handleDelete(inv.id)}
                          className="p-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors" title="Elimina">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* ── TAB: CLIENTI ────────────────────────────────────────────────── */}
        {activeTab === "clienti" && (
          <>
            {customers.length === 0 && (
              <div className="text-center py-16 text-slate-400">
                <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">Nessun cliente</p>
                <p className="text-sm">Aggiungi i clienti per la fatturazione elettronica</p>
                <Button size="sm" className="mt-4 gap-1" onClick={openNewCustomer}>
                  <Plus className="h-4 w-4" /> Aggiungi Cliente
                </Button>
              </div>
            )}
            {customers.map(c => (
              <div key={c.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 bg-violet-50 rounded-xl flex items-center justify-center shrink-0">
                    <Building2 className="h-5 w-5 text-violet-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-slate-800">{c.ragioneSociale}</div>
                    <div className="text-xs text-slate-500 flex flex-wrap gap-x-4 mt-0.5">
                      {c.partitaIva && <span>P.IVA {c.partitaIva}</span>}
                      {c.codiceFiscale && <span>CF {c.codiceFiscale}</span>}
                      {c.pec && <span>PEC {c.pec}</span>}
                      {c.comune && <span>{c.comune} ({c.provincia})</span>}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => openEditCustomer(c)}
                      className="p-2 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="Modifica">
                      <ChevronRight className="h-4 w-4" />
                    </button>
                    <button onClick={() => handleDeleteCustomer(c.id)}
                      className="p-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors" title="Elimina">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* ── Dialog: Nuova Fattura ──────────────────────────────────────────────── */}
      <Dialog open={dialog.open} onOpenChange={o => !o && setDialog({ open: false })}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Nuova Fattura / Documento Gestionale</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">Tipo documento</Label>
                <select value={form.tipoDocumento} onChange={e => setForm(f => ({ ...f, tipoDocumento: e.target.value }))}
                  className="w-full h-9 px-3 rounded-md border border-slate-200 text-sm bg-white">
                  {TIPI_DOCUMENTO.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">Data</Label>
                <Input type="date" value={form.data} onChange={e => setForm(f => ({ ...f, data: e.target.value }))} className="h-9 text-sm" />
              </div>
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">
                  N° fattura
                  <span className="ml-1 font-normal text-slate-400">(es. 1 oppure 1/2025)</span>
                </Label>
                <Input
                  placeholder="auto"
                  value={form.numero}
                  onChange={e => setForm(f => ({ ...f, numero: e.target.value }))}
                  className="h-9 text-sm font-mono"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs text-slate-500">Cliente</Label>
                <button onClick={() => { setActiveTab("clienti"); setDialog({ open: false }); openNewCustomer(); }}
                  className="text-xs text-primary hover:underline flex items-center gap-0.5">
                  <Plus className="h-3 w-3" /> Nuovo cliente
                </button>
              </div>
              <select value={form.customerId} onChange={e => setForm(f => ({ ...f, customerId: e.target.value }))}
                className="w-full h-9 px-3 rounded-md border border-slate-200 text-sm bg-white">
                <option value="">— Cliente generico —</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>{c.ragioneSociale}{c.partitaIva ? ` — ${c.partitaIva}` : ""}</option>
                ))}
              </select>
              {customers.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">Nessun cliente registrato. Vai alla tab Clienti per aggiungerli.</p>
              )}
            </div>

            <div className="border-t border-slate-100 pt-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Righe</p>
                <Button variant="ghost" size="sm" onClick={addRow} className="h-7 text-xs gap-1">
                  <Plus className="h-3 w-3" /> Aggiungi riga
                </Button>
              </div>
              <div className="space-y-2">
                {form.righe.map((r, i) => (
                  <div key={i} className="grid grid-cols-12 gap-1.5 items-center">
                    <Input className="col-span-5 h-8 text-xs" placeholder="Descrizione" value={r.descrizione}
                      onChange={e => updateRow(i, "descrizione", e.target.value)} />
                    <Input className="col-span-2 h-8 text-xs" placeholder="Qtà" value={r.quantita} type="number" min="1"
                      onChange={e => updateRow(i, "quantita", e.target.value)} />
                    <Input className="col-span-2 h-8 text-xs" placeholder="Prezzo" value={r.prezzoUnitario} type="number" step="0.01"
                      onChange={e => updateRow(i, "prezzoUnitario", e.target.value)} />
                    <div className="col-span-2 h-8 flex items-center justify-center text-xs font-semibold text-slate-700 bg-slate-50 rounded border border-slate-200">
                      € {r.importo || "0.00"}
                    </div>
                    <button onClick={() => removeRow(i)} className="col-span-1 h-8 flex items-center justify-center text-slate-400 hover:text-red-600 transition-colors rounded">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">Aliquota IVA %</Label>
                <select value={form.aliquotaIva} onChange={e => setForm(f => ({ ...f, aliquotaIva: e.target.value }))}
                  className="w-full h-9 px-3 rounded-md border border-slate-200 text-sm bg-white">
                  {["0", "4", "5", "10", "22"].map(a => <option key={a} value={a}>{a}%</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">Note / Causale</Label>
                <Input className="h-9 text-sm" placeholder="Opzionale" value={form.note}
                  onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
              </div>
            </div>

            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 text-sm">
              <div className="flex justify-between text-slate-600"><span>Imponibile</span><span>€ {imponibile}</span></div>
              <div className="flex justify-between text-slate-600"><span>IVA {form.aliquotaIva}%</span><span>€ {iva}</span></div>
              <div className="flex justify-between font-bold text-slate-800 text-base border-t border-slate-200 mt-1 pt-1">
                <span>Totale</span><span>€ {totale}</span>
              </div>
            </div>

            <p className="text-xs text-slate-400 flex items-center gap-1">
              <FileText className="h-3.5 w-3.5" />
              All'emissione verrà generato un XML FatturaPA compatibile con Passepartout e stampato un gestionale RT
            </p>
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => setDialog({ open: false })}>Annulla</Button>
            <Button onClick={handleSave}>Salva bozza</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: XML / Emissione ────────────────────────────────────────────── */}
      <Dialog open={xmlDialog.open} onOpenChange={o => !o && setXmlDialog({ open: false })}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Fattura Emessa — XML Passepartout</DialogTitle>
          </DialogHeader>

          {/* Filename + RT status */}
          <div className="space-y-2 shrink-0">
            {xmlDialog.filename && (
              <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                <FileText className="h-4 w-4 text-blue-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-blue-700 font-medium">File da importare in Passepartout:</p>
                  <p className="text-sm font-mono font-bold text-blue-900 truncate">{xmlDialog.filename}</p>
                </div>
              </div>
            )}
            {xmlDialog.rtOk === true && (
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-emerald-700 text-sm">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                Gestionale stampato sulla RT
              </div>
            )}
            {xmlDialog.rtOk === false && xmlDialog.rtError && (
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-700 text-sm">
                <AlertCircle className="h-4 w-4 shrink-0" />
                Gestionale RT: {xmlDialog.rtError}
              </div>
            )}
          </div>

          <div className="overflow-auto flex-1 bg-slate-900 rounded-lg p-3 min-h-0">
            <pre className="text-xs text-emerald-300 whitespace-pre-wrap font-mono">{xmlDialog.xml}</pre>
          </div>
          <DialogFooter className="gap-2 shrink-0">
            <Button variant="outline" onClick={() => setXmlDialog({ open: false })}>Chiudi</Button>
            {xmlDialog.xml && (
              <Button onClick={() => triggerDownload(xmlDialog.xml!, xmlDialog.filename ?? "fattura.xml")}>
                <Download className="h-4 w-4 mr-1" /> Scarica XML
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Aggiungi / Modifica Cliente ───────────────────────────────── */}
      <Dialog open={customerDialog.open} onOpenChange={o => !o && setCustomerDialog({ open: false })}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{customerDialog.item ? "Modifica Cliente" : "Nuovo Cliente"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">

            <div>
              <Label className="text-xs text-slate-500 mb-1 block">Tipo</Label>
              <select value={customerForm.tipo} onChange={e => setCustomerForm(f => ({ ...f, tipo: e.target.value }))}
                className="w-full h-9 px-3 rounded-md border border-slate-200 text-sm bg-white">
                <option value="privato">Privato</option>
                <option value="azienda">Azienda / P.IVA</option>
                <option value="pa">Pubblica Amministrazione</option>
              </select>
            </div>

            <div>
              <Label className="text-xs text-slate-500 mb-1 block">
                Ragione Sociale / Denominazione <span className="text-red-500">*</span>
              </Label>
              <Input className="h-9 text-sm" value={customerForm.ragioneSociale}
                onChange={e => setCustomerForm(f => ({ ...f, ragioneSociale: e.target.value }))} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">Partita IVA</Label>
                <Input className="h-9 text-sm font-mono" placeholder="IT00000000000"
                  value={customerForm.partitaIva}
                  onChange={e => setCustomerForm(f => ({ ...f, partitaIva: e.target.value.toUpperCase() }))} />
              </div>
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">Codice Fiscale</Label>
                <Input className="h-9 text-sm font-mono" placeholder="RSSMRA80A01H703Y"
                  value={customerForm.codiceFiscale}
                  onChange={e => setCustomerForm(f => ({ ...f, codiceFiscale: e.target.value.toUpperCase() }))} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">Codice Destinatario SDI</Label>
                <Input className="h-9 text-sm font-mono" placeholder="0000000 (privato)"
                  value={customerForm.codiceDestinatario}
                  onChange={e => setCustomerForm(f => ({ ...f, codiceDestinatario: e.target.value.toUpperCase() }))} />
              </div>
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">PEC destinatario</Label>
                <Input className="h-9 text-sm" placeholder="pec@dominio.it"
                  value={customerForm.pec}
                  onChange={e => setCustomerForm(f => ({ ...f, pec: e.target.value }))} />
              </div>
            </div>

            <div>
              <Label className="text-xs text-slate-500 mb-1 block">Indirizzo</Label>
              <Input className="h-9 text-sm" placeholder="Via Roma 1"
                value={customerForm.indirizzo}
                onChange={e => setCustomerForm(f => ({ ...f, indirizzo: e.target.value }))} />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">CAP</Label>
                <Input className="h-9 text-sm" placeholder="00100"
                  value={customerForm.cap}
                  onChange={e => setCustomerForm(f => ({ ...f, cap: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">Comune</Label>
                <Input className="h-9 text-sm" placeholder="Roma"
                  value={customerForm.comune}
                  onChange={e => setCustomerForm(f => ({ ...f, comune: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">Prov.</Label>
                <Input className="h-9 text-sm" placeholder="RM" maxLength={2}
                  value={customerForm.provincia}
                  onChange={e => setCustomerForm(f => ({ ...f, provincia: e.target.value.toUpperCase() }))} />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => setCustomerDialog({ open: false })}>Annulla</Button>
            <Button onClick={handleSaveCustomer} disabled={customerSaving || !customerForm.ragioneSociale.trim()}>
              {customerSaving ? "Salvataggio..." : (customerDialog.item ? "Aggiorna" : "Aggiungi")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BackofficeShell>
  );
}
