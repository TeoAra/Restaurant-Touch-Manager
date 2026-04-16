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

## Design

- **Light professional theme**: white cards, soft shadows, light gray background (#f5f5f5)
- **Dark sidebar**: charcoal (#220e18) with orange/amber highlights
- **Orange primary**: hsl(27 96% 51%) — consistent with restaurant brand feel
- **Touch-optimized**: large buttons, min 48px targets, 3-panel POS layout
- **All UI in Italian**

## Application Structure

### Frontend Pages (`artifacts/pos-restaurant/src/pages/`)

**Front Office:**
- `/` — Sala: 3-panel layout (tavoli | prodotti | comanda)
  - Room filter tabs (Sala Principale, Dehor, Bancone)
  - Table cards with status (Libero/Occupato/Riservato) + order total + time
  - Product catalog with search bar and category filter
  - Order panel with quantity controls, draft/sent item status
  - **Azioni**: Invia Comanda, Preconto, Divisione alla Romana, Paga
  - Payment dialog: Contanti (resto auto), Carta, Altro
  - Covers dialog when opening a new table

**Back Office:**
- `/backoffice` — Dashboard KPI
- `/backoffice/menu` — Products & categories CRUD (includes IVA, SKU fields)
- `/backoffice/rooms` — Sale CRUD
- `/backoffice/tables` — Tavoli CRUD (with room assignment)
- `/backoffice/departments` — Reparti CRUD (Cucina/Bar/Pizzeria + produzione type)
- `/backoffice/printers` — Stampanti CRUD (placeholder, Sewoo ESC/POS ready)
- `/backoffice/reports` — Sales charts and top products
- `/backoffice/payments` — Payment history

### Backend (`artifacts/api-server/src/routes/`)
- `/api/categories` — CRUD
- `/api/products` — CRUD (with IVA, SKU, departmentId)
- `/api/rooms` — CRUD
- `/api/tables` — CRUD (with roomId)
- `/api/departments` — CRUD
- `/api/printers` — CRUD (placeholder)
- `/api/orders` — CRUD + `POST /:id/send-comanda` + `PATCH /:id/covers`
- `/api/orders/:id/items` — Order items CRUD
- `/api/payments` — Payment recording
- `/api/dashboard/*` — Summary, sales-by-day, top-products, tables-status

### Database Schema (`lib/db/src/schema/`)
- `categories` — Menu categories with color and sort order
- `products` — Menu items: price, IVA (4/10/22%), SKU, department, available
- `rooms` — Sale (Sala Principale, Dehor, Bancone)
- `tables` — Tavoli with room_id, seats, status
- `departments` — Reparti: Cucina, Bar, Pizzeria with production type
- `printers` — Stampanti: IP, port, model, department, active
- `orders` — Orders with table, covers count, status
- `order_items` — Items with status: draft (not yet sent) or sent (comanda inviata)
- `payments` — Payment records with method and amounts

## POS Flow

1. Select table → Covers dialog (how many guests)
2. Table opens → order created, table marked "Occupato"
3. Add products → items are "draft"
4. **Invia Comanda** → all draft items → "sent" (prints to kitchen/bar in future)
5. **Preconto** → shows receipt preview
6. **Romana** → split by number of people
7. **Paga** → payment dialog (cash with change, card, other) → order closed, table freed

## Future Modules (Placeholder Ready)

- **Print engine**: `artifacts/api-server/src/routes/orders.ts` has `// TODO: trigger print-engine`
- **Fiscal adapter (DTR)**: Placeholder methods: getStatus, printReceipt, readXReport, closeZReport
- **Operator PIN login**: Auth structure ready to add

## Seed Data (pre-loaded)

- 8 categories (Birre, Cocktail, Analcolici, Primi, Secondi, Pizze, Dessert, Stuzzichini)
- 28 products
- 10 tables
- 3 rooms (Sala Principale, Dehor, Bancone)
- 3 departments (Cucina, Bar, Pizzeria)

## Key Commands

- `pnpm --filter @workspace/api-server run dev` — Run API server
- `pnpm --filter @workspace/pos-restaurant run dev` — Run frontend
- `pnpm --filter @workspace/db run push` — Push schema changes
- `pnpm --filter @workspace/api-spec run codegen` — Regenerate API hooks from OpenAPI
