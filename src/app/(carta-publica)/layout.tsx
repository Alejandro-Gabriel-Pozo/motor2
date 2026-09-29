import { Playfair_Display } from "next/font/google";

const playfair = Playfair_Display({ variable: "--font-carta-serif", subsets: ["latin"] });

/**
 * ADR-006 (`docs/adr/ADR-006-carta-como-modulo-interno.md`): layout de la carta pública — SIN sesión, distinto del de
 * `(app)`/`(pos)` (que exigen login). `.carta-shell` trae sus propios tokens de color (`src/app/globals.css`), igual
 * patrón que `.pos-shell`. Anidado dentro del `<html>`/`<body>` del layout raíz (`src/app/layout.tsx`) — no reemplaza el
 * documento, solo agrega la fuente serif y el scope de estilos. Sin alto/overflow forzados acá: el portal scrollea
 * normal, y solo la carta de una sucursal (con su slider) fuerza `h-svh overflow-hidden` en su propia página.
 */
export default function CartaPublicaLayout({ children }: { children: React.ReactNode }) {
  return <div className={`carta-shell ${playfair.variable}`}>{children}</div>;
}
