import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Users, Plus, Pencil, Trash2, Shield, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { BackofficeShell } from "@/components/BackofficeShell";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api`;

type AppUser = { id: number; name: string; role: string; createdAt?: string };

const KEYS = ["1","2","3","4","5","6","7","8","9","","0","C"];

function PinInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-2 justify-center">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={cn("h-10 w-10 rounded-lg border-2 flex items-center justify-center",
            value.length > i ? "border-primary bg-primary/10" : "border-slate-200 bg-slate-50")}>
            {value.length > i && <div className="h-3 w-3 rounded-full bg-primary" />}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((k, i) => (
          <button key={i} type="button"
            onClick={() => {
              if (k === "C") { onChange(""); return; }
              if (!k) return;
              if (value.length < 4) onChange(value + k);
            }}
            className={cn("h-10 rounded-lg text-sm font-bold transition-all active:scale-90",
              k === "C" ? "bg-red-50 text-red-500 border border-red-200 hover:bg-red-100"
              : k ? "bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200"
              : "invisible")}>
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function UsersPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: users = [], isLoading } = useQuery<AppUser[]>({
    queryKey: ["auth-users"],
    queryFn: () => fetch(`${API}/auth/users`).then(r => r.json()),
  });

  const [dialog, setDialog] = useState<{ open: boolean; item?: AppUser }>({ open: false });
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState<"admin" | "employee">("employee");

  function openNew() { setName(""); setPin(""); setRole("employee"); setDialog({ open: true }); }
  function openEdit(u: AppUser) {
    setName(u.name); setPin(""); setRole(u.role as "admin" | "employee");
    setDialog({ open: true, item: u });
  }

  const errToast = (err?: unknown) => {
    const msg = (err as { message?: string })?.message ?? "Operazione fallita";
    toast({ title: "Errore", description: msg, variant: "destructive" });
  };

  const createUser = useMutation({
    mutationFn: () => fetch(`${API}/auth/users`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, pin, role }),
    }).then(async r => { if (!r.ok) throw new Error((await r.json()).error ?? r.statusText); return r.json(); }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["auth-users"] }); setDialog({ open: false }); toast({ title: "Utente creato" }); },
    onError: errToast,
  });

  const updateUser = useMutation({
    mutationFn: () => fetch(`${API}/auth/users/${dialog.item!.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, ...(pin ? { pin } : {}), role }),
    }).then(async r => { if (!r.ok) throw new Error((await r.json()).error ?? r.statusText); return r.json(); }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["auth-users"] }); setDialog({ open: false }); toast({ title: "Utente aggiornato" }); },
    onError: errToast,
  });

  const deleteUser = useMutation({
    mutationFn: (id: number) => fetch(`${API}/auth/users/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["auth-users"] }); toast({ title: "Utente eliminato" }); },
    onError: errToast,
  });

  return (
    <BackofficeShell
      title="Utenti"
      subtitle="Accessi e ruoli del personale"
      actions={<Button size="sm" onClick={openNew} className="gap-1.5"><Plus className="h-4 w-4" /> Nuovo</Button>}
    >
    <div className="p-4 md:p-6 max-w-2xl">

      {isLoading ? <p className="text-muted-foreground">Caricamento...</p> : (
        <div className="space-y-2">
          {users.map(u => (
            <div key={u.id} className="flex items-center gap-4 p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
              <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center shrink-0",
                u.role === "admin" ? "bg-primary/10" : "bg-slate-100")}>
                {u.role === "admin"
                  ? <Shield className="h-5 w-5 text-primary" />
                  : <User className="h-5 w-5 text-slate-500" />}
              </div>
              <div className="flex-1">
                <div className="font-semibold text-slate-800">{u.name}</div>
                <div className={cn("text-xs font-medium mt-0.5",
                  u.role === "admin" ? "text-primary" : "text-slate-400")}>
                  {u.role === "admin" ? "Amministratore" : "Dipendente"}
                </div>
              </div>
              <div className="flex gap-1">
                <button onClick={() => openEdit(u)}
                  className="p-2 rounded-lg text-slate-500 hover:text-primary hover:bg-orange-50 transition-colors">
                  <Pencil className="h-4 w-4" />
                </button>
                <button onClick={() => deleteUser.mutate(u.id)}
                  className="p-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialog.open} onOpenChange={o => !o && setDialog({ open: false })}>
        <DialogContent>
          <DialogHeader><DialogTitle>{dialog.item ? "Modifica Utente" : "Nuovo Utente"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nome *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Es. Mario Rossi" className="mt-1" />
            </div>
            <div>
              <Label>{dialog.item ? "Nuovo PIN (lascia vuoto per non cambiare)" : "PIN (4 cifre) *"}</Label>
              <div className="mt-2">
                <PinInput value={pin} onChange={setPin} />
              </div>
            </div>
            <div>
              <Label>Ruolo</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {(["admin", "employee"] as const).map(r => (
                  <button key={r} onClick={() => setRole(r)}
                    className={cn("py-2.5 rounded-lg text-sm font-medium border-2 transition-colors",
                      role === r ? "border-primary bg-orange-50 text-primary" : "border-border text-muted-foreground")}>
                    {r === "admin" ? "Amministratore" : "Dipendente"}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog({ open: false })}>Annulla</Button>
            <Button
              onClick={() => dialog.item ? updateUser.mutate() : createUser.mutate()}
              disabled={!name || (!dialog.item && pin.length < 4)}>
              {dialog.item ? "Salva" : "Crea"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </BackofficeShell>
  );
}
