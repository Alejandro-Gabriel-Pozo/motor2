/**
 * Los `searchParams` que Next entrega a una página son `string | string[] | undefined` por clave: `?desde=a&desde=b` llega como arreglo.
 * Tiparlos como `{ desde?: string }` es mentir (el código llamaría `.trim()` o compararía un arreglo creyendo que es texto), así que las
 * páginas los declaran con `ParametrosDeUrl<"desde" | …>` y los pasan por `unicosDeUrl`, que se queda con el primer valor de cada clave
 * (test/arquitectura/parametros-de-url.test.ts lo exige).
 */
export type ParametrosDeUrl<K extends string> = Partial<Record<K, string | string[]>>;

export function unicosDeUrl<K extends string>(parametros: ParametrosDeUrl<K>): Partial<Record<K, string>> {
  const unicos: Partial<Record<K, string>> = {};
  for (const clave of Object.keys(parametros) as K[]) {
    const valor: string | string[] | undefined = parametros[clave];
    const primero = Array.isArray(valor) ? valor[0] : valor;
    if (primero !== undefined) (unicos as Record<string, string>)[clave] = primero;
  }
  return unicos;
}
