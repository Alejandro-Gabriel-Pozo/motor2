import type { ReactNode } from "react";

/**
 * Contenedor del contenido de una pantalla: ancho máximo de 80 rem (1280 px) centrado y relleno de 16 px en celular y 24 px desde `md` (`RELLENO_DEL_CONTENIDO`,
 * `ANCHO_MAXIMO_DEL_CONTENIDO` de `reglas.ts`). Lo dibuja el `AppShell` una sola vez: las pantallas NO lo repiten.
 */
export function ContenedorDePagina({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[80rem] p-4 md:p-6">{children}</div>;
}
