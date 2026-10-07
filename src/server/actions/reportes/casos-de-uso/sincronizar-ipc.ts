import "server-only";
import { antiguedadSerieIPC, claveMes, leerSerieDeLaApi, type ResultadoSincronizacionIPC } from "@/core/reportes/public";
import { pedirSerieDelIPC } from "@/server/adaptadores/cotizaciones/ipc";
import { cargarSerieIPC } from "@/server/lecturas/reportes/serie-ipc";
import { cargarMesesDelIPC, insertarMesDelIPC } from "@/server/persistencia/reportes/indice-precio";
import type { Db } from "@/lib/db-tipos";

/**
 * Caso de uso «sincronizar el IPC» (Pureza Fase 4, tramo C): mudado TAL CUAL desde `core/reportes/indices-economicos.ts` (mismo orden, mismos textos de error). Lo invoca el cron
 * `/api/cron/sincronizar-ipc`, SIN usuario: el dato es de una fuente externa y global (`IndicePrecio`, una fila por mes). Por eso no hay permiso (`SISTEMA`) ni auditoría (la fila
 * ES su propia historia: el INDEC publica cada mes una vez).
 *
 * Trae la serie completa de la API (es chica, ~10 años de datos mensuales — no hace falta paginar ni pedir solo lo nuevo) e inserta los meses que todavía no están. NUNCA
 * reescribe un mes ya guardado — el IPC de un mes cerrado no cambia, y si alguna vez el INDEC revisa un dato, que sea una decisión explícita, no un sobrescribe silencioso de
 * este job. Devuelve además cuán vieja quedó la serie GUARDADA (se relee de la base).
 *
 * @contract Trae la serie del IPC de la API de datos.gob.ar y guarda los meses nuevos; relee la serie guardada para decir cuán vieja quedó.
 * @idempotency Por estado: solo inserta los meses que no están, así que repetir la corrida no duplica nada.
 * @transaction Ninguna: cada mes se inserta por separado (un fallo a la mitad deja los meses ya guardados, que son correctos).
 * @sideEffects Escribe IndicePrecio (un insert por mes nuevo); sale a internet (apis.datos.gob.ar).
 * @ficha permiso=SISTEMA transaccion=NINGUNA idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO
 */
export async function sincronizarIPCCasoDeUso(actor: { db: Db; ahora: Date }): Promise<ResultadoSincronizacionIPC> {
  const { db, ahora } = actor;
  const filas = leerSerieDeLaApi(await pedirSerieDelIPC());

  const mesesExistentes = new Set((await cargarMesesDelIPC(db)).map(claveMes));

  let mesesNuevos = 0;
  let ultimoMesDisponible: string | null = null;
  for (const fila of filas) {
    const clave = claveMes(fila.mes);
    if (!ultimoMesDisponible || clave > ultimoMesDisponible) ultimoMesDisponible = clave;
    if (mesesExistentes.has(clave)) continue;
    await insertarMesDelIPC(db, fila);
    mesesNuevos++;
  }
  return { mesesNuevos, ultimoMesDisponible, antiguedad: antiguedadSerieIPC(await cargarSerieIPC(db), ahora) };
}
