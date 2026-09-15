"use client";

import { useMemo, useState } from "react";

export interface ColumnaReporte<T> {
  clave: string;
  etiqueta: string;
  render: (fila: T) => React.ReactNode;
  /** Si se da, la columna ordena Y este valor entra al CSV exportado. Si no, la columna queda fija (ej. una columna de link/acción). */
  valor?: (fila: T) => string | number | null;
  alinear?: "derecha";
}

interface Props<T> {
  columnas: ColumnaReporte<T>[];
  filas: T[];
  claveFila: (fila: T, indice: number) => string;
  sinFilasTexto?: string;
  /** Si se da, muestra el botón "Exportar CSV" y ese es el nombre del archivo (sin extensión). */
  nombreExport?: string;
  ordenInicial?: string;
  direccionInicial?: "asc" | "desc";
}

/**
 * Tabla compartida para /reportes/* — hallazgo de la diligencia de motor2
 * vs. ERPNext/Dolibarr: encabezados sin orden, sin exportar, sin filtros
 * reales. Acá resuelve orden (client-side, sobre los datos ya traídos —
 * no hace falta re-consultar el server) y export a CSV (abrible directo en
 * Google Sheets vía Archivo → Importar, sin necesitar la API de Sheets).
 */
export function TablaReporte<T>({ columnas, filas, claveFila, sinFilasTexto = "Sin datos.", nombreExport, ordenInicial, direccionInicial = "asc" }: Props<T>) {
  const [ordenPor, setOrdenPor] = useState<string | null>(ordenInicial ?? null);
  const [direccion, setDireccion] = useState<"asc" | "desc">(direccionInicial);

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

  function exportarCsv() {
    const exportables = columnas.filter((c) => c.valor);
    const filaCsv = (valores: (string | number | null)[]) =>
      valores.map((v) => `"${(v === null || v === undefined ? "" : String(v)).replace(/"/g, '""')}"`).join(",");
    const csv = [filaCsv(exportables.map((c) => c.etiqueta)), ...filasOrdenadas.map((f) => filaCsv(exportables.map((c) => c.valor!(f))))].join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${nombreExport}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-1">
      {nombreExport && (
        <button type="button" onClick={exportarCsv} className="self-end text-xs text-neutral-500 underline hover:text-neutral-900">
          Exportar CSV
        </button>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-neutral-500">
            {columnas.map((c) => (
              <th
                key={c.clave}
                onClick={() => alHacerClicEncabezado(c.clave, Boolean(c.valor))}
                className={`py-1 ${c.valor ? "cursor-pointer select-none hover:text-neutral-900" : ""} ${c.alinear === "derecha" ? "text-right" : ""}`}
              >
                {c.etiqueta}
                {ordenPor === c.clave ? (direccion === "asc" ? " ▲" : " ▼") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filasOrdenadas.map((f, i) => (
            <tr key={claveFila(f, i)} className="border-b">
              {columnas.map((c) => (
                <td key={c.clave} className={`py-1 ${c.alinear === "derecha" ? "text-right" : ""}`}>
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
