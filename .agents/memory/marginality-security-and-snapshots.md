---
name: Marginalità: sicurezza e snapshot
description: Regole durevoli per i dati economici, la sessione amministratore e i calcoli storici.
---

Le API di marginalità richiedono una sessione amministratore firmata dal server; il ruolo ricevuto dal client non è un'autorizzazione sufficiente.

**Why:** ricette, costi e margini sono dati finanziari sensibili e modificabili; la sola protezione della route nel Backoffice può essere aggirata.

**How to apply:** ogni nuova lettura o scrittura nel dominio marginalità deve restare protetta dalla sessione lato server, anche quando viene aggiunta una nuova pagina o un client diverso.

Gli snapshot di marginalità rappresentano una versione immutabile; coperti, costi storici degli ingredienti e quote utenze devono entrare nel calcolo della versione senza modificare i risultati precedenti.

**Why:** il POS può eliminare righe dopo un conto separato e i costi cambiano nel tempo; ricalcoli e analisi devono restare spiegabili.

**How to apply:** catturare gli elementi venduti nella transazione di pagamento, usare costi datati, e creare una nuova versione esplicita per ogni ricalcolo.

Quando il tempo reale di cucina arriva dopo il pagamento, la marginalità deve creare una nuova versione immutabile invece di modificare lo snapshot esistente.

**Why:** pagamento e stato `ready` possono sovrapporsi; un calcolo concluso troppo presto non deve perdere definitivamente il tempo reale di preparazione.

**How to apply:** serializzare i cambiamenti concorrenti sullo stesso ordine e assicurare che il pagamento catturi il dato definitivo oppure che il completamento cucina generi il ricalcolo successivo.