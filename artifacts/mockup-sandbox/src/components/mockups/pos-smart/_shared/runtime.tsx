import type { ReactNode } from "react";

export type TableStatus = {
  id: number;
  name: string;
  seats: number;
  status: "free" | "occupied" | "reserved";
  activeOrderId?: number | null;
  activeOrderTotal?: string | null;
  activeOrderCreatedAt?: string | null;
};

const tables: (TableStatus & Record<string, any>)[] = [
  { id: 1, name: "1", seats: 2, status: "free", roomName: "Sala", posX: 96, posY: 96, shape: "round", elementType: "table" },
  { id: 2, name: "2", seats: 4, status: "free", roomName: "Sala", posX: 192, posY: 96, shape: "square", elementType: "table" },
  { id: 3, name: "3", seats: 2, status: "free", roomName: "Sala", posX: 288, posY: 96, shape: "round", elementType: "table" },
  { id: 4, name: "4", seats: 4, status: "occupied", activeOrderId: 104, activeOrderTotal: "42.00", activeOrderCreatedAt: new Date(Date.now() - 24 * 60000).toISOString(), roomName: "Sala", posX: 384, posY: 96, shape: "square", elementType: "table" },
  { id: 5, name: "5", seats: 4, status: "free", roomName: "Sala", posX: 480, posY: 96, shape: "square", elementType: "table" },
  { id: 6, name: "6", seats: 6, status: "reserved", roomName: "Sala", posX: 576, posY: 96, shape: "rectangle", elementType: "table" },
  { id: 7, name: "7", seats: 2, status: "free", roomName: "Dehor", posX: 96, posY: 192, shape: "round", elementType: "table" },
  { id: 8, name: "8", seats: 4, status: "free", roomName: "Dehor", posX: 192, posY: 192, shape: "square", elementType: "table" },
];
const categories = [
  { id: 1, name: "Birre alla spina", color: "#d97706", sortOrder: 1 },
  { id: 2, name: "Panini", color: "#ea580c", sortOrder: 2 },
  { id: 3, name: "Cucina", color: "#16a34a", sortOrder: 3 },
  { id: 4, name: "Vini & cocktail", color: "#9333ea", sortOrder: 4 },
  { id: 5, name: "Bibite", color: "#0284c7", sortOrder: 5 },
];
const products = [
  { id: 1, name: "Pinta IPA artigianale", price: "6.50", categoryId: 1, available: true, allergeni: "Cereali contenenti glutine" },
  { id: 2, name: "Media lager 0,4 l", price: "4.50", categoryId: 1, available: true, allergeni: "Cereali contenenti glutine" },
  { id: 3, name: "Panino pulled pork", price: "12.00", categoryId: 2, available: true, allergeni: "Glutine, latte, senape" },
  { id: 4, name: "Burger della casa", price: "14.50", categoryId: 2, available: true, allergeni: "Glutine, latte, uova" },
  { id: 5, name: "Patatine rustiche", price: "5.00", categoryId: 3, available: true, allergeni: null },
  { id: 6, name: "Tagliere misto", price: "16.00", categoryId: 3, available: true, allergeni: "Latte" },
  { id: 7, name: "Calice Barbera", price: "6.00", categoryId: 4, available: true, allergeni: "Solfiti" },
  { id: 8, name: "Tiramisù della casa", price: "6.50", categoryId: 3, available: true, allergeni: "Glutine, latte, uova" },
];
const order = {
  id: 104, tableId: 4, tableName: "4", covers: 4, total: "36.00", paidRomana: "0.00",
  items: [
    { id: 4101, productId: 1, productName: "Pinta IPA artigianale", quantity: 2, unitPrice: "6.50", subtotal: "13.00", phase: 0, status: "sent", modifiers: "[]", notes: null },
    { id: 4102, productId: 3, productName: "Panino pulled pork", quantity: 1, unitPrice: "12.00", subtotal: "12.00", phase: 0, status: "sent", modifiers: "[{\"label\":\"Senza cipolla\",\"type\":\"minus\"}]", notes: null },
    { id: 4103, productId: 5, productName: "Patatine rustiche", quantity: 1, unitPrice: "5.00", subtotal: "5.00", phase: 0, status: "draft", modifiers: "[]", notes: null },
    { id: 4104, productId: 7, productName: "Calice Barbera", quantity: 1, unitPrice: "6.00", subtotal: "6.00", phase: 1, status: "draft", modifiers: "[]", notes: null },
  ],
};
const settings = { cover_price: "1.50", feat_price_lock: "false", pos_type: "none", pos_pax_enabled: "false", pos_mypos_enabled: "false" };

