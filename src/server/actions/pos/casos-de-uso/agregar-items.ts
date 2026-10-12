import "server-only";
import type { Prisma } from "@prisma/client";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { aplicarDescuentoDeProducto } from "@/core/carta/public";
import type { ComandoAgregarItems, ResultadoAgregarItems } from "@/core/features/cuentas/cuenta-pedido.schema";
import { redondearMoneda } from "@/core/moneda";
import { tieneStockReal } from "@/core/movimientos/public";
import { calcularPayloadHash, decidirIdempotencia, esChoqueDeIndiceUnico, MENSAJE_CONFLICTO_IDEMPOTENCIA } from "@/core/movimientos/public-servidor";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { resolverPrecioVenta } from "@/server/lecturas/movimientos/precio-venta";
import { validarCantidadPedido } from "@/core/pos/cantidad-pedido";
import { prorratearPrecioPromo, validarYAplanarEleccionPromo, type ComponentePromoElegido, type FilaPromoProrrateada } from "@/core/pos/promo-combo";
import { exito, fracaso } from "@/core/resultado-caso";
import { descuentosDeProductoEnSucursal } from "@/server/lecturas/carta/descuentos";
import { productoDisponibleEn } from "@/server/lecturas/catalogo/disponibilidad";
import { modulosDelPosDeEmpresa, type ModulosDelPos } from "@/server/lecturas/pos/modulos-del-pos";
import { cargarPromoCartaParaAgregar } from "@/server/lecturas/pos/promo-para-agregar";
import { cargarAgregadoDeCuentaPorClave, escribirAgregadoDeCuenta, escribirItemsDeCuenta, escribirPromoDeCuenta } from "@/server/persistencia/pos/pedido";
import { cuentaAbiertaDeSucursal } from "@/server/persistencia/pos/cargar-cuenta-abierta";

