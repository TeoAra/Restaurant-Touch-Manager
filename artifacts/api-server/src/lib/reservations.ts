export const bookingStatuses = ["pending", "confirmed", "arrived", "cancelled", "noshow", "completed"] as const;

export function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateBooking(value: Record<string, unknown>): string | null {
  if (!validDate(value.date)) return "Data non valida";
  if (typeof value.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)) return "Orario non valido";
  if (typeof value.guestName !== "string" || !value.guestName.trim() || value.guestName.length > 100) return "Inserisci il nome (massimo 100 caratteri)";
  if (!Number.isInteger(value.covers) || Number(value.covers) < 1 || Number(value.covers) > 100) return "Coperti non validi (1–100)";
  if (!Number.isInteger(value.durationMinutes) || Number(value.durationMinutes) < 15 || Number(value.durationMinutes) > 720) return "Durata non valida (15–720 minuti)";
  if (!bookingStatuses.includes(value.status as typeof bookingStatuses[number])) return "Stato prenotazione non valido";
  if (value.phone != null && (typeof value.phone !== "string" || value.phone.length > 30 || (value.phone !== "" && !/^[+\d\s().-]{5,30}$/.test(value.phone)))) return "Numero di telefono non valido";
  if (value.notes != null && (typeof value.notes !== "string" || value.notes.length > 2000)) return "Note troppo lunghe (massimo 2000 caratteri)";
  return null;
}

export function bookingTableIds(row: { tableId?: number | null; tableIds?: string | null }): number[] {
  if (row.tableIds) {
    try {
      const ids: unknown = JSON.parse(row.tableIds);
      if (Array.isArray(ids)) return ids.filter((id): id is number => Number.isInteger(id) && id > 0);
    } catch { /* Legacy single-table records still have tableId. */ }
  }
  return row.tableId ? [row.tableId] : [];
}

type Slot = { id?: number; date: string; time: string; durationMinutes: number; status: string; tableId?: number | null; tableIds?: string | null };
export function bookingConflict(candidate: Slot, others: Slot[]): Slot | undefined {
  if (!["confirmed", "arrived"].includes(candidate.status)) return undefined;
  const ids = bookingTableIds(candidate);
  const start = Date.parse(`${candidate.date}T${candidate.time}:00Z`);
  const end = start + candidate.durationMinutes * 60_000;
  return others.find(other => {
    if (other.id === candidate.id || !["confirmed", "arrived"].includes(other.status)) return false;
    if (!bookingTableIds(other).some(id => ids.includes(id))) return false;
    const otherStart = Date.parse(`${other.date}T${other.time}:00Z`);
    return start < otherStart + other.durationMinutes * 60_000 && end > otherStart;
  });
}
