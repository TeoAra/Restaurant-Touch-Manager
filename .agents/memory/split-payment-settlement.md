---
name: Regolazione conto separato
description: Regola fiscale per articolare un conto separato senza lasciare righe già stampate nel residuo.
---

Regola: la chiusura parziale di un conto deve essere regolata dal server soltanto dopo la conferma della RT. Il client invia le quantità selezionate, ma non può essere responsabile di eliminare o ridurre le righe.

**Why:** le righe già inviate alla cucina non erano eliminabili dalla normale API del carrello; ignorare quell'errore lasciava nel residuo articoli già fiscalizzati. Una riga con quantità maggiore di uno richiede inoltre una riduzione parziale, non la cancellazione totale.

**How to apply:** acquisire prima una riserva persistente per ordine e richiesta, nella stessa transazione che valida importo/quantità e registra il pagamento. Finché la riserva è pending, ogni altro invio è bloccato; dopo la regolazione, un retry con lo stesso identificativo è idempotente. Stampare le quantità validate, quindi aggiornare atomically righe, coperti e totale residuo. Un timeout o una risposta RT inconclusiva è fiscalmente ambiguo: mantenere la riserva bloccata e richiedere riconciliazione esplicita, mai reinviare automaticamente.