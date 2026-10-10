import { quitarCaracteresInadmisibles } from "@/core/texto";

/**
 * Los `searchParams` que Next entrega a una página son `string | string[] | undefined` por clave: `?desde=a&desde=b` llega como arreglo.
 * Tiparlos como `{ desde?: string }` es mentir (el código llamaría `.trim()` o compararía un arreglo creyendo que es texto), así que las
 * páginas los declaran con `ParametrosDeUrl<"desde" | …>` y los pasan por `unicosDeUrl`, que se queda con el primer valor de cada clave
 * (test/arquitectura/parametros-de-url.test.ts lo exige).
 */
export type ParametrosDeUrl<K extends string> = Partial<Record<K, string | string[]>>;

/**
 * Además, cada valor sale SIN los caracteres que Postgres no recibe (un NUL, que se escribe `%00` en la URL; ver `quitarCaracteresInadmisibles`): un `?q=%00`, un `?productoId=%00` o un
 * `?cursor=%00` llegaban tal cual a una consulta y daban 500. Es el único punto por el que pasan los parámetros de toda página, así que es el lugar donde se corta para todas.
 */
export function unicosDeUrl<K extends string>(parametros: ParametrosDeUrl<K>): Partial<Record<K, string>> {
  const unicos: Partial<Record<K, string>> = {};
  for (const clave of Object.keys(parametros) as K[]) {
    const valor: string | string[] | undefined = parametros[clave];
    const primero = Array.isArray(valor) ? valor[0] : valor;
    if (primero !== undefined) (unicos as Record<string, string>)[clave] = quitarCaracteresInadmisibles(primero);
  }
  return unicos;
}
