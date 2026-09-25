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
 *
 * Enter en un <input> de texto NO envía (hallazgo del dueño, 2026-09-25): sin esto, escribir en "Nombre" y apretar Enter por
 * costumbre guarda de verdad, sin haber tocado "Guardar" — el comportamiento por defecto del navegador (Enter en un input
 * dentro de un <form> con botón de submit = submit). Un <textarea> sigue aceptando Enter como salto de línea (nunca envía
 * solo), y el botón "Guardar" sigue respondiendo a Enter/Space cuando el foco está en él (navegación por teclado).
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
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        const el = e.target as HTMLElement;
        if (el.tagName === "TEXTAREA" || (el.tagName === "BUTTON" && (el as HTMLButtonElement).type === "submit")) return;
        e.preventDefault();
      }}
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
