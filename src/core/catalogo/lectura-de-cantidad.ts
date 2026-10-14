import { interpretarNumero } from "@/core/datos/numero-tecleado";

/**
 * Lectura en vivo de la cantidad de un ingrediente de receta (pedido del dueño, 2026-10-14): mientras el operario tipea, la pantalla le dice
 * qué entendió el sistema («= 3 kg», «= 300 g») y le avisa cuando lo tecleado puede leerse de dos maneras. Es SOLO información: no cambia lo
 * que se guarda ni bloquea nada (el número lo sigue interpretando `interpretarNumero`, el mismo parser que usa CampoNumero, y lo valida el
 * servidor como siempre). Puro: sin base, sin reloj, sin React.
 *
 * Por qué hace falta: `interpretarNumero` lee un separador solo como DECIMAL, sea coma o punto («3.000» = 3, «1.500» = 1,5; tabla en
 * docs/plan-validacion-de-datos-2026-09-25.md). Quien escribe «3.000» pensando en tres mil carga 3, y nada se lo marcaba.
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
  | { tipo: "valor"; valor: number; lectura: string; advertencia: string | null };

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

/**
 * Un solo separador (punto o coma) con 1 a 3 dígitos antes y EXACTAMENTE 3 después: «3.000», «1,500», «0.300». Es la única forma en que lo
 * tecleado también podría ser un número con separador de miles. «1.000.000» (miles bien agrupados), «1.234,5» (los dos separadores),
 * «1,5» o «12345.678» no lo son.
 */
const AMBIGUO = /^-?\d{1,3}([.,])\d{3}$/;

/** Qué entendió el sistema de lo tecleado en el campo de cantidad, en la unidad de stock de la materia prima (`null` si todavía no se sabe cuál). */
export function leerCantidadTecleada(texto: string, unidad: UnidadDeLectura | null): Lectura {
  const r = interpretarNumero(texto);
  if (!r.ok) return { tipo: "invalido", mensaje: r.mensaje };
  if (r.valor === null) return { tipo: "vacio" };
  const leido = conUnidad(r.valor, unidad);
  const ambiguo = AMBIGUO.exec(texto.trim());
  // La otra lectura posible: el mismo texto sin el separador (si da lo mismo, como «0.000», no hay nada que aclarar).
  const alternativa = ambiguo ? Number(texto.trim().replace(ambiguo[1], "")) : null;
  if (!ambiguo || alternativa === null || alternativa === r.valor) return { tipo: "valor", valor: r.valor, lectura: `= ${leido}`, advertencia: null };
  const sinSeparador = formatear(alternativa);
  const enLaUnidad = unidad ? `${sinSeparador} ${unidad.nombre}` : sinSeparador;
  const advertencia = `Se leyó como ${leido}. Si quisiste decir ${enLaUnidad}, escribilo sin ${ambiguo[1] === "." ? "punto" : "coma"}: ${sinSeparador}.`;
  return { tipo: "valor", valor: r.valor, lectura: `= ${leido}`, advertencia };
}
