/**
 * El CRUCE EN EJECUCIÓN del inventario de puertas (GT-3b; hallazgo I-3 de la auditoría final, fila O.177).
 *
 * El inventario (`inventario-de-puertas.ts`) lee el código por AST y solo ve `export function f` y `export const f = (…) => …`. Una exportación que el AST no reconoce —`export const f = envolver(async () => …)`, `export const f = (async () => …) as T`,
 * un `export { g }` o un re-export— sería una puerta de datos que la matriz nunca ejerce, sin que nada falle. Acá se cruza con lo que el módulo exporta DE VERDAD cuando se lo importa: toda exportación que sea una función tiene que estar en el
 * inventario, y toda función del inventario tiene que existir en el módulo. Lo que sobra o falta es un error de cobertura.
 */
import { archivosDelInventario, inventariarPuertas } from "./inventario-de-puertas";

const MODULOS_DEL_SERVIDOR = import.meta.glob("../../../src/server/{actions,consultas,lecturas}/**/*.ts");

/** `archivo → nombres` de lo que cada módulo exporta como función en ejecución (los módulos se importan de verdad). */
export async function exportacionesDeFuncionesEnRuntime(archivos: readonly string[]): Promise<Record<string, string[]>> {
  const salida: Record<string, string[]> = {};
  for (const archivo of archivos) {
    const cargador = MODULOS_DEL_SERVIDOR[`../../../src/server/${archivo}`];
    if (!cargador) throw new Error(`El cruce en ejecución no encontró el módulo ${archivo}`);
    const modulo = (await cargador()) as Record<string, unknown>;
    salida[archivo] = Object.keys(modulo).filter((nombre) => typeof modulo[nombre] === "function").sort();
  }
  return salida;
}

/** `archivo → nombres` de lo que el inventario por AST dice que cada archivo exporta. */
export function exportacionesInventariadas(): Record<string, string[]> {
  const salida: Record<string, string[]> = {};
  for (const archivo of archivosDelInventario()) salida[archivo] = [];
  for (const p of inventariarPuertas()) (salida[p.archivo] ??= []).push(p.nombre);
  for (const nombres of Object.values(salida)) nombres.sort();
  return salida;
}

/**
 * Las diferencias entre lo exportado en ejecución y lo inventariado. `sobran` = funciones que el módulo exporta y el inventario no ve (puertas sin ejercer); `faltan` = funciones inventariadas que el módulo no exporta (el inventario leyó
 * algo que no existe). Vacío = coinciden.
 */
export function diferenciasDelCruce(
  enRuntime: Readonly<Record<string, readonly string[]>>,
  inventariadas: Readonly<Record<string, readonly string[]>>,
  /** `<archivo>|<nombre>` → de dónde viene (la clave de la puerta inventariada de la que es un alias). Un re-export no es una puerta nueva. */
  reexportsDeInventariadas: Readonly<Record<string, string>> = {},
): string[] {
  const problemas: string[] = [];
  const usadas = new Set<string>();
  for (const archivo of new Set([...Object.keys(enRuntime), ...Object.keys(inventariadas)])) {
    const reales = new Set(enRuntime[archivo] ?? []);
    const vistas = new Set(inventariadas[archivo] ?? []);
    for (const nombre of [...reales].sort()) {
      if (vistas.has(nombre)) continue;
      if (Object.hasOwn(reexportsDeInventariadas, `${archivo}|${nombre}`)) usadas.add(`${archivo}|${nombre}`);
      else problemas.push(`${archivo}: exporta la función «${nombre}» y el inventario por AST no la ve (¿envuelta en una llamada, con «as», re-exportada?): es una puerta que la matriz no ejerce`);
    }
    for (const nombre of [...vistas].sort()) if (!reales.has(nombre)) problemas.push(`${archivo}: el inventario ve «${nombre}» y el módulo no la exporta como función`);
  }
  for (const clave of Object.keys(reexportsDeInventariadas)) if (!usadas.has(clave)) problemas.push(`REEXPORTS_DE_PUERTAS_INVENTARIADAS: ${clave} ya no hace falta (el módulo dejó de re-exportarla): sacala`);
  return problemas;
}
