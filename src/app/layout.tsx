import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Silfe Costos",
  description: "Costeo de productos para cosecha de fruta",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
