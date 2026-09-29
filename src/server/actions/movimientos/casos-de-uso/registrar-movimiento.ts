import "server-only";
import { prisma } from "@/lib/db";
import { texto } from "@/core/texto";
import { guardNroFacturaCompra } from "@/core/features/compras/compra.guard";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { TRANSICIONES, redondearACantidadDeUnidad } from "@/core/movimientos/public";
import { armarFilasDeMovimiento } from "@/core/movimientos/armar-filas-de-movimiento";
import {
  obtenerSeccionPropia,
  seccionesConStock,
  validarStockSuficiente,
  conTransaccionSerializable,
  calcularPayloadHash,
  chequearIdempotencia,
  MENSAJE_CONFLICTO_IDEMPOTENCIA,
  crearCacheProducto,
  esChoqueDeFacturaUnica,
  MENSAJE_FACTURA_DUPLICADA,
  registrarResultadoIdempotente,
} from "@/core/movimientos/public-servidor";
import { exito, fracaso } from "@/core/resultado-caso";
import type { DatosMovimientoInput, ResultadoRegistrarMovimiento } from "@/core/features/movimientos/movimiento.schema";
import { cargarDestinoConsumo, cargarMotivoMerma, existeCompraVigenteConFactura } from "@/server/persistencia/movimientos/cargar-validaciones-de-movimiento";
import { escribirOperacionDeStock, escribirLineasDeMovimientoStock } from "@/server/persistencia/movimientos/escribir-movimiento-de-stock";
import { upsertProveedorPorProducto } from "../../catalogo/upsert-proveedor-por-producto";
import { armarLineaMovimiento, type LineaCalculada } from "./armar-linea-de-movimiento";

/** Lo que necesita `registrarProveedoresDeLaCompra` (paso 6, más abajo) de cada línea ya armada. */
interface LineaParaProveedor {
  productoId: string;
  unidadCompraId: string | null;
  precioUnitario: number;
  precioPorUnidadStock: number;
  referenciaProveedor: string | undefined;
}

/** Lo que devuelve el callback de `conTransaccionSerializable` — el resultado del caso de uso junto con el dato lateral que necesita
 * el paso 6 (Compra), fuera de la transacción. */
interface ResultadoConLineasParaProveedor {
  resultado: ResultadoRegistrarMovimiento;
  lineasParaProveedor: LineaParaProveedor[];
}

/**
 * Envuelve un `ResultadoRegistrarMovimiento` sin `lineasParaProveedor` — todo camino que NO sea el éxito final del paso 3 (backlog
 * post-cierre de Task #41, 2026-09-28, docs/pendientes-sesion-2026-09-27.md §12): antes `lineasParaProveedor` era una variable
 * mutable del cierre, reasignada solo en el camino de éxito y leída DESPUÉS de que `conTransaccionSerializable` resolviera — segura
 * hoy (cada reintento vuelve a ejecutar el callback completo desde cero, y el uso de `lineasParaProveedor` siempre está condicionado a
 * que `resultado` sea el de ESE MISMO intento exitoso), pero dependía de ese razonamiento en vez de que cada camino de retorno
 * llevara su propio dato completo. Con esta forma, cada `return` es autocontenido: no hace falta razonar sobre qué dejó un intento
 * anterior en una variable de afuera.
 */
function sinLineasParaProveedor(resultado: ResultadoRegistrarMovimiento): ResultadoConLineasParaProveedor {
  return { resultado, lineasParaProveedor: [] };
}

