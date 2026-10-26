import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CalendarCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const API = `${import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}/api/reservations/public`;
type Config = { enabled: boolean; restaurantName: string; maxCovers: number };

async function call(url: string, body?: unknown) {
  const r = await fetch(url, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? "Richiesta non riuscita");
  return d;
}

export default function PrenotaPage() {
  const cfg = useQuery<Config>({ queryKey: ["public-booking-config"], queryFn: () => call(`${API}/config`), refetchInterval: false, retry: false });
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ date: today, time: "20:00", covers: 2, guestName: "", phone: "", notes: "", website: "" });
  const send = useMutation({ mutationFn: () => call(`${API}/request`, { ...f, guestName: f.guestName.trim(), phone: f.phone.trim(), notes: f.notes.trim() }) });
  const set = (k: string, v: string | number) => setF(p => ({ ...p, [k]: v }));

  const shell = (c: React.ReactNode) => (
    <div className="min-h-[100dvh] bg-[#f4f6fa] flex items-start sm:items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-sm p-6">{c}</div>
    </div>
  );

  if (cfg.isLoading) return shell(<div className="h-48 animate-pulse bg-slate-100 rounded-xl" />);
  if (cfg.isError || !cfg.data) return shell(<div className="text-center space-y-3"><p className="text-slate-600">Servizio non raggiungibile.</p><Button onClick={() => cfg.refetch()}>Riprova</Button></div>);
  const c = cfg.data;
  if (!c.enabled) return shell(<div className="text-center"><h1 className="text-xl font-bold text-slate-800">{c.restaurantName}</h1><p className="text-slate-500 mt-2">Le prenotazioni online non sono attive. Contattaci direttamente.</p></div>);
  if (send.isSuccess) return shell(
    <div className="text-center space-y-2" data-testid="text-booking-sent">
      <CalendarCheck className="h-10 w-10 mx-auto text-primary" />
      <h1 className="text-xl font-bold text-slate-800">Richiesta inviata</h1>
      <p className="text-slate-500 text-sm">{send.data?.message ?? "Il locale la confermerà appena possibile."}</p>
      <p className="text-xs text-slate-400">La prenotazione non è valida finché non viene confermata.</p>
    </div>);

  const ok = f.guestName.trim() && f.phone.trim() && f.date && f.time && f.covers >= 1 && f.covers <= c.maxCovers;
  return shell(
    <form onSubmit={e => { e.preventDefault(); if (ok) send.mutate(); }} className="space-y-4">
      <div><h1 className="text-xl font-bold text-slate-800">{c.restaurantName}</h1><p className="text-sm text-slate-500">Richiedi un tavolo. Ti confermiamo noi.</p></div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs">Data</Label><Input type="date" min={today} value={f.date} onChange={e => set("date", e.target.value)} className="h-11" data-testid="input-date" /></div>
        <div><Label className="text-xs">Orario</Label><Input type="time" value={f.time} onChange={e => set("time", e.target.value)} className="h-11" data-testid="input-time" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs">Persone (max {c.maxCovers})</Label><Input type="number" min={1} max={c.maxCovers} value={f.covers} onChange={e => set("covers", parseInt(e.target.value) || 1)} className="h-11" data-testid="input-covers" /></div>
        <div><Label className="text-xs">Telefono</Label><Input type="tel" value={f.phone} onChange={e => set("phone", e.target.value)} className="h-11" data-testid="input-phone" /></div>
      </div>
      <div><Label className="text-xs">Nome</Label><Input value={f.guestName} onChange={e => set("guestName", e.target.value)} className="h-11" data-testid="input-name" /></div>
      <div><Label className="text-xs">Note</Label><textarea rows={2} value={f.notes} onChange={e => set("notes", e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm resize-none" data-testid="input-notes" /></div>
      <input type="text" name="website" value={f.website} onChange={e => set("website", e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" />
      {send.isError && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-2" data-testid="text-error">{(send.error as Error).message}</p>}
      <Button type="submit" className="w-full h-12" disabled={!ok || send.isPending} data-testid="button-submit">
        {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Invia richiesta"}
      </Button>
    </form>);
}
