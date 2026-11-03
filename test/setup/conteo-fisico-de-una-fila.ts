import { registrarConteosFisicos, type DatosConteoFisico } from "../../src/server/actions/movimientos/conteo-fisico";
import type { ResultadoAccion } from "../../src/server/actions/tipos";

/**
 * Registra UN conteo físico por el mismo camino que la pantalla: `registrarConteosFisicos([datos])` (la grilla con una sola fila). La acción de un solo conteo
 * (`registrarConteoFisico`) se retiró porque ninguna pantalla la usaba; los tests que probaban el conteo de a uno siguen pudiendo hacerlo con este ayudante,
 * que devuelve lo mismo que devolvía aquella: el `ResultadoAccion` de la fila única, o el rechazo de la llamada entera (permiso, límite de tasa) si no se
 * llegó a procesar la fila. Lo de sesión vencida sigue siendo la excepción de redirección al login, que se propaga igual.
 */
export async function registrarUnConteoFisico(datos: DatosConteoFisico): Promise<ResultadoAccion> {
  const r = await registrarConteosFisicos([datos]);
  return r.ok ? r.resultados[0] : r;
}
