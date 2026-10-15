import { useMemo, useState } from "react";
import {
  ArrowLeft, ArrowRight, Banknote, Beer, Check, ChevronDown, CircleHelp,
  Clock3, CreditCard, FileText, Heart, Info, Minus, Plus,
  Search, Send, Split, Users, Utensils, Wallet, X, Map, List, MoreHorizontal,
  SlidersHorizontal, Tag, StickyNote, Ticket, Truck, ReceiptText,
  UserRound, ShieldCheck, Calculator, CircleDollarSign, RotateCcw, Ban,
} from "lucide-react";
import "./_group.css";
import "./Smart.css";

type Product = { id: number; name: string; price: number; category: string; allergens?: string };
type Item = { id: number; product: Product; qty: number; status: "inviato" | "bozza"; modifier?: string; note?: string; insertedAt: string; phase: number };
type Table = { id: number; name: string; seats: number; covers: number; elapsed: number; status: "occupato" | "libero" | "prenotato"; items: Item[] };
type PayMode = "intero" | "separato" | "romana";
type Operation = { title: string; group: string; description: string; icon: typeof Users; demo?: boolean };

const menu: Product[] = [
  { id: 1, name: "Pinta IPA artigianale", price: 6.5, category: "Birre alla spina", allergens: "Glutine" },
  { id: 2, name: "Media lager 0,4 l", price: 4.5, category: "Birre alla spina", allergens: "Glutine" },
  { id: 3, name: "Panino pulled pork", price: 12, category: "Panini", allergens: "Glutine, latte, senape" },
  { id: 4, name: "Burger della casa", price: 14.5, category: "Panini", allergens: "Glutine, latte, uova" },
  { id: 5, name: "Patatine rustiche", price: 5, category: "Cucina", allergens: "Può contenere tracce" },
  { id: 6, name: "Tagliere misto", price: 16, category: "Cucina", allergens: "Latte" },
  { id: 7, name: "Calice Barbera", price: 6, category: "Vini e cocktail" },
  { id: 8, name: "Tiramisù della casa", price: 6.5, category: "Cucina", allergens: "Glutine, latte, uova" },
  { id: 9, name: "Acqua naturale 0,75 l", price: 3, category: "Bibite" },
  { id: 10, name: "Spritz della casa", price: 8, category: "Vini e cocktail", allergens: "Solfiti" },
];
const categories = ["Preferiti", "Birre alla spina", "Panini", "Cucina", "Vini e cocktail", "Bibite"];
const euro = (n: number) => `€ ${n.toFixed(2).replace(".", ",")}`;
const clockNow = () => new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" }).format(new Date());
const seed = (id: number, product: Product, qty: number, status: Item["status"], insertedAt: string, modifier?: string): Item =>
  ({ id, product, qty, status, insertedAt, phase: 1, modifier });
const initialTables: Table[] = [
  { id: 1, name: "Tavolo 1", seats: 2, covers: 2, elapsed: 8, status: "occupato", items: [seed(1, menu[0], 2, "inviato", "20:18"), seed(2, menu[1], 1, "inviato", "20:21")] },
  { id: 2, name: "Tavolo 2", seats: 4, covers: 4, elapsed: 24, status: "occupato", items: [seed(3, menu[0], 2, "inviato", "20:14"), seed(4, menu[2], 1, "inviato", "20:19", "Senza cipolla"), seed(5, menu[4], 1, "bozza", "20:39"), seed(6, menu[6], 1, "bozza", "20:41")] },
  { id: 3, name: "Tavolo 3", seats: 4, covers: 3, elapsed: 41, status: "occupato", items: [seed(7, menu[3], 2, "inviato", "20:06"), seed(8, menu[8], 1, "inviato", "20:10")] },
  { id: 4, name: "Tavolo 4", seats: 2, covers: 0, elapsed: 0, status: "libero", items: [] },
  { id: 5, name: "Tavolo 5", seats: 6, covers: 0, elapsed: 0, status: "prenotato", items: [] },
  { id: 6, name: "Dehor 1", seats: 4, covers: 0, elapsed: 0, status: "libero", items: [] },
];

