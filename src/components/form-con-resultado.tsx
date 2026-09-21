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
      // `onSubmit` y no `action={fn}`: React 19 resetea los campos de un <form action> tras CADA envío, aun con error, y la persona tenía que
      // volver a escribir todo para corregir una letra. Acá el formulario se limpia solo cuando la acción salió bien.
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const formData = new FormData(form);
        setResultado(null);
        startTransition(async () => {
          const r = await accion(formData);
          setResultado(r);
          if (r.ok) form.reset();
        });
      }}
    >
      {children}
      {/* role: un lector de pantalla anuncia el resultado sin que la persona tenga que ir a buscarlo (error → alert, ok → status). */}
      {resultado && (
        <p role={resultado.ok ? "status" : "alert"} className={`text-sm ${resultado.ok ? "text-green-700" : "text-red-600"}`}>
          {resultado.mensaje}
        </p>
      )}
    </form>
  );
}
