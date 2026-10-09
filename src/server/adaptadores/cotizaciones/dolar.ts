/**
 * Las APIs de terceros del dólar oficial (Pureza Fase 4, tramo C): la ÚNICA parte de la sincronización que sale a internet. Mudadas TAL CUAL desde
 * `core/reportes/cotizacion-dolar.ts`; el cálculo que lee sus respuestas (`leerDolarApi`, `leerBcra`, `leerHistorial`) sigue siendo puro en `core`. Sin `import "server-only"`:
 * los tests las reemplazan con `vi.stubGlobal("fetch")` y no hay nada que proteger de un Client Component (no exporta secretos).
 *
 * Fuentes: hoy `dolarapi.com`, historial diario `api.argentinadatos.com` y, de respaldo, el BCRA (ver el docstring de `core/reportes/cotizacion-dolar.ts`).
 */
import { pedirJsonAcotado } from "../pedir-json-acotado";

const URL_HOY ="https://dolarapi.com/v1/dolares/oficial";
const URL_HISTORIAL = "https://api.argentinadatos.com/v1/cotizaciones/dolares/oficial";
const URL_BCRA = "https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD";

// S-30: los pedidos van por `pedirJsonAcotado` (host fijo, sin redirecciones, con tope de tamaño). Una cotización de hoy o del BCRA son unos pocos cientos de bytes; el historial
// diario desde 2011 son ~5.500 filas de ~90 bytes (~0,5 MB): 2 MB deja margen y corta una respuesta de varios MB.
const TOPE_DE_UN_VALOR = 64 * 1024;
const TOPE_DEL_HISTORIAL = 2 * 1024 * 1024;

/** La respuesta cruda de dolarapi.com (la cotización de hoy). */
export const pedirDolarDeHoy = () => pedirJsonAcotado(URL_HOY, { hostsPermitidos: ["dolarapi.com"], maxBytes: TOPE_DE_UN_VALOR });

/** La respuesta cruda del historial diario de argentinadatos. */
export const pedirHistorialDelDolar = () => pedirJsonAcotado(URL_HISTORIAL, { hostsPermitidos: ["api.argentinadatos.com"], maxBytes: TOPE_DEL_HISTORIAL });

/** La respuesta cruda del BCRA (un solo valor: la cotización de referencia). */
export const pedirDolarDelBcra = () => pedirJsonAcotado(URL_BCRA, { hostsPermitidos: ["api.bcra.gob.ar"], maxBytes: TOPE_DE_UN_VALOR });
