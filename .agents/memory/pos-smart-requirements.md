---
name: Requisiti della cassa Smart
description: Vincoli richiesti dall’utente per il rinnovo della cassa HelloTable.
---

La nuova grafica deve mantenere assolutamente tutte le funzioni della cassa attuale. L’utente richiede l’orario di inserimento in piccolo per ciascun prodotto, una visione dei tavoli e una grafica scalabile su mobile, touch POS e laptop, anche aprendo la proposta in una scheda grande. La grafica di riferimento è quella mobile.

La colonna Tavoli va rimossa: mappa e area Categorie/Cliente/Pagamento devono essere unificate, sfruttando lo spazio della pagina principale. Questa richiesta sostituisce la precedente disposizione dei tavoli di lato.

Le schede Mappa, Categorie, Cliente e Pagamento devono essere ben visibili; le categorie devono avere pulsanti più grandi, sempre adattabili ai vari schermi.

L’utente vuole una cassa ancora più semplice e intuitiva: semplificare l’accesso alle funzioni, non ridurne il numero.

La schermata reale deve corrispondere al design presentato, con accesso effettivo alla mappa: una schermata compressa o diversa dalla proposta non soddisfa la richiesta.

Al posto di “Listino” l’utente vuole vedere le fasi F1–F4.

La grafica deve essere omogenea in tutto il front office e nel back office, con gli stessi colori ben visibili.

L’utente non vuole il verde: usare tonalità più neutre, con riferimenti SumUp e Flatpay, in modo coerente nel front office e nel backoffice.

Nel front office non devono comparire le schede Menu e Variazioni; l’accesso ai prodotti rimane dalle Categorie e alle modifiche dalla comanda. La vista iniziale deve essere la mappa, adattata allo spazio senza scorrimento.

Le posizioni e l’ordine dei tavoli modificati nel backoffice devono essere salvati e mantenuti al ricaricamento.

Un conto separato deve addebitare solo le quantità scelte: selezionare un oggetto da una riga di tre non deve addebitare tutti e tre. Importo incassato in contanti o POS e quantità/importo del documento fiscale devono coincidere; gli oggetti non pagati restano sul tavolo.

Il corpo del back office deve utilizzare tutta la larghezza disponibile, non una colonna centrale stretta.

Asporto e Delivery devono essere visibili solo se abilitati con la relativa spunta nel back office.

Il prezzo del coperto deve essere preso automaticamente dal back office; non deve essere necessario reinserirlo nella cassa per ogni tavolo.

Un tocco su un prodotto deve aggiungere subito una singola unità, come nella versione precedente, senza obbligare a scegliere la quantità. Quantità e prezzo restano modificabili dalla riga della comanda.

L’utente vuole restringere mappa e categorie e inserire una colonna con tutti i prodotti del tavolo tra l’area sinistra e tastierino/comandi a destra. La comanda non deve essere schiacciata dal tastierino: quantità, prezzi e selezione del conto separato devono essere grandi e leggibili. Questa richiesta sostituisce il tastierino sotto la comanda sugli schermi che consentono tre colonne.

Le due colonne della comanda e del tastierino/comandi devono avere pari larghezza. Mappa, Categorie, Cliente e Pagamento devono mantenere le stesse dimensioni passando da una vista all’altra.

Nella colonna destra il tastierino deve essere più ampio in verticale e in basso, non in alto. La colonna centrale della comanda non deve ripetere il marchio HelloTable.

**Why:** l’utente ha richiesto esplicitamente proporzioni uniformi.

Su desktop il tastierino rimane visibile in tutte le viste, senza menu “Altro”. Su telefono, dove le colonne diventano viste separate, appartiene alla vista Conto: mappa e pagamento non devono essere compressi da un dock separato.

Eccezione alla conservazione dei comandi: l’utente ha chiesto di togliere Sospeso e Cassetto dal front office, aumentare l’altezza delle azioni del conto ed eliminare i tagli contanti preimpostati. L’importo ricevuto si deve poter digitare a mano o con tastierino.

**Why:** l’utente non usa Sospeso e Cassetto e vuole semplificare l’incasso touch.

**How to apply:** non reintrodurre questi pulsanti nella cassa quando si aggiornano i controlli; mantenere il resto automatico.

**Why:** l’utente trova troppo piccoli i prodotti quando modifica prezzo/quantità o separa il conto e chiede una colonna centrale dedicata, senza rimuovere le funzioni della cassa.

**How to apply:** dare spazio indipendente a comanda e comandi sui touch POS/laptop; durante il conto separato la selezione dei prodotti appartiene alla colonna centrale. Sugli schermi stretti adattare la disposizione senza perdere selezioni, importi o stato di recupero del pagamento.

I prodotti devono restare separati anche se selezionati più volte: ogni tocco aggiunge una nuova riga, senza aumentare automaticamente la quantità di una riga già presente.

Il pulsante Incassa in basso a destra deve mostrare il prezzo complessivo del tavolo o del banco/scontrino rapido e aprire sempre la pagina dell’incasso, indipendentemente dalla situazione. L’apertura della pagina non è una conferma del pagamento.

Le prenotazioni online devono essere confermate manualmente dall’operatore nell’agenda, non confermate automaticamente. L’utente ha scelto WhatsApp per ricevere gli avvisi oltre alla cassa.

I terminali indicati dall’utente sono Nexi PAX D230 e myPOS Go 2. Per il modello della stampante fiscale e il protocollo confermati dall’utente, vedere [Protocollo DTR RT](dtr-rt-protocol.md).

**Why:** l’utente ha esplicitamente richiesto questi vincoli per il rinnovo, non una versione ridotta della cassa.

Le sale nella mappa devono avere pulsanti grandi e seguire l’ordine impostato nel backoffice. La dimensione della mappa deve essere uguale per tutte le sale, adattata allo spazio disponibile. La comanda deve essere larga e leggibile; log e pulsanti di servizio devono stare nella barra superiore.

Il comando Indietro della mappa deve stare nella stessa riga dei pulsanti delle sale e degli altri controlli, senza una barra separata.

**Why:** l’utente vuole recuperare spazio per la mappa sulla cassa touch.

**How to apply:** prima dell’integrazione confrontare le funzioni con la cassa esistente; non sostituire i flussi reali con quelli simulati del prototipo. Controllare anche finestre basse e scheda intera, non solo il frame desktop del canvas.
