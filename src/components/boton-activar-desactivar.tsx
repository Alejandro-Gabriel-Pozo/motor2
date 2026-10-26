"use client";

import { useEffect, useId, useRef, useState } from "react";
import { IconoDeAccion } from "@/components/iconos";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";

/**
 * «Activar» / «Desactivar» de una fila de administración (roles, usuarios).
 * Activar aplica directo. Desactivar corta un acceso, así que pide confirmación
 * en la misma fila: primero «Desactivar», después «Sí, desactivar» / «Cancelar».
 * Sin diálogo del navegador (`window.confirm`): así se ve dentro de la página,
 * se puede probar con Playwright sin manejar diálogos y no lo bloquea el navegador.
 *
 * Teclado y lector de pantalla: al abrir la confirmación el foco va a «Cancelar»
 * (lo seguro por defecto en una acción destructiva), el aviso se anuncia
 * (`role="alert"`) y ambos botones lo leen como descripción (el foco cae en «Cancelar»,
 * y algunos lectores no anuncian una alerta que aparece ya con texto), Escape cancela
 * y al cancelar el foco vuelve a «Desactivar».
 */
export function BotonActivarDesactivar({
  activo,
  ocupado,
  aviso,
  onCambiar,
}: {
  activo: boolean;
  /** Hay una llamada al servidor en curso para esta fila. */
  ocupado: boolean;
  /** Qué implica desactivar; se muestra junto a la confirmación. */
  aviso: string;
  onCambiar: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [activoPrevio, setActivoPrevio] = useState(activo);
  const idAviso = useId();
  // `Boton` no recibe `ref` (su tipo es el de los atributos del <button>): el foco se maneja por `id`.
  const idDesactivar = `${idAviso}-desactivar`;
  const idCancelar = `${idAviso}-cancelar`;
  const volverAlBoton = useRef(false);

  // Si el estado de la fila cambia desde afuera (otra pestaña, otro usuario), la confirmación
  // abierta ya no aplica: sin esto reaparecería sola cuando la fila vuelva a estar activa.
  if (activo !== activoPrevio) {
    setActivoPrevio(activo);
    setConfirmando(false);
  }

  const mostrarConfirmacion = activo && confirmando;

  useEffect(() => {
    if (mostrarConfirmacion) {
      document.getElementById(idCancelar)?.focus();
    } else if (volverAlBoton.current) {
      volverAlBoton.current = false;
      document.getElementById(idDesactivar)?.focus();
    }
  }, [mostrarConfirmacion, idCancelar, idDesactivar]);

  function cancelar() {
    volverAlBoton.current = true;
    setConfirmando(false);
  }

  if (ocupado) return <span className="text-sm text-tinta-suave">...</span>;

  if (!activo) {
    return (
      <Boton variante="enlace" tamano="en-fila" onClick={onCambiar}>
        <IconoDeAccion id="activar" />
        Activar
      </Boton>
    );
  }

  if (!mostrarConfirmacion) {
    return (
      <Boton id={idDesactivar} variante="enlace" tamano="en-fila" onClick={() => setConfirmando(true)}>
        <IconoDeAccion id="activar" />
        Desactivar
      </Boton>
    );
  }

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1"
      onKeyDown={(evento) => {
        if (evento.key === "Escape") cancelar();
      }}
    >
      <Aviso id={idAviso} variante="error" forma="en-linea">
        {aviso}
      </Aviso>
      <Boton
        variante="enlace-peligro"
        tamano="en-fila"
        aria-describedby={idAviso}
        onClick={() => {
          setConfirmando(false);
          onCambiar();
        }}
      >
        Sí, desactivar
      </Boton>
      <Boton id={idCancelar} variante="enlace" tamano="en-fila" aria-describedby={idAviso} onClick={cancelar}>
        Cancelar
      </Boton>
    </div>
  );
}
