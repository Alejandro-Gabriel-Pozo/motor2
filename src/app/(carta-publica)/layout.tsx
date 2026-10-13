import type { Metadata } from "next";
import { clasesFuentesCarta } from "@/components/carta-publica/fuente-carta";

// Marca: el título y la descripción del documento raíz (`src/app/layout.tsx`) son los de la aplicación de administración y NO tienen que verse en la parte pública. Esto es lo que
// queda cuando una página no define los suyos: el 404 de una carta que no existe, la pantalla de error, una carta sin datos. Las páginas con datos (`portal` y `sucursal`) los pisan con los de la
// marca y la sucursal, por `generateMetadata`. Neutro a propósito: ni el nombre de la aplicación ni ningún otro.
export const metadata: Metadata = {
  title: "Carta",
  description: "Carta digital.",
};

/**
 * ADR-006 (`docs/adr/ADR-006-carta-como-modulo-interno.md`): layout de la carta pública — SIN sesión, distinto del de
 * `(app)`/`(pos)` (que exigen login). `.carta-shell` trae sus propios tokens de color (`src/app/globals.css`), igual
 * patrón que `.pos-shell`. Anidado dentro del `<html>`/`<body>` del layout raíz (`src/app/layout.tsx`) — no reemplaza el
 * documento, solo agrega las fuentes de la carta y el scope de estilos. Sin alto/overflow forzados acá: el portal scrollea
 * normal, y solo la carta de una sucursal (con su slider) fuerza `h-svh overflow-hidden` en su propia página.
 */
export default function CartaPublicaLayout({ children }: { children: React.ReactNode }) {
  return <div className={`carta-shell ${clasesFuentesCarta}`}>{children}</div>;
}
