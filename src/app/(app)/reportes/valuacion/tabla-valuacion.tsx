"use client";

import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import type { FilaValuacionInventario } from "@/core/reportes/valuacion";

const COLUMNAS_CON_COSTO: ColumnaReporte<FilaValuacionInventario>[] = [
  {
    clave: "producto",
    etiqueta: "Producto",
    valor: (f) => `${f.productoCodigo} — ${f.productoNombre}`,
    render: (f) => (
      <>
        {f.productoCodigo} — {f.productoNombre}
      </>
    ),
  },
  {
    clave: "saldo",
    etiqueta: "Saldo",
    alinear: "derecha",
    valor: (f) => f.saldo,
    render: (f) => (
      <>
        {f.saldo} {f.unidadStockNombre}
      </>
    ),
  },
  { clave: "costoUnitario", etiqueta: "Costo unitario", alinear: "derecha", valor: (f) => f.costoUnitario, render: (f) => `$${f.costoUnitario!.toLocaleString("es-AR")}` },
  { clave: "valor", etiqueta: "Valor", alinear: "derecha", valor: (f) => f.valor, render: (f) => <span className="font-medium">${f.valor!.toLocaleString("es-AR")}</span> },
  { clave: "proveedor", etiqueta: "Proveedor", valor: (f) => f.proveedorNombre, render: (f) => f.proveedorNombre ?? "—" },
];

const COLUMNAS_SIN_COSTO: ColumnaReporte<FilaValuacionInventario>[] = [
  {
    clave: "producto",
    etiqueta: "Producto",
    valor: (f) => `${f.productoCodigo} — ${f.productoNombre}`,
    render: (f) => (
      <>
        {f.productoCodigo} — {f.productoNombre}
      </>
    ),
  },
  {
    clave: "saldo",
    etiqueta: "Saldo",
    alinear: "derecha",
    valor: (f) => f.saldo,
    render: (f) => (
      <>
        {f.saldo} {f.unidadStockNombre}
      </>
    ),
  },
];

export function TablaValuacionConCosto({ filas }: { filas: FilaValuacionInventario[] }) {
  return (
    <TablaReporte
      columnas={COLUMNAS_CON_COSTO}
      filas={filas}
      claveFila={(f) => f.productoId}
      sinFilasTexto="Sin stock valorizable en esta sucursal."
      nombreExport="valuacion-inventario"
      ordenInicial="valor"
      direccionInicial="desc"
    />
  );
}

export function TablaValuacionSinCosto({ filas }: { filas: FilaValuacionInventario[] }) {
  return (
    <TablaReporte
      columnas={COLUMNAS_SIN_COSTO}
      filas={filas}
      claveFila={(f) => f.productoId}
      sinFilasTexto="Todo el stock tiene costo conocido."
      nombreExport="valuacion-inventario-sin-costo"
    />
  );
}
