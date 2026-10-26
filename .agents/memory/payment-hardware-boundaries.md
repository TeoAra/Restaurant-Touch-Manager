---
name: Compatibilità dei terminali e conferme di pagamento
description: Vincoli del modello myPOS Go 2 e distinzione tra integrazione automatica e verifica manuale degli incassi.
---

Non equiparare myPOS Go 2 ai terminali Android myPOS: il supporto del profilo ECR non implica compatibilità con l’ePOS API. La documentazione ufficiale distingue Go 2 dal collegamento tramite ECR-POS Connect dei modelli Android.

**Why:** la verifica della documentazione del produttore ha confermato che promettere un collegamento automatico generico tramite API per Go 2 sarebbe inesatto. Abilitazione, firmware e protocollo effettivo devono essere verificati per il dispositivo e il mercato interessati.

**How to apply:** partire dalla guida ufficiale https://developers.mypos.com/guides/troubleshooting-guides/terminal-configuration-ecr-erp e dalla specifica del modello. Finché l’adattatore corretto non è disponibile e verificato, dichiarare la conferma manuale, non un’approvazione automatica. Lo stesso confine vale per Satispay Business senza un collegamento API attivo: la verifica nell’app dell’esercente non è una verifica del gestionale.
