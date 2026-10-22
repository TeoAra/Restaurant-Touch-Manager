import { useMemo, useState } from "react";
import { Map, Search, Users, X } from "lucide-react";
import type { TableStatus } from "@workspace/api-client-react";

type SmartTable = TableStatus & { roomName?: string; elementType?: string };

interface Props {
  tables: SmartTable[];
  selectedId: number | null;
  onSelect: (table: SmartTable) => void;
  onMap: () => void;
  onClose: () => void;
}

/** A second view of the existing table state, not a separate order store. */
export function SmartTables({ tables, selectedId, onSelect, onMap, onClose }: Props) {
  const [search, setSearch] = useState("");
  const [room, setRoom] = useState("");
  const actualTables = tables.filter(t => !t.elementType || t.elementType === "table");
  const rooms = useMemo(() => Array.from(new Set(actualTables.map(t => t.roomName).filter(Boolean))), [actualTables]);
  const visible = actualTables.filter(t =>
    (!room || t.roomName === room) &&
    `${t.name} ${t.roomName ?? ""}`.toLocaleLowerCase("it").includes(search.toLocaleLowerCase("it"))
  );
  return (
    <aside id="pos-tables" className="pos-tables" aria-label="Tavoli della sala">
      <div className="pos-tables-heading">
        <div><small>LA SALA</small><h2>Tavoli <span>{actualTables.filter(t => t.activeOrderId).length}/{actualTables.length}</span></h2></div>
        <button className="pos-icon-button" onClick={onMap} title="Apri la mappa della sala" aria-label="Mappa della sala"><Map size={18} /></button>
        <button className="pos-tables-close pos-icon-button" onClick={onClose} aria-label="Chiudi tavoli"><X size={18} /></button>
      </div>
      <label className="pos-table-search"><Search size={15} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cerca tavolo…" aria-label="Cerca tavolo" /></label>
      {rooms.length > 1 && <select className="pos-room-select" aria-label="Filtra per sala" value={room} onChange={e => setRoom(e.target.value)}><option value="">Tutte le sale</option>{rooms.map(r => <option key={r} value={r}>{r}</option>)}</select>}
      <div className="pos-table-list" aria-label="Elenco tavoli">
        {visible.map(t => (
          <button key={t.id} onClick={() => onSelect(t)} className={`pos-table-card ${t.id === selectedId ? "is-selected" : ""}`} aria-pressed={t.id === selectedId}>
            <span className="pos-table-card-top"><strong>{t.name}</strong><span className={`pos-table-state ${t.activeOrderId ? "busy" : t.status === "reserved" ? "reserved" : "free"}`}>{t.activeOrderId ? "Occupato" : t.status === "reserved" ? "Prenotato" : "Libero"}</span></span>
            <span className="pos-table-meta"><Users size={12} /> {t.seats} posti{t.roomName ? ` · ${t.roomName}` : ""}</span>
            <span className="pos-table-card-bottom">{t.activeOrderId ? "Conto aperto" : "Apri tavolo"}<b>{t.activeOrderId ? `€ ${Number(t.activeOrderTotal ?? 0).toFixed(2)}` : "→"}</b></span>
          </button>
        ))}
        {!visible.length && <p className="pos-table-empty">{actualTables.length ? "Nessun tavolo trovato." : "Nessun tavolo configurato. Usa Banco per una vendita rapida."}</p>}
      </div>
      <button className="pos-map-link" onClick={onMap}><Map size={15} /> Mappa e prenotazioni</button>
    </aside>
  );
}
