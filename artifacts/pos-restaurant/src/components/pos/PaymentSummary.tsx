export type OrderPayment = { id: number; method: string; amount: string; createdAt?: string; operationId?: string | null; fiscalReceiptId?: number | null };

const METHOD: Record<string, string> = { cash: "Contanti", card: "Carta", ticket: "Buono", other: "Altro" };

export function PaymentSummary({ total, paid, payments, testId = "payment-summary" }: {
  total: number; paid: number; payments?: OrderPayment[]; testId?: string;
}) {
  const remaining = Math.max(0, Math.round((total - paid) * 100) / 100);
  if (paid <= 0.005 && !(payments && payments.length)) return null;
  return (
    <div className="rounded-xl border-2 border-[#174f43]/40 bg-[#fffefa] p-2.5 text-slate-900" data-testid={testId}>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div><div className="text-[10px] font-bold uppercase text-slate-600">Totale</div><div className="font-extrabold tabular-nums" data-testid={`${testId}-total`}>€{total.toFixed(2)}</div></div>
        <div><div className="text-[10px] font-bold uppercase text-slate-600">Già pagato</div><div className="font-extrabold tabular-nums text-[#174f43]" data-testid={`${testId}-paid`}>€{paid.toFixed(2)}</div></div>
        <div><div className="text-[10px] font-bold uppercase text-slate-600">Residuo</div><div className="font-extrabold tabular-nums text-[#a44d21]" data-testid={`${testId}-remaining`}>€{remaining.toFixed(2)}</div></div>
      </div>
      {payments && payments.length > 0 && (
        <ul className="mt-2 border-t border-slate-300 pt-1.5 space-y-0.5" data-testid={`${testId}-history`}>
          {payments.map(p => (
            <li key={p.id} className="flex justify-between text-xs">
              <span>
                {p.createdAt ? new Date(p.createdAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : ""} · {METHOD[p.method] ?? p.method}
                {p.fiscalReceiptId ? ` · scontrino #${p.fiscalReceiptId}` : ""}
              </span>
              <b className="tabular-nums">€{parseFloat(p.amount).toFixed(2)}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
