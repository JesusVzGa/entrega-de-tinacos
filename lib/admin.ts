import type { AppSession } from "./app-session";
export function isAdmin(user: AppSession | null) {
  return user?.role === "admin";
}
