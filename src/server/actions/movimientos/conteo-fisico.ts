"use server";

import { aResultadoAccion } from "@/core/resultado-caso";
import { mensajeSeguro } from "@/lib/mensaje-seguro";
import { reportarError } from "@/lib/reportar-error";
import { guardComandoConteoFisico } from "@/core/features/movimientos/conteo-fisico.guard";
import { guardComandoCancelarConteo } from "@/core/features/movimientos/cancelar-conteo.guard";
import { guardComandoResolverConteo } from "@/core/features/movimientos/resolver-conteo.guard";
import type { ComandoConteoFisico } from "@/core/features/movimientos/conteo-fisico.schema";
import type { ComoResolverConteo } from "@/core/features/movimientos/resolver-conteo.schema";
import { requierePermiso } from "@/server/acceso/gate";
import { conPermiso } from "../con-permiso";
import { error, type ContextoDeAccion, type ResultadoAccion } from "../tipos";
import { registrarConteoFisicoCasoDeUso } from "./casos-de-uso/registrar-conteo-fisico";
import { resolverConteoPendienteCasoDeUso } from "./casos-de-uso/resolver-conteo-pendiente";
import { cancelarConteoFisicoCasoDeUso } from "./casos-de-uso/cancelar-conteo-fisico";

/** Lo que recibe `registrarConteoFisico`/`registrarConteosFisicos`. Vive en `conteo-fisico.schema.ts` (lo usa también el caso de uso). */
export type DatosConteoFisico = ComandoConteoFisico;

/**
 * Port de _registrarConteoFisicoSinRecalculo_ (Stock.js:1523-1649) — camino
 * PROPIO, no pasa por registrarMovimiento (Movimientos.js nunca lo hace
 * pasar por armarRegistroMovimiento_ tampoco). Mismo motivo que Apps
 * Script: Control es un proceso distinto de Ajuste (permite distinguir
 * "conteo físico formal" de "corrección manual suelta"), con su propia
 * bitácora (ConteoFisico) además del Kardex.
 *
 * Desde la Task #41 (Fase M, M13e1 — docs/arquitectura-casos-de-uso-2026-09-27.md; migración PARCIAL, como P1) esta Server Action es un
 * adaptador fino: permiso (`conPermiso("proceso_control")`) → formato del comando (`guardComandoConteoFisico`,
 * `core/features/movimientos/conteo-fisico.guard.ts`: sección en blanco) → caso de uso (`casos-de-uso/registrar-conteo-fisico.ts`:
 * sección propia, producto, disponibilidad, "tiene stock real", cantidad, transacción, persistencia) → `aResultadoAccion`.
 */
export async function registrarConteoFisico(datos: DatosConteoFisico): Promise<ResultadoAccion> {
  return conPermiso("proceso_control", async (ctx) => {
    const comando = guardComandoConteoFisico(datos, ctx.ahora);
    if (!comando.ok) return error(comando.mensaje);
    // S-09 (D3, defecto): aplicar la diferencia al stock es un Ajuste → `proceso_ajuste`, además de `proceso_control`. El operario registra el conteo («Falta movimiento»).
    if (comando.valor.accion === "AJUSTAR" && !(await puedeAjustar(ctx))) return error(MENSAJE_AJUSTAR_SIN_PERMISO);
    return aResultadoAccion(await registrarConteoFisicoCasoDeUso(ctx, comando.valor));
  });
}

/**
 * S-09 (plan de endurecimiento de seguridad, tanda T5; D3 del dueño sin respuesta: se ejecuta con el DEFECTO, revertible y pendiente de confirmar). Aplicar la diferencia de un conteo
 * al stock (la acción AJUSTAR del conteo, o «ajustar» al resolver un pendiente) es un Ajuste: exige `proceso_ajuste` (piso administrador) ADEMÁS de la clave del conteo
 * (`proceso_control`, o `conteo_resolver_pendiente`, ambas de piso operario). Es un segundo gate DENTRO de la acción, después de `conPermiso` y antes del caso de uso, con `ctx.db`
 * (el mismo patrón del permiso EXTRA de `agregarOActualizarUsuario`). Par de claves «equivalentes» fijado por `test/arquitectura/pares-de-piso-equivalentes.test.ts`.
 */
