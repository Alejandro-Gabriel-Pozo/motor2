"use client";

import { createContext, use, useRef, useState, useTransition, type ReactNode } from "react";
import type { ResultadoAccion } from "@/server/actions/tipos";

type Publicar = (resultado: ResultadoAccion | null) => void;

const ContextoDeAvisos = createContext<Publicar | null>(null);

/**
 * Un único aviso compartido para pantallas con MUCHOS formularios chicos (la matriz de capacidades: una celda por acción × sucursal), donde
 * un mensaje por formulario rompería la grilla. Es lo que `FormConResultado` es para un formulario suelto: hace visible el `ResultadoAccion` que
 * un `<form action>` crudo descartaba.
 *
 * El aviso va FIJO en la pantalla (no en el flujo): así no empuja la tabla justo bajo el cursor al aparecer y se ve aunque la celda tocada esté
 * lejos del tope. Se cierra a mano y se reemplaza con la acción siguiente. Lleva role="alert" (error) o "status" (ok) para que un lector de
 * pantalla lo anuncie.
 *
 * `className` va al contenedor de la pantalla (que así no necesita un `<div>` extra). El aviso se renderiza ANTES que el contenido a propósito:
 * si el contenedor usa `space-y-*`, un hijo fijo al FINAL le daría margen inferior al contenido y lo movería al aparecer.
 */
export function AvisosDeAccion({ children, className }: { children: ReactNode; className?: string }) {
  const [resultado, setResultado] = useState<ResultadoAccion | null>(null);

  return (
    <ContextoDeAvisos.Provider value={setResultado}>
      <div className={className}>
        {resultado && (
          <div className="fixed bottom-4 left-1/2 z-50 flex max-w-md -translate-x-1/2 items-start gap-3 rounded border bg-background px-4 py-3 text-sm shadow-lg">
            <p role={resultado.ok ? "status" : "alert"} className={resultado.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
              {resultado.mensaje}
            </p>
            <button type="button" onClick={() => setResultado(null)} className="underline">
              Cerrar
            </button>
          </div>
        )}
        {children}
      </div>
    </ContextoDeAvisos.Provider>
  );
}

/** `<form>` que publica el resultado de su acción en el `AvisosDeAccion` que lo envuelve. Mismo contrato que `FormConResultado`. */
export function FormConAviso({
  accion,
  children,
  className,
}: {
  accion: (formData: FormData) => Promise<ResultadoAccion>;
  children: ReactNode;
  className?: string;
}) {
  const publicar = use(ContextoDeAvisos);
  if (!publicar) throw new Error("FormConAviso tiene que ir dentro de <AvisosDeAccion>.");
  const [pendiente, startTransition] = useTransition();
  const enviando = useRef(false);

  return (
    <form
      className={className}
      aria-busy={pendiente || undefined}
      action={(formData: FormData) => {
        if (enviando.current) return;
        enviando.current = true;
        publicar(null);
        startTransition(async () => {
          try {
            publicar(await accion(formData));
          } finally {
            enviando.current = false;
          }
        });
      }}
    >
      {children}
    </form>
  );
}
