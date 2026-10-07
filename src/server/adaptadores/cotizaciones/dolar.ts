/**
 * Las APIs de terceros del dólar oficial (Pureza Fase 4, tramo C): la ÚNICA parte de la sincronización que sale a internet. Mudadas TAL CUAL desde
 * `core/reportes/cotizacion-dolar.ts`; el cálculo que lee sus respuestas (`leerDolarApi`, `leerBcra`, `leerHistorial`) sigue siendo puro en `core`. Sin `import "server-only"`:
 * los tests las reemplazan con `vi.stubGlobal("fetch")` y no hay nada que proteger de un Client Component (no exporta secretos).
 *
 * Fuentes: hoy `dolarapi.com`, historial diario `api.argentinadatos.com` y, de respaldo, el BCRA (ver el docstring de `core/reportes/cotizacion-dolar.ts`).
 */
const URL_HOY = "https://dolarapi.com/v1/dolares/oficial";
const URL_HISTORIAL = "https://api.argentinadatos.com/v1/cotizaciones/dolares/oficial";
const URL_BCRA = "https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD";

async function pedir(url: string): Promise<unknown> {
  const resp = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!resp.ok) throw new Error(`${new URL(url).host} respondió ${resp.status}`);
  return resp.json();
}

/** La respuesta cruda de dolarapi.com (la cotización de hoy). */
export const pedirDolarDeHoy = () => pedir(URL_HOY);

/** La respuesta cruda del historial diario de argentinadatos. */
export const pedirHistorialDelDolar = () => pedir(URL_HISTORIAL);

/** La respuesta cruda del BCRA (un solo valor: la cotización de referencia). */
export const pedirDolarDelBcra = () => pedir(URL_BCRA);
