"use client";

import Link from "next/link";
import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import type { FilaDebidoConsignante, FilaStockSinVenderConsignacion } from "@/core/reportes/consignacion";

const COLUMNAS_DEBIDO: ColumnaReporte<FilaDebidoConsignante>[] = [
  { clave: "proveedor", etiqueta: "Proveedor", valor: (d) => d.proveedor, render: (d) => d.proveedor },
  { clave: "importe", etiqueta: "Importe", alinear: "derecha", valor: (d) => d.importe, render: (d) => `$${d.importe.toLocaleString("es-AR")}` },
];

const COLUMNAS_STOCK: ColumnaReporte<FilaStockSinVenderConsignacion>[] = [
  {
    clave: "producto",
    etiqueta: "Producto",
    valor: (s) => `${s.codigo} — ${s.producto}`,
    render: (s) => (
      <Link href={`/reportes/historial?productoId=${s.productoId}`} className="underline">
        {s.codigo} — {s.producto}
      </Link>
    ),
  },
  { clave: "consignante", etiqueta: "Consignante", valor: (s) => s.proveedorConsignacionNombre ?? "", render: (s) => s.proveedorConsignacionNombre ?? "—" },
  {
    clave: "stock",
    etiqueta: "Stock actual",
    alinear: "derecha",
    valor: (s) => s.stockActual,
    render: (s) => <span className={s.stockActual <= 0 ? "text-red-600" : ""}>{s.stockActual}</span>,
  },
];

export function TablaDebidoConsignante({ filas }: { filas: FilaDebidoConsignante[] }) {
  return (
    <TablaReporte
      columnas={COLUMNAS_DEBIDO}
      filas={filas}
      claveFila={(d, i) => `${d.proveedor}-${i}`}
      sinFilasTexto="Sin liquidaciones de consignación registradas."
      nombreExport="debido-consignacion"
    />
  );
}

export function TablaStockSinVenderConsignacion({ filas }: { filas: FilaStockSinVenderConsignacion[] }) {
  return (
    <TablaReporte
      columnas={COLUMNAS_STOCK}
      filas={filas}
      claveFila={(s) => s.productoId}
      sinFilasTexto="Ningún producto activo está marcado como consignación."
      nombreExport="stock-consignacion"
    />
  );
}
