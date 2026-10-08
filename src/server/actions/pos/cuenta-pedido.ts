"use server";

import type { Prisma } from "@prisma/client";
import { redondearMoneda } from "@/core/moneda";
import { tieneStockReal } from "@/core/movimientos/public";
import { resolverPrecioVenta, conTransaccionSerializable } from "@/core/movimientos/public-servidor";
import { aplicarDescuentoDeProducto } from "@/core/carta/public";
import { descuentosDeProductoEnSucursal } from "@/server/lecturas/carta/descuentos";
import { productoDisponibleEn } from "@/server/lecturas/catalogo/disponibilidad";
import { MAXIMO_ITEMS_POR_AGREGADO, validarCantidadPedido } from "@/core/pos/cantidad-pedido";
import { componentesDeEleccion, prorratearPrecioPromo, validarEleccionPromo, type ComponentePromoElegido, type EleccionDeCupo, type FilaPromoProrrateada } from "@/core/pos/promo-combo";
import { cargarPromoCartaParaAgregar } from "@/server/lecturas/pos/promo-para-agregar";
import { guardComandoEnviarACocina, guardComandoQuitarItemSinEnviar, guardComandoQuitarPromoSinEnviar } from "@/core/features/cuentas/cuenta-pedido.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion, type ResultadoEnvioACocina } from "../tipos";
import { enviarACocinaCasoDeUso } from "./casos-de-uso/enviar-a-cocina";
import { quitarItemSinEnviarCasoDeUso } from "./casos-de-uso/quitar-item-sin-enviar";
import { quitarPromoSinEnviarCasoDeUso } from "./casos-de-uso/quitar-promo-sin-enviar";
import { cuentaAbiertaDeSucursal } from "./cuenta-comun";

/**
 * Toma de pedido en el salón — cargar el pedido: agregar ítems y promos sin enviar, quitarlos mientras no salieron y enviarlos a cocina.
 * Criterio común de todas las acciones de «tomar pedido» (transacción SERIALIZABLE, mesa de la sucursal activa, cuenta abierta, sin
 * refrescar la vista) y ayudantes compartidos: ./cuenta-comun.ts.
 */

// MAXIMO_ITEMS_POR_AGREGADO vive en @/core/pos/cantidad-pedido (pura): así el cliente puede deshabilitar sumar el ítem #51 con el
// MISMO número, sin duplicarlo. El tope de un envío a cocina (200) vive en su guard (core/features/cuentas/cuenta-pedido.guard.ts).

/** Una promo armada por el mozo, para el tercer parámetro de `agregarItems` (Task #16, docs/plan-promo-combo-2026-09-26.md, paso 8a). */
export interface PromoParaAgregar {
  promoCartaId: string;
  elecciones: EleccionDeCupo[];
}

/**
 * Agrega ítems SIN ENVIAR a una cuenta abierta: todo o nada. Cada producto tiene que ser un PV disponible en la sucursal; la cantidad
 * se valida y redondea a los decimales de su unidad (`validarCantidadPedido`). El precio se CONGELA acá (Precio Local habilitado o, si
 * no, el global — `resolverPrecioVenta`): es el que se cobra al cerrar la cuenta aunque cambie después.
 *
 * `promos` (Task #16, tercer parámetro OPCIONAL): cada promo se re-valida servidor-side con la MISMA fuente que el selector
 * (`cargarPromoCartaParaAgregar`, D5) — nunca se confía en lo que mandó el cliente sobre cupos/elegibles/precios —, se prorratea
 * (D3, `prorratearPrecioPromo`) y entra como una `PromoCuenta` nueva más sus `CuentaItem` componentes, cada uno con
 * `promoCuentaId` y `precioCartaUnitario`. TODA la validación (de los ítems sueltos Y de las promos) ocurre ANTES de la primera
 * escritura, mismo criterio que `registrarVentaEnTx`: un rechazo no deja nada escrito, sin importar en qué promo/ítem ocurrió.
 * `MAXIMO_ITEMS_POR_AGREGADO` cuenta también los componentes de cada promo (una elección con 3 productos elegidos cuenta 3),
 * no las promos en sí.
 */
