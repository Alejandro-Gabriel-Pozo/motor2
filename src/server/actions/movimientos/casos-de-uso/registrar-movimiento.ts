import "server-only";
import { texto } from "@/core/texto";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { guardNroFacturaCompra } from "@/core/features/compras/compra.guard";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { TRANSICIONES, armarFilasDeMovimiento, redondearACantidadDeUnidad } from "@/core/movimientos/public";
import { conTransaccionSerializable, calcularPayloadHash, MENSAJE_CONFLICTO_IDEMPOTENCIA, esChoqueDeFacturaUnica, MENSAJE_FACTURA_DUPLICADA } from "@/core/movimientos/public-servidor";
import { obtenerSeccionPropia, seccionesConStock, validarStockSuficiente } from "@/server/lecturas/movimientos/saldos";
import { crearCacheProducto } from "@/server/persistencia/movimientos/producto-cache";
import { chequearIdempotencia, registrarResultadoIdempotente } from "@/server/persistencia/movimientos/idempotencia";
import { exito, fracaso } from "@/core/resultado-caso";
import type { DatosMovimientoInput, ResultadoRegistrarMovimiento } from "@/core/features/movimientos/movimiento.schema";
import { cargarDestinoConsumo, cargarMotivoMerma, cargarProveedor, existeCompraVigenteConFactura } from "@/server/persistencia/movimientos/cargar-validaciones-de-movimiento";
import { escribirOperacionDeStock, escribirLineasDeMovimientoStock } from "@/server/persistencia/movimientos/escribir-movimiento-de-stock";
import { upsertProveedorPorProducto } from "@/server/persistencia/catalogo/upsert-proveedor-por-producto";
import { armarLineaMovimiento, type LineaCalculada } from "./armar-linea-de-movimiento";

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
 *  2. motivo/destino (catálogos GLOBALES, solo activos) y proveedor (de la empresa, solo activo) — cliente global `prisma`, fuera de la transacción;
 *  3. `guardNroFacturaCompra` — DESPUÉS de sección/motivo/destino a propósito (mismo orden que antes: cambiarlo cambiaría qué mensaje
 *     sale primero cuando hay más de un dato inválido a la vez);
 *  4. camino rápido de factura duplicada (`existeCompraVigenteConFactura`, cliente global) — el árbitro real es el índice único
 *     parcial, ver el catch de más abajo;
 *  5. `conTransaccionSerializable`, con `.catch(esChoqueDeFacturaUnica)` tal cual: I3, armado de cada línea
 *     (`armarLineaMovimiento`), validación de stock agregada, escritura de `Operacion` + `MovimientoStock[]` y, en una Compra, un
 *     `upsertProveedorPorProducto` por línea con unidad de compra conocida — TODO dentro de la misma transacción (decisión del dueño, 2026-10-06:
 *     si falla el vínculo falla la compra entera y se reintenta con la misma clave I3, así nunca queda una compra a medias).
 *
 * M13b ya extrajo a `server/persistencia/movimientos/escribir-movimiento-de-stock.ts` las dos escrituras Prisma de la Operacion y sus
 * líneas (el armado de las filas, que SÍ es lógica de negocio, se queda acá). M13c entró `movimientos.ts` en `ACCIONES_CON_CASO_DE_USO`
 * (su guard, `core/features/movimientos/movimiento.guard.ts`, valida además que `proceso` sea uno de los 9 `ProcesoGenerico` — segunda
 * barrera DENTRO de `conPermiso`, ver su docstring).
 *
 * @contract Registra un movimiento de Kardex para cualquiera de los 9 procesos genéricos, con validación de stock agregada por producto+sección ANTES de escribir nada.
 * @idempotency I3 (claveIdempotencia + payloadHash), dentro de la misma transacción.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento), con `.catch(esChoqueDeFacturaUnica)` para la factura duplicada.
 * @sideEffects upsertProveedorPorProducto (Compra, DENTRO de la transacción) — un vínculo proveedor↔producto por línea con unidad de compra (la de compra o, si no tiene, la de stock); si falla, falla la compra. registrarCambioAuditado del precio del vínculo cuando cambia.
 * @ficha permiso=POR_PROCESO transaccion=SERIALIZABLE idempotencia=I3 auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
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
  // Tanda 6: la base rechaza un motivo fuera de una Merma y un destino fuera de un Consumo (CHECK en Operacion); el cliente solo manda
  // lo que corresponde, pero un pedido armado a mano que traiga el otro se ignora acá en vez de terminar en un error crudo de la base.
  const motivoId = datos.proceso === "MERMA" ? datos.motivoId : undefined;
  const destinoId = datos.proceso === "CONSUMO" ? datos.destinoId : undefined;
  if (motivoId) {
    const motivo = await cargarMotivoMerma(actor.db, motivoId);
    if (!motivo?.activo) return fracaso("MOTIVO_NO_DISPONIBLE", "El motivo elegido ya no está disponible.");
  }
  if (destinoId) {
    const destino = await cargarDestinoConsumo(actor.db, destinoId);
    if (!destino?.activo) return fracaso("DESTINO_NO_DISPONIBLE", "El destino elegido ya no está disponible.");
  }
  // Mismo criterio que motivo/destino: un id que no existe, es de otra empresa o está desactivado no puede quedar guardado en la operación (antes, un id inexistente reventaba con un error de clave foránea).
  if (datos.proveedorId) {
    const proveedor = await cargarProveedor(actor.db, datos.proveedorId);
    if (!proveedor?.activo) return fracaso("PROVEEDOR_NO_DISPONIBLE", "El proveedor elegido ya no está disponible.");
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
    const yaExiste = await existeCompraVigenteConFactura(actor.db, { sucursalId: actor.sucursalId, proveedorId: datos.proveedorId, nroFactura });
    if (yaExiste) return fracaso("FACTURA_DUPLICADA", MENSAJE_FACTURA_DUPLICADA);
  }

  const resultado = await conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoRegistrarMovimiento> => {
    // 0) I3 — idempotencia: chequeo antes de cualquier lógica de negocio.
    const payloadHash = datos.claveIdempotencia
      ? calcularPayloadHash(datos.proceso, actor.sucursalId, { ...datos, claveIdempotencia: undefined })
      : "";
    const chequeo = await chequearIdempotencia(tx, datos.claveIdempotencia, payloadHash);
    if (chequeo.estado === "duplicado") return exito(chequeo.mensaje, { operacionId: null, movimientos: null, repetida: true });
    if (chequeo.estado === "conflicto") return fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);

    const obtenerProducto = crearCacheProducto(tx);
    // 1) Armar cada línea (validación de producto/proceso, conversión, receta).
    const lineas: LineaCalculada[] = [];
    for (const item of datos.items) {
      const armado = await armarLineaMovimiento(item, datos, tx, obtenerProducto, actor.sucursalId, actor.sucursalNombre);
      if (!armado.ok) return fracaso("LINEA_INVALIDA", armado.mensaje);
      if (armado.linea) lineas.push(armado.linea);
    }
    if (!lineas.length) return fracaso("SIN_LINEAS_VALIDAS", "Ninguna línea tiene una cantidad válida.");

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
        return fracaso(
          "STOCK_INSUFICIENTE",
          `Stock insuficiente para "${producto?.nombre ?? productoId}". Actual: ${chequeoStock.actual}, requerido: ${chequeoStock.requerido}.${detallePista}`
        );
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
      motivoId: motivoId ?? null,
      destinoId: destinoId ?? null,
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

    // El vínculo proveedor↔producto de la Compra (comparativa de precios, ficha del proveedor, precarga del carrito), DENTRO de la misma transacción: si falla, falla
    // TODA la compra (nada queda a medias: ni Kardex sin vínculo ni líneas a medias) y se reintenta con la misma clave I3. Se registra la relación en TODOS los casos con unidad
    // de compra conocida (incluso sin precio, mismo bugfix que Catalogo.js:3635-3644: si se cortara acá por falta de precio, ese proveedor nunca acumularía historial).
    if (datos.proceso === "COMPRA" && datos.proveedorId) {
      for (const l of lineas) {
        if (!l.unidadCompraId) continue;
        const vinculo = await upsertProveedorPorProducto(tx, {
          productoId: l.productoId,
          proveedorId: datos.proveedorId,
          unidadCompraId: l.unidadCompraId,
          precioUnitario: l.precioUnitario,
          precioPorUnidadStock: l.precioPorUnidadStock,
          fechaCompra: datos.fecha,
          referenciaProveedor: l.referenciaProveedor,
        });
        // Auditoría (decisión del dueño, 2026-10-08): el precio del vínculo proveedor↔producto es plata que cambia con cada compra; si cambió (o el par es nuevo), deja su fila. Una compra
        // con fecha atrasada no cambia el precio (el SQL no lo pisa) y por lo tanto no deja fila.
        await registrarCambioAuditado(tx, {
          entidad: "ProveedorPorProducto",
          entidadId: `${l.productoId}:${datos.proveedorId}:${l.unidadCompraId}`,
          campo: "precioPorUnidadStock",
          descripcion: `Precio de "${vinculo.productoNombre}" con el proveedor "${vinculo.proveedorNombre}" (compra)`,
          valorAnterior: vinculo.precioAnterior,
          valorNuevo: vinculo.precioNuevo,
          actorId: actor.usuarioId,
          sucursalId: actor.sucursalId,
        });
      }
    }

    const avisoConversion = lineas.some((l) => l.huboConversion)
      ? " Algunas cantidades se convirtieron automáticamente de unidad de compra a unidad de stock."
      : "";
    const mensaje = `Se guardaron ${filas.length} movimiento(s).${avisoConversion}`;

    // I3 — Opción B (docs/auditoria-motor2-plan-i3-idempotencia-2026-09-17.md
    // §4.5): se persiste el mensaje ya formateado, no se reconstruye.
    if (datos.claveIdempotencia) {
      await registrarResultadoIdempotente(tx, operacion.id, mensaje);
    }

    return exito(mensaje, { operacionId: operacion.id, movimientos: filas.length, repetida: false });
  }).catch((e) => {
    // La transacción ya hizo rollback para cuando este catch la recibe — nunca se intenta seguir operando
    // sobre ella. Choque de la carrera de factura duplicada (dos requests simultáneos, ver el comentario del
    // chequeo previo más arriba): mismo mensaje de negocio, no un error 500. Cualquier otro P2002 (ej. la
    // clave de idempotencia en carrera) NO lo reconoce esChoqueDeFacturaUnica — sigue de largo como error real.
    if (esChoqueDeFacturaUnica(e)) return fracaso("FACTURA_DUPLICADA", MENSAJE_FACTURA_DUPLICADA);
    throw e;
  });

  return resultado;
}
