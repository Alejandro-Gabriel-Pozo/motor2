"use client";

import Link from "next/link";
import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import type { FilaCostoProducto, FilaImpactoInsumo } from "@/core/reportes/costos";

const LABEL_ESTADO: Record<string, string> = {
  MARGEN_NEGATIVO: "Margen negativo",
  FOOD_COST_ALTO: "Food cost alto",
  COSTO_INCOMPLETO: "Costo incompleto",
  SIN_PRECIO_VENTA: "Sin precio de venta",
  SIN_RECETA: "Sin receta",
  OK: "OK",
};

const AYUDA_MARGEN = "Margen $ = Precio venta − Costo. Margen % = Margen $ / Precio venta × 100.";
const AYUDA_FOOD_COST = "Food cost % = Costo / Precio venta × 100 — qué porción del precio de venta se va en insumos.";
const AYUDA_ESTADO =
  "Margen negativo: el costo supera el precio de venta. Food cost alto: el costo supera el 40% del precio de venta (umbral fijo, no configurable). Costo incompleto: algún insumo de la receta no tiene compra registrada. Sin receta / Sin precio de venta: falta ese dato para poder calcular.";

const COLUMNAS_PRODUCTOS: ColumnaReporte<FilaCostoProducto>[] = [
  {
    clave: "producto",
    etiqueta: "Producto",
    valor: (p) => `${p.productoCodigo} — ${p.productoNombre}`,
    render: (p) => (
      <Link href={`/reportes/historial?productoId=${p.productoId}`} className="underline">
        {p.productoCodigo} — {p.productoNombre}
      </Link>
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
      // Cada estado de "falta un dato" linkea directo a dónde cargarlo —
      // MARGEN_NEGATIVO/FOOD_COST_ALTO/OK no son datos faltantes sino una
      // decisión de negocio (precio/receta a revisar), no hay un único
      // lugar "correcto" al que mandar.
      if (p.estado === "SIN_RECETA") {
        return (
          <Link href={`/catalogo/recetas/${p.productoId}`} className="text-amber-600 underline">
            Sin receta — cargarla
          </Link>
        );
      }
      if (p.estado === "SIN_PRECIO_VENTA") {
        return (
          <Link href={`/catalogo/productos?id=${p.productoId}`} className="text-amber-600 underline">
            Sin precio de venta — cargarlo
          </Link>
        );
      }
      if (p.estado === "COSTO_INCOMPLETO") {
        const faltantes = p.componentes.filter((c) => c.sinPrecio);
        const primero = faltantes[0];
        const etiqueta =
          faltantes.length > 1
            ? `Costo incompleto — falta precio de ${faltantes.length} insumos`
            : `Costo incompleto — falta precio de "${primero?.insumoNombre}"`;
        if (!primero) return <span className="text-amber-600">{LABEL_ESTADO[p.estado]}</span>;
        // Un insumo "Se produce" (ej. una prepizza) no se compra — su costo
        // sale de completar SU PROPIA receta, no de cargarle un precio de compra.
        const destino = primero.insumoSeProduce ? `/catalogo/recetas/${primero.insumoProductoId}` : `/movimientos/compra?productoId=${primero.insumoProductoId}`;
        return (
          <Link href={destino} className="text-amber-600 underline">
            {etiqueta}
          </Link>
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
