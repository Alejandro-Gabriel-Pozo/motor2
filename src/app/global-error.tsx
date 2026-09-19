"use client";

import { useEffect } from "react";

/**
 * Último recurso: se cae la estructura misma de la aplicación (el layout raíz). Reemplaza al documento completo, por eso trae su
 * propio `<html>` y `<body>` y estilos en línea: los estilos globales (Tailwind) no se cargan en esta pantalla. Los errores de
 * cada sección los toma `(app)/error.tsx`, que conserva el menú; esta casi nunca se ve.
 */
export default function ErrorGlobal({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="es">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "2rem 1rem", display: "flex", justifyContent: "center" }}>
        <div role="alert" style={{ maxWidth: "28rem" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: "0 0 0.75rem" }}>Algo falló</h1>
          <p style={{ fontSize: "0.875rem", color: "#737373", margin: "0 0 1rem" }}>
            No se perdió nada de lo que ya estaba guardado. Probá de nuevo; si vuelve a pasar, avisale a un admin
            {error.digest ? ` y pasale este código: ${error.digest}` : ""}.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{ background: "#171717", color: "#fff", border: 0, borderRadius: "0.25rem", padding: "0.5rem 1rem", cursor: "pointer" }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
