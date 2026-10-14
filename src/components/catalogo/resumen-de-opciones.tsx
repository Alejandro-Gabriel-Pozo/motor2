import { nombreDelTipoDeGrupo, textoDeLimites } from "@/core/opciones/public";
import { formatearMonto, type ResumenDePrecios } from "@/core/pos/public";

/** «Mediano $ 2.800», «Con leche + $ 400», «Huevo frito + $ 600 c/u», «Sin guarnición». */
function textoDeOpcion(tipo: string, o: ResumenDePrecios["grupos"][number]["opciones"][number]): string {
  if (o.precioFinal !== null) return `${o.nombre} ${formatearMonto(o.precioFinal)}`;
  if (o.diferencia === 0) return o.nombre;
  const signo = o.diferencia > 0 ? "+" : "−";
  return `${o.nombre} ${signo} ${formatearMonto(Math.abs(o.diferencia))}${tipo === "ADICIONAL" ? " c/u" : ""}`;
}

/**
 * «Así se cobra en la sucursal» (GO-2d): las opciones de un producto con el precio que calculó el SERVIDOR (`resumenDePrecios`, la misma regla que la venta). Solo dibuja: ni un
 * número se calcula acá. Lo usan la ficha del producto (solo leer) y el pie de la pantalla que edita sus opciones (se refresca al guardar). Si un grupo obligatorio se quedó sin
 * opciones disponibles, lo dice: así el producto no se puede vender hoy en esa sucursal.
 */
export function ResumenDeOpciones({ resumen, sucursalNombre }: { resumen: ResumenDePrecios; sucursalNombre: string }) {
  if (resumen.grupos.length === 0) return <p className="text-sm text-neutral-600 dark:text-neutral-400">Este producto no tiene opciones de venta: se vende con un toque, como siempre.</p>;
  const sinOpciones = resumen.grupos.filter((g) => g.cantidadMinima > 0 && g.opciones.length === 0);
  return (
    <div className="flex flex-col gap-2" data-resumen-de-opciones>
      <p className="text-sm font-medium">
        Así se cobra en «{sucursalNombre}» (precio de lista, sin descuentos){resumen.desde !== null && resumen.hayVariacion ? ` · desde ${formatearMonto(resumen.desde)}` : ""}
      </p>
      <ul className="flex flex-col gap-1 text-sm">
        {resumen.grupos.map((g) => (
          <li key={g.grupoId}>
            <span className="font-medium">{g.nombre}</span>{" "}
            <span className="text-neutral-600 dark:text-neutral-400">
              ({nombreDelTipoDeGrupo(g.tipo)} · {textoDeLimites(g.cantidadMinima, g.cantidadMaxima)})
            </span>
            : {g.opciones.length ? g.opciones.map((o) => textoDeOpcion(g.tipo, o)).join(" · ") : "ninguna opción disponible"}
          </li>
        ))}
      </ul>
      {!resumen.vendible && (
        <p role="status" className="rounded border border-amber-700 px-3 py-2 text-sm text-amber-700 dark:border-amber-600 dark:text-amber-600">
          Hoy no se puede vender en «{sucursalNombre}»
          {sinOpciones.length ? `: ${sinOpciones.map((g) => `«${g.nombre}»`).join(", ")} no tiene ninguna opción disponible (o le falta el precio).` : ": revisá los precios de sus opciones."}
        </p>
      )}
    </div>
  );
}