const operations: Operation[] = [
  { group: "Sala e tavoli", title: "Apri / assegna tavolo", description: "Apri un nuovo conto, associa coperti o assegna un ordine rapido a un tavolo libero.", icon: Users },
  { group: "Sala e tavoli", title: "Sposta tavolo", description: "Sposta l'intero ordine su un tavolo libero. La produzione chiede conferma e aggiorna il conto.", icon: ArrowRight },
  { group: "Sala e tavoli", title: "Unisci tavoli", description: "Unifica un conto con un tavolo già in servizio.", icon: Users },
  { group: "Sala e tavoli", title: "Sposta singoli articoli", description: "Seleziona righe e conto aperto di destinazione.", icon: SlidersHorizontal },
  { group: "Sala e tavoli", title: "Coperti", description: "Apri, modifica o rimuovi i coperti dal conto.", icon: Users },
  { group: "Menu e righe", title: "Gruppi, prodotti e ricerca", description: "Sfoglia i gruppi di menu, cerca prodotti e gestisci i preferiti. Un tocco aggiunge una riga.", icon: Search },
  { group: "Menu e righe", title: "Varianti e modificatori", description: "Personalizza una riga con varianti, aggiunte o rimozioni; la produzione applica i modificatori configurati.", icon: SlidersHorizontal },
  { group: "Menu e righe", title: "F1 · F2 · F3 · F4", description: "Cambia fase di servizio / listino: Servito, Asporto, Fidelity e Staff.", icon: Utensils },
  { group: "Menu e righe", title: "Numpad quantità / prezzo", description: "Digita un valore e applicalo alla riga selezionata come quantità o prezzo.", icon: Calculator },
  { group: "Menu e righe", title: "Note di riga e comanda", description: "Aggiungi note al prodotto o un commento da inviare al reparto.", icon: StickyNote },
  { group: "Menu e righe", title: "Esaurito e allergeni", description: "Segnala indisponibilità e consulta le informazioni allergeni del prodotto.", icon: Ban },
  { group: "Conto e permessi", title: "Sconto e autorizzazioni", description: "Applica sconti con motivazione. La produzione applica le autorizzazioni configurate per l'operatore.", icon: Tag },
  { group: "Conto e permessi", title: "Annullamento e audit", description: "Annulla un conto o una riga con conferma e motivazione registrata nell'audit.", icon: RotateCcw },
  { group: "Conto e permessi", title: "Invia comanda", description: "Invia le righe in bozza ai reparti; le fasi sono mantenute nella comanda.", icon: Send },
  { group: "Conto e permessi", title: "Conto sospeso", description: "Sospendi un pagamento e riprendi il conto in seguito.", icon: Clock3 },
  { group: "Servizio", title: "Rapida · Asporto · Delivery", description: "Crea un ordine non legato alla sala e, in seguito, assegnalo a un tavolo se necessario.", icon: Truck },
  { group: "Servizio", title: "Lotteria degli scontrini", description: "Acquisisci il codice cliente per includerlo nella prossima operazione fiscale.", icon: Ticket },
  { group: "Servizio", title: "Cassetto cassa", description: "Apri il cassetto dalla procedura autorizzata collegata al registratore.", icon: CircleDollarSign },
  { group: "Conti e pagamenti", title: "Conto separato", description: "Seleziona quantità per riga e ripartisci il pagamento; coperti selezionabili separatamente.", icon: Split },
  { group: "Conti e pagamenti", title: "Alla romana", description: "Calcola quote, registra pagamenti parziali e chiude con la quota finale.", icon: Users },
  { group: "Conti e pagamenti", title: "Esplodi quantità", description: "Trasforma una quantità multipla in righe singole selezionabili per il conto separato.", icon: SlidersHorizontal },
  { group: "Conti e pagamenti", title: "Preconto e ristampa", description: "Mostra il riepilogo e gestisce la stampa di cortesia / preconto secondo la configurazione del registratore.", icon: ReceiptText },
  { group: "Conti e pagamenti", title: "Pagamento e mancia", description: "Pagamento intero, resto contanti, mancia e terminali POS abilitati. In produzione l'esito dipende da POS e RT.", icon: CreditCard },
  { group: "Clienti e fatture", title: "Clienti e intestazione fattura", description: "Cerca o crea un cliente, verifica i dati fiscali e collega il cliente alla fattura.", icon: UserRound },
  { group: "Clienti e fatture", title: "Fattura, XML e copia", description: "In produzione emette la fattura e rende disponibile il recupero XML e la copia. Questa anteprima non emette o recupera documenti.", icon: FileText },
];

