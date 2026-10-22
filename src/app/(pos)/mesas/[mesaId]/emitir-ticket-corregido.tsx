"use client";

import { useState } from "react";
import { type TicketDeCuenta, formatearNumeroTicket, formatearMonto } from "@/core/pos/public";
import { emitirTicketCorregido } from "@/server/actions/pos/cuenta-cierre";
import { Dialogo } from "@/ui/componentes/superposiciones/dialogo";
import { AreaDeTexto } from "@/ui/primitivas/area-de-texto";
import { Boton } from "@/ui/primitivas/boton";
import { useImpresion } from "./imprimir";
import { useAccionMesa } from "./usar-accion";

/**
 * «Emitir ticket corregido» en una fila de «Cuentas cerradas» (docs/plan-numeracion-ticket-2026-09-25.md, Fase 2): cuando después de
 * imprimir el ticket se anuló parte de la venta (una línea, desde Trazabilidad), el ticket quedó desactualizado. Diálogo con el motivo,
 * obligatorio (lo valida el servidor y su mensaje se muestra acá, `role="alert"`); el motivo queda en pantalla y en la auditoría, no se
 * imprime. Al salir bien pide imprimir el ejemplar que emitió el servidor (mismo número, letra siguiente).
 *
 * Habilitado solo con el ticket «desactualizada» y numerado, y con `pos_cerrar_cuenta` Editar; si no, deshabilitado con un `title` que
 * dice por qué.
 */
export function EmitirTicketCorregido({ ticket, hora, puede }: { ticket: TicketDeCuenta; hora: string; puede: boolean }) {
  const { ejecutar, pending, error, setError } = useAccionMesa();
  const { pedir } = useImpresion();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");

  const numero = ticket.numero ? formatearNumeroTicket(ticket.numero) : null;
  const bloqueo =
    ticket.estado === "anulada"
      ? "La venta se anuló entera: no hay ticket que corregir."
      : ticket.estado === "vigente"
        ? "El ticket ya refleja las anulaciones: no hay nada que corregir."
        : numero === null
          ? "Esta cuenta se cerró antes de la numeración de tickets: no tiene ticket que corregir."
          : puede
            ? null
            : "Emitir el ticket corregido requiere un permiso propio, que tu rol no tiene.";

  const abrir = () => {
    setMotivo("");
    setError(null);
    setAbierto(true);
  };
  const cerrar = () => {
    if (!pending) setAbierto(false);
  };

  return (
    <>
      <Boton
        variante="secundario"
        tamano="chico"
        disabled={bloqueo !== null}
        title={bloqueo ?? undefined}
        aria-label={`Emitir el ticket corregido de la cuenta cerrada a las ${hora}`}
        onClick={abrir}
      >
        Emitir ticket corregido
      </Boton>

      <Dialogo abierto={abierto} titulo={`Emitir ticket corregido · N.º ${numero}`} onCerrar={cerrar} cerrable={!pending}>
        <p className="mb-4 text-sm text-tinta-suave">
          Después de imprimir el ticket se anuló parte de la venta. La corregida sale con el mismo número y la letra siguiente, solo con lo que sigue vendido.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ejecutar(
              () => emitirTicketCorregido(ticket.cuentaId, motivo),
              (r) => {
                setAbierto(false);
                pedir({ tipo: "ticket-correccion", cuentaId: ticket.cuentaId, ejemplar: r.ejemplar });
              }
            );
          }}
          className="flex flex-col gap-3"
        >
          <div className="flex items-baseline justify-between rounded-lg bg-papel px-3 py-2">
            <span className="text-sm font-semibold">Total corregido</span>
            <span className="text-xl font-extrabold tabular-nums">{formatearMonto(ticket.total)}</span>
          </div>
          <AreaDeTexto etiqueta="Motivo (obligatorio)" data-foco-inicial="" maxLength={200} aria-required="true" value={motivo} onChange={(e) => setMotivo(e.target.value)} error={error} />
          <div className="mt-1 flex justify-end gap-2">
            <Boton variante="secundario" onClick={cerrar}>
              Cancelar
            </Boton>
            <Boton type="submit" variante="acento" disabled={pending}>
              {pending ? "Emitiendo…" : "Emitir e imprimir"}
            </Boton>
          </div>
        </form>
      </Dialogo>
    </>
  );
}
