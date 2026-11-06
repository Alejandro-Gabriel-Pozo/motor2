/**
 * Detector compartido de «una mención al proceso COMPRA o VENTA sin decidir qué hacer con las anuladas cerca». Lo usan el guardián de `src/core/reportes/` (`reportes-compras-anuladas.test.ts`) y el cerco
 * de `src/server/consultas/` y `src/server/lecturas/` (`cerco-anuladas-en-consultas.test.ts`): una sola heurística, no dos copias. Sin Vitest a propósito (mismo criterio que `trinquete.ts`).
 */
const VENTANA_ANTES = 3;
const VENTANA_DESPUES = 8;
const PROCESOS = ["COMPRA", "VENTA"] as const;

function esComentario(linea: string): boolean {
  const t = linea.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
}

/** Las líneas (1-based) con una mención a COMPRA o VENTA en código que no tienen ninguna referencia a anuladas cerca. */
export function procesosSinDecidirAnuladas(fuente: string): number[] {
  const lineas = fuente.replace(/\r\n/g, "\n").split("\n");
  const malas: number[] = [];
  lineas.forEach((linea, i) => {
    if (esComentario(linea) || !PROCESOS.some((p) => new RegExp(`["']${p}["']`).test(linea))) return;
    const ventana = lineas.slice(Math.max(0, i - VENTANA_ANTES), i + VENTANA_DESPUES + 1).join("\n");
    if (!/anulad/i.test(ventana)) malas.push(i + 1);
  });
  return malas;
}

