---
name: Contesto del browser di verifica
description: Una particolarità del Chromium disponibile nell’ambiente di sviluppo.
---

Chromium può esporre target di estensioni preinstallate insieme alle normali pagine. Il primo target restituito non è necessariamente la pagina dell’app.

**Why:** un controllo della cassa rimaneva su una pagina di background di un’estensione invece di osservare l’app, producendo un timeout fuorviante.

**How to apply:** quando una verifica browser sembra non vedere la pagina o la navigazione, controllare prima il tipo e l’URL del contesto osservato, senza attribuire subito il problema all’app.
