import type { Prisma } from "@prisma/client";
import { texto } from "@/core/texto";
import { esNumeroFinito } from "@/core/numero";
import { redondearACantidadDeUnidad } from "@/core/movimientos/transiciones";
import { crearArrastreDeRedondeo } from "@/core/movimientos/arrastre-redondeo";
import { cargarRecetaVigente, cumplePaso, mensajeCantidadNoCumplePaso, rendimientoEfectivo } from "@/core/catalogo/public";
import { importeDeLinea, redondearMoneda } from "@/core/moneda";
import { seccionesConStock } from "@/core/movimientos/stock";
import { asignarConsumosDeVenta, elegirSeccionDeStockPropio, faltantesDe, type ParteAsignada, type ParteConsumo, type PedidoDeConsumo } from "@/core/movimientos/origen-venta";
import { cargarDatosDeOrigen, prepararOrigen, type OrigenVenta } from "@/core/movimientos/origen-venta-datos";
import { productoDisponibleEn } from "@/core/catalogo/public-servidor";
import { resolverPrecioVenta } from "@/core/movimientos/precio-venta";
import { calcularCostosYMargenes } from "@/core/reportes/public-servidor";
import { crearCacheProducto } from "@/core/movimientos/producto-cache";

/**
 * Núcleo de la Venta, SIN permisos ni transacción propia (no es una Server Action: sin "use server"). Extraído tal cual de
 * `registrarVenta` (src/server/actions/movimientos/venta.ts) para que el cierre de una cuenta del salón (`cerrarCuenta`,
 * src/server/actions/pos/cuenta-cierre.ts) registre la venta con EXACTAMENTE la misma validación y escritura, dentro de SU transacción
 * (docs/plan-tomar-pedido-2026-09-25.md, B6). Quien llama es responsable de: el permiso, la transacción serializable
 * (`conTransaccionSerializable`) y — si aplica — el chequeo de idempotencia previo.
 *
 * Tres extensiones internas, que la Server Action pública NUNCA expone (mapea cada línea a `{ productoId, cantidadVendida }` a mano):
 * - `precioUnitario` por línea: reemplaza a `resolverPrecioVenta`. Lo usa `cerrarCuenta` para cobrar el precio CONGELADO al tomar
 *   el pedido, no el de hoy — y, con un cliente con descuento asignado (Task #14), el precio YA CON el descuento aplicado
 *   (`precioConDescuento`, src/core/moneda.ts): esta función no sabe nada de clientes ni de porcentajes, solo recibe el número final.
 * - `precioListaUnitario` por línea (Task #14, docs/plan-clientes-descuento-2026-09-26.md, punto 3): el precio de LISTA de esa línea,
 *   cuando difiere de `precioUnitario` (venta con descuento) — se guarda tal cual en `MovimientoStock.precioListaUnitario` de la fila
 *   VENTA. Quien llama decide si lo manda (`cerrarCuenta` lo omite cuando no hay descuento, o cuando el descuento no cambió el
 *   precio por el piso de 0,01 — no hay nada que este núcleo tenga que comparar).
 * - `datos.clienteId` (Task #14): el cliente de la cuenta, si tiene uno asignado — va en CADA Operacion que crea este lote
 *   (`Operacion.clienteId`, FK RESTRICT). `undefined`/`null` = sin cliente, el caso de siempre (mostrador, o una mesa sin cliente
 *   asignado).
 * - `opciones.permitirStockNegativo` (B6bis, decisión del dueño): con `true`, un insumo sin stock suficiente NO aborta la venta; el
 *   movimiento se escribe igual (el Kardex es un ledger por suma: el saldo queda negativo) y se devuelve en `avisosStockNegativo`.
 *   Ausente o `false` (el caso de `registrarVenta`): rechaza igual que siempre.
 * - `promoCuentaId` por línea (Task #16, docs/plan-promo-combo-2026-09-26.md, paso 7): la `PromoCuenta` de la que ese componente
 *   forma parte, si la línea viene de armar una promo en el POS — va en la `Operacion` que registra ESA línea (`Operacion.
 *   promoCuentaId`, FK RESTRICT), igual patrón que `datos.clienteId`. `undefined`/`null` = un suelto de siempre (el caso de
 *   `registrarVenta`, D7: la venta de mostrador nunca lo pasa — mapea cada línea a mano a `{ productoId, cantidadVendida }`,
 *   ver `src/server/actions/movimientos/venta.ts`). Convive con el arrastre de redondeo de la Task #27 (`cargarDeudaDeRedondeo`/
 *   `crearArrastreDeRedondeo`, más abajo) sin tocarlo: son dos campos independientes de la misma `Operacion`/línea, y el
 *   arrastre se calcula por (sucursal, producto CONSUMIDO), nunca por promo.
 *
 * DE QUÉ SECCIÓN SALE cada consumo lo decide `origen` (docs/plan-seccion-habitual-stock-2026-09-25.md, C5): `{ tipo: "seccion" }` (la
 * elegida por una persona: mostrador) o `{ tipo: "automatico" }` (el cierre del POS). En los dos casos los consumos se asignan con el
 * LIBRO de `origen-venta.ts`, que lleva la cuenta de lo ya asignado entre las líneas de la misma venta (arregla H9).
 */

