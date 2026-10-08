import "server-only";
import type { Prisma } from "@prisma/client";
import { texto } from "@/core/texto";
import { crearArrastreDeRedondeo } from "@/core/movimientos/arrastre-redondeo";
import {
  leerCantidadVendida,
  MENSAJE_PRODUCTO_NO_EXISTE,
  mensajeMateriaPrimaNoDisponible,
  mensajeNoDisponibleEnSucursal,
  pedidoDeIngrediente,
  rechazoDelProductoVendido,
  revisarMateriaPrima,
} from "@/core/movimientos/linea-de-venta";
import { cargarRecetaVigenteParaVender } from "@/server/lecturas/movimientos/receta-para-vender";
import { productoDisponibleEn } from "@/server/lecturas/catalogo/disponibilidad";
import { seccionesConStock } from "@/server/lecturas/movimientos/saldos";
import { cargarDeudaDeRedondeo } from "@/server/lecturas/movimientos/deuda-de-redondeo";
import { faltantesDe } from "@/core/movimientos/origen-venta";
import { filasDeUnaVenta } from "@/core/movimientos/filas-de-venta";
import { asignarOrigenDeLaVenta, avisoDeStockNegativo, mensajeStockInsuficiente, rechazoSinRespaldo, type LineaArmada } from "@/core/movimientos/plan-de-la-venta";
import { cargarDatosDeOrigen, prepararOrigen } from "@/server/persistencia/movimientos/cargar-origen-de-venta";
import { resolverPrecioVenta } from "@/server/lecturas/movimientos/precio-venta";
import { calcularCostosYMargenes } from "@/server/lecturas/reportes/costos";
import { crearCacheProducto } from "@/server/persistencia/movimientos/producto-cache";
import { registrarResultadoIdempotente } from "@/server/persistencia/movimientos/idempotencia";
import { escribirLineasDeMovimientoStock } from "@/server/persistencia/movimientos/escribir-movimiento-de-stock";
import { escribirOperacionDeVenta } from "@/server/persistencia/movimientos/escribir-venta";
import type { ActorVenta, AvisoStockNegativo, DatosVentaEnTx, LineaVentaEnTx, OpcionesVentaEnTx, ResultadoVentaEnTx } from "@/core/movimientos/registrar-venta";

/**
 * `registrarVentaEnTx` — el núcleo de la Venta (Pureza Fase 4, tramo A: mudado TAL CUAL desde `core/movimientos/registrar-venta.ts`, mismo nombre y misma firma). Es un paso
 * compartido, SIN `@ficha` y sin `"use server"` (igual que `armar-linea-de-movimiento.ts`): lo usan `registrarVentaCasoDeUso` (mostrador) y `cerrarCuentaCasoDeUso` (POS),
 * cada uno dentro de SU transacción SERIALIZABLE. Los tipos (`ActorVenta`, `DatosVentaEnTx`, …) y el docstring del contrato viven en `core/movimientos/registrar-venta.ts`.
 */

function fallo(mensaje: string): { ok: false; mensaje: string } {
  return { ok: false, mensaje };
}

/**
 * Port de armarPreviaVentaDesdeItems_ (Movimientos.js:1682-1775) para UNA
 * línea. Sesión "eliminar COMPRA+VENTA": lo único vendible es un PV
 * (vinculado por receta a la MP que consume, aunque sea una receta 1:1 sin
 * merma) — ya no existe la venta directa de una MP. Valida y devuelve lo que
 * pide la receta; NO decide secciones ni lotes (eso lo hace el libro, con
 * todas las líneas a la vista).
 */
