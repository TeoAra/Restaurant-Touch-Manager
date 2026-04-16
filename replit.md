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
- Payment dialog: Contanti (resto auto), Carta, Altro
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
- `product_variations` — Variation groups per product: name, options (JSON), required, sortOrder
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

## Product Variations (Back-office → Menu)

Each product has a **⚙ Variazioni** button opening a dedicated dialog:
- Add/edit/delete **variation groups** (e.g., "Cottura", "Taglia", "Aggiunta")
- Each group has: **name**, **required** toggle, list of **options** (name + price extra)
- API: `GET/POST /api/products/:id/variations`, `PATCH/DELETE /api/products/:productId/variations/:varId`

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
