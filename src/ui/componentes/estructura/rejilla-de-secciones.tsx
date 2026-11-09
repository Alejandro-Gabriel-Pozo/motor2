import type { ReactNode } from "react";

/**
 * Rejilla de secciones: reparte secciones apiladas en 1 columna en celular y 2 desde `xl` (1280 px, `columnasDeLaRejilla` de `reglas.ts`). Cada hijo directo es una sección;
 * `SeccionDeRejilla completa` ocupa las dos columnas (una tabla ancha, un formulario largo) y `apilada` apila lo que lleva adentro con la separación de una pantalla de edición.
 * `items-start`: una sección alta no estira a su vecina. `min-w-0` en las secciones: una tabla con `overflow-x-auto` adentro no ensancha la columna. Orden del DOM = orden de
 * lectura y de foco (primero la columna izquierda de cada fila). `separacion="amplia"` (2 rem) para pantallas con secciones sin tarjeta; por defecto 1 rem (tarjetas).
 */
export function RejillaDeSecciones({ children, separacion = "normal" }: { children: ReactNode; separacion?: "normal" | "amplia" }) {
  return <div className={`grid grid-cols-1 items-start ${separacion === "amplia" ? "gap-8" : "gap-4"} xl:grid-cols-2`}>{children}</div>;
}

export function SeccionDeRejilla({ children, completa = false, apilada = false }: { children: ReactNode; completa?: boolean; apilada?: boolean }) {
  return <div className={`min-w-0${completa ? " xl:col-span-2" : ""}${apilada ? " flex flex-col gap-8" : ""}`}>{children}</div>;
}
