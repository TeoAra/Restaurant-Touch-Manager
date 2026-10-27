---
name: Compatibilità dei terminali e conferme di pagamento
description: Vincoli del modello myPOS Go 2 e distinzione tra integrazione automatica e verifica manuale degli incassi.
---

Non equiparare myPOS Go 2 ai terminali Android myPOS: il supporto del profilo ECR non implica compatibilità con l’ePOS API. La documentazione ufficiale distingue Go 2 dal collegamento tramite ECR-POS Connect dei modelli Android.

**Why:** la verifica della documentazione del produttore ha confermato che promettere un collegamento automatico generico tramite API per Go 2 sarebbe inesatto. Abilitazione, firmware e protocollo effettivo devono essere verificati per il dispositivo e il mercato interessati.

**How to apply:** partire dalla guida ufficiale https://developers.mypos.com/guides/troubleshooting-guides/terminal-configuration-ecr-erp e dalla specifica del modello. Finché l’adattatore corretto non è disponibile e verificato, dichiarare la conferma manuale, non un’approvazione automatica. Lo stesso confine vale per Satispay Business senza un collegamento API attivo: la verifica nell’app dell’esercente non è una verifica del gestionale.

## PAX generico e Nexi D230

Il PAX D230 dell’utente è stato fornito direttamente da Nexi, non dal rivenditore DTR.

**Why:** l’utente lo ha confermato esplicitamente.

**How to apply:** per abilitazione e configurazione ECR fare riferimento a Nexi; la presenza del modello nel catalogo DTR non identifica il software installato sul terminale dell’utente.

La specifica PAX ECR/PC v1.62 fornita dall’utente su https://it.scribd.com/document/1026626781/Pax descrive `T00/T01` per Do Credit, `A30/A31` per Input Account e frame STX + comando + ETX + LRC senza due byte di lunghezza. La porta 10009 è un default di quella specifica, non una configurazione accertata del Nexi D230 dell’utente.

**Why:** un manuale generico PAX non identifica l’applicazione dell’acquirer installata sul terminale; confondere questi comandi o protocolli rende inattendibile il collegamento di pagamento.

**How to apply:** prima di implementare o dichiarare verificato l’adattatore Nexi, identificare versione dell’applicazione, modalità ECR abilitata e specifica effettiva tramite impostazioni del terminale o documentazione Nexi. Non dedurre la compatibilità dal solo nome PAX o dalla porta TCP aperta.

La documentazione ufficiale Nexi Traditional POS LAN Integration descrive pagamenti `P`/`X`, non i comandi del manuale generico PAX; Nexi configura abilitazione ECR, IP e porta. Fonte: https://developer.nexigroup.com/traditionalpos/en-EU/docs/integration-options-this-section-provides-an-overview-of-lan-integration-and-other-basic-integration-options/

**Why:** l’applicazione dell’acquirer determina il protocollo effettivo. Inoltre Nexi avverte che il recupero ultimo esito con `G` non fornisce un identificatore univoco che lo correli alla richiesta rimasta in sospeso.

**How to apply:** non sostituire alla cieca un comando PAX con un altro. Confermare la modalità ECR del terminale prima di collegarlo; non considerare un ultimo esito positivo prova sufficiente del pagamento corrente e non reinviare automaticamente una vendita dopo timeout.
