import "server-only";
import type { Prisma } from "@prisma/client";
import { texto } from "@/core/texto";
import { guardComprobanteDeCompra, guardNroFacturaCompra } from "@/core/features/compras/compra.guard";
import { mensajeSeccionDesactivada } from "@/core/features/movimientos/secciones.guard";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { TRANSICIONES, armarFilasDeMovimiento, redondearACantidadDeUnidad } from "@/core/movimientos/public";
import { calcularPayloadHash, MENSAJE_CONFLICTO_IDEMPOTENCIA, esChoqueDeClaveIdempotenciaDeOperacion } from "@/core/movimientos/public-servidor";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { obtenerSeccionPropia, seccionesConStock, validarStockSuficiente } from "@/server/lecturas/movimientos/saldos";
import { crearCacheProducto } from "@/server/persistencia/movimientos/producto-cache";
import { cargarOperacionPorClaveIdempotencia, chequearIdempotencia, registrarResultadoIdempotente } from "@/server/persistencia/movimientos/idempotencia";
import { exito, fracaso } from "@/core/resultado-caso";
import type { DatosMovimientoInput, ProcesoGenerico, ResultadoRegistrarMovimiento } from "@/core/features/movimientos/movimiento.schema";
import { cargarDestinoConsumo, cargarMotivoMerma, cargarProveedor } from "@/server/persistencia/movimientos/cargar-validaciones-de-movimiento";
import { escribirOperacionDeStock, escribirLineasDeMovimientoStock } from "@/server/persistencia/movimientos/escribir-movimiento-de-stock";
import { armarLineaMovimiento, type LineaCalculada } from "./armar-linea-de-movimiento";
import { registrarFacturaProveedorCasoDeUso } from "./registrar-factura-proveedor";

/** Los únicos procesos que admiten una sección dada de baja como ORIGEN (P17): los que solo sacan mercadería. Como destino (Transferencia) nunca se admite. */
const PROCESOS_QUE_SACAN_DE_UNA_SECCION_DADA_DE_BAJA: ReadonlySet<ProcesoGenerico> = new Set<ProcesoGenerico>(["CONSUMO", "MERMA", "TRANSFERENCIA"]);

