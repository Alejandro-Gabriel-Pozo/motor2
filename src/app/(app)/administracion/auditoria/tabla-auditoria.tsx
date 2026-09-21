"use client";

import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";

export interface FilaAuditoria {
  id: string;
  fecha: Date;
  entidad: string;
  descripcion: string;
  valorAnterior: string | null;
  valorNuevo: string | null;
  actorNombre: string;
  sucursalNombre: string | null;
}

const COLUMNAS: ColumnaReporte<FilaAuditoria>[] = [
  { clave: "fecha", etiqueta: "Fecha", tipoFecha: "fechaHora", valor: (f) => f.fecha.toISOString(), render: (f) => f.fecha.toLocaleString("es-AR") },
  { clave: "descripcion", etiqueta: "Cambio", valor: (f) => f.descripcion, render: (f) => f.descripcion },
  { clave: "anterior", etiqueta: "Antes", valor: (f) => f.valorAnterior, render: (f) => f.valorAnterior ?? <span className="text-neutral-500 dark:text-neutral-400">—</span> },
  { clave: "nuevo", etiqueta: "Después", valor: (f) => f.valorNuevo, render: (f) => f.valorNuevo ?? <span className="text-neutral-500 dark:text-neutral-400">—</span> },
  { clave: "actor", etiqueta: "Quién", valor: (f) => f.actorNombre, render: (f) => f.actorNombre },
  { clave: "sucursal", etiqueta: "Sucursal", valor: (f) => f.sucursalNombre, render: (f) => f.sucursalNombre ?? <span className="text-neutral-500 dark:text-neutral-400">Catálogo Central</span> },
];

export function TablaAuditoria({ filas }: { filas: FilaAuditoria[] }) {
  return (
    <TablaReporte
      columnas={COLUMNAS}
      filas={filas}
      claveFila={(f) => f.id}
      sinFilasTexto="Sin cambios registrados todavía."
      nombreExport="auditoria-administrativa"
      ordenInicial="fecha"
      direccionInicial="desc"
    />
  );
}
