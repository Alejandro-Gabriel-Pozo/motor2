import { CONTEXTO_CANTIDAD_SIN_UNIDAD, interpretarNumeroTecleado } from "@/core/datos/numero-tecleado";

/**
 * Lectura en vivo de la cantidad de un ingrediente de receta (pedido del dueño, 2026-10-14): mientras el operario tipea, la pantalla le dice
 * qué entendió el sistema («= 3 kg», «= 300 g») o, si lo tecleado no se puede leer, por qué (micro-paso 2c: «1.205» en kilos es ambiguo y no se adivina). Es SOLO información: no cambia lo
 * que se guarda ni bloquea nada (el número lo interpreta `interpretarNumeroTecleado` con el MISMO contexto que el campo de cantidad de la receta, que no conoce la unidad: los 4 decimales de las columnas; así la lectura y el campo
 * nunca se contradicen, y lo valida el servidor como siempre).
 * Puro: sin base, sin reloj, sin React.
 */

/**
 * Pares mayor → menor que el sistema SIEMBRA en toda empresa (`src/core/features/empresa/siembra-de-empresa.ts` y `prisma/seed.ts`: «kg»/«g» de
 * magnitud PESO, «l»/«ml» de VOLUMEN). El modelo `Unidad` no guarda ninguna relación entre unidades: la equivalencia sale de estos nombres y
 * solo se usa si las DOS unidades existen en el catálogo de la empresa con esa magnitud. Una unidad que no está acá («unidad», «caja», una
 * creada a mano) se muestra tal cual, sin convertir.
 */
const PARES_DE_UNIDADES: ReadonlyArray<{ mayor: string; menor: string; magnitud: string; factor: number }> = [
  { mayor: "kg", menor: "g", magnitud: "PESO", factor: 1000 },
  { mayor: "l", menor: "ml", magnitud: "VOLUMEN", factor: 1000 },
];

/** Cómo se muestra una cantidad en una unidad: su nombre del catálogo y, si existe, la unidad menor a la que se pasa un valor entre 0 y 1. */
export interface UnidadDeLectura {
  nombre: string;
  menor: { nombre: string; factor: number } | null;
}

type Lectura =
  | { tipo: "vacio" }
  | { tipo: "invalido"; mensaje: string }
  | { tipo: "valor"; valor: number; lectura: string };

const clave = (nombre: string) => nombre.trim().toLowerCase();

/** La unidad de lectura de cada unidad del catálogo, por id (lo arma la página con las unidades activas de la empresa). */
export function unidadesDeLectura(catalogo: ReadonlyArray<{ id: string; nombre: string; magnitud: string }>): Record<string, UnidadDeLectura> {
  const porNombre = new Map(catalogo.map((u) => [`${clave(u.nombre)}|${u.magnitud}`, u.nombre]));
  return Object.fromEntries(
    catalogo.map((u) => {
      const par = PARES_DE_UNIDADES.find((p) => p.mayor === clave(u.nombre) && p.magnitud === u.magnitud);
      const nombreMenor = par ? porNombre.get(`${par.menor}|${par.magnitud}`) : undefined;
      return [u.id, { nombre: u.nombre, menor: par && nombreMenor !== undefined ? { nombre: nombreMenor, factor: par.factor } : null }];
    })
  );
}

/** Número en es-AR SIN separador de miles (un «3.000» en la lectura volvería a ser ambiguo) y sin el ruido del punto flotante. */
function formatear(n: number): string {
  return n.toLocaleString("es-AR", { maximumFractionDigits: 10, useGrouping: false });
}

function conUnidad(n: number, unidad: UnidadDeLectura | null): string {
  if (!unidad) return formatear(n);
  if (unidad.menor && n > 0 && n < 1) return `${formatear(n * unidad.menor.factor)} ${unidad.menor.nombre}`;
  return `${formatear(n)} ${unidad.nombre}`;
}

/** Qué entendió el sistema de lo tecleado en el campo de cantidad, en la unidad de stock de la materia prima (`null` si todavía no se sabe cuál). */
export function leerCantidadTecleada(texto: string, unidad: UnidadDeLectura | null): Lectura {
  const r = interpretarNumeroTecleado(texto, CONTEXTO_CANTIDAD_SIN_UNIDAD);
  if (!r.ok) return { tipo: "invalido", mensaje: r.mensaje };
  if (r.valor === null) return { tipo: "vacio" };
  return { tipo: "valor", valor: r.valor, lectura: `= ${conUnidad(r.valor, unidad)}` };
}
