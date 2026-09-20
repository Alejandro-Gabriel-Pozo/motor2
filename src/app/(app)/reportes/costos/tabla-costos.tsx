"use client";

import { EnlaceInterno } from "@/components/enlace-interno";
import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import type { FilaCostoProducto, FilaImpactoInsumo } from "@/core/reportes/costos";
import { resolverAccionFaltante } from "@/core/reportes/accion-faltante";

const LABEL_ESTADO: Record<string, string> = {
  MARGEN_NEGATIVO: "Margen negativo",
  FOOD_COST_ALTO: "Food cost alto",
  COSTO_INCOMPLETO: "Costo incompleto",
  SIN_PRECIO_VENTA: "Sin precio de venta",
  SIN_RECETA: "Sin receta",
  OK: "OK",
};

const AYUDA_MARGEN = "Margen $ = Precio venta − Costo. Margen % = Margen $ / Precio venta × 100.";
const AYUDA_FOOD_COST =
  "Food cost % = (Costo de comida y bebida) / Precio venta × 100 — qué porción del precio de venta se va en insumos. NO incluye el packaging ni la limpieza de la receta (los insumos del grupo «No comestibles»): esos cuentan en el Costo y en el Margen, pero no en el food cost.";
const AYUDA_ESTADO =
  "Margen negativo: el costo supera el precio de venta. Food cost alto: el costo de comida y bebida (sin el packaging ni la limpieza del grupo «No comestibles») supera el 40% del precio de venta (umbral fijo, no configurable). Costo incompleto: algún insumo de la receta no tiene compra registrada. Sin receta / Sin precio de venta: falta ese dato para poder calcular.";

const COLUMNAS_PRODUCTOS: ColumnaReporte<FilaCostoProducto>[] = [
  {
    clave: "producto",
    etiqueta: "Producto",
    valor: (p) => `${p.productoCodigo} — ${p.productoNombre}`,
    render: (p) => (
      <EnlaceInterno href={`/reportes/historial?productoId=${p.productoId}`} className="underline">
        {p.productoCodigo} — {p.productoNombre}
      </EnlaceInterno>
    ),
  },
  { clave: "precioVenta", etiqueta: "Precio venta", alinear: "derecha", valor: (p) => p.precioVenta, render: (p) => `$${p.precioVenta.toLocaleString("es-AR")}` },
  { clave: "costo", etiqueta: "Costo", alinear: "derecha", valor: (p) => p.costo, render: (p) => (p.costo === null ? "—" : `$${p.costo.toLocaleString("es-AR")}`) },
  {
    clave: "margen",
    etiqueta: "Margen",
    ayuda: AYUDA_MARGEN,
    alinear: "derecha",
    valor: (p) => p.margen,
    render: (p) => (p.margen === null ? "—" : `$${p.margen.toLocaleString("es-AR")} (${p.margenPct}%)`),
  },
  {
    clave: "foodCost",
    etiqueta: "Food cost %",
    ayuda: AYUDA_FOOD_COST,
    alinear: "derecha",
    valor: (p) => p.foodCostPct,
    render: (p) => (p.foodCostPct === null ? "—" : `${p.foodCostPct}%`),
  },
  {
    clave: "estado",
    etiqueta: "Estado",
    ayuda: AYUDA_ESTADO,
    valor: (p) => LABEL_ESTADO[p.estado],
    render: (p) => {
      const accion = resolverAccionFaltante(p);
      if (accion) {
        return (
          <EnlaceInterno href={accion.href} className="text-amber-600 underline">
            {accion.etiqueta}
          </EnlaceInterno>
        );
      }
      return <span className={p.estado === "OK" ? "" : "text-amber-600"}>{LABEL_ESTADO[p.estado]}</span>;
    },
  },
];

const COLUMNAS_INSUMOS: ColumnaReporte<FilaImpactoInsumo>[] = [
  { clave: "insumo", etiqueta: "Insumo", valor: (i) => i.insumoNombre, render: (i) => i.insumoNombre },
  { clave: "platos", etiqueta: "Platos", alinear: "derecha", valor: (i) => i.cantidadPlatos, render: (i) => i.cantidadPlatos },
  {
    clave: "costoAcumulado",
    etiqueta: "Costo acumulado",
    alinear: "derecha",
    valor: (i) => i.costoAcumulado,
    render: (i) => `$${i.costoAcumulado.toLocaleString("es-AR")}`,
  },
  {
    clave: "costoUnitario",
    etiqueta: "Costo unitario",
    alinear: "derecha",
    valor: (i) => i.costoUnitario,
    render: (i) => (i.costoUnitario === null ? "—" : `$${i.costoUnitario.toLocaleString("es-AR")}`),
  },
  { clave: "proveedor", etiqueta: "Proveedor", valor: (i) => i.proveedorNombre ?? "", render: (i) => i.proveedorNombre ?? "—" },
];

export function TablaCostosProductos({ filas }: { filas: FilaCostoProducto[] }) {
  return <TablaReporte columnas={COLUMNAS_PRODUCTOS} filas={filas} claveFila={(p) => p.productoId} nombreExport="costos-y-margenes" />;
}

export function TablaImpactoInsumos({ filas }: { filas: FilaImpactoInsumo[] }) {
  return <TablaReporte columnas={COLUMNAS_INSUMOS} filas={filas} claveFila={(i) => i.insumoProductoId} nombreExport="impacto-insumos" />;
}