async function armarLinea(
  item: LineaVentaEnTx,
  sucursalId: string,
  sucursalNombre: string,
  tx: Prisma.TransactionClient,
  obtenerProducto: ReturnType<typeof crearCacheProducto>,
  costoUnitarioPorProducto: Map<string, number | null>
): Promise<{ ok: true; linea: LineaArmada | null } | { ok: false; mensaje: string }> {
  // Las reglas (qué cantidad saltea la línea, cuál es un error, qué mensaje gana) son puras y viven en `core/movimientos/linea-de-venta.ts`; acá queda el ORDEN: cada una se llama
  // en el mismo lugar donde estaba el `if`, antes o después de la lectura que le toca (los goldens registran las lecturas también en los rechazos).
  const leida = leerCantidadVendida(item.cantidadVendida);
  if (leida.tipo === "saltear") return { ok: true, linea: null };
  if (leida.tipo === "invalida") return { ok: false, mensaje: leida.mensaje };
  const cantidad = leida.cantidad;

  const producto = await obtenerProducto(item.productoId);
  if (!producto) return { ok: false, mensaje: MENSAJE_PRODUCTO_NO_EXISTE };
  if (!(await productoDisponibleEn(sucursalId, producto.id, tx))) {
    return { ok: false, mensaje: mensajeNoDisponibleEnSucursal(producto.nombre, sucursalNombre) };
  }
  const rechazo = rechazoDelProductoVendido({ nombre: producto.nombre, tipo: producto.tipo, pasoVenta: producto.pasoVenta === null ? null : Number(producto.pasoVenta) }, cantidad);
  if (rechazo !== null) return { ok: false, mensaje: rechazo };

  const pedidos: LineaArmada["pedidos"] = [];
  if (!producto.seProduce) {
    // Un PV que se produce por lote ya consumió su receta al producirse — la venta solo lo resta (ver registrarMovimiento, PRODUCCION).
    const ingredientes = await cargarRecetaVigenteParaVender(tx, { productoId: producto.id, sucursalId });
    for (const ing of ingredientes) {
      const revisada = revisarMateriaPrima(await obtenerProducto(ing.insumoProductoId), producto.nombre);
      if (!revisada.ok) return { ok: false, mensaje: revisada.mensaje };
      const mp = revisada.materiaPrima;
      if (!(await productoDisponibleEn(sucursalId, mp.id, tx))) {
        return { ok: false, mensaje: mensajeMateriaPrimaNoDisponible(producto.nombre, mp.nombre, sucursalNombre) };
      }
      // El consumo con el rendimiento efectivo de ESTA sucursal (D2) es una regla pura: `pedidoDeIngrediente`, en `core/movimientos/linea-de-venta.ts`.
      pedidos.push(pedidoDeIngrediente(cantidad, ing, mp.unidadStockId, sucursalId));
    }
  }

  const precioVenta = item.precioUnitario ?? (await resolverPrecioVenta(sucursalId, producto.id, Number(producto.precioVenta), tx));
  const precioListaVenta = item.precioListaUnitario ?? null;
  const costoUnitarioAlVender = costoUnitarioPorProducto.get(producto.id) ?? null;

  return {
    ok: true,
    linea: { productoId: producto.id, nombre: producto.nombre, seProduce: producto.seProduce, cantidadVendida: cantidad, precioVenta, precioListaVenta, costoUnitarioAlVender, promoCuentaId: item.promoCuentaId ?? null, pedidos },
  };
}

/**
 * Port de confirmarRegistrarVenta_ConLock_ (Movimientos.js:1154-1332).
 * A diferencia del resto de los procesos, cada venta individual del lote
 * es su propia Operacion (idOperacionVenta propio en Apps Script) — para
 * poder reconstruir "qué consumió esta venta puntual" (con su Liquidación
 * de consignación si aplica) sin mezclarse con las demás ventas
 * confirmadas en el mismo lote. La validación de stock, en cambio, se hace
 * UNA vez sobre TODO el payload junto (mismo bugfix C-1 que registrarMovimiento).
 *
 * Toda la validación ocurre ANTES de la primera escritura: un `ok: false` no deja nada escrito en la transacción de quien llama.
 * `operacionIds` sale en el orden de las líneas con cantidad válida (una Operacion por línea).
 */
