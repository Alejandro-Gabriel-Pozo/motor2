import type { AccionConteo, EstadoTraspaso, Prisma, Proceso, TipoProducto } from "@prisma/client";
import { describe, expectTypeOf, it } from "vitest";
import type { wherePromoOfrecidaEn } from "../../src/core/carta/promo-sucursal";
import type { RecetaCompleta, INCLUDE_RECETA_COMPLETA } from "../../src/core/catalogo/receta-a-input";
import type { incluirRecetaVigente } from "../../src/core/catalogo/recetas-vigentes";
import type * as D from "../../src/core/datos/enumerados-del-esquema";
import type { OPERACION_QUE_NO_ES_REVERSION_POR_ANULACION } from "../../src/core/movimientos/anulaciones";
import type { FilaDeMovimiento } from "../../src/core/movimientos/armar-filas-de-movimiento";
import type { whereSeccionHabitualVigente } from "../../src/core/stock/seccion-habitual";

/**
 * Los tipos de dominio del núcleo contra los de Prisma (Fase 6, tramo 6b). `src/core/` ya no importa `@prisma/client`: los enumerados del esquema son uniones propias
 * (`core/datos/enumerados-del-esquema.ts`) y las formas de consulta y escritura son tipos estructurales o inferidos. Esta prueba es la que los ata al esquema, y la
 * compila `npx tsc --noEmit` (en Vitest, `expectTypeOf` no hace nada en tiempo de ejecución):
 *  1. Cada enumerado propio es IGUAL al de Prisma: un valor nuevo en el esquema, o uno de más acá, no compila.
 *  2. Cada salida del núcleo se ASIGNA al tipo de Prisma donde se usa (filtro, `include` o fila del Kardex), y la fila que trae `INCLUDE_RECETA_COMPLETA` se asigna a
 *     `RecetaCompleta`.
 *  3. Ninguna salida tiene CLAVES DE MÁS (`ClavesDeMas`, abajo): `tsc` solo las ve en un objeto literal fresco, y estas salidas llegan a Prisma por variable o por spread,
 *     así que una clave mal escrita en un filtro (que Prisma rechaza recién al correr, o que en un `where` anidado cambia lo que se lee) pasaría la compilación.
 */

type Hoja = string | number | boolean | bigint | symbol | null | undefined | Date;
type Arreglo = readonly unknown[];
/** Las claves de cualquiera de los miembros de un tipo de Prisma (que suele ser una unión: `XOR<A, B>`, `boolean | Args`, `X | X[]`). */
type ClavesDe<U> = U extends Hoja | Arreglo ? never : keyof U;
/** El tipo de la clave `K` en cualquiera de los miembros de `U` que la declara. */
type ValorEn<U, K extends PropertyKey> = U extends Hoja | Arreglo ? never : K extends keyof U ? U[K] : never;
/** El elemento de los miembros arreglo de `U`. */
type ElementoDe<U> = U extends Arreglo ? U[number] : never;

/**
 * Las rutas (`a.b.c`) de las claves de `T` que NO existen en `U`, recorriendo objetos y arreglos anidados; `never` si no hay ninguna. Distribuye sobre las uniones de
 * los dos lados: cada miembro de `T` se compara con TODOS los miembros de `U` a la vez (una clave vale si la declara alguno, que es como se leen las uniones `XOR` de
 * Prisma 7: cada rama declara las claves de la otra como `never` opcional).
 */
type ClavesDeMas<T, U, Ruta extends string = ""> = T extends Hoja
  ? never
  : T extends Arreglo
    ? ClavesDeMas<T[number], ElementoDe<U>, `${Ruta}[]`>
    : {
        [K in keyof T & string]: K extends ClavesDe<U> ? ClavesDeMas<T[K], ValorEn<U, K>, `${Ruta}${Ruta extends "" ? "" : "."}${K}`> : `${Ruta}${Ruta extends "" ? "" : "."}${K}`;
      }[keyof T & string];