/**
 * Caso de uso «registrar un movimiento» — el motor genérico de los procesos que lo comparten (Producción, Consumo, Ajuste, Transferencia, Merma, Devolución×3; Task #41, Fase M, M13a-c —
 * docs/arquitectura-casos-de-uso-2026-09-27.md). Es la orquestación que antes vivía en línea en la Server Action `registrarMovimiento` (src/server/actions/movimientos/movimientos.ts); la Server Action
 * quedó como adaptador fino (permiso → guard de comando → este caso de uso → `aResultadoAccion`). Port de confirmarRegistrarMovimientos (Movimientos.js:876-1136).
 *
 * LA COMPRA YA NO SE ESCRIBE ACÁ (U0 de «una sola compra», docs/diseno-una-sola-compra-2026-11-06.md): `registrarMovimiento` con proceso COMPRA es un adaptador que arma una factura de UNA parte al 100 % en esta
 * sucursal, pagada ahora, y la manda al caso de uso de la factura (`registrarFacturaProveedorCasoDeUso`), que es el único escritor de una `Operacion` COMPRA al cargar. Se mantiene por compatibilidad (los seeds de
 * demostración y los tests cargan stock con él) y devuelve la `operacionId` de la parte.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (eso ya lo hizo `conPermiso`) ni el formato del comando (`guardComandoRegistrarMovimiento`,
 * core/features/movimientos/movimiento.guard.ts: proceso genérico, items vacío, sección en blanco, formato de la clave I3, Transferencia con destino vacío/igual al origen): recibe `datos` ya pasado por esas.
 *
 * Orden, igual que antes (para los procesos que siguen acá):
 *  1. sección propia (origen y, si Transferencia, destino) — Fase 6 (auditoría de seguridad/contratos): `conPermiso` ya validó el permiso en LA SUCURSAL DEL QUE LLAMA, nunca que la sección que mandó el cliente sea
 *     realmente de esa sucursal;
 *  2. motivo/destino (catálogos GLOBALES, solo activos) y proveedor (de la empresa, solo activo) — cliente global `prisma`, fuera de la transacción (camino rápido; la Merma sin motivo se rechaza acá) — U11: se vuelven
 *     a comprobar DENTRO de la transacción, después de la idempotencia;
 *  3. el N.º de factura de la Devolución a proveedor (texto libre, `guardNroFacturaCompra`) — DESPUÉS de sección/motivo/destino a propósito (mismo orden que antes: cambiarlo cambiaría qué mensaje sale primero cuando
 *     hay más de un dato inválido a la vez);
 *  4. `conTransaccionSerializable`: I3, P17 (una sección dada de baja solo admite sacar: Consumo, Merma y Transferencia como origen; como destino no; código `SECCION_INACTIVA`; DESPUÉS de I3 a propósito), armado de cada
 *     línea (`armarLineaMovimiento`), validación de stock agregada y escritura de `Operacion` + `MovimientoStock[]`, TODO dentro de la misma transacción.
 *
 * M13b ya extrajo a `server/persistencia/movimientos/escribir-movimiento-de-stock.ts` las dos escrituras Prisma de la Operacion y sus líneas (el armado de las filas, que SÍ es lógica de negocio, se queda acá). M13c
 * entró `movimientos.ts` en `ACCIONES_CON_CASO_DE_USO` (su guard valida además que `proceso` sea uno de los `ProcesoGenerico`).
 *
 * @contract Registra un movimiento de Kardex para cualquiera de los procesos genéricos, con validación de stock agregada por producto+sección ANTES de escribir nada; una COMPRA se delega en la factura de una parte.
 * @idempotency I3 (claveIdempotencia + payloadHash), dentro de la misma transacción.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects la COMPRA delega en `registrarFacturaProveedorCasoDeUso`, que registra el vínculo proveedor↔producto (comando de Catálogo) y la auditoría; los demás procesos, ninguno propio.
 * @ficha permiso=POR_PROCESO transaccion=SERIALIZABLE idempotencia=I3 auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function registrarMovimientoCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "sucursalNombre" | "db" | "transaccion" | "empresaId" | "alcance" | "ahora">,
  datos: DatosMovimientoInput
): Promise<ResultadoRegistrarMovimiento> {
  // Una COMPRA ya no se escribe acá (U0 de «una sola compra»): es una factura de UNA parte al 100 % en esta sucursal, pagada ahora, y la escribe el caso de uso de la factura. Esta función queda como adaptador de ese pedido.
  if (datos.proceso === "COMPRA") return registrarCompraComoFactura(actor, datos);

  // Fase 6 (auditoría de seguridad/contratos): conPermiso ya validó el
  // permiso en LA SUCURSAL DEL QUE LLAMA, nunca que la sección que mandó
  // el cliente sea realmente de esa sucursal — sin esto, cualquier
  // seccionId ajeno (de otra sucursal) se aceptaba igual.
  const seccionOrigen = await obtenerSeccionPropia(datos.seccionId, actor.sucursalId, actor.db);
  if (!seccionOrigen) return fracaso("SECCION_NO_ENCONTRADA", "No se encontró la sección.");
  const seccionDestino = datos.proceso === "TRANSFERENCIA" ? await obtenerSeccionPropia(datos.seccionDestinoId!, actor.sucursalId, actor.db) : null;
  if (datos.proceso === "TRANSFERENCIA" && !seccionDestino) return fracaso("SECCION_DESTINO_NO_ENCONTRADA", "No se encontró la sección destino.");

  // Motivo/Destino: catálogos GLOBALES (no por sucursal, a diferencia de Sección) — solo hace falta que la fila
  // exista y siga activa (un motivo desactivado no puede ELEGIRSE de nuevo, pero las Operacion viejas que ya lo
  // usaban lo conservan, mismo criterio "nunca DELETE" que el resto de los catálogos).
  // Tanda 6: la base rechaza un motivo fuera de una Merma y un destino fuera de un Consumo (CHECK en Operacion); el cliente solo manda
  // lo que corresponde, pero un pedido armado a mano que traiga el otro se ignora acá en vez de terminar en un error crudo de la base.
  const motivoId = datos.proceso === "MERMA" ? datos.motivoId : undefined;
  const destinoId = datos.proceso === "CONSUMO" ? datos.destinoId : undefined;
  // U11: la pantalla de Merma pide el motivo (`required`); el servidor lo exige también (una llamada directa ya no registra una merma sin motivo). Es el único dato que la pantalla
  // exige hoy: el proveedor («Sin proveedor») y el destino («Sin destino específico») son opcionales en la UI y por eso acá también.
  if (datos.proceso === "MERMA" && !texto(motivoId)) {
    return fracaso("MOTIVO_NO_DISPONIBLE", "La merma necesita un motivo: elegí uno de la lista (si no está el que buscás, pedí que lo carguen en Motivos de merma).");
  }
  const noDisponible = await maestroNoDisponible(actor.db, motivoId, destinoId, datos.proveedorId);
  if (noDisponible) return noDisponible;

  // El N.º de factura solo se carga en la Devolución a proveedor (el otro proceso con proveedor; la Compra ya no pasa por acá): mismo validador que la corrección, texto libre.
  const factura = guardNroFacturaCompra(datos.nroFactura);
  if (!factura.ok) return fracaso("FACTURA_INVALIDA", factura.mensaje);
  const nroFactura = factura.valor;

  // La huella del pedido (I3), fuera de la transacción: no depende de nada que se lea adentro, y la usa también el `.catch` de abajo.
  const payloadHash = calcularPayloadHash(datos.proceso, actor.sucursalId, { ...datos, claveIdempotencia: undefined });

  const resultado = await conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoRegistrarMovimiento> => {
    // 0) I3 — idempotencia: chequeo antes de cualquier lógica de negocio. La clave es obligatoria desde E1 (el guard la exige): no hay camino «sin clave».
    const chequeo = await chequearIdempotencia(tx, datos.claveIdempotencia, payloadHash);
    if (chequeo.estado === "duplicado") return exito(chequeo.mensaje, { operacionId: null, movimientos: null, repetida: true });
    if (chequeo.estado === "conflicto") return fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);

    // U11: la lectura de antes de abrir la transacción pudo quedar vieja (un motivo, destino o proveedor desactivado en el medio): se vuelve a comprobar acá, con el estado que ve la transacción.
    const yaNoDisponible = await maestroNoDisponible(tx, motivoId, destinoId, datos.proveedorId);
    if (yaNoDisponible) return yaNoDisponible;

    // P17 (decisión del dueño, 2026-10-11): una sección dada de baja solo admite SACAR mercadería (consumir, mermar o transferir) hasta vaciarla; no recibe mercadería nueva. Va DESPUÉS de I3:
    // un reintento de algo ya escrito tiene que devolver «repetida», nunca un rechazo que invite a cargarlo de nuevo en otra sección (duplicaría el stock). La sección se leyó arriba, sin
    // protección contra una baja en el medio: la baja no tiene precondiciones, así que cualquier intercalado equivale a «el movimiento primero y la baja después».
    if (!seccionOrigen.activa && !PROCESOS_QUE_SACAN_DE_UNA_SECCION_DADA_DE_BAJA.has(datos.proceso)) return fracaso("SECCION_INACTIVA", mensajeSeccionDesactivada(seccionOrigen.nombre));
    if (seccionDestino && !seccionDestino.activa) return fracaso("SECCION_INACTIVA", mensajeSeccionDesactivada(seccionDestino.nombre));

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
      const chequeoStock = await validarStockSuficiente(productoId, seccionId, cantidad, actor.sucursalId, tx);
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
      claveIdempotencia: datos.claveIdempotencia,
      payloadHash,
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
    await registrarResultadoIdempotente(tx, operacion.id, mensaje);

    return exito(mensaje, { operacionId: operacion.id, movimientos: filas.length, repetida: false });
  }, undefined, undefined, true).catch(async (e): Promise<ResultadoRegistrarMovimiento> => {
    // La transacción ya hizo rollback para cuando este catch la recibe — nunca se intenta seguir operando sobre ella.
    // E1: la carrera con la MISMA clave ya la resuelven los reintentos (`tambienChoqueDeUnico`: al repetir, el chequeo ve al ganador). Si igual llega acá un choque de
    // la clave es porque la tiene una operación que este pedido NO ve (otra empresa u otra sucursal: la clave es única global). Molde del pedido del salón
    // (agregar-items.ts): se relee FUERA de la transacción; con la misma huella es un reenvío, si no — o si no se ve — es un conflicto, nunca el contenido de otro
    // ni un error crudo. Cualquier otro choque (otro índice) sigue de largo como error real (falla cerrado).
    if (esChoqueDeClaveIdempotenciaDeOperacion(e)) {
      const ganador = await cargarOperacionPorClaveIdempotencia(actor.db, datos.claveIdempotencia);
      if (ganador && ganador.payloadHash === payloadHash && ganador.resultadoMensaje !== null) return exito(ganador.resultadoMensaje, { operacionId: null, movimientos: null, repetida: true });
      return fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);
    }
    throw e;
  });

  return resultado;
}

/**
 * Motivo, destino y proveedor elegidos: tienen que existir (el proveedor, además, ser de la empresa) y seguir activos; un id que no cumple no puede quedar guardado en la operación (antes, un id
 * inexistente reventaba con un error de clave foránea). Se llama dos veces con los mismos textos: antes de abrir la transacción (camino rápido) y dentro de ella (U11, el estado que vale).
 * `null` si todo está bien o si no se eligió ninguno.
 */
