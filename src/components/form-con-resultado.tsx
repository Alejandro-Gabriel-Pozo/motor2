"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { useGrupoDeFormularios } from "./grupo-de-formularios";

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
 *
 * Feedback mientras guarda (pendiente #44, 2026-09-30): `aria-busy` en el <form>, «Guardando…» con role="status" (un único lugar para el mensaje: mientras
 * guarda ese, después el resultado) y una guarda síncrona contra el doble envío. El botón NO se deshabilita de verdad: un botón con foco que pasa a
 * `disabled` lo pierde (el foco cae en <body>) y habría que tocar los usos; la regla de `globals.css` (`form[aria-busy="true"] [type="submit"]`) lo
 * atenúa y le pone cursor de espera. `useFormStatus` no sirve acá: solo sigue a un `<form action>` y este usa `onSubmit` a propósito (ver abajo).
 *
 * Dentro de un `GrupoDeFormularios` (O.2, opcional: sin grupo nada de esto existe y el formulario se comporta como siempre): mientras OTRO formulario del
 * grupo guarda, este no envía y avisa «Esperá a que termine de guardarse el cambio anterior.» (role="status", en el mismo lugar del mensaje); el aviso se va
 * solo cuando el grupo queda libre. Tampoco acá se deshabilita el botón (mismo motivo que arriba). Mientras este guarda, el grupo entero queda ocupado.
 */
const AVISO_GRUPO_OCUPADO ="Esperá a que termine de guardarse el cambio anterior.";

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
  const [pendiente, startTransition] = useTransition();
  const enviando = useRef(false);
  const refResultado = useRef<HTMLParagraphElement>(null);
  const grupo = useGrupoDeFormularios();
  // La ronda del grupo en la que se rechazó un envío por estar ocupado (ver `GrupoDeFormularios`): el aviso se muestra mientras siga siendo la misma.
  const [esperaEnRonda, setEsperaEnRonda] = useState<number | null>(null);
  const liberarGrupo = useRef<(() => void) | null>(null);

  // El mensaje está al pie del form y puede quedar fuera de vista: se trae a la vista (sin animar, respeta "reducir movimiento"). Depende de `pendiente` porque el <p> del resultado recién existe cuando termina la transición.
  useEffect(() => {
    if (resultado && !pendiente) refResultado.current?.scrollIntoView({ block: "nearest" });
  }, [resultado, pendiente]);

  // Si el formulario desaparece mientras guarda (p. ej. la fila que se quitó), el grupo no puede quedar ocupado para siempre: se libera al desmontar
  // (liberar dos veces no descuenta de más).
  useEffect(() => () => liberarGrupo.current?.(), []);

  const enEspera = grupo !== null && esperaEnRonda === grupo.ronda;

  return (
    <form
      className={className}
      aria-busy={pendiente || undefined}
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
        if (enviando.current) return;
        // Otro formulario del grupo está guardando: este no envía (saldría con lo que la pantalla mostraba ANTES de ese cambio) y avisa.
        if (grupo?.hayOtroGuardando()) {
          setResultado(null);
          setEsperaEnRonda(grupo.ronda);
          return;
        }
        setEsperaEnRonda(null);
        enviando.current = true;
        liberarGrupo.current = grupo?.ocupar() ?? null;
        const form = e.currentTarget;
        const formData = new FormData(form);
        setResultado(null);
        startTransition(async () => {
          try {
            const r = await accion(formData);
            setResultado(r);
            if (r.ok) form.reset();
          } finally {
            enviando.current = false;
            liberarGrupo.current?.();
            liberarGrupo.current = null;
          }
        });
      }}
    >
      {children}
      {/* role: un lector de pantalla anuncia el resultado sin que la persona tenga que ir a buscarlo (error → alert, ok → status). */}
      {pendiente ? (
        <p role="status" className="text-sm text-neutral-600 dark:text-neutral-400">
          Guardando…
        </p>
      ) : enEspera ? (
        <p role="status" className="text-sm text-neutral-600 dark:text-neutral-400">
          {AVISO_GRUPO_OCUPADO}
        </p>
      ) : (
        resultado && (
          <p ref={refResultado} role={resultado.ok ? "status" : "alert"} className={`text-sm ${resultado.ok ? "text-green-700" : "text-red-600"}`}>
            {resultado.mensaje}
          </p>
        )
      )}
    </form>
  );
}