export async function registrarVentaEnTx(
  tx: Prisma.TransactionClient,
  actor: ActorVenta,
  datos: DatosVentaEnTx,
  opciones: OpcionesVentaEnTx = {}
): Promise<ResultadoVentaEnTx> {
  const origen = await prepararOrigen(tx, actor.sucursalId, datos.origen);
  if (!origen.ok) return fallo(origen.mensaje);

  const obtenerProducto = crearCacheProducto(tx);
  // Una sola resolución de costos para todo el lote (no por línea) —
  // calcularCostosYMargenes ya recorre el catálogo entero, repetirla
  // por ítem sería trabajo redundante dentro de la misma transacción.
  const costosDeHoy = await calcularCostosYMargenes(actor.sucursalId, tx);
  const costoUnitarioPorProducto = new Map(costosDeHoy.map((c) => [c.productoId, c.costoIncompleto ? null : c.costo]));
  const lineas: LineaArmada[] = [];
  for (const item of datos.lineas) {
    const armado = await armarLinea(item, actor.sucursalId, actor.sucursalNombre, tx, obtenerProducto, costoUnitarioPorProducto);
    if (!armado.ok) return fallo(armado.mensaje);
    if (armado.linea) lineas.push(armado.linea);
  }
  if (!lineas.length) return fallo("Ninguna línea tiene una cantidad válida.");

  // De qué sección y lote sale cada cosa: todo con UN libro para la venta entera, en el orden de las líneas y de sus ingredientes.
  const mpIds = Array.from(new Set(lineas.flatMap((l) => l.pedidos.map((p) => p.productoId))));
  const pvQueSeProducenIds = Array.from(new Set(lineas.filter((l) => l.seProduce).map((l) => l.productoId)));
  const pvIds = Array.from(new Set(lineas.map((l) => l.productoId)));
  const insumoSustitutoIds = Array.from(new Set(lineas.flatMap((l) => l.pedidos.flatMap((p) => p.insumoSustitutoIds))));
  const origenDatos = await cargarDatosDeOrigen(tx, actor.sucursalId, origen, { pvIds, mpIds, pvQueSeProducenIds, insumoSustitutoIds });
  const libro = origenDatos.libro;
  // Sin ninguna sección de respaldo (todas excluidas con `sirveDeRespaldoEnVentas`), un PV sin habitual no tiene de dónde salir: se
  // rechaza ANTES de escribir nada, con la salida concreta (la regla y el texto son puros: `rechazoSinRespaldo`, en `core/movimientos/plan-de-la-venta.ts`).
  const sinRespaldo = rechazoSinRespaldo(lineas, origenDatos, actor.sucursalNombre);
  if (sinRespaldo !== null) return fallo(sinRespaldo);

  // El reparto de la venta entera (stock propio de los PV que se producen → UN solo asignarConsumosDeVenta → cada venta con su sección) es una función pura sobre el libro ya cargado: `asignarOrigenDeLaVenta`.
  const { ventas, pedidosPlanos } = asignarOrigenDeLaVenta(lineas, origenDatos);

  // Validación de stock agregada: cada consumo de receta descuenta
  // stock real — el producto vendido en sí nunca descuenta su propio
  // stock (solo lo que consume su receta), mismo criterio que Apps
  // Script desde "eliminar COMPRA+VENTA". El libro ya sumó todas las líneas — familiasIds suma las familias sustitutas realmente
  // resueltas (D6/D8) para que un faltante ahí también avise/rechace, igual que uno de la familia principal.
  const familiasIds = new Set([...mpIds.flatMap((id) => origenDatos.familiaDe(id)), ...pedidosPlanos.flatMap((p) => (p.sustitutos ?? []).flat())]);
  const avisosStockNegativo: AvisoStockNegativo[] = [];
  for (const faltante of faltantesDe(libro, familiasIds)) {
    const producto = await obtenerProducto(faltante.productoId);
    if (opciones.permitirStockNegativo) {
      // El aviso y el texto del rechazo son puros (`avisoDeStockNegativo`, `mensajeStockInsuficiente`, en `core/movimientos/plan-de-la-venta.ts`); acá queda la decisión de cuál corresponde y la lectura de la pista.
      avisosStockNegativo.push(avisoDeStockNegativo(faltante, producto, origenDatos.nombreDeSeccion(faltante.seccionId)));
      continue;
    }
    const pista = await seccionesConStock(faltante.productoId, actor.sucursalId, tx);
    return fallo(mensajeStockInsuficiente(faltante, producto, pista));
  }

  // Arrastre de redondeo (Task #27, docs/plan-redondeo-consumo-fraccionado-2026-09-26.md): UNA sola carga para la venta ENTERA (todos
  // los productos que algún consumo va a tocar), después de validar stock (arriba, con la cantidad EXACTA — el arrastre nunca influye
  // en si una venta se acepta o se rechaza) y antes del bucle de escritura, porque el arrastre tiene que vivir durante TODO ese
  // bucle: dos consumos del mismo producto en esta misma venta (ej. napolitana + muzzarella, mismo bollo) también se arrastran entre
  // sí, no solo entre ventas distintas.
  const productosConsumidosIds = Array.from(new Set(ventas.flatMap((v) => v.consumos.map((c) => c.productoId))));
  const arrastreDeRedondeo = crearArrastreDeRedondeo(await cargarDeudaDeRedondeo(tx, actor.sucursalId, productosConsumidosIds));

  // Las fichas de los productos que el bucle de abajo necesita (cada producto consumido y, si la parte salió de un sustituto, el producto al que reemplazó) se leen ACÁ, en el orden de las
  // ventas y de sus consumos, y no adentro del bucle: así lo que arma las filas de una venta ya no lee nada. DESPUÉS de la validación de stock (un rechazo no suma lecturas) y la caché de
  // `obtenerProducto` deduplica: el multiconjunto de lecturas de la transacción es el mismo que cuando se leía adentro del bucle.
  const productos = new Map<string, Awaited<ReturnType<typeof obtenerProducto>>>();
  for (const venta of ventas) {
    for (const c of venta.consumos) {
      productos.set(c.productoId, await obtenerProducto(c.productoId));
      if (c.sustituyeAProductoId) productos.set(c.sustituyeAProductoId, await obtenerProducto(c.sustituyeAProductoId));
    }
  }

  const filas: Prisma.MovimientoStockCreateManyInput[] = [];
  const operacionIds: string[] = [];
  for (const venta of ventas) {
    const esPrimera = operacionIds.length === 0;
    const operacion: { id: string } = await escribirOperacionDeVenta(tx, {
      sucursalId: actor.sucursalId,
      fecha: datos.fecha,
      proveedorId: datos.proveedorId ?? null,
      clienteId: datos.clienteId ?? null,
      promoCuentaId: venta.promoCuentaId,
      nroFactura: texto(datos.nroFactura) || null,
      detalleLibre: texto(datos.detalle) || null,
      usuarioId: actor.usuarioId,
      claveIdempotencia: esPrimera && opciones.idempotencia ? opciones.idempotencia.clave : null,
      payloadHash: esPrimera && opciones.idempotencia ? opciones.idempotencia.payloadHash : null,
    });
    operacionIds.push(operacion.id);

    // Las filas de esta venta —CONSUMO con el redondeo CON ARRASTRE, LIQUIDACION_CONSIGNACION y VENTA, una por lote si el PV que se produce sale de más de uno— son una regla pura sobre lo ya leído:
    // `filasDeUnaVenta`, en `core/movimientos/filas-de-venta.ts` (el docstring del arrastre y de la repartición del importe viven ahí). Acá queda el ORDEN: la `Operacion` primero, después sus filas, y UN solo `createMany` al final.
    filas.push(...filasDeUnaVenta(venta, operacion.id, { detalle: datos.detalle, productoDe: (productoId) => productos.get(productoId), arrastre: arrastreDeRedondeo }));
  }

  await escribirLineasDeMovimientoStock(tx, filas);
  const mensaje = `Se registraron ${ventas.length} venta(s) correctamente.`;

  if (opciones.idempotencia) {
    await registrarResultadoIdempotente(tx, operacionIds[0]!, mensaje);
  }

  return { ok: true, mensaje, operacionIds, avisosStockNegativo };
}
