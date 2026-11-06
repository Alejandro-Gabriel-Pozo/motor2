"use client";

import { useState } from "react";
import { type TicketDeCuenta, formatearNumeroTicket, formatearMonto } from "@/core/pos/public";
import { corregirLineaDeTicket } from "@/server/actions/pos/cuenta-cierre";
import { Dialogo } from "@/ui/componentes/superposiciones/dialogo";
import { AreaDeTexto } from "@/ui/primitivas/area-de-texto";
import { Boton } from "@/ui/primitivas/boton";
import { OpcionesExcluyentes } from "@/ui/primitivas/opciones-excluyentes";
import { useImpresion } from "./imprimir";
import { useAccionMesa } from "./usar-accion";

/**
 * «Corregir una línea» en una fila de «Cuentas cerradas» (E0 de la corrección por ajuste, docs/diseno-correccion-por-ajuste-2026-11-06.md): UN diálogo con la
 * línea a corregir, el motivo (obligatorio) y un botón. Al confirmar, en una sola operación del servidor, se anula la línea ENTERA, se guarda el motivo en la
 * venta y se emite el ticket corregido (mismo número, ejemplar siguiente), que se manda a imprimir. Reemplaza el recorrido de tres pantallas (anular en
 * Trazabilidad y después «Emitir ticket corregido»). Una promo se corrige entera y un adicional va con su producto.
 *
 * La clave de reintento (I3) nace al ABRIR el diálogo y se reenvía tal cual en cada intento: un doble clic o un corte de red no corrigen dos veces. Se manda
 * también el ejemplar y el total que la persona está viendo: si otra persona corrigió en el medio, el servidor lo rechaza y la fila se refresca.
 *
 * Habilitado solo con ticket numerado, no anulado entero, con las dos permisos (`anular_venta` y `pos_emitir_ticket_corregido`) y con más de una línea vigente
 * (la última no se corrige: queda «Anular venta» en Trazabilidad); si no, deshabilitado con un `title` que dice por qué.
 */
export function CorregirLinea({ ticket, hora, puede }: { ticket: TicketDeCuenta; hora: string; puede: boolean }) {
  const { ejecutar, pending, error, setError } = useAccionMesa();
  const { pedir } = useImpresion();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [operacionId, setOperacionId] = useState<string | null>(null);
  const [clave, setClave] = useState("");

  const numero = ticket.numero ? formatearNumeroTicket(ticket.numero) : null;
  const bloqueo =
    ticket.estado === "anulada"
      ? "La venta se anuló entera: no hay ticket que corregir."
      : ticket.numero === null
        ? "Esta cuenta se cerró antes de la numeración de tickets: no tiene ticket que corregir."
        : !puede
          ? "Corregir una línea requiere los permisos de anular ventas y de emitir el ticket corregido, que tu rol no tiene."
          : ticket.corregibles.length < 2
            ? "Es la única línea que sigue vendida: para anular toda la venta usá «Anular venta» en Trazabilidad."
            : null;

  const abrir = () => {
    setMotivo("");
    setOperacionId(null);
    setClave(crypto.randomUUID());
    setError(null);
    setAbierto(true);
  };
  const cerrar = () => {
    if (!pending) setAbierto(false);
  };

  return (
    <>
      <Boton variante="secundario" tamano="compacto" disabled={bloqueo !== null} title={bloqueo ?? undefined} aria-label={`Corregir una línea de la cuenta cerrada a las ${hora}`} onClick={abrir}>
        Corregir una línea
      </Boton>

      <Dialogo abierto={abierto} titulo={`Corregir una línea · N.º ${numero}`} onCerrar={cerrar} cerrable={!pending}>
        <p className="mb-4 text-sm text-tinta-suave">
          La línea se anula entera y sale un ticket corregido con el mismo número y la letra siguiente. Lo que ya se imprimió no se toca.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!operacionId || !ticket.numero) return;
            ejecutar(
              () => corregirLineaDeTicket(ticket.cuentaId, operacionId, motivo, ticket.numero!.ejemplar, ticket.total, clave),
              (r) => {
                setAbierto(false);
                pedir({ tipo: "ticket-correccion", cuentaId: ticket.cuentaId, ejemplar: r.ejemplar });
              }
            );
          }}
          className="flex flex-col gap-3"
        >
          <OpcionesExcluyentes
            leyenda="Línea a corregir"
            nombre={`linea-a-corregir-${ticket.cuentaId}`}
            presentacion="tarjetas"
            alCambiar={setOperacionId}
            opciones={ticket.corregibles.map((l) => ({
              valor: l.operacionId,
              etiqueta: (
                <span className="flex w-full items-baseline justify-between gap-3">
                  <span>{l.texto}</span>
                  <span className="tabular-nums">{formatearMonto(l.subtotal)}</span>
                </span>
              ),
            }))}
          />
          <div className="flex items-baseline justify-between rounded-lg bg-papel px-3 py-2">
            <span className="text-sm font-semibold">Total del ticket hoy</span>
            <span className="text-xl font-extrabold tabular-nums">{formatearMonto(ticket.total)}</span>
          </div>
          <AreaDeTexto etiqueta="Motivo (obligatorio)" maxLength={200} aria-required="true" value={motivo} onChange={(e) => setMotivo(e.target.value)} error={error} />
          <div className="mt-1 flex justify-end gap-2">
            <Boton variante="secundario" onClick={cerrar}>
              Cancelar
            </Boton>
            <Boton type="submit" variante="acento" disabled={pending || !operacionId || !motivo.trim()}>
              {pending ? "Corrigiendo…" : "Corregir e imprimir"}
            </Boton>
          </div>
        </form>
      </Dialogo>
    </>
  );
}
