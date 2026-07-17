# RestoPOS - Gestionale POS per Ristoranti/Pub/Birrerie

## Overview

Full-stack POS (Point of Sale) system for restaurants, pubs, and breweries. Built as a modern webapp optimized for touchscreen Windows PCs. Includes a Front Office (cashier/floor) and Back Office (management) interface. UI entirely in Italian.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (zod/v4), drizzle-zod
- **API codegen**: Orval (from OpenAPI spec)
- **Frontend**: React + Vite + Tailwind CSS v4 (light theme)
- **State**: TanStack React Query
- **Charts**: Recharts
- **Icons**: Lucide React
- **Components**: shadcn/ui
- **Drag-and-drop**: @dnd-kit

## Design

- **Light professional theme**: white cards, soft shadows, light gray background (#f4f6fa)
- **Dark sidebar**: hsl(220 18% 14%) with orange/amber highlights
- **Orange primary**: hsl(27 96% 51%)
- **Touch-optimized**: large buttons, min 48px targets
- **All UI in Italian**

## Authentication

- PIN-based login (4-digit numpad) — required every session (sessionStorage, cleared on tab close)
- Roles: `admin` (full access) | `employee` (front-office only)
- Default users: Admin PIN `0000`, Cassiere PIN `1234`
- API: `POST /api/auth/login` (validate PIN → user object), `GET/POST/PATCH/DELETE /api/auth/users`
- Frontend: `AuthContext`, `LoginPage`, route protection in `App.tsx`

## Wizard di Onboarding (Idempotente)

Il wizard a 7 step (`/onboarding`) è **idempotente** e sicuro da rieseguire:

- **Detection retroattiva**: l'endpoint `GET /api/setup-status` ritorna `completed=true` se il flag `onboarding_completed` è `"true"` OPPURE se l'installazione contiene almeno 1 admin + 1 sala + 1 categoria + 1 prodotto. In quel secondo caso, il flag viene auto-settato per le richieste future. Questo evita che installazioni esistenti (es. una cassa già configurata pre-flag) vengano rispedite al wizard dopo un update.
- **App.tsx** redirige a `/onboarding` solo se `setupStatus.completed === false` (no flicker pre-fetch).
- **Pre-popolazione**: all'avvio, `onboarding.tsx` carica via `Promise.allSettled` settings + rooms + tables + categories + products + users. Se un endpoint fallisce, gli altri popolano comunque i campi corrispondenti.
- **Idempotenza per-step**: ogni save step (sale, categorie, prodotti, personale) salta i duplicati per nome (lowercase compare) e mostra un toast con conteggio creati/saltati. Dopo ogni save, lo snapshot `existing` viene ricaricato (`refreshExistingCollections()`) per garantire idempotenza anche su back/forward nella stessa sessione.
- **Bottoni gated**: tutti i pulsanti Avanti/Crea sono disabled durante `loadingExisting`, impossibile salvare prima del preload.
- **Riapertura manuale**: dal Backoffice → Funzioni il bottone "Riapri wizard" naviga semplicemente a `/onboarding` senza toccare il flag (idempotenza fa il resto).
- **Settings via batch PATCH** (upsert su `INSERT ... ON CONFLICT`): non c'è rischio di sovrascrittura distruttiva su step Attività/Cassa.

## Codegen Caveat (Orval Zod)

Il target `zod` di Orval (modalità `split`) non genera `api.schemas.ts` ma rigenera
sempre `lib/api-zod/src/index.ts` con `export * from "./generated/api.schemas"`.
Per evitare che il build si rompa ad ogni codegen, in `lib/api-spec/orval.config.ts`
è registrato un hook `afterAllFilesWrite` sul target `zod` che ricrea
automaticamente `lib/api-zod/src/generated/api.schemas.ts` come stub vuoto
(`export {};`) ad ogni codegen. Non serve manutenzione manuale; non rimuovere
l'hook senza prima sistemare l'export in `lib/api-zod/src/index.ts`.

## Application Structure

### Frontend Pages (`artifacts/pos-restaurant/src/pages/`)

**Front Office (`/`):**
- GOODFOOD-style visual table map with seat dots around cards
- Room filter tabs (derived from DB rooms)
- Table status: Libero / Occupato / Riservato (color-coded)
- Order mode: categories → products drill-down (no descriptions, sorted by sortOrder)
- Order panel: draft/sent item status, quantity controls
- Cover price line item (settable in back-office settings, charged per cover)
- **Azioni**: Invia Comanda, Preconto, Conto Separato (split bill by item selection), Romana, Paga
- Payment dialog: Contanti (resto auto), Carta/POS, Satispay, Altro (grid-cols-4 single row)
- Cart: phase separators (F1/F2/F3/F4 dividers between item groups when multi-phase order)
- Cart: pinned lottery code row (amber badge above items when lotteriaCodice is set)
- Split bill dialog: select individual items, proportional cover charge, method selector
- Quick modes: Bevuta Rapida (always), Asporto, Delivery (toggle in settings)
- Auto-send comanda on table switch

**Back Office (admin only):**
- `/backoffice` — Dashboard KPI
- `/backoffice/menu` — Products & categories CRUD (IVA, SKU, sortOrder, departmentId)
- `/backoffice/rooms` — Sale CRUD with @dnd-kit reorder
- `/backoffice/tables` — Tavoli with two views:
  - **Planimetria**: drag-canvas position editor (12×8 grid, posX/posY saved to DB)
  - **Lista**: @dnd-kit sortable
- `/backoffice/departments` — Reparti with **printer linking** (printerId FK)
- `/backoffice/printers` — Stampanti CRUD (ESC/POS ready)
- `/backoffice/reports` — Sales charts and top products
- `/backoffice/payments` — Payment history
- `/backoffice/users` — User management (PIN numpad, roles: admin/employee)
- `/backoffice/settings` — Cover price, Asporto/Delivery toggles, Bevuta Rapida info

### Backend (`artifacts/api-server/src/routes/`)
- `/api/auth` — Login, users CRUD
- `/api/categories` — CRUD
- `/api/products` — CRUD (sorted by sortOrder)
- `/api/rooms` — CRUD
- `/api/tables` — CRUD + `/reorder` (sortOrder) + PATCH posX/posY
- `/api/departments` — CRUD (printerId field)
- `/api/printers` — CRUD
- `/api/orders` — CRUD + `POST /:id/send-comanda` + `PATCH /:id/covers`
- `/api/orders/:id/items` — Order items CRUD
- `/api/payments` — Payment recording
- `/api/dashboard/*` — Summary, sales-by-day, top-products, tables-status
- `/api/settings` — GET/PATCH key-value settings

### Database Schema (`lib/db/src/schema/`)
- `categories` — Menu categories with color and sort order
- `products` — Menu items: price, IVA (4/10/22%), SKU, department, available, sortOrder
- `rooms` — Sale with sortOrder
- `tables` — Tavoli with roomId, seats, status, sortOrder, **posX/posY** (grid position)
- `departments` — Reparti with productionType, **printerId** (FK to printers)
- `printers` — Stampanti: IP, port, model, active
- `orders` — Orders with table, covers count, status
- `order_items` — Items with status: draft (not yet sent) or sent (comanda inviata)
- `payments` — Payment records with method and amounts
- `users` — Auth users: name, PIN (4-digit), role (admin/employee)
- `app_settings` — Key-value: enable_asporto, enable_delivery, **cover_price**
- `product_variations` — Legacy: variation groups per product (kept for compatibility)
- `modifiers` — Global modifiers: label, type (plus/minus/note), priceExtra (optional)
- `category_modifiers` — Junction table: many-to-many modifiers ↔ categories
- `order_items.modifiers` — JSON column: snapshot of selected modifiers at order time
- `customers` — Customer registry for electronic invoicing (FatturaPA)
- `invoices` — FatturaPA 1.2.1 invoices with XML content
- `fiscal_receipts` — Fiscal receipt records

## POS Flow

1. **Login**: PIN numpad → sessionStorage user (cleared on tab close)
2. **Option A**: Select table → Covers dialog → order opened
3. **Option B**: Click product directly → auto-creates "Scontrino Rapido" → tap "Assegna" to move to a real table
4. Add products → items are "draft" (orange background in comanda)
5. **Invia Comanda** → all draft items → "sent" (routes to dept printer in future)
6. **Preconto** → shows receipt preview with cover charge
7. **Conto Separato** → select individual items + proportional covers → partial payment
8. **Romana** → split total by number of people
9. **Paga** → payment dialog (cash with change, card, other) → optionally toggle **Emetti Fattura** → search/select customer → creates FatturaPA + emits XML → order closed, table freed

## Table Editor

- Rotation step: **45°** (supports diamond/rhombus layout for 4-seat tables)
- Rooms, tables, decors on a 12×8 grid (80px cells)

## Modifiers / Variazioni (Back-office → Variazioni)

Global modifiers not bound to individual products but to **categories**:
- **Types**: `plus` (+ aggiunta), `minus` (− rimozione), `note` (✎ commento)
- Optional price change (positive or negative); defaults to 0
- Each modifier can be associated to multiple categories via checkbox
- **In cassa**: when a product from a category with modifiers is tapped, a picker dialog appears to optionally select modifiers before adding the item
- Selected modifiers are stored as JSON snapshot in `order_items.modifiers` and shown as chips in the cart
- Price of the item is adjusted by the sum of selected modifier `priceExtra` values
- API: `GET/POST /api/modifiers`, `PATCH/DELETE /api/modifiers/:id`, `GET /api/modifiers/by-category/:categoryId`

## Reservations System (Prenotazioni)

- API: `GET/POST /api/reservations`, `PATCH/DELETE /api/reservations/:id`
- Fields: `tableId` (primary table, integer), `tableIds` (JSON array e.g. "[1,2]" for multi-table), `date` (YYYY-MM-DD), `time` (HH:MM), `covers`, `guestName`, `phone`, `notes`, `status`
- `status` values: `"pending"`, `"confirmed"`, `"seated"`, `"cancelled"`
- **Multi-table support**: `tableIds` JSON array in DB; `parseTableIds(r)` helper in frontend extracts all table IDs
- **Prenota button** in the table map header opens a full new-reservation dialog: nome, telefono, orario, coperti + multi-select tavoli (checkboxes on free table buttons)
- **Front-office table map** fetches today's reservations via `?date=TODAY`
- Unassigned reservations (no `tableId`) shown as a scrollable strip above the floor plan with "Assegna" button per card
- Clicking "Assegna" on a reservation enters **assign mode** — free tables pulse green, tap one to assign
- Reserved tiles (blue) show guest name + time directly on the tile
- Clicking a reserved tile (no active order) shows a popup with: "Avvia ordine" / "Sposta a un altro tavolo"
- "Sposta" enters **move mode** — same green-pulse behavior, tap another free table to move the reservation

## Key Commands

- `pnpm --filter @workspace/api-server run dev` — Run API server
- `pnpm --filter @workspace/pos-restaurant run dev` — Run frontend
- `pnpm --filter @workspace/db run push` — Push schema changes
- `pnpm --filter @workspace/api-spec run codegen` — Regenerate API hooks from OpenAPI

## Settings Keys

| Key | Values | Default |
|-----|--------|---------|
| `enable_asporto` | `"true"` / `"false"` | `"false"` |
| `enable_delivery` | `"true"` / `"false"` | `"false"` |
| `cover_price` | decimal string e.g. `"2.50"` | `"0.00"` |

## v2 Changes (T001–T010)

### Backend
- **Atomic transactions** — `orders.ts` (close order + free table), `payments.ts` (payment + free), `fiscal.ts` (`paid_romana` SQL increment). All via `db.transaction()` o SQL atomico per evitare race conditions.
- `recalcOrderTotal` calcola in centesimi (no float drift).
- New PATCH passthrough fields su `orders`: `discountType`, `discountValue`, `discountReason`, `mancia`, `sospeso`, `sospesoNote`, `sospesoCustomerId`, `covers`.
- **Operazioni tavolo avanzate** (feature flag `feat_table_ops`):
  - `POST /api/orders/:id/move-table` — sposta ordine su tavolo libero, atomico via `db.transaction`
  - `POST /api/orders/:id/merge` — unisce due ordini (items spostati, total ricalcolato da SUM(subtotal), source eliminato). Bloccato se source ha sconto/mancia/sospeso.
  - `POST /api/orders/:fromId/items/move` — sposta items selezionati tra ordini, ricalcola entrambi i total da SUM(subtotal). Tutto in transazione.
- **Buoni Pasto** come metodo di pagamento (feature flag `feat_buoni_pasto`): aggiunto "ticket" all'enum OpenAPI/Zod (`cash|card|ticket|other`); UI condizionale in PaymentDialog e SplitBillDialog.
- Bug fix: `payments.ts` referenziava `splitItemIds` in TDZ (linea 74 prima della dichiarazione a linea 80) → corretto a `splitItemIdsPre`.
- New PATCH passthrough field su `products`: `allergeni`.

### New endpoints
- `POST /api/fiscal/open-drawer` — apre cassetto via comando RT (`1g`).
- `GET /api/fiscal/iva-report?from=&to=` — riepilogo IVA per aliquota nel periodo.
- `GET /api/fiscal/sospesi` — lista conti sospesi non pagati.
- `GET /api/audit?from=&to=&action=&entityType=&limit=` — visualizzazione audit log.
- Lib `src/lib/audit.ts` (`logAudit`) usata da operazioni critiche (sconto, sospeso, cassetto, storno, delete item, move-table, merge, move-items).
- **Pagina Funzioni** (`/backoffice/funzioni`): toggle on/off per feature flags opzionali (`feat_table_ops`, `feat_buoni_pasto` live; `feat_corsi`, `feat_kds`, `feat_chiusura_turno`, `feat_fidelity`, `feat_magazzino` placeholder "in arrivo"). Salvati in `app_settings` come stringhe `"true"/"false"`.

### Schema DB (push-force già fatto)
- `orders`: `discountType`, `discountValue`, `discountReason`, `mancia`, `sospeso`, `sospesoCustomerId`, `sospesoNote`.
- `products`: `allergeni` (text).
- New table `audit_logs` (id, userId, action, entityType, entityId, details JSON, createdAt).

### Frontend (front-office)
- Action grid 2×5: aggiunti **Sospeso** e **Cassetto**.
- **Sconto** → DiscountDialog (% o € fisso, motivo opzionale, anteprima nuovo totale, rimuovi sconto).
- **Sospeso** → SospesoDialog (note cliente, libera tavolo, importo memorizzato).
- **Cassetto** → POST /fiscal/open-drawer + toast.
- **Mancia** in PaymentDialog (input + quick-buttons €1/€2/€5, sommata al totale, salvata su order).
- **Esaurito quick toggle** su ProductCard (long-press 600ms o tasto destro → PATCH /products/:id, badge rosso "Esaurito").

### Frontend (back-office)
- `menu.tsx`: campo **Allergeni** in ProductForm (es. "glutine, latticini").
- `reports.tsx`: nuove sezioni **Report IVA per aliquota** (filtri data, tabella imponibile/IVA/totale) e **Conti Sospesi** (lista + totale da incassare).

### UX
- Pulsanti +/- a 36–44px (touch-friendly).
- Conferma delete su qty ≤ 0 di draft.
- Messaggi errore italiani con descrizione utile.

## Sessione 2026-05-03 — Chiusura gap residui

Audit del piano T001-T011: praticamente tutto era già implementato dalle sessioni precedenti. Tre fix di chiusura applicate:

1. **T001 / `payments.ts`** — POST `/api/payments`: `INSERT payments` + `UPDATE orders SET status='paid'` ora avvolti in `db.transaction`. La chiamata di rete alla RT (emettiFiscalReceipt / emettiDocumentoNonFiscale) resta FUORI dalla transazione per evitare lock prolungati su I/O di rete. `freeTableIfEmpty` resta fuori (è già SQL atomico idempotente con `NOT EXISTS`).

2. **T010 / `dashboard.ts`** — Aggiunto alias `GET /api/dashboard/iva-report` (stessa logica di `/api/fiscal/iva-report`: aggregazione `fiscal_receipts` per aliquota + per metodo, filtri `from`/`to`).

3. **T008 / `backoffice/menu.tsx`** — Toggle rapido "Esaurito/Disponibile" sulla riga prodotto (icona Check/Ban, PATCH `/api/products/:id` su `available`). Gestione errori con `res.ok` + `try/catch` + `disabled` durante PATCH per prevenire doppi click; toast italiano di esito.

Code review architect: PASS sulle 3 fix; nessuna regressione introdotta. Errori typecheck residui solo su `mockup-sandbox/components/ui/calendar.tsx` e `spinner.tsx` (duplicate `@types/react`) — preesistenti, indipendenti da queste modifiche.

## Sessione 2026-07-17 — Miglioramento backoffice (T001–T006)

- **Sidebar raggruppata** (`Sidebar.tsx`): gruppi collassabili (Prodotti&Menu / Sconti&Promozioni / Sala&Stampa / Report&Cassa / Clienti&Fatture / Sistema), tutte le 26 route raggiungibili (prima solo 10, mancavano ovunque Reparti e Commenti Cucina). Stato gruppi in localStorage `sidebar_open_groups`; gruppo attivo sempre aperto.
- **Dashboard con confronto periodo**: `/api/dashboard/summary` ritorna anche `yesterdayRevenue/yesterdayOrders/lastWeekRevenue/lastWeekOrders` (query unica su ordini paid ultimi 8gg). `backoffice/index.tsx`: badge Δ% "vs ieri" e "vs stesso giorno scorso", sub "ieri: N" su ordini chiusi, sparkline incassi 7gg (recharts).
- **Report con range date**: `/api/dashboard/sales-by-day?days=` (clamp 1-365, default 30); `/api/dashboard/top-products?from&to` (SQL GROUP BY, **solo ordini paid**, periodo riferito a `orders.createdAt` NON a `order_items.createdAt` — gli item possono essere aggiunti in momenti diversi). `reports.tsx`: selettore 7/14/30/90gg sul grafico vendite, filtro date su top products (vuoto = tutto lo storico).
- **Export CSV** (`src/lib/csv.ts`): `downloadCsv` con BOM UTF-8, separatore `;`, CRLF, escaping + anti formula-injection (prefisso `'` su celle che iniziano con `=`,`+`,`@`,tab); `itNum` per virgola decimale italiana. Bottoni "Esporta CSV" su: Report IVA, Vendite per giorno, Top prodotti, Pagamenti.
- **Pagina Pagamenti** (`payments.tsx`): filtri client-side data dal/al + metodo (bottoni derivati dai metodi presenti nei dati, incluso `ticket` Buoni Pasto), "Azzera filtri", export CSV, empty state differenziato.

Code review architect: PASS. Fix applicati post-review: join `orders.status='paid'` su top-products, anti formula-injection CSV, attribuzione periodo a data ordine.

### Fix UX: mappa tavoli front-office troppo grande

`TableMapPanel` (front-office.tsx) faceva upscale fino a 2× quando c'erano pochi tavoli (un solo tavolo occupava tutto lo schermo). Cambiato `setScale(Math.min(fitScale, 1))` per non ingrandire mai oltre la dimensione naturale; con tanti tavoli scala giù come prima. Costante `MIN_RENDERED_CELL` rimossa (unused).

### Fix bug critico: conto separato di soli coperti

**Bug utente**: in conto separato, selezionando 1 solo coperto e premendo Incassa, il sistema chiudeva l'intero ordine e mandava TUTTI gli articoli alla RT.

**Causa**: `payments.ts` rilevava lo split solo da `itemIds.length > 0`. Selezione di soli coperti → `itemIds=[]` → backend trattava come pagamento totale.

**Fix**:
- **`payments.ts`**: rilevamento parziale ora include anche `coversCount > 0` e flag esplicito `partial`. Validazione server-side `coversCount <= order.covers` con HTTP 400. Selezione righe RT: con split di soli coperti `items=[]` (solo riga COPERTO con `qty=coversCountPre`); pagamento totale invariato (tutti items + tutti coperti).
- **Calcolo residuo robusto a split sequenziali**: il residuo è calcolato dagli **item ancora in DB** (escludendo `splitItemIdsPre`) + coperti residui × `cover_price`, NON da `SUM(payments)` (che divergerebbe quando il client elimina gli item pagati e abbassa `orders.total`). L'ordine viene chiuso solo se `totaleResiduo <= 0.01€`.
- **`front-office.tsx handlePay`**: invia `itemIds`, `coversCount`, `partial: isSplitPay` al POST `/api/payments`.

Code review architect (2 iterazioni): PASS finale su tutti gli scenari (items-only, soli coperti, mix, full payment, edge case ordine vuoto). Typecheck OK su api-server.

## RT DTR — regole protocollo documenti gestionali (fix ERRORE 16)

Spec ufficiale nel repo: `attached_assets/SPEC_XonXoff_DTR_21_1776802630202.pdf`.
- La parola **TOTALE è vietata** nelle righe `"..."@` (limitazione di legge): la RT annulla la riga/va in ERRORE 16. `stampaDocumentoGestionale` sanitizza `/TOTALE/gi → "TOT."`; i builder usano `TOT. EUR`.
- **Record max 256 byte** lato PC (soglia buffer RT 384 byte, overflow = caratteri persi → ERRORE 16). `sendXonXoffDocument` invia in chunk ≤200 byte di comandi completi, pausa 120ms, rispetta XOFF/XON; su XOFF persistente invia `K` (tasto C) per sbloccare e riprova. Esito ok = ultimo flow-byte non-XOFF (XOFF transitori sono flow-control normale).
- Timer di risposta riarmato solo su byte ASCII (la RT idle manda XON ogni ~1s).
- Il font delle righe `@` nel gestionale è lo stesso dello scontrino (nessun selettore font nel protocollo).

## Terminali POS bancari (doppio terminale)

Supporto per DUE terminali bancari indipendenti, con scelta al momento del pagamento carta:

- **Nexi PAX D230** (LAN, protocollo ECR/POSLINK su TCP — `lib/pos-terminal.ts`). Richiede attivazione "Protocollo 17/ECR" chiamando Nexi.
- **myPOS Go** (4G): per ora sempre **conferma manuale** (l'operatore digita l'importo sul terminale e conferma in cassa); integrazione CRR API futura.

**Settings keys**: `pos_pax_enabled`, `pos_mypos_enabled` (`"true"/"false"`), `pos_pax_ip`, `pos_pax_port`, `pos_mypos_apikey`, `pos_mypos_terminal_id`. **Retro-compat**: se le nuove chiavi non esistono si usa la vecchia `pos_type` (`none|pax|mypos`); le nuove chiavi hanno precedenza (check `!= null`).

**Backend** (`routes/pos.ts`, FUORI da OpenAPI per scelta — fetch diretto dal client):
- `enabledPosTerminals(settings)` esportata; stessa logica duplicata in `front-office.tsx`.
- `POST /api/pos/sale` body `{amountCents, orderId?, terminal?: "pax"|"mypos"}` → 400 se >1 abilitato senza `terminal`, 400 se terminale non abilitato, lenient `{approved:true, "conferma manuale"}` se 0 abilitati (retro-compat pos_type=none). Risposta: `approved` / `manualConfirmRequired` / errore.
- `GET /api/pos/ping` — solo PAX (TCP).

**Frontend** (`front-office.tsx`): helper modulo `enabledPosTerminals`, `POS_TERMINAL_LABEL`, componente `PosTerminalPicker` (chips, visibile solo se ≥2 terminali abilitati). Flusso POS carta in 4 punti: **PaymentDialog** (+ fix: overlay usa totalConMancia; mancia salvata via PATCH orders anche nei path card approved/manual_confirm), **InlinePaymentPanel** (tab Tot; keyed per activeOrderId; guardia anti-esito-tardivo su Annulla via ref contatore tentativi), **SplitBillBody**, **RomanaBody**. Pattern comune: `approved` → onPay; `manualConfirmRequired` → pannello "Pagamento ricevuto"; `declined`/rete → errore + bottone "Registra comunque incasso manuale".

**Settings UI** (`backoffice/settings.tsx`): due toggle indipendenti; config PAX (ip/porta/ping) e myPOS (apikey/serial) visibili solo se abilitati; `posForm` deriva i valori legacy da `pos_type` al primo load.

### UX redesign — "Esplodi tutti" + tab Tot come hub di pagamento

**Problema utente**: 1) "Sep. Prod." era poco utile perché agiva su un singolo articolo selezionato; 2) Conto Separato e Romana aprivano dialog modali che coprivano la cassa.

