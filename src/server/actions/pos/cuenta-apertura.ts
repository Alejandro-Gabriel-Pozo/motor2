"use server";

import { prisma } from "@/lib/db";
import { conTransaccionSerializable } from "@/core/movimientos/con-reintento";
import { esErrorDeUnicidad } from "@/core/catalogo/public-servidor";
import { validarComensales } from "@/core/pos/cuenta";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";
import { cuentaAbiertaDeSucursal } from "./cuenta-comun";

/**
 * Toma de pedido en el salón — abrir la cuenta de una mesa, corregir sus comensales, asignarle un cliente y liberar la mesa sin venta.
 * Criterio común de todas las acciones de «tomar pedido» (transacción SERIALIZABLE, mesa de la sucursal activa, cuenta abierta, sin
 * refrescar la vista) y ayudantes compartidos: ./cuenta-comun.ts.
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
 */
export async function abrirCuenta(mesaId: string, comensales: number): Promise<ResultadoAccion> {
  return conPermiso("pos_tomar_pedido", async (ctx) => {
    const mesa = typeof mesaId === "string" ? await prisma.mesa.findFirst({ where: { id: mesaId, sucursalId: ctx.sucursalId }, include: { sucursal: { select: { nombre: true, maxMesasAbiertas: true } } } }) : null;
    if (!mesa) return error("No se encontró esa mesa en esta sucursal.");
    try {
      return await conTransaccionSerializable(async (tx) => {
        const yaAbierta = await tx.cuenta.findFirst({ where: { mesaId: mesa.id, cerradaEn: null }, select: { id: true } });
        if (yaAbierta) return ok(`La mesa ${mesa.numero} ya tenía una cuenta abierta.`);

        const val = validarComensales(comensales);
        if (!val.ok) return error(val.mensaje);

        if (mesa.sucursal.maxMesasAbiertas !== null) {
          const abiertas = await tx.cuenta.count({ where: { cerradaEn: null, mesa: { sucursalId: ctx.sucursalId } } });
          if (abiertas >= mesa.sucursal.maxMesasAbiertas) {
            return error(`Se alcanzó el máximo de ${mesa.sucursal.maxMesasAbiertas} mesas abiertas en «${mesa.sucursal.nombre}». Cerrá o liberá una antes de abrir otra.`);
          }
        }

        await tx.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: ctx.usuarioId, comensales: val.comensales } });
        return ok(`Cuenta de la mesa ${mesa.numero} abierta.`);
      });
    } catch (e) {
      if (esErrorDeUnicidad(e)) return ok(`La mesa ${mesa.numero} ya tenía una cuenta abierta.`);
      throw e;
    }
  });
}

/**
 * Corrige los comensales de una cuenta que sigue ABIERTA (docs/plan-comensales-y-limite-mesas-2026-09-26.md: llega gente después, o
 * se cargó mal al abrir). Mismo permiso que abrir la cuenta. Una cuenta ya cerrada no se toca: el dato queda congelado, igual que el
 * precio de cada ítem.
 */
export async function corregirComensales(cuentaId: string, comensales: number): Promise<ResultadoAccion> {
  return conPermiso("pos_tomar_pedido", async (ctx) => {
    return conTransaccionSerializable(async (tx) => {
      const abierta = await cuentaAbiertaDeSucursal(tx, cuentaId, ctx.sucursalId);
      if (!abierta.ok) return error(abierta.mensaje);

      const val = validarComensales(comensales);
      if (!val.ok) return error(val.mensaje);

      await tx.cuenta.update({ where: { id: abierta.cuenta.id }, data: { comensales: val.comensales } });
      return ok(`Comensales de la mesa ${abierta.cuenta.mesa.numero} actualizados a ${val.comensales}.`);
    });
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
 */
export async function asignarClienteACuenta(cuentaId: string, clienteId: string | null): Promise<ResultadoAccion> {
  return conPermiso("pos_asignar_cliente", async (ctx) => {
    return conTransaccionSerializable(async (tx) => {
      const abierta = await cuentaAbiertaDeSucursal(tx, cuentaId, ctx.sucursalId);
      if (!abierta.ok) return error(abierta.mensaje);

      if (clienteId === null) {
        await tx.cuenta.update({ where: { id: abierta.cuenta.id }, data: { clienteId: null, descuentoPorcentaje: null } });
        return ok(`Se quitó el cliente de la mesa ${abierta.cuenta.mesa.numero}.`);
      }

      const cliente = typeof clienteId === "string" ? await tx.cliente.findUnique({ where: { id: clienteId } }) : null;
      if (!cliente) return error("No se encontró ese cliente.");
      if (!cliente.activo) return error(`«${cliente.nombre}» está desactivado: no se puede asignar a una cuenta.`);

      await tx.cuenta.update({ where: { id: abierta.cuenta.id }, data: { clienteId: cliente.id, descuentoPorcentaje: cliente.descuentoPorcentaje } });
      return ok(`«${cliente.nombre}» asignado a la mesa ${abierta.cuenta.mesa.numero}, con ${cliente.descuentoPorcentaje}% de descuento.`);
    });
  });
}

/**
 * Libera una mesa cuya cuenta se abrió pero quedó SIN NINGÚN ítem (se sentaron y se fueron, o se abrió por error): la cierra sin
 * venta. Con cualquier fila — aunque todo esté anulado — no: esa cuenta se cierra con `cerrarCuenta`, que deja la venta (o su
 * ausencia) registrada.
 */
export async function liberarMesa(cuentaId: string): Promise<ResultadoAccion> {
  return conPermiso("pos_tomar_pedido", async (ctx) => {
    return conTransaccionSerializable(async (tx) => {
      const abierta = await cuentaAbiertaDeSucursal(tx, cuentaId, ctx.sucursalId);
      if (!abierta.ok) return error(abierta.mensaje);
      if ((await tx.cuentaItem.count({ where: { cuentaId: abierta.cuenta.id } })) > 0) {
        return error(`La cuenta de la mesa ${abierta.cuenta.mesa.numero} tiene ítems cargados: cerrá la cuenta en vez de liberar la mesa.`);
      }
      await tx.cuenta.update({ where: { id: abierta.cuenta.id }, data: { cerradaEn: new Date(), cerradaPorId: ctx.usuarioId } });
      return ok(`Mesa ${abierta.cuenta.mesa.numero} liberada.`);
    });
  });
}
