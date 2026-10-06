"use client";

import { IconoDeAccion } from "@/components/iconos";
import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import type { FilaCompraHistorial, ResumenCompras } from "@/core/reportes/historial-vistas";
import { EnlaceInterno } from "@/components/enlace-interno";

function armarProsa(r: ResumenCompras, unidad: string, mostrarDinero: boolean): string {
  if (r.cantidadCompras === 0) return "Sin compras en el rango elegido.";
  const partes: string[] = [`Se compró ${r.cantidadCompras} ${r.cantidadCompras === 1 ? "vez" : "veces"} en el rango elegido`];
  if (r.medianaCantidad !== null) partes.push(`casi siempre ${r.medianaCantidad} ${unidad}`);
  if (r.comprasPorSemana !== null) partes.push(`${r.comprasPorSemana} vez(veces) por semana`);
  if (r.proveedores.length === 1) partes.push(`siempre a ${r.proveedores[0]}`);
  else if (r.proveedores.length > 1) partes.push(`a ${r.proveedores.length} proveedores distintos`);
  if (mostrarDinero && r.precioMin !== null && r.precioMax !== null) {
    partes.push(r.precioMin === r.precioMax ? `siempre a $${r.precioMin.toLocaleString("es-AR")}` : `entre $${r.precioMin.toLocaleString("es-AR")} y $${r.precioMax.toLocaleString("es-AR")}`);
  }
  return `${partes[0]}: ${partes.slice(1).join(", ")}.`;
}

function columnas(mostrarDinero: boolean): ColumnaReporte<FilaCompraHistorial>[] {
  const base: ColumnaReporte<FilaCompraHistorial>[] = [
    { clave: "fecha", etiqueta: "Fecha", tipoFecha: "dia", valor: (f) => f.fecha.toISOString().slice(0, 10), render: (f) => f.fecha.toISOString().slice(0, 10) },
    { clave: "cantidad", etiqueta: "Cantidad", alinear: "derecha", valor: (f) => f.cantidad, render: (f) => f.cantidad },
  ];
  if (mostrarDinero) {
    // Proveedor y N.º de factura son datos comerciales: van con la misma clave que el dinero (el servidor ya los saca de los eventos).
    base.splice(
      1,
      0,
      { clave: "proveedor", etiqueta: "Proveedor", valor: (f) => f.proveedor, render: (f) => f.proveedor ?? <span className="text-neutral-500 dark:text-neutral-400">Sin proveedor</span> },
      { clave: "factura", etiqueta: "N.º de factura", valor: (f) => f.nroFactura, render: (f) => f.nroFactura ?? "—" }
    );
    base.push(
      { clave: "precio", etiqueta: "Precio por unidad de stock", alinear: "derecha", valor: (f) => f.precioPorUnidadStock, render: (f) => (f.precioPorUnidadStock !== null ? `$${f.precioPorUnidadStock.toLocaleString("es-AR")}` : "—") },
      {
        clave: "variacion",
        etiqueta: "Variación vs. la compra anterior",
        alinear: "derecha",
        valor: (f) => f.variacionPct,
        render: (f) => (f.variacionPct === null ? "—" : `${f.variacionPct > 0 ? "+" : ""}${f.variacionPct}%`),
      }
    );
  }
  base.push({
    clave: "origen",
    etiqueta: "Origen",
    render: (f) =>
      f.idOperacion ? (
        <EnlaceInterno href={`/reportes/trazabilidad?idOperacion=${encodeURIComponent(f.idOperacion)}`} className="underline inline-flex items-center gap-1">
          <IconoDeAccion id="ver" />
          Ver operación
        </EnlaceInterno>
      ) : null,
  });
  return base;
}

/** "Cómo se compró" (MP) — §4, decisiones 1-3. Prosa de resumen + tabla, EXCLUYE anuladas (ver resumirCompras). */
export function ComoSeCompro({ resumen, unidad, mostrarDinero }: { resumen: ResumenCompras; unidad: string; mostrarDinero: boolean }) {
  return (
    <div className="mb-4">
      <h3 className="mb-2 text-sm font-medium">Cómo se compró</h3>
      <p className="mb-2 text-sm text-neutral-600 dark:text-neutral-400">{armarProsa(resumen, unidad, mostrarDinero)}</p>
      <TablaReporte columnas={columnas(mostrarDinero)} filas={resumen.filas} claveFila={(f, i) => `${f.fecha.toISOString()}-${i}`} sinFilasTexto="Sin compras en el rango elegido." nombreExport="como-se-compro" />
    </div>
  );
}
