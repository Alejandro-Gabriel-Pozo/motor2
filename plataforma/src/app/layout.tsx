import type { Metadata } from "next";
import { connection } from "next/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "Consola de plataforma",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Cada pedido se renderiza: la CSP lleva un nonce distinto por pedido (src/proxy.ts) y las pantallas dependen de la sesión.
  await connection();
  return (
    <html lang="es">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
