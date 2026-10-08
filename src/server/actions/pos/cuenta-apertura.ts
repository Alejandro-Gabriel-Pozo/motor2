"use server";

import {
  guardComandoAbrirCuenta,
  guardComandoAsignarClienteACuenta,
  guardComandoCorregirComensales,
  guardComandoLiberarMesa,
} from "@/core/features/cuentas/cuenta-apertura.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermiso } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";
import { abrirCuentaCasoDeUso } from "./casos-de-uso/abrir-cuenta";
import { asignarClienteACuentaCasoDeUso } from "./casos-de-uso/asignar-cliente-a-cuenta";
import { corregirComensalesCasoDeUso } from "./casos-de-uso/corregir-comensales";
import { liberarMesaCasoDeUso } from "./casos-de-uso/liberar-mesa";

/**
 * Toma de pedido en el salón — abrir la cuenta de una mesa, corregir sus comensales, asignarle un cliente y liberar la mesa sin venta.
 * Criterio común de todas las acciones de «tomar pedido» (transacción SERIALIZABLE, mesa de la sucursal activa, cuenta abierta, sin
 * refrescar la vista) y ayudantes compartidos: ./cuenta-comun.ts. Desde el Hito 4 de la pureza (bloque 4.1) cada acción es un adaptador fino de su
 * caso de uso (./casos-de-uso/{abrir-cuenta,corregir-comensales,asignar-cliente-a-cuenta,liberar-mesa}.ts).
 */

/**
 * Abre la cuenta de una mesa libre, con la cantidad de comensales que se sentaron (docs/plan-comensales-y-limite-mesas-2026-09-26.md;
 * `validarComensales` — obligatorio, sin default, solo mide rotación, no divide la cuenta). A lo sumo una abierta por mesa (índice
 * único parcial `Cuenta_una_abierta_por_mesa_key`): si otro mozo la abrió un instante antes, el choque (P2002) no es un error para
 * quien llega segundo — la mesa ya tiene su cuenta, que es lo que quería.
 *
 * Idempotencia PRIMERO, dentro de la misma transacción: si la mesa ya tenía una cuenta abierta se devuelve ok sin tocar nada — ni
 * valida `comensales` (conserva el de la primera apertura) ni chequea el límite de la sucursal (§ siguiente): reabrir la MISMA mesa
 * nunca puede fallar por el límite.
 *
 * Límite de mesas abiertas (`Sucursal.maxMesasAbiertas`, D6 del plan: bloqueo en seco, sin excepción): se cuentan las `Cuenta` con
 * `cerradaEn IS NULL` de la sucursal DENTRO de esta misma transacción SERIALIZABLE que crea la nueva — dos aperturas a mesas
 * DISTINTAS que juntas superarían el límite chocan como cualquier otra escritura en conflicto (Postgres aborta una y se reintenta,
 * `conTransaccionSerializable`), nunca las dos pasan.
 *
 * Desde el Hito 4 de la pureza (bloque 4.1, paso 8) esta Server Action es un adaptador fino: permiso (`conPermiso("pos_abrir_cuenta")`) → formato del
 * `mesaId` (`guardComandoAbrirCuenta`, DENTRO del envoltorio) → caso de uso (`casos-de-uso/abrir-cuenta.ts`: la mesa fuera de la transacción, la transacción
 * serializable con la idempotencia, los comensales y el límite, la escritura en server/persistencia/pos/cuenta.ts y el choque del índice único) →
 * `aResultadoAccion`. Con `corregirComensales`, `asignarClienteACuenta` y `liberarMesa` (pasos 5 a 7) también migradas, el archivo entero está en
 * `ACCIONES_CON_CASO_DE_USO`.
 */
export async function abrirCuenta(mesaId: string, comensales: number): Promise<ResultadoAccion> {
  return conPermiso("pos_abrir_cuenta", async (ctx) => {
    const comando = guardComandoAbrirCuenta({ mesaId, comensales });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await abrirCuentaCasoDeUso(ctx, comando.valor));
  });
}

/**
 * Corrige los comensales de una cuenta que sigue ABIERTA (docs/plan-comensales-y-limite-mesas-2026-09-26.md: llega gente después, o
 * se cargó mal al abrir). Mismo permiso que abrir la cuenta. Una cuenta ya cerrada no se toca: el dato queda congelado, igual que el
 * precio de cada ítem.
 *
 * Desde el Hito 4 de la pureza (bloque 4.1, paso 6) esta Server Action es un adaptador fino: permiso (`conPermiso("pos_abrir_cuenta")`) → formato del
 * `cuentaId` (`guardComandoCorregirComensales`, DENTRO del envoltorio) → caso de uso (`casos-de-uso/corregir-comensales.ts`: transacción serializable, la
 * cuenta abierta, los comensales y la escritura en server/persistencia/pos/cuenta.ts) → `aResultadoAccion`.
 */
