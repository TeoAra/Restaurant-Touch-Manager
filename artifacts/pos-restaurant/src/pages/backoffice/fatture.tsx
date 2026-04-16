import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BackofficeShell } from "@/components/BackofficeShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Download, FileText, Eye, Trash2, Send, Search } from "lucide-react";
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

type Customer = { id: number; ragioneSociale: string; partitaIva?: string; codiceFiscale?: string };

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

export default function FatturePage() {
  const [dialog, setDialog] = useState<{ open: boolean; item?: Invoice }>({ open: false });
  const [xmlDialog, setXmlDialog] = useState<{ open: boolean; xml?: string; filename?: string }>({ open: false });
  const [form, setForm] = useState({
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
      customerId: "", tipoDocumento: "TD01", data: new Date().toISOString().slice(0, 10),
      aliquotaIva: "22", righe: [{ descrizione: "Servizi ristorazione", quantita: "1", prezzoUnitario: "", importo: "", aliquotaIva: "22" }],
      note: "",
    });
    setDialog({ open: true });
  }

  async function handleSave() {
    const t = totals();
    const body = {
      customerId: form.customerId ? Number(form.customerId) : undefined,
      tipoDocumento: form.tipoDocumento,
      data: form.data,
      aliquotaIva: form.aliquotaIva,
      imponibile: t.imponibile,
      iva: t.iva,
      totale: t.totale,
      righe: form.righe.map(r => ({ ...r, importo: r.importo || (parseFloat(r.prezzoUnitario) * (parseFloat(r.quantita) || 1)).toFixed(2) })),
      note: form.note || undefined,
    };
    const resp = await fetch(`${API}/invoices`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!resp.ok) return toast({ title: "Errore creazione fattura", variant: "destructive" });
    qc.invalidateQueries({ queryKey: ["invoices"] });
    setDialog({ open: false });
    toast({ title: "Fattura creata" });
  }

  async function handleEmit(id: number) {
    const resp = await fetch(`${API}/invoices/${id}/emit`, { method: "POST" });
    if (!resp.ok) return toast({ title: "Errore emissione", variant: "destructive" });
    const data = await resp.json();
    setXmlDialog({ open: true, xml: data.xml, filename: `fattura_${id}.xml` });
    qc.invalidateQueries({ queryKey: ["invoices"] });
    toast({ title: "Fattura emessa" });
  }

  async function handleDownloadXml(id: number, numero: number, anno: number) {
    const resp = await fetch(`${API}/invoices/${id}/xml`);
    if (!resp.ok) return toast({ title: "Errore generazione XML", variant: "destructive" });
    const xml = await resp.text();
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fattura_${anno}_${String(numero).padStart(4, "0")}.xml`;
    a.click();
    URL.revokeObjectURL(url);
    qc.invalidateQueries({ queryKey: ["invoices"] });
  }

  async function handleDelete(id: number) {
    if (!confirm("Eliminare questa fattura?")) return;
    await fetch(`${API}/invoices/${id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["invoices"] });
    toast({ title: "Fattura eliminata" });
  }

  const { imponibile, iva, totale } = totals();

  return (
    <BackofficeShell
      title="Fatture Elettroniche"
      subtitle="Gestione e generazione FatturaPA"
      actions={
        <Button size="sm" className="gap-1" onClick={openNew}>
          <Plus className="h-4 w-4" /> Nuova Fattura
        </Button>
      }
    >
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-3">
        {invoices.length === 0 && (
          <div className="text-center py-16 text-slate-400">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Nessuna fattura</p>
            <p className="text-sm">Le fatture emesse appariranno qui</p>
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
                      className="p-2 rounded-lg text-slate-500 hover:text-green-600 hover:bg-green-50 transition-colors" title="Emetti fattura">
                      <Send className="h-4 w-4" />
                    </button>
                  )}
                  {inv.stato === "emessa" && (
                    <button onClick={() => handleDownloadXml(inv.id, inv.numero, inv.anno)}
                      className="p-2 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="Scarica XML">
                      <Download className="h-4 w-4" />
                    </button>
                  )}
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
      </div>

      {/* New invoice dialog */}
      <Dialog open={dialog.open} onOpenChange={o => !o && setDialog({ open: false })}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Nuova Fattura</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
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
            </div>

            <div>
              <Label className="text-xs text-slate-500 mb-1 block">Cliente</Label>
              <select value={form.customerId} onChange={e => setForm(f => ({ ...f, customerId: e.target.value }))}
                className="w-full h-9 px-3 rounded-md border border-slate-200 text-sm bg-white">
                <option value="">— Cliente generico —</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>{c.ragioneSociale}{c.partitaIva ? ` — ${c.partitaIva}` : ""}</option>
                ))}
              </select>
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
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => setDialog({ open: false })}>Annulla</Button>
            <Button onClick={handleSave}>Salva bozza</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* XML preview dialog */}
      <Dialog open={xmlDialog.open} onOpenChange={o => !o && setXmlDialog({ open: false })}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader><DialogTitle>XML FatturaPA generato</DialogTitle></DialogHeader>
          <div className="overflow-auto max-h-[50vh] bg-slate-900 rounded-lg p-3">
            <pre className="text-xs text-emerald-300 whitespace-pre-wrap font-mono">{xmlDialog.xml}</pre>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setXmlDialog({ open: false })}>Chiudi</Button>
            {xmlDialog.xml && (
              <Button onClick={() => {
                const blob = new Blob([xmlDialog.xml!], { type: "application/xml" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url; a.download = xmlDialog.filename ?? "fattura.xml"; a.click();
                URL.revokeObjectURL(url);
              }}>
                <Download className="h-4 w-4 mr-1" /> Scarica XML
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BackofficeShell>
  );
}
