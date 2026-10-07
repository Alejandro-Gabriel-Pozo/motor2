import "server-only";
import type { ResultadoSincronizacionDolar, ResultadoSincronizacionIPC } from "@/core/reportes/public";
import type { Db } from "@/lib/db-tipos";
import { reportarError } from "@/lib/reportar-error";
import { sincronizarDolarCasoDeUso } from "./casos-de-uso/sincronizar-dolar";
import { sincronizarIPCCasoDeUso } from "./casos-de-uso/sincronizar-ipc";

/**
 * Las sincronizaciones que corren SIN usuario (Pureza Fase 4, tramo C): los crons `/api/cron/sincronizar-dolar` y `/api/cron/sincronizar-ipc`, y el atajo del encabezado de
 * la aplicación. NO es una Server Action (sin `"use server"`: nada de acá es un endpoint que se pueda invocar directo) ni lleva `conPermiso`: el permiso es `SISTEMA`
 * (ver la `@ficha` de los casos de uso). Solo lo importan esos tres (lo vigila `test/arquitectura/sincronizaciones-solo-desde-crons-y-shell.test.ts`).
 *
 * El reloj vive ACÁ, en el borde: los casos de uso reciben `ahora`. Mismos nombres y firmas que cuando vivían en `core/reportes`.
 */

/** Guarda la cotización de hoy y rellena el historial si falta (ver `sincronizarDolarCasoDeUso`). */
export function sincronizarDolar(db: Db, ahora: Date = new Date()): Promise<ResultadoSincronizacionDolar> {
  return sincronizarDolarCasoDeUso({ db, ahora });
}

/** Trae la serie del IPC y guarda los meses nuevos (ver `sincronizarIPCCasoDeUso`). */
export function sincronizarIPC(db: Db, ahora: Date = new Date()): Promise<ResultadoSincronizacionIPC> {
  return sincronizarIPCCasoDeUso({ db, ahora });
}

const MINUTOS_ENTRE_INTENTOS = 15;
let ultimoIntentoMs = 0;

/** Solo para las pruebas: vuelve a habilitar el intento inmediato. */
export function reiniciarLimitadorDolar(): void {
  ultimoIntentoMs = 0;
}

/**
 * Se pone al día sin esperar al cron: intenta `sincronizarDolar` a lo sumo una vez cada 15 minutos por instancia del servidor (varias
 * pantallas abiertas a la vez no disparan varias sincronizaciones) y NUNCA lanza: un fallo de las APIs de terceros no puede romper la
 * pantalla desde la que se pidió. Devuelve `true` si intentó sincronizar.
 */
export async function actualizarDolarSiHaceFalta(db: Db, ahora: Date = new Date()): Promise<boolean> {
  if (process.env.MOTOR2_SIN_DOLAR_AUTOMATICO === "1") return false; // las pruebas de navegador no salen a internet
  if (ahora.getTime() - ultimoIntentoMs < MINUTOS_ENTRE_INTENTOS * 60_000) return false;
  ultimoIntentoMs = ahora.getTime();
  try {
    await sincronizarDolar(db, ahora);
  } catch (e) {
    console.error("[dolar] no se pudo actualizar la cotización:", e instanceof Error ? e.message : e);
    await reportarError(e, "dolar-autoactualizacion");
  }
  return true;
}