export async function agregarItems(cuentaId: string, items: { productoId: string; cantidad: number }[], promos?: PromoParaAgregar[]): Promise<ResultadoAccion> {
  return conPermiso("pos_tomar_pedido", async (ctx) => {
    const items_ = Array.isArray(items) ? items : [];
    const promos_ = Array.isArray(promos) ? promos : [];
    if (items_.length === 0 && promos_.length === 0) return error("Elegí al menos un producto.");
    const cantidadDeLineas = items_.length + promos_.reduce((suma, p) => suma + componentesDeEleccion(Array.isArray(p?.elecciones) ? p.elecciones : []).length, 0);
    if (cantidadDeLineas > MAXIMO_ITEMS_POR_AGREGADO) return error(`No se pueden agregar más de ${MAXIMO_ITEMS_POR_AGREGADO} ítems de una vez.`);

    return conTransaccionSerializable(ctx.transaccion, async (tx) => {
      const abierta = await cuentaAbiertaDeSucursal(tx, cuentaId, ctx.sucursalId);
      if (!abierta.ok) return error(abierta.mensaje);

      // Fase 1: VALIDAR todo, sin escribir nada — ni los sueltos ni las promos (mismo criterio que registrarVentaEnTx).
      const filasSueltas: Prisma.CuentaItemCreateManyInput[] = [];
      for (const item of items_) {
        const producto = typeof item?.productoId === "string" ? await tx.producto.findUnique({ where: { id: item.productoId }, include: { unidadStock: { select: { decimales: true } } } }) : null;
        if (!producto) return error("El producto no existe.");
        if (producto.tipo !== "PV") return error(`«${producto.nombre}» no se puede pedir: solo se piden productos de venta (PV).`);
        if (!(await productoDisponibleEn(ctx.sucursalId, producto.id, tx))) return error(`«${producto.nombre}» no está disponible en «${ctx.sucursalNombre}».`);
        const paso = producto.pasoVenta !== null ? { pasoVenta: Number(producto.pasoVenta), tieneStockReal: tieneStockReal(producto.tipo, producto.seProduce) } : null;
        const cantidad = validarCantidadPedido(item.cantidad, producto.unidadStock.decimales, paso);
        if (!cantidad.ok) return error(`«${producto.nombre}»: ${cantidad.mensaje}`);
        const precioDeLista = redondearMoneda(await resolverPrecioVenta(ctx.sucursalId, producto.id, Number(producto.precioVenta), tx));
        // Producto con descuento (Fase 2): el descuento de ESTA sucursal se aplica acá y el precio de lista queda congelado aparte en `precioCartaUnitario`.
        const aplicado = aplicarDescuentoDeProducto(precioDeLista, (await descuentosDeProductoEnSucursal(ctx.sucursalId, tx, [producto.id])).get(producto.id) ?? null);
        filasSueltas.push({
          cuentaId: abierta.cuenta.id,
          productoId: producto.id,
          cantidad: cantidad.cantidad,
          precioUnitario: aplicado.precio,
          precioCartaUnitario: aplicado.precioLista,
          numeroEnvio: null,
          creadoPorId: ctx.usuarioId,
        });
      }

      const promosValidadas: { titulo: string; promoCartaId: string; precio: number; componentes: (ComponentePromoElegido & { precioCarta: number })[]; filas: FilaPromoProrrateada[] }[] = [];
      for (const p of promos_) {
        const def = typeof p?.promoCartaId === "string" ? await cargarPromoCartaParaAgregar(ctx.sucursalId, p.promoCartaId, tx) : null;
        if (!def) return error("No se encontró esa promo, o ya no está disponible.");
        const elecciones = Array.isArray(p.elecciones) ? p.elecciones : [];
        const validacion = validarEleccionPromo(def.cupos, elecciones);
        if (!validacion.ok) return error(`«${def.titulo}»: ${validacion.mensaje}`);
        const componentes = componentesDeEleccion(elecciones).map((c) => ({ ...c, precioCarta: def.precioCartaPorProducto.get(c.productoId) ?? 0 }));
        const prorrateo = prorratearPrecioPromo(def.precio, componentes);
        if (!prorrateo.ok) return error(`«${def.titulo}»: ${prorrateo.mensaje}`);
        promosValidadas.push({ titulo: def.titulo, promoCartaId: def.id, precio: def.precio, componentes, filas: prorrateo.filas });
      }

      // Fase 2: ESCRIBIR — recién acá, con todo ya validado. Una PromoCuenta por promo (necesita su id antes de poder crear los
      // CuentaItem que la referencian); todos los CuentaItem (sueltos y componentes) en UN solo createMany al final.
      const filas = [...filasSueltas];
      for (const p of promosValidadas) {
        const promoCuenta = await tx.promoCuenta.create({ data: { cuentaId: abierta.cuenta.id, promoCartaId: p.promoCartaId, precio: p.precio, titulo: p.titulo, creadoPorId: ctx.usuarioId } });
        const precioCartaDe = (productoId: string) => p.componentes.find((c) => c.productoId === productoId)?.precioCarta ?? null;
        for (const fila of p.filas) {
          filas.push({
            cuentaId: abierta.cuenta.id,
            productoId: fila.productoId,
            cantidad: fila.cantidad,
            precioUnitario: fila.precioUnitario,
            numeroEnvio: null,
            creadoPorId: ctx.usuarioId,
            promoCuentaId: promoCuenta.id,
            precioCartaUnitario: precioCartaDe(fila.productoId),
          });
        }
      }

      await tx.cuentaItem.createMany({ data: filas });
      const mensaje = `${filas.length === 1 ? "Se agregó 1 ítem" : `Se agregaron ${filas.length} ítems`} a la mesa ${abierta.cuenta.mesa.numero}.`;
      const nombresPromos = promosValidadas.map((p) => `«${p.titulo}»`);
      return ok(nombresPromos.length ? `${mensaje} Incluye ${nombresPromos.join(", ")}.` : mensaje);
    });
  });
}