function queryData(queryKey: readonly unknown[]): unknown {
  const key = String(queryKey[0] ?? "");
  if (key === "settings") return settings;
  if (key === "reservations-map") return [];
  if (key === "customers-all") return [];
  if (key.startsWith("category-modifiers")) return [];
  return [];
}
type QueryResult<T> = { data: T; refetch: () => Promise<{ data: T }> };
const queryResults = new Map<string, QueryResult<unknown>>();
const queryClient = { invalidateQueries: async (_filters?: unknown) => undefined };
const tablesResult = { data: tables };
const orderResult = { data: order };
const categoriesResult = { data: categories };
const productsResult = { data: products };
const authResult = { user: { id: 1, name: "Marco Rossi", role: "admin" }, logout: () => undefined };

export function useQuery<T = unknown>(options: { queryKey: readonly unknown[]; queryFn?: () => Promise<unknown>; enabled?: boolean; staleTime?: number; refetchInterval?: number }): QueryResult<T> {
  const cacheKey = JSON.stringify(options.queryKey);
  let result = queryResults.get(cacheKey);
  if (!result) {
    const data = queryData(options.queryKey);
    result = { data, refetch: async () => ({ data: queryData(options.queryKey) }) };
    queryResults.set(cacheKey, result);
  }
  return result as QueryResult<T>;
}
export function useQueryClient() { return queryClient; }
export function useGetTablesStatus() { return tablesResult; }
export function useGetOrder(_id: number, _options?: unknown) { return orderResult; }
export function useListCategories() { return categoriesResult; }
export function useListProducts(_options?: unknown) { return productsResult; }
export function getGetTablesStatusQueryKey() { return ["tables-status"] as const; }
export function getGetOrderQueryKey(id: number) { return ["order", id] as const; }
export function getListOrdersQueryKey() { return ["orders"] as const; }
function noMutation() { return { mutateAsync: async (_args?: unknown) => undefined, mutate: () => undefined, isPending: false }; }
export const useAddOrderItem = noMutation;
export const useUpdateOrderItem = noMutation;
export const useDeleteOrderItem = noMutation;
export const useCreatePayment = noMutation;
export function useAuth() { return authResult; }
export function Link({ href: _href, children, ...props }: { href?: string; children?: ReactNode; [key: string]: unknown }) {
  return <a href="#" {...props}>{children}</a>;
}

export async function sandboxFetch(input: RequestInfo | URL, _init?: RequestInit): Promise<Response> {
  const url = String(input);
  let payload: unknown = {};
  if (url.includes("/products/")) {
    const id = Number(url.split("/products/")[1]?.split(/[/?]/)[0]);
    payload = products.find((product) => product.id === id) ?? null;
  } else if (url.endsWith("/orders")) {
    payload = { id: 104, tableId: 4, covers: 4 };
  } else if (url.includes("/invoices")) {
    payload = { id: 1, number: "24", year: new Date().getFullYear() };
  } else if (url.includes("/pos/sale")) {
    payload = { success: true, message: "Operazione dimostrativa" };
  } else if (url.includes("/vies")) {
    payload = { valid: true, name: "" };
  }
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
    blob: async () => new Blob(),
    headers: new Headers(),
  } as Response;
}
