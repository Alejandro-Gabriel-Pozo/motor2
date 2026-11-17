import { Decimal } from "decimal.js";
import { formatearCantidad } from "../formato-de-numero";
import { ZONA_ARGENTINA, formatearFechaHora } from "../tiempo/zona-horaria";
import { factorDeMermaExacto, leerBaseDeCantidad } from "./merma";

/**
 * «Ficha de cocina» imprimible (pedida por el dueño el 2026-11-08; `docs/diseno-ficha-de-cocina-2026-11-08.md`): lo que la cocina necesita en papel de UNA receta, armado
 * como datos puros a partir de la versión de receta que rige en la sucursal. Sin base de datos ni React: la pantalla (`components/catalogo/ficha-de-cocina`) solo lo dibuja.
 *
 * Qué NO entra, por construcción: la entrada declara SOLO los campos que la ficha usa. No hay costos, precios ni sustitutos en `RecetaParaFicha`, así que no hay manera de
 * que viajen al papel aunque la fila que llega de la base los traiga. Lo que falta no se inventa: una sección vacía se omite o dice «pendiente de completar» (`PENDIENTE`).
 *
 * LA CANTIDAD QUE SE IMPRIME ES SIEMPRE EL BRUTO (M3c, 2026-11-17; dueño, chat con el orquestador: «Ok:» a «¿Querés que la hoja de cocina muestre siempre lo que hay que sacar de la cámara (el bruto,
 * como Pedernal), también para las recetas que ya tenés cargadas?»): lo que la cocina tiene que SACAR, no lo que lleva el plato. La merma entra como dato de CÁLCULO (nunca se imprime el %).
 * - Versión NETA (todo lo cargado hasta M3b): bruto = cantidad × (1 + merma/100), en decimal exacto, redondeado UNA vez a 4 decimales (mitad que se aleja del cero).
 * - Versión BRUTA: la cantidad YA es el bruto: se imprime tal cual.
 * Con merma 0 el bruto es la cantidad: el papel no cambia. Interruptor reversible: `FICHA_IMPRIME_BRUTO` (vuelve al impreso anterior, la cantidad escrita, cambiando esa línea).
 */

/**
 * Interruptor del impreso (M3c): `true` = la ficha imprime el bruto (lo que decidió el dueño el 2026-11-17); `false` = el impreso de antes, la cantidad tal como está escrita en la versión. Una sola línea
 * para volver atrás si la cocina lo pide; `armarFichaDeCocina` también acepta `imprimeBruto` para probar los dos lados.
 */
export const FICHA_IMPRIME_BRUTO = true;

/** La unidad de una cantidad: su nombre y, si se conocen, sus decimales (`Unidad.decimales`: hasta cuántos admite la cantidad). */
type UnidadDeFicha = { nombre: string; decimales?: number };

/** Un `Decimal` de la base, sin conocer Prisma (mismo tipo estructural que `receta-a-input.ts`). */
type DecimalLeido = { toString(): string } | number;

/** La versión de receta que rige en la sucursal, con SOLO lo que la ficha dibuja (la fila de `INCLUDE_RECETA_COMPLETA` se le asigna tal cual). */
export interface RecetaParaFicha {
  version: number;
  /** La base de las cantidades de la versión (M2): NETA o BRUTA, tal como viene de la base (se valida al armar: una marca ilegible CIERRA). */
  baseDeCantidad: string;
  /** `mermaPorcentaje` entra SOLO para calcular el bruto de una versión NETA; nunca se imprime. */
  ingredientes: readonly { cantidad: DecimalLeido; mermaPorcentaje: DecimalLeido; unidad: UnidadDeFicha; insumoProducto: { nombre: string } }[];
  pasos: readonly {
    orden: number;
    nombre: string | null;
    instruccion: string;
    minutos: number | null;
    ingredientes: readonly { recetaIngrediente: { insumoProducto: { nombre: string } } }[];
  }[];
  rendimientoCantidad: DecimalLeido | null;
  rendimientoUnidad: UnidadDeFicha | null;
  racionesCantidad: number | null;
  racionTamano: DecimalLeido | null;
  racionUnidad: UnidadDeFicha | null;
  tiempoPreparacionMinutos: number | null;
  tiempoCoccionMinutos: number | null;
  comentarios: string | null;
  presentacionEmplatado: string | null;
  notasAdicionales: string | null;
  equipamientoNecesario: string | null;
}

export interface EntradaDeFichaDeCocina {
  productoNombre: string;
  sucursalNombre: string;
  /** `PROPIA`: la sucursal usa su receta propia (ADR-009); `CENTRAL`: la receta central. */
  origen: "PROPIA" | "CENTRAL";
  receta: RecetaParaFicha;
  /** El instante de impresión: lo da el borde (la página), nunca el núcleo. */
  ahora: Date;
  /** Para probar los dos lados del interruptor; sin esto rige `FICHA_IMPRIME_BRUTO`. */
  imprimeBruto?: boolean;
}

export interface FichaDeCocina {
  titulo: string;
  /** «Versión 3 · receta propia de la sucursal» / «Versión 3 · receta central». */
  versionTexto: string;
  sucursalNombre: string;
  /** «08/11/2026 15:10», hora de Argentina. */
  impresaEn: string;
  /** Rótulo y valor de la ficha técnica (solo los datos cargados). Vacío → `fichaTecnicaPendiente`. */
  datos: { rotulo: string; valor: string }[];
  fichaTecnicaPendiente: boolean;
  ingredientes: { nombre: string; cantidad: string; unidad: string }[];
  ingredientesPendientes: boolean;
  pasos: { numero: number; nombre: string | null; instruccion: string; minutos: number | null; ingredientes: string[] }[];
  pasosPendientes: boolean;
  /** Comentarios: un texto libre. Se omite si está vacío. */
  comentarios: string | null;
  /** Presentación, notas y equipamiento: «un renglón por ítem» en la carga; acá, la lista de renglones no vacíos (vacía = se omite). */
  presentacion: string[];
  notas: string[];
  equipamiento: string[];
}

