"use client";

import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import type { BaseDeCantidad } from "@/core/catalogo/public";
import { desvioEsNotable, rotuloDeBase } from "@/core/reportes/public";
import { textoDe } from "@/core/textos/texto-de";

export interface ValorPorSucursalPlano {
  cantidad: number;
  mermaPorcentaje: number;
  bruto: number;
  calibrado: boolean;
  recetaPropia: boolean;
  desviacionPorcentaje: number | null;
}

export interface FilaComparacionPlana {
  productoId: string;
  productoNombre: string;
  recetaIngredienteId: string;
  /** M3d: la base de la línea; el valor del tooltip está escrito en ella («Neto»/«Bruto»). */
  baseDeCantidad: BaseDeCantidad;
  insumoNombre: string;
  unidadNombre: string;
  central: { cantidad: number; mermaPorcentaje: number; bruto: number };
  /** `porSucursal` como objeto plano (id → valor) — un `Map` no cruza bien el límite server/cliente en todos los casos, y no hace falta acá. */
  porSucursal: Record<string, ValorPorSucursalPlano>;
}

function celdaValor(v: ValorPorSucursalPlano | undefined, unidadNombre: string, base: BaseDeCantidad) {
  if (!v) return <span className="text-tinta-tenue">—</span>;
  if (v.recetaPropia) return <span className="text-xs text-tinta-tenue">Receta propia de la sucursal</span>;
  return (
    <span
      className={desvioEsNotable(v.desviacionPorcentaje) ? "font-medium text-aviso-tinta" : ""}
      title={`${rotuloDeBase(base)}: ${v.cantidad} ${unidadNombre} · Merma: ${v.mermaPorcentaje}%`}
    >
      {v.bruto} {unidadNombre}
      {v.calibrado && <span className="ml-1 text-xs font-normal text-tinta-tenue">(calibrado)</span>}
      {!v.calibrado && <span className="ml-1 text-xs font-normal text-tinta-tenue">(sin calibrar)</span>}
    </span>
  );
}

export function TablaPorSucursal({ filas, sucursales }: { filas: FilaComparacionPlana[]; sucursales: { id: string; nombre: string }[] }) {
  const columnas: ColumnaReporte<FilaComparacionPlana>[] = [
    {
      clave: "producto",
      etiqueta: "Plato",
      valor: (f) => f.productoNombre,
      render: (f) => f.productoNombre,
    },
    {
      clave: "insumo",
      etiqueta: textoDe("columna.insumo"),
      valor: (f) => f.insumoNombre,
      render: (f) => f.insumoNombre,
    },
    {
      clave: "central",
      etiqueta: "Central (bruto)",
      alinear: "derecha",
      valor: (f) => f.central.bruto,
      render: (f) => (
        <span title={`${rotuloDeBase(f.baseDeCantidad)}: ${f.central.cantidad} ${f.unidadNombre} · Merma: ${f.central.mermaPorcentaje}%`}>
          {f.central.bruto} {f.unidadNombre}
        </span>
      ),
    },
    ...sucursales.map(
      (s): ColumnaReporte<FilaComparacionPlana> => ({
        clave: `sucursal-${s.id}`,
        etiqueta: s.nombre,
        alinear: "derecha",
        valor: (f) => f.porSucursal[s.id]?.bruto ?? null,
        render: (f) => celdaValor(f.porSucursal[s.id], f.unidadNombre, f.baseDeCantidad),
      })
    ),
  ];

  return (
    <TablaReporte
      columnas={columnas}
      filas={filas}
      claveFila={(f) => f.recetaIngredienteId}
      sinFilasTexto="Nada para comparar todavía con este filtro."
      nombreExport="rendimiento-por-sucursal"
    />
  );
}
