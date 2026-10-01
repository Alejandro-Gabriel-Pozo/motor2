"use server";

import type { Prisma } from "@prisma/client";
import { redondearMoneda } from "@/core/moneda";
import { tieneStockReal } from "@/core/movimientos/public";
import { resolverPrecioVenta, conTransaccionSerializable } from "@/core/movimientos/public-servidor";
import { aplicarDescuentoDeProducto } from "@/core/carta/public";
import { descuentosDeProductoEnSucursal } from "@/core/carta/public-servidor";
import { productoDisponibleEn } from "@/core/catalogo/public-servidor";
import { MAXIMO_ITEMS_POR_AGREGADO, validarCantidadPedido } from "@/core/pos/cantidad-pedido";
import { componentesDeEleccion, prorratearPrecioPromo, validarEleccionPromo, type ComponentePromoElegido, type EleccionDeCupo, type FilaPromoProrrateada } from "@/core/pos/promo-combo";
import { cargarPromoCartaParaAgregar } from "@/core/pos/promo-combo-consulta";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion, type ResultadoEnvioACocina } from "../tipos";
import { cuentaAbiertaDeSucursal } from "./cuenta-comun";

/**
 * Toma de pedido en el salón — cargar el pedido: agregar ítems y promos sin enviar, quitarlos mientras no salieron y enviarlos a cocina.
 * Criterio común de todas las acciones de «tomar pedido» (transacción SERIALIZABLE, mesa de la sucursal activa, cuenta abierta, sin
 * refrescar la vista) y ayudantes compartidos: ./cuenta-comun.ts.
 */

// Sin `export`: un archivo "use server" solo puede exportar funciones async (cada export es un endpoint).
// MAXIMO_ITEMS_POR_AGREGADO vive en @/core/pos/cantidad-pedido (pura): así el cliente puede deshabilitar sumar el ítem #51 con el
// MISMO número, sin duplicarlo.
const MAXIMO_ITEMS_POR_ENVIO = 200;

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
 */
export async function quitarPromoSinEnviar(promoCuentaId: string): Promise<ResultadoAccion> {
  return conPermiso("pos_tomar_pedido", async (ctx) => {
    return conTransaccionSerializable(ctx.transaccion, async (tx) => {
      const promoCuenta =
        typeof promoCuentaId === "string"
          ? await tx.promoCuenta.findFirst({ where: { id: promoCuentaId, cuenta: { mesa: { sucursalId: ctx.sucursalId } } }, include: { cuenta: { include: { mesa: { select: { numero: true } } } }, items: true } })
          : null;
      if (!promoCuenta) return error("No se encontró esa promo en esta sucursal.");
      if (promoCuenta.cuenta.cerradaEn) return error(`La cuenta de la mesa ${promoCuenta.cuenta.mesa.numero} ya está cerrada.`);
      if (promoCuenta.items.some((i) => i.numeroEnvio !== null || i.anulaAItemId !== null)) {
        return error("Esa promo ya salió a cocina: anulala con motivo.");
      }
      await tx.cuentaItem.deleteMany({ where: { promoCuentaId: promoCuenta.id } });
      await tx.promoCuenta.delete({ where: { id: promoCuenta.id } });
      return ok(`Se quitó «${promoCuenta.titulo}» de la mesa ${promoCuenta.cuenta.mesa.numero}.`);
    });
  });
}

/**
 * Quita un ítem que TODAVÍA NO SALIÓ a cocina: es un borrador, así que se borra de verdad, sin motivo ni auditoría (plan, B3). La
 * condición vive en el mismo DELETE (`numeroEnvio: null`, y nunca una fila espejo): si otro mozo lo envió un instante antes, no se
 * borra nada. Un ítem ya enviado se anula con motivo (`anularItemEnviado`).
 */
export async function quitarItemSinEnviar(cuentaItemId: string): Promise<ResultadoAccion> {
  return conPermiso("pos_tomar_pedido", async (ctx) => {
    return conTransaccionSerializable(ctx.transaccion, async (tx) => {
      const item =
        typeof cuentaItemId === "string"
          ? await tx.cuentaItem.findFirst({ where: { id: cuentaItemId, cuenta: { mesa: { sucursalId: ctx.sucursalId } } }, include: { producto: { select: { nombre: true } }, promoCuenta: { select: { titulo: true } } } })
          : null;
      if (!item) return error("No se encontró ese ítem en esta sucursal.");
      // Task #16 (D4, "una promo se anula/quita entera"): un componente no se quita suelto — usá quitarPromoSinEnviar con la promo.
      if (item.promoCuenta) return error(`«${item.producto.nombre}» es parte de la promo «${item.promoCuenta.titulo}»: quitá la promo entera.`);
      const abierta = await cuentaAbiertaDeSucursal(tx, item.cuentaId, ctx.sucursalId);
      if (!abierta.ok) return error(abierta.mensaje);

      const borrados = await tx.cuentaItem.deleteMany({ where: { id: item.id, numeroEnvio: null, anulaAItemId: null } });
      if (borrados.count === 0) return error("Ese ítem ya salió a cocina: anulalo con motivo.");
      return ok(`Se quitó «${item.producto.nombre}» de la mesa ${abierta.cuenta.mesa.numero}.`);
    });
  });
}

