import "server-only";
import {
  ETIQUETA_DE_CONDICION_DE_CONTROL,
  MENSAJE_RECEPCION_NO_ENCONTRADA,
  decidirRegistroDeControl,
} from "@/core/compras/public";
import type { ComandoRegistrarControlDeRecepcion, ResultadoRegistrarControlDeRecepcion } from "@/core/features/compras/factura-proveedor.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import type { FuenteDeAzar } from "@/core/seguridad/azar";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { bloquearFactura, cargarParteDeFacturaEnSucursal, cargarRenglonesParaRecibir, cargarRenglonesYaControlados } from "@/server/persistencia/compras/cargar-factura-proveedor";
import { escribirControlesDeLinea } from "@/server/persistencia/compras/escribir-factura-proveedor";

/**
 * Caso de uso «registrar el control de las líneas de una compra pendiente» (Compras N3-b, control por línea; docs/diseno-compras-n3b-n4-etapas-2026-11-16.md): quien recibe (el operador también) deja constancia de cómo llegó cada línea que controló
 * (conforme, con observaciones o rechazada), ANTES de confirmar la recepción. No se exige controlar todas las líneas: una línea sin control queda «no se constató» (nunca un CONFORME por defecto). El control NO cambia cuánto stock entra al confirmar.
 *
 * `import "server-only"` y SIN `"use server"`: no chequea permisos (la Server Action pidió `compra_controlar_recepcion` en la sucursal activa: del módulo `recepcion_de_compras`, piso operario) ni el formato (`guardComandoRegistrarControlDeRecepcion`).
 *
 * En UNA transacción SERIALIZABLE:
 *  1. `SELECT … FOR UPDATE` de la cabecera de la factura (serializa contra la confirmación, la anulación y otro registro de control); no existe en la empresa (la RLS esconde las ajenas) → «no se encontró»;
 *  2. `decidirRegistroDeControl` (regla pura): la parte es de esta sucursal, la factura no está anulada y la parte sigue pendiente (el control solo existe antes de confirmar);
 *  3. cada renglón es un renglón de mercadería de la compra (si no, `RENGLON_AJENO`) y no tiene ya control (si lo tiene, `YA_CONTROLADA`: el control no se corrige ni se duplica, y no se escribe NINGUNO de los del pedido);
 *  4. inserta todos los controles de una vez (id uuid de la aplicación) y audita (`FacturaProveedor`, campo `controlDeRecepcion`: quién, cuándo y cuántas líneas; las observaciones no van a la auditoría).
 * Segundas barreras en la base: único por (parte, renglón), el renglón es de la factura de la parte y la parte sigue pendiente (disparador).
 * DIFERENCIA con Pedernal, declarada: allá el control entra en la transacción de su recepción (`inspeccion_de_linea_de_recepcion`); acá es un paso aparte ANTES de confirmar porque Motor2 no tiene recepción propia (la parte de la factura es la recepción).
 *
 * @contract Registra una vez el control de cada renglón pedido de la parte pendiente, todos o ninguno.
 * @idempotency POR_ESTADO: el único (parte, renglón) y el candado de la cabecera; repetir el pedido recibe `YA_CONTROLADA` sin escribir nada.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento), con candado sobre la cabecera de la factura.
 * @sideEffects registrarCambioAuditado (el control registrado).
 * @ficha permiso=compra_controlar_recepcion transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function registrarControlDeRecepcionCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "sucursalNombre" | "db" | "transaccion" | "ahora">,
  comando: ComandoRegistrarControlDeRecepcion,
  azar: FuenteDeAzar
): Promise<ResultadoRegistrarControlDeRecepcion> {
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoRegistrarControlDeRecepcion> => {
    const factura = await bloquearFactura(tx, comando.facturaId);
    if (!factura) return fracaso("NO_ENCONTRADA", MENSAJE_RECEPCION_NO_ENCONTRADA);

    const parte = await cargarParteDeFacturaEnSucursal(tx, factura.id, actor.sucursalId);
    const decision = decidirRegistroDeControl({
      esDeLaSucursalDelActor: parte !== null,
      facturaAnulada: Boolean(factura.anuladaEn),
      estadoDeLaParte: parte?.estadoRecepcion === "PENDIENTE" ? "PENDIENTE" : "RECIBIDA",
    });
    if (!decision.ok) return fracaso(decision.codigo, decision.mensaje);
    // La regla ya garantizó la parte; esto solo lo deja claro para el compilador.
    if (!parte) return fracaso("NO_ENCONTRADA", MENSAJE_RECEPCION_NO_ENCONTRADA);

    const deLaCompra = new Set((await cargarRenglonesParaRecibir(tx, factura.id)).map((r) => r.facturaProveedorRenglonId));
    if (comando.controles.some((c) => !deLaCompra.has(c.renglonId))) return fracaso("RENGLON_AJENO", "Hay un renglón que no es de esta compra.");
    const yaControlados = await cargarRenglonesYaControlados(tx, parte.id);
    if (comando.controles.some((c) => yaControlados.has(c.renglonId))) {
      return fracaso("YA_CONTROLADA", "Alguna de esas líneas ya tiene su control registrado: no se guardó ninguno. Recargá la pantalla para ver lo constatado.");
    }

    await escribirControlesDeLinea(tx, {
      facturaProveedorId: factura.id,
      parteId: parte.id,
      registradoPorId: actor.usuarioId,
      controles: comando.controles.map((c) => ({
        id: azar.uuid(),
        renglonId: c.renglonId,
        condicion: c.condicion,
        observacion: c.observacion ?? null,
        cantidadSegunRemito: c.cantidadSegunRemito ?? null,
      })),
    });

    const rechazadas = comando.controles.filter((c) => c.condicion === "RECHAZADA").length;
    await registrarCambioAuditado(tx, {
      entidad: "FacturaProveedor",
      entidadId: factura.id,
      descripcion: `Control de la recepción de la compra${factura.nroFactura ? ` ${factura.nroFactura}` : ""} registrado en «${actor.sucursalNombre}» (${comando.controles.length} línea(s)${rechazadas > 0 ? `, ${rechazadas} ${ETIQUETA_DE_CONDICION_DE_CONTROL.RECHAZADA.toLowerCase()}(s)` : ""})`,
      campo: "controlDeRecepcion",
      valorAnterior: null,
      valorNuevo: `${comando.controles.length}`,
      actorId: actor.usuarioId,
      sucursalId: actor.sucursalId,
    });

    return exito(`Control registrado: ${comando.controles.length} línea(s).`, { controles: comando.controles.length });
  });
}
