import { formatearMonto } from "@/core/formato-de-numero";
import { fechaParaMostrar } from "@/core/tiempo/fecha-para-mostrar";
import { ZONA_ARGENTINA, diaDeCalendario } from "@/core/tiempo/zona-horaria";
import type { LineaDelHistorialDePrecios } from "@/core/catalogo/public";

/**
 * «Historial de precios» de la pestaña «Precios» de la ficha (Frente 6, paso 7; dueño, 2026-11-17: «A»: quien ve el catálogo ve fechas y precios, sin el nombre de quien cambió el precio). Una lista de los CAMBIOS,
 * el más reciente primero: la fecha (DD/MM/AAAA, día de Argentina) y «de $X a $Y». Lo que falta se dice («Todavía no hay cambios registrados»), nunca se inventa: el precio con el que nació el producto y los
 * precios por opción no figuran (ver `core/catalogo/historial-de-precios.ts`). Componente de SERVIDOR; el dinero sale de `formatearMonto`.
 */
export function HistorialDePrecios({ cambios, sucursalNombre }: { cambios: readonly LineaDelHistorialDePrecios[]; sucursalNombre: string }) {
  return (
    <section aria-labelledby="titulo-historial-de-precios" data-historial-de-precios="" className="flex flex-col gap-2 rounded border border-borde p-4">
      <h2 id="titulo-historial-de-precios" className="text-sm font-medium">
        Historial de precios
      </h2>
      {cambios.length === 0 ? (
        <p className="text-sm text-tinta-suave">Todavía no hay cambios de precio registrados.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-borde text-sm">
          {cambios.map((c, i) => (
            <li key={i} data-cambio-de-precio="" className="flex flex-col gap-0.5 py-2">
              <span className="text-tinta-suave">
                {fechaParaMostrar(diaDeCalendario(c.creadoEn, ZONA_ARGENTINA))} · {c.alcance === "lista" ? "Precio de lista" : `Precio en «${sucursalNombre}»`}
              </span>
              <span className="tabular-nums">{c.anterior === null ? `Se fijó en ${formatearMonto(c.nuevo)}` : `de ${formatearMonto(c.anterior)} a ${formatearMonto(c.nuevo)}`}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-tinta-tenue">Muestra los últimos cambios del precio de lista y los de esta sucursal. No incluye el precio con el que se cargó el producto ni los precios de cada opción.</p>
    </section>
  );
}
