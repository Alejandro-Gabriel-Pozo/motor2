import { claveDeCombinacion, identidadDeCombinacion, resolverPrecioDeCombinacion, validarEjesDeCombinacion, type CombinacionParaPrecio, type PrecioDeCombinacion, type TipoDeGrupoDeOpciones } from "@/core/opciones/public";

/**
 * GO-3b (ADR-032, frente A): la COMBINACIÓN que cae una elección y su precio, compartido por la venta (`armarLineaConfigurada`, `linea-configurada.ts`) y por los precios PARA MOSTRAR del diálogo de
 * opciones del POS (`precio-de-configuracion.ts`, que corre también en el cliente). Puro y SIN `node:crypto` (por eso no vive en `linea-configurada.ts`): la misma función en los dos lados es la paridad.
 *
 * Sin ningún grupo eje: nada (`precio: null`). Con ejes: los ejes tienen que seguir siendo válidos con lo que el producto admite HOY (si alguien los dejó de una sola opción o desactivó el grupo, falla
 * cerrado: `CONFIGURACION_INVALIDA`), las combinaciones tienen que venir leídas y la identidad elegida decide la fila (sin fila: `SIN_COMBINACION`, el aditivo de siempre). La «ninguna» de un eje no
 * participa (rige el aditivo). Una fila apagada (o con su tarifa apagada) es `COMBINACION_NO_DISPONIBLE`.
 */

export type FilaDeCombinacion = CombinacionParaPrecio & { recetaDeCombinacionVersionId: string | null };

/**
 * Las COMBINACIONES de un producto con ejes, para venderlo: las filas que existen (sobrescritura dispersa: activa o no, precio propio o tarifa, y la versión vigente de su receta propia, que se congela
 * al agregar) y los precios locales VIGENTES de la sucursal (de la combinación y de las tarifas). Las arma la lectura de la venta (`linea-configurada.ts` la reexporta).
 */
export interface CombinacionesDelProducto {
  /** Para los mensajes («Esa combinación de «Café» no está disponible»). */
  nombreDelProducto: string;
  /** Por `claveDeCombinacion` (las opciones de los ejes). */
  filas: ReadonlyMap<string, FilaDeCombinacion>;
  locales: { porCombinacion: ReadonlyMap<string, number>; porGrupo: ReadonlyMap<string, number> };
}

/** Lo que esta función mira de un grupo (lo cumple `GrupoParaVender` de `linea-configurada.ts`; acá se nombra solo lo necesario para no importar ese módulo: sin ciclos). */
interface GrupoConEje {
  grupoId: string;
  nombre: string;
  tipo: TipoDeGrupoDeOpciones;
  activo: boolean;
  admitido: boolean;
  cantidadMinima: number;
  cantidadMaxima: number;
  ejeDeCombinacion?: number;
}

/** El precio de una combinación que se puede vender (el lado `ok` de `resolverPrecioDeCombinacion`). */
export type PrecioDeCombinacionVendible = Extract<PrecioDeCombinacion, { ok: true }>;

export type ResultadoDeCombinacionElegida =
  | { ok: true; precio: PrecioDeCombinacionVendible | null; opcionesDeEjes: string[]; fila: FilaDeCombinacion | null }
  | { ok: false; codigo: "CONFIGURACION_INVALIDA" | "COMBINACION_NO_DISPONIBLE" | "PRECIO_DE_COMBINACION_INVALIDO"; mensaje: string };

export function combinacionElegida(
  grupos: readonly GrupoConEje[],
  queCuentan: readonly { grupo: { grupoId: string }; opcion: { opcionId: string; esNinguna: boolean } }[],
  combinaciones: CombinacionesDelProducto | undefined,
): ResultadoDeCombinacionElegida {
  const sinCombinacion = { ok: true as const, precio: null, opcionesDeEjes: [], fila: null };
  const ejes = grupos.filter((g) => g.ejeDeCombinacion !== undefined);
  if (ejes.length === 0) return sinCombinacion;
  const invalido = { ok: false as const, codigo: "CONFIGURACION_INVALIDA" as const, mensaje: "los ejes de las combinaciones de este producto ya no son válidos: revisá lo que admite." };
  if (ejes.some((g) => !g.activo || !g.admitido)) return invalido;
  const validos = validarEjesDeCombinacion(ejes.map((g) => ({ grupoId: g.grupoId, nombre: g.nombre, tipo: g.tipo, cantidadMinima: g.cantidadMinima, cantidadMaxima: g.cantidadMaxima, eje: g.ejeDeCombinacion! })));
  if (!validos.ok) return invalido;
  if (!combinaciones) return { ok: false, codigo: "CONFIGURACION_INVALIDA", mensaje: "faltan las combinaciones del producto para venderlo." };
  const identidad = identidadDeCombinacion(
    validos.ejes,
    queCuentan.map((e) => ({ opcionId: e.opcion.opcionId, grupoId: e.grupo.grupoId, esNinguna: e.opcion.esNinguna })),
  );
  if (identidad === null) return sinCombinacion;
  const fila = combinaciones.filas.get(claveDeCombinacion(identidad)) ?? null;
  const precio = resolverPrecioDeCombinacion(
    fila,
    {
      deLaCombinacion: fila ? (combinaciones.locales.porCombinacion.get(fila.combinacionId) ?? null) : null,
      delGrupo: fila?.grupo ? (combinaciones.locales.porGrupo.get(fila.grupo.grupoDePrecioId) ?? null) : null,
    },
    combinaciones.nombreDelProducto,
  );
  if (!precio.ok) return { ok: false, codigo: precio.codigo, mensaje: precio.mensaje };
  return { ok: true, precio, opcionesDeEjes: [identidad.opcionEje1Id, identidad.opcionEje2Id].filter((x): x is string => x !== null), fila };
}

/**
 * Las combinaciones en una forma que viaja de un componente de servidor al cliente (objetos y listas, sin `Map`) para el diálogo de opciones del POS. Sin la receta propia (no es del mozo).
 */
export interface CombinacionesParaMostrar {
  nombreDelProducto: string;
  filas: { clave: string; combinacionId: string; activa: boolean; precio: number | null; grupo: { grupoDePrecioId: string; nombre: string; precio: number; activo: boolean } | null }[];
  locales: { porCombinacion: Readonly<Record<string, number>>; porGrupo: Readonly<Record<string, number>> };
}

export function combinacionesParaMostrar(c: CombinacionesDelProducto): CombinacionesParaMostrar {
  return {
    nombreDelProducto: c.nombreDelProducto,
    filas: [...c.filas].map(([clave, f]) => ({ clave, combinacionId: f.combinacionId, activa: f.activa, precio: f.precio, grupo: f.grupo })),
    locales: { porCombinacion: Object.fromEntries(c.locales.porCombinacion), porGrupo: Object.fromEntries(c.locales.porGrupo) },
  };
}

export function combinacionesDesdeMostrar(m: CombinacionesParaMostrar): CombinacionesDelProducto {
  return {
    nombreDelProducto: m.nombreDelProducto,
    filas: new Map(m.filas.map((f) => [f.clave, { combinacionId: f.combinacionId, activa: f.activa, precio: f.precio, grupo: f.grupo, recetaDeCombinacionVersionId: null }])),
    locales: { porCombinacion: new Map(Object.entries(m.locales.porCombinacion)), porGrupo: new Map(Object.entries(m.locales.porGrupo)) },
  };
}
