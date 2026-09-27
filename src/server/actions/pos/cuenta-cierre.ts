"use server";

import { importeDeLinea, precioConDescuento, redondearMoneda } from "@/core/moneda";
import { conTransaccionSerializable, registrarVentaEnTx } from "@/core/movimientos/public-servidor";
import { lineasDeVenta, validarMotivoAnulacion } from "@/core/pos/cuenta";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { formatearNumeroBoleta, siguienteNumeroBoleta } from "@/core/pos/numeracion-boleta";
import { armarBoletaVigente, estadoDeBoleta, type ItemConVenta } from "@/core/pos/boleta";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion, type ResultadoBoletaCorregida } from "../tipos";
import { describirAviso, formatearCantidad, MONEDA } from "./cuenta-comun";

/**
 * Toma de pedido en el salón — cerrar la cuenta (registra la venta y numera la boleta) y emitir la boleta corregida.
 * Criterio común de todas las acciones de «tomar pedido» (transacción SERIALIZABLE, mesa de la sucursal activa, cuenta abierta, sin
 * refrescar la vista) y ayudantes compartidos: ./cuenta-comun.ts.
 */

/**
 * Cierra la cuenta de una mesa y registra su venta — pagar y cerrar son UNA sola acción atómica (plan B5: motor2 no tiene entidad de
 * caja ni de pago). En una transacción serializable:
 * 1. arma las líneas NETAS por (producto, precio congelado) sumando originales y espejos (`lineasDeVenta`); una línea anulada entera no
 *    se vende;
 * 2. si la cuenta tiene un cliente con descuento asignado (Task #14, docs/plan-clientes-descuento-2026-09-26.md, D7 — el snapshot
 *    congelado en `Cuenta.descuentoPorcentaje`, NUNCA el % actual de `Cliente`), aplica `precioConDescuento` sobre el precio de
 *    lista de cada línea (`src/core/moneda.ts`) — el precio de lista SOLO se guarda aparte (`precioListaUnitario`) cuando el
 *    descuento cambió el número; sin cliente, es un pasamanos: el precio congelado de siempre;
 * 3. registra la venta con el MISMO núcleo que la venta de mostrador (`registrarVentaEnTx`): una Operacion VENTA por línea, con
 *    `detalle` «Mesa N», el cliente de la cuenta (si tiene uno) y el precio COBRADO de cada línea (de lista, o con descuento). La
 *    sección NO se elige (docs/plan-seccion-habitual-stock-2026-09-25.md): el núcleo resuelve, insumo por insumo, de qué sección
 *    activa sale (`origen: { tipo: "automatico" }`, por vencimiento); sin ninguna sección activa, se rechaza sin escribir nada;
 * 4. enlaza cada ítem con su Operacion (`CuentaItem.operacionId`, buscado por el precio de LISTA — el descuento no cambia esa
 *    búsqueda) y cierra la cuenta (`cerradaEn`/`cerradaPorId`): la mesa queda libre.
 *
 * STOCK INSUFICIENTE NO BLOQUEA (plan B6bis, decisión del dueño): la mesa ya comió, así que la venta se registra igual
 * (`permitirStockNegativo`) y cada insumo que quedó en negativo sale EXPLÍCITO en el mensaje y deja una fila en el registro de auditoría
 * (entidad `Operacion` — la venta que lo consumió en ESA sección —, campo `saldoStock`, con la mesa, el insumo, la sección, el déficit y
 * quién cerró). Se corrige
 * después con las herramientas de siempre (Conteo Físico o Ajuste), sin ningún caso especial.
 *
 * Bloquea si queda algún ítem sin enviar (hay que enviarlo o quitarlo: lo que no salió a cocina no se cobra). Con neto cero (todo
 * anulado) cierra sin venta. Idempotente: una cuenta ya cerrada devuelve ok sin volver a vender (la transacción serializable arbitra el
 * doble clic: el segundo reintenta, la ve cerrada y no escribe nada).
 */
