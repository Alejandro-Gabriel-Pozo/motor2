import "server-only";
import {
  cabeceraCoincide,
  decidirCorreccionDeDatos,
  descripcionAuditoriaCorreccion,
  diferenciasDeCabecera,
  mensajeCompraCorregida,
  normalizarCorreccion,
  normalizarNumeroDeComprobante,
  validarCorreccion,
} from "@/core/compras/public";
import type { ComandoCorregirFacturaProveedor, ResultadoCorregirFacturaProveedor } from "@/core/features/compras/factura-proveedor.schema";
import { esChoqueDeFacturaDeProveedorUnica, esChoqueDeFacturaUnica, MENSAJE_FACTURA_DUPLICADA } from "@/core/movimientos/public-servidor";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { lecturaDeVerificacionEnLaEmpresa } from "@/server/acceso/alcance";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { bloquearFactura, cargarPartesDeFactura, cargarProveedoresParaCorreccion, tieneNotasDeCredito } from "@/server/persistencia/compras/cargar-factura-proveedor";
import { hayComprobanteVigenteEnLaEmpresa } from "@/server/persistencia/compras/comprobante-en-la-empresa";
import { escribirCorreccionDeFactura } from "@/server/persistencia/compras/escribir-factura-proveedor";
import { exigirPermisoEnLasSucursalesDeLaFactura } from "./permiso-en-las-sucursales-de-la-factura";

const MENSAJE_NO_ENCONTRADA = "No se encontró esa factura de proveedor.";

