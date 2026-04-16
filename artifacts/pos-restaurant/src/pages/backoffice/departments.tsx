import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, ChefHat } from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

type Department = { id: number; name: string; code: string; productionType: string };
type DeptForm = { name: string; code: string; productionType: string };

const empty: DeptForm = { name: "", code: "", productionType: "kitchen" };

const prodTypes: Record<string, string> = { kitchen: "Cucina", bar: "Bar", pizza: "Pizzeria", other: "Altro" };

async function fetchDepts(): Promise<Department[]> {
  const res = await fetch(`${API}/departments`);
  if (!res.ok) throw new Error("Errore");
  return res.json();
}

export default function DepartmentsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: depts = [], isLoading } = useQuery({ queryKey: ["departments"], queryFn: fetchDepts });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [form, setForm] = useState<DeptForm>(empty);

  const create = useMutation({
    mutationFn: (data: DeptForm) =>
      fetch(`${API}/departments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["departments"] }); setOpen(false); toast({ title: "Reparto creato" }); },
  });
  const update = useMutation({
    mutationFn: ({ id, data }: { id: number; data: DeptForm }) =>
      fetch(`${API}/departments/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["departments"] }); setOpen(false); toast({ title: "Reparto aggiornato" }); },
  });
  const remove = useMutation({
    mutationFn: (id: number) => fetch(`${API}/departments/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["departments"] }); toast({ title: "Reparto eliminato" }); },
  });

  function openNew() { setEditing(null); setForm(empty); setOpen(true); }
  function openEdit(d: Department) { setEditing(d); setForm({ name: d.name, code: d.code, productionType: d.productionType }); setOpen(true); }
  function handleSave() {
    if (editing) update.mutate({ id: editing.id, data: form });
    else create.mutate(form);
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <ChefHat className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Reparti</h1>
        </div>
        <Button onClick={openNew} className="gap-2"><Plus className="h-4 w-4" /> Nuovo Reparto</Button>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">Caricamento...</div>
      ) : (
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Nome</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Codice</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Tipo produzione</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {depts.map((d, i) => (
                <tr key={d.id} className={i % 2 === 0 ? "bg-card" : "bg-muted/20"}>
                  <td className="px-4 py-3 font-medium text-foreground">{d.name}</td>
                  <td className="px-4 py-3"><span className="bg-muted px-2 py-0.5 rounded font-mono text-xs">{d.code}</span></td>
                  <td className="px-4 py-3 text-muted-foreground">{prodTypes[d.productionType] ?? d.productionType}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(d)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => remove.mutate(d.id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
              {depts.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">Nessun reparto configurato</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Modifica Reparto" : "Nuovo Reparto"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Nome *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="es. Cucina" />
            </div>
            <div className="space-y-1">
              <Label>Codice *</Label>
              <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="es. CUC" maxLength={6} />
            </div>
            <div className="space-y-1">
              <Label>Tipo produzione</Label>
              <Select value={form.productionType} onValueChange={v => setForm(f => ({ ...f, productionType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(prodTypes).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Annulla</Button>
            <Button onClick={handleSave} disabled={!form.name || !form.code}>{editing ? "Salva" : "Crea"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