export type { OrigenVenta };

export interface ActorVenta {
  usuarioId: string;
  sucursalId: string;
  sucursalNombre: string;
}

export interface LineaVentaEnTx {
  productoId: string;
  cantidadVendida: number;
  /** Override INTERNO del precio de venta (ver el docstring del módulo). Ausente = Precio Local o global de hoy. */
  precioUnitario?: number;
  /** Precio de LISTA, si difiere de `precioUnitario` (Task #14 — ver el docstring del módulo). Ausente = coinciden, no se guarda. */
  precioListaUnitario?: number;
  /** La `PromoCuenta` de la que este componente forma parte (Task #16 — ver el docstring del módulo). Ausente/null = un suelto. */
  promoCuentaId?: string | null;
}

export interface DatosVentaEnTx {
  fecha: Date;
  origen: OrigenVenta;
  proveedorId?: string | null;
  /** Cliente con descuento de la cuenta, si tiene uno asignado (Task #14 — ver el docstring del módulo). */
  clienteId?: string | null;
  nroFactura?: string;
  detalle?: string;
  lineas: LineaVentaEnTx[];
}

export interface OpcionesVentaEnTx {
  permitirStockNegativo?: boolean;
  /** I3: clave y hash del intento, que se guardan en la PRIMERA Operacion del lote junto con el mensaje devuelto (ver registrarVenta). */
  idempotencia?: { clave: string; payloadHash: string };
}

export interface AvisoStockNegativo {
  productoId: string;
  nombre: string;
  /** Sección en la que quedó en negativo. */
  seccionId: string;
  seccionNombre: string;
  /** Saldo del insumo en la sección ANTES de esta venta. */
  actual: number;
  /** Lo que la venta consumió de ese insumo. */
  requerido: number;
  /** Saldo con el que quedó después de la venta (negativo). */
  resultante: number;
}

export type ResultadoVentaEnTx =
  | { ok: true; mensaje: string; operacionIds: string[]; avisosStockNegativo: AvisoStockNegativo[] }
  | { ok: false; mensaje: string };

/** Una línea validada, todavía SIN sección: lo que pide su receta (o su stock propio, si se produce) se asigna después, con el libro. */
interface LineaArmada {
  productoId: string;
  nombre: string;
  seProduce: boolean;
  cantidadVendida: number;
  precioVenta: number;
  /** Precio de LISTA de esta línea, si difiere de `precioVenta` (Task #14). `null` = coinciden, no se guarda nada distinto. */
  precioListaVenta: number | null;
  /** Costo de receta resuelto AL MOMENTO de esta venta (docstring en schema.prisma, MovimientoStock.costoUnitarioVenta) — null si el costeo estaba incompleto ese día. */
  costoUnitarioAlVender: number | null;
  /** La `PromoCuenta` de la que esta línea es un componente (Task #16) — null = un suelto. */
  promoCuentaId: string | null;
  /** Consumo de receta por ingrediente, en el orden de los ingredientes (id ascendente: determinístico para el libro). */
  pedidos: {
    productoId: string;
    cantidad: number;
    /** Insumos sustitutos declarados en ESTA línea de receta, en orden (docs/plan-sustitucion-insumos-receta-2026-09-26.md, D1). */
    insumoSustitutoIds: string[];
    /** Unidad de stock de la MP principal — la familia sustituta se filtra a esta misma unidad (D8). */
    unidadStockId: string;
  }[];
}