async function maestroNoDisponible(
  db: Prisma.TransactionClient,
  motivoId: string | undefined,
  destinoId: string | undefined,
  proveedorId: string | undefined
): Promise<ResultadoRegistrarMovimiento | null> {
  if (motivoId) {
    const motivo = await cargarMotivoMerma(db, motivoId);
    if (!motivo?.activo) return fracaso("MOTIVO_NO_DISPONIBLE", "El motivo elegido ya no está disponible.");
  }
  if (destinoId) {
    const destino = await cargarDestinoConsumo(db, destinoId);
    if (!destino?.activo) return fracaso("DESTINO_NO_DISPONIBLE", "El destino elegido ya no está disponible.");
  }
  if (proveedorId) {
    const proveedor = await cargarProveedor(db, proveedorId);
    if (!proveedor?.activo) return fracaso("PROVEEDOR_NO_DISPONIBLE", "El proveedor elegido ya no está disponible.");
  }
  return null;
}

/**
 * Una COMPRA de `registrarMovimiento` = una factura de UNA parte al 100 % en esta sucursal, pagada ahora (`CONTADO_PAGADA`). El proveedor y el número (letra, punto de venta y número) son obligatorios (etapa 1 de Compras,
 * I1/I2/I5); lo que se guarda es el texto canónico «A-00023-00237728». Todo lo demás (idempotencia, número repetido en la empresa, sección, referencia del proveedor, vínculo, aviso C25 y la escritura) lo hace el caso de uso
 * de la factura. Los códigos de fallo se traducen a los de `registrarMovimiento` (los que una factura de una parte nunca produce — el reparto, las otras sucursales — no pueden darse).
 */
