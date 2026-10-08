import "server-only";
import type { Prisma } from "@prisma/client";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { aplicarDescuentoDeProducto } from "@/core/carta/public";
import type { ComandoAgregarItems, ResultadoAgregarItems } from "@/core/features/cuentas/cuenta-pedido.schema";
import { redondearMoneda } from "@/core/moneda";
import { tieneStockReal } from "@/core/movimientos/public";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { resolverPrecioVenta } from "@/server/lecturas/movimientos/precio-venta";
import { validarCantidadPedido } from "@/core/pos/cantidad-pedido";
import { componentesDeEleccion, prorratearPrecioPromo, validarEleccionPromo, type ComponentePromoElegido, type FilaPromoProrrateada } from "@/core/pos/promo-combo";
import { exito, fracaso } from "@/core/resultado-caso";
import { descuentosDeProductoEnSucursal } from "@/server/lecturas/carta/descuentos";
import { productoDisponibleEn } from "@/server/lecturas/catalogo/disponibilidad";
import { cargarPromoCartaParaAgregar } from "@/server/lecturas/pos/promo-para-agregar";
import { escribirItemsDeCuenta, escribirPromoDeCuenta } from "@/server/persistencia/pos/pedido";
import { cuentaAbiertaDeSucursal } from "@/server/persistencia/pos/cargar-cuenta-abierta";

