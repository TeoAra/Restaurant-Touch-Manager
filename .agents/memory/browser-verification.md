---
name: Contesto del browser di verifica
description: Una particolarità del Chromium disponibile nell’ambiente di sviluppo.
---

Chromium può esporre target di estensioni preinstallate insieme alle normali pagine. Il primo target restituito non è necessariamente la pagina dell’app.

**Why:** un controllo della cassa rimaneva su una pagina di background di un’estensione invece di osservare l’app, producendo un timeout fuorviante.

**How to apply:** quando una verifica browser sembra non vedere la pagina o la navigazione, controllare prima il tipo e l’URL del contesto osservato, senza attribuire subito il problema all’app.

Per verificare soltanto navigazione e gesti nella cassa reale, intercettare e bloccare le richieste di scrittura, lasciando passare l’autenticazione. Controllare quali richieste sarebbero partite, senza eseguire incassi o stampe.

**Why:** anche gesti apparentemente grafici possono invocare operazioni persistenti; una prova visiva non deve modificare disponibilità, comande o dati fiscali.

**How to apply:** nei controlli browser puramente di interfaccia usare l’intercettazione delle richieste; per verificare invece il successo delle operazioni usare dati isolati e stampanti simulate. Il blocco delle scritture non prova il funzionamento di incassi o stampe.
