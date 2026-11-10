import { formatearCantidad } from "../formato-de-numero";
import { ZONA_ARGENTINA, formatearFechaHora } from "../tiempo/zona-horaria";

/**
 * «Ficha de cocina» imprimible (pedida por el dueño el 2026-11-08; `docs/diseno-ficha-de-cocina-2026-11-08.md`): lo que la cocina necesita en papel de UNA receta, armado
 * como datos puros a partir de la versión de receta que rige en la sucursal. Sin base de datos ni React: la pantalla (`components/catalogo/ficha-de-cocina`) solo lo dibuja.
 *
 * Qué NO entra, por construcción: la entrada declara SOLO los campos que la ficha usa. No hay costos, precios, merma % ni sustitutos en `RecetaParaFicha`, así que no hay manera de
 * que viajen al papel aunque la fila que llega de la base los traiga. Lo que falta no se inventa: una sección vacía se omite o dice «pendiente de completar» (`PENDIENTE`).
 */

/** La unidad de una cantidad: su nombre y, si se conocen, sus decimales (`Unidad.decimales`: hasta cuántos admite la cantidad). */
type UnidadDeFicha = { nombre: string; decimales?: number };

/** Un `Decimal` de la base, sin conocer Prisma (mismo tipo estructural que `receta-a-input.ts`). */
type DecimalLeido = { toString(): string } | number;

/** La versión de receta que rige en la sucursal, con SOLO lo que la ficha dibuja (la fila de `INCLUDE_RECETA_COMPLETA` se le asigna tal cual). */
export interface RecetaParaFicha {
  version: number;
  ingredientes: readonly { cantidad: DecimalLeido; unidad: UnidadDeFicha; insumoProducto: { nombre: string } }[];
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
    ingredientes: receta.ingredientes.map((i) => ({ nombre: i.insumoProducto.nombre, cantidad: cantidadEnTexto(i.cantidad, i.unidad), unidad: i.unidad.nombre })),
    ingredientesPendientes: receta.ingredientes.length === 0,
    pasos,
    pasosPendientes: pasos.length === 0,
    comentarios: receta.comentarios !== null && receta.comentarios.trim() !== "" ? receta.comentarios.trim() : null,
    presentacion: renglones(receta.presentacionEmplatado),
    notas: renglones(receta.notasAdicionales),
    equipamiento: renglones(receta.equipamientoNecesario),
  };
}
