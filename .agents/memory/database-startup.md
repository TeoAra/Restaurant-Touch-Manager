---
name: Sincronizzazione schema all’avvio
description: Pericolo delle conferme interattive di Drizzle sui dati contabili esistenti.
---

La sincronizzazione dello schema eseguita prima dell’avvio dell’API deve restare non interattiva e non distruttiva. Non accettare mai il troncamento di pagamenti o documenti per completare un aggiornamento.

**Why:** anche con `--force`, Drizzle può fermarsi a chiedere se troncare una tabella popolata quando si aggiunge un vincolo UNIQUE. Il server rimane fermo prima di aprire la porta, facendo sembrare il problema un guasto di rete.

**How to apply:** se l’API non apre la porta dopo una modifica allo schema, leggere prima il log della sincronizzazione. Per nuovi identificativi opzionali, un indice univoco su colonna nullable mantiene i dati precedenti e l’unicità dei nuovi valori senza quella conferma. Verificare sempre che le modifiche siano additive; non inviare risposte automatiche a conferme distruttive.