**Fix**:
- **`handleExplodeAll`** (sostituisce `handleSplitItem`): un click esplode TUTTI gli articoli del tavolo con `qty>1` in righe da 1 (es. 2 birre + 3 caffè → 5 righe). Bottone rinominato **"Esplodi"**, disabled se nessun articolo è esplodibile. Toast con conteggio righe risultanti.
- **Refactor `SplitBillDialog` → `SplitBillBody` + thin wrapper**: estratto il body senza wrapping `Dialog` per riusarlo inline. `SplitBillDialog` ora è un thin wrapper attorno a `SplitBillBody` (compat retroattiva). Stato interno fresh ad ogni open via `{open && <SplitBillBody />}`.
- **Refactor `RomanaDialog` → `RomanaBody` + thin wrapper**: stessa pattern. Rimosso `useEffect` reset on `open` (gestito dal mount/unmount via `key`). Tutti gli `onClose` interni → `onCancel`.
- **Tab "tot" hub di pagamento**: nuovo selettore segmentato a 3 vie **Totale | Separato | Romana**. Stato `paymentMode: "full"|"split"|"romana"` (default "full", reset a "full" quando si lascia il tavolo via `useEffect` su `selectedTableId`). Render condizionale: `InlinePaymentPanel` (full), `<SplitBillBody key={`split-${activeOrderId}`} />` (split, con guard "servono almeno 2 articoli"), `<RomanaBody key={`romana-${activeOrderId}`} />` (romana, con guard ordine vuoto). Il `key` per activeOrderId garantisce remount/state-reset al cambio ordine.
- **Bottoni griglia "Conto Sep." e "Romana"**: invece di aprire dialog ora fanno `setPaymentMode(...) + setRightTab("tot") + setMobilePanel("right")` — l'utente vede il pannello pagamento direttamente nella tab Tot a destra.

Code review architect: PASS — nessuna regressione, `PrecontoDialog` e `PaymentDialog` intatti, `handlePay` correttamente riceve `itemIds`+`coversToDeduct` dall'inline e skippa `handleExitOrder` su split parziale. Stati `showSplitBill`/`showRomana` lasciati come dead-code-safe fallback (mai aperti da UI). Typecheck FE: solo errori preesistenti su mockup-sandbox.
