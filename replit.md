# RestoPOS - Gestionale POS per Ristoranti/Pub/Birrerie

## Overview

Full-stack POS (Point of Sale) system for restaurants, pubs, and breweries. Built as a modern webapp optimized for touchscreen Windows PCs. Includes a Front Office (cashier/floor) and Back Office (management) interface.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Frontend**: React + Vite + Tailwind CSS v4
- **State**: TanStack React Query
- **Charts**: Recharts

## Application Structure

### Frontend (`artifacts/pos-restaurant/`)
- **`/`** — Front Office: tables grid, product catalog, order management, payment
- **`/orders`** — Active orders list
- **`/backoffice`** — Back Office hub with KPI summary
- **`/backoffice/menu`** — Products and categories CRUD
- **`/backoffice/tables`** — Tables configuration
- **`/backoffice/reports`** — Sales charts and top products
- **`/backoffice/payments`** — Payment history

### Backend (`artifacts/api-server/`)
API routes under `/api`:
- `/api/categories` — Menu categories CRUD
- `/api/products` — Menu products CRUD
- `/api/tables` — Restaurant tables CRUD
- `/api/orders` — Orders with items management
- `/api/orders/:id/items` — Order items
- `/api/payments` — Payment registration
- `/api/dashboard/*` — Reports and stats endpoints

### Database Schema (`lib/db/src/schema/`)
- `categories` — Menu categories with color and sort order
- `products` — Menu items with price and availability
- `tables` — Restaurant tables with status
- `orders` — Orders linked to tables
- `order_items` — Individual items in an order
- `payments` — Payment records

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Design

- Dark professional theme with warm amber/orange primary color (#f59e0b)
- Optimized for touchscreen — large tap targets (min 48px)
- Three-panel Front Office layout: tables | products | order
- Italian language UI

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
