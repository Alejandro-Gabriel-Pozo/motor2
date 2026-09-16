"use client";

import { useState, useTransition, type ReactNode } from "react";
import type { ResultadoAccion } from "@/server/actions/tipos";

/**
 * Envoltorio para <form action={...}> que llaman una mutación tipo
 * ResultadoAccion — el `<form action={async (formData) => { "use server";
 * await accion(...) }}>` crudo no tiene ningún lugar donde mostrar ok:false,
 * así que un error queda invisible (nada cambia en la página, no hay
 * mensaje). Este wrapper es la mínima pieza cliente necesaria para mostrar
 * SIEMPRE el resultado, sin tocar la firma de las server actions.
 */
export function FormConResultado({
  accion,
  children,
  className,
}: {
  accion: (formData: FormData) => Promise<ResultadoAccion>;
  children: ReactNode;
  className?: string;
}) {
  const [resultado, setResultado] = useState<ResultadoAccion | null>(null);
  const [, startTransition] = useTransition();

  return (
    <form
      className={className}
      action={(formData: FormData) => {
        setResultado(null);
        startTransition(async () => {
          setResultado(await accion(formData));
        });
      }}
    >
      {children}
      {resultado && <p className={`text-sm ${resultado.ok ? "text-green-700" : "text-red-600"}`}>{resultado.mensaje}</p>}
    </form>
  );
}
