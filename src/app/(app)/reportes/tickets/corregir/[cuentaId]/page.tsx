import Link from "next/link";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { requierePermisoVer } from "@/server/acceso/gate";
import { listarTicketsEmitidos } from "@/server/consultas/reportes/tickets-emitidos";
import { formatearMonto, rotuloDePuesto, formatearNumeroTicket } from "@/core/pos/public";
import { formatearFechaHora } from "@/core/tiempo/zona-horaria";
import { CorregirTicketMaqueta } from "./corregir-ticket-maqueta";

/**
 * MAQUETA (rama temporal, no se mergea): «Corregir un ticket», PASO 2 de 2 — otra página. En escritorio va en dos columnas (el ticket original congelado a la izquierda; el corregido, con el resumen y el motivo,
 * a la derecha) para que no quede una sola columna larga. Muestra y calcula; NO guarda.
 */
export default async function CorregirTicketPagina({ params }: { params: Promise<{ cuentaId: string }> }) {
  const { cuentaId } = await params;
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "reporte_tickets", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const { items } = await listarTicketsEmitidos(ctx.sucursalId, {}, ctx.db);
  const ejemplares = items.filter((t) => t.cuentaId === cuentaId);
  const ticket = ejemplares.find((t) => t.esUltimoEjemplar) ?? ejemplares[0];
  if (!ticket) return <p className="text-error">No encontramos ese ticket en esta sucursal.</p>;
  const numero = formatearNumeroTicket(ticket.numero);
  const siguiente = formatearNumeroTicket({ numero: ticket.numero.numero, ejemplar: ticket.numero.ejemplar + 1 });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/reportes/tickets/corregir" className="text-sm underline">
          ← Volver a la búsqueda
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Corregir el ticket N.º {numero}</h1>
        <ol className="flex gap-4 text-sm" aria-label="Pasos">
          <li className="text-tinta-tenue">1. Buscar el ticket</li>
          <li className="font-semibold">2. Corregirlo</li>
        </ol>
        <p className="mt-1 text-sm text-tinta-tenue">
          {rotuloDePuesto(ticket.mesaNumero)} · emitido {formatearFechaHora(ticket.emitidoEn, ctx.empresaZonaHoraria)} · atendió {ticket.detalle.mesero} · total {formatearMonto(ticket.importe)}
        </p>
      </div>
      {ticket.reemplazadaPor ? (
        <p className="rounded border p-3 text-sm">
          Este ejemplar ya fue reemplazado por el N.º {formatearNumeroTicket(ticket.reemplazadaPor)}: corregí ese, que es el vigente.
        </p>
      ) : (
        <CorregirTicketMaqueta
          numero={numero}
          siguiente={siguiente}
          estado={ticket.estado}
          lineas={ticket.detalle.lineas.map((l) => ({
            producto: l.detalle ?? l.producto,
            cantidad: l.cantidad,
            subtotal: l.subtotal,
            indentado: Boolean(l.indentado),
            quitable: l.operacionId !== null && !l.indentado,
          }))}
        />
      )}
    </div>
  );
}