export function Smart() {
  const [tables, setTables] = useState(initialTables);
  const [selectedId, setSelectedId] = useState(2);
  const [category, setCategory] = useState("Preferiti");
  const [search, setSearch] = useState("");
  const [favorites, setFavorites] = useState<number[]>([1, 3, 4, 5, 7]);
  const [notice, setNotice] = useState("");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [payMode, setPayMode] = useState<PayMode>("intero");
  const [payMethod, setPayMethod] = useState("Carta/POS");
  const [terminal, setTerminal] = useState("Nexi PAX D230");
  const [splitCovers, setSplitCovers] = useState(2);
  const [includeCoversInSplit, setIncludeCoversInSplit] = useState(false);
  const [selectedForSplit, setSelectedForSplit] = useState<number[]>([]);
  const [invoice, setInvoice] = useState(false);
  const [clientType, setClientType] = useState("Persona");
  const [clientName, setClientName] = useState("");
  const [clientCode, setClientCode] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [tip, setTip] = useState(0);
  const [cashGiven, setCashGiven] = useState("");
  const [mobileView, setMobileView] = useState<"menu" | "conto">("conto");
  const [tablesOpen, setTablesOpen] = useState(false);
  const [paymentResult, setPaymentResult] = useState("");
  const [modifierItem, setModifierItem] = useState<number | null>(null);
  const [tableMenuOpen, setTableMenuOpen] = useState(false);
  const [tableMode, setTableMode] = useState<"list" | "map">("list");
  const [operationsOpen, setOperationsOpen] = useState(false);
  const [operationSearch, setOperationSearch] = useState("");
  const [selectedOperation, setSelectedOperation] = useState<Operation | null>(null);
  const [phase, setPhase] = useState(1);
  const [phaseOpen, setPhaseOpen] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [keyValue, setKeyValue] = useState("");
  const [keyMode, setKeyMode] = useState<"qty" | "price">("qty");
  const [discount, setDiscount] = useState(0);
  const [discountReason, setDiscountReason] = useState("");
  const [quickMode, setQuickMode] = useState("");
  const [available, setAvailable] = useState<Record<number, boolean>>({});
  const [lotteryCode, setLotteryCode] = useState("");
  const [rowNote, setRowNote] = useState("");
  const [auditReason, setAuditReason] = useState("");

  const activeTable = tables.find(t => t.id === selectedId) ?? tables[0];
  const itemTotal = useMemo(() => activeTable.items.reduce((sum, item) => sum + item.qty * item.product.price, 0), [activeTable]);
  const total = Math.max(0, itemTotal + activeTable.covers * 1.5 - discount);
  const sentCount = activeTable.items.filter(item => item.status === "inviato").length;
  const draftCount = activeTable.items.filter(item => item.status === "bozza").length;
  const visibleProducts = menu.filter(p => (available[p.id] !== false) && (search.trim()
    ? p.name.toLocaleLowerCase("it").includes(search.toLocaleLowerCase("it"))
    : category === "Preferiti" ? favorites.includes(p.id) : p.category === category));
  const currentSelectedItem = activeTable.items.find(item => item.id === selectedItemId) ?? activeTable.items[0];
  const selectedAmount = activeTable.items.filter(i => selectedForSplit.includes(i.id)).reduce((s, i) => s + i.qty * i.product.price, 0);
  const splitAmount = payMode === "intero" ? total : payMode === "separato" ? selectedAmount + (includeCoversInSplit ? activeTable.covers * 1.5 : 0) : Math.round(total * 100 / Math.max(1, splitCovers)) / 100;
  const paymentAmount = payMode === "romana" && splitCovers === 1 ? total : splitAmount;
  const filteredOperations = operations.filter(op => `${op.group} ${op.title} ${op.description}`.toLocaleLowerCase("it").includes(operationSearch.toLocaleLowerCase("it")));
  const operationGroups = [...new Set(filteredOperations.map(op => op.group))];

  function updateTable(mutator: (table: Table) => Table) {
    setTables(current => current.map(t => t.id === selectedId ? mutator(t) : t));
  }
  function inform(text: string) { setNotice(text); window.setTimeout(() => setNotice(""), 3200); }
  function addProduct(product: Product) {
    const insertedAt = clockNow();
    let newId = Date.now();
    updateTable(table => {
      const draft = table.items.find(i => i.product.id === product.id && i.status === "bozza" && !i.modifier);
      if (draft) return { ...table, status: "occupato", covers: table.covers || 2, items: table.items.map(i => i.id === draft.id ? { ...i, qty: i.qty + 1 } : i) };
      return { ...table, status: "occupato", covers: table.covers || 2, items: [...table.items, { id: newId++, product, qty: 1, status: "bozza", insertedAt, phase }] };
    });
    inform(`${product.name} aggiunto · ${insertedAt}`);
    setSelectedItemId(newId - 1);
  }
  function changeQty(id: number, delta: number) {
    updateTable(table => ({ ...table, items: table.items.flatMap(item => item.id === id ? (item.qty + delta <= 0 ? [] : [{ ...item, qty: item.qty + delta }]) : [item]) }));
  }
  function sendDrafts() {
    if (!draftCount) return;
    updateTable(table => ({ ...table, items: table.items.map(item => item.status === "bozza" ? { ...item, status: "inviato" } : item) }));
    inform("Comanda in demo · nessuna stampa o invio reale");
  }
  function selectTable(id: number) { setSelectedId(id); setPaymentOpen(false); setPaymentResult(""); setMobileView("conto"); setTablesOpen(false); }
  function chooseMode(mode: PayMode) {
    setPayMode(mode); setSelectedForSplit([]); setIncludeCoversInSplit(false);
    if (mode === "romana") setSplitCovers(Math.max(1, activeTable.covers || 2));
  }
  function confirmPayment() {
    const received = Number(cashGiven.replace(",", "."));
    if (payMethod === "Contanti" && received < paymentAmount + tip) {
      setPaymentResult("Importo ricevuto inferiore al totale simulato. Nessuna operazione eseguita.");
      return;
    }
    if (invoice && (!clientName.trim() || !clientCode.trim())) {
      setPaymentResult("Per la simulazione inserisci intestatario e codice fiscale / partita IVA.");
      return;
    }
    const paymentLabel = payMethod === "Carta/POS" ? `${payMethod} · ${terminal}` : payMethod;
    setPaymentResult(invoice
      ? `Simulazione completata: intestazione ${clientName}. Nessun pagamento, fattura, XML, stampa o invio fiscale effettuato.`
      : `Simulazione pagamento: ${euro(paymentAmount)} con ${paymentLabel}. Nessun addebito effettuato.`);
  }
  function applyKeypad() {
    if (!currentSelectedItem || !keyValue) return;
    const n = Number(keyValue.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return;
    if (keyMode === "qty") updateTable(t => ({ ...t, items: t.items.map(i => i.id === currentSelectedItem.id ? { ...i, qty: Math.max(1, Math.round(n)) } : i) }));
    else updateTable(t => ({ ...t, items: t.items.map(i => i.id === currentSelectedItem.id ? { ...i, product: { ...i.product, price: n } } : i) }));
    setKeyValue("");
  }
  function operationAction(op: Operation) {
    setSelectedOperation(op);
    if (op.title === "Gruppi, prodotti e ricerca") { setOperationsOpen(false); setMobileView("menu"); }
  }
  function explodeQuantities() {
    updateTable(t => ({
      ...t,
      items: t.items.flatMap(it => it.qty > 1
        ? Array.from({ length: it.qty }, (_, idx) => ({ ...it, id: Date.now() + it.id + idx, qty: 1 }))
        : [it]),
    }));
  }

  return (
    <main className="smart-pos" data-testid="screen-pos-smart">
      <header className="smart-topbar">
        <div className="smart-brand"><div className="smart-brand-mark"><Beer size={21} strokeWidth={2.3} /></div><div><div className="smart-brand-name">Hello<span>Table</span></div><div className="smart-brand-sub">SALA · SERVIZIO SERALE</div></div></div>
        <div className="smart-service"><span className="service-pulse" /> Servizio attivo <span className="service-divider" /><Clock3 size={15} /> {clockNow()}</div>
        <div className="smart-demo"><Info size={15} /> Anteprima locale <span>Nessun incasso o documento reale</span></div>
        <button className="smart-help" type="button" aria-label="Aiuto e operazioni" onClick={() => setOperationsOpen(true)}><CircleHelp size={19} /></button>
      </header>

      <nav className="smart-mobile-nav" aria-label="Navigazione servizio">
        <button className={tablesOpen ? "active" : ""} aria-expanded={tablesOpen} aria-controls="smart-table-sidebar" onClick={() => setTablesOpen(open => !open)}>Sala / Tavoli</button>
        {(["menu", "conto"] as const).map(v => <button key={v} className={mobileView === v && !tablesOpen ? "active" : ""} onClick={() => { setMobileView(v); setTablesOpen(false); }}>{v === "menu" ? "Menu" : "Conto"}{v === "conto" && draftCount > 0 && <i>{draftCount}</i>}</button>)}
        <button className="nav-operations" onClick={() => { setSelectedOperation(null); setOperationsOpen(true); }}><MoreHorizontal size={17} /> Operazioni</button>
      </nav>

      <section className={`smart-workspace view-${mobileView} ${tablesOpen ? "tables-open" : ""}`}>
        {tablesOpen && <button className="tables-scrim" aria-label="Chiudi sala tavoli" onClick={() => setTablesOpen(false)} />}
        <aside className="smart-tables" id="smart-table-sidebar" aria-label="Sala e tavoli">
          <button className="table-drawer-close icon-button" aria-label="Chiudi pannello tavoli" onClick={() => setTablesOpen(false)}><X size={20} /></button>
          <div className="section-heading">
            <div><div className="eyebrow">SALA</div><h1>Tavoli <span>{tables.filter(t => t.status === "occupato").length} attivi</span></h1></div>
            <div className="table-tools">
              <button className={`view-toggle ${tableMode === "list" ? "active" : ""}`} aria-label="Vista elenco tavoli" title="Elenco" onClick={() => setTableMode("list")}><List size={16} /></button>
              <button className={`view-toggle ${tableMode === "map" ? "active" : ""}`} aria-label="Vista mappa tavoli" title="Mappa" onClick={() => setTableMode("map")}><Map size={16} /></button>
              <button className="icon-button" aria-label="Altre operazioni tavoli" onClick={() => setTableMenuOpen(v => !v)}><MoreHorizontal size={21} /></button>
            </div>
          </div>
          <div className="table-legend"><span><i className="dot dot-busy" /> In servizio</span><span><i className="dot dot-free" /> Libero</span><span><i className="dot dot-booked" /> Prenotato</span></div>
          <div className={`table-list ${tableMode === "map" ? "map-view" : ""}`}>
            {tables.map(table => {
              const amount = table.items.reduce((s, i) => s + i.qty * i.product.price, 0) + table.covers * 1.5;
              return <button key={table.id} data-testid={`table-${table.id}`} onClick={() => selectTable(table.id)} className={`table-card ${table.status} ${selectedId === table.id ? "selected" : ""}`}>
                <div className="table-card-top"><span className="table-number">{table.name}</span><span className={`table-state ${table.status}`}>{table.status === "occupato" ? "In servizio" : table.status === "libero" ? "Libero" : "Prenotato"}</span></div>
                <div className="table-card-meta"><span><Users size={14} />{table.covers || table.seats} {table.covers ? "coperti" : "posti"}</span>{table.status === "occupato" && <span><Clock3 size={13} /> {table.elapsed} min</span>}</div>
                <div className="table-card-bottom">{table.status === "occupato" ? <><b>{euro(amount)}</b><span>{table.items.length} articoli</span></> : <span>{table.status === "libero" ? "Apri conto" : `${table.seats} posti · ore 21:00`}</span>}</div>
              </button>;
            })}
          </div>
          {tableMenuOpen && <div className="quick-menu table-secondary"><b>Sala · operazioni</b><button onClick={() => { setSelectedOperation(operations[1]); setOperationsOpen(true); setTableMenuOpen(false); }}>Sposta o unisci conto</button><button onClick={() => { setSelectedOperation(operations[4]); setOperationsOpen(true); setTableMenuOpen(false); }}>Apri / assegna tavolo e coperti</button><button onClick={() => { setTableMode(v => v === "map" ? "list" : "map"); setTableMenuOpen(false); }}>Cambia vista sala</button></div>}
          <div className="table-footnote">Tocca un tavolo per aprire il conto.</div>
        </aside>

        <section className="smart-menu">
          <div className="menu-heading"><div><div className="eyebrow">PER {activeTable.name.toUpperCase()}</div><h2>Aggiungi al conto</h2></div><label className="menu-search"><Search size={17} /><input aria-label="Cerca un prodotto" placeholder="Cerca prodotto" value={search} onChange={e => setSearch(e.target.value)} /><kbd>/</kbd></label></div>
          <div className="category-strip" role="tablist" aria-label="Categorie del menu">{categories.map((item, index) => <button key={item} role="tab" aria-selected={category === item} onClick={() => { setCategory(item); setSearch(""); }} className={category === item ? "active" : ""}>{index === 0 && <Heart size={15} fill={category === item ? "currentColor" : "none"} />}{item}</button>)}</div>
          <div className="menu-context">
            <button className="phase-current" aria-expanded={phaseOpen} onClick={() => setPhaseOpen(value => !value)}>Prezzo: {["Servito", "Asporto", "Fidelity", "Staff"][phase - 1]} <ChevronDown size={16} /></button>
            {phaseOpen && <div className="phase-strip" aria-label="Prezzo e servizio">{[1, 2, 3, 4].map(n => <button key={n} className={phase === n ? "active" : ""} onClick={() => { setPhase(n); setPhaseOpen(false); }}><span>{["Servito", "Asporto", "Fidelity", "Staff"][n - 1]}</span></button>)}</div>}
          </div>
          <div className="product-grid">
            {visibleProducts.map(product => <div key={product.id} data-testid={`product-${product.id}`} className="product-tile">
              <button type="button" className="product-action" onClick={() => addProduct(product)}><span className="product-add"><Plus size={19} /></span><span className="product-category">{product.category}</span><strong>{product.name}</strong><span className="product-price">{euro(product.price)}</span></button>
              <button type="button" className={`favorite-toggle ${favorites.includes(product.id) ? "is-favorite" : ""}`} aria-label={favorites.includes(product.id) ? `Rimuovi ${product.name} dai preferiti` : `Aggiungi ${product.name} ai preferiti`} onClick={e => { e.stopPropagation(); setFavorites(old => old.includes(product.id) ? old.filter(id => id !== product.id) : [...old, product.id]); }}>{favorites.includes(product.id) ? <Heart size={16} fill="currentColor" /> : <Heart size={16} />}</button>
              {product.allergens && <span className="allergen-label" title={`Allergeni demo: ${product.allergens}`}>Allergeni · info</span>}
            </div>)}
            {visibleProducts.length === 0 && <div className="menu-empty"><Search size={23} /><b>Nessun prodotto trovato</b><span>Prova un altro nome o categoria.</span></div>}
          </div>
          <div className="menu-hint">Tocca un prodotto per aggiungerlo al conto.</div>
        </section>

        <aside className="smart-order">
          <div className="order-heading"><div className="order-table-title"><span className={`table-avatar ${activeTable.status}`}>{activeTable.name.replace("Tavolo ", "T")}</span><div><div className="eyebrow">CONTO</div><h2>{activeTable.name}</h2></div></div><button className="order-operations" onClick={() => { setSelectedOperation(null); setOperationsOpen(true); }}><MoreHorizontal size={18} /> Altro</button></div>
          <div className="order-subline"><span><Users size={15} /> {activeTable.covers || 0} coperti</span><span><Clock3 size={14} /> {activeTable.elapsed || 0} min</span><button onClick={() => updateTable(t => ({ ...t, covers: Math.min(t.seats, t.covers + 1), status: "occupato" }))}>+ Coperto</button></div>
          {quickMode && <div className="quick-mode-tag">{quickMode} · demo <button onClick={() => setQuickMode("")} aria-label="Chiudi modalità rapida"><X size={14} /></button></div>}
          <div className="order-columns"><span>Nel conto · {activeTable.items.length}</span><span>Importo</span></div>
          <div className="order-lines" data-testid="order-list">
            {activeTable.items.length ? activeTable.items.map(item => <div className={`order-line ${item.status} ${selectedItemId === item.id ? "row-selected" : ""}`} key={item.id} data-testid={`order-item-${item.id}`} onClick={() => setSelectedItemId(item.id)}>
              <div className={`order-status-mark ${item.status}`} title={item.status === "inviato" ? "Inviato in cucina" : "Bozza non inviata"}>{item.status === "inviato" ? <Check size={13} /> : <span />}</div>
              <div className="order-item-main"><div className="order-item-name">{item.product.name}</div><div className="order-item-meta">{item.status === "inviato" ? "Inviato in cucina" : "Bozza · non ancora inviata"} · F{item.phase}<span className="insert-time">Inserito {item.insertedAt}</span>{item.modifier && <span className="item-modifier"> · {item.modifier}</span>}{item.note && <span> · {item.note}</span>}</div>
                <div className="qty-control"><button aria-label={`Diminuisci ${item.product.name}`} onClick={e => { e.stopPropagation(); changeQty(item.id, -1); }}><Minus size={15} /></button><span>{item.qty}</span><button aria-label={`Aumenta ${item.product.name}`} onClick={e => { e.stopPropagation(); changeQty(item.id, 1); }}><Plus size={15} /></button>{selectedItemId === item.id && <button className="modifier-button" onClick={e => { e.stopPropagation(); setModifierItem(modifierItem === item.id ? null : item.id); }}>{modifierItem === item.id ? "Chiudi" : "Nota e modifiche"}</button>}</div>
                {modifierItem === item.id && <div className="modifier-options"><button onClick={e => { e.stopPropagation(); updateTable(t => ({ ...t, items: t.items.map(i => i.id === item.id ? { ...i, modifier: i.modifier ? undefined : "Senza cipolla" } : i) })); }}>{item.modifier ? "Rimuovi «senza cipolla»" : "Aggiungi «senza cipolla»"}</button><label className="note-entry"><input value={rowNote} onChange={e => setRowNote(e.target.value)} placeholder="Nota per questa riga" onClick={e => e.stopPropagation()} /><button onClick={e => { e.stopPropagation(); updateTable(t => ({ ...t, items: t.items.map(i => i.id === item.id ? { ...i, note: rowNote.trim() || undefined } : i) })); setRowNote(""); }}>Salva nota</button></label><span className="allergen-inline">Allergeni: {item.product.allergens ?? "nessuna indicazione demo"}</span></div>}
              </div><strong className="order-line-price">{euro(item.product.price * item.qty)}</strong>
            </div>) : <div className="order-empty"><Utensils size={25} /><b>Il conto è pronto</b><span>Scegli un prodotto dal menu per iniziare.</span></div>}
            {activeTable.covers > 0 && <div className="order-line cover-line"><div className="cover-mark"><Users size={13} /></div><div className="order-item-main"><div className="order-item-name">Coperto</div><div className="order-item-meta">{activeTable.covers} × € 1,50</div><div className="qty-control"><button aria-label="Diminuisci coperti" onClick={() => updateTable(t => ({ ...t, covers: Math.max(0, t.covers - 1) }))}><Minus size={15} /></button><span>{activeTable.covers}</span><button aria-label="Aumenta coperti" onClick={() => updateTable(t => ({ ...t, covers: Math.min(t.seats, t.covers + 1) }))}><Plus size={15} /></button></div></div><strong className="order-line-price">{euro(activeTable.covers * 1.5)}</strong></div>}
          </div>
          <div className="order-footer">
            <div className="order-status-key"><span>{sentCount} inviati · {draftCount} da inviare</span></div>
            <button className="send-order" disabled={!draftCount} onClick={sendDrafts}><Send size={18} /><span>{draftCount ? "Invia in cucina" : "Comanda inviata"}</span><b>{draftCount ? `${draftCount} ${draftCount === 1 ? "voce" : "voci"}` : "Tutto pronto"}</b></button>
            <div className="total-line"><span>Totale conto {discount > 0 && <small>· sconto demo {euro(discount)}</small>}</span><strong>{euro(total)}</strong></div>
            <button className="pay-cta" disabled={!activeTable.items.length} onClick={() => { setPaymentOpen(true); setPaymentResult(""); setPayMode("intero"); }}><span><CreditCard size={20} /> Incassa</span><b>{euro(total)} <ArrowRight size={19} /></b></button>
            <div className="safe-note">Anteprima locale · nessun addebito, stampa o invio fiscale</div>
          </div>
        </aside>
      </section>

      {notice && <div className="smart-toast" role="status"><Info size={17} />{notice}<button aria-label="Chiudi avviso" onClick={() => setNotice("")}><X size={15} /></button></div>}

      {operationsOpen && <div className="operations-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) { setOperationsOpen(false); setSelectedOperation(null); } }}>
        <section className="operations-sheet" role="dialog" aria-modal="true" aria-labelledby="operations-title">
          <div className="operations-header"><div><div className="eyebrow">HELLOTABLE · FUNZIONI FRONT OFFICE</div><h2 id="operations-title">Operazioni</h2><p>Indice della produzione, raccolto in un solo punto. L'anteprima è locale e non collegata ai servizi.</p></div><button className="icon-button" aria-label="Chiudi operazioni" onClick={() => { setOperationsOpen(false); setSelectedOperation(null); }}><X size={21} /></button></div>
          <div className="operations-demo"><Info size={16} /><span>Le azioni non simulate sono descritte, non confermate: nessuna modifica a database, cassa, RT, POS o stampante.</span></div>
          <label className="operations-search"><Search size={17} /><input value={operationSearch} onChange={e => setOperationSearch(e.target.value)} placeholder="Cerca un'operazione" autoFocus /></label>
          <div className="operations-body">
            <div className="operation-index">{operationGroups.map(group => <div className="operation-group" key={group}><h3>{group}</h3>{filteredOperations.filter(op => op.group === group).map(op => <button key={op.title} onClick={() => operationAction(op)} className={selectedOperation?.title === op.title ? "selected" : ""}><op.icon size={17} /><span>{op.title}</span><ArrowRight size={14} /></button>)}</div>)}
              {filteredOperations.length === 0 && <div className="operation-empty">Nessuna funzione corrispondente. Prova un altro termine.</div>}
            </div>
            <div className="operation-detail">
              {selectedOperation ? <><span className="detail-kicker">{selectedOperation.group}</span><h3>{selectedOperation.title}</h3><p>{selectedOperation.description}</p><div className="detail-boundary"><Info size={16} /><span>Funzione prevista nella produzione; qui non viene invocata né simulata come completata.</span></div>
                {selectedOperation.title === "Sconto e autorizzazioni" && <div className="demo-control"><label>Importo sconto demo (€)<input inputMode="decimal" value={discount || ""} onChange={e => setDiscount(Number(e.target.value) || 0)} placeholder="0,00" /></label><label>Motivazione<input value={discountReason} onChange={e => setDiscountReason(e.target.value)} placeholder="Motivazione" /></label><span>Totale anteprima aggiornato · permessi non verificati in questa demo.</span></div>}
                {selectedOperation.title === "Esaurito e allergeni" && <div className="demo-control"><label>Prodotto<select id="availability-product">{menu.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label><button className="operation-local-button" onClick={() => { const select = document.getElementById("availability-product") as HTMLSelectElement | null; if (select) setAvailable(a => ({ ...a, [Number(select.value)]: a[Number(select.value)] === false })); }}>Attiva / disattiva indisponibilità locale</button><span>Solo anteprima: nessuna modifica al menu di produzione.</span></div>}
                {selectedOperation.title === "Annullamento e audit" && <div className="demo-control"><label>Motivazione (richiesta in produzione)<input value={auditReason} onChange={e => setAuditReason(e.target.value)} placeholder="Es. errore inserimento" /></label><span>L'annullamento e la registrazione audit richiedono i permessi e il flusso produzione.</span></div>}
                {selectedOperation.title === "Rapida · Asporto · Delivery" && <div className="demo-control quick-demo-buttons">{["Rapida", "Asporto", "Delivery"].map(mode => <button key={mode} className="operation-local-button" onClick={() => { setQuickMode(mode); setOperationsOpen(false); }}>{mode} · contesto demo</button>)}</div>}
                {selectedOperation.title === "Lotteria degli scontrini" && <div className="demo-control"><label>Codice demo<input value={lotteryCode} onChange={e => setLotteryCode(e.target.value.toUpperCase())} placeholder="Codice cliente" /></label><span>Codice conservato solo in questa schermata; non viene trasmesso.</span></div>}
                {selectedOperation.title === "Numpad quantità / prezzo" && <div className="demo-control"><span>Modifica la voce selezionata: {currentSelectedItem?.product.name ?? "nessuna voce selezionata"}.</span><div className="keypad-title"><b>Valore da applicare</b><span>{keyMode === "qty" ? "quantità" : "prezzo"}</span></div><div className="key-mode"><button className={keyMode === "qty" ? "active" : ""} onClick={() => setKeyMode("qty")}>Quantità</button><button className={keyMode === "price" ? "active" : ""} onClick={() => setKeyMode("price")}>Prezzo</button></div><label>Numero<input aria-label="Valore tastierino" inputMode="decimal" value={keyValue} onChange={e => setKeyValue(e.target.value)} placeholder={keyMode === "qty" ? "Es. 2" : "Es. 8,50"} /></label><button className="operation-local-button" onClick={applyKeypad} disabled={!currentSelectedItem || !keyValue}>Applica alla voce</button></div>}
                {selectedOperation.title === "F1 · F2 · F3 · F4" && <div className="demo-control"><label>Prezzo da usare per i prossimi prodotti<select value={phase} onChange={e => setPhase(Number(e.target.value))}>{["Servito", "Asporto", "Fidelity", "Staff"].map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select></label><span>Prezzo attivo: {["Servito", "Asporto", "Fidelity", "Staff"][phase - 1]}. Le voci già inserite non cambiano.</span></div>}
                {selectedOperation.title === "Esplodi quantità" && <div className="demo-control"><button className="operation-local-button" onClick={explodeQuantities}>Esplodi quantità nel conto demo</button><span>Modifica solo le righe locali della schermata; la produzione applica le proprie verifiche.</span></div>}
                {selectedOperation.title === "Conto sospeso" && <div className="demo-control"><span>Produzione salva un conto sospeso recuperabile; qui non si crea uno stato persistente.</span></div>}
                {selectedOperation.title === "Preconto e ristampa" && <div className="demo-control"><span>Le procedure di stampa RT e ristampa di cortesia restano nel front office collegato. Nessuna stampante è collegata a questa anteprima.</span></div>}
                {selectedOperation.title === "Cassetto cassa" && <div className="demo-control"><span>L'apertura del cassetto richiede registratore collegato e autorizzazioni: non viene inviata alcuna richiesta da qui.</span></div>}
              </> : <div className="operation-detail-empty"><div className="detail-mark"><SlidersHorizontal size={21} /></div><b>Una mappa rapida, senza perdere il tavolo</b><span>Seleziona una funzione per vedere come si comporta in produzione e cosa è disponibile in questa anteprima.</span><div className="detail-live"><span className="service-pulse" /> Conto attivo · {activeTable.name}</div></div>}
            </div>
          </div>
          <div className="operations-footer"><span><ShieldCheck size={15} /> Nessun backend collegato</span><button onClick={() => { setOperationsOpen(false); setSelectedOperation(null); }}>Torna al servizio <ArrowRight size={15} /></button></div>
        </section>
      </div>}

      {paymentOpen && <div className="payment-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setPaymentOpen(false); }}>
        <section className="payment-sheet" role="dialog" aria-modal="true" aria-labelledby="payment-title">
          <div className="payment-header"><div><div className="eyebrow">CHIUSURA CONTO · {activeTable.name.toUpperCase()}</div><h2 id="payment-title">Come paga il tavolo?</h2></div><button className="icon-button" aria-label="Chiudi pagamento" onClick={() => setPaymentOpen(false)}><X size={21} /></button></div>
          <div className="payment-demo-alert"><Info size={17} /><span><b>Solo simulazione.</b> Nessun pagamento reale, documento fiscale, stampa o XML generato.</span></div>
          <div className="payment-modes">{([{ id: "intero", title: "Conto intero", detail: "Un pagamento", icon: Wallet }, { id: "separato", title: "Conto separato", detail: "Scegli righe", icon: Split }, { id: "romana", title: "Alla romana", detail: "Quote uguali", icon: Users }] as const).map(mode => <button key={mode.id} onClick={() => chooseMode(mode.id)} className={payMode === mode.id ? "selected" : ""}><mode.icon size={21} /><span><b>{mode.title}</b><small>{mode.detail}</small></span><i>{payMode === mode.id && <Check size={14} />}</i></button>)}</div>
          {payMode === "separato" && <div className="split-picker"><div className="split-title"><b>Seleziona cosa paga questo cliente</b><span>Il resto resta sul conto · demo</span></div>{activeTable.items.map(item => <button key={item.id} className={`split-row ${selectedForSplit.includes(item.id) ? "selected" : ""}`} onClick={() => setSelectedForSplit(old => old.includes(item.id) ? old.filter(id => id !== item.id) : [...old, item.id])}><span className="split-check">{selectedForSplit.includes(item.id) && <Check size={15} />}</span><span>{item.qty} × {item.product.name}</span><b>{euro(item.qty * item.product.price)}</b></button>)}{activeTable.covers > 0 && <button className={`split-row ${includeCoversInSplit ? "selected" : ""}`} onClick={() => setIncludeCoversInSplit(v => !v)}><span className="split-check">{includeCoversInSplit && <Check size={15} />}</span><span>{activeTable.covers} coperti × € 1,50</span><b>{euro(activeTable.covers * 1.5)}</b></button>}</div>}
          {payMode === "romana" && <div className="romana-control"><div><b>Quote da pagare</b><span>Totale conto {euro(total)}</span></div><div className="quote-stepper"><button aria-label="Meno quote" onClick={() => setSplitCovers(v => Math.max(1, v - 1))}><Minus size={17} /></button><strong>{splitCovers}</strong><span>{splitCovers === 1 ? "quota" : "quote"}</span><button aria-label="Più quote" onClick={() => setSplitCovers(v => Math.min(12, v + 1))}><Plus size={17} /></button></div></div>}
          <div className="payment-methods"><span>METODO · OPZIONI FRONT OFFICE</span><div><button className={payMethod === "Contanti" ? "chosen" : ""} onClick={() => setPayMethod("Contanti")}><Banknote size={18} /> Contanti</button><button className={payMethod === "Carta/POS" ? "chosen" : ""} onClick={() => setPayMethod("Carta/POS")}><CreditCard size={18} /> Carta/POS</button><button className={payMethod === "Buoni Pasto" ? "chosen" : ""} onClick={() => setPayMethod("Buoni Pasto")}><Ticket size={18} /> Buoni Pasto · demo</button><button className={payMethod === "Altro" ? "chosen" : ""} onClick={() => setPayMethod("Altro")}><Wallet size={18} /> Altro</button></div></div>
          {payMethod === "Carta/POS" && <div className="terminal-select"><span>Terminale POS · configurazione demo</span><div>{["Nexi PAX D230", "myPOS Go"].map(t => <button key={t} className={terminal === t ? "chosen" : ""} onClick={() => setTerminal(t)}><CreditCard size={15} />{t}</button>)}</div><small>La produzione mostra i terminali abilitati e attende l'esito del dispositivo.</small></div>}
          <div className="payment-extra"><label>Mancia demo (€)<input inputMode="decimal" value={tip || ""} onChange={e => setTip(Number(e.target.value) || 0)} placeholder="0,00" /></label>{payMethod === "Contanti" && <label>Importo ricevuto<input inputMode="decimal" value={cashGiven} onChange={e => setCashGiven(e.target.value)} placeholder={euro(total + tip)} /></label>}</div>
          {payMethod === "Contanti" && Number(cashGiven.replace(",", ".")) > 0 && <div className="change-note">Resto in simulazione: {euro(Math.max(0, Number(cashGiven.replace(",", ".")) - paymentAmount - tip))}</div>}
          <div className="invoice-block"><button className={`invoice-toggle ${invoice ? "on" : ""}`} onClick={() => { setInvoice(v => !v); setPaymentResult(""); }}><span className="invoice-icon"><FileText size={19} /></span><span><b>Richiedi fattura</b><small>Cliente e dati fiscali · anteprima</small></span><span className="switch-track"><i /></span></button>
            {invoice && <div className="invoice-fields"><label>Tipo cliente<select value={clientType} onChange={e => setClientType(e.target.value)}><option>Persona</option><option>Azienda</option></select></label><label className="client-search-field">Cerca cliente esistente<input value={clientSearch} onChange={e => setClientSearch(e.target.value)} placeholder="Nome, codice fiscale o P. IVA" /></label><label>Intestatario<input value={clientName} onChange={e => setClientName(e.target.value)} placeholder={clientType === "Persona" ? "Nome e cognome" : "Ragione sociale"} /></label><label>Codice fiscale / partita IVA<input value={clientCode} onChange={e => setClientCode(e.target.value)} placeholder={clientType === "Persona" ? "Codice fiscale" : "Partita IVA"} /></label><p>Produzione: verifica dati, emissione, recupero XML e copia. In questa demo non vengono emessi documenti.</p><div className="xml-demo-actions"><button onClick={() => setPaymentResult("Recupero XML disponibile nella produzione dopo emissione; qui non esiste alcun documento da recuperare.")}>Recupera XML</button><button onClick={() => setPaymentResult("Copia XML disponibile in produzione; in questa demo nessun XML è stato creato o copiato.")}>Copia XML</button></div></div>}
          </div>
          {paymentResult && <div className="payment-result info-result" role="status"><Info size={17} />{paymentResult}</div>}
          <div className="payment-total"><span>{payMode === "intero" ? "Da pagare" : payMode === "separato" ? "Quota selezionata" : `${splitCovers} quote · questa quota`}</span><strong>{euro(paymentAmount + tip)}</strong></div>
          <button className="confirm-payment" disabled={payMode === "separato" && selectedForSplit.length === 0 && !includeCoversInSplit} onClick={confirmPayment}><Check size={18} /> Simula {invoice ? "fattura e pagamento" : "pagamento"} <b>{euro(paymentAmount + tip)}</b></button>
          <button className="payment-back" onClick={() => setPaymentOpen(false)}><ArrowLeft size={16} /> Torna al conto</button>
        </section>
      </div>}
      <footer className="smart-bottom"><span>HELLOTABLE · TERMINALE SALA</span><span>Conto di prova · stato solo locale</span><button onClick={() => setOperationsOpen(true)}>Operazioni <ChevronDown size={13} /></button></footer>
    </main>
  );
}

export default Smart;
