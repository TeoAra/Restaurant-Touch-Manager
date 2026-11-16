---
name: Attribuzione vendite nei report
description: Periodo fiscale, fatture e attribuzione dei prodotti nei report del POS
---

# Periodo fiscale e vendite documentate

I riepiloghi X/Z e il riepilogo del servizio devono partire dall'ultima Z confermata, non dalla mezzanotte. Le fatture fanno parte delle vendite gestionali anche quando non transitano dalla RT. Distinguere vendite, pagamenti registrati, totali letti dalla RT ed esiti incerti; non sommare due volte fattura e scontrini collegati allo stesso ordine.

**Why:** l'utente vuole sapere «dalla chiusura precedente quanto è stato battuto e inviato alla rt» e includere le fatture nelle statistiche. Un servizio può attraversare la mezzanotte e gli incassi separati possono lasciare il tavolo aperto.

**How to apply:** usare gli eventi documentali/incassi per i totali finanziari, includere le bozze fattura già incassate ma non quelle non pagate. Non attribuire il vecchio turno alla data di una verifica Z tardiva. Se mancano prove fiscali o date storiche, segnalarlo senza inventare emissioni o invii AdE/SDI. Il rapporto fiscale della RT resta distinto dal riepilogo gestionale.

## Attribuzione dei prodotti agli ordini

Le statistiche dei prodotti e i conteggi degli ordini devono riferirsi a `orders.createdAt` e agli ordini pagati, mai a `order_items.createdAt`. Non confondere queste statistiche con il registro degli eventi finanziari.

**Why:** articoli aggiunti dopo la creazione della comanda possono falsare il periodo; contare ordini aperti o cancellati gonfia le vendite per prodotto.

**How to apply:** mantenere esplicita in interfaccia la differenza tra data dell'ordine per i prodotti e data di incasso/emissione per i totali finanziari.
