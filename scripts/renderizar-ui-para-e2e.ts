/**
 * Dibuja a HTML, en un proceso aparte, las piezas de `src/ui` que prueba `test/e2e/ui-datos-y-fechas.spec.ts` y lo imprime como JSON por la salida estándar. No toca archivos ni la base.
 *
 * Por qué un proceso aparte: Playwright transforma el JSX de todo lo que importa un spec a un formato propio para sus pruebas de componentes (`__pw_type`), que `react-dom/server` no entiende.
 * Acá el JSX lo compila `tsx` como en el resto de los scripts. Uso: `npx tsx scripts/renderizar-ui-para-e2e.ts`.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TablaDeDatos, type ColumnaDeTabla } from "../src/ui/componentes/datos/tabla-de-datos";
import { RangoDeFechas } from "../src/ui/componentes/selectores/campo-fecha";

interface Compra {
  id: string;
  proveedor: string;
  fecha: string;
  total: string;
  nota: string;
}

const FILAS: Compra[] = [
  { id: "a", proveedor: "Molino Sur", fecha: "2026-10-01", total: "$ 1.200,00", nota: "pagada" },
  { id: "b", proveedor: "Lácteos del Valle con un nombre bastante largo de proveedor", fecha: "2026-10-02", total: "$ 560,50", nota: "pendiente" },
  { id: "c", proveedor: "Verdulería Central", fecha: "2026-10-03", total: "$ 98.000,00", nota: "pagada" },
];

const COLUMNAS: ColumnaDeTabla<Compra>[] = [
  { id: "proveedor", encabezado: "Proveedor", celda: (f) => f.proveedor, titulo: true },
  { id: "fecha", encabezado: "Fecha", celda: (f) => f.fecha },
  { id: "total", encabezado: "Total", celda: (f) => f.total, alinear: "derecha" },
  { id: "nota", encabezado: "Estado", celda: (f) => f.nota, soloEnTabla: true },
];

const VACIO = "Todavía no hay compras. Registrá la primera desde Movimientos.";

function pagina(filas: Compra[]): string {
  const tabla = renderToStaticMarkup(createElement(TablaDeDatos<Compra>, { titulo: "Compras registradas", columnas: COLUMNAS, filas, claveDeFila: (f) => f.id, vacio: VACIO }));
  const rango = renderToStaticMarkup(createElement(RangoDeFechas, { leyenda: "Período", desde: { name: "desde", defaultValue: "2026-10-01" }, hasta: { name: "hasta", defaultValue: "2026-10-10" } }));
  return `<main class="flex flex-col gap-4 p-4"><h1 class="text-xl font-semibold">Compras</h1>${rango}${tabla}</main>`;
}

process.stdout.write(JSON.stringify({ conFilas: pagina(FILAS), vacia: pagina([]) }));