interface VentaCalculada extends LineaArmada {
  seccionId: string;
  loteVencimiento: Date | null;
  consumos: ParteConsumo[];
}

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
  const cantidad = Number(item.cantidadVendida || 0);
  if (!(cantidad > 0)) return { ok: true, linea: null };
  if (!esNumeroFinito(cantidad)) return { ok: false, mensaje: "La cantidad vendida no es un número válido." };

  const producto = await obtenerProducto(item.productoId);
  if (!producto) return { ok: false, mensaje: `El producto no existe.` };
  if (!(await productoDisponibleEn(sucursalId, producto.id, tx))) {
    return { ok: false, mensaje: `«${producto.nombre}» no está disponible en «${sucursalNombre}».` };
  }
  if (producto.tipo !== "PV") {
    return { ok: false, mensaje: `"${producto.nombre}" no está habilitado para venta: solo se puede vender un PV (vinculado por receta a la materia prima que consume).` };
  }
  // Venta fraccionada (Task #25, docs/plan-venta-fraccionada-2026-09-26.md): validación ADICIONAL, específica del paso — no
  // reemplaza ninguna validación de decimales general (mostrador no tenía ninguna, y sigue sin tenerla). Comparte este núcleo con
  // `cerrarCuenta` (POS): cada línea que llega acá ya pasó por `validarCantidadPedido` al cargarse (múltiplo exacto del paso), y la
  // SUMA de múltiplos exactos sigue siendo un múltiplo exacto — así que esto nunca debería disparar desde el POS, solo desde la
  // venta de mostrador directa (`registrarVenta`), que hoy no valida nada de esto.
  if (producto.pasoVenta !== null) {
    const paso = Number(producto.pasoVenta);
    if (!cumplePaso(cantidad, paso)) return { ok: false, mensaje: `"${producto.nombre}": ${mensajeCantidadNoCumplePaso(paso)}` };
  }

  const pedidos: LineaArmada["pedidos"] = [];
  if (!producto.seProduce) {
    // Un PV que se produce por lote ya consumió su receta al producirse — la venta solo lo resta (ver registrarMovimiento, PRODUCCION).
    const receta = await cargarRecetaVigente(tx, producto.id, {
      include: {
        ingredientes: {
          orderBy: { id: "asc" },
          include: { sustitutos: { orderBy: { orden: "asc" } }, rendimientosLocales: { where: { sucursalId } } },
        },
      },
    });
    for (const ing of receta?.ingredientes ?? []) {
      const mp = await obtenerProducto(ing.insumoProductoId);
      if (!mp || mp.tipo !== "MP") {
        return { ok: false, mensaje: `La materia prima de la receta de "${producto.nombre}" no está marcada como MP.` };
      }
      if (!(await productoDisponibleEn(sucursalId, mp.id, tx))) {
        return { ok: false, mensaje: `La receta de «${producto.nombre}» usa «${mp.nombre}», que no está disponible en «${sucursalNombre}»: activala acá o cambiá la receta.` };
      }
      // rendimientoEfectivo (D2, docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md): la fórmula queda TEXTUALMENTE
      // igual, solo cambia de dónde salen los dos operandos — sin ninguna calibración de ESTA sucursal, ef.* es
      // exactamente ing.cantidad/ing.mermaPorcentaje (Object.is), así que el cálculo de siempre no se mueve un bit.
      const ef = rendimientoEfectivo(
        { cantidad: Number(ing.cantidad), mermaPorcentaje: Number(ing.mermaPorcentaje) },
        ing.rendimientosLocales.map((r) => ({ sucursalId: r.sucursalId, cantidad: r.cantidad !== null ? Number(r.cantidad) : null, mermaPorcentaje: r.mermaPorcentaje !== null ? Number(r.mermaPorcentaje) : null })),
        sucursalId
      );
      pedidos.push({
        productoId: ing.insumoProductoId,
        cantidad: cantidad * ef.cantidad * (1 + ef.mermaPorcentaje / 100),
        insumoSustitutoIds: ing.sustitutos.map((s) => s.insumoSustitutoId),
        unidadStockId: mp.unidadStockId,
      });
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
 * Deuda de arrastre de redondeo de cada producto, en ESTA sucursal, al momento de empezar la venta (Task #27, docs/plan-redondeo-
 * consumo-fraccionado-2026-09-26.md) — cargador con Prisma del núcleo puro `arrastre-redondeo.ts`, mismo criterio que
 * `origen-venta-datos.ts` para `origen-venta.ts`. `D = Σcantidad − ΣcantidadExacta` (ver el docstring de
 * `MovimientoStock.cantidadExacta`, schema.prisma), sumando solo las filas CONSUMO con `cantidadExacta` no nulo — las nulas aportan 0
 * por definición, ya que ahí `cantidad` YA era exacta. Filtra por `seccion.sucursalId` (una relación, no `seccionId: { in: [...] }`):
 * ya lo hacen `consignacion.ts:104` y `resumen-operativo.ts` con el mismo `groupBy`, así que el filtro por relación es un patrón
 * probado en esta versión de Prisma. SIEMPRE con `tx` (nunca `prisma` global): dos ventas concurrentes de la misma MP tienen que leer
 * esto dentro de la MISMA transacción SERIALIZABLE que arbitra el conflicto (ver el docstring del módulo, con-reintento.ts).
 */
async function cargarDeudaDeRedondeo(tx: Prisma.TransactionClient, sucursalId: string, productoIds: readonly string[]): Promise<Map<string, number>> {
  if (!productoIds.length) return new Map();
  const grupos = await tx.movimientoStock.groupBy({
    by: ["productoId"],
    where: { productoId: { in: productoIds as string[] }, cantidadExacta: { not: null }, seccion: { sucursalId } },
    _sum: { cantidad: true, cantidadExacta: true },
  });
  return new Map(grupos.map((g) => [g.productoId, Number(g._sum.cantidad ?? 0) - Number(g._sum.cantidadExacta ?? 0)]));
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
  const { libro, respaldos, seccionPorDefectoId } = origenDatos;
  // Sin ninguna sección de respaldo (todas excluidas con `sirveDeRespaldoEnVentas`), un PV sin habitual no tiene de dónde salir: se
  // rechaza ANTES de escribir nada, con la salida concreta (distinto de «sin secciones activas»: la solución es otra).
  if (!respaldos.length) {
    const sinHabitual = lineas.find((l) => !origenDatos.habitualDe(l.productoId));
    if (sinHabitual) {
      return fallo(
        `Ninguna sección de «${actor.sucursalNombre}» sirve de respaldo automático en ventas y «${sinHabitual.nombre}» no tiene sección habitual: ` +
          "configurá su sección habitual (Stock → Sección habitual) o marcá una sección como respaldo (Movimientos → Secciones)."
      );
    }
  }

  // PVs que se producen: stock PROPIO, sin sustitutos ni receta — se resuelven en su propio sub-paso, en el orden de las líneas
  // (no interactúan con el consumo de receta de las demás: un PV que se produce nunca es MP de ninguna receta, así que el orden
  // relativo entre este sub-paso y el de abajo no cambia ningún resultado).
  const propiaPorLinea = new Map<number, ParteAsignada>();
  lineas.forEach((linea, i) => {
    if (!linea.seProduce) return;
    const habitual = origenDatos.habitualDe(linea.productoId);
    // El PV vendido también puede tener lotes propios si está marcado "Se produce" — siempre el que vence antes (FEFO), nunca a
    // elección manual; el dato ya está en el Kardex desde que se produjo, no hace falta pedírselo a quien vende.
    propiaPorLinea.set(
      i,
      elegirSeccionDeStockPropio(libro, {
        productoId: linea.productoId,
        cantidad: linea.cantidadVendida,
        seccionHabitual: habitual,
        respaldos,
        seccionSiNingunaAlcanzaId: habitual?.id ?? origenDatos.referenciaDe(linea.productoId) ?? seccionPorDefectoId,
      })
    );
  });

  // Pedidos de receta de TODAS las líneas que consumen (no seProduce), en el orden de línea e ingrediente — UN solo
  // asignarConsumosDeVenta para la venta ENTERA (D5): una sustitución nunca le saca stock a un consumo principal de OTRA línea,
  // porque su pasada 2 corre después de que la 1 terminó para todas. Sin sustitutos, misma secuencia que antes (demostración (a),
  // docs/plan-sustitucion-insumos-receta-2026-09-26.md §4).
  const pedidosPlanos: PedidoDeConsumo[] = [];
  const rangoPorLinea = new Map<number, { desde: number; hasta: number }>();
  lineas.forEach((linea, i) => {
    if (linea.seProduce) return;
    const habitual = origenDatos.habitualDe(linea.productoId);
    const desde = pedidosPlanos.length;
    for (const p of linea.pedidos) {
      pedidosPlanos.push({
        productoId: p.productoId,
        familia: origenDatos.familiaDe(p.productoId),
        cantidad: p.cantidad,
        seccionHabitual: habitual,
        respaldos,
        seccionParaFaltanteId: habitual?.id ?? origenDatos.referenciaDe(p.productoId) ?? origenDatos.referenciaDe(linea.productoId) ?? seccionPorDefectoId,
        sustitutos: p.insumoSustitutoIds.length ? p.insumoSustitutoIds.map((insumoId) => origenDatos.familiaSustitutaDe(insumoId, p.unidadStockId)) : undefined,
      });
    }
    rangoPorLinea.set(i, { desde, hasta: pedidosPlanos.length });
  });
  const resultadosPlanos = asignarConsumosDeVenta(libro, pedidosPlanos);

  const ventas: VentaCalculada[] = lineas.map((linea, i) => {
    if (linea.seProduce) {
      const propia = propiaPorLinea.get(i)!;
      return { ...linea, seccionId: propia.seccionId, loteVencimiento: propia.loteVencimiento, consumos: [] };
    }
    const habitual = origenDatos.habitualDe(linea.productoId);
    const { desde, hasta } = rangoPorLinea.get(i)!;
    const consumos = resultadosPlanos.slice(desde, hasta).flat();
    const seccionId = habitual?.id ?? consumos[0]?.seccionId ?? origenDatos.referenciaDe(linea.productoId) ?? seccionPorDefectoId;
    return { ...linea, seccionId, loteVencimiento: null, consumos };
  });

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
      const decimales = producto?.unidadStock.decimales ?? 2;
      avisosStockNegativo.push({
        productoId: faltante.productoId,
        nombre: producto?.nombre ?? faltante.productoId,
        seccionId: faltante.seccionId,
        seccionNombre: origenDatos.nombreDeSeccion(faltante.seccionId),
        actual: faltante.actual,
        requerido: redondearACantidadDeUnidad(faltante.requerido, decimales),
        resultante: redondearACantidadDeUnidad(faltante.actual - faltante.requerido, decimales),
      });
      continue;
    }
    const pista = await seccionesConStock(faltante.productoId, actor.sucursalId, tx);
    const detallePista = pista.length ? ` Tiene stock en: ${pista.join(", ")}.` : "";
    return fallo(`Stock insuficiente para "${producto?.nombre ?? faltante.productoId}". Actual: ${faltante.actual}, requerido: ${faltante.requerido}.${detallePista}`);
  }

  // Arrastre de redondeo (Task #27, docs/plan-redondeo-consumo-fraccionado-2026-09-26.md): UNA sola carga para la venta ENTERA (todos
  // los productos que algún consumo va a tocar), después de validar stock (arriba, con la cantidad EXACTA — el arrastre nunca influye
  // en si una venta se acepta o se rechaza) y antes del bucle de escritura, porque el arrastre tiene que vivir durante TODO ese
  // bucle: dos consumos del mismo producto en esta misma venta (ej. napolitana + muzzarella, mismo bollo) también se arrastran entre
  // sí, no solo entre ventas distintas.
  const productosConsumidosIds = Array.from(new Set(ventas.flatMap((v) => v.consumos.map((c) => c.productoId))));
  const arrastreDeRedondeo = crearArrastreDeRedondeo(await cargarDeudaDeRedondeo(tx, actor.sucursalId, productosConsumidosIds));

  const filas: Prisma.MovimientoStockCreateManyInput[] = [];
  const operacionIds: string[] = [];
  for (const venta of ventas) {
    const esPrimera = operacionIds.length === 0;
    const operacion: { id: string } = await tx.operacion.create({
      data: {
        sucursalId: actor.sucursalId,
        proceso: "VENTA",
        fecha: datos.fecha,
        proveedorId: datos.proveedorId ?? null,
        clienteId: datos.clienteId ?? null,
        promoCuentaId: venta.promoCuentaId,
        nroFactura: texto(datos.nroFactura) || null,
        detalleLibre: texto(datos.detalle) || null,
        usuarioId: actor.usuarioId,
        claveIdempotencia: esPrimera && opciones.idempotencia ? opciones.idempotencia.clave : null,
        payloadHash: esPrimera && opciones.idempotencia ? opciones.idempotencia.payloadHash : null,
      },
    });
    operacionIds.push(operacion.id);

    for (const c of venta.consumos) {
      const consumido = await obtenerProducto(c.productoId);
      // Redondeo CON ARRASTRE (Task #27, docs/plan-redondeo-consumo-fraccionado-2026-09-26.md) — reemplaza el redondeo "a secas" de
      // cada parte por separado (`redondearACantidadDeUnidad(c.cantidad, decimales)`, el bug: dos medias pizzas consumían 2 bollos
      // en vez de 1). Con deuda 0 (el caso de siempre para un producto que nunca dejó resto) el resultado es IDÉNTICO al de antes;
      // con deuda, la parte que sobró o faltó de consumos anteriores del MISMO producto en esta sucursal (`cargarDeudaDeRedondeo`,
      // arriba) se suma antes de redondear, así que el TOTAL de la sucursal converge al consumo exacto en vez de que cada parte
      // redondee de forma independiente. `cantidadExacta` (con el mismo signo que `cantidad`) solo se llena cuando difiere de lo
      // escrito — alimenta la deuda de la PRÓXIMA venta (`cargarDeudaDeRedondeo`) y la reversión exacta de esta (`anularVenta`).
      const { cantidad: cantidadRedondeada, cantidadExacta } = arrastreDeRedondeo.consumir(c.productoId, c.cantidad, consumido?.unidadStock.decimales ?? 2);
      // D6 (docs/plan-sustitucion-insumos-receta-2026-09-26.md): solo si esta parte vino de un sustituto — un consumo de un
      // HERMANO del mismo Insumo (el caso de siempre) deja el objeto IDÉNTICO a hoy, sin la columna ni el detalle distinto.
      const detalle = c.sustituyeAProductoId
        ? `Consumo por venta de "${venta.nombre}" — SUSTITUTO de "${(await obtenerProducto(c.sustituyeAProductoId))?.nombre ?? c.sustituyeAProductoId}" (no había stock).`
        : `Consumo por venta de "${venta.nombre}".`;
      filas.push({
        operacionId: operacion.id, productoId: c.productoId, seccionId: c.seccionId, proceso: "CONSUMO",
        cantidad: -cantidadRedondeada, cantidadExacta: cantidadExacta === null ? null : -cantidadExacta, loteVencimiento: c.loteVencimiento,
        detalle, precioTotal: 0, precioPorUnidadStock: 0,
        ...(c.sustituyeAProductoId ? { sustituyeAProductoId: c.sustituyeAProductoId } : {}),
      });

      if (consumido?.esConsignacion) {
        filas.push({
          operacionId: operacion.id, productoId: c.productoId, seccionId: c.seccionId, proceso: "LIQUIDACION_CONSIGNACION",
          cantidad: 0, loteVencimiento: null,
          detalle: `Liquidación consignación por venta de "${venta.nombre}".`,
          precioTotal: importeDeLinea(cantidadRedondeada, Number(consumido.precioConsignacion ?? 0)),
          precioPorUnidadStock: redondearMoneda(Number(consumido.precioConsignacion ?? 0)),
        });
      }
    }

    // El PV vendido en sí: signoStock -1 (Movimientos.js:190-205) — si
    // no tiene stock real (no "Se produce"), este saldo negativo es un
    // artefacto contable de las ventas, mismo criterio que hoy.
    const importeVenta = importeDeLinea(venta.cantidadVendida, venta.precioVenta);
    filas.push({
      operacionId: operacion.id, productoId: venta.productoId, seccionId: venta.seccionId, proceso: "VENTA",
      cantidad: -venta.cantidadVendida, loteVencimiento: venta.loteVencimiento,
      detalle: texto(datos.detalle) || "Venta", precioTotal: importeVenta, precioPorUnidadStock: redondearMoneda(venta.precioVenta),
      costoUnitarioVenta: venta.costoUnitarioAlVender !== null ? redondearMoneda(venta.costoUnitarioAlVender) : null,
      precioListaUnitario: venta.precioListaVenta !== null ? redondearMoneda(venta.precioListaVenta) : null,
    });
  }

  await tx.movimientoStock.createMany({ data: filas });
  const mensaje = `Se registraron ${ventas.length} venta(s) correctamente.`;

  if (opciones.idempotencia) {
    await tx.operacion.update({ where: { id: operacionIds[0] }, data: { resultadoMensaje: mensaje } });
  }

  return { ok: true, mensaje, operacionIds, avisosStockNegativo };
}
