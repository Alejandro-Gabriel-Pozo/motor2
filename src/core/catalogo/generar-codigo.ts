import { esChoqueDeIndiceUnico } from "@/core/datos/errores-de-base";
import type { FuenteDeAzar } from "@/core/seguridad/azar";

/**
 * Genera un código optimista (`${prefijo}_<uuid6>`) y deja que el UNIQUE
 * constraint de Postgres sea el árbitro final — reemplaza
 * resolverColisionDeCodigoTrasAlta_ (Catalogo.js:1018-1033): en Sheets
 * había que detectar la colisión DESPUÉS de escribir, porque no había
 * ningún UNIQUE real y dos hosterías (proyectos Apps Script separados, sin
 * lock cross-proyecto) podían escribir el mismo código en simultáneo. Acá
 * el INSERT simplemente falla con P2002 si dos requests generan el mismo
 * código a la vez — se reintenta con uno nuevo, nunca se corrompe una fila
 * ajena.
 *
 * Si se pasa `codigoManual`, se usa tal cual y se intenta UNA sola vez — el
 * P2002 en ese caso es un error de negocio real ("ya existe ese código"),
 * no algo para reintentar en silencio.
 */
export async function crearConCodigoAutogenerado<T>(
  prefijo: string,
  codigoManual: string | undefined,
  intentar: (codigo: string) => Promise<T>,
  azar: FuenteDeAzar,
  maxIntentos = 5
): Promise<T> {
  if (codigoManual) return intentar(codigoManual);

  for (let intento = 0; intento < maxIntentos; intento++) {
    const codigo = `${prefijo}_${azar.uuid().slice(0, 6)}`;
    try {
      return await intentar(codigo);
    } catch (e) {
      const esColision = esErrorDeUnicidad(e);
      if (esColision && intento < maxIntentos - 1) continue;
      throw e;
    }
  }
  throw new Error("No se pudo generar un código único tras varios intentos.");
}

/**
 * true si `e` es un choque de UNIQUE constraint de Postgres — sirve tanto para código duplicado como para una versión de receta chocada en carrera, un nombre repetido, etc. Desde O.48
 * (Hito 5) reconoce las DOS formas en que el adaptador `pg` entrega el mismo choque (`P2002` y el `DriverAdapterError` crudo con `UniqueConstraintViolation`): es la misma clasificación que
 * `esChoqueDeIndiceUnico` (`core/datos/errores-de-base.ts`), no una copia. Antes solo veía `P2002` y un choque con la otra forma salía como fallo genérico en lugar del mensaje de negocio.
 */
export function esErrorDeUnicidad(e: unknown): boolean {
  return esChoqueDeIndiceUnico(e);
}
