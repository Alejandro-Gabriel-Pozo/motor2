import { precioMinimoPromo } from "@/core/pos/public";
import { formatearMonto } from "@/core/formato-de-numero";

/**
 * Paso 13 (opcional, no bloqueante): con los cupos YA guardados, cuánta holgura hay hoy antes de tocar el piso de $0,01 por unidad en el peor caso (D3). `guardarCuposPromoCarta` y `guardarParteDePromo` rechazan de una si un cambio lo cruza; esto avisa ANTES de intentarlo,
 * con lo que hay guardado ahora mismo (no recalcula en vivo lo que se está tipeando). Sin cupos no dice nada (la promo es informativa).
 */
export function AvisoDelPeorCaso({ titulo, precio, cupos }: { titulo: string; precio: number; cupos: { cantidadMaxima: number }[] }) {
  if (cupos.length === 0) return null;
  const unidadesEnElPeorCaso = cupos.reduce((suma, c) => suma + c.cantidadMaxima, 0);
  const minimo = precioMinimoPromo([{ cantidad: unidadesEnElPeorCaso }]);
  const holgura = precio - minimo;
  return (
    <p className="text-xs text-tinta-tenue" data-aviso-peor-caso={titulo}>
      Con los cupos de hoy, el peor caso son {unidadesEnElPeorCaso} unidad{unidadesEnElPeorCaso === 1 ? "" : "es"} y el precio mínimo permitido es {formatearMonto(minimo)}
      {holgura > 0 ? ` — hay ${formatearMonto(holgura)} de margen antes de ese piso si subís algún máximo.` : "."}
    </p>
  );
}
