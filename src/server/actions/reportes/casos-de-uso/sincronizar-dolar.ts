import "server-only";
import {
  cotizacionPlausible,
  leerBcra,
  leerDolarApi,
  leerHistorial,
  mensajeDeCotizacionDescartada,
  planDeRelleno,
  type CotizacionDia,
  type ResultadoSincronizacionDolar,
} from "@/core/reportes/public";
import { pedirDolarDeHoy, pedirDolarDelBcra, pedirHistorialDelDolar } from "@/server/adaptadores/cotizaciones/dolar";
import { cargarCotizacionAnterior, cargarUltimaCotizacionBna, guardarDiaDeCotizacion } from "@/server/persistencia/reportes/cotizacion-dolar";
import type { Db } from "@/lib/db-tipos";

/**
 * Caso de uso «sincronizar el dólar oficial» (Pureza Fase 4, tramo C): mudado TAL CUAL desde `core/reportes/cotizacion-dolar.ts` (mismo orden, mismos textos de error). Lo
 * invocan el cron `/api/cron/sincronizar-dolar` y el atajo del encabezado de la aplicación (`actualizarDolarSiHaceFalta`), SIN usuario: el dato es de una fuente externa y global
 * (`CotizacionDolar`, una fila por día). Por eso no hay permiso (`SISTEMA`) ni auditoría (la fila ES su propia historia: una cotización por día y fuente, que nadie edita a mano).
 *
 * Guarda la cotización de hoy (la del día se ACTUALIZA: queda la última corrida) y, si la tabla está vacía o el último día guardado es viejo, rellena antes el historial desde
 * argentinadatos. Un fallo de una fuente no tira abajo la corrida: se prueba la siguiente y los errores se devuelven. Si NINGUNA fuente da la cotización de hoy y no se
 * rellenó nada, lanza (el cron responde 502). Una cotización que se aparta más de 20% de la última guardada solo se acepta si otra fuente independiente la confirma
 * (informe de seguridad S-19).
 *
 * @contract Trae el dólar oficial de las APIs de terceros y lo guarda por día; rellena el historial si falta y descarta un salto absurdo que ninguna otra fuente confirma.
 * @idempotency Por estado: el guardado es un upsert por (día, fuente), así que repetir la corrida no duplica nada.
 * @transaction Ninguna: cada día se guarda por separado (un fallo a la mitad del relleno deja los días ya guardados, que son correctos).
 * @sideEffects Escribe CotizacionDolar (upsert por día y fuente); sale a internet (dolarapi.com, argentinadatos.com, BCRA).
 * @ficha permiso=SISTEMA transaccion=NINGUNA idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO
 */
export async function sincronizarDolarCasoDeUso(actor: { db: Db; ahora: Date }): Promise<ResultadoSincronizacionDolar> {
  const { db, ahora } = actor;
  const errores: string[] = [];
  let diasRellenados = 0;

  const ultima = await cargarUltimaCotizacionBna(db);
  const relleno = planDeRelleno(ultima?.fecha ?? null, ahora);
  if (relleno.rellenar) {
    try {
      for (const dia of leerHistorial(await pedirHistorialDelDolar(), relleno.desde)) {
        await guardarDiaDeCotizacion(db, dia);
        diasRellenados++;
      }
    } catch (e) {
      errores.push(`historial: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  let hoy: CotizacionDia | null = null;
  try {
    hoy = leerDolarApi(await pedirDolarDeHoy(), ahora);
    if (!hoy) errores.push("dolarapi.com no trajo una cotización válida");
  } catch (e) {
    errores.push(`dolarapi.com: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!hoy) {
    try {
      hoy = leerBcra(await pedirDolarDelBcra());
      if (!hoy) errores.push("BCRA no trajo una cotización válida");
    } catch (e) {
      errores.push(`BCRA: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (hoy) {
    const previa = await cargarCotizacionAnterior(db, hoy.fecha);
    if (!cotizacionPlausible(hoy.venta, previa, ahora)) {
      let confirmacion: number | null = null;
      try {
        const otra = hoy.fuente === "BNA" ? leerBcra(await pedirDolarDelBcra()) : leerDolarApi(await pedirDolarDeHoy(), ahora);
        confirmacion = otra?.venta ?? null;
      } catch {
        // sin segunda fuente no hay confirmación: el salto se descarta
      }
      if (!cotizacionPlausible(hoy.venta, previa, ahora, confirmacion)) {
        errores.push(mensajeDeCotizacionDescartada(hoy.venta, previa?.venta));
        hoy = null;
      }
    }
  }
  if (hoy) await guardarDiaDeCotizacion(db, hoy);
  else if (diasRellenados === 0) throw new Error(`No se pudo obtener el dólar: ${errores.join("; ")}`);

  return { diasRellenados, hoy, fuente: hoy?.fuente ?? null, errores };
}
