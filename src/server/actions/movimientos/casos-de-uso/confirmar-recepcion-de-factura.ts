import "server-only";
import {
  MENSAJE_RECEPCION_NO_ENCONTRADA,
  MENSAJE_RECEPCION_YA_RECIBIDA,
  decidirConfirmacionDeRecepcion,
  decidirDestinosDeRecepcion,
  validarEntradasDeRecepcion,
  type DestinoDeRenglon,
  type SeccionParaRecibir,
} from "@/core/compras/public";
import type { ComandoConfirmarRecepcionDeFactura, ResultadoConfirmarRecepcionDeFactura } from "@/core/features/compras/factura-proveedor.schema";
import { mensajeSeccionDesactivada } from "@/core/features/movimientos/secciones.guard";
import { exito, fracaso } from "@/core/resultado-caso";
import { ZONA_ARGENTINA, diaDeCalendario, mediodiaDelDia } from "@/core/tiempo/zona-horaria";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { productoDisponibleEn } from "@/server/lecturas/catalogo/disponibilidad";
import { bloquearFactura, bloquearSeccionesDeLaSucursal, cargarCondicionesDeControl, cargarParteDeFacturaEnSucursal, cargarRenglonesParaRecibir } from "@/server/persistencia/compras/cargar-factura-proveedor";
import { confirmarParteRecibida } from "@/server/persistencia/compras/escribir-factura-proveedor";
import { escribirLineasDeMovimientoStock, escribirOperacionDeStock } from "@/server/persistencia/movimientos/escribir-movimiento-de-stock";

/** Por renglón, para la auditoría: el producto, la sección propuesta por el control, la elegida y si se la cambió (o que no había propuesta). */
function textoDeLosDestinos(destinos: readonly DestinoDeRenglon[], renglones: readonly { facturaProveedorRenglonId: string; productoNombre: string }[], secciones: ReadonlyMap<string, { nombre: string }>): string {
  const nombreDe = (id: string | null) => `«${(id && secciones.get(id)?.nombre) || ""}»`;
  const productoDe = new Map(renglones.map((r) => [r.facturaProveedorRenglonId, r.productoNombre]));
  return destinos
    .map((d) => `${productoDe.get(d.renglonId) ?? ""}: propuesta ${d.seccionPropuestaId ? nombreDe(d.seccionPropuestaId) : "ninguna"}, elegida ${nombreDe(d.seccionElegidaId)}, ${d.cambiado ? "cambiado" : "sin cambio"}`)
    .join("; ");
}

/** Lo que tira la transacción cuando otra confirmación ganó en el medio: hace ROLLBACK de todo lo escrito y el `.catch` lo traduce. */
class ParteYaRecibida extends Error {}

