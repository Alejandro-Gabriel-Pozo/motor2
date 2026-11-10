import type { UltimaCotizacion } from "@/core/reportes/public";
import { pesosADolares } from "@/core/reportes/public";
import { formatearDolares, formatearMonto } from "@/core/formato-de-numero";

const formatoFecha = (f: Date) => f.toISOString().slice(0, 10).split("-").reverse().join("/");

/** Texto que explica de dónde sale un importe en dólares: la cotización y su fecha. */
function textoCotizacion(c: UltimaCotizacion): string {
  return `Dólar ${c.fuente === "BNA" ? "oficial Banco Nación" : "BCRA"} (venta) ${formatearMonto(c.venta)} del ${formatoFecha(c.fecha)}`;
}

/**
 * Un importe en pesos expresado en dólares a la cotización más reciente guardada («≈ US$ 1.234,56»). No muestra nada si todavía no
 * hay cotización. Es una conversión de hoy, no la del día de cada operación: el aviso lo dice al pasar el mouse.
 */
export function EnDolares({ pesos, cotizacion, className }: { pesos: number; cotizacion: UltimaCotizacion | null; className?: string }) {
  if (!cotizacion) return null;
  const usd = pesosADolares(pesos, cotizacion.venta);
  return (
    <span className={className ?? "text-xs text-tinta-tenue"} title={`${textoCotizacion(cotizacion)}. Conversión a la cotización de hoy, no a la del día de cada operación.`}>
      ≈ US$ {formatearDolares(usd)}
    </span>
  );
}

/** Cotización para el encabezado: «USD BNA compra / venta · fecha». */
export function CotizacionEncabezado({ cotizacion }: { cotizacion: UltimaCotizacion | null }) {
  if (!cotizacion) return null;
  const valor = formatearMonto;
  return (
    <span className="whitespace-nowrap" title={textoCotizacion(cotizacion)} data-cotizacion-dolar="">
      USD {cotizacion.fuente}: {cotizacion.compra !== null ? `${valor(cotizacion.compra)} / ` : ""}
      {valor(cotizacion.venta)} · {formatoFecha(cotizacion.fecha).slice(0, 5)}
    </span>
  );
}
