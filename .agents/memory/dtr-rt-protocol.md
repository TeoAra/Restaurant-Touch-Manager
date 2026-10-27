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

# Parola "TOTALE" vietata (causa ERRORE 16)

**Regola**: la parola `TOTALE` NON può comparire in nessuna riga di testo `"..."@`, né in scontrino fiscale né in documento non fiscale. La spec dice: "la parola TOTALE non è consentita" (fiscale) e nei non-fiscali "annullando la stampa della riga in cui è contenuta". Usare `TOT.` o simile.

**Why:** limitazione di legge anti-scontrino-falso. Errore 16 sul preconto (2026-07) scattava proprio sulla riga `TOTALE EUR x.xx`.

**How to apply:** sanitizzare sempre le righe con replace `/TOTALE/gi → "TOT."` prima dell'invio (difesa anche per nomi prodotto).

# Flow control: record max 256 byte

**Regola**: dal lato PC inviare record di max ~256 byte (soglia buffer RX della RT = 384 byte, oltre → caratteri PERSI senza recupero → comandi mutilati → ERRORE 16). Mai spezzare un comando a metà tra un record e l'altro (timeout ricezione ~1s annulla i comandi incompleti); pause tra record < 1s (~120ms ok).

**Why:** un preconto intero supera facilmente 400-700 byte; inviarlo in un singolo `socket.write` mandava in overflow il buffer.

**How to apply:** usare invio chunked con rispetto XOFF/XON: su XOFF pausa, attendi XON. XOFF transitorio seguito da XON = buffer pieno normale, NON errore; XOFF persistente = errore → inviare `K` (tasto C) per sbloccare, attendere XON, riprovare. Esito ok = ultimo flow-byte non-XOFF, non `xoffCount === 0`.

# Altre note protocollo

- La RT idle manda XON ogni ~1s: non riarmare timer di risposta sugli XON (solo su byte ASCII), altrimenti la promise non si risolve mai.
- Il "tappo" `""@` (Nota1 spec) serve solo se `@` è l'ultimo comando; con chiusura `J` subito dopo non serve.
- Dentro un documento non fiscale il font delle righe `@` è lo STESSO dello scontrino: non esiste selettore font nel gestionale; centratura solo tramite spazi nella stringa.

- La RT non tollera due documenti concatenati nello stesso comando senza corretta apertura/chiusura di ciascuno.
- Test possibile solo su hardware fisico dell'utente: ogni iterazione richiede verifica manuale, quindi validare contro la spec PDF prima di proporre tentativi.

# Identificazione dei documenti e chiusura fiscale

Per visualizzazione e annullamento fiscali usare i riferimenti assegnati dalla scontrinatrice, non il progressivo generato dal gestionale. L’utente precisa che dopo la chiusura fiscale la sua RT riparte dal documento 1, con le altre diciture stabilite dalla stampante.

**Why:** l’utente ha richiesto esplicitamente che scontrini e annullamenti corrispondano alla numerazione reale della RT.

**How to apply:** distinguere gli identificativi interni dall’identità fiscale composta da matricola, chiusura, numero documento e data. Un riferimento RT mancante non deve essere ricostruito usando il numero interno o una chiusura predefinita; non rinumerare retroattivamente lo storico.

## Esiti incerti di annulli e chiusure

Una risposta persa dopo l’invio di un annullo o di una chiusura Z non equivale a un rifiuto. Conservare l’esito da verificare senza segnare l’operazione come riuscita e senza rispedirla automaticamente, anche dopo un riavvio.

**Why:** la RT può aver completato un’operazione fisica prima che la cassa ne perda la risposta; riprovare alla cieca può produrre un secondo documento o una seconda chiusura.

**How to apply:** distinguere rifiuto prima dell’invio, tentativo inviato e conferma fiscale. Per una conferma usare lo stato e i contatori reali della RT, non la sola riuscita della connessione TCP.

## Compatibilità delle verifiche prima della Z

Non imporre la disponibilità simultanea delle due interrogazioni quando una risposta ECR completa verifica identità, assenza di errori e documento chiuso. Se si usa una fonte alternativa per il contatore Z, la conferma deve confrontare prima e dopo della stessa fonte, senza equiparare i due contatori.

**Why:** dopo l’introduzione di verifiche più restrittive l’utente ha segnalato la RT connessa ma la chiusura bloccata prima dell’invio; la compatibilità non va risolta eliminando tutte le verifiche di sicurezza.

**How to apply:** conservare il blocco dei documenti aperti e degli esiti incerti, e riportare il motivo specifico quando lo stato non è verificabile. Un XOFF transitorio seguito da XON non dimostra un guasto.