/**
 * Caso de uso «agregar ítems y promos sin enviar a una cuenta abierta» (Hito 4 de la pureza, bloque 4.1, paso 12a — `docs/plan-hito-4-pureza.md` §5). Es el
 * cuerpo que antes vivía en línea en la Server Action `agregarItems` (`src/server/actions/pos/cuenta-pedido.ts`), movido TAL CUAL: las mismas lecturas, en el
 * mismo orden y la misma cantidad (lo fija `test/pos/agregar-items-consultas.test.ts`, editado después solo por S-22 / D2 y P18 / D18: la lectura del registro de módulos), dentro de la misma transacción SERIALIZABLE, y los
 * mismos mensajes. La Server Action quedó como adaptador (`conPermiso("pos_tomar_pedido")` → `guardComandoAgregarItems` → este caso de uso →
 * `aResultadoAccion`). El criterio de negocio (precio congelado al agregar, promo revalidada con la misma fuente que el selector, todo o nada) está documentado
 * en la Server Action.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (`conPermiso`) ni el formato de las listas ni el tope (el guard).
 *
 * En UNA transacción SERIALIZABLE (`conTransaccionSerializable`, con reintento ante un conflicto de escritura):
 *  0. (P3, solo con clave) el comprobante de la clave: duplicado → el mensaje original; otra huella → conflicto;
 *  1. la cuenta, de una mesa de ESTA sucursal y abierta (`cuentaAbiertaDeSucursal`, server/persistencia/pos/cargar-cuenta-abierta.ts);
 *  1b. (S-22 / D2) se lee el registro de módulos de la empresa (siempre, una vez): si el pedido trae promos, tiene que tener el módulo Promociones (`PROMO_NO_DISPONIBLE`);
 *      y (P18 / D18) el descuento de producto de la sucursal solo rige con el módulo Carta;
 *  2. VALIDAR todo, sin escribir nada: cada ítem suelto (producto PV, disponible en la sucursal, cantidad con los decimales de su unidad, precio de lista
 *     resuelto y descuento de producto de la sucursal, si la empresa tiene Carta) y cada promo (definición vigente con `cargarPromoCartaParaAgregar`, cupos, prorrateo). El N+1 por ítem
 *     (cada producto se valida con sus propias lecturas) queda como estaba: decisión del dueño (D5 del plan del POS, 2026-10-08), fijado por el conteo de
 *     consultas;
 *  3. ESCRIBIR, recién acá (paso 12b: en server/persistencia/pos/pedido.ts): una `PromoCuenta` por promo (`escribirPromoDeCuenta`, que devuelve el id que
 *     referencian sus componentes) y TODOS los `CuentaItem` (sueltos y componentes) en UN solo `createMany` (`escribirItemsDeCuenta`) y, con clave, lo último: el comprobante (`escribirAgregadoDeCuenta`).
 *
 * Idempotencia I3 (P3 del Paquete 1; cierra O.12): la `claveIdempotencia` es OPCIONAL (igual que compras, mermas y ventas). Con clave, el PRIMER paso de la transacción (antes de mirar la cuenta, para que un
 * reintento con la mesa ya cerrada devuelva el mensaje original y no «ya está cerrada») busca el comprobante `AgregadoDeCuenta` de esa clave: con la misma huella devuelve su mensaje sin escribir nada; con otra huella,
 * `CONFLICTO_IDEMPOTENCIA`. Al final, después de los ítems y en la MISMA transacción, graba el comprobante con el mensaje ya armado: todo o nada. El comprobante es una tabla aparte (no columnas de `CuentaItem`)
 * porque quitar un ítem sin enviar BORRA filas, y con ellas se iría la clave. La carrera de dos envíos simultáneos con la misma clave: el perdedor recibe el 40001 (`conTransaccionSerializable` repite y ve al ganador) o el
 * 23505 del índice único; este se atrapa afuera y se relee al ganador (misma huella: su mensaje; otra, o no visible desde esta empresa: el conflicto, nunca un error genérico ni el contenido ajeno). No se enciende
 * `tambienChoqueDeUnico`: el único índice único que este caso de uso puede chocar es el de la clave, y si el ganador es de otra empresa repetir no lo hace visible (gastaría los 5 intentos con espera antes del mismo conflicto).
 *
 * Qué protege: el reintento del MISMO envío (corte de red, doble envío, doble clic). Qué NO protege: dos pestañas (o dos mozos) con dos pedidos distintos — son dos claves, o sea dos intenciones, y se agregan las dos.
 * Sin clave (llamada a mano, cliente viejo) dos llamadas iguales siguen duplicando los ítems, como antes (lo fija `test/pos/cuenta-concurrencia.test.ts`, (d)).
 *
 * @contract Agrega a una cuenta abierta de la sucursal los ítems sueltos y las promos pedidos, con el precio congelado, todo o nada; con `claveIdempotencia`, exactamente una vez por clave.
 * @idempotency I3 opcional, a mano como `registrarConteoFisico` y `registrarPagoConsignante` (por eso la ficha dice NO_APLICA: `ficha-de-caso-de-uso.test.ts` ata `idempotencia=I3` a llamar a `chequearIdempotencia`, que lee `Operacion`) (claveIdempotencia + payloadHash en AgregadoDeCuenta, sin la clave no hay comprobante) — chequeo dentro de la transacción + catch del choque de unicidad fuera de ella. No cubre dos pedidos distintos con dos claves.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects Con clave, un `AgregadoDeCuenta` (comprobante, solo se agrega). Sin auditoría: `CuentaItem` y `PromoCuenta` son documentos del POS con su usuario. Refrescar la vista lo hace el cliente (`router.refresh()`).
 * @ficha permiso=pos_tomar_pedido transaccion=SERIALIZABLE idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function agregarItemsCasoDeUso(
  // `ahora` (O.22-c): la hora del pedido que fija `conPermiso`; solo llega a la carta del selector que valida cada promo (`generadoEn`, que se descarta).
  // `db` (P3): solo para releer al ganador de una carrera por la misma clave, FUERA de la transacción que chocó.
  actor: Pick<ContextoDeAccion, "usuarioId" | "empresaId" | "sucursalId" | "sucursalNombre" | "transaccion" | "ahora" | "db">,
  comando: ComandoAgregarItems,
): Promise<ResultadoAgregarItems> {
  const { items: items_, promos: promos_, claveIdempotencia } = comando;
  // La huella es del pedido (cuenta, ítems y promos tal cual llegaron) y de la sucursal; sin clave no hay comprobante ni huella.
  const payloadHash = claveIdempotencia ? calcularPayloadHash("POS_AGREGAR_ITEMS", actor.sucursalId, { cuentaId: comando.cuentaId, items: items_, promos: promos_ }) : "";
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoAgregarItems> => {
    // P3 (I3): PRIMER paso, antes de mirar la cuenta: un reintento con la mesa ya cerrada devuelve el mensaje original (nunca «ya está cerrada», que invitaría a cargarlo de nuevo).
    if (claveIdempotencia) {
      const chequeo = decidirIdempotencia(await cargarAgregadoDeCuentaPorClave(tx, claveIdempotencia), payloadHash);
      if (chequeo.estado === "duplicado") return exito(chequeo.mensaje, null);
      if (chequeo.estado === "conflicto") return fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);
    }

    const abierta = await cuentaAbiertaDeSucursal(tx, comando.cuentaId, actor.sucursalId);
    if (!abierta.ok) return fracaso("CUENTA_NO_ABIERTA", abierta.mensaje);

    // S-22 / D2 (decisión del dueño): «si Promociones está apagado, no se pueden agregar promociones para el POS». El gate de `pos_tomar_pedido` solo mira Salón; la promo es un
    // dato de OTRO módulo y el selector no es una barrera (una Server Action se llama a mano con un `promoCartaId`). El registro de módulos se lee SIEMPRE, UNA vez y después de
    // la cuenta (el guard ya garantiza que el pedido trae al menos un ítem o una promo): sirve para rechazar la promo sin el módulo Promociones y para decidir si rige el descuento de
    // producto (P18 / D18, decisión del dueño 2026-10-11: sin el módulo Carta NO se aplica, igual que las promos). Se pasa a la lectura de cada promo para que no lo vuelva a leer.
    // Va ANTES de validar los ítems: sin el módulo no hay nada de la promo que mirar. Las promos que la cuenta YA tiene no pasan por acá (enviar, anular y cerrar no agregan nada).
    const modulos: ModulosDelPos = await modulosDelPosDeEmpresa(actor.empresaId, tx);
    if (promos_.length > 0 && !modulos.promociones) return fracaso("PROMO_NO_DISPONIBLE", "Las promociones no están disponibles: el módulo Promociones no está activo en tu empresa.");

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
      // Producto con descuento (Fase 2): el descuento de ESTA sucursal se aplica acá y el precio de lista queda congelado aparte en `precioCartaUnitario`. P18 / D18: solo con el
      // módulo Carta (sin él, `null`: precio de lista y `precioCartaUnitario` nulo, así que el cierre aplica solo el descuento del cliente); lo mismo hace el selector (paridad).
      const descuento = modulos.carta ? ((await descuentosDeProductoEnSucursal(actor.sucursalId, tx, [producto.id])).get(producto.id) ?? null) : null;
      const aplicado = aplicarDescuentoDeProducto(precioDeLista, descuento);
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
      const def = typeof p?.promoCartaId === "string" ? await cargarPromoCartaParaAgregar(actor.sucursalId, p.promoCartaId, tx, actor.ahora, modulos) : null;
      if (!def) return fracaso("PROMO_INVALIDA", "No se encontró esa promo, o ya no está disponible.");
      const elecciones = Array.isArray(p.elecciones) ? p.elecciones : [];
      // S-01 (O.50): los componentes salen de la elección YA VALIDADA (cupos, elegibles, sin repetidos), nunca de aplanar lo que mandó el cliente.
      const validacion = validarYAplanarEleccionPromo(def.cupos, elecciones);
      if (!validacion.ok) return fracaso("PROMO_INVALIDA", `«${def.titulo}»: ${validacion.mensaje}`);
      const componentes = validacion.componentes.map((c) => ({ ...c, precioCarta: def.precioCartaPorProducto.get(c.productoId) ?? 0 }));
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
    const mensajeFinal = nombresPromos.length ? `${mensaje} Incluye ${nombresPromos.join(", ")}.` : mensaje;
    // P3 (I3): el comprobante, en la MISMA transacción y lo último: si la clave ya la usó otro (carrera, o una clave ajena), se deshace TODO — los ítems también.
    if (claveIdempotencia) await escribirAgregadoDeCuenta(tx, { cuentaId: abierta.cuenta.id, claveIdempotencia, payloadHash, resultadoMensaje: mensajeFinal, creadoPorId: actor.usuarioId });
    return exito(mensajeFinal, null);
  }).catch(async (e): Promise<ResultadoAgregarItems> => {
    // Carrera real (dos envíos con la MISMA clave): el índice único deja pasar a uno y al otro lo rechaza con 23505 (la transacción ya hizo rollback). Se relee al ganador FUERA de ella: con el MISMO
    // payloadHash es un reenvío y se devuelve su mensaje; con otro, o si no se ve desde esta empresa (la clave es única global pero la política de empresa oculta los comprobantes ajenos), es un conflicto
    // — nunca un error genérico ni el contenido de otro. Sin clave el choque no es de acá: se relanza (falla cerrado).
    if (claveIdempotencia && esChoqueDeIndiceUnico(e)) {
      const ganador = await cargarAgregadoDeCuentaPorClave(actor.db, claveIdempotencia);
      if (ganador && ganador.payloadHash === payloadHash) return exito(ganador.resultadoMensaje, null);
      return fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);
    }
    throw e;
  });
}