export async function cerrarCuenta(cuentaId: string): Promise<ResultadoAccion> {
  return conPermiso("pos_cerrar_cuenta", async (ctx) => {
    return conTransaccionSerializable(async (tx) => {
      const cuenta =
        typeof cuentaId === "string"
          ? await tx.cuenta.findFirst({
              where: { id: cuentaId, mesa: { sucursalId: ctx.sucursalId } },
              include: { mesa: { select: { numero: true } }, items: true, cliente: { select: { nombre: true } } },
            })
          : null;
      if (!cuenta) return error("No se encontró esa cuenta en esta sucursal.");
      const mesa = cuenta.mesa.numero;
      if (cuenta.cerradaEn) return ok(`La cuenta de la mesa ${mesa} ya estaba cerrada.`);

      const sinEnviar = cuenta.items.filter((i) => i.numeroEnvio === null).length;
      if (sinEnviar > 0) return error(sinEnviar === 1 ? "Hay 1 ítem sin enviar: envialo o quitalo." : `Hay ${sinEnviar} ítems sin enviar: envialos o quitalos.`);

      const ahora = new Date();
      const cerrar = () => tx.cuenta.update({ where: { id: cuenta.id }, data: { cerradaEn: ahora, cerradaPorId: ctx.usuarioId } });
      // `lineas`: precio de LISTA (congelado al pedir), agrupado por (producto, precio, promo) — es la clave con la que se busca
      // cada CuentaItem más abajo (CuentaItem.precioUnitario NUNCA cambia de semántica con el descuento de cliente, Task #14).
      // `promoCuentaId` (Task #16, D4) evita mezclar un suelto con un componente del mismo producto al mismo precio en la MISMA
      // Operacion — cada uno queda en su propia línea/Operacion, aunque el precio congelado coincida.
      const lineas = lineasDeVenta(cuenta.items.map((i) => ({ productoId: i.productoId, cantidad: Number(i.cantidad), precioUnitario: Number(i.precioUnitario), promoCuentaId: i.promoCuentaId })));
      if (!lineas.length) {
        await cerrar();
        return ok(`Cuenta de la mesa ${mesa} cerrada sin venta: no quedó nada por cobrar.`);
      }

      // Cliente con descuento (Task #14, docs/plan-clientes-descuento-2026-09-26.md, D7): `descuentoPorcentaje` es el SNAPSHOT
      // congelado al asignarlo (`asignarClienteACuenta`), nunca el % actual de `Cliente` — para esta cuenta ya no importa si el
      // cliente cambió su % después. `precioConDescuento` (src/core/moneda.ts) hace la aritmética exacta y el piso de 0,01; sin
      // cliente asignado (el caso de siempre) devuelve el precio de lista tal cual, sin pasar por Decimal.
      const descuento = cuenta.descuentoPorcentaje !== null ? Number(cuenta.descuentoPorcentaje) : null;
      const lineasVenta = lineas.map((l) => {
        const precioCobrado = precioConDescuento(l.precioUnitario, descuento);
        return {
          productoId: l.productoId,
          cantidadVendida: l.cantidad,
          precioUnitario: precioCobrado,
          precioListaUnitario: precioCobrado !== l.precioUnitario ? l.precioUnitario : undefined,
          promoCuentaId: l.promoCuentaId,
        };
      });

      const venta = await registrarVentaEnTx(
        tx,
        { usuarioId: ctx.usuarioId, sucursalId: ctx.sucursalId, sucursalNombre: ctx.sucursalNombre },
        {
          fecha: ahora,
          origen: { tipo: "automatico" },
          proveedorId: null,
          clienteId: cuenta.clienteId,
          detalle: `Mesa ${mesa}`,
          lineas: lineasVenta,
        },
        { permitirStockNegativo: true }
      );
      // El núcleo valida todo antes de escribir: un rechazo no dejó nada escrito y la cuenta sigue abierta.
      if (!venta.ok) return error(venta.mensaje);
      if (venta.operacionIds.length !== lineas.length) throw new Error("cerrarCuenta: la venta no devolvió una Operacion por línea.");

      // Número de la boleta (docs/plan-numeracion-boleta-2026-09-25.md): max + 1 de la sucursal, ejemplar A. Recién DESPUÉS de que la venta
      // salió bien — devolver `error(...)` desde acá CONFIRMA la transacción, así que numerar antes gastaría un número en un cierre
      // rechazado. Dos cierres simultáneos de la misma sucursal chocan (índice único + SERIALIZABLE) y uno reintenta: sin huecos ni repetidos.
      const { _max } = await tx.ejemplarBoleta.aggregate({ where: { sucursalId: ctx.sucursalId }, _max: { numero: true } });
      await tx.ejemplarBoleta.create({
        data: { sucursalId: ctx.sucursalId, cuentaId: cuenta.id, numero: siguienteNumeroBoleta(_max.numero), ejemplar: 1, emitidoEn: ahora, emitidoPorId: ctx.usuarioId },
      });

      for (const [i, linea] of lineas.entries()) {
        // `promoCuentaId ?? null` explícito (Task #16): un `undefined` en el `where` de Prisma OMITE el filtro entero, no
        // filtra por null — con eso, un suelto mezclaría con un componente de promo del mismo producto y precio (D4).
        await tx.cuentaItem.updateMany({
          where: { cuentaId: cuenta.id, productoId: linea.productoId, precioUnitario: linea.precioUnitario, promoCuentaId: linea.promoCuentaId ?? null },
          data: { operacionId: venta.operacionIds[i] },
        });
      }
      await cerrar();

      // Σ del importe COBRADO de cada línea VENTA registrada (importeDeLinea, igual que registrarVentaEnTx y la boleta — con
      // descuento ya aplicado si hay cliente), no la suma cruda re-redondeada: el total del mensaje coincide centavo a centavo con
      // lo registrado. redondearMoneda solo limpia el ruido del float.
      const total = redondearMoneda(lineasVenta.reduce((suma, l) => suma + importeDeLinea(l.cantidadVendida, l.precioUnitario), 0));
      const conCliente = cuenta.cliente ? ` (con ${descuento}% de descuento a «${cuenta.cliente.nombre}»)` : "";
      const mensaje = `Cuenta de la mesa ${mesa} cerrada: se registró la venta por ${MONEDA.format(total)}${conCliente}.`;
      if (!venta.avisosStockNegativo.length) return ok(mensaje);

      for (const aviso of venta.avisosStockNegativo) {
        const consumo = await tx.movimientoStock.findFirst({
          where: { operacionId: { in: venta.operacionIds }, productoId: aviso.productoId, seccionId: aviso.seccionId, proceso: "CONSUMO" },
          select: { operacionId: true },
          orderBy: { creadoEn: "asc" },
        });
        await registrarCambioAuditado(tx, {
          entidad: "Operacion",
          entidadId: consumo?.operacionId ?? venta.operacionIds[0],
          descripcion:
            `Mesa ${mesa}: al cerrar la cuenta (${ctx.email}) el stock de "${aviso.nombre}" en «${aviso.seccionNombre}» quedó en negativo — ` +
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

/**
 * «Emitir boleta corregida» (docs/plan-numeracion-boleta-2026-09-25.md, Fase 2): `anularVenta` anula UNA Operacion VENTA — una línea de
 * la mesa —, así que después de imprimir la boleta se puede anular solo el flan y dejar vigente la milanesa. La boleta impresa quedó
 * desactualizada; esta acción emite el EJEMPLAR SIGUIENTE con el MISMO número (566-A → 566-B), `corrigeAId` al ejemplar A (siempre al A,
 * nunca al anterior: criterio de `CuentaItem.anulaAItemId`), el motivo y quién lo emitió, más una fila en el registro de auditoría
 * (entidad `Cuenta`, campo `ejemplarBoleta`). Nunca edita ni borra un ejemplar.
 *
 * Solo sobre una cuenta de la sucursal, cerrada CON número (las cerradas antes de la numeración no tienen boleta que corregir) y en estado
 * «desactualizada» (`estadoDeBoleta`): si el último ejemplar ya refleja las anulaciones, o la venta se anuló entera, se rechaza. Mismo
 * permiso que cerrar la cuenta. La transacción serializable arbitra dos emisiones a la vez: la segunda reintenta, ve el B ya emitido
 * (vigente) y se rechaza.
 */
export async function emitirBoletaCorregida(cuentaId: string, motivo: string): Promise<ResultadoBoletaCorregida> {
  return conPermiso("pos_cerrar_cuenta", async (ctx) => {
    return conTransaccionSerializable(async (tx) => {
      const cuenta =
        typeof cuentaId === "string"
          ? await tx.cuenta.findFirst({
              where: { id: cuentaId, mesa: { sucursalId: ctx.sucursalId } },
              include: {
                mesa: { select: { numero: true } },
                items: { include: { producto: { select: { nombre: true } }, operacion: { select: { anuladaEn: true } } } },
                ejemplaresBoleta: { orderBy: { ejemplar: "desc" } },
              },
            })
          : null;
      if (!cuenta) return error("No se encontró esa cuenta en esta sucursal.");
      const mesa = cuenta.mesa.numero;
      if (!cuenta.cerradaEn) return error(`La cuenta de la mesa ${mesa} todavía está abierta: no tiene boleta que corregir.`);
      const [ultimo] = cuenta.ejemplaresBoleta;
      const original = cuenta.ejemplaresBoleta.find((e) => e.ejemplar === 1);
      if (!ultimo || !original) return error(`La cuenta de la mesa ${mesa} se cerró antes de la numeración de boletas: no tiene boleta que corregir.`);

      const items: ItemConVenta[] = cuenta.items.map((i) => ({
        productoId: i.productoId,
        productoNombre: i.producto.nombre,
        cantidad: Number(i.cantidad),
        precioUnitario: Number(i.precioUnitario),
        operacionId: i.operacionId,
        anuladaEn: i.operacion?.anuladaEn ?? null,
      }));
      const estado = estadoDeBoleta(items, ultimo.emitidoEn);
      if (estado === "anulada" || !armarBoletaVigente(items).lineas.length) return error("La venta se anuló entera: no hay boleta que corregir.");
      if (estado === "vigente") return error(`La boleta N.º ${formatearNumeroBoleta(ultimo)} ya refleja las anulaciones.`);

      const motivoValidado = validarMotivoAnulacion(motivo);
      if (!motivoValidado.ok) return error(motivoValidado.mensaje);

      const nuevo = { numero: original.numero, ejemplar: ultimo.ejemplar + 1 };
      await tx.ejemplarBoleta.create({
        data: {
          sucursalId: original.sucursalId,
          cuentaId: cuenta.id,
          ...nuevo,
          emitidoEn: new Date(),
          emitidoPorId: ctx.usuarioId,
          corrigeAId: original.id,
          motivo: motivoValidado.motivo,
        },
      });
      const [anterior, emitido, reemplazado] = [formatearNumeroBoleta(ultimo), formatearNumeroBoleta(nuevo), formatearNumeroBoleta(original)];
      await registrarCambioAuditado(tx, {
        entidad: "Cuenta",
        entidadId: cuenta.id,
        descripcion: `Mesa ${mesa}: boleta corregida N.º ${emitido} (reemplaza a N.º ${reemplazado}). Motivo: ${motivoValidado.motivo}`,
        campo: "ejemplarBoleta",
        valorAnterior: anterior,
        valorNuevo: emitido,
        actorId: ctx.usuarioId,
        sucursalId: ctx.sucursalId,
      });
      return { ...ok(`Boleta N.º ${emitido} emitida: reemplaza a N.º ${reemplazado}.`), ...nuevo };
    });
  });
}
