---
name: Modello costo ingredienti a peso
description: Come si interpreta la quantità in ricetta e come si calcola il costo per ingredienti venduti a peso (prezzo/kg, peso fetta).
---

# Modello costo ingredienti a peso

Regola: la quantità di una riga ricetta è **contestuale** al modello dell'ingrediente:
- `sliceWeightG` configurato → quantità = numero di fette; costo = fette × peso fetta × (costo unità ÷ `unitSizeG`)
- solo `unitSizeG` configurato → quantità = grammi; costo = grammi × (costo unità ÷ `unitSizeG`)
- nessun peso → quantità nell'unità base (comportamento storico, invariato)

`sliceWeightG` è valido solo se anche `unitSizeG` è presente (validazione server).

**Why:** l'utente compra a €/kg (es. edamer) e ragiona in fette per porzione; chiedere il costo per fetta a mano era fonte di errori. I dati produttivi (porzioni, minuti, packaging per porzione) sono stati rimossi dal form ricetta: i minuti reali arrivano dal monitor cucina, il coperto è nei costi fissi. I campi legacy (`yieldQuantity`=1, `preparationMinutes`=0, `packagingCostPerUnit`=0) restano nel DB con default per non rompere snapshot storici.

**How to apply:** ogni nuovo consumo del costo ingrediente (report, export, simulazioni) deve replicare la stessa conversione contestuale, non usare `currentUnitCost` grezzo quando i pesi sono configurati.

Questione aperta: non è ancora deciso se `currentUnitCost` sia IVA inclusa o esclusa — oggi l'IVA (`vatRate`) è registrata ma non applicata nel calcolo costo.
