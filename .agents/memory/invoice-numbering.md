---
name: Numerazione fatture e Passepartout
description: Significato della numerazione richiesta dall’utente e tutela dei documenti già emessi.
---

Nel formato «1/23», 1 è il sezionale e 23 è il progressivo della fattura corrente, scelti dall’operatore. Non è una numerazione numero/anno. L’anno rimane un dato separato. Nel campo Numero dell’XML l’utente vuole «1/23», senza aggiungere zeri al progressivo.

**Why:** l’utente lo ha chiarito esplicitamente per integrare le fatture con Passepartout.

**How to apply:** mantenere la stessa identità nel front office, nel back office e nei dati esportati. Il nome del file e il progressivo tecnico di trasmissione FatturaPA non sono il numero della fattura e non devono cambiarlo.

Non rinumerare automaticamente documenti storici già emessi quando cambia la convenzione visuale.

**Why:** modificare l’identità di un documento esistente compromette il collegamento con la contabilità.

**How to apply:** applicare il formato richiesto ai nuovi documenti; preservare l’identità già assegnata ai precedenti.
