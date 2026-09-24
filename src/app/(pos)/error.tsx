"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Pantalla de error del salón (módulo POS, clon de `(app)/error.tsx`: dentro del encabezado del salón, solo se cae el contenido). Sin esto, un
 * fallo al armar una pantalla (la base no contesta un momento, un dato inesperado) mostraba la página de error genérica de Next,
 * sin menú y sin salida. Acá se explica en criollo, se puede reintentar y se puede volver al inicio.
 *
 * `retry()` vuelve a pedirle al servidor lo que se rompió (en esta versión de Next reemplaza a `reset()`). No se muestra el
 * mensaje del error: en producción Next lo esconde a propósito y el `digest` es el código para buscarlo en los logs.
 */
export default function ErrorDelSalon({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="max-w-md space-y-3">
      <h1 className="text-xl font-semibold">Algo falló al abrir esta pantalla</h1>
      <p className="text-sm text-[var(--ink-soft)]">
        No se perdió nada de lo que ya estaba guardado. Puede ser un corte momentáneo de la conexión: probá de nuevo. Si vuelve a pasar, avisale a
        un admin{error.digest ? ` y pasale este código: ${error.digest}` : ""}.
      </p>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => retry()} className="rounded bg-[var(--ink)] px-4 py-2 text-white">
          Reintentar
        </button>
        <Link href="/" className="text-sm underline">
          Ir al inicio
        </Link>
      </div>
    </div>
  );
}