const MENSAJE_AJUSTAR_SIN_PERMISO =
  "Aplicar la diferencia exige el permiso de Ajuste: registralo como «Falta movimiento» y lo resuelve un administrador.";
const MENSAJE_RESOLVER_AJUSTANDO_SIN_PERMISO =
  "Ajustar el stock exige el permiso de Ajuste: pedile a un administrador que lo resuelva, o cerralo con «Ya se cargó» si el movimiento que faltaba ya está cargado.";

async function puedeAjustar(ctx: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "db">): Promise<boolean> {
  return (await requierePermiso(ctx.usuarioId, ctx.sucursalId, "proceso_ajuste", ctx.db)).ok;
}

/** Resultado de la grilla: uno por conteo, en el mismo orden en que se mandaron. */
export type ResultadoConteos = { ok: true; mensaje: string; resultados: ResultadoAccion[] } | { ok: false; mensaje: string };

/**
 * Tope de conteos por llamada. Cada conteo son 6 a 8 viajes a la base (dentro de una transacción serializable); con la función y
 * la base en regiones distintas de la nube (~70 ms por viaje) una fila puede tardar del orden de medio segundo, y la llamada tiene
 * un techo de 60 s (`maxDuration` de la página de Conteo Físico). 60 filas dejan margen aun a 1 s por fila. La pantalla manda
 * las grillas más grandes en tandas de 50.
 */
const MAX_CONTEOS_POR_LLAMADA = 60;

/**
 * Toda la grilla de Conteo Físico en UNA llamada. Antes la pantalla llamaba a `registrarConteoFisico` una vez por fila: si la
 * sesión vencía a mitad del recorrido, las filas ya escritas quedaban escritas y la persona no recibía el parcial (la
 * siguiente llamada la mandaba al login). Ahora la sesión y el permiso se comprueban UNA vez, al principio, y el recorrido
 * corre completo en el servidor. Se conserva la semántica por fila: cada conteo tiene su propia transacción y su propio
 * resultado (ok o el motivo del error), así que uno que falla no frena a los demás.
 */
export async function registrarConteosFisicos(filas: DatosConteoFisico[]): Promise<ResultadoConteos> {
  return conPermiso<ResultadoConteos>("proceso_control", async (ctx) => {
    if (!filas.length) return error("No hay conteos para registrar.");
    if (filas.length > MAX_CONTEOS_POR_LLAMADA) {
      return error(`Son demasiados conteos de una vez (${filas.length}, el máximo es ${MAX_CONTEOS_POR_LLAMADA}). Registralos en partes.`);
    }

    // El guard corre UNA VEZ POR FILA, dentro del bucle: cada fila valida su propia sección (mismo comportamiento que antes, cuando
    // cada fila pasaba por `registrarConteoConContexto` y esa función arrancaba con el mismo chequeo). La sesión y el permiso, en
    // cambio, se comprueban una sola vez para toda la tanda — ver el docstring de esta función.
    const resultados: ResultadoAccion[] = [];
    // S-09: el permiso de Ajuste se consulta UNA vez, y solo si alguna fila lo necesita; las filas AJUSTAR se rechazan una por una sin frenar a las demás («Falta movimiento», «Descartar»).
    let ajusteAutorizado: boolean | null = null;
    for (const fila of filas) {
      try {
        const comando = guardComandoConteoFisico(fila, ctx.ahora);
        if (comando.ok && comando.valor.accion === "AJUSTAR") {
          ajusteAutorizado ??= await puedeAjustar(ctx);
          if (!ajusteAutorizado) {
            resultados.push(error(MENSAJE_AJUSTAR_SIN_PERMISO));
            continue;
          }
        }
        resultados.push(comando.ok ? aResultadoAccion(await registrarConteoFisicoCasoDeUso(ctx, comando.valor)) : error(comando.mensaje));
      } catch (e) {
        // Un error inesperado de una fila (base de datos, etc.) no tira abajo la llamada entera: las filas anteriores ya están
        // escritas y hay que devolver el parcial.
        console.error(`registrarConteosFisicos: falló un conteo: ${mensajeSeguro(e)}`);
        await reportarError(e, "conteo-fisico");
        resultados.push(error("No se pudo registrar este conteo (error inesperado). Probá de nuevo."));
      }
    }

    const registrados = resultados.filter((r) => r.ok).length;
    return { ok: true, mensaje: `${registrados} de ${filas.length} conteo(s) registrado(s).`, resultados };
  });
}

