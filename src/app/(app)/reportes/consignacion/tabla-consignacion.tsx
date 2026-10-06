"use client";

import { EnlaceInterno } from "@/components/enlace-interno";
import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import { RegistrarPagoConsignante } from "./registrar-pago-consignante";
import type { FilaDebidoConsignante, FilaStockSinVenderConsignacion } from "@/core/reportes/public";

const COLUMNAS_DEBIDO: ColumnaReporte<FilaDebidoConsignante>[] = [
  { clave: "proveedor", etiqueta: "Proveedor", valor: (d) => d.proveedor, render: (d) => d.proveedor },
  { clave: "liquidado", etiqueta: "Liquidado", alinear: "derecha", valor: (d) => d.liquidado, render: (d) => `$${d.liquidado.toLocaleString("es-AR")}` },
  { clave: "pagado", etiqueta: "Pagado", alinear: "derecha", valor: (d) => d.pagado, render: (d) => `$${d.pagado.toLocaleString("es-AR")}` },
  { clave: "importe", etiqueta: "Saldo debido", alinear: "derecha", valor: (d) => d.importe, render: (d) => `$${d.importe.toLocaleString("es-AR")}` },
  {
    clave: "accion",
    etiqueta: "",
    render: (d) =>
      d.proveedorId ? <RegistrarPagoConsignante proveedorId={d.proveedorId} proveedorNombre={d.proveedor} saldoActual={d.importe} /> : null,
  },
];

const COLUMNAS_STOCK: ColumnaReporte<FilaStockSinVenderConsignacion>[] = [
  {
    clave: "producto",
    etiqueta: "Producto",
    valor: (s) => `${s.codigo} — ${s.producto}`,
    render: (s) => (
      <EnlaceInterno href={`/reportes/historial?productoId=${s.productoId}`} className="underline">
        {s.codigo} — {s.producto}
      </EnlaceInterno>
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
      sinFilasTexto="Ningún producto disponible acá está marcado como consignación."
      nombreExport="stock-consignacion"
    />
  );
}
