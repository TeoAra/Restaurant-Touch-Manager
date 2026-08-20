---
name: Storico forniture beverage
description: Regola per prezzi e volumi storici di fusti e BIB nelle marginalità.
---

Regola: il costo beverage deve usare la fornitura con decorrenza più recente ma non successiva alla data della comanda. Le colonne correnti della linea non sono una fonte storica affidabile; le linee preesistenti alla cronologia devono essere trasformate una volta in una fornitura iniziale datata alla creazione della linea.

**Why:** aggiornare il prezzo del fornitore non deve cambiare retroattivamente la marginalità già calcolata, mentre le vendite future devono usare prezzo e volume nuovi. Un fallback silenzioso al record corrente produce report storici falsi.

**How to apply:** ogni nuovo calcolo, preview o allocazione di costo beverage deve ricevere la fornitura effettiva per data; le nuove decorrenze vanno registrate atomically con la modifica della linea e gli snapshot salvati non vanno riscritti.