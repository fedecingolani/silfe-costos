import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Charoli Gestión",
  description: "Sistema de gestión: costos, ventas, facturación y cobranzas",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