async function registrarCompraComoFactura(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "sucursalNombre" | "db" | "transaccion" | "empresaId" | "alcance" | "ahora">,
  datos: DatosMovimientoInput
): Promise<ResultadoRegistrarMovimiento> {
  if (!datos.proveedorId) return fracaso("PROVEEDOR_OBLIGATORIO", "Elegí el proveedor de la factura.");
  const numero = guardComprobanteDeCompra(datos.nroFactura);
  if (!numero.ok) return fracaso("FACTURA_INVALIDA", numero.mensaje);

  const r = await registrarFacturaProveedorCasoDeUso(actor, {
    fecha: datos.fecha,
    proveedorId: datos.proveedorId,
    nroFactura: numero.valor ?? undefined,
    seccionId: datos.seccionId,
    detalleLibre: datos.detalleLibre,
    items: datos.items,
    reparto: { modo: "PORCENTAJE", partes: [{ sucursalId: actor.sucursalId, valor: 100 }] },
    condicionPago: "CONTADO_PAGADA",
    claveIdempotencia: datos.claveIdempotencia,
  });
  if (!r.ok) {
    if (r.codigo === "REPARTO_INVALIDO" || r.codigo === "SUCURSAL_NO_DISPONIBLE" || r.codigo === "PRODUCTO_NO_DISPONIBLE") {
      throw new Error(`registrarMovimiento COMPRA: la factura de una parte devolvió ${r.codigo}, que una sola parte propia no puede producir.`);
    }
    return fracaso(r.codigo, r.mensaje);
  }
  if (r.datos.repetida) return exito(r.mensaje, { operacionId: null, movimientos: null, repetida: true });
  if (!r.datos.operacionPropiaId) throw new Error("registrarMovimiento COMPRA: la parte propia de la factura no devolvió su compra.");
  return exito(r.mensaje, { operacionId: r.datos.operacionPropiaId, movimientos: r.datos.movimientosPropios, repetida: false });
}
