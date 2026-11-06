import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Entrega de Tinacos",
  description: "Registro de evidencias de entrega en campo.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="es-MX"><body>{children}</body></html>;
}
