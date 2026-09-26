"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import type { ResultadoAccion } from "@/server/actions/tipos";

/**
 * Un botón que, antes de hacer algo que no se puede deshacer, pide confirmación EN EL MISMO LUGAR: «Cancelar solicitud» →
 * «¿…? Consecuencia. No se puede deshacer.» + «Sí, cancelar la solicitud» / «Volver». Extraído del patrón accesible que ya usaban
 * `BotonAnularCompra` y `BotonActivarDesactivar` (docs/plan-mutaciones-controladas-2026-09-25.md, D2) — cualquier pantalla nueva que
 * confirme una acción usa este componente en vez de volver a armar el estado `confirmando` a mano.
 *
 * Sin diálogo del navegador (`window.confirm`): se ve dentro de la página y se puede probar con Playwright. Teclado y lector de pantalla:
 *  - al abrir la confirmación el foco va a «Volver»/«Cancelar» (lo seguro en una acción que no se deshace);
 *  - el aviso se anuncia (`role="alert"`) y los dos botones lo leen como descripción (`aria-describedby`): el foco cae en «Volver», y
 *    algunos lectores no anuncian una alerta que aparece ya con texto;
 *  - Escape cancela y el foco vuelve al botón que la abrió;
 *  - mientras la acción está en curso los dos botones quedan deshabilitados;
 *  - el resultado queda a la vista: `role="status"` si salió bien, `role="alert"` si no (y en ese caso el foco vuelve al disparador,
 *    para reintentar o salir).
 *
 * La clave de idempotencia (un UUID) se genera al ABRIR la confirmación y se reenvía tal cual si se reintenta desde esa misma
 * confirmación (I3, docs/auditoria-motor2-plan-i3-idempotencia-2026-09-17.md): si la respuesta se perdió, un reenvío devuelve el mensaje
 * original. Quien llama a una acción que no la usa, simplemente la ignora.
 *
 * `accion` es una función: sirve tanto en un componente cliente (cierra sobre su estado, ej. el motivo tecleado) como en una página de
 * servidor con una server action inline (mismo truco que `ActivarDesactivarFila`).
 */
export function BotonConConfirmacion({
  etiqueta,
  etiquetaAccesible,
  aviso,
  etiquetaConfirmar,
  etiquetaEnCurso,
  etiquetaVolver = "Cancelar",
  accion,
  alSalirBien,
  hecho = false,
  deshabilitado = false,
  claseDisparador = "self-start text-sm text-red-600 underline",
}: {
  /** El texto del botón que abre la confirmación: «Cancelar solicitud». */
  etiqueta: string;
  /** Nombre accesible del disparador cuando hay muchos iguales en la página (desambigua de qué fila se trata). */
  etiquetaAccesible?: string;
  /** La pregunta y su consecuencia: «¿…? Consecuencia. No se puede deshacer.» */
  aviso: ReactNode;
  /** «Sí, cancelar la solicitud». */
  etiquetaConfirmar: string;
  /** «Cancelando…» — mientras la acción está en curso. */
  etiquetaEnCurso: string;
  /** El botón seguro, que cierra la confirmación sin hacer nada. */
  etiquetaVolver?: string;
  accion: (claveIdempotencia: string) => Promise<ResultadoAccion>;
  /** Qué hacer cuando salió bien; por defecto refresca la página (`router.refresh()`). */
  alSalirBien?: (resultado: ResultadoAccion) => void;
  /** Ya aplicada: no se dibuja el botón, solo el aviso de éxito de esta sesión (con el foco puesto en él). */
  hecho?: boolean;
  /** Otra acción de la misma fila está en curso: el disparador (y la confirmación) quedan deshabilitados. */
  deshabilitado?: boolean;
  /** Para conservar el estilo del disparador de cada pantalla. */
  claseDisparador?: string;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [claveIdempotencia, setClaveIdempotencia] = useState("");
  const [resultado, setResultado] = useState<ResultadoAccion | null>(null);
  const [pending, startTransition] = useTransition();
  const idAviso = useId();
  const botonDisparador = useRef<HTMLButtonElement>(null);
  const botonVolver = useRef<HTMLButtonElement>(null);
  const avisoDeExito = useRef<HTMLParagraphElement>(null);
  const volverAlBoton = useRef(false);

  useEffect(() => {
    if (confirmando) {
      botonVolver.current?.focus();
    } else if (volverAlBoton.current) {
      volverAlBoton.current = false;
      botonDisparador.current?.focus();
    }
  }, [confirmando]);

  // Ya aplicada, el botón desaparece: el foco se lleva al aviso de éxito para que no caiga al <body>.
  useEffect(() => {
    if (hecho && resultado?.ok) avisoDeExito.current?.focus();
  }, [hecho, resultado]);

  function abrirConfirmacion() {
    setResultado(null);
    setClaveIdempotencia(crypto.randomUUID());
    setConfirmando(true);
  }

  function cancelar() {
    volverAlBoton.current = true;
    setConfirmando(false);
  }

  function confirmar() {
    startTransition(async () => {
      const r = await accion(claveIdempotencia);
      setResultado({ ok: r.ok, mensaje: r.mensaje });
      volverAlBoton.current = !r.ok;
      setConfirmando(false);
      if (r.ok) {
        if (alSalirBien) alSalirBien(r);
        else router.refresh();
      }
    });
  }

  const avisoResultado = resultado && (
    <p
      ref={resultado.ok ? avisoDeExito : undefined}
      tabIndex={resultado.ok ? -1 : undefined}
      role={resultado.ok ? "status" : "alert"}
      className={`text-sm ${resultado.ok ? "text-green-700" : "text-red-600"}`}
    >
      {resultado.mensaje}
    </p>
  );

  if (hecho) return avisoResultado || null;

  if (confirmando) {
    return (
      <div
        className="flex flex-col gap-1"
        onKeyDown={(evento) => {
          if (evento.key === "Escape") cancelar();
        }}
      >
        <p id={idAviso} role="alert" className="text-sm text-red-600">
          {aviso}
        </p>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <button
            type="button"
            aria-describedby={idAviso}
            disabled={pending || deshabilitado}
            onClick={confirmar}
            className="text-sm font-medium text-red-600 underline disabled:opacity-50"
          >
            {pending ? etiquetaEnCurso : etiquetaConfirmar}
          </button>
          <button ref={botonVolver} type="button" aria-describedby={idAviso} disabled={pending} onClick={cancelar} className="text-sm underline">
            {etiquetaVolver}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button ref={botonDisparador} type="button" aria-label={etiquetaAccesible} disabled={deshabilitado} onClick={abrirConfirmacion} className={claseDisparador}>
        {etiqueta}
      </button>
      {avisoResultado}
    </div>
  );
}