/**
 * Caso de uso «corregir los datos de la factura» (U1 de «una sola compra», docs/diseno-una-sola-compra-2026-11-06.md §8.3): proveedor, N.º de factura y detalle de la FACTURA entera, sin tocar renglones, partes ni Kardex. Es la
 * única corrección de la compra (reemplaza a `corregirCompra`, que solo corregía la compra simple). Las reglas puras de la cabecera siguen en `src/core/compras/correccion.ts`; las de la factura entera, en `reglas-de-la-factura.ts`.
 *
 * `import "server-only"` y SIN `"use server"`: la Server Action pidió `corregir_compra` en la sucursal activa y validó el formato (`guardComandoCorregirFacturaProveedor`).
 *
 * Pasos:
 *  1. (fuera de la transacción) el permiso `corregir_compra` EN CADA sucursal donde ya entró una parte y en la que la cargó (`exigirPermisoEnLasSucursalesDeLaFactura`, supuesto S2); la escritura queda ensanchada a ellas y la lectura a toda
 *     la empresa (solo para preguntar si el número ya está usado);
 *  2. dentro de UNA transacción SERIALIZABLE, PRIMERO el candado sobre la cabecera (`SELECT … FOR UPDATE`): serializa contra otra corrección, contra la anulación y contra la aceptación de una parte (que copia el número DESPUÉS del
 *     candado, así ninguna parte queda con el número viejo: invariante I-NUM). Después: las partes que se ven son las del paso 1 (si una destino aceptó en el medio, se pide repetir); anulada → «no se corrige»; cambiar el proveedor con
 *     notas de crédito → rechazo (la base ata la nota al proveedor); si ya tiene exactamente lo pedido, «nada que corregir» (idempotencia por estado, sin clave); guarda optimista («lo que viste es lo que está»); formato de lo que cambia;
 *     proveedor nuevo existente y activo; el par proveedor + número no lo usa NINGÚN otro comprobante vigente de la empresa (`hayComprobanteVigenteEnLaEmpresa`, sin contar la propia factura ni sus partes);
 *  3. escribe la cabecera y COPIA el cambio a la compra de cada parte en la misma transacción, y una fila de auditoría por campo que cambió (con el nombre del proveedor y no su id).
 *  El índice único de cada tabla queda como segunda barrera (`esChoqueDeFacturaUnica` y `esChoqueDeFacturaDeProveedorUnica` en el `.catch`).
 *
 * @contract Corrige proveedor, número y detalle de una factura vigente con guarda optimista, y los copia a la compra de cada parte: dos correcciones concurrentes nunca se pisan en silencio y ninguna parte queda con otro número que su factura.
 * @idempotency Por estado — si la factura ya tiene exactamente lo pedido responde "nada que corregir" sin escribir (sin clave I3).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento) sobre la base de verificación, con candado sobre la cabecera de la factura y `.catch` de los dos índices únicos de factura.
 * @sideEffects registrarCambioAuditado (uno por cada campo que cambió).
 * @ficha permiso=corregir_compra transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function corregirFacturaProveedorCasoDeUso(actor: ContextoDeAccion, comando: ComandoCorregirFacturaProveedor): Promise<ResultadoCorregirFacturaProveedor> {
  const pedida = normalizarCorreccion(comando.nueva);
  const vista = normalizarCorreccion(comando.esperado);

  const gate = await exigirPermisoEnLasSucursalesDeLaFactura(actor, comando.facturaId, "corregir");
  if (!gate.ok) return fracaso("SIN_PERMISO_EN_SUCURSAL", gate.mensaje);

  const verificacion = await lecturaDeVerificacionEnLaEmpresa(gate.ctx);
  return conTransaccionSerializable(verificacion.transaccion, async (tx): Promise<ResultadoCorregirFacturaProveedor> => {
    const factura = await bloquearFactura(tx, comando.facturaId);
    if (!factura) return fracaso("NO_ENCONTRADA", MENSAJE_NO_ENCONTRADA);

    // Lo guardado se compara en su forma canónica (como lo pedido y lo visto): una factura con «A-0001-00001234» no cambia de número por escribirlo con otros ceros (I15: lo viejo no se toca).
    const actual = normalizarCorreccion({ proveedorId: factura.proveedorId, nroFactura: factura.nroFactura, detalleLibre: factura.detalleLibre });
    const cambios = diferenciasDeCabecera(actual, pedida);
    const cambiaElProveedor = cambios.some((c) => c.campo === "proveedorId");
    const regla = decidirCorreccionDeDatos({ anulada: Boolean(factura.anuladaEn), cambiaElProveedor, tieneNotas: cambiaElProveedor && (await tieneNotasDeCredito(tx, factura.id)) });
    if (!regla.ok) return fracaso(regla.codigo, regla.mensaje);

    const partes = await cargarPartesDeFactura(tx, factura.id);
    if (partes.map((p) => p.sucursalId).sort().join("|") !== [...gate.sucursalesConParte].sort().join("|")) {
      return fracaso("CAMBIO_CONCURRENTE", "La factura cambió mientras la corregías (otra sucursal aceptó su parte): volvé a intentarlo.");
    }

    if (!cambios.length) return exito("La compra ya tiene esos datos: no hay nada que corregir.", { facturaId: factura.id, camposCorregidos: [] });
    if (!cabeceraCoincide(actual, vista)) {
      return fracaso("CAMBIO_CONCURRENTE", "Esta compra cambió mientras la editabas (otra persona la corrigió). Recargá la página y volvé a intentarlo.");
    }
    const invalido = validarCorreccion(cambios);
    if (invalido) return fracaso("ENTRADA_INVALIDA", invalido);

    const proveedores = await cargarProveedoresParaCorreccion(tx, [actual.proveedorId, pedida.proveedorId].filter((id): id is string => Boolean(id)));
    if (cambiaElProveedor && pedida.proveedorId) {
      const nuevo = proveedores.get(pedida.proveedorId);
      if (!nuevo) return fracaso("PROVEEDOR_INEXISTENTE", "El proveedor no existe.");
      if (!nuevo.activo) return fracaso("PROVEEDOR_INACTIVO", `El proveedor "${nuevo.nombre}" está inactivo.`);
    }

    if (cambios.some((c) => c.campo === "proveedorId" || c.campo === "nroFactura") && pedida.proveedorId && pedida.nroFactura) {
      if (await hayComprobanteVigenteEnLaEmpresa(tx, { empresaId: gate.ctx.empresaId, proveedorId: pedida.proveedorId, nroFactura: pedida.nroFactura, excluirFacturaId: factura.id })) {
        return fracaso("FACTURA_DUPLICADA", MENSAJE_FACTURA_DUPLICADA);
      }
    }

    // El número solo se reescribe si cambió (si no, queda tal cual está guardado).
    const nroFactura = cambios.some((c) => c.campo === "nroFactura") ? pedida.nroFactura : factura.nroFactura;
    await escribirCorreccionDeFactura(tx, {
      facturaProveedorId: factura.id,
      proveedorId: pedida.proveedorId as string,
      nroFactura,
      nroFacturaNormalizado: nroFactura ? normalizarNumeroDeComprobante(nroFactura) : null,
      detalleLibre: pedida.detalleLibre,
      detalleAnterior: factura.detalleLibre,
      operacionIds: partes.flatMap((p) => (p.operacionId ? [p.operacionId] : [])),
    });

    for (const c of cambios) {
      const esProveedor = c.campo === "proveedorId";
      await registrarCambioAuditado(tx, {
        entidad: "FacturaProveedor",
        entidadId: factura.id,
        descripcion: descripcionAuditoriaCorreccion(factura.fecha, factura.nroFactura, c.campo),
        campo: c.campo,
        valorAnterior: esProveedor ? (proveedores.get(actual.proveedorId ?? "")?.nombre ?? c.anterior) : c.anterior,
        valorNuevo: esProveedor ? (proveedores.get(pedida.proveedorId ?? "")?.nombre ?? c.nuevo) : c.nuevo,
        actorId: gate.ctx.usuarioId,
        sucursalId: gate.ctx.sucursalId,
      });
    }

    return exito(mensajeCompraCorregida(cambios), { facturaId: factura.id, camposCorregidos: cambios.map((c) => c.campo) });
  }).catch((e): ResultadoCorregirFacturaProveedor => {
    // La transacción ya hizo rollback. Choque de la carrera de factura repetida (dos escrituras simultáneas con el mismo par proveedor + N.º de factura): mismo mensaje de negocio que la carga, no un error 500.
    if (esChoqueDeFacturaDeProveedorUnica(e) || esChoqueDeFacturaUnica(e)) return fracaso("FACTURA_DUPLICADA", MENSAJE_FACTURA_DUPLICADA);
    throw e;
  });
}
