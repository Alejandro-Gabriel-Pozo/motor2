import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decidirDestinosDeRecepcion } from "../../src/core/compras/public";
import type { CondicionDeControl, SeccionParaElDestino, UsoDeSeccion } from "../../src/core/compras/public";
import { puertaDeAcceso } from "./oraculo-compras-recepcion";
import { dimensionesDelOraculo, productoCartesiano, tablaDelOraculo, type TablaDelOraculo } from "./oraculo-una-sola-compra";

/**
 * Lector del oráculo de los depósitos de uso RECHAZO y CUARENTENA (`docs/oraculo-combinaciones-compras-cuarentena-y-rechazo-2026-11-17.md`). Las tablas de reglas viven APARTE del código; este archivo solo las PARSEA y traduce cada fila al «mundo» (las
 * secciones de la sucursal, el control de la línea y lo que elige quien confirma) que la regla real recibe: no copia ningún resultado esperado. Lo usan el test exhaustivo de la regla pura, el de integración con la base real y el guardián de dimensiones declaradas.
 */
const TEXTO_DEL_ORACULO = readFileSync(join(__dirname, "../../docs/oraculo-combinaciones-compras-cuarentena-y-rechazo-2026-11-17.md"), "utf8");

export const dimensionesDeCuarentenaYRechazo = (): Record<string, string[]> => dimensionesDelOraculo(TEXTO_DEL_ORACULO);
export const tablaDeCuarentenaYRechazo = (seccion: string): TablaDelOraculo => tablaDelOraculo(seccion, TEXTO_DEL_ORACULO);
export { productoCartesiano };

export type FilaDeDestino = { M: string; K: string; U: string; X: string };

/** Los valores de la dimensión K como llegan a la regla (`null` = sin control). */
export const CONDICION_DE_LA_FILA: Record<string, CondicionDeControl | null> = { SIN_CONTROL: null, CONFORME: "CONFORME", CON_OBSERVACIONES: "CON_OBSERVACIONES", RECHAZADA: "RECHAZADA" };

/** Cuántos depósitos activos de cada uso especial tiene la sucursal según la dimensión U. */
export const CANTIDAD_DE_ESPECIALES: Record<string, number> = { NINGUNA: 0, UNA: 1, VARIAS: 2 };

/** Los nombres ordenan como el oráculo dice: «la primera por nombre» de cada uso es la «1» (y los normales, «A» antes que «B»). */
export interface MundoDeLaFila {
  secciones: (SeccionParaElDestino & { clave: string })[];
  /** La sección que elige quien confirma según la dimensión X, o `null` si la fila no se puede armar (NO_APLICA). */
  elegida: string | null;
  propuesta: string;
}

const USO_QUE_PIDE_EL_CONTROL: Record<string, UsoDeSeccion> = { SIN_CONTROL: "NORMAL", CONFORME: "NORMAL", CON_OBSERVACIONES: "CUARENTENA", RECHAZADA: "RECHAZO" };

/** Arma las secciones de la sucursal de la fila (dos NORMAL siempre; de cada uso especial, 0, 1 o 2) y a cuál elige quien confirma. Todas activas: las inactivas se prueban aparte. */
export function mundoDeLaFila(f: Pick<FilaDeDestino, "K" | "U" | "X">): MundoDeLaFila {
  const cuantas = CANTIDAD_DE_ESPECIALES[f.U]!;
  const secciones: MundoDeLaFila["secciones"] = [
    { clave: "A", id: "A", nombre: "A normal", uso: "NORMAL", activa: true },
    { clave: "B", id: "B", nombre: "B normal", uso: "NORMAL", activa: true },
  ];
  for (const [prefijo, uso] of [["C cuarentena", "CUARENTENA"], ["D rechazo", "RECHAZO"]] as const) {
    for (let n = 1; n <= cuantas; n++) secciones.push({ clave: `${prefijo[0]}${n}`, id: `${prefijo[0]}${n}`, nombre: `${prefijo} ${n}`, uso, activa: true });
  }
  const usoPedido = USO_QUE_PIDE_EL_CONTROL[f.K]!;
  // La propuesta que el oráculo da por cierta: la «1» del uso que pide el control (los nombres ya ordenan así), o la «A» si es normal.
  const propuesta = usoPedido === "NORMAL" ? "A" : usoPedido === "CUARENTENA" ? "C1" : "D1";
  let elegida: string | null;
  if (f.X === "PROPUESTA") elegida = secciones.some((s) => s.id === propuesta) ? propuesta : "A";
  else if (f.X === "OTRA_NORMAL") elegida = usoPedido === "NORMAL" ? "B" : "A";
  else {
    // Otra especial que no es la propuesta: otra del mismo uso si hay (la «2»), si no una del otro uso.
    const candidatas = secciones.filter((s) => s.uso !== "NORMAL" && s.id !== propuesta);
    const delMismoUso = candidatas.find((s) => s.uso === usoPedido);
    elegida = (delMismoUso ?? candidatas[0])?.id ?? null;
  }
  return { secciones, elegida, propuesta };
}

/** Lo que las reglas reales deciden para una fila de «Destino de la línea al confirmar»: la puerta del módulo (guard real) y después la regla pura de destinos. */
export function resultadoDeDestino(f: FilaDeDestino): string {
  const mundo = mundoDeLaFila(f);
  if (mundo.elegida === null) return "NO_APLICA";
  const puerta = puertaDeAcceso({ M: f.M, O: "ADMINISTRADOR" });
  if (puerta) return puerta;
  const d = decidirDestinosDeRecepcion({
    lineas: [{ renglonId: "r1", condicion: CONDICION_DE_LA_FILA[f.K]! }],
    secciones: mundo.secciones.map(({ id, nombre, uso, activa }) => ({ id, nombre, uso, activa })),
    elegidas: [{ renglonId: "r1", seccionId: mundo.elegida }],
  });
  if (!d.ok) return `RECHAZA_${d.codigo}`;
  return d.destinos[0]!.cambiado ? "CONFIRMA_CAMBIADO" : "CONFIRMA_SIN_CAMBIO";
}
