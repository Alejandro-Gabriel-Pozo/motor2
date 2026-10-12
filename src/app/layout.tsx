import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Las fuentes salen del repo (`src/fonts/`, licencia OFL), no de fonts.googleapis.com: el build no depende de la red de Google. Son los mismos archivos
// woff2 (variables, subconjunto latin) que bajaba el cargador de Google con `subsets: ["latin"]`.
// OJO con los nombres: `next/font/local` toma el nombre del `font-family` del identificador de la constante, y los e2e miran el `font-family` calculado (`/Geist/`).
const Geist = localFont({
  src: [{ path: "../fonts/Geist-latin.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-geist-sans",
  display: "swap",
  adjustFontFallback: "Arial",
});

const GeistMono = localFont({
  src: [{ path: "../fonts/GeistMono-latin.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-geist-mono",
  display: "swap",
  adjustFontFallback: "Arial",
});

export const metadata: Metadata = {
  title: "Motor2",
  description: "ERP de inventario/stock/ventas — administración",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="es"
      className={`${Geist.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
