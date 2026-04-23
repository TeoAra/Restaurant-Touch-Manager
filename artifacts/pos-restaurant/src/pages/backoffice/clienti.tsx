import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BackofficeShell } from "@/components/BackofficeShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Search, Building2, User, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

type Customer = {
  id: number; tipo: string; ragioneSociale: string; nome?: string; cognome?: string;
  codiceFiscale?: string; partitaIva?: string; pec?: string; codiceDestinatario?: string;
  indirizzo?: string; cap?: string; comune?: string; provincia?: string; nazione?: string;
  telefono?: string; email?: string; note?: string;
};

const BLANK: Omit<Customer, "id"> = {
  tipo: "azienda", ragioneSociale: "", nome: "", cognome: "", codiceFiscale: "", partitaIva: "",
  pec: "", codiceDestinatario: "0000000", indirizzo: "", cap: "", comune: "", provincia: "",
  nazione: "IT", telefono: "", email: "", note: "",
};

function useCustomers(q: string) {
  return useQuery<Customer[]>({
    queryKey: ["customers", q],
    queryFn: () => fetch(`${API}/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`).then(r => r.json()),
  });
}

function Field({ label, value, onChange, required, placeholder, className }: {
  label: string; value: string; onChange: (v: string) => void;
  required?: boolean; placeholder?: string; className?: string;
}) {
  return (
    <div className={className}>
      <Label className="text-xs text-slate-500 mb-1 block">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</Label>
      <Input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="h-9 text-sm" />
    </div>
  );
}

type ViesStatus = "idle" | "loading" | "ok" | "error";

