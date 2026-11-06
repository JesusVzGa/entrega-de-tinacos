import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";
export const deliveries = sqliteTable("deliveries", {
  id: text("id").primaryKey(),
  mesa: text("mesa").notNull(),
  numero: integer("numero").notNull(),
  nombre: text("nombre").notNull(),
  direccion: text("direccion").notNull(),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  precision: real("precision").notNull(),
  fecha: text("fecha").notNull(),
  userId: text("user_id").notNull(),
  operador: text("operador").notNull().default(""),
  tieneINE: integer("tiene_ine").notNull().default(0),
}, table => [uniqueIndex("mesa_numero_unique").on(table.mesa, table.numero)]);
export const appSessions = sqliteTable("app_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  role: text("role").notNull(),
  name: text("name").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
export const loginAttempts = sqliteTable("login_attempts", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  expiresAt: integer("expires_at").notNull(),
});
