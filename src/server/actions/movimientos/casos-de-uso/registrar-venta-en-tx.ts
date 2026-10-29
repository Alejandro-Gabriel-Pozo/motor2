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
import { CODIGO_PRODUCTO_SIN_RECETA, rechazoSinOrigenDeStock } from "@/core/movimientos/origen-de-stock";
import { CODIGO_PRODUCTO_REQUIERE_OPCIONES, rechazoPorOpcionesObligatorias } from "@/core/movimientos/opciones-obligatorias";
import { cargarOpcionesParaVender } from "@/server/lecturas/opciones/opciones-para-vender";
import type { GrupoPermitido } from "@/core/opciones/public";
import { productoDisponibleEn } from "@/server/lecturas/catalogo/disponibilidad";
import { seccionesConStock } from "@/server/lecturas/movimientos/saldos";
import { cargarDeudaDeRedondeo } from "@/server/lecturas/movimientos/deuda-de-redondeo";
import { faltantesDe } from "@/core/movimientos/origen-venta";
import { filasDeUnaVenta } from "@/core/movimientos/filas-de-venta";
import { asignarOrigenDeLaVenta, avisoDeStockNegativo, mensajeStockInsuficiente, rechazoSinRespaldo, type LineaArmada } from "@/core/movimientos/plan-de-la-venta";
import { cargarDatosDeOrigen, prepararOrigen } from "@/server/persistencia/movimientos/cargar-origen-de-venta";
import { resolverPrecioVenta } from "@/server/lecturas/movimientos/precio-venta";
import { calcularCostosYMargenes } from "@/server/lecturas/reportes/costos";
import { construirIndiceRecetas, construirMapaProductos, obtenerCostoActualPorMP } from "@/server/lecturas/reportes/comun";
import { costoUnitarioDeInsumoDesde } from "@/core/reportes/public";
import { consumoDeLineaConfigurada, type ConsumoDeOpcionParaVender, type IngredienteDeBase } from "@/core/movimientos/consumo-de-linea-configurada";
import { consolidarPedidosPorInsumo, costoUnitarioDeLineaConfigurada } from "@/core/movimientos/venta-configurada";
import { crearCacheProducto } from "@/server/persistencia/movimientos/producto-cache";
import { registrarResultadoIdempotente } from "@/server/persistencia/movimientos/idempotencia";
import { escribirLineasDeMovimientoStock } from "@/server/persistencia/movimientos/escribir-movimiento-de-stock";
import { escribirOperacionDeVenta } from "@/server/persistencia/movimientos/escribir-venta";
import type { ActorVenta, AvisoStockNegativo, DatosVentaEnTx, LineaVentaEnTx, OpcionesVentaEnTx, ResultadoVentaEnTx } from "@/core/movimientos/registrar-venta";

type Obtener = ReturnType<typeof crearCacheProducto>;
/** Lo que admite un producto de opciones en la sucursal que vende, y si se vende por opción (Fase 4; ver `crearLectorDeGruposAdmitidos`). */
type GruposAdmitidosDe = (productoId: string) => Promise<{ grupos: readonly GrupoPermitido[]; esBase: boolean }>;

/**
 * OPCIONES OBLIGATORIAS (fila O.430): lo que admite cada producto de las líneas SIN configurar del lote, con el lector de las opciones de venta que usa el POS (`cargarOpcionesParaVender`) y el `tx` de
 * quien llama (la decisión y la escritura ven la misma foto). Se lee UNA vez para todo el lote (nunca una consulta por línea), la PRIMERA vez que una línea llega a la barrera de `armarLinea`: una línea que
 * rechaza antes (producto inexistente, no disponible, cantidad inválida) no suma esa lectura, y un lote sin líneas sin configurar (un cierre cuyas líneas traen todas su foto) no lee nada.
 */
function crearLectorDeGruposAdmitidos(tx: Prisma.TransactionClient, sucursalId: string, lineas: readonly LineaVentaEnTx[]): GruposAdmitidosDe {
  let leidos: ReturnType<typeof cargarOpcionesParaVender> | null = null;
  return async (productoId) => {
    leidos ??= cargarOpcionesParaVender(tx, { sucursalId, productoIds: lineas.filter((l) => l.configurada === undefined).map((l) => l.productoId) });
    const admite = (await leidos).get(productoId);
    return { grupos: admite?.grupos ?? [], esBase: admite?.esBase ?? false };
  };
}