export default function ClientiPage() {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [dialog, setDialog] = useState<{ open: boolean; item?: Customer }>({ open: false });
  const [form, setForm] = useState<Omit<Customer, "id">>(BLANK);
  const [viesStatus, setViesStatus] = useState<ViesStatus>("idle");
  const [viesMsg, setViesMsg] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: customers = [] } = useCustomers(q);

  function openNew() { setForm(BLANK); setViesStatus("idle"); setViesMsg(""); setDialog({ open: true }); }
  function openEdit(c: Customer) {
    setForm({ ...BLANK, ...c });
    setViesStatus("idle"); setViesMsg("");
    setDialog({ open: true, item: c });
  }
  function set(k: keyof typeof form) { return (v: string) => setForm(f => ({ ...f, [k]: v })); }

  async function verificaPiva() {
    const piva = (form.partitaIva ?? "").trim().replace(/\s/g, "");
    if (!piva) return toast({ title: "Inserisci la P.IVA prima di verificare", variant: "destructive" });
    setViesStatus("loading"); setViesMsg("");
    try {
      const vatParam = piva.toUpperCase().startsWith("IT") ? piva : `IT${piva}`;
      const resp = await fetch(`${API}/vies?vat=${encodeURIComponent(vatParam)}`);
      const data = await resp.json() as {
        valid?: boolean; message?: string; error?: string;
        name?: string; parsed?: { indirizzo: string; cap: string; comune: string; provincia: string; nazione: string };
      };

      if (!resp.ok || data.error) {
        setViesStatus("error");
        setViesMsg(data.error ?? "Errore nella verifica");
        return;
      }
      if (!data.valid) {
        setViesStatus("error");
        setViesMsg(data.message ?? "P.IVA non valida nel VIES");
        return;
      }

      setViesStatus("ok");
      setViesMsg("P.IVA verificata");

      const updates: Partial<Omit<Customer, "id">> = {};
      if (data.name && data.name !== "---") updates.ragioneSociale = data.name;
      if (data.parsed) {
        if (data.parsed.indirizzo) updates.indirizzo = data.parsed.indirizzo;
        if (data.parsed.cap) updates.cap = data.parsed.cap;
        if (data.parsed.comune) updates.comune = data.parsed.comune;
        if (data.parsed.provincia) updates.provincia = data.parsed.provincia;
        if (data.parsed.nazione) updates.nazione = data.parsed.nazione;
      }
      setForm(f => ({ ...f, ...updates }));
      if (Object.keys(updates).length > 0) {
        toast({ title: "Dati azienda recuperati dal VIES" });
      }
    } catch {
      setViesStatus("error");
      setViesMsg("Impossibile contattare il servizio VIES");
    }
  }

  async function handleSave() {
    if (!form.ragioneSociale.trim()) return toast({ title: "Denominazione obbligatoria", variant: "destructive" });
    const url = dialog.item ? `${API}/customers/${dialog.item.id}` : `${API}/customers`;
    const method = dialog.item ? "PATCH" : "POST";
    await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    qc.invalidateQueries({ queryKey: ["customers"] });
    setDialog({ open: false });
    toast({ title: dialog.item ? "Cliente aggiornato" : "Cliente creato" });
  }

  async function handleDelete(id: number) {
    if (!confirm("Eliminare questo cliente?")) return;
    await fetch(`${API}/customers/${id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["customers"] });
    toast({ title: "Cliente eliminato" });
  }

  return (
    <BackofficeShell
      title="Clienti"
      subtitle="Anagrafica per fatturazione"
      actions={
        <Button size="sm" className="gap-1" onClick={openNew}>
          <Plus className="h-4 w-4" /> Nuovo
        </Button>
      }
    >
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              className="pl-9 h-10"
              placeholder="Cerca per nome, P.IVA, C.F…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === "Enter" && setQ(search)}
            />
          </div>
          <Button variant="outline" onClick={() => setQ(search)}>Cerca</Button>
          {q && <Button variant="ghost" onClick={() => { setQ(""); setSearch(""); }}>Reset</Button>}
        </div>

        <div className="space-y-2">
          {customers.length === 0 && (
            <div className="text-center py-16 text-slate-400">
              <User className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Nessun cliente</p>
              <p className="text-sm">Aggiungi il primo cliente per la fatturazione</p>
            </div>
          )}
          {customers.map(c => (
            <div key={c.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex items-start gap-3">
              <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center shrink-0",
                c.tipo === "azienda" ? "bg-blue-50 text-blue-600" : "bg-emerald-50 text-emerald-600")}>
                {c.tipo === "azienda" ? <Building2 className="h-5 w-5" /> : <User className="h-5 w-5" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-800 truncate">{c.ragioneSociale}</div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-0.5 text-xs text-slate-500">
                  {c.partitaIva && <span>P.IVA: {c.partitaIva}</span>}
                  {c.codiceFiscale && <span>C.F.: {c.codiceFiscale}</span>}
                  {c.comune && <span>{c.comune} {c.provincia ? `(${c.provincia})` : ""}</span>}
                  {c.pec && <span>PEC: {c.pec}</span>}
                  {c.codiceDestinatario && c.codiceDestinatario !== "0000000" && <span>SDI: {c.codiceDestinatario}</span>}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => openEdit(c)} className="p-2 rounded-lg text-slate-400 hover:text-primary hover:bg-orange-50 transition-colors">
                  <Pencil className="h-4 w-4" />
                </button>
                <button onClick={() => handleDelete(c.id)} className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Dialog open={dialog.open} onOpenChange={o => !o && setDialog({ open: false })}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialog.item ? "Modifica Cliente" : "Nuovo Cliente"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">
            <div>
              <Label className="text-xs text-slate-500 mb-1.5 block">Tipo soggetto</Label>
              <div className="flex gap-2">
                {[{ v: "azienda", l: "Azienda / Ente" }, { v: "privato", l: "Privato" }].map(({ v, l }) => (
                  <button key={v} onClick={() => set("tipo")(v)}
                    className={cn("flex-1 py-2 rounded-lg border-2 text-sm font-medium transition-colors",
                      form.tipo === v ? "border-primary bg-orange-50 text-primary" : "border-slate-200 text-slate-600 hover:border-slate-300")}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <Field label={form.tipo === "azienda" ? "Ragione Sociale" : "Denominazione / Cognome Nome"} value={form.ragioneSociale} onChange={set("ragioneSociale")} required />
              {form.tipo === "privato" && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Nome" value={form.nome ?? ""} onChange={set("nome")} />
                  <Field label="Cognome" value={form.cognome ?? ""} onChange={set("cognome")} />
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 pt-4">
              <p className="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wide">Dati fiscali</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label className="text-xs text-slate-500 mb-1 block">
                    Partita IVA
                    {form.tipo === "azienda" && (
                      <span className="ml-1 text-xs text-blue-500 font-normal">— verifica per auto-compilare i dati</span>
                    )}
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      value={form.partitaIva ?? ""}
                      onChange={e => { set("partitaIva")(e.target.value); setViesStatus("idle"); setViesMsg(""); }}
                      placeholder="12345678901"
                      className="h-9 text-sm flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className={cn("h-9 px-3 shrink-0 gap-1.5 text-xs",
                        viesStatus === "ok" && "border-green-400 text-green-700 bg-green-50",
                        viesStatus === "error" && "border-red-400 text-red-600 bg-red-50"
                      )}
                      onClick={verificaPiva}
                      disabled={viesStatus === "loading"}
                    >
                      {viesStatus === "loading" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {viesStatus === "ok" && <CheckCircle2 className="h-3.5 w-3.5" />}
                      {viesStatus === "error" && <XCircle className="h-3.5 w-3.5" />}
                      {viesStatus === "loading" ? "Verifica…" : "Verifica P.IVA"}
                    </Button>
                  </div>
                  {viesMsg && (
                    <p className={cn("text-xs mt-1", viesStatus === "ok" ? "text-green-600" : "text-red-500")}>
                      {viesStatus === "ok" ? "✓ " : "✗ "}{viesMsg}
                    </p>
                  )}
                </div>
                <Field label="Codice Fiscale" value={form.codiceFiscale ?? ""} onChange={set("codiceFiscale")} placeholder="RSSMRA80A01H501U" />
                <Field label="Codice SDI (Destinatario)" value={form.codiceDestinatario ?? ""} onChange={set("codiceDestinatario")} placeholder="0000000" />
                <Field label="PEC" value={form.pec ?? ""} onChange={set("pec")} placeholder="pec@dominio.it" />
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4">
              <p className="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wide">Sede / Indirizzo</p>
              <div className="grid grid-cols-1 gap-3">
                <Field label="Indirizzo" value={form.indirizzo ?? ""} onChange={set("indirizzo")} placeholder="Via Roma 1" />
                <div className="grid grid-cols-3 gap-3">
                  <Field label="CAP" value={form.cap ?? ""} onChange={set("cap")} placeholder="00100" />
                  <Field label="Comune" value={form.comune ?? ""} onChange={set("comune")} placeholder="Roma" className="col-span-2" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Provincia" value={form.provincia ?? ""} onChange={set("provincia")} placeholder="RM" />
                  <Field label="Nazione" value={form.nazione ?? "IT"} onChange={set("nazione")} placeholder="IT" />
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4">
              <p className="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wide">Contatti</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Telefono" value={form.telefono ?? ""} onChange={set("telefono")} />
                <Field label="Email" value={form.email ?? ""} onChange={set("email")} />
              </div>
              <div className="mt-3">
                <Field label="Note" value={form.note ?? ""} onChange={set("note")} />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => setDialog({ open: false })}>Annulla</Button>
            <Button onClick={handleSave}>{dialog.item ? "Salva" : "Crea Cliente"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BackofficeShell>
  );
}