/** El texto de lo que falta cargar: nunca se inventa un valor en su lugar. */
export const PENDIENTE = "pendiente de completar";

/** Una cantidad en texto rioplatense: 0,22 · 0,005 · 1 · 1.250 (sin ceros de relleno; formateo de salida único, `core/formato-de-numero.ts`). */
function cantidadEnTexto(valor: DecimalLeido, unidad: { decimales?: number } | null): string {
  return formatearCantidad(Number(valor), unidad?.decimales);
}

/** Los decimales con que se muestra un bruto: los de la unidad, pero nunca menos de 4 (el bruto de una versión NETA puede tener hasta 4 aunque la unidad admita menos). */
const DECIMALES_DEL_BRUTO = 4;

/**
 * La cantidad que sale de la cámara, en texto. NETA: `cantidad × (1 + merma/100)` en decimal exacto, redondeado una sola vez a 4 decimales (mitad que se aleja del cero); BRUTA: la cantidad tal cual.
 * Con `imprimeBruto` apagado, la cantidad escrita (el impreso de antes de M3c).
 */
function cantidadParaCocinar(i: RecetaParaFicha["ingredientes"][number], base: "NETA" | "BRUTA", imprimeBruto: boolean): string {
  if (!imprimeBruto) return cantidadEnTexto(i.cantidad, i.unidad);
  const cantidad = new Decimal(i.cantidad.toString());
  const bruto = base === "BRUTA" ? cantidad : cantidad.times(factorDeMermaExacto(i.mermaPorcentaje.toString()));
  const redondeado = bruto.toDecimalPlaces(DECIMALES_DEL_BRUTO, Decimal.ROUND_HALF_UP);
  return formatearCantidad(redondeado.toNumber(), Math.max(i.unidad.decimales ?? 0, DECIMALES_DEL_BRUTO));
}

function renglones(texto: string | null): string[] {
  return (texto ?? "")
    .split(/\r?\n/)
    .map((r) => r.trim())
    .filter((r) => r !== "");
}

function conUnidad(cantidad: DecimalLeido | null, unidad: UnidadDeFicha | null): string | null {
  if (cantidad === null) return null;
  return `${cantidadEnTexto(cantidad, unidad)}${unidad ? ` ${unidad.nombre}` : ""}`;
}

export function armarFichaDeCocina(entrada: EntradaDeFichaDeCocina): FichaDeCocina {
  const { receta } = entrada;
  const base = leerBaseDeCantidad(receta.baseDeCantidad);
  const imprimeBruto = entrada.imprimeBruto ?? FICHA_IMPRIME_BRUTO;
  const datos: { rotulo: string; valor: string }[] = [];
  const rendimiento = conUnidad(receta.rendimientoCantidad, receta.rendimientoUnidad);
  if (rendimiento !== null) datos.push({ rotulo: "Rendimiento", valor: rendimiento });
  if (receta.racionesCantidad !== null) datos.push({ rotulo: "Raciones", valor: formatearCantidad(receta.racionesCantidad, 0) });
  const racion = conUnidad(receta.racionTamano, receta.racionUnidad);
  if (racion !== null) datos.push({ rotulo: "Tamaño de ración", valor: racion });
  if (receta.tiempoPreparacionMinutos !== null) datos.push({ rotulo: "Preparación", valor: `${receta.tiempoPreparacionMinutos} min` });
  if (receta.tiempoCoccionMinutos !== null) datos.push({ rotulo: "Cocción", valor: `${receta.tiempoCoccionMinutos} min` });

  const pasos = [...receta.pasos]
    .sort((a, b) => a.orden - b.orden)
    .map((p, i) => ({
      numero: i + 1,
      nombre: p.nombre !== null && p.nombre.trim() !== "" ? p.nombre.trim() : null,
      instruccion: p.instruccion,
      minutos: p.minutos,
      ingredientes: p.ingredientes.map((pi) => pi.recetaIngrediente.insumoProducto.nombre),
    }));

  return {
    titulo: entrada.productoNombre,
    versionTexto: `Versión ${receta.version} · ${entrada.origen === "PROPIA" ? "receta propia de la sucursal" : "receta central"}`,
    sucursalNombre: entrada.sucursalNombre,
    impresaEn: formatearFechaHora(entrada.ahora, ZONA_ARGENTINA),
    datos,
    fichaTecnicaPendiente: datos.length === 0,
    ingredientes: receta.ingredientes.map((i) => ({ nombre: i.insumoProducto.nombre, cantidad: cantidadParaCocinar(i, base, imprimeBruto), unidad: i.unidad.nombre })),
    ingredientesPendientes: receta.ingredientes.length === 0,
    pasos,
    pasosPendientes: pasos.length === 0,
    comentarios: receta.comentarios !== null && receta.comentarios.trim() !== "" ? receta.comentarios.trim() : null,
    presentacion: renglones(receta.presentacionEmplatado),
    notas: renglones(receta.notasAdicionales),
    equipamiento: renglones(receta.equipamientoNecesario),
  };
}