describe("tipos de dominio vs Prisma (los compila tsc)", () => {
  it("el detector de claves de más ve una clave de más, anidada o en un arreglo, y no inventa ninguna", () => {
    type Filtro = { a?: string; b?: { c?: number } | { c?: number }[]; d?: { e?: boolean } | null };
    expectTypeOf<ClavesDeMas<{ a: "x"; b: { c: 1 }; d: { e: true } }, Filtro>>().toEqualTypeOf<never>();
    expectTypeOf<ClavesDeMas<{ a: "x"; z: 1 }, Filtro>>().toEqualTypeOf<"z">();
    expectTypeOf<ClavesDeMas<{ b: { c: 1; z: 2 } }, Filtro>>().toEqualTypeOf<"b.z">();
    expectTypeOf<ClavesDeMas<{ b: readonly [{ c: 1 }, { z: 2 }] }, Filtro>>().toEqualTypeOf<"b[].z">();
    expectTypeOf<ClavesDeMas<{ d: { e: true; z: 1 } }, Filtro>>().toEqualTypeOf<"d.z">();
    // Con una XOR de Prisma: una clave de cualquiera de las dos ramas vale; una de ninguna, no.
    expectTypeOf<ClavesDeMas<{ seccion: { activa: true } }, Prisma.SeccionHabitualProductoWhereInput>>().toEqualTypeOf<never>();
    expectTypeOf<ClavesDeMas<{ seccion: { activo: true } }, Prisma.SeccionHabitualProductoWhereInput>>().toEqualTypeOf<"seccion.activo">();
  });

  it("los enumerados del esquema son los de Prisma, valor por valor", () => {
    expectTypeOf<D.Proceso>().toEqualTypeOf<Proceso>();
    expectTypeOf<D.AccionConteo>().toEqualTypeOf<AccionConteo>();
    expectTypeOf<D.EstadoTraspaso>().toEqualTypeOf<EstadoTraspaso>();
    expectTypeOf<D.TipoProducto>().toEqualTypeOf<TipoProducto>();
  });

  it("los filtros del núcleo son filtros de Prisma, sin claves de más", () => {
    type Promo = ReturnType<typeof wherePromoOfrecidaEn>;
    expectTypeOf<Promo>().toExtend<Prisma.PromoCartaWhereInput>();
    expectTypeOf<ClavesDeMas<Promo, Prisma.PromoCartaWhereInput>>().toEqualTypeOf<never>();

    type Habitual = ReturnType<typeof whereSeccionHabitualVigente>;
    expectTypeOf<Habitual>().toExtend<Prisma.SeccionHabitualProductoWhereInput>();
    expectTypeOf<ClavesDeMas<Habitual, Prisma.SeccionHabitualProductoWhereInput>>().toEqualTypeOf<never>();

    type NoReversion = typeof OPERACION_QUE_NO_ES_REVERSION_POR_ANULACION;
    expectTypeOf<NoReversion>().toExtend<Prisma.OperacionWhereInput>();
    expectTypeOf<ClavesDeMas<NoReversion, Prisma.OperacionWhereInput>>().toEqualTypeOf<never>();
  });

  it("incluirRecetaVigente acepta todo include de RecetaVersion y devuelve un include de Producto, sin claves de más", () => {
    expectTypeOf<Prisma.RecetaVersionInclude>().toExtend<Readonly<Record<string, unknown>>>();
    // El include con el que lo usa `server/consultas/catalogo/recetas.ts` (dentro de un `select` de Producto).
    type Incluye = ReturnType<typeof incluirRecetaVigente<{ readonly _count: { readonly select: { readonly ingredientes: true } } }>>;
    expectTypeOf<Incluye>().toExtend<Prisma.ProductoSelect>();
    expectTypeOf<ClavesDeMas<Incluye, Prisma.ProductoSelect>>().toEqualTypeOf<never>();
    type ConIngredientes = ReturnType<typeof incluirRecetaVigente<{ readonly ingredientes: true }>>;
    expectTypeOf<ConIngredientes>().toExtend<Prisma.ProductoInclude>();
    expectTypeOf<ClavesDeMas<ConIngredientes, Prisma.ProductoInclude>>().toEqualTypeOf<never>();
  });

  it("la fila de un movimiento es una fila del Kardex, sin columnas de más", () => {
    expectTypeOf<FilaDeMovimiento>().toExtend<Prisma.MovimientoStockCreateManyInput>();
    expectTypeOf<ClavesDeMas<FilaDeMovimiento, Prisma.MovimientoStockCreateManyInput>>().toEqualTypeOf<never>();
  });

  it("la versión que trae INCLUDE_RECETA_COMPLETA se asigna a RecetaCompleta (lo que leen los map*)", () => {
    expectTypeOf<Prisma.RecetaVersionGetPayload<{ include: typeof INCLUDE_RECETA_COMPLETA }>>().toExtend<NonNullable<RecetaCompleta>>();
    expectTypeOf<ClavesDeMas<NonNullable<RecetaCompleta>, Prisma.RecetaVersionGetPayload<{ include: typeof INCLUDE_RECETA_COMPLETA }>>>().toEqualTypeOf<never>();
  });
});
