import type { DiferenciaDePrecio, GrupoPermitido, ModoDePrecioDeMedida, OpcionParaPrecio, OpcionPermitida } from "@/core/opciones/public";

/**
 * El precio de UNA opción elegida por prioridad, en la forma que pide `componerPrecioDeLinea` (ola «precio y carta», Fase 2, C4): la ÚNICA función que lo decide, para la
 * venta (`armarLineaConfigurada`, `linea-configurada.ts`) y para los precios para mostrar (`precio-de-configuracion.ts`). Antes había dos copias idénticas (una «espejo»
 * de la otra) y la paridad la sostenía solo `test/pos/precio-de-configuracion.test.ts`.
 *
 * La regla (paso 2 del docstring de `linea-configurada.ts`): la diferencia del producto le gana a la de la versión; en una MEDIDA en ABSOLUTO, la grilla de la sucursal le
 * gana al precio absoluto del producto.
 *
 * Archivo aparte a propósito: lo usa el CLIENTE (la vista previa del diálogo de opciones, por `core/pos/public.ts` → `precio-de-configuracion.ts`), y `linea-configurada.ts`
 * arrastra `node:crypto` (`huellaDeOpciones`), que en el navegador es `crypto-browserify` y la CSP lo bloquea. Por eso este archivo NO importa valores de
 * `linea-configurada.ts` (lo vigila `fachadas-publicas-sin-io.test.ts`, con un caso propio de este archivo); y tampoco sus tipos: `linea-configurada.ts` lo importa a él, y
 * un `import type` de vuelta sería un ciclo, que la regla `sin-ciclos` de dependency-cruiser no deja pasar ni de solo tipos. Las dos formas de abajo son la PARTE de
 * `GrupoParaVender` y de `OpcionParaVender` que el precio lee: el compilador comprueba en cada llamada que las de la venta las cumplen.
 */

/** Lo que el precio de una opción lee de su GRUPO (una parte de `GrupoParaVender`). */
interface GrupoDeLaOpcion extends Pick<GrupoPermitido, "tipo"> {
  modoPrecio: ModoDePrecioDeMedida | null;
}

/** Lo que el precio lee de la OPCIÓN (una parte de `OpcionParaVender`; ahí está qué es cada campo). */
interface OpcionConSusPrecios extends Pick<OpcionPermitida, "opcionId" | "nombre" | "versionVigenteId" | "esNinguna"> {
  factorEscala: number | null;
  precioAbsoluto: number | null;
  precioDeSucursal: number | null;
  diferenciaDelProducto: DiferenciaDePrecio | null;
  diferenciaDeLaVersion: DiferenciaDePrecio;
}

export function opcionParaPrecio(grupo: GrupoDeLaOpcion, opcion: OpcionConSusPrecios, cantidad: number): OpcionParaPrecio {
  const base = { opcionId: opcion.opcionId, versionDeOpcionId: opcion.versionVigenteId, nombre: opcion.nombre, tipo: grupo.tipo, cantidad };
  if (grupo.tipo === "MEDIDA") {
    if (grupo.modoPrecio === "ABSOLUTO") {
      const precioDeSucursal = opcion.precioDeSucursal !== null;
      return { ...base, factorEscala: opcion.factorEscala, modoPrecio: "ABSOLUTO", precioAbsoluto: precioDeSucursal ? opcion.precioDeSucursal : opcion.precioAbsoluto, precioDeSucursal, diferencia: null };
    }
    return { ...base, factorEscala: opcion.factorEscala, modoPrecio: grupo.modoPrecio, precioAbsoluto: null, diferencia: opcion.diferenciaDelProducto ?? opcion.diferenciaDeLaVersion };
  }
  // «Ninguna» en VARIANTE o INCLUIDA: importe 0, sin diferencia. Un precio absoluto en algo que no es MEDIDA es una configuración inválida: se pasa para que la
  // composición lo rechace (`PRECIO_DE_OPCION_INVALIDO`), nunca se ignora en silencio. El factor de una versión que no es MEDIDA, ídem.
  return { ...base, factorEscala: opcion.factorEscala, modoPrecio: null, precioAbsoluto: opcion.precioAbsoluto, diferencia: opcion.esNinguna ? null : (opcion.diferenciaDelProducto ?? opcion.diferenciaDeLaVersion) };
}
