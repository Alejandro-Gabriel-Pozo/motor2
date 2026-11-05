import "server-only";
import { esErrorDeUnicidad } from "@/core/catalogo/public-servidor";
import { mensajeCuitDuplicado, validarContactoDeProveedor } from "@/core/features/catalogo/contacto-de-proveedor";
import { nombreDeCatalogo } from "@/core/features/catalogo/nombre-de-catalogo";
import { validarOferta } from "@/core/features/catalogo/oferta-de-proveedor";
import type { ComandoActualizarProveedor, ResultadoActualizarProveedor } from "@/core/features/catalogo/proveedores.schema";
import { cambiosPorColumna } from "@/core/opciones/public";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { proveedorConCuit } from "@/server/lecturas/catalogo/proveedor-con-cuit";
import { proveedorConNombre } from "@/server/lecturas/catalogo/proveedor-con-nombre";
import { guardarProveedor } from "@/server/persistencia/catalogo/proveedores";

const MENSAJE_CAMBIO_CONCURRENTE = "El proveedor cambió mientras lo editabas: otra persona le cambió el nombre antes. Recargá la pantalla y volvé a hacer el cambio.";

/**
 * Caso de uso «corregir un proveedor»: su nombre, sus datos de contacto y qué le compramos (productos, servicios o ambos). Antes el nombre no se podía corregir («mismo criterio de identidad
 * que Insumo/Producto»), pero un proveedor se referencia SIEMPRE por su `id` (FK real en compras, facturas, notas de crédito y consignación; el código `PRV_…` es su identidad visible): el
 * nombre es un dato más, y quien lo cargó abreviado tiene que poder corregirlo (verificado en el código el 2026-11-04: ningún lugar guarda una copia del nombre ni lo usa como clave;
 * los reportes lo leen por la relación en el momento).
 *
 * Todo dentro de UNA transacción SERIALIZABLE: lee el proveedor (un id inexistente gana sobre un dato inválido); valida los datos (el nombre con la MISMA regla del alta, al menos una de las dos
 * casillas, el contacto); si cambia el nombre exige que el que vio la pantalla (`nombreEsperado`) siga siendo el vigente (si no, `CAMBIO_CONCURRENTE`) y que ningún OTRO proveedor se llame así
 * sin distinguir mayúsculas (el criterio del alta; las tildes sí distinguen); rechaza un CUIT que ya tiene otro; y recién entonces escribe con `nombre = actual` en el `where` (defensa doble). Sin
 * ningún cambio no escribe ni audita (guardar dos veces lo mismo es inofensivo). El nombre y las dos casillas dejan una fila de auditoría por columna (quién, cuándo, antes y después); el
 * contacto no (como siempre: no es plata ni cambia el significado de nada).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (la Server Action pidió `proveedores` de empresa).
 *
 * @contract Deja el proveedor con el nombre, el contacto y la oferta pedidos, salvo que no exista, un dato sea inválido, el nombre o el CUIT sean de otro, o el nombre haya cambiado mientras se editaba.
 * @idempotency Optimista — `nombreEsperado` se compara dentro de la transacción y en el `where` del UPDATE; el mismo pedido repetido no encuentra cambios y responde bien sin escribir ni auditar.
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `tambienChoqueDeUnico`: un renombre simultáneo al mismo nombre o CUIT choca con el único y el reintento lo rechaza con su mensaje.
 * @sideEffects registrarCambioAuditado (una fila por columna que cambia entre nombre, ofreceProductos y ofreceServicios), con el mismo `tx`.
 * @ficha permiso=proveedores transaccion=SERIALIZABLE idempotencia=OPTIMISTA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarProveedorCasoDeUso(actor: Pick<ContextoDeAccion, "usuarioId" | "transaccion">, comando: ComandoActualizarProveedor): Promise<ResultadoActualizarProveedor> {
  const { proveedorId } = comando;
  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoActualizarProveedor> => {
      const proveedor = await tx.proveedor.findUnique({
        where: { id: proveedorId },
        select: { nombre: true, contacto: true, telefono: true, email: true, cuit: true, condicionesPago: true, notas: true, ofreceProductos: true, ofreceServicios: true },
      });
      if (!proveedor) return fracaso("NO_ENCONTRADO", "No se encontró ese proveedor.");

      // El nombre: no viene = no se toca. Viene igual al vigente = no hay cambio. Viene distinto = hay que probar que se editó sobre el vigente y que está libre.
      let nombre = proveedor.nombre;
      if (comando.nombre !== undefined) {
        const pedido = nombreDeCatalogo(comando.nombre, "El nombre no puede estar vacío.", "El nombre");
        if (!pedido.ok) return fracaso("DATO_INVALIDO", pedido.mensaje);
        if (pedido.valor !== proveedor.nombre) {
          if (comando.nombreEsperado === undefined) return fracaso("DATO_INVALIDO", "Falta el nombre que tenía el proveedor al abrir la pantalla: recargala y volvé a intentar.");
          if (comando.nombreEsperado !== proveedor.nombre) return fracaso("CAMBIO_CONCURRENTE", MENSAJE_CAMBIO_CONCURRENTE);
          const otro = await proveedorConNombre(tx, pedido.valor, proveedorId);
          if (otro) return fracaso("NOMBRE_REPETIDO", `Ya existe un proveedor llamado «${otro}». Elegí otro nombre.`);
          nombre = pedido.valor;
        }
      }

      const oferta = validarOferta(comando.ofreceProductos ?? proveedor.ofreceProductos, comando.ofreceServicios ?? proveedor.ofreceServicios);
      if (!oferta.ok) return fracaso("DATO_INVALIDO", oferta.mensaje);
      const campos = validarContactoDeProveedor(comando.datos);
      if (!campos.ok) return fracaso("DATO_INVALIDO", campos.mensaje);

      const conMismoCuit = await proveedorConCuit(tx, campos.valor.cuit, proveedorId);
      if (conMismoCuit) return fracaso("CUIT_REPETIDO", mensajeCuitDuplicado(conMismoCuit));

      const cambios = cambiosPorColumna([
        { campo: "nombre", antes: proveedor.nombre, despues: nombre },
        { campo: "ofreceProductos", antes: proveedor.ofreceProductos, despues: oferta.valor.ofreceProductos },
        { campo: "ofreceServicios", antes: proveedor.ofreceServicios, despues: oferta.valor.ofreceServicios },
      ]);
      const v = campos.valor;
      const contactoCambio =
        v.contacto !== proveedor.contacto || v.telefono !== proveedor.telefono || v.email !== proveedor.email || v.cuit !== proveedor.cuit || v.condicionesPago !== proveedor.condicionesPago || v.notas !== proveedor.notas;
      if (cambios.length === 0 && !contactoCambio) return exito(`Proveedor "${proveedor.nombre}" actualizado.`, null);

      const escritas = await guardarProveedor(tx, { id: proveedorId, nombreActual: proveedor.nombre, nombre, valores: v, oferta: oferta.valor });
      if (escritas === 0) return fracaso("CAMBIO_CONCURRENTE", MENSAJE_CAMBIO_CONCURRENTE);

      const descripcion = `Proveedor «${nombre}»: edición.`;
      for (const c of cambios) {
        await registrarCambioAuditado(tx, { entidad: "Proveedor", entidadId: proveedorId, campo: c.campo, descripcion, valorAnterior: c.antes, valorNuevo: c.despues, actorId: actor.usuarioId, sucursalId: null });
      }
      return exito(`Proveedor "${nombre}" actualizado.`, null);
    },
    undefined,
    undefined,
    true
  ).catch(async (e): Promise<ResultadoActualizarProveedor> => {
    // Agotados los reintentos con un choque de unicidad que los chequeos de arriba no explican (no es el nombre ni el CUIT): se informa sin filtrar el error crudo.
    if (esErrorDeUnicidad(e)) return fracaso("CHOQUE_DE_UNICIDAD", "No se pudo guardar: el dato choca con otro proveedor.");
    throw e;
  });
}
