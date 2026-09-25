"use server";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { redondearMoneda } from "@/core/movimientos/transiciones";
import { resolverPrecioVenta } from "@/core/movimientos/precio-venta";
import { productoDisponibleEn } from "@/core/catalogo/disponibilidad-producto-consulta";
import { conTransaccionSerializable } from "@/core/movimientos/con-reintento";
import { esErrorDeUnicidad } from "@/core/catalogo/generar-codigo";
import { lineasDeVenta, restanteDe, validarCantidadPedido, validarMotivoAnulacion } from "@/core/pos/cuenta";
import { registrarVentaEnTx, type AvisoStockNegativo } from "@/core/movimientos/registrar-venta";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion, type ResultadoEnvioACocina } from "../tipos";

/**
 * Toma de pedido en el salón (módulo POS, docs/plan-tomar-pedido-2026-09-25.md). Todas las escrituras corren en una transacción
 * SERIALIZABLE (Postgres arbitra el doble clic y las carreras entre mozos: test/pos/cuenta-concurrencia.test.ts), verifican que la
 * mesa sea de la sucursal activa y que la cuenta siga abierta. Ninguna refresca la vista: sus llamadores (componentes de cliente de
 * src/app/(pos)/mesas/[mesaId]/) hacen `router.refresh()`.
 *
 * Modelo (bloque POS de prisma/schema.prisma): «enviar a cocina» numera los ítems (KOT derivado de `numeroEnvio`); un ítem sin enviar
 * es un borrador y se quita con DELETE físico; uno ya enviado solo se anula con motivo (`anularItemEnviado`, permiso propio).
 */

// Sin `export`: un archivo "use server" solo puede exportar funciones async (cada export es un endpoint).
const MAXIMO_ITEMS_POR_AGREGADO = 50;
const MAXIMO_ITEMS_POR_ENVIO = 200;

/** Cantidad legible («1», «0,5»), para mensajes y descripciones de auditoría. */
function formatearCantidad(n: number): string {
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 4 }).format(n);
}

const MONEDA = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** «"Muzzarella" (tenía 0,5, se consumió 1,5, quedó en -1)»: el detalle de un insumo que quedó en negativo al cerrar una cuenta. */
function describirAviso(aviso: AvisoStockNegativo): string {
  return `"${aviso.nombre}" (tenía ${formatearCantidad(aviso.actual)}, se consumió ${formatearCantidad(aviso.requerido)}, quedó en ${formatearCantidad(aviso.resultante)})`;
}

type CuentaAbierta = { id: string; mesa: { id: string; numero: number } };

/** La cuenta pedida, si es de una mesa de esta sucursal y sigue abierta; si no, el mensaje de error listo para devolver. */
async function cuentaAbiertaDeSucursal(tx: Prisma.TransactionClient, cuentaId: string, sucursalId: string): Promise<{ ok: true; cuenta: CuentaAbierta } | { ok: false; mensaje: string }> {
  const cuenta = typeof cuentaId === "string" ? await tx.cuenta.findFirst({ where: { id: cuentaId, mesa: { sucursalId } }, include: { mesa: { select: { id: true, numero: true } } } }) : null;
  if (!cuenta) return { ok: false, mensaje: "No se encontró esa cuenta en esta sucursal." };
  if (cuenta.cerradaEn) return { ok: false, mensaje: `La cuenta de la mesa ${cuenta.mesa.numero} ya está cerrada.` };
  return { ok: true, cuenta };
}

/**
 * Abre la cuenta de una mesa libre. A lo sumo una abierta por mesa (índice único parcial `Cuenta_una_abierta_por_mesa_key`): si otro
 * mozo la abrió un instante antes, el choque (P2002) no es un error para quien llega segundo — la mesa ya tiene su cuenta, que es lo
 * que quería.
 */
