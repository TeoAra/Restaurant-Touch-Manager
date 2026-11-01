---
name: Incassi ed esiti fiscali incerti
description: Distinguere emissione dimostrata, lettura degli estremi e recupero contabile senza duplicare pagamenti o stampe.
---

Un documento fiscalmente emesso non può essere annullato dal rollback del database. Il recupero contabile non deve causare un nuovo addebito POS o una nuova emissione RT.

**Why:** l’utente ha segnalato un 502 con conti separati già ricevuti dalla RT ma non allineati nel software. Un errore software non dimostra il mancato incasso o la mancata emissione.

**How to apply:** conservare il tentativo prima dell’operazione esterna; separare le transazioni contabili dall’attesa della RT. Se l’emissione è già dimostrata, recuperare solo la registrazione. Se è incerta, fermare la ripetizione anche cambiando identificativo e chiedere riconciliazione, senza dedurre successo da un semplice ACK di rete.

Lettura degli estremi del documento ed emissione sono due verifiche distinte: estremi mancanti non devono trasformare un’emissione dimostrata in un conto non incassato. Non assumere equivalenza fra campi contatore di interrogazioni RT diverse senza specifica del modello.

**Why:** un modello può chiudere correttamente il documento ma non restituire un’identità completa o compatibile con l’altra interrogazione. La numerazione fiscale appartiene alla RT, non al gestionale.

**How to apply:** conservare e mostrare lo stato incompleto degli estremi; non inventare numeri o presentare ID interni come riferimenti fiscali. Non correggere automaticamente episodi storici senza identificare l’operazione e il documento reale.

L’utente vuole poter rimandare una chiusura Z che non risulta eseguita, senza restare bloccato da un vecchio tentativo incerto.

**Why:** ha segnalato che il messaggio «Chiusura già inviata» impediva di recuperare una chiusura che la RT, secondo quanto osservato, non aveva eseguito.

**How to apply:** offrire verifica e reinvio manuale separati. Se la stessa RT dimostra l’avanzamento del contatore originale, riconciliare senza nuovo comando. Consentire il reinvio soltanto dopo verifica del contatore invariato, RT pronta e conferma esplicita dell’operatore; ricontrollare prima dell’invio. Nessuna ripetizione automatica né cambio arbitrario di fonte del contatore.