/**
 * Caso de uso «agregar ítems y promos sin enviar a una cuenta abierta» (Hito 4 de la pureza, bloque 4.1, paso 12a — `docs/plan-hito-4-pureza.md` §5). Es el
 * cuerpo que antes vivía en línea en la Server Action `agregarItems` (`src/server/actions/pos/cuenta-pedido.ts`), movido TAL CUAL: las mismas lecturas, en el
 * mismo orden y la misma cantidad (lo fija `test/pos/agregar-items-consultas.test.ts`, que no se edita), dentro de la misma transacción SERIALIZABLE, y los
 * mismos mensajes. La Server Action quedó como adaptador (`conPermiso("pos_tomar_pedido")` → `guardComandoAgregarItems` → este caso de uso →
 * `aResultadoAccion`). El criterio de negocio (precio congelado al agregar, promo revalidada con la misma fuente que el selector, todo o nada) está documentado
 * en la Server Action.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (`conPermiso`) ni el formato de las listas ni el tope (el guard).
 *
 * En UNA transacción SERIALIZABLE (`conTransaccionSerializable`, con reintento ante un conflicto de escritura):
 *  1. la cuenta, de una mesa de ESTA sucursal y abierta (`cuentaAbiertaDeSucursal`, server/persistencia/pos/cargar-cuenta-abierta.ts);
 *  2. VALIDAR todo, sin escribir nada: cada ítem suelto (producto PV, disponible en la sucursal, cantidad con los decimales de su unidad, precio de lista
 *     resuelto y descuento de producto de la sucursal) y cada promo (definición vigente con `cargarPromoCartaParaAgregar`, cupos, prorrateo). El N+1 por ítem
 *     (cada producto se valida con sus propias lecturas) queda como estaba: decisión del dueño (D5 del plan del POS, 2026-10-08), fijado por el conteo de
 *     consultas;
 *  3. ESCRIBIR, recién acá (paso 12b: en server/persistencia/pos/pedido.ts): una `PromoCuenta` por promo (`escribirPromoDeCuenta`, que devuelve el id que
 *     referencian sus componentes) y TODOS los `CuentaItem` (sueltos y componentes) en UN solo `createMany` al final (`escribirItemsDeCuenta`).
 *
 * O.12 (Hito 4, documentado y fijado, NO arreglado): este caso de uso NO tiene idempotencia I3 — dos llamadas iguales DUPLICAN los ítems (lo fija
 * `test/pos/cuenta-concurrencia.test.ts`, (d)). Lo único que frena el doble clic es la pantalla, que deshabilita el botón mientras la acción está pendiente;
 * no cubre dos pestañas ni un reintento de red. Agregar una clave I3 es una decisión aparte del dueño, no parte de esta mudanza.
 *
 * @contract Agrega a una cuenta abierta de la sucursal los ítems sueltos y las promos pedidos, con el precio congelado, todo o nada.
 * @idempotency No aplica — sin I3 (O.12): dos llamadas iguales duplican los ítems; solo la pantalla (botón deshabilitado mientras está pendiente) frena el doble clic.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects Ninguno (sin auditoría: `CuentaItem` y `PromoCuenta` son documentos del POS con su usuario). Refrescar la vista lo hace el cliente (`router.refresh()`).
 * @ficha permiso=pos_tomar_pedido transaccion=SERIALIZABLE idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function agregarItemsCasoDeUso(
  // `ahora` (O.22-c): la hora del pedido que fija `conPermiso`; solo llega a la carta del selector que valida cada promo (`generadoEn`, que se descarta).
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "sucursalNombre" | "transaccion" | "ahora">,
  comando: ComandoAgregarItems,
): Promise<ResultadoAgregarItems> {
  const { items: items_, promos: promos_ } = comando;
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoAgregarItems> => {
    const abierta = await cuentaAbiertaDeSucursal(tx, comando.cuentaId, actor.sucursalId);
    if (!abierta.ok) return fracaso("CUENTA_NO_ABIERTA", abierta.mensaje);

    // Fase 1: VALIDAR todo, sin escribir nada — ni los sueltos ni las promos (mismo criterio que registrarVentaEnTx).
    const filasSueltas: Prisma.CuentaItemCreateManyInput[] = [];
    for (const item of items_) {
      const producto = typeof item?.productoId === "string" ? await tx.producto.findUnique({ where: { id: item.productoId }, include: { unidadStock: { select: { decimales: true } } } }) : null;
      if (!producto) return fracaso("PRODUCTO_INVALIDO", "El producto no existe.");
      if (producto.tipo !== "PV") return fracaso("PRODUCTO_INVALIDO", `«${producto.nombre}» no se puede pedir: solo se piden productos de venta (PV).`);
      if (!(await productoDisponibleEn(actor.sucursalId, producto.id, tx))) return fracaso("PRODUCTO_INVALIDO", `«${producto.nombre}» no está disponible en «${actor.sucursalNombre}».`);
      const paso = producto.pasoVenta !== null ? { pasoVenta: Number(producto.pasoVenta), tieneStockReal: tieneStockReal(producto.tipo, producto.seProduce) } : null;
      const cantidad = validarCantidadPedido(item.cantidad, producto.unidadStock.decimales, paso);
      if (!cantidad.ok) return fracaso("PRODUCTO_INVALIDO", `«${producto.nombre}»: ${cantidad.mensaje}`);
      const precioDeLista = redondearMoneda(await resolverPrecioVenta(actor.sucursalId, producto.id, Number(producto.precioVenta), tx));
      // Producto con descuento (Fase 2): el descuento de ESTA sucursal se aplica acá y el precio de lista queda congelado aparte en `precioCartaUnitario`.
      const aplicado = aplicarDescuentoDeProducto(precioDeLista, (await descuentosDeProductoEnSucursal(actor.sucursalId, tx, [producto.id])).get(producto.id) ?? null);
      filasSueltas.push({
        cuentaId: abierta.cuenta.id,
        productoId: producto.id,
        cantidad: cantidad.cantidad,
        precioUnitario: aplicado.precio,
        precioCartaUnitario: aplicado.precioLista,
        numeroEnvio: null,
        creadoPorId: actor.usuarioId,
      });
    }

    const promosValidadas: { titulo: string; promoCartaId: string; precio: number; componentes: (ComponentePromoElegido & { precioCarta: number })[]; filas: FilaPromoProrrateada[] }[] = [];
    for (const p of promos_) {
      const def = typeof p?.promoCartaId === "string" ? await cargarPromoCartaParaAgregar(actor.sucursalId, p.promoCartaId, tx, actor.ahora) : null;
      if (!def) return fracaso("PROMO_INVALIDA", "No se encontró esa promo, o ya no está disponible.");
      const elecciones = Array.isArray(p.elecciones) ? p.elecciones : [];
      const validacion = validarEleccionPromo(def.cupos, elecciones);
      if (!validacion.ok) return fracaso("PROMO_INVALIDA", `«${def.titulo}»: ${validacion.mensaje}`);
      const componentes = componentesDeEleccion(elecciones).map((c) => ({ ...c, precioCarta: def.precioCartaPorProducto.get(c.productoId) ?? 0 }));
      const prorrateo = prorratearPrecioPromo(def.precio, componentes);
      if (!prorrateo.ok) return fracaso("PROMO_INVALIDA", `«${def.titulo}»: ${prorrateo.mensaje}`);
      promosValidadas.push({ titulo: def.titulo, promoCartaId: def.id, precio: def.precio, componentes, filas: prorrateo.filas });
    }

    // Fase 2: ESCRIBIR — recién acá, con todo ya validado. Una PromoCuenta por promo (necesita su id antes de poder crear los
    // CuentaItem que la referencian); todos los CuentaItem (sueltos y componentes) en UN solo createMany al final.
    const filas = [...filasSueltas];
    for (const p of promosValidadas) {
      const promoCuentaId = await escribirPromoDeCuenta(tx, { cuentaId: abierta.cuenta.id, promoCartaId: p.promoCartaId, precio: p.precio, titulo: p.titulo, creadoPorId: actor.usuarioId });
      const precioCartaDe = (productoId: string) => p.componentes.find((c) => c.productoId === productoId)?.precioCarta ?? null;
      for (const fila of p.filas) {
        filas.push({
          cuentaId: abierta.cuenta.id,
          productoId: fila.productoId,
          cantidad: fila.cantidad,
          precioUnitario: fila.precioUnitario,
          numeroEnvio: null,
          creadoPorId: actor.usuarioId,
          promoCuentaId,
          precioCartaUnitario: precioCartaDe(fila.productoId),
        });
      }
    }

    await escribirItemsDeCuenta(tx, filas);
    const mensaje = `${filas.length === 1 ? "Se agregó 1 ítem" : `Se agregaron ${filas.length} ítems`} a la mesa ${abierta.cuenta.mesa.numero}.`;
    const nombresPromos = promosValidadas.map((p) => `«${p.titulo}»`);
    return exito(nombresPromos.length ? `${mensaje} Incluye ${nombresPromos.join(", ")}.` : mensaje, null);
  });
}
