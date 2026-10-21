"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";

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
  claseDisparador = "self-start",
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
  /**
   * Clases que se SUMAN al disparador (por defecto, su ubicación en la columna). El aspecto lo da `Boton` (`enlace-peligro`); lo que una pantalla agrega acá
   * se apila encima: las que hoy pasan colores propios (la bandeja de traspasos, «Copiar la carta», la tabla de usuarios) conservan su color, borde y relleno
   * hasta que migren.
   */
  claseDisparador?: string;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [claveIdempotencia, setClaveIdempotencia] = useState("");
  const [resultado, setResultado] = useState<ResultadoAccion | null>(null);
  const [pending, startTransition] = useTransition();
  const idAviso = useId();
  // `Boton` no recibe `ref` (su tipo es el de los atributos del <button>): el foco se maneja por `id`.
  const idDisparador = `${idAviso}-disparador`;
  const idVolver = `${idAviso}-volver`;
  const avisoDeExito = useRef<HTMLDivElement>(null);
  const volverAlBoton = useRef(false);

  useEffect(() => {
    if (confirmando) {
      document.getElementById(idVolver)?.focus();
    } else if (volverAlBoton.current) {
      volverAlBoton.current = false;
      document.getElementById(idDisparador)?.focus();
    }
  }, [confirmando, idVolver, idDisparador]);

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
    <Aviso ref={resultado.ok ? avisoDeExito : undefined} tabIndex={resultado.ok ? -1 : undefined} variante={resultado.ok ? "exito" : "error"} forma="en-linea">
      {resultado.mensaje}
    </Aviso>
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
        <Aviso id={idAviso} variante="error" forma="en-linea">
          {aviso}
        </Aviso>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <Boton variante="enlace-peligro" tamano="en-fila" aria-describedby={idAviso} disabled={pending || deshabilitado} onClick={confirmar}>
            {pending ? etiquetaEnCurso : etiquetaConfirmar}
          </Boton>
          <Boton id={idVolver} variante="enlace" tamano="en-fila" aria-describedby={idAviso} disabled={pending} onClick={cancelar}>
            {etiquetaVolver}
          </Boton>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Boton id={idDisparador} variante="enlace-peligro" tamano="en-fila" aria-label={etiquetaAccesible} disabled={deshabilitado} onClick={abrirConfirmacion} className={claseDisparador}>
        {etiqueta}
      </Boton>
      {avisoResultado}
    </div>
  );
}
