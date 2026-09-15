"use client";

import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";

interface FilaTopImporte {
  producto?: string;
  proveedor?: string;
  importe: number;
}
interface FilaStockBajo {
  producto: string;
  seccion: string;
  saldo: number;
}

const COLUMNAS_TOP_PRODUCTOS: ColumnaReporte<FilaTopImporte>[] = [
  { clave: "producto", etiqueta: "Producto", valor: (p) => p.producto ?? "", render: (p) => p.producto },
  { clave: "importe", etiqueta: "Importe", alinear: "derecha", valor: (p) => p.importe, render: (p) => `$${p.importe.toLocaleString("es-AR")}` },
];

const COLUMNAS_TOP_PROVEEDORES: ColumnaReporte<FilaTopImporte>[] = [
  { clave: "proveedor", etiqueta: "Proveedor", valor: (p) => p.proveedor ?? "", render: (p) => p.proveedor },
  { clave: "importe", etiqueta: "Importe", alinear: "derecha", valor: (p) => p.importe, render: (p) => `$${p.importe.toLocaleString("es-AR")}` },
];

const COLUMNAS_STOCK_BAJO: ColumnaReporte<FilaStockBajo>[] = [
  { clave: "producto", etiqueta: "Producto", valor: (s) => s.producto, render: (s) => s.producto },
  { clave: "seccion", etiqueta: "Sección", valor: (s) => s.seccion, render: (s) => s.seccion },
  {
    clave: "saldo",
    etiqueta: "Saldo",
    alinear: "derecha",
    valor: (s) => s.saldo,
    render: (s) => <span className={s.saldo < 0 ? "text-red-600" : ""}>{s.saldo}</span>,
  },
];

export function TablaTopProductos({ filas }: { filas: FilaTopImporte[] }) {
  return (
    <TablaReporte
      columnas={COLUMNAS_TOP_PRODUCTOS}
      filas={filas}
      claveFila={(p, i) => `${p.producto}-${i}`}
      sinFilasTexto="Sin ventas todavía este mes."
      nombreExport="top-productos-mes"
    />
  );
}

export function TablaTopProveedores({ filas }: { filas: FilaTopImporte[] }) {
  return (
    <TablaReporte
      columnas={COLUMNAS_TOP_PROVEEDORES}
      filas={filas}
      claveFila={(p, i) => `${p.proveedor}-${i}`}
      sinFilasTexto="Sin compras todavía este mes."
      nombreExport="top-proveedores-mes"
    />
  );
}

export function TablaStockBajo({ filas }: { filas: FilaStockBajo[] }) {
  return (
    <TablaReporte
      columnas={COLUMNAS_STOCK_BAJO}
      filas={filas}
      claveFila={(s, i) => `${s.producto}-${s.seccion}-${i}`}
      sinFilasTexto="Sin productos en 0 o negativo."
      nombreExport="stock-bajo"
    />
  );
}
