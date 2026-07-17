---
name: Attribuzione vendite nei report
description: Regola per filtri data e conteggio vendite nei report del POS
---

# Regola: i report vendite si attribuiscono alla data dell'ORDINE, solo ordini pagati

- Qualsiasi report/statistica di vendita (top prodotti, vendite per giorno, ecc.) deve filtrare su `orders.createdAt` e `orders.status = 'paid'`.
- **Why:** `order_items.createdAt` può divergere dalla data dell'ordine (item aggiunti/modificati dopo, anche mesi dopo in test); contare ordini open/cancelled gonfia i report con comande mai incassate. Bug reale trovato: un item creato a luglio su un ordine di maggio compariva nel report di luglio.
- **How to apply:** nei nuovi endpoint di reporting, join su `orders` con filtro status paid + range su `orders.createdAt`, coerente con `sales-by-day`.
