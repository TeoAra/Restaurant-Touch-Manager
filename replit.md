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
