---
name: Validazione numerica dei contratti API
description: Limite del generatore Orval nella validazione degli interi e vincoli runtime da verificare.
---

Non presumere che un campo OpenAPI `type: integer` venga validato come intero dallo schema Zod generato. Per coordinate e conteggi aggiungere un vincolo effettivo, ad esempio `multipleOf: 1`, e provare esplicitamente valori frazionari.

**Why:** il generatore usato dal progetto ha prodotto uno schema che accettava coordinate frazionarie nonostante il tipo integer. I test dei soli valori negativi non rilevavano il problema.

**How to apply:** quando si aggiungono contratti numerici, verificare lo schema generato con valori frazionari, non finiti e fuori intervallo; per quantità finanziarie mantenere anche una validazione esplicita prima dell’incasso.