/**
 * GO-2b: cada insumo que una OPCIÓN consume (su versión congelada) tiene que ser una materia prima, estar disponible en la sucursal y tener la unidad de stock que
 * declara la opción. Las mismas lecturas que la receta (la caché de productos y la disponibilidad); solo corre para una línea configurada o un adicional.
 */
async function revisarInsumosDeOpciones(
  consumos: readonly ConsumoDeOpcionParaVender[],
  nombre: string,
  sucursalId: string,
  sucursalNombre: string,
  tx: Prisma.TransactionClient,
  obtenerProducto: Obtener
): Promise<{ ok: false; mensaje: string } | null> {
  for (const c of consumos) {
    const revisada = revisarMateriaPrima(await obtenerProducto(c.insumoProductoId), nombre);
    if (!revisada.ok) return { ok: false, mensaje: revisada.mensaje };
    const mp = revisada.materiaPrima;
    if (!(await productoDisponibleEn(sucursalId, mp.id, tx))) return { ok: false, mensaje: mensajeMateriaPrimaNoDisponible(nombre, mp.nombre, sucursalNombre) };
    if (mp.unidadStockId !== c.unidadStockId) return { ok: false, mensaje: `Una opción de «${nombre}» consume «${mp.nombre}» en otra unidad que la de su stock: revisá el consumo de la opción.` };
  }
  return null;
}

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
  obtenerProducto: Obtener,
  costoUnitarioPorProducto: Map<string, number | null>,
  costoDeInsumo: (productoId: string) => number | null,
  gruposAdmitidosDe: GruposAdmitidosDe
): Promise<{ ok: true; linea: LineaArmada | null } | { ok: false; mensaje: string; codigo?: typeof CODIGO_PRODUCTO_SIN_RECETA | typeof CODIGO_PRODUCTO_REQUIERE_OPCIONES }> {
  // Las reglas (qué cantidad saltea la línea, cuál es un error, qué mensaje gana) son puras y viven en `core/movimientos/linea-de-venta.ts`; acá queda el ORDEN: cada una se llama
  // en el mismo lugar donde estaba el `if`, antes o después de la lectura que le toca (los goldens registran las lecturas también en los rechazos).
  const leida = leerCantidadVendida(item.cantidadVendida);
  if (leida.tipo === "saltear") return { ok: true, linea: null };
  if (leida.tipo === "invalida") return { ok: false, mensaje: leida.mensaje };
  const cantidad = leida.cantidad;
  const configurada = item.configurada;

  const producto = await obtenerProducto(item.productoId);
  if (!producto) return { ok: false, mensaje: MENSAJE_PRODUCTO_NO_EXISTE };
  // GO-2b (ADR-030): el producto ANCLA de un adicional no tiene disponibilidad por sucursal (queda oculto por «sin fila = no disponible»). Saltea ese chequeo SOLO si es
  // el producto de la opción LEÍDO DE LA BASE (`anclaVerificada`), es un PV y no se produce; cualquier otro producto sigue con la disponibilidad de siempre.
  const esAnclaVerificada = configurada?.tipo === "ADICIONAL" && configurada.anclaVerificada === producto.id && producto.tipo === "PV" && !producto.seProduce;
  if (!esAnclaVerificada && !(await productoDisponibleEn(sucursalId, producto.id, tx))) {
    return { ok: false, mensaje: mensajeNoDisponibleEnSucursal(producto.nombre, sucursalNombre) };
  }
  const rechazo = rechazoDelProductoVendido({ nombre: producto.nombre, tipo: producto.tipo, pasoVenta: producto.pasoVenta === null ? null : Number(producto.pasoVenta) }, cantidad);
  if (rechazo !== null) return { ok: false, mensaje: rechazo };
  if (configurada?.tipo === "ADICIONAL" && !esAnclaVerificada) return { ok: false, mensaje: `«${producto.nombre}» no es el producto que respalda ese adicional.` };
  if (configurada?.tipo === "PRODUCTO" && producto.seProduce) {
    return { ok: false, mensaje: `«${producto.nombre}» se produce por lote: todavía no se puede vender con opciones.` };
  }
  // OPCIONES OBLIGATORIAS (fila O.430): la BARRERA FINAL de una línea SIN configurar (la venta de mostrador, que no tiene selector de opciones; o una línea del cierre sin su foto). Un producto que
  // admite un grupo obligatorio (activo para la empresa, o apagado: falla cerrado) no se cobra al precio base: con la MISMA lectura de los grupos que el POS (`cargarOpcionesParaVender`, una vez por lote:
  // `crearLectorDeGruposAdmitidos`) y la MISMA regla (`validarOpcionesElegidas` con cero opciones), antes de leer la receta y de escribir nada. Una línea configurada (o un adicional) ya trae lo
  // elegido y su precio de la foto de la cuenta: no pasa por acá.
  // Fase 4 (ADR-035): un producto que se vende por opción tampoco se cobra suelto, aunque no le quede ningún grupo (su precio guardado no se cobra nunca).
  if (configurada === undefined) {
    const admite = await gruposAdmitidosDe(producto.id);
    const sinOpciones = rechazoPorOpcionesObligatorias(producto.nombre, admite.grupos, admite.esBase);
    if (sinOpciones !== null) return { ok: false, codigo: CODIGO_PRODUCTO_REQUIERE_OPCIONES, mensaje: sinOpciones };
  }

  let pedidos: LineaArmada["pedidos"] = [];
  if (!producto.seProduce) {
    // Un PV que se produce por lote ya consumió su receta al producirse — la venta solo lo resta (ver registrarMovimiento, PRODUCCION).
    // GO-2b: un adicional (su ancla no tiene receta) no lee la receta: su consumo es el de su opción.
    const ingredientes = configurada?.tipo === "ADICIONAL" ? [] : await cargarRecetaVigenteParaVender(tx, { productoId: producto.id, sucursalId });
    // RECETA (ADR-033): la BARRERA FINAL — con la MISMA receta recién leída en esta transacción (sin otra lectura) y antes de escribir nada. Sin receta vigente acá (desactivada entre
    // el pedido y el cobro, o una venta de mostrador), no se vende; el ancla verificada de un adicional queda exceptuada (su consumo es el de su opción).
    // Una línea con opciones (`PRODUCTO`) se decide más abajo, con los pedidos reales que van al libro (decisión del dueño 2026-10-29: una base sin receta se vende si lo elegido descuenta insumos).
    if (configurada?.tipo !== "PRODUCTO") {
      const sinReceta = rechazoSinOrigenDeStock({ nombre: producto.nombre, seProduce: producto.seProduce, esAnclaDeAdicional: esAnclaVerificada, ingredientesDeLaRecetaVigente: ingredientes.length });
      if (sinReceta !== null) return { ok: false, codigo: CODIGO_PRODUCTO_SIN_RECETA, mensaje: sinReceta };
    }
    const base: IngredienteDeBase[] = [];
    for (const ing of ingredientes) {
      const revisada = revisarMateriaPrima(await obtenerProducto(ing.insumoProductoId), producto.nombre);
      if (!revisada.ok) return { ok: false, mensaje: revisada.mensaje };
      const mp = revisada.materiaPrima;
      if (!(await productoDisponibleEn(sucursalId, mp.id, tx))) {
        return { ok: false, mensaje: mensajeMateriaPrimaNoDisponible(producto.nombre, mp.nombre, sucursalNombre) };
      }
      // El consumo con el rendimiento efectivo de ESTA sucursal (D2) es una regla pura: `pedidoDeIngrediente`, en `core/movimientos/linea-de-venta.ts`.
      if (configurada) base.push({ ingrediente: ing, unidadStockId: mp.unidadStockId });
      else pedidos.push(pedidoDeIngrediente(cantidad, ing, mp.unidadStockId, sucursalId));
    }
    if (configurada) {
      // GO-2b: la receta efectiva de la base transformada por las opciones (escala, reemplaza, suma), o el consumo del adicional; una fila por insumo.
      const consumosDeOpciones = configurada.tipo === "PRODUCTO" ? configurada.opciones.flatMap((o) => o.consumos) : configurada.consumos;
      const insumosMal = await revisarInsumosDeOpciones(consumosDeOpciones, producto.nombre, sucursalId, sucursalNombre, tx, obtenerProducto);
      if (insumosMal) return insumosMal;
      const consumo = consumoDeLineaConfigurada(
        configurada.tipo === "PRODUCTO"
          ? { cantidad, sucursalId, base, opciones: configurada.opciones, adicionales: [] }
          : { cantidad, sucursalId, base: [], opciones: [], adicionales: [{ opcionId: configurada.opcionId, nombre: producto.nombre, cantidadPorUnidad: 1, consumos: configurada.consumos }] }
      );
      if (!consumo.ok) return { ok: false, mensaje: `«${producto.nombre}»: ${consumo.mensaje}` };
      pedidos = consolidarPedidosPorInsumo(configurada.tipo === "PRODUCTO" ? consumo.pedidos : consumo.pedidosDeAdicionales[0]!.pedidos);
      if (configurada.tipo === "PRODUCTO") {
        // La misma regla pura, alimentada con lo que la línea descuenta de verdad: decisión y Kardex salen de los mismos `pedidos`.
        const sinReceta = rechazoSinOrigenDeStock({
          nombre: producto.nombre,
          seProduce: producto.seProduce,
          esAnclaDeAdicional: false,
          ingredientesDeLaRecetaVigente: ingredientes.length,
          opciones: { insumos: pedidos.length, nombres: configurada.opciones.map((o) => o.nombre) },
        });
        if (sinReceta !== null) return { ok: false, codigo: CODIGO_PRODUCTO_SIN_RECETA, mensaje: sinReceta };
      }
    }
  }

  const precioVenta = item.precioUnitario ?? (await resolverPrecioVenta(sucursalId, producto.id, Number(producto.precioVenta), tx));
  const precioListaVenta = item.precioListaUnitario ?? null;
  // GO-2b: el costo congelado de una línea configurada (o de un adicional) sale de SUS pedidos, nunca de la receta del producto base sola.
  const costoUnitarioAlVender = configurada ? costoUnitarioDeLineaConfigurada(pedidos, cantidad, costoDeInsumo) : (costoUnitarioPorProducto.get(producto.id) ?? null);

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
  // GO-2b: el catálogo, las recetas y los costos se cargan acá, en el MISMO orden en que los cargaba `calcularCostosYMargenes` (las mismas consultas), para
  // resolver también el costo de cada insumo de una línea configurada con el mismo resolutor.
  const productosDelCatalogo = await construirMapaProductos(actor.sucursalId, tx);
  const indiceRecetas = await construirIndiceRecetas(tx, actor.sucursalId);
  const costosDeCompra = await obtenerCostoActualPorMP(actor.sucursalId, tx);
  const costosDeHoy = await calcularCostosYMargenes(actor.sucursalId, tx, productosDelCatalogo, indiceRecetas, undefined, costosDeCompra);
  const costoUnitarioPorProducto = new Map(costosDeHoy.map((c) => [c.productoId, c.costoIncompleto ? null : c.costo]));
  const costoDeInsumo = costoUnitarioDeInsumoDesde(productosDelCatalogo, indiceRecetas.recetaPorProducto, costosDeCompra);
  const lineas: LineaArmada[] = [];
  // GO-2b: por cada línea armada, el índice (en `lineas`) de la de su padre si es un adicional; `null` en todas las demás.
  const padreDeLinea: (number | null)[] = [];
  const indiceEnLineas = new Map<number, number>();
  const gruposAdmitidosDe = crearLectorDeGruposAdmitidos(tx, actor.sucursalId, datos.lineas);
  for (const [i, item] of datos.lineas.entries()) {
    const armado = await armarLinea(item, actor.sucursalId, actor.sucursalNombre, tx, obtenerProducto, costoUnitarioPorProducto, costoDeInsumo, gruposAdmitidosDe);
    if (!armado.ok) return armado.codigo ? { ok: false, codigo: armado.codigo, mensaje: armado.mensaje } : fallo(armado.mensaje);
    if (!armado.linea) continue;
    let padre: number | null = null;
    if (item.configurada?.tipo === "ADICIONAL") {
      // El padre va ANTES, se vendió en este mismo lote y no es otro adicional; si no, el adicional no tiene a quién colgarse: se rechaza antes de escribir nada.
      const k = item.configurada.indiceLineaPadre;
      const enLineas = k < i ? indiceEnLineas.get(k) : undefined;
      if (enLineas === undefined || datos.lineas[k]?.configurada?.tipo === "ADICIONAL") return fallo(`«${armado.linea.nombre}» es un adicional sin su producto en la venta.`);
      padre = enLineas;
    }
    indiceEnLineas.set(i, lineas.length);
    lineas.push(armado.linea);
    padreDeLinea.push(padre);
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
  for (const [j, venta] of ventas.entries()) {
    const esPrimera = operacionIds.length === 0;
    const padre = padreDeLinea[j] ?? null;
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
      // GO-2b: solo la operación de un adicional, con la de su producto (ya escrita en este bucle: el padre va antes).
      ...(padre !== null ? { operacionPadreId: operacionIds[padre]! } : {}),
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
