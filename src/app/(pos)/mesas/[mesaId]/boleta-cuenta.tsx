import type { DocumentoImprimible } from "@/core/pos/impresion";
import { formatearNumeroBoleta } from "@/core/pos/numeracion-boleta";
import { formatearCantidad, formatearFechaHora, formatearMonto } from "@/core/pos/formato";

type DocumentoDeBoleta = Extract<DocumentoImprimible, { boleta: unknown }>;

/**
 * La boleta de cierre impresa para el cliente (docs/plan-imprimir-comanda-y-boleta-2026-09-25.md, B5): solo presentación. Las líneas
 * NETAS de la venta registrada (cada una en dos renglones, pensado para 58 mm), el total y «No válido como factura». Sin forma de pago
 * ni propina (no existen en el modelo) y sin el aviso de stock negativo (información interna). Estilos de papel en src/app/globals.css.
 *
 * «Boleta N.º 566-A» en su propio renglón, debajo de la mesa (docs/plan-numeracion-boleta-2026-09-25.md): control interno, no número
 * fiscal. Una cuenta cerrada antes de la numeración no tiene número y no lleva el renglón. Un ejemplar de corrección (566-B, emitido
 * después de anular parte de la venta) sale encabezado «CORRECCIÓN» y con «Reemplaza a N.º 566-A»; su reimpresión conserva esa referencia.
 * El motivo de la corrección no se imprime (queda en pantalla y en la auditoría).
 *
 * Cliente con descuento (Task #14, docs/plan-clientes-descuento-2026-09-26.md): con `boleta.cliente`, un renglón «Cliente: X
 * (−Y% dto.)» y, en cada línea con descuento, el precio de lista tachado antes del precio cobrado — así el ticket deja registro de
 * cuánto se descontó, no solo el total final.
 */
export function BoletaCuenta({ documento, mesa, sucursal }: { documento: DocumentoDeBoleta; mesa: string; sucursal: string }) {
  const { boleta } = documento;
  return (
    <div className="ticket">
      {documento.tipo === "boleta-reimpresion" && <p className="ticket-encabezado">REIMPRESIÓN</p>}
      {documento.tipo === "boleta-correccion" && <p className="ticket-encabezado">CORRECCIÓN</p>}
      <p className="ticket-encabezado">{sucursal}</p>
      <p className="ticket-titulo">{mesa}</p>
      {boleta.numero && (
        <p className="ticket-dato" data-numero-boleta>
          Boleta N.º {formatearNumeroBoleta(boleta.numero)}
        </p>
      )}
      {boleta.corrigeA && <p className="ticket-dato">Reemplaza a N.º {formatearNumeroBoleta(boleta.corrigeA)}</p>}
      <p className="ticket-dato">Cerrada: {formatearFechaHora(boleta.cerradaEn)}</p>
      <p className="ticket-dato">Atendió: {boleta.mesero}</p>
      {boleta.cliente && (
        <p className="ticket-dato">
          Cliente: {boleta.cliente.nombre} (−{boleta.cliente.descuentoPorcentaje}% dto.)
        </p>
      )}
      <ul className="ticket-separador">
        {boleta.lineas.map((l) => (
          <li key={`${l.producto}|${l.precioUnitario}`} className="ticket-linea">
            <p className="ticket-item">
              {formatearCantidad(l.cantidad)} × {l.producto}
            </p>
            <p className="ticket-monto">
              <span>
                {l.precioListaUnitario !== undefined && <s>{formatearMonto(l.precioListaUnitario)}</s>} {formatearMonto(l.precioUnitario)} c/u
              </span>{" "}
              <span>{formatearMonto(l.subtotal)}</span>
            </p>
          </li>
        ))}
      </ul>
      <p className="ticket-total ticket-separador">
        <span>TOTAL</span> <span>{formatearMonto(boleta.total)}</span>
      </p>
      <p className="ticket-dato ticket-separador">No válido como factura</p>
    </div>
  );
}