/**
 * «Enviar a cocina»: los ítems pedidos que sigan sin enviar pasan al envío `n = max(numeroEnvio) + 1` de la cuenta (KOT derivado, plan
 * B1). Solo los ids dados (los que el mozo tenía en pantalla): un ítem que otro agregó mientras tanto no sale sin que lo vea.
 * Idempotente: si ninguno seguía sin enviar (doble clic, otro mozo se adelantó), no crea un envío vacío.
 *
 * Además de `{ ok, mensaje }` devuelve `numeroEnvio` y `envioNuevo` (`ResultadoEnvioACocina`): la pantalla imprime la comanda solo del
 * envío que creó esta llamada; en el caso idempotente informa el envío en el que ya habían salido, con `envioNuevo: false`.
 */
export async function enviarACocina(cuentaId: string, itemIds: string[]): Promise<ResultadoEnvioACocina> {
  return conPermiso("pos_enviar_a_cocina", async (ctx) => {
    if (!Array.isArray(itemIds) || itemIds.length === 0 || itemIds.some((id) => typeof id !== "string")) return error("No hay ítems para enviar.");
    if (itemIds.length > MAXIMO_ITEMS_POR_ENVIO) return error(`No se pueden enviar más de ${MAXIMO_ITEMS_POR_ENVIO} ítems de una vez.`);

    return conTransaccionSerializable(ctx.transaccion, async (tx) => {
      const abierta = await cuentaAbiertaDeSucursal(tx, cuentaId, ctx.sucursalId);
      if (!abierta.ok) return error(abierta.mensaje);

      // Task #16 (docs/plan-promo-combo-2026-09-26.md, D del paso 2.5, "una promo nunca sale a medias"): si algún id pedido es
      // un componente de una promo, se suman TODOS los hermanos de esa MISMA PromoCuenta que sigan sin enviar — el mozo pudo
      // no tenerlos a todos en pantalla (o no haberlos tocado), pero una promo nunca se manda parcial a cocina.
      const pedidos = await tx.cuentaItem.findMany({ where: { id: { in: itemIds }, cuentaId: abierta.cuenta.id }, select: { promoCuentaId: true } });
      const promoCuentaIds = [...new Set(pedidos.flatMap((i) => (i.promoCuentaId ? [i.promoCuentaId] : [])))];
      const hermanos = promoCuentaIds.length
        ? await tx.cuentaItem.findMany({ where: { promoCuentaId: { in: promoCuentaIds }, cuentaId: abierta.cuenta.id, numeroEnvio: null, anulaAItemId: null }, select: { id: true } })
        : [];
      const idsAEnviar = [...new Set([...itemIds, ...hermanos.map((h) => h.id)])];

      const { _max } = await tx.cuentaItem.aggregate({ where: { cuentaId: abierta.cuenta.id }, _max: { numeroEnvio: true } });
      const numeroEnvio = (_max.numeroEnvio ?? 0) + 1;
      const enviados = await tx.cuentaItem.updateMany({
        where: { id: { in: idsAEnviar }, cuentaId: abierta.cuenta.id, numeroEnvio: null, anulaAItemId: null },
        data: { numeroEnvio },
      });
      if (enviados.count === 0) {
        const previo = await tx.cuentaItem.aggregate({
          where: { id: { in: idsAEnviar }, cuentaId: abierta.cuenta.id, anulaAItemId: null, numeroEnvio: { not: null } },
          _max: { numeroEnvio: true },
        });
        return { ...ok("Esos ítems ya estaban enviados."), numeroEnvio: previo._max.numeroEnvio, envioNuevo: false };
      }
      return {
        ...ok(`Envío ${numeroEnvio} a cocina: ${enviados.count === 1 ? "1 ítem" : `${enviados.count} ítems`} de la mesa ${abierta.cuenta.mesa.numero}.`),
        numeroEnvio,
        envioNuevo: true,
      };
    });
  });
}
