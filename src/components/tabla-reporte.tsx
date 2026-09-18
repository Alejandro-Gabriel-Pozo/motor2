"use client";

import { useMemo, useState } from "react";
import { AyudaIcono } from "@/components/ayuda-campo";
// Solo el tipo (se borra al compilar): importar el módulo de verdad traería la librería de Excel a la carga inicial.
import type { TipoFecha } from "@/core/excel";

export interface ColumnaReporte<T> {
  clave: string;
  etiqueta: string;
  render: (fila: T) => React.ReactNode;
  /** Si se da, la columna ordena Y este valor entra al Excel exportado. Si no, la columna queda fija (ej. una columna de link/acción). */
  valor?: (fila: T) => string | number | null;
  /** Si se da, el `valor` (texto ISO) se exporta a Excel como una fecha real y no como texto. El orden sigue usando el texto ISO. Ver `TipoFecha`. */
  tipoFecha?: TipoFecha;
  alinear?: "derecha";
  /** Icono "?" junto al header, para explicar un criterio no obvio (ej. cómo se calcula un estado) sin ocupar espacio permanente. */
  ayuda?: string;
}

interface Props<T> {
  columnas: ColumnaReporte<T>[];
  filas: T[];
  claveFila: (fila: T, indice: number) => string;
  sinFilasTexto?: string;
  /** Si se da, muestra el botón "Exportar Excel" y ese es el nombre del archivo (sin extensión). */
  nombreExport?: string;
  ordenInicial?: string;
  direccionInicial?: "asc" | "desc";
}

/**
 * Tabla compartida para /reportes/* — hallazgo de la diligencia de motor2
 * vs. ERPNext/Dolibarr: encabezados sin orden, sin exportar, sin filtros
 * reales. Acá resuelve orden (client-side, sobre los datos ya traídos —
 * no hace falta re-consultar el server) y export a Excel (.xlsx, ver
 * `core/excel.ts`: los números viajan como números, así que abre bien con
 * cualquier configuración regional, cosa que un CSV no garantiza).
 */
export function TablaReporte<T>({ columnas, filas, claveFila, sinFilasTexto = "Sin datos.", nombreExport, ordenInicial, direccionInicial = "asc" }: Props<T>) {
  const [ordenPor, setOrdenPor] = useState<string | null>(ordenInicial ?? null);
  const [direccion, setDireccion] = useState<"asc" | "desc">(direccionInicial);
  const [exportando, setExportando] = useState(false);
  const [errorExport, setErrorExport] = useState<string | null>(null);

  const filasOrdenadas = useMemo(() => {
    if (!ordenPor) return filas;
    const columna = columnas.find((c) => c.clave === ordenPor);
    if (!columna?.valor) return filas;
    const copia = [...filas];
    copia.sort((a, b) => {
      const va = columna.valor!(a);
      const vb = columna.valor!(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "es");
      return direccion === "asc" ? cmp : -cmp;
    });
    return copia;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `columnas` se recrea en cada render del padre; comparar por ordenPor/direccion alcanza.
  }, [filas, ordenPor, direccion]);

  function alHacerClicEncabezado(clave: string, ordenable: boolean) {
    if (!ordenable) return;
    if (ordenPor === clave) setDireccion((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setOrdenPor(clave);
      setDireccion("asc");
    }
  }

  async function exportarExcel() {
    if (exportando) return;
    setExportando(true);
    setErrorExport(null);
    try {
      const exportables = columnas.filter((c) => c.valor);
      // La librería se carga recién al exportar: no pesa en la carga de la página.
      const { generarExcel, nombreDeArchivo } = await import("@/core/excel");
      const blob = await generarExcel(
        nombreExport ?? "Reporte",
        exportables.map((c) => c.etiqueta),
        filasOrdenadas.map((f) => exportables.map((c) => c.valor!(f))),
        exportables.map((c) => c.tipoFecha)
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${nombreDeArchivo(nombreExport ?? "reporte")}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      // Caso típico: falla la carga diferida de la librería (red caída, o un deploy nuevo cambió el chunk con la página abierta).
      console.error("[tabla-reporte] no se pudo exportar a Excel", e);
      setErrorExport("No se pudo generar el archivo. Recargá la página e intentá de nuevo.");
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {nombreExport && (
        <div className="flex flex-col items-end gap-0.5 self-end">
          <button
            type="button"
            onClick={exportarExcel}
            disabled={exportando}
            className="text-xs text-neutral-500 underline hover:text-neutral-900 disabled:cursor-wait disabled:opacity-60"
          >
            {exportando ? "Exportando…" : "Exportar Excel"}
          </button>
          {errorExport && (
            <p role="alert" className="text-xs text-red-600">
              {errorExport}
            </p>
          )}
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-neutral-500">
            {columnas.map((c) => (
              <th
                key={c.clave}
                onClick={() => alHacerClicEncabezado(c.clave, Boolean(c.valor))}
                className={`px-2 py-1 first:pl-0 ${c.valor ? "cursor-pointer select-none hover:text-neutral-900" : ""} ${c.alinear === "derecha" ? "text-right" : ""}`}
              >
                {c.etiqueta}
                {ordenPor === c.clave ? (direccion === "asc" ? " ▲" : " ▼") : ""}
                {c.ayuda && (
                  <span onClick={(e) => e.stopPropagation()}>
                    <AyudaIcono texto={c.ayuda} />
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filasOrdenadas.map((f, i) => (
            <tr key={claveFila(f, i)} className="border-b">
              {columnas.map((c) => (
                <td key={c.clave} className={`px-2 py-1 first:pl-0 ${c.alinear === "derecha" ? "text-right" : ""}`}>
                  {c.render(f)}
                </td>
              ))}
            </tr>
          ))}
          {!filasOrdenadas.length && (
            <tr>
              <td className="py-1 text-neutral-500" colSpan={columnas.length}>
                {sinFilasTexto}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
