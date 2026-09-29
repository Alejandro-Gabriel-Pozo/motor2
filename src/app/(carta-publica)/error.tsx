"use client";

import { useEffect } from "react";

/**
 * Pantalla de error de la carta pública (ADR-006), clon de `(app)/error.tsx` adaptado al tono público (sin mencionar
 * "admin"). `retry()` reemplaza a `reset()` en esta versión de Next. No se muestra el mensaje del error: en producción
 * Next lo esconde y el `digest` es el código para buscarlo en los logs.
 */
export default function ErrorDeLaCarta({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-xl font-semibold">No se pudo abrir la carta</h1>
      <p className="text-sm opacity-70">
        Puede ser un corte momentáneo de la conexión: probá de nuevo en un momento{error.digest ? ` (código: ${error.digest})` : ""}.
      </p>
      <button type="button" onClick={() => retry()} className="rounded-full px-5 py-2 text-sm" style={{ backgroundColor: "var(--carta-ink, #1c1b19)", color: "#fff" }}>
        Reintentar
      </button>
    </div>
  );
}
