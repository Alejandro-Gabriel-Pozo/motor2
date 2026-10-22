"use client";

import { useEffect } from "react";
import { Boton } from "@/ui/primitivas/boton";
import { Enlace } from "@/ui/primitivas/enlace";

/**
 * Pantalla de error de cualquier sección de la aplicación (dentro del menú y la barra: solo se cae el contenido). Sin esto, un
 * fallo al armar una pantalla (la base no contesta un momento, un dato inesperado) mostraba la página de error genérica de Next,
 * sin menú y sin salida. Acá se explica en criollo, se puede reintentar y se puede volver al inicio.
 *
 * `retry()` vuelve a pedirle al servidor lo que se rompió (en esta versión de Next reemplaza a `reset()`). No se muestra el
 * mensaje del error: en producción Next lo esconde a propósito y el `digest` es el código para buscarlo en los logs.
 */
export default function ErrorDeLaAplicacion({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="max-w-md space-y-3">
      <h1 className="text-xl font-semibold">Algo falló al abrir esta pantalla</h1>
      <p className="text-sm text-tinta-suave">
        No se perdió nada de lo que ya estaba guardado. Puede ser un corte momentáneo de la conexión: probá de nuevo. Si vuelve a pasar, avisale a
        un admin{error.digest ? ` y pasale este código: ${error.digest}` : ""}.
      </p>
      <div className="flex items-center gap-3">
        <Boton onClick={() => retry()}>Reintentar</Boton>
        <Enlace href="/">Ir al inicio</Enlace>
      </div>
    </div>
  );
}
