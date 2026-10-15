import { useMemo, useState } from "react";
import {
  ArrowLeft, ArrowRight, Banknote, Beer, Check, ChevronDown, CircleHelp,
  Clock3, CreditCard, FileText, Heart, Info, MoreHorizontal, Minus, Plus,
  Printer, Search, Send, Split, Users, Utensils, Wallet, X,
} from "lucide-react";
import "./_group.css";
import "./Smart.css";

type Product = { id: number; name: string; price: number; category: string; icon?: string };
type Item = { id: number; product: Product; qty: number; status: "inviato" | "bozza"; modifier?: string };
type Table = { id: number; name: string; seats: number; covers: number; elapsed: number; status: "occupato" | "libero" | "prenotato"; items: Item[] };

const menu: Product[] = [
  { id: 1, name: "Pinta IPA artigianale", price: 6.5, category: "Birre alla spina" },
  { id: 2, name: "Media lager 0,4 l", price: 4.5, category: "Birre alla spina" },
  { id: 3, name: "Panino pulled pork", price: 12, category: "Panini" },
  { id: 4, name: "Burger della casa", price: 14.5, category: "Panini" },
  { id: 5, name: "Patatine rustiche", price: 5, category: "Cucina" },
  { id: 6, name: "Tagliere misto", price: 16, category: "Cucina" },
  { id: 7, name: "Calice Barbera", price: 6, category: "Vini e cocktail" },
  { id: 8, name: "Tiramisù della casa", price: 6.5, category: "Cucina" },
  { id: 9, name: "Acqua naturale 0,75 l", price: 3, category: "Bibite" },
  { id: 10, name: "Spritz della casa", price: 8, category: "Vini e cocktail" },
];
const categories = ["Preferiti", "Birre alla spina", "Panini", "Cucina", "Vini e cocktail", "Bibite"];
const euro = (n: number) => `€ ${n.toFixed(2).replace(".", ",")}`;
const initialTables: Table[] = [
  { id: 1, name: "Tavolo 1", seats: 2, covers: 2, elapsed: 8, status: "occupato", items: [{ id: 1, product: menu[0], qty: 2, status: "inviato" }, { id: 2, product: menu[1], qty: 1, status: "inviato" }] },
  { id: 2, name: "Tavolo 2", seats: 4, covers: 4, elapsed: 24, status: "occupato", items: [{ id: 3, product: menu[0], qty: 2, status: "inviato" }, { id: 4, product: menu[2], qty: 1, status: "inviato", modifier: "Senza cipolla" }, { id: 5, product: menu[4], qty: 1, status: "bozza" }, { id: 6, product: menu[6], qty: 1, status: "bozza" }] },
  { id: 3, name: "Tavolo 3", seats: 4, covers: 3, elapsed: 41, status: "occupato", items: [{ id: 7, product: menu[3], qty: 2, status: "inviato" }, { id: 8, product: menu[8], qty: 1, status: "inviato" }] },
  { id: 4, name: "Tavolo 4", seats: 2, covers: 0, elapsed: 0, status: "libero", items: [] },
  { id: 5, name: "Tavolo 5", seats: 6, covers: 0, elapsed: 0, status: "prenotato", items: [] },
  { id: 6, name: "Dehor 1", seats: 4, covers: 0, elapsed: 0, status: "libero", items: [] },
];

type PayMode = "intero" | "separato" | "romana";