/**
 * Caso de uso «confirmar la recepción de una compra pendiente» (Compras N3-a, recepción separada; docs/diseno-compras-paridad-escalera-2026-11-16.md, CU-2): un gerente o administrador de la sucursal confirma que llegó la mercadería de una factura
 * cargada «pendiente de recibir» y elige, para cada renglón, la sección (depósito) donde entra ENTERO (un solo destino por renglón: paridad con Pedernal). La fecha del stock es la de la confirmación (hora argentina; no se elige). Recién acá entran su stock, su costo y su gasto: la compra (`Operacion` COMPRA + una línea del
 * Kardex por entrada, con su renglón) se escribe como la escribe «cargar factura» cuando el módulo está apagado. El control por línea (conforme, con observaciones, rechazada; `registrar-control-de-recepcion.ts`) NO cambia cuánto stock entra: una línea
 * RECHAZADA entra igual (la cantidad no cambia), pero DÓNDE entra sí depende del control (Compras, depósitos de uso RECHAZO y CUARENTENA, etapa (i); decisión del dueño 2026-11-17, «4.-lo recomendado»): cada renglón tiene una sección PROPUESTA según su
 * control (sin control o conforme → la primera sección activa de uso NORMAL por nombre; con observaciones → la primera de CUARENTENA; rechazada → la primera de RECHAZO), quien confirma puede elegir cualquier otra sección activa de la sucursal (el cambio
 * queda en la auditoría) y, si alguna línea es con observaciones o rechazada y la sucursal no tiene una sección ACTIVA de ese uso, la confirmación entera se BLOQUEA y no entra nada (más estricto que Pedernal, por palabras del dueño: «la recepción no se
 * puede confirmar si la sucursal no los tiene»). Excluir lo que está en esas secciones de lo disponible para vender es la etapa (ii), no esta.
 *
 * `import "server-only"` y SIN `"use server"`: no chequea permisos (la Server Action pidió `compra_recibir` en la sucursal activa: del módulo `recepcion_de_compras`, piso administrador) ni el formato (`guardComandoConfirmarRecepcionDeFactura`).
 *
 * En UNA transacción SERIALIZABLE:
 *  1. `SELECT … FOR UPDATE` de la cabecera de la factura (serializa contra la anulación y contra otra confirmación); no existe en la empresa (la RLS esconde las ajenas) → «no se encontró». Después lee TODAS las secciones de la sucursal con `FOR SHARE`
 *     (una desactivación concurrente espera a esta transacción o la hace reintentar viendo la sección apagada: nunca entra stock a una sección que ya se apagó);
 *  2. `decidirConfirmacionDeRecepcion` (regla pura, contrastada con el oráculo): la parte es de esta sucursal, la factura no está anulada; si la parte YA está recibida, ÉXITO con `yaExistia` sin escribir ni auditar nada (paridad con Pedernal: repetir
 *     confirmar no es un error); si sigue pendiente, cada sección es de esta sucursal y está activa; `validarEntradasDeRecepcion`: cada renglón tiene UN solo destino; `decidirDestinosDeRecepcion`: el bloqueo por falta de la sección de rechazo o de cuarentena y el destino propuesto contra el elegido de cada renglón;
 *     cada producto sigue habilitado en esta sucursal;
 *  3. arma UNA línea del Kardex por renglón, con la cantidad, el precio total, el precio por unidad, el lote y el detalle del renglón TAL CUAL, con la fecha de la confirmación (el mediodía argentino del día de `actor.ahora`, como el resto de las
 *     compras: P1, `mediodiaDelDia`), escribe la compra y marca la parte RECIBIDA con su compra, con `WHERE estado = 'PENDIENTE'`:
 *     si no tocó ninguna fila, ganó otra confirmación y se deshace todo (no queda compra huérfana); la segunda barrera es el disparador de la base (una parte recibida no vuelve atrás);
 *  4. audita (`FacturaProveedor`, campo `recepcion`, de PENDIENTE a RECIBIDA: quién (`actorId`), cuándo (el registro) y, en la descripción, las secciones, la fecha de stock y, por renglón, la sección propuesta, la elegida y si se la cambió).
 * Un choque del único de la compra (`Operacion_factura_unica_vigente_key`) es la carrera perdida contra otra confirmación de la misma parte (leo el estado, valido y recién después inserto una clave única): se reintenta y el reintento ve «ya recibida».
 * Idempotente por ESTADO, sin clave de reintento: confirmar dos veces devuelve ÉXITO con `yaExistia` («ya recibida») sin crear stock de nuevo ni auditar otra vez; dos confirmaciones a la vez dejan una sola (la otra reintenta y la encuentra recibida).
 *
 * @contract Confirma la recepción de la parte pendiente de una sucursal exactamente una vez: entra su stock con la fecha de la confirmación, o no entra nada; repetir devuelve éxito sin mover nada.
 * @idempotency POR_ESTADO: la guarda `WHERE estadoRecepcion = 'PENDIENTE'` y el candado de la cabecera; una segunda confirmación recibe éxito con `yaExistia`.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento), con candado sobre la cabecera de la factura.
 * @sideEffects registrarCambioAuditado (la recepción).
 * @ficha permiso=compra_recibir transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function confirmarRecepcionDeFacturaCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "sucursalNombre" | "db" | "transaccion" | "ahora">,
  comando: ComandoConfirmarRecepcionDeFactura
): Promise<ResultadoConfirmarRecepcionDeFactura> {
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoConfirmarRecepcionDeFactura> => {
    const factura = await bloquearFactura(tx, comando.facturaId);
    if (!factura) return fracaso("NO_ENCONTRADA", MENSAJE_RECEPCION_NO_ENCONTRADA);

    const parte = await cargarParteDeFacturaEnSucursal(tx, factura.id, actor.sucursalId);
    // Las secciones de ESTA sucursal, con candado compartido (ver el punto 1 de arriba): una sección de otra sucursal o empresa no está en la lista (para quien pregunta, igual que una que no existe).
    const seccionesDeLaSucursal = await bloquearSeccionesDeLaSucursal(tx, actor.sucursalId);
    // Cada sección elegida: de esta sucursal y activa. El estado que decide la regla es el PEOR de todas (ajena, después inactiva): así una sola regla pura cubre una o varias secciones.
    const seccionesPorId = new Map(seccionesDeLaSucursal.map((s) => [s.id, s]));
    const secciones = [...new Set(comando.entradas.map((e) => e.seccionId))].map((id) => seccionesPorId.get(id));
    const inactiva = secciones.find((s) => s && !s.activa);
    const estadoDeLaSeccion: SeccionParaRecibir = secciones.some((s) => !s) ? "AJENA" : inactiva ? "INACTIVA" : "PROPIA_ACTIVA";
    // La fecha del stock es la de la confirmación: el día de calendario argentino de `actor.ahora` (corte de día en hora argentina) guardado como el mediodía de ese día, como el resto de las compras (P1).
    const diaStock = diaDeCalendario(actor.ahora, ZONA_ARGENTINA);
    const fechaStock = mediodiaDelDia(diaStock, ZONA_ARGENTINA);
    const decision = decidirConfirmacionDeRecepcion({
      esDeLaSucursalDelActor: parte !== null,
      facturaAnulada: Boolean(factura.anuladaEn),
      estadoDeLaParte: parte?.estadoRecepcion === "PENDIENTE" ? "PENDIENTE" : "RECIBIDA",
      seccion: estadoDeLaSeccion,
    });
    if (!decision.ok) {
      if (decision.codigo === "SECCION_INACTIVA") return fracaso("SECCION_INACTIVA", mensajeSeccionDesactivada(inactiva?.nombre ?? ""));
      return fracaso(decision.codigo, decision.mensaje);
    }
    // La regla ya garantizó la parte y las secciones; esto solo lo deja claro para el compilador.
    if (!parte) return fracaso("NO_ENCONTRADA", MENSAJE_RECEPCION_NO_ENCONTRADA);
    // Repetición: ya estaba recibida (la regla ya miró la sucursal y la anulación). Éxito sin escribir ni auditar nada.
    if (decision.yaRecibida) return exito(MENSAJE_RECEPCION_YA_RECIBIDA, { operacionId: parte.operacionId, movimientos: 0, yaExistia: true });

    const renglones = await cargarRenglonesParaRecibir(tx, factura.id);
    if (!renglones.length) return fracaso("SIN_LINEAS", "La compra no tiene mercadería para recibir.");
    // Los destinos: cada renglón de mercadería entra ENTERO en una sola sección.
    const entradasValidas = validarEntradasDeRecepcion(renglones.map((r) => r.facturaProveedorRenglonId), comando.entradas);
    if (!entradasValidas.ok) return fracaso(entradasValidas.codigo, entradasValidas.mensaje);
    // El destino de cada renglón según su control, y el bloqueo si la sucursal no tiene la sección de rechazo o de cuarentena que alguna línea pide (nada entra).
    const condiciones = await cargarCondicionesDeControl(tx, parte.id);
    const destinosDecididos = decidirDestinosDeRecepcion({
      lineas: renglones.map((r) => ({ renglonId: r.facturaProveedorRenglonId, condicion: condiciones.get(r.facturaProveedorRenglonId) ?? null })),
      secciones: seccionesDeLaSucursal,
      elegidas: comando.entradas,
    });
    if (!destinosDecididos.ok) return fracaso(destinosDecididos.codigo, destinosDecididos.mensaje);
    for (const r of renglones) {
      if (!(await productoDisponibleEn(actor.sucursalId, r.productoId, tx))) {
        return fracaso("PRODUCTO_NO_DISPONIBLE", `«${r.productoNombre}» no está disponible en «${actor.sucursalNombre}»: pedí que lo habiliten o que anulen la factura y la vuelvan a cargar.`);
      }
    }

    const operacion = await escribirOperacionDeStock(tx, {
      sucursalId: actor.sucursalId,
      proceso: "COMPRA",
      fecha: fechaStock,
      proveedorId: factura.proveedorId,
      nroFactura: factura.nroFactura,
      seccionDestinoId: null,
      motivoId: null,
      destinoId: null,
      detalleLibre: factura.detalleLibre,
      usuarioId: actor.usuarioId,
      claveIdempotencia: null,
      payloadHash: null,
    });
    // UNA línea del Kardex por renglón, en su orden, con TODO lo del renglón (cantidad, precio total, precio por unidad de stock, lote y detalle) y la sección elegida. La condición del control (conforme, con observaciones, rechazada) NO cambia cuánto stock entra.
    const destinoDe = new Map(comando.entradas.map((e) => [e.renglonId, e.seccionId]));
    const lineas = renglones.map((r) => ({
      operacionId: operacion.id,
      productoId: r.productoId,
      seccionId: destinoDe.get(r.facturaProveedorRenglonId) as string, // `validarEntradasDeRecepcion` ya garantizó un destino por renglón
      proceso: "COMPRA" as const,
      cantidad: r.cantidadStock,
      loteVencimiento: r.loteVencimiento,
      detalle: r.detalle,
      precioTotal: r.precioTotal,
      precioPorUnidadStock: r.precioPorUnidadStock,
      facturaProveedorRenglonId: r.facturaProveedorRenglonId,
    }));
    const escritas = await escribirLineasDeMovimientoStock(tx, lineas);
    const confirmadas = await confirmarParteRecibida(tx, { parteId: parte.id, operacionId: operacion.id, recibidaEn: fechaStock, recibidaPorId: actor.usuarioId });
    if (confirmadas !== 1) throw new ParteYaRecibida();

    await registrarCambioAuditado(tx, {
      entidad: "FacturaProveedor",
      entidadId: factura.id,
      descripcion: `Recepción de la compra${factura.nroFactura ? ` ${factura.nroFactura}` : ""} confirmada en «${actor.sucursalNombre}» (${secciones.length === 1 ? `sección «${secciones[0]?.nombre ?? ""}»` : `secciones ${secciones.map((x) => `«${x?.nombre ?? ""}»`).join(", ")}`}, fecha de stock ${diaStock}). Destino por renglón: ${textoDeLosDestinos(destinosDecididos.destinos, renglones, seccionesPorId)}`,
      campo: "recepcion",
      valorAnterior: "PENDIENTE",
      valorNuevo: "RECIBIDA",
      actorId: actor.usuarioId,
      sucursalId: actor.sucursalId,
    });

    return exito(`Recepción confirmada: ${escritas.movimientos} movimiento(s) entraron al stock de esta sucursal con fecha ${diaStock}.`, { operacionId: operacion.id, movimientos: escritas.movimientos, yaExistia: false });
  }, undefined, undefined, true).catch((e): ResultadoConfirmarRecepcionDeFactura => {
    // Otra confirmación ganó entre la lectura y el UPDATE (con el candado de la cabecera no debería pasar): se deshizo todo y para quien repite es lo mismo que «ya estaba recibida».
    if (e instanceof ParteYaRecibida) return exito(MENSAJE_RECEPCION_YA_RECIBIDA, { operacionId: null, movimientos: 0, yaExistia: true });
    throw e;
  });
}
