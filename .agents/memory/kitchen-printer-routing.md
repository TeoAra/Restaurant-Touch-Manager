---
name: Instradamento tablet cucina
description: Regola per decidere quali prodotti arrivano sul monitor cucina e come le ricette li collegano a variazioni e costi.
---

Il tablet cucina deve ricevere soltanto gli articoli delle categorie assegnate a una stampante collegata a un reparto con tipo produzione `kitchen`. Le categorie di bar o altri reparti non devono comparire sul monitor.

**Why:** il nome di una categoria o di una stampante non è un criterio affidabile; la configurazione di reparto è la fonte di verità operativa per separare produzione cucina, bar e altri punti.

**How to apply:** per ogni nuovo filtro o canale di produzione, partire dal percorso categoria → stampante → reparto e dal relativo tipo di produzione. Se manca l'assegnazione, preferire non mostrare l'articolo nel tablet e indicare chiaramente la configurazione mancante.

La ricetta attiva del prodotto è la fonte unica per gli ingredienti: ogni ingrediente genera la variazione automatica “Senza …” e la selezione deve essere salvata con l'identificativo ingrediente, affinché il costo escluso confluisca correttamente nei facts e negli snapshot di marginalità.

**Why:** separare menu, variazioni e costi porta a comande stampate correttamente ma margini falsati.

**How to apply:** non duplicare ingredienti nelle variazioni manuali; risolvere sempre l'ultima ricetta attiva del prodotto e mantenere metadati ingrediente e origine ricetta nella variazione.

Una riga già inviata alla produzione non può essere ridotta o rimossa come una semplice bozza: lo storno deve essere durevole, instradato alla stessa stampante di reparto e stampato prima di applicare la modifica al conto. Lo stesso vale per l’annullamento dell’intero ordine.

**Why:** eliminare solo la riga dal POS lascia la cucina a preparare un prodotto che non verrà più addebitato, creando spreco e disallineamento operativo.

**How to apply:** conservare lo snapshot della riga e l’esito del ticket di storno; su errore di stampa non considerare conclusa la cancellazione. Un retry dopo ticket già stampato deve applicare la modifica senza ristampare.