/**
 * Paso 6 (Compra) de `registrarMovimientoCasoDeUso`: engancha `upsertProveedorPorProducto` (Catálogo, sin usar todavía) — FUERA de la
 * transacción principal y sin bloquear su resultado si falla, mismo criterio "best effort" que actualizarProveedoresDesdeCompra_
 * (Catalogo.js:3617-3657, envuelta en try/catch en confirmarRegistrarMovimientos): el Kardex ya quedó bien escrito, esto solo
 * alimenta la comparativa de precios. Se registra la relación en TODOS los casos con unidad de compra conocida (incluso sin precio,
 * mismo bugfix que Catalogo.js:3635-3644: si se cortara acá por falta de precio, ese proveedor nunca acumularía historial).
 *
 * Limitación conocida, decisión DEFERIDA — no un bug (backlog post-cierre de Task #41, 2026-09-28,
 * docs/pendientes-sesion-2026-09-27.md §11): si `upsertProveedorPorProducto` falla para una línea, el catch de más abajo lo
 * `console.error`ea y sigue con la línea siguiente — no hay forma de reintentar SOLO ese hookup después. `upsertProveedorPorProducto`
 * no tiene ningún otro punto de entrada en el proyecto (confirmado: es la ÚNICA llamada real, `grep -rn
 * upsertProveedorPorProducto src/`) — ni una pantalla de administración, ni una acción de "reconciliar catálogo de esta compra". Y
 * reintentar la Compra ENTERA no sirve: con la MISMA `claveIdempotencia` el paso 0 (I3) corta antes de llegar acá (`repetida: true`,
 * el guard del §4 de este mismo backlog no vuelve a llamar a este paso), y con una clave distinta (o sin clave) se escribiría una
 * SEGUNDA Compra real en el Kardex — probablemente peor que el precio faltante en Catálogo que se buscaba arreglar. Hoy, la única
 * vía de recuperación es manual (consola de Prisma / SQL directo) contra `ProveedorPorProducto`. Aceptado así por ahora: agregar un
 * mecanismo de reintento dedicado es una decisión de producto (¿vale la pena una acción de administración para esto?, ¿con qué
 * alcance?), no algo para resolver de paso en esta auditoría.
 */
async function registrarProveedoresDeLaCompra(proveedorId: string, fecha: Date, lineas: LineaParaProveedor[]): Promise<void> {
  for (const l of lineas) {
    if (!l.unidadCompraId) continue;
    try {
      await upsertProveedorPorProducto({
        productoId: l.productoId,
        proveedorId,
        unidadCompraId: l.unidadCompraId,
        precioUnitario: l.precioUnitario,
        precioPorUnidadStock: l.precioPorUnidadStock,
        fechaCompra: fecha,
        referenciaProveedor: l.referenciaProveedor,
      });
    } catch (e) {
      // e instanceof Error ? e.message : String(e) (backlog post-cierre de Task #41, 2026-09-28,
      // docs/pendientes-sesion-2026-09-27.md §5): el cast (e as Error).message revienta con TypeError si algo
      // no-Error (ej. null/undefined) se lanza acá adentro — mismo criterio que core/reportes/cotizacion-dolar.ts.
      console.error(`upsertProveedorPorProducto falló para producto ${l.productoId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/**
 * Caso de uso «registrar un movimiento» — el motor genérico de los 9 procesos que lo comparten (Compra, Producción, Consumo, Ajuste,
 * Transferencia, Merma, Devolución×3; Task #41, Fase M, M13a-c — docs/arquitectura-casos-de-uso-2026-09-27.md). Es la orquestación que
 * antes vivía en línea en la Server Action `registrarMovimiento` (src/server/actions/movimientos/movimientos.ts), en el MISMO orden y
 * con los MISMOS textos; la Server Action quedó como adaptador fino (permiso → guard de comando → este caso de uso →
 * `aResultadoAccion`). Port de confirmarRegistrarMovimientos (Movimientos.js:876-1136).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (eso ya lo hizo `conPermiso`) ni el formato del
 * comando (`guardComandoRegistrarMovimiento`, core/features/movimientos/movimiento.guard.ts: proceso genérico, items vacío, sección en
 * blanco, formato de la clave I3, Transferencia con destino vacío/igual al origen): recibe `datos` ya pasado por esas.
 *
 * Orden, igual que antes:
 *  1. sección propia (origen y, si Transferencia, destino) — Fase 6 (auditoría de seguridad/contratos): `conPermiso` ya validó el
 *     permiso en LA SUCURSAL DEL QUE LLAMA, nunca que la sección que mandó el cliente sea realmente de esa sucursal;
 *  2. motivo/destino (catálogos GLOBALES, solo activos) — cliente global `prisma`, fuera de la transacción;
 *  3. `guardNroFacturaCompra` — DESPUÉS de sección/motivo/destino a propósito (mismo orden que antes: cambiarlo cambiaría qué mensaje
 *     sale primero cuando hay más de un dato inválido a la vez);
 *  4. camino rápido de factura duplicada (`existeCompraVigenteConFactura`, cliente global) — el árbitro real es el índice único
 *     parcial, ver el catch de más abajo;
 *  5. `conTransaccionSerializable`, con `.catch(esChoqueDeFacturaUnica)` tal cual: I3, armado de cada línea
 *     (`armarLineaMovimiento`), validación de stock agregada, escritura de `Operacion` + `MovimientoStock[]`;
 *  6. `registrarProveedoresDeLaCompra` (Compra), fuera de la transacción, best-effort: un `upsertProveedorPorProducto` por línea con
 *     unidad de compra conocida.
 *
 * M13b ya extrajo a `server/persistencia/movimientos/escribir-movimiento-de-stock.ts` las dos escrituras Prisma de la Operacion y sus
 * líneas (el armado de las filas, que SÍ es lógica de negocio, se queda acá). M13c entró `movimientos.ts` en `ACCIONES_CON_CASO_DE_USO`
 * (su guard, `core/features/movimientos/movimiento.guard.ts`, valida además que `proceso` sea uno de los 9 `ProcesoGenerico` — segunda
 * barrera DENTRO de `conPermiso`, ver su docstring) y nombró el paso 6 de acá arriba (antes, un bloque sin nombre en línea).
 *
 * @contract Registra un movimiento de Kardex para cualquiera de los 9 procesos genéricos, con validación de stock agregada por producto+sección ANTES de escribir nada.
 * @idempotency I3 (claveIdempotencia + payloadHash), dentro de la misma transacción.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento), con `.catch(esChoqueDeFacturaUnica)` para la factura duplicada.
 * @sideEffects registrarProveedoresDeLaCompra (Compra, best-effort, FUERA de la transacción, solo si no es repetida) — un upsertProveedorPorProducto por línea con unidad de compra conocida.
 */
export async function registrarMovimientoCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "sucursalId" | "sucursalNombre" | "db" | "transaccion">,
  datos: DatosMovimientoInput
): Promise<ResultadoRegistrarMovimiento> {
  // Fase 6 (auditoría de seguridad/contratos): conPermiso ya validó el
  // permiso en LA SUCURSAL DEL QUE LLAMA, nunca que la sección que mandó
  // el cliente sea realmente de esa sucursal — sin esto, cualquier
  // seccionId ajeno (de otra sucursal) se aceptaba igual.
  if (!(await obtenerSeccionPropia(datos.seccionId, actor.sucursalId, actor.db))) return fracaso("SECCION_NO_ENCONTRADA", "No se encontró la sección.");
  if (datos.proceso === "TRANSFERENCIA" && !(await obtenerSeccionPropia(datos.seccionDestinoId!, actor.sucursalId, actor.db))) {
    return fracaso("SECCION_DESTINO_NO_ENCONTRADA", "No se encontró la sección destino.");
  }

  // Motivo/Destino: catálogos GLOBALES (no por sucursal, a diferencia de Sección) — solo hace falta que la fila
  // exista y siga activa (un motivo desactivado no puede ELEGIRSE de nuevo, pero las Operacion viejas que ya lo
  // usaban lo conservan, mismo criterio "nunca DELETE" que el resto de los catálogos).
  if (datos.motivoId) {
    const motivo = await cargarMotivoMerma(prisma, datos.motivoId);
    if (!motivo?.activo) return fracaso("MOTIVO_NO_DISPONIBLE", "El motivo elegido ya no está disponible.");
  }
  if (datos.destinoId) {
    const destino = await cargarDestinoConsumo(prisma, datos.destinoId);
    if (!destino?.activo) return fracaso("DESTINO_NO_DISPONIBLE", "El destino elegido ya no está disponible.");
  }

  // El N.º de factura solo se carga en Compra y Devolución a proveedor (los procesos con proveedor): mismo validador que la corrección.
  const factura = guardNroFacturaCompra(datos.nroFactura);
  if (!factura.ok) return fracaso("FACTURA_INVALIDA", factura.mensaje);
  const nroFactura = factura.valor;

  // Chequeo de factura duplicada (Movimientos.js:402-416): mismo
  // proveedor + mismo número de factura ya cargados como Compra en esta
  // sucursal — una factura sin número no se puede comparar, no bloquea.
  // Camino RÁPIDO para el caso secuencial (el 99,99%): rechaza antes de
  // abrir la transacción, con un mensaje inmediato. Bajo concurrencia
  // real (dos requests simultáneos con la misma factura) este `findFirst`
  // no alcanza — ninguno de los dos ve todavía la Operacion del otro
  // (TOCTOU clásico). El árbitro real es el índice único parcial
  // `Operacion_factura_unica_vigente_key` (docs/auditoria-motor2-plan-i3-
  // idempotencia-2026-09-17.md §9.2): su violación se atrapa más abajo,
  // fuera de la transacción (ya hizo rollback para cuando el `.catch`
  // la recibe).
  if (datos.proceso === "COMPRA" && datos.proveedorId && nroFactura) {
    const yaExiste = await existeCompraVigenteConFactura(prisma, { sucursalId: actor.sucursalId, proveedorId: datos.proveedorId, nroFactura });
    if (yaExiste) return fracaso("FACTURA_DUPLICADA", MENSAJE_FACTURA_DUPLICADA);
  }

  const { resultado, lineasParaProveedor } = await conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoConLineasParaProveedor> => {
    // 0) I3 — idempotencia: chequeo antes de cualquier lógica de negocio.
    const payloadHash = datos.claveIdempotencia
      ? calcularPayloadHash(datos.proceso, actor.sucursalId, { ...datos, claveIdempotencia: undefined })
      : "";
    const chequeo = await chequearIdempotencia(tx, datos.claveIdempotencia, payloadHash);
    if (chequeo.estado === "duplicado") return sinLineasParaProveedor(exito(chequeo.mensaje, { operacionId: null, movimientos: null, repetida: true }));
    if (chequeo.estado === "conflicto") return sinLineasParaProveedor(fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA));

    const obtenerProducto = crearCacheProducto(tx);
    // 1) Armar cada línea (validación de producto/proceso, conversión, receta).
    const lineas: LineaCalculada[] = [];
    for (const item of datos.items) {
      const armado = await armarLineaMovimiento(item, datos, tx, obtenerProducto, actor.sucursalId, actor.sucursalNombre);
      if (!armado.ok) return sinLineasParaProveedor(fracaso("LINEA_INVALIDA", armado.mensaje));
      if (armado.linea) lineas.push(armado.linea);
    }
    if (!lineas.length) return sinLineasParaProveedor(fracaso("SIN_LINEAS_VALIDAS", "Ninguna línea tiene una cantidad válida."));

    // 2) Validación de stock AGREGADA por clave producto+sección dentro
    // de TODO el payload, antes de escribir nada (bugfix C-1,
    // Movimientos.js:910-961): dos líneas pidiendo el mismo
    // producto+sección se suman antes de comparar contra el saldo —
    // nunca se valida cada una aislada.
    const transicion = TRANSICIONES[datos.proceso];
    const requeridoPorClave = new Map<string, { productoId: string; seccionId: string; cantidad: number }>();
    const acumular = (productoId: string, seccionId: string, cantidad: number) => {
      if (!(cantidad > 0)) return;
      const key = `${productoId}||${seccionId}`;
      const previo = requeridoPorClave.get(key);
      requeridoPorClave.set(key, { productoId, seccionId, cantidad: (previo?.cantidad ?? 0) + cantidad });
    };
    for (const l of lineas) {
      if (datos.proceso === "TRANSFERENCIA") acumular(l.productoId, datos.seccionId, l.cantidadIngresada);
      else if (transicion.signoStock < 0) acumular(l.productoId, datos.seccionId, l.cantidadIngresada);
      else if (transicion.signoStock === 0 && l.cantidadFirmada < 0) acumular(l.productoId, datos.seccionId, -l.cantidadFirmada);

      // Canonizado ANTES de validar (hallazgo post-cierre de Task #41, 2026-09-28): `c.cantidad` sale de
      // resolverConsumoPorFamilia/calcularConsumosProduccion sin redondear — `armarFilasDeMovimiento` (paso 3, más
      // abajo) la ajusta a los decimales de la unidad de stock del insumo ANTES de persistir. Antes de este fix, acá
      // se validaba contra la cantidad CRUDA y se persistía la REDONDEADA — dos valores distintos decidiendo y
      // escribiendo. `c.decimalesUnidadStock` ya viene resuelto (armar-linea-de-movimiento.ts): mismo cálculo exacto
      // que el paso 3 sin un segundo round-trip a `obtenerProducto`.
      for (const c of l.consumosReceta) {
        const cantidadRedondeada = redondearACantidadDeUnidad(c.cantidad, c.decimalesUnidadStock);
        acumular(c.productoId, datos.seccionId, cantidadRedondeada);
      }
    }
    for (const { productoId, seccionId, cantidad } of requeridoPorClave.values()) {
      const chequeoStock = await validarStockSuficiente(productoId, seccionId, cantidad, tx);
      if (!chequeoStock.ok) {
        const producto = await obtenerProducto(productoId);
        const pista = await seccionesConStock(productoId, actor.sucursalId, tx);
        const detallePista = pista.length ? ` Tiene stock en: ${pista.join(", ")}.` : "";
        return sinLineasParaProveedor(fracaso(
          "STOCK_INSUFICIENTE",
          `Stock insuficiente para "${producto?.nombre ?? productoId}". Actual: ${chequeoStock.actual}, requerido: ${chequeoStock.requerido}.${detallePista}`
        ));
      }
    }

    // 3) Escribir Operacion (encabezado) + MovimientoStock[] (líneas).
    const operacion = await escribirOperacionDeStock(tx, {
      sucursalId: actor.sucursalId,
      proceso: datos.proceso,
      fecha: datos.fecha,
      proveedorId: datos.proveedorId ?? null,
      nroFactura,
      seccionDestinoId: datos.proceso === "TRANSFERENCIA" ? (datos.seccionDestinoId ?? null) : null,
      motivoId: datos.motivoId ?? null,
      destinoId: datos.destinoId ?? null,
      detalleLibre: texto(datos.detalleLibre) || null,
      usuarioId: actor.usuarioId,
      claveIdempotencia: datos.claveIdempotencia ?? null,
      payloadHash: datos.claveIdempotencia ? payloadHash : null,
    });

    // Armado de filas extraído a una función PURA (backlog post-cierre de Task #41, 2026-09-28,
    // docs/pendientes-sesion-2026-09-27.md §6): core/movimientos/armar-filas-de-movimiento.ts — sin I/O, con
    // property-based tests propias (test/core/armar-filas-de-movimiento.test.ts). `lineas` ya trae todo lo que hace
    // falta resuelto (armar-linea-de-movimiento.ts hizo la única I/O necesaria).
    const filas = armarFilasDeMovimiento(
      {
        operacionId: operacion.id,
        proceso: datos.proceso,
        seccionId: datos.seccionId,
        seccionDestinoId: datos.proceso === "TRANSFERENCIA" ? (datos.seccionDestinoId ?? null) : null,
      },
      lineas
    );

    await escribirLineasDeMovimientoStock(tx, filas);

    const avisoConversion = lineas.some((l) => l.huboConversion)
      ? " Algunas cantidades se convirtieron automáticamente de unidad de compra a unidad de stock."
      : "";
    const mensaje = `Se guardaron ${filas.length} movimiento(s).${avisoConversion}`;

    // I3 — Opción B (docs/auditoria-motor2-plan-i3-idempotencia-2026-09-17.md
    // §4.5): se persiste el mensaje ya formateado, no se reconstruye.
    if (datos.claveIdempotencia) {
      await registrarResultadoIdempotente(tx, operacion.id, mensaje);
    }

    const lineasParaProveedor: LineaParaProveedor[] = lineas.map((l) => ({
      productoId: l.productoId,
      unidadCompraId: l.unidadCompraId,
      precioUnitario: l.precioUnitario,
      precioPorUnidadStock: l.precioPorUnidadStock,
      referenciaProveedor: l.referenciaProveedor,
    }));

    return { resultado: exito(mensaje, { operacionId: operacion.id, movimientos: filas.length, repetida: false }), lineasParaProveedor };
  }).catch((e) => {
    // La transacción ya hizo rollback para cuando este catch la recibe — nunca se intenta seguir operando
    // sobre ella. Choque de la carrera de factura duplicada (dos requests simultáneos, ver el comentario del
    // chequeo previo más arriba): mismo mensaje de negocio, no un error 500. Cualquier otro P2002 (ej. la
    // clave de idempotencia en carrera) NO lo reconoce esChoqueDeFacturaUnica — sigue de largo como error real.
    if (esChoqueDeFacturaUnica(e)) return sinLineasParaProveedor(fracaso("FACTURA_DUPLICADA", MENSAJE_FACTURA_DUPLICADA));
    throw e;
  });

  // Paso 6 (Compra): ver el docstring de `registrarProveedoresDeLaCompra` más arriba. `!resultado.datos.repetida`
  // explícito (backlog post-cierre de Task #41, 2026-09-28, docs/pendientes-sesion-2026-09-27.md §4): en TODO camino
  // que no sea el éxito final del paso 3 (`sinLineasParaProveedor`, incluido el de idempotencia "duplicado"),
  // `lineasParaProveedor` es `[]` por construcción — no un efecto colateral del orden de una variable mutable
  // (§12, mismo backlog). Dejarlo explícito acá documenta la regla real ("un duplicado no vuelve a tocar Catálogo"),
  // no solo la garantía estructural.
  if (resultado.ok && !resultado.datos.repetida && datos.proceso === "COMPRA" && datos.proveedorId) {
    await registrarProveedoresDeLaCompra(datos.proveedorId, datos.fecha, lineasParaProveedor);
  }

  return resultado;
}
