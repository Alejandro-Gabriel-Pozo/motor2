import { IconoDeAccion } from "@/components/iconos";
import { EnlaceInterno } from "@/components/enlace-interno";
import type { IngredienteRecetaVigente } from "@/core/reportes/public";

/**
 * Para un PV sin stock propio (`tieneStockReal(tipo, seProduce) === false`
 * — ej. "Agua mineral 500ml", que se vende pero nunca se compra: lo que se
 * compra es la MP detrás, "Agua mineral caja x12"). Reemplaza el saldo (que
 * acá es un artefacto contable sin sentido físico — unidades vendidas
 * acumuladas, no stock) por una explicación en criollo + el enlace a lo que
 * sí tiene un saldo real: su receta.
 *
 * Decisiones 7-8 de §4 (docs/planes-demo-y-claridad-reportes-2026-09-21.md)
 * y ajuste 1 del grounding externo (docs/grounding-historial-producto-mp-
 * pv-2026-09-22.md §7): ERPNext directamente PROHÍBE que un ítem así tenga
 * un asiento de stock ("Parent Item must not be a Stock Item") — acá no se
 * llega a tanto (la línea VENTA se mantiene, decisión 9: alimenta margen
 * real y ventas por producto/categoría), pero el saldo se deja de MOSTRAR
 * en los tres lugares donde salía (encabezado, gráfico, columna).
 */
export function CartelSinStockPropio({ productoId, ingredientes }: { productoId: string; ingredientes: IngredienteRecetaVigente[] }) {
  return (
    <div className="mb-4 rounded border border-neutral-300 p-4 text-sm dark:border-neutral-700">
      <p className="mb-2 font-medium">Producto de reventa: no lleva stock propio.</p>
      <p className="mb-3 text-neutral-600 dark:text-neutral-400">
        Se arma al venderse, consumiendo los ingredientes de su receta vigente — el stock real está en esos ingredientes, no en este producto.
      </p>
      {ingredientes.length > 0 ? (
        <ul className="mb-3 list-inside list-disc">
          {ingredientes.map((i) => (
            <li key={i.nombre}>
              {i.cantidad} {i.unidad} de {i.nombre}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-neutral-600 dark:text-neutral-400">Todavía no tiene una receta cargada.</p>
      )}
      <EnlaceInterno href={`/catalogo/recetas/${productoId}`} className="underline inline-flex items-center gap-1">
        <IconoDeAccion id="ver" />
        Ver receta
      </EnlaceInterno>
    </div>
  );
}
