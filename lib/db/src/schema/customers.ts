import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const customersTable = pgTable("customers", {
  id: serial("id").primaryKey(),
  tipo: text("tipo").notNull().default("privato"),
  ragioneSociale: text("ragione_sociale").notNull(),
  nome: text("nome"),
  cognome: text("cognome"),
  codiceFiscale: text("codice_fiscale"),
  partitaIva: text("partita_iva"),
  pec: text("pec"),
  codiceDestinatario: text("codice_destinatario").default("0000000"),
  indirizzo: text("indirizzo"),
  cap: text("cap"),
  comune: text("comune"),
  provincia: text("provincia"),
  nazione: text("nazione").default("IT"),
  telefono: text("telefono"),
  email: text("email"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCustomerSchema = createInsertSchema(customersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customersTable.$inferSelect;