/**
 * Quita una promo entera que TODAVÍA NO SALIÓ a cocina: borra la `PromoCuenta` y TODOS sus `CuentaItem` componentes juntos, de
 * verdad (borradores, sin motivo ni auditoría — mismo criterio que `quitarItemSinEnviar`). Si algún componente ya salió a
 * cocina, no se borra nada: hay que anular la promo entera (`anularPromoEnviada`, D4).
 *
 * Desde el Hito 4 de la pureza (bloque 4.1, paso 10) esta Server Action es un adaptador fino: permiso (`conPermiso("pos_tomar_pedido")`) → formato del
 * `promoCuentaId` (`guardComandoQuitarPromoSinEnviar`, core/features/cuentas/cuenta-pedido.guard.ts, DENTRO del envoltorio) → caso de uso
 * (`casos-de-uso/quitar-promo-sin-enviar.ts`: transacción serializable, la promo, la cuenta abierta, que nada haya salido y el borrado en
 * server/persistencia/pos/pedido.ts) → `aResultadoAccion`.
 */
export async function quitarPromoSinEnviar(promoCuentaId: string): Promise<ResultadoAccion> {
  return conPermiso("pos_tomar_pedido", async (ctx) => {
    const comando = guardComandoQuitarPromoSinEnviar({ promoCuentaId });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await quitarPromoSinEnviarCasoDeUso(ctx, comando.valor));
  });
}

/**
 * Quita un ítem que TODAVÍA NO SALIÓ a cocina: es un borrador, así que se borra de verdad, sin motivo ni auditoría (plan, B3). La
 * condición vive en el mismo DELETE (`numeroEnvio: null`, y nunca una fila espejo): si otro mozo lo envió un instante antes, no se
 * borra nada. Un ítem ya enviado se anula con motivo (`anularItemEnviado`).
 *
 * Desde el Hito 4 de la pureza (bloque 4.1, paso 9) esta Server Action es un adaptador fino: permiso (`conPermiso("pos_tomar_pedido")`) → formato del
 * `cuentaItemId` (`guardComandoQuitarItemSinEnviar`, core/features/cuentas/cuenta-pedido.guard.ts, DENTRO del envoltorio) → caso de uso
 * (`casos-de-uso/quitar-item-sin-enviar.ts`: transacción serializable, el ítem, la cuenta abierta y el borrado condicional en server/persistencia/pos/pedido.ts)
 * → `aResultadoAccion`.
 */
export async function quitarItemSinEnviar(cuentaItemId: string): Promise<ResultadoAccion> {
  return conPermiso("pos_tomar_pedido", async (ctx) => {
    const comando = guardComandoQuitarItemSinEnviar({ cuentaItemId });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await quitarItemSinEnviarCasoDeUso(ctx, comando.valor));
  });
}

/**
 * «Enviar a cocina»: los ítems pedidos que sigan sin enviar pasan al envío `n = max(numeroEnvio) + 1` de la cuenta (KOT derivado, plan
 * B1). Solo los ids dados (los que el mozo tenía en pantalla): un ítem que otro agregó mientras tanto no sale sin que lo vea.
 * Idempotente: si ninguno seguía sin enviar (doble clic, otro mozo se adelantó), no crea un envío vacío.
 *
 * Además de `{ ok, mensaje }` devuelve `numeroEnvio` y `envioNuevo` (`ResultadoEnvioACocina`): la pantalla imprime la comanda solo del
 * envío que creó esta llamada; en el caso idempotente informa el envío en el que ya habían salido, con `envioNuevo: false`.
 *
 * Desde el Hito 4 de la pureza (bloque 4.1, paso 11) esta Server Action es un adaptador fino: permiso (`conPermiso("pos_enviar_a_cocina")`) → formato de la
 * lista y del `cuentaId` (`guardComandoEnviarACocina`, core/features/cuentas/cuenta-pedido.guard.ts, DENTRO del envoltorio: la lista primero, como antes) → caso
 * de uso (`casos-de-uso/enviar-a-cocina.ts`: transacción serializable, la cuenta abierta, los hermanos de promo, el número de envío y el `UPDATE` condicional en
 * server/persistencia/pos/pedido.ts). No usa `aResultadoAccion` (la pantalla necesita además el envío): copia a mano SOLO `numeroEnvio` y `envioNuevo` de
 * `datos`, como `emitirTicketCorregido`.
 */
export async function enviarACocina(cuentaId: string, itemIds: string[]): Promise<ResultadoEnvioACocina> {
  return conPermiso("pos_enviar_a_cocina", async (ctx) => {
    const comando = guardComandoEnviarACocina({ cuentaId, itemIds });
    if (!comando.ok) return error(comando.mensaje);
    const r = await enviarACocinaCasoDeUso(ctx, comando.valor);
    return r.ok ? { ...ok(r.mensaje), numeroEnvio: r.datos.numeroEnvio, envioNuevo: r.datos.envioNuevo } : error(r.mensaje);
  });
}