export async function abrirCuenta(mesaId: string): Promise<ResultadoAccion> {
  return conPermiso("pos_tomar_pedido", async (ctx) => {
    const mesa = typeof mesaId === "string" ? await prisma.mesa.findFirst({ where: { id: mesaId, sucursalId: ctx.sucursalId } }) : null;
    if (!mesa) return error("No se encontró esa mesa en esta sucursal.");
    try {
      return await conTransaccionSerializable(async (tx) => {
        await tx.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: ctx.usuarioId } });
        return ok(`Cuenta de la mesa ${mesa.numero} abierta.`);
      });
    } catch (e) {
      if (esErrorDeUnicidad(e)) return ok(`La mesa ${mesa.numero} ya tenía una cuenta abierta.`);
      throw e;
    }
  });
}

/**
 * Agrega ítems SIN ENVIAR a una cuenta abierta: todo o nada. Cada producto tiene que ser un PV disponible en la sucursal; la cantidad
 * se valida y redondea a los decimales de su unidad (`validarCantidadPedido`). El precio se CONGELA acá (Precio Local habilitado o, si
 * no, el global — `resolverPrecioVenta`): es el que se cobra al cerrar la cuenta aunque cambie después.
 */
export async function agregarItems(cuentaId: string, items: { productoId: string; cantidad: number }[]): Promise<ResultadoAccion> {
  return conPermiso("pos_tomar_pedido", async (ctx) => {
    if (!Array.isArray(items) || items.length === 0) return error("Elegí al menos un producto.");
    if (items.length > MAXIMO_ITEMS_POR_AGREGADO) return error(`No se pueden agregar más de ${MAXIMO_ITEMS_POR_AGREGADO} ítems de una vez.`);

    return conTransaccionSerializable(async (tx) => {
      const abierta = await cuentaAbiertaDeSucursal(tx, cuentaId, ctx.sucursalId);
      if (!abierta.ok) return error(abierta.mensaje);

      const filas: Prisma.CuentaItemCreateManyInput[] = [];
      for (const item of items) {
        const producto = typeof item?.productoId === "string" ? await tx.producto.findUnique({ where: { id: item.productoId }, include: { unidadStock: { select: { decimales: true } } } }) : null;
        if (!producto) return error("El producto no existe.");
        if (producto.tipo !== "PV") return error(`«${producto.nombre}» no se puede pedir: solo se piden productos de venta (PV).`);
        if (!(await productoDisponibleEn(ctx.sucursalId, producto.id, tx))) return error(`«${producto.nombre}» no está disponible en «${ctx.sucursalNombre}».`);
        const cantidad = validarCantidadPedido(item.cantidad, producto.unidadStock.decimales);
        if (!cantidad.ok) return error(`«${producto.nombre}»: ${cantidad.mensaje}`);
        const precioUnitario = redondearMoneda(await resolverPrecioVenta(ctx.sucursalId, producto.id, Number(producto.precioVenta), tx));
        filas.push({ cuentaId: abierta.cuenta.id, productoId: producto.id, cantidad: cantidad.cantidad, precioUnitario, numeroEnvio: null, creadoPorId: ctx.usuarioId });
      }

      await tx.cuentaItem.createMany({ data: filas });
      return ok(`${filas.length === 1 ? "Se agregó 1 ítem" : `Se agregaron ${filas.length} ítems`} a la mesa ${abierta.cuenta.mesa.numero}.`);
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
    return conTransaccionSerializable(async (tx) => {
      const item = typeof cuentaItemId === "string" ? await tx.cuentaItem.findFirst({ where: { id: cuentaItemId, cuenta: { mesa: { sucursalId: ctx.sucursalId } } }, include: { producto: { select: { nombre: true } } } }) : null;
      if (!item) return error("No se encontró ese ítem en esta sucursal.");
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
  return conPermiso("pos_tomar_pedido", async (ctx) => {
    if (!Array.isArray(itemIds) || itemIds.length === 0 || itemIds.some((id) => typeof id !== "string")) return error("No hay ítems para enviar.");
    if (itemIds.length > MAXIMO_ITEMS_POR_ENVIO) return error(`No se pueden enviar más de ${MAXIMO_ITEMS_POR_ENVIO} ítems de una vez.`);

    return conTransaccionSerializable(async (tx) => {
      const abierta = await cuentaAbiertaDeSucursal(tx, cuentaId, ctx.sucursalId);
      if (!abierta.ok) return error(abierta.mensaje);

      const { _max } = await tx.cuentaItem.aggregate({ where: { cuentaId: abierta.cuenta.id }, _max: { numeroEnvio: true } });
      const numeroEnvio = (_max.numeroEnvio ?? 0) + 1;
      const enviados = await tx.cuentaItem.updateMany({
        where: { id: { in: itemIds }, cuentaId: abierta.cuenta.id, numeroEnvio: null, anulaAItemId: null },
        data: { numeroEnvio },
      });
      if (enviados.count === 0) {
        const previo = await tx.cuentaItem.aggregate({
          where: { id: { in: itemIds }, cuentaId: abierta.cuenta.id, anulaAItemId: null, numeroEnvio: { not: null } },
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

/**
 * Anula (total o parcialmente) un ítem que YA SALIÓ a cocina (plan B2/B3): escribe una fila ESPEJO — un CuentaItem nuevo con la
 * cantidad en NEGATIVO, mismo producto/precio/envío, `anulaAItemId` al original, el motivo y quién lo hizo — más una fila en el registro
 * de auditoría (entidad `CuentaItem`, campo `cantidadVigente`). El original nunca se edita ni se borra: lo que queda se calcula
 * (`restanteDe`). Permiso propio, más restrictivo que tomar pedido (el mozo no lo tiene de fábrica).
 *
 * `restanteVisto` es la guarda optimista (mismo criterio que el `esperado` de `corregirCompra`): lo que quedaba del ítem cuando el
 * usuario abrió el diálogo. Si otro lo anuló mientras tanto, se rechaza en vez de anular sobre un número que ya no es el que vio.
 * Una cuenta ya cerrada no se toca: su venta se anula por el camino de siempre (`anularVenta`).
 */
export async function anularItemEnviado(cuentaItemId: string, cantidad: number, motivo: string, restanteVisto: number): Promise<ResultadoAccion> {
  return conPermiso("pos_anular_item", async (ctx) => {
    return conTransaccionSerializable(async (tx) => {
      const item =
        typeof cuentaItemId === "string"
          ? await tx.cuentaItem.findFirst({
              where: { id: cuentaItemId, cuenta: { mesa: { sucursalId: ctx.sucursalId } } },
              include: {
                producto: { select: { nombre: true, unidadStock: { select: { decimales: true } } } },
                cuenta: { include: { mesa: { select: { numero: true } } } },
                anulaciones: { select: { cantidad: true } },
              },
            })
          : null;
      if (!item) return error("No se encontró ese ítem en esta sucursal.");
      const mesa = item.cuenta.mesa.numero;
      if (item.anulaAItemId !== null) return error("Eso ya es una anulación: no se puede anular.");
      if (item.cuenta.cerradaEn) return error(`La cuenta de la mesa ${mesa} ya se cerró: anulá la venta (Reportes › Trazabilidad).`);
      if (item.numeroEnvio === null) return error("Ese ítem todavía no salió a cocina: usá «Quitar».");

      const motivoValidado = validarMotivoAnulacion(motivo);
      if (!motivoValidado.ok) return error(motivoValidado.mensaje);

      const restante = restanteDe({ cantidad: Number(item.cantidad) }, item.anulaciones.map((a) => ({ cantidad: Number(a.cantidad) })));
      if (typeof restanteVisto !== "number" || restanteVisto !== restante) {
        return error(`«${item.producto.nombre}» cambió mientras lo mirabas (ahora quedan ${formatearCantidad(restante)}): revisá y volvé a intentar.`);
      }
      const aAnular = validarCantidadPedido(cantidad, item.producto.unidadStock.decimales);
      if (!aAnular.ok) return error(aAnular.mensaje);
      if (aAnular.cantidad > restante) return error(`No se puede anular más de lo que queda de «${item.producto.nombre}» (${formatearCantidad(restante)}).`);

      await tx.cuentaItem.create({
        data: {
          cuentaId: item.cuentaId,
          productoId: item.productoId,
          cantidad: -aAnular.cantidad,
          precioUnitario: item.precioUnitario,
          numeroEnvio: item.numeroEnvio,
          anulaAItemId: item.id,
          motivoAnulacion: motivoValidado.motivo,
          creadoPorId: ctx.usuarioId,
        },
      });
      const quedan = restanteDe({ cantidad: restante }, [{ cantidad: -aAnular.cantidad }]);
      await registrarCambioAuditado(tx, {
        entidad: "CuentaItem",
        entidadId: item.id,
        descripcion: `Mesa ${mesa}, envío ${item.numeroEnvio}: anulación de ${formatearCantidad(aAnular.cantidad)} × "${item.producto.nombre}" ya enviado a cocina. Motivo: ${motivoValidado.motivo}`,
        campo: "cantidadVigente",
        valorAnterior: restante,
        valorNuevo: quedan,
        actorId: ctx.usuarioId,
        sucursalId: ctx.sucursalId,
      });
      return ok(`Se anuló ${formatearCantidad(aAnular.cantidad)} × «${item.producto.nombre}» de la mesa ${mesa}.`);
    });
  });
}

/**
 * Cierra la cuenta de una mesa y registra su venta — pagar y cerrar son UNA sola acción atómica (plan B5: motor2 no tiene entidad de
 * caja ni de pago). En una transacción serializable:
 * 1. arma las líneas NETAS por (producto, precio congelado) sumando originales y espejos (`lineasDeVenta`); una línea anulada entera no
 *    se vende;
 * 2. registra la venta con el MISMO núcleo que la venta de mostrador (`registrarVentaEnTx`): una Operacion VENTA por línea, con
 *    `detalle` «Mesa N», sin cliente, la sección elegida (validada contra la sucursal dentro del núcleo) y el precio congelado de cada
 *    línea;
 * 3. enlaza cada ítem con su Operacion (`CuentaItem.operacionId`) y cierra la cuenta (`cerradaEn`/`cerradaPorId`): la mesa queda libre.
 *
 * STOCK INSUFICIENTE NO BLOQUEA (plan B6bis, decisión del dueño): la mesa ya comió, así que la venta se registra igual
 * (`permitirStockNegativo`) y cada insumo que quedó en negativo sale EXPLÍCITO en el mensaje y deja una fila en el registro de auditoría
 * (entidad `Operacion` — la venta que lo consumió —, campo `saldoStock`, con la mesa, el insumo, el déficit y quién cerró). Se corrige
 * después con las herramientas de siempre (Conteo Físico o Ajuste), sin ningún caso especial.
 *
 * Bloquea si queda algún ítem sin enviar (hay que enviarlo o quitarlo: lo que no salió a cocina no se cobra). Con neto cero (todo
 * anulado) cierra sin venta. Idempotente: una cuenta ya cerrada devuelve ok sin volver a vender (la transacción serializable arbitra el
 * doble clic: el segundo reintenta, la ve cerrada y no escribe nada).
 */
export async function cerrarCuenta(cuentaId: string, seccionId: string): Promise<ResultadoAccion> {
  return conPermiso("pos_cerrar_cuenta", async (ctx) => {
    return conTransaccionSerializable(async (tx) => {
      const cuenta =
        typeof cuentaId === "string"
          ? await tx.cuenta.findFirst({ where: { id: cuentaId, mesa: { sucursalId: ctx.sucursalId } }, include: { mesa: { select: { numero: true } }, items: true } })
          : null;
      if (!cuenta) return error("No se encontró esa cuenta en esta sucursal.");
      const mesa = cuenta.mesa.numero;
      if (cuenta.cerradaEn) return ok(`La cuenta de la mesa ${mesa} ya estaba cerrada.`);

      const sinEnviar = cuenta.items.filter((i) => i.numeroEnvio === null).length;
      if (sinEnviar > 0) return error(sinEnviar === 1 ? "Hay 1 ítem sin enviar: envialo o quitalo." : `Hay ${sinEnviar} ítems sin enviar: envialos o quitalos.`);

      const ahora = new Date();
      const cerrar = () => tx.cuenta.update({ where: { id: cuenta.id }, data: { cerradaEn: ahora, cerradaPorId: ctx.usuarioId } });
      const lineas = lineasDeVenta(cuenta.items.map((i) => ({ productoId: i.productoId, cantidad: Number(i.cantidad), precioUnitario: Number(i.precioUnitario) })));
      if (!lineas.length) {
        await cerrar();
        return ok(`Cuenta de la mesa ${mesa} cerrada sin venta: no quedó nada por cobrar.`);
      }
      if (typeof seccionId !== "string" || !seccionId.trim()) return error("Elegí la sección de la que sale la mercadería.");

      const venta = await registrarVentaEnTx(
        tx,
        { usuarioId: ctx.usuarioId, sucursalId: ctx.sucursalId, sucursalNombre: ctx.sucursalNombre },
        {
          fecha: ahora,
          seccionId,
          proveedorId: null,
          detalle: `Mesa ${mesa}`,
          lineas: lineas.map((l) => ({ productoId: l.productoId, cantidadVendida: l.cantidad, precioUnitario: l.precioUnitario })),
        },
        { permitirStockNegativo: true }
      );
      // El núcleo valida todo antes de escribir: un rechazo no dejó nada escrito y la cuenta sigue abierta.
      if (!venta.ok) return error(venta.mensaje);
      if (venta.operacionIds.length !== lineas.length) throw new Error("cerrarCuenta: la venta no devolvió una Operacion por línea.");

      for (const [i, linea] of lineas.entries()) {
        await tx.cuentaItem.updateMany({
          where: { cuentaId: cuenta.id, productoId: linea.productoId, precioUnitario: linea.precioUnitario },
          data: { operacionId: venta.operacionIds[i] },
        });
      }
      await cerrar();

      const total = redondearMoneda(lineas.reduce((suma, l) => suma + l.cantidad * l.precioUnitario, 0));
      const mensaje = `Cuenta de la mesa ${mesa} cerrada: se registró la venta por ${MONEDA.format(total)}.`;
      if (!venta.avisosStockNegativo.length) return ok(mensaje);

      const seccion = await tx.seccion.findUniqueOrThrow({ where: { id: seccionId }, select: { nombre: true } });
      for (const aviso of venta.avisosStockNegativo) {
        const consumo = await tx.movimientoStock.findFirst({
          where: { operacionId: { in: venta.operacionIds }, productoId: aviso.productoId, proceso: "CONSUMO" },
          select: { operacionId: true },
          orderBy: { creadoEn: "asc" },
        });
        await registrarCambioAuditado(tx, {
          entidad: "Operacion",
          entidadId: consumo?.operacionId ?? venta.operacionIds[0],
          descripcion:
            `Mesa ${mesa}: al cerrar la cuenta (${ctx.email}) el stock de "${aviso.nombre}" en «${seccion.nombre}» quedó en negativo — ` +
            `tenía ${formatearCantidad(aviso.actual)}, la venta consumió ${formatearCantidad(aviso.requerido)}, faltaron ${formatearCantidad(aviso.requerido - Math.max(aviso.actual, 0))}. ` +
            "La venta se registró igual; corregí el saldo con un Conteo Físico o un Ajuste.",
          campo: "saldoStock",
          valorAnterior: aviso.actual,
          valorNuevo: aviso.resultante,
          actorId: ctx.usuarioId,
          sucursalId: ctx.sucursalId,
        });
      }
      return ok(`${mensaje} ⚠ Quedó stock negativo: ${venta.avisosStockNegativo.map(describirAviso).join(", ")}. Corregilo con un Conteo Físico o un Ajuste.`);
    });
  });
}
