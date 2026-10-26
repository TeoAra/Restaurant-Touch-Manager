import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, Copy, RefreshCw, Printer, AlertTriangle, CheckCircle2 } from "lucide-react";

export type InvoiceResult = {
  id: number; numeroDocumento?: string; anno?: number; xml?: string; fileName?: string;
  emitted: boolean; rtOk?: boolean; rtError?: string; error?: string; busy?: boolean;
};

export function InvoiceResultDialog({ result, onClose, onEmit, onRecoverXml, onDownload, onCopy }: {
  result: InvoiceResult | null; onClose: () => void;
  onEmit: () => void; onRecoverXml: () => void; onDownload: () => void; onCopy: () => void;
}) {
  return (
    <Dialog open={!!result} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl w-[calc(100vw-1.5rem)] max-h-[90vh] flex flex-col gap-3" data-testid="dialog-invoice-result">
        <DialogHeader><DialogTitle>Fattura n. {result?.numeroDocumento ?? "—"}{result?.anno ? ` · anno ${result.anno}` : ""}</DialogTitle></DialogHeader>
        {result && (<>
          <div className={`rounded-lg border-2 px-3 py-2 text-sm font-semibold flex items-center gap-2 ${result.emitted ? "border-[#174f43] bg-[#edf5e9] text-[#174f43]" : "border-[#a44d21] bg-[#fff0e2] text-[#7a3510]"}`} data-testid="status-invoice">
            {result.emitted ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            {result.emitted ? "Fattura emessa e salvata" : "Fattura salvata in bozza: emissione da completare"}
          </div>
          {result.error && <div className="text-sm text-[#a03f36] font-semibold">{result.error}</div>}
          {result.emitted && result.rtOk === false && <div className="text-sm text-[#7a3510] font-semibold">Copia di cortesia non stampata: {result.rtError ?? "errore RT"}. L'XML è comunque salvato.</div>}
          {result.fileName && <div className="text-xs font-mono text-slate-800">{result.fileName}</div>}
          {result.xml && <pre className="flex-1 min-h-[120px] overflow-auto rounded-lg border border-slate-300 bg-slate-100 p-2 text-[11px] text-slate-900 whitespace-pre-wrap" data-testid="text-invoice-xml">{result.xml}</pre>}
          <div className="flex flex-wrap gap-2">
            {result.xml && <button className="h-11 px-4 rounded-xl bg-[#174f43] text-white font-bold flex items-center gap-2" onClick={onDownload} data-testid="button-invoice-download"><Download className="h-4 w-4" />Scarica XML</button>}
            {result.xml && <button className="h-11 px-4 rounded-xl border-2 border-slate-400 bg-white text-slate-900 font-bold flex items-center gap-2" onClick={onCopy} data-testid="button-invoice-copy"><Copy className="h-4 w-4" />Copia XML</button>}
            {!result.emitted && <button disabled={result.busy} className="h-11 px-4 rounded-xl bg-[#174f43] text-white font-bold flex items-center gap-2 disabled:opacity-50" onClick={onEmit} data-testid="button-invoice-emit"><Printer className="h-4 w-4" />Emetti ora</button>}
            {!result.xml && <button disabled={result.busy} className="h-11 px-4 rounded-xl border-2 border-slate-400 bg-white text-slate-900 font-bold flex items-center gap-2 disabled:opacity-50" onClick={onRecoverXml} data-testid="button-invoice-recover"><RefreshCw className="h-4 w-4" />Recupera XML</button>}
            <button className="h-11 px-4 rounded-xl border-2 border-slate-400 bg-white text-slate-900 font-bold ml-auto" onClick={onClose} data-testid="button-invoice-close">Chiudi</button>
          </div>
        </>)}
      </DialogContent>
    </Dialog>
  );
}
