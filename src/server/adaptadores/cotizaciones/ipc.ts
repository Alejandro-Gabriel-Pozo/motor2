/**
 * La API de series de tiempo del Ministerio de Economía (datos.gob.ar), de donde sale el IPC (Pureza Fase 4, tramo C): la ÚNICA parte de la sincronización del IPC que sale a
 * internet. Mudada TAL CUAL desde `core/reportes/indices-economicos.ts`; el cálculo que lee su respuesta (`leerSerieDeLaApi`) sigue siendo puro en `core`. Sin
 * `import "server-only"`: los tests la reemplazan con `vi.stubGlobal("fetch")`.
 *
 * Serie elegida: IPC GBA Nivel General, base dic-2016 (101.1_I2NG_2016_M_22) — republicada sin API key, verificada real (no documentación genérica) el 2026-09-17:
 * `curl "https://apis.datos.gob.ar/series/api/series/?ids=101.1_I2NG_2016_M_22&format=json"` devuelve datos reales, mes más reciente publicado con el rezago habitual de
 * ~1 mes del INDEC.
 */
import { pedirJsonAcotado } from "../pedir-json-acotado";

const SERIE_IPC_GBA_NIVEL_GENERAL ="101.1_I2NG_2016_M_22";
// `limit` explícito a propósito: sin él, la API devuelve como máximo 100 filas en orden ASCENDENTE (las más viejas primero) — verificado real el 2026-09-17, truncaba la serie
// completa (125 meses) justo antes de llegar a los meses recientes. 5000 cubre >400 años de datos mensuales, nunca va a ser el límite real.
const URL_API_SERIES = `https://apis.datos.gob.ar/series/api/series/?ids=${SERIE_IPC_GBA_NIVEL_GENERAL}&format=json&limit=5000`;

// S-30: por `pedirJsonAcotado` (host fijo, sin redirecciones, con tope de tamaño). La serie completa son ~125 filas (~10 KB); 1 MB deja margen de sobra y corta una respuesta de varios MB.
const TOPE_DE_LA_SERIE = 1024 * 1024;

/** La respuesta cruda de la API: la serie completa (es chica, ~10 años de datos mensuales: no hace falta paginar ni pedir solo lo nuevo). */
export function pedirSerieDelIPC(): Promise<unknown> {
  return pedirJsonAcotado(URL_API_SERIES, { hostsPermitidos: ["apis.datos.gob.ar"], maxBytes: TOPE_DE_LA_SERIE });
}
