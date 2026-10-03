import type { DocumentoImprimible } from "@/core/pos/impresion";
import { formatearNumeroTicket } from "@/core/pos/numeracion-ticket";
import { formatearCantidad, formatearMonto } from "@/core/pos/formato";
import { formatearFechaHora } from "@/core/tiempo/zona-horaria";

type DocumentoDeTicket = Extract<DocumentoImprimible, { ticket: unknown }>;

/**
 * El ticket de cierre impresa para el cliente (docs/plan-imprimir-comanda-y-ticket-2026-09-25.md, B5): solo presentación. Las líneas
 * NETAS de la venta registrada (cada una en dos renglones, pensado para 58 mm), el total y «No válido como factura». Sin forma de pago
 * ni propina (no existen en el modelo) y sin el aviso de stock negativo (información interna). Estilos de papel en src/app/globals.css.
 *
 * «Ticket N.º 566-A» en su propio renglón, debajo de la mesa (docs/plan-numeracion-ticket-2026-09-25.md): control interno, no número
 * fiscal. Una cuenta cerrada antes de la numeración no tiene número y no lleva el renglón. Un ejemplar de corrección (566-B, emitido
 * después de anular parte de la venta) sale encabezado «CORRECCIÓN» y con «Reemplaza a N.º 566-A»; su reimpresión conserva esa referencia.
 * El motivo de la corrección no se imprime (queda en pantalla y en la auditoría).
 *
 * Cliente con descuento (Task #14, docs/plan-clientes-descuento-2026-09-26.md): con `ticket.cliente`, un renglón «Cliente: X
 * (−Y% dto.)» y, en cada línea con descuento, el precio de lista tachado antes del precio cobrado — así el ticket deja registro de
 * cuánto se descontó, no solo el total final.
 *
 * Promo armada (Task #16, docs/plan-promo-combo-2026-09-26.md, paso 2.6/10): la cabecera («1 × Menú del día») muestra el precio
 * cobrado por la promo entera; sus componentes van indentados, SIN precio propio impreso (ya está en la cabecera). `key` incluye
 * `promoCuentaId` — dos instancias de la misma promo (o dos promos con el mismo total, por casualidad) no colisionan.
 */
export function TicketCuenta({ documento, mesa, sucursal, zonaHoraria }: { documento: DocumentoDeTicket; mesa: string; sucursal: string; zonaHoraria: string }) {
  const { ticket } = documento;
  return (
    <div className="ticket">
      {documento.tipo === "ticket-reimpresion" && <p className="ticket-encabezado">REIMPRESIÓN</p>}
      {documento.tipo === "ticket-correccion" && <p className="ticket-encabezado">CORRECCIÓN</p>}
      <p className="ticket-encabezado">{sucursal}</p>
      <p className="ticket-titulo">{mesa}</p>
      {ticket.numero && (
        <p className="ticket-dato" data-numero-ticket>
          Ticket N.º {formatearNumeroTicket(ticket.numero)}
        </p>
      )}
      {ticket.corrigeA && <p className="ticket-dato">Reemplaza a N.º {formatearNumeroTicket(ticket.corrigeA)}</p>}
      <p className="ticket-dato">Cerrada: {formatearFechaHora(ticket.cerradaEn, zonaHoraria)}</p>
      <p className="ticket-dato">Atendió: {ticket.mesero}</p>
      {ticket.cliente && (
        <p className="ticket-dato">
          Cliente: {ticket.cliente.nombre} (−{ticket.cliente.descuentoPorcentaje}% dto.)
        </p>
      )}
      <ul className="ticket-separador">
        {ticket.lineas.map((l) => (
          <li key={`${l.producto}|${l.precioUnitario}|${l.precioListaUnitario ?? ""}|${l.promoCuentaId ?? ""}`} className={`ticket-linea${l.indentado ? " ticket-linea-indentada" : ""}`}>
            <p className="ticket-item">
              {formatearCantidad(l.cantidad)} × {l.producto}
            </p>
            {!l.indentado && (
              <p className="ticket-monto">
                <span>
                  {l.precioListaUnitario !== undefined && <s>{formatearMonto(l.precioListaUnitario)}</s>} {formatearMonto(l.precioUnitario)} c/u
                </span>{" "}
                <span>{formatearMonto(l.subtotal)}</span>
              </p>
            )}
          </li>
        ))}
      </ul>
      <p className="ticket-total ticket-separador">
        <span>TOTAL</span> <span>{formatearMonto(ticket.total)}</span>
      </p>
      <p className="ticket-dato ticket-separador">No válido como factura</p>
    </div>
  );
}