export function Smart() {
  const [tables, setTables] = useState(initialTables);
  const [selectedId, setSelectedId] = useState(2);
  const [category, setCategory] = useState("Preferiti");
  const [search, setSearch] = useState("");
  const [favorites, setFavorites] = useState<number[]>([1, 3, 4, 5, 7]);
  const [notice, setNotice] = useState("");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [payMode, setPayMode] = useState<PayMode>("intero");
  const [payMethod, setPayMethod] = useState("Carta");
  const [splitCovers, setSplitCovers] = useState(2);
  const [includeCoversInSplit, setIncludeCoversInSplit] = useState(false);
  const [selectedForSplit, setSelectedForSplit] = useState<number[]>([]);
  const [invoice, setInvoice] = useState(false);
  const [clientType, setClientType] = useState("Persona");
  const [clientName, setClientName] = useState("");
  const [clientCode, setClientCode] = useState("");
  const [secondaryOpen, setSecondaryOpen] = useState(false);
  const [mobileView, setMobileView] = useState<"tavoli" | "menu" | "conto">("conto");
  const [paymentResult, setPaymentResult] = useState("");
  const [modifierItem, setModifierItem] = useState<number | null>(null);
  const [tableMenuOpen, setTableMenuOpen] = useState(false);

  const activeTable = tables.find(t => t.id === selectedId)!;
  const itemTotal = useMemo(() => activeTable.items.reduce((sum, item) => sum + item.qty * item.product.price, 0), [activeTable]);
  const total = itemTotal + activeTable.covers * 1.5;
  const sentCount = activeTable.items.filter(item => item.status === "inviato").length;
  const draftCount = activeTable.items.filter(item => item.status === "bozza").length;
  const visibleProducts = menu.filter(p => (search.trim()
    ? p.name.toLocaleLowerCase("it").includes(search.toLocaleLowerCase("it"))
    : category === "Preferiti" ? favorites.includes(p.id) : p.category === category));

  function updateTable(mutator: (table: Table) => Table) {
    setTables(current => current.map(t => t.id === selectedId ? mutator(t) : t));
  }
  function addProduct(product: Product) {
    updateTable(table => {
      const draft = table.items.find(i => i.product.id === product.id && i.status === "bozza" && !i.modifier);
      if (draft) return { ...table, status: "occupato", covers: table.covers || 2, items: table.items.map(i => i.id === draft.id ? { ...i, qty: i.qty + 1 } : i) };
      return { ...table, status: "occupato", covers: table.covers || 2, items: [...table.items, { id: Date.now(), product, qty: 1, status: "bozza" }] };
    });
    setNotice(`${product.name} aggiunto alla bozza`);
    window.setTimeout(() => setNotice(""), 1800);
  }
  function changeQty(id: number, delta: number) {
    updateTable(table => ({ ...table, items: table.items.flatMap(item => item.id === id ? (item.qty + delta <= 0 ? [] : [{ ...item, qty: item.qty + delta }]) : [item]) }));
  }
  function sendDrafts() {
    if (!draftCount) return;
    updateTable(table => ({ ...table, items: table.items.map(item => item.status === "bozza" ? { ...item, status: "inviato" } : item) }));
    setNotice("Comanda inviata in demo — nessuna stampa reale");
    window.setTimeout(() => setNotice(""), 2600);
  }
  function selectTable(id: number) {
    setSelectedId(id);
    setPaymentOpen(false);
    setPaymentResult("");
    setMobileView("conto");
  }
  function chooseMode(mode: PayMode) {
    setPayMode(mode);
    setSelectedForSplit([]);
    setIncludeCoversInSplit(false);
    if (mode === "romana") setSplitCovers(Math.max(1, activeTable.covers || 2));
  }
  const selectedAmount = activeTable.items.filter(i => selectedForSplit.includes(i.id)).reduce((s, i) => s + i.qty * i.product.price, 0);
  const splitAmount = payMode === "intero" ? total : payMode === "separato" ? selectedAmount + (includeCoversInSplit ? activeTable.covers * 1.5 : 0) : Math.round(total * 100 / Math.max(1, splitCovers)) / 100;
  const paymentAmount = payMode === "romana" && splitCovers === 1 ? total : splitAmount;

  function confirmPayment() {
    if (invoice && (!clientName.trim() || !clientCode.trim())) {
      setPaymentResult("Completa intestatario e codice fiscale / partita IVA per la fattura demo.");
      return;
    }
    setPaymentResult(invoice
      ? `Demo salvata: fattura intestata a ${clientName}. Stampa simulata; nessun documento fiscale emesso.`
      : `Pagamento demo registrato: ${euro(paymentAmount)} con ${payMethod}. Nessun addebito effettuato.`);
  }

  return (
    <main className="smart-pos" data-testid="screen-pos-smart">
      <header className="smart-topbar">
        <div className="smart-brand">
          <div className="smart-brand-mark"><Beer size={21} strokeWidth={2.3} /></div>
          <div><div className="smart-brand-name">Hello<span>Table</span></div><div className="smart-brand-sub">SALA · SERVIZIO SERALE</div></div>
        </div>
        <div className="smart-service"><span className="service-pulse" /> Servizio attivo <span className="service-divider" /> <Clock3 size={15} /> 20:42</div>
        <div className="smart-demo"><Info size={15} /> DEMO · DATI DI ESEMPIO <span>Nessun pagamento o stampa reale</span></div>
        <button className="smart-help" type="button" aria-label="Aiuto" onClick={() => setNotice("Suggerimento: tocca un prodotto per aggiungerlo al conto.")}><CircleHelp size={19} /></button>
      </header>

      <nav className="smart-mobile-nav" aria-label="Passaggi del servizio">
        {(["tavoli", "menu", "conto"] as const).map(v => <button key={v} className={mobileView === v ? "active" : ""} onClick={() => setMobileView(v)}>{v === "tavoli" ? "Tavoli" : v === "menu" ? "Menu" : "Conto"}{v === "conto" && draftCount > 0 && <i>{draftCount}</i>}</button>)}
      </nav>

      <section className={`smart-workspace view-${mobileView}`}>
        <aside className="smart-tables">
          <div className="section-heading">
            <div><div className="eyebrow">SALA PRINCIPALE</div><h1>Tavoli <span>{tables.filter(t => t.status === "occupato").length} attivi</span></h1></div>
            <button className="icon-button" aria-label="Altre opzioni tavoli" onClick={() => setTableMenuOpen(v => !v)}><MoreHorizontal size={21} /></button>
          </div>
          <div className="table-legend"><span><i className="dot dot-busy" /> In servizio</span><span><i className="dot dot-free" /> Libero</span></div>
          <div className="table-list">
            {tables.map(table => {
              const amount = table.items.reduce((s, i) => s + i.qty * i.product.price, 0) + table.covers * 1.5;
              return <button key={table.id} data-testid={`table-${table.id}`} onClick={() => selectTable(table.id)} className={`table-card ${table.status} ${selectedId === table.id ? "selected" : ""}`}>
                <div className="table-card-top"><span className="table-number">{table.name}</span><span className={`table-state ${table.status}`}>{table.status === "occupato" ? "In servizio" : table.status === "libero" ? "Libero" : "Prenotato"}</span></div>
                <div className="table-card-meta"><span><Users size={14} />{table.covers || table.seats} {table.covers ? "coperti" : "posti"}</span>{table.status === "occupato" && <span><Clock3 size={13} /> {table.elapsed} min</span>}</div>
                <div className="table-card-bottom">{table.status === "occupato" ? <><b>{euro(amount)}</b><span>{table.items.length} righe</span></> : <span>{table.status === "libero" ? "Pronto per un nuovo conto" : `${table.seats} posti · ore 21:00`}</span>}</div>
              </button>;
            })}
          </div>
          {tableMenuOpen && <div className="quick-menu table-secondary"><b>Altre operazioni</b><button onClick={() => setNotice("Sposta tavolo: scegli un tavolo libero dalla sala.")}>Sposta conto su un altro tavolo</button><button onClick={() => setNotice("Unisci conto: seleziona un tavolo già in servizio.")}>Unisci con un altro tavolo</button><button onClick={() => setNotice("Assegna coperti: usa il menu Altre azioni nel conto.")}>Gestisci coperti</button></div>}
          <div className="table-footnote">Tocca un tavolo per aprire o riprendere il conto.</div>
        </aside>

        <section className="smart-menu">
          <div className="menu-heading">
            <div><div className="eyebrow">CONTO · {activeTable.name.toUpperCase()}</div><h2>Scegli dal menu</h2></div>
            <label className="menu-search"><Search size={17} /><input aria-label="Cerca un prodotto" placeholder="Cerca prodotto" value={search} onChange={e => setSearch(e.target.value)} /><kbd>/</kbd></label>
          </div>
          <div className="category-strip" role="tablist" aria-label="Categorie del menu">
            {categories.map((item, index) => <button key={item} role="tab" aria-selected={category === item} onClick={() => { setCategory(item); setSearch(""); }} className={category === item ? "active" : ""}>{index === 0 && <Heart size={15} fill={category === item ? "currentColor" : "none"} />}{item}</button>)}
          </div>
          <div className="product-grid">
            {visibleProducts.map(product => <div key={product.id} data-testid={`product-${product.id}`} className="product-tile">
              <button type="button" className="product-action" onClick={() => addProduct(product)}>
                <span className="product-add"><Plus size={19} /></span>
                <span className="product-category">{product.category}</span>
                <strong>{product.name}</strong>
                <span className="product-price">{euro(product.price)}</span>
              </button>
              <button type="button" className={`favorite-toggle ${favorites.includes(product.id) ? "is-favorite" : ""}`} aria-label={favorites.includes(product.id) ? `Rimuovi ${product.name} dai preferiti` : `Aggiungi ${product.name} ai preferiti`} onClick={e => { e.stopPropagation(); setFavorites(old => old.includes(product.id) ? old.filter(id => id !== product.id) : [...old, product.id]); }}>{favorites.includes(product.id) ? <Heart size={16} fill="currentColor" /> : <Heart size={16} />}</button>
            </div>)}
            {visibleProducts.length === 0 && <div className="menu-empty"><Search size={23} /><b>Nessun prodotto trovato</b><span>Prova un altro nome o categoria.</span></div>}
          </div>
          <div className="menu-hint"><span className="hint-key">Tocco rapido</span> Il prodotto entra in bozza. Invia la comanda quando è pronta.</div>
        </section>

        <aside className="smart-order">
          <div className="order-heading">
            <div className="order-table-title"><span className={`table-avatar ${activeTable.status}`}>{activeTable.name.replace("Tavolo ", "T")}</span><div><div className="eyebrow">CONTO APERTO</div><h2>{activeTable.name}</h2></div></div>
            <button className="icon-button" aria-label="Altre azioni sul conto" onClick={() => setSecondaryOpen(v => !v)}><MoreHorizontal size={21} /></button>
          </div>
          <div className="order-subline"><span><Users size={15} /> {activeTable.covers || 0} coperti</span><span><Clock3 size={14} /> {activeTable.elapsed || 0} min</span><button onClick={() => updateTable(t => ({ ...t, covers: Math.min(t.seats, t.covers + 1), status: "occupato" }))}>Modifica</button></div>
          {secondaryOpen && <div className="quick-menu order-secondary"><b>Altre azioni sul conto</b><button onClick={() => setNotice("Preconto pronto in simulazione — nessuna stampa reale.")}>Mostra preconto</button><button onClick={() => setNotice("Nota aggiunta: modifica le note dall'articolo selezionato.")}>Aggiungi una nota</button><button onClick={() => setNotice("Sconto: funzione dimostrativa, nessun importo modificato.")}>Applica uno sconto</button><button onClick={() => setNotice("Sposta singoli articoli: scegli la riga e il tavolo di destinazione.")}>Sposta articoli</button><button onClick={() => setNotice("Conto rapido · Asporto · Consegna sono disponibili come ordini separati nella versione completa.")}>Conto rapido, asporto o consegna</button><button onClick={() => setNotice("Codice lotteria pronto in simulazione — nessun invio fiscale.")}>Codice lotteria degli scontrini</button><button onClick={() => setNotice("Ristampa di cortesia in demo — nessuna stampa inviata.")}>Ristampa di cortesia</button></div>}
          <div className="order-columns"><span>ARTICOLO · {activeTable.items.length} RIGHE</span><span>IMPORTO</span></div>
          <div className="order-lines" data-testid="order-list">
            {activeTable.items.length ? activeTable.items.map(item => <div className={`order-line ${item.status}`} key={item.id} data-testid={`order-item-${item.id}`}>
              <div className={`order-status-mark ${item.status}`} title={item.status === "inviato" ? "Inviato in cucina" : "Bozza non inviata"}>{item.status === "inviato" ? <Check size={13} /> : <span />}</div>
              <div className="order-item-main"><div className="order-item-name">{item.product.name}</div><div className="order-item-meta">{item.status === "inviato" ? "Inviato in cucina" : "Bozza · non ancora inviata"}{item.modifier && <span className="item-modifier"> · {item.modifier}</span>}</div><div className="qty-control"><button aria-label={`Diminuisci ${item.product.name}`} onClick={() => changeQty(item.id, -1)}><Minus size={15} /></button><span>{item.qty}</span><button aria-label={`Aumenta ${item.product.name}`} onClick={() => changeQty(item.id, 1)}><Plus size={15} /></button><button className="modifier-button" onClick={() => setModifierItem(modifierItem === item.id ? null : item.id)}>{modifierItem === item.id ? "Chiudi" : "Nota / modifica"}</button></div>{modifierItem === item.id && <div className="modifier-options"><button onClick={() => updateTable(t => ({ ...t, items: t.items.map(i => i.id === item.id ? { ...i, modifier: i.modifier ? undefined : "Senza cipolla" } : i) }))}>{item.modifier ? "Rimuovi «senza cipolla»" : "Aggiungi «senza cipolla»"}</button><button onClick={() => setNotice("Nota demo: puoi aggiungere dettagli alla riga.")}>Aggiungi nota</button></div>}</div>
              <strong className="order-line-price">{euro(item.product.price * item.qty)}</strong>
            </div>) : <div className="order-empty"><Utensils size={25} /><b>Il conto è pronto</b><span>Scegli un prodotto dal menu per iniziare.</span></div>}
            {activeTable.covers > 0 && <div className="order-line cover-line">
              <div className="cover-mark"><Users size={13} /></div>
              <div className="order-item-main"><div className="order-item-name">Coperto</div><div className="order-item-meta">{activeTable.covers} × € 1,50</div><div className="qty-control"><button aria-label="Diminuisci coperti" onClick={() => updateTable(t => ({ ...t, covers: Math.max(0, t.covers - 1) }))}><Minus size={15} /></button><span>{activeTable.covers}</span><button aria-label="Aumenta coperti" onClick={() => updateTable(t => ({ ...t, covers: Math.min(t.seats, t.covers + 1) }))}><Plus size={15} /></button></div></div>
              <strong className="order-line-price">{euro(activeTable.covers * 1.5)}</strong>
            </div>}
          </div>
          <div className="order-footer">
            <div className="order-status-key"><span><i className="status-key sent" />Inviato</span><span><i className="status-key draft" />Bozza</span><span>{sentCount} inviati · {draftCount} da inviare</span></div>
            <button className="send-order" disabled={!draftCount} onClick={sendDrafts}><Send size={18} /><span>Invia comanda</span><b>{draftCount ? `${draftCount} ${draftCount === 1 ? "riga" : "righe"}` : "Tutto inviato"}</b></button>
            <div className="total-line"><span>Totale conto</span><strong>{euro(total)}</strong></div>
            <button className="pay-cta" disabled={!activeTable.items.length} onClick={() => { setPaymentOpen(true); setPaymentResult(""); setPayMode("intero"); }}><span><CreditCard size={20} /> Vai al pagamento</span><b>{euro(total)} <ArrowRight size={19} /></b></button>
            <div className="safe-note">Pagamento di prova · nessun addebito reale</div>
          </div>
        </aside>
      </section>

      {notice && <div className="smart-toast" role="status"><Check size={17} />{notice}<button aria-label="Chiudi avviso" onClick={() => setNotice("")}><X size={15} /></button></div>}

      {paymentOpen && <div className="payment-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setPaymentOpen(false); }}>
        <section className="payment-sheet" role="dialog" aria-modal="true" aria-labelledby="payment-title">
          <div className="payment-header"><div><div className="eyebrow">CHIUSURA CONTO · {activeTable.name.toUpperCase()}</div><h2 id="payment-title">Come paga il tavolo?</h2></div><button className="icon-button" aria-label="Chiudi pagamento" onClick={() => setPaymentOpen(false)}><X size={21} /></button></div>
          <div className="payment-demo-alert"><Info size={17} /><span><b>Modalità demo.</b> Nessun pagamento reale, documento fiscale o stampa.</span></div>
          <div className="payment-modes">
            {([{ id: "intero", title: "Conto intero", detail: "Una persona paga tutto", icon: Wallet }, { id: "separato", title: "Conto separato", detail: "Scegli le righe da pagare", icon: Split }, { id: "romana", title: "Alla romana", detail: "Dividi in parti uguali", icon: Users }] as const).map(mode => <button key={mode.id} onClick={() => chooseMode(mode.id)} className={payMode === mode.id ? "selected" : ""}><mode.icon size={21} /><span><b>{mode.title}</b><small>{mode.detail}</small></span><i>{payMode === mode.id && <Check size={14} />}</i></button>)}
          </div>
          {payMode === "separato" && <div className="split-picker"><div className="split-title"><b>Seleziona cosa paga questo cliente</b><span>Il resto rimane sul conto</span></div>{activeTable.items.map(item => <button key={item.id} className={`split-row ${selectedForSplit.includes(item.id) ? "selected" : ""}`} onClick={() => setSelectedForSplit(old => old.includes(item.id) ? old.filter(id => id !== item.id) : [...old, item.id])}><span className="split-check">{selectedForSplit.includes(item.id) && <Check size={15} />}</span><span>{item.qty} × {item.product.name}</span><b>{euro(item.qty * item.product.price)}</b></button>)}{activeTable.covers > 0 && <button className={`split-row ${includeCoversInSplit ? "selected" : ""}`} onClick={() => setIncludeCoversInSplit(v => !v)}><span className="split-check">{includeCoversInSplit && <Check size={15} />}</span><span>{activeTable.covers} coperti × € 1,50</span><b>{euro(activeTable.covers * 1.5)}</b></button>}</div>}
          {payMode === "romana" && <div className="romana-control"><div><b>Quote da pagare</b><span>Totale conto {euro(total)}</span></div><div className="quote-stepper"><button aria-label="Meno quote" onClick={() => setSplitCovers(v => Math.max(1, v - 1))}><Minus size={17} /></button><strong>{splitCovers}</strong><span>{splitCovers === 1 ? "quota" : "quote"}</span><button aria-label="Più quote" onClick={() => setSplitCovers(v => Math.min(12, v + 1))}><Plus size={17} /></button></div></div>}
          <div className="invoice-block">
            <button className={`invoice-toggle ${invoice ? "on" : ""}`} onClick={() => { setInvoice(v => !v); setPaymentResult(""); }}><span className="invoice-icon"><FileText size={19} /></span><span><b>Richiedi fattura</b><small>Intestazione cliente facoltativa</small></span><span className="switch-track"><i /></span></button>
            {invoice && <div className="invoice-fields"><label>Tipo cliente<select value={clientType} onChange={e => setClientType(e.target.value)}><option>Persona</option><option>Azienda</option></select></label><label>Intestatario<input value={clientName} onChange={e => setClientName(e.target.value)} placeholder={clientType === "Persona" ? "Nome e cognome" : "Ragione sociale"} /></label><label>Codice fiscale / partita IVA<input value={clientCode} onChange={e => setClientCode(e.target.value)} placeholder={clientType === "Persona" ? "Codice fiscale" : "Partita IVA"} /></label><p>La fattura viene solo simulata: nessun invio o documento fiscale.</p></div>}
          </div>
          <div className="payment-methods"><span>METODO DI PAGAMENTO</span><div><button className={payMethod === "Carta" ? "chosen" : ""} onClick={() => setPayMethod("Carta")}><CreditCard size={18} /> Carta</button><button className={payMethod === "Contanti" ? "chosen" : ""} onClick={() => setPayMethod("Contanti")}><Banknote size={18} /> Contanti</button></div></div>
          {paymentResult && <div className={`payment-result ${paymentResult.startsWith("Completa") ? "warning" : ""}`} role="status"><Check size={17} />{paymentResult}</div>}
          <div className="payment-total"><span>{payMode === "intero" ? "Da pagare" : payMode === "separato" ? "Quota selezionata" : `${splitCovers} quote · questa quota`}</span><strong>{euro(paymentAmount)}</strong></div>
          <button className="confirm-payment" disabled={payMode === "separato" && selectedForSplit.length === 0 && !includeCoversInSplit} onClick={confirmPayment}>{invoice ? <Printer size={18} /> : <Check size={18} />}{invoice ? "Conferma demo fattura" : "Conferma pagamento demo"} <b>{euro(paymentAmount)}</b></button>
          <button className="payment-back" onClick={() => setPaymentOpen(false)}><ArrowLeft size={16} /> Torna al conto</button>
        </section>
      </div>}
      <footer className="smart-bottom"><span>HELLOTABLE · TERMINALE SALA</span><span>Conto di prova · dati locali</span><button onClick={() => setNotice("La guida rapida è disponibile al responsabile di sala.")}>Aiuto <ChevronDown size={13} /></button><span className="screen-reader-only"><MoreHorizontal /></span></footer>
    </main>
  );
}

export default Smart;