/**
 * Port de resolverConteoPendiente (Stock.js:2022-2075): cierra un conteo
 * que había quedado PENDIENTE ("falta cargar un movimiento"). 'resuelto' =
 * el movimiento faltante ya se cargó, el stock se corrigió solo. 'ajustar'
 * = se busca el movimiento y no aparece — se ajusta contra el saldo de
 * HOY (no el del día del conteo, porque entre medio pudo haber más
 * movimientos).
 *
 * Gate: Apps Script no gatea esta función explícitamente (accesible solo
 * desde el panel de Conteo Físico, ya gateado a nivel menú) — acá se gatea
 * igual que registrarConteoFisico ('proceso_control'), mismo criterio que
 * "toda mutación pasa por conPermiso" (plan de migración, convenciones). S-09 (D3, defecto): la rama «ajustar» exige además `proceso_ajuste` (ver `puedeAjustar`).
 *
 * Desde la Task #41 (Fase M, M13e2 — docs/arquitectura-casos-de-uso-2026-09-27.md) esta Server Action es un adaptador fino: permiso
 * (`conPermiso("conteo_resolver_pendiente")`) → formato del comando (`guardComandoResolverConteo`) → caso de uso (`casos-de-uso/resolver-conteo-pendiente.ts`: carga del conteo, sección/estado,
 * ramas "resuelto"/"ajustar", persistencia) → `aResultadoAccion`.
 */
export async function resolverConteoPendiente(conteoId: string, comoResolver: ComoResolverConteo): Promise<ResultadoAccion> {
  return conPermiso("conteo_resolver_pendiente", async (ctx) => {
    const comando = guardComandoResolverConteo({ conteoId, comoResolver });
    if (!comando.ok) return error(comando.mensaje);
    // S-09 (D3, defecto): «ajustar» aplica la diferencia al stock → además `proceso_ajuste`. «Ya se cargó» (`resuelto`) no toca el stock y sigue con la clave de resolver.
    if (comando.valor.comoResolver === "ajustar" && !(await puedeAjustar(ctx))) return error(MENSAJE_RESOLVER_AJUSTANDO_SIN_PERMISO);
    return aResultadoAccion(await resolverConteoPendienteCasoDeUso(ctx, comando.valor.conteoId, comando.valor.comoResolver));
  });
}

/**
 * Port de cancelarConteoFisico (Stock.js:2097-2141): revierte un conteo YA
 * APLICADO ("Resuelto" — le ajustó el stock de verdad). Nunca se edita ni
 * se borra la fila original del Kardex — se escribe una fila de REVERSIÓN
 * nueva con la MISMA magnitud y signo contrario, enlazada al mismo
 * ConteoFisico (FK real — en Apps Script era el mismo "ID Operación" que
 * la fila original, correlación por string).
 *
 * Desde la Task #41 (Fase M, M13e2 — docs/arquitectura-casos-de-uso-2026-09-27.md) esta Server Action es un adaptador fino: permiso
 * (`conPermiso("cancelar_conteo")`) → formato del comando (`guardComandoCancelarConteo`) → caso de uso (`casos-de-uso/cancelar-conteo-fisico.ts`: carga del conteo, sección/estado,
 * reversión, persistencia) → `aResultadoAccion`.
 *
 * `obtenerHistorialConteosFisicos` (solo lectura) se mudó a `lecturas-conteo-fisico.ts`. Con las cuatro mutaciones de este archivo ya
 * migradas a caso de uso y la lectura mudada, `conteo-fisico.ts` no tiene ninguna otra función y **entra en `ACCIONES_CON_CASO_DE_USO`**
 * (.dependency-cruiser-excepciones.cjs).
 */
export async function cancelarConteoFisico(conteoId: string): Promise<ResultadoAccion> {
  return conPermiso("cancelar_conteo", async (ctx) => {
    const comando = guardComandoCancelarConteo({ conteoId });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await cancelarConteoFisicoCasoDeUso(ctx, comando.valor.conteoId));
  });
}
