// Esporta dati in CSV compatibile con Excel italiano:
// separatore ";", BOM UTF-8, CRLF, decimali con virgola (a cura del chiamante).
export function downloadCsv(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
) {
  const esc = (v: string | number | null | undefined) => {
    let s = v == null ? "" : String(v);
    // Anti formula-injection: neutralizza celle che Excel interpreterebbe
    // come formule (=, +, @, tab) prefissando un apostrofo.
    // I numeri negativi restano intatti (es. "-5,00" non è una formula).
    if (/^[=+@\t]/.test(s) || (/^-/.test(s) && !/^-?\d+(,\d+)?$/.test(s))) {
      s = "'" + s;
    }
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const content =
    "\uFEFF" +
    [headers, ...rows].map(r => r.map(esc).join(";")).join("\r\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Formatta un numero per Excel italiano (virgola decimale)
export function itNum(v: string | number | null | undefined): string {
  const n = typeof v === "number" ? v : parseFloat(v ?? "0");
  return (isNaN(n) ? 0 : n).toFixed(2).replace(".", ",");
}
