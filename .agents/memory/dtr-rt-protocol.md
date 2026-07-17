---
name: Protocollo DTR RT XonXoff — documenti gestionali
description: Regole del protocollo XON/XOFF per la stampante fiscale DTR, in particolare documenti non fiscali (preconto, gestionali)
---

# Documenti gestionali (non fiscali) su RT DTR

**Regola**: un documento gestionale DEVE essere aperto con `j` e chiuso con `J`. Le righe di testo si stampano con `"testo"@` (max 32 char ASCII). Un `@` nudo senza stringa tra virgolette è input malformato → ERRORE 16 "Input Errato".

**Why:** tre tentativi falliti (2026-07) inviavano solo righe `"testo"@` terminate da `@` nudo, senza mai aprire il documento: la RT stampava le righe ma senza intestazione/piè di pagina programmati e finiva in ERRORE 16. La spec ufficiale è nel repo: `attached_assets/SPEC_XonXoff_DTR_21_1776802630202.pdf` (estraibile con pdftotext) — sezione "Scontrini Gestionali non fiscali".

**How to apply:** qualsiasi stampa non fiscale (preconto, documento gestionale, copia cortesia) deve passare da un wrapper `j` + righe + `J`. Con `j`/`J` la RT stampa da sola intestazione e coda: non duplicare la ragione sociale nelle righe.

# Recovery stati RT

- Stato `?` campo F: 0=chiuso, 1=aperto fiscale, 2=pagamento, 3=non-fiscale aperto.
- Dentro un documento non fiscale (stato 3) il comando di annullo `k` viene **ignorato**: per sbloccare va inviato `J` (chiusura). `k` funziona solo per scontrini fiscali (stato 1/2).
- Pre-check consigliato prima di aprire qualsiasi documento: `?` → se stato 3 invia `J`, se stato 1/2 invia `k`, poi pausa ~500ms.

# Altre note protocollo

- La RT non tollera due documenti concatenati nello stesso comando senza corretta apertura/chiusura di ciascuno.
- Test possibile solo su hardware fisico dell'utente: ogni iterazione richiede verifica manuale, quindi validare contro la spec PDF prima di proporre tentativi.