export async function corregirComensales(cuentaId: string, comensales: number): Promise<ResultadoAccion> {
  return conPermiso("pos_abrir_cuenta", async (ctx) => {
    const comando = guardComandoCorregirComensales({ cuentaId, comensales });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await corregirComensalesCasoDeUso(ctx, comando.valor));
  });
}

/**
 * Asigna (o quita, con `clienteId: null`) el cliente con descuento de una cuenta ABIERTA (Task #14, docs/plan-clientes-descuento-
 * 2026-09-26.md, D3): CUALQUIER mozo con `pos_asignar_cliente` (que se semilla junto con `pos_tomar_pedido` — no hace falta ser
 * admin), en cualquier momento antes de cerrarla, tantas veces como haga falta (se cargó mal, el cliente se bajó, etc.).
 *
 * El % SE CONGELA en `Cuenta.descuentoPorcentaje` en este momento (D7, snapshot de `Cliente.descuentoPorcentaje`): si el % del
 * cliente cambia después con la cuenta todavía abierta, esta cuenta no se entera — solo una nueva asignación (con este mismo cliente
 * o corrigiendo el error) lo actualiza. Quitar el cliente (`null`) limpia los dos campos: la cuenta vuelve a cobrar precio de lista.
 *
 * `activo: false` bloquea asignar un cliente DESACTIVADO (no tiene sentido dar de alta un descuento nuevo con un cliente que ya no
 * se usa) — pero no bloquea QUITARLO de una cuenta que ya lo tenía asignado, ni cerrar una cuenta que ya lo tiene: desactivar un
 * cliente nunca revierte una cuenta en curso.
 *
 * Quién puso (o sacó) un cliente con descuento queda en la auditoría (dos filas: cliente y % congelado): la `Operacion` de la venta solo guarda a quien cerró
 * la cuenta. Desde el Hito 4 de la pureza (bloque 4.1, paso 7) esta Server Action es un adaptador fino: permiso (`conPermiso("pos_asignar_cliente")`) →
 * formato del `cuentaId` (`guardComandoAsignarClienteACuenta`, DENTRO del envoltorio) → caso de uso (`casos-de-uso/asignar-cliente-a-cuenta.ts`: transacción
 * serializable, la cuenta abierta, el cliente, la escritura en server/persistencia/pos/cuenta.ts y las dos filas de auditoría) → `aResultadoAccion`.
 */
export async function asignarClienteACuenta(cuentaId: string, clienteId: string | null): Promise<ResultadoAccion> {
  return conPermiso("pos_asignar_cliente", async (ctx) => {
    const comando = guardComandoAsignarClienteACuenta({ cuentaId, clienteId });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await asignarClienteACuentaCasoDeUso(ctx, comando.valor));
  });
}

/**
 * Libera una mesa cuya cuenta se abrió pero quedó SIN NINGÚN ítem (se sentaron y se fueron, o se abrió por error): la cierra sin
 * venta. Con cualquier fila — aunque todo esté anulado — no: esa cuenta se cierra con `cerrarCuenta`, que deja la venta (o su
 * ausencia) registrada.
 *
 * `cerradaEn` es la hora del PEDIDO (`ctx.ahora`, la que fija `conPermiso` una vez; Pureza 1.2), igual que en `cerrarCuenta`: antes leía el reloj por su
 * cuenta (`new Date()`). Cambio aprobado por el dueño (Hito 4, 2026-10-08); lo fija `test/pos/liberar-mesa-hora-del-pedido.test.ts`.
 *
 * Desde el Hito 4 de la pureza (bloque 4.1, paso 5) esta Server Action es un adaptador fino: permiso (`conPermiso("pos_liberar_mesa")`) → formato del
 * `cuentaId` (`guardComandoLiberarMesa`, core/features/cuentas/cuenta-apertura.guard.ts, DENTRO del envoltorio) → caso de uso (`casos-de-uso/liberar-mesa.ts`:
 * transacción serializable, la cuenta abierta, que no tenga filas y el cierre en server/persistencia/pos/) → `aResultadoAccion`.
 */
export async function liberarMesa(cuentaId: string): Promise<ResultadoAccion> {
  return conPermiso("pos_liberar_mesa", async (ctx) => {
    const comando = guardComandoLiberarMesa({ cuentaId });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await liberarMesaCasoDeUso(ctx, comando.valor));
  });
}
