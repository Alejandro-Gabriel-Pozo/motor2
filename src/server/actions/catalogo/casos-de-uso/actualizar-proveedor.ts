import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { esErrorDeUnicidad } from "@/core/catalogo/public-servidor";
import { mensajeCuitDuplicado, validarContactoDeProveedor } from "@/core/features/catalogo/contacto-de-proveedor";
import type { ComandoActualizarProveedor, ResultadoActualizarProveedor } from "@/core/features/catalogo/proveedores.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { proveedorConCuit } from "@/server/lecturas/catalogo/proveedor-con-cuit";
import { guardarContactoDeProveedor } from "@/server/persistencia/catalogo/proveedores";

/**
 * Caso de uso «corregir los datos de contacto de un proveedor» (Hito 4 de la pureza, bloque C de la pieza carta/catálogo/stock, paso H4C-14 —
 * `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en línea en la Server Action `actualizarProveedor` (`src/server/actions/catalogo/proveedores.ts`),
 * movido TAL CUAL y en el MISMO orden: lee el proveedor (un id inexistente gana sobre un dato inválido), valida los datos de contacto
 * (`validarContactoDeProveedor`), rechaza un CUIT que ya tiene OTRO proveedor de la empresa y reescribe los datos con la base del contexto, sin transacción; si el
 * índice único salta igual (una carrera con otro alta o edición), vuelve a leer quién tiene el CUIT para nombrarlo. El nombre no se edita acá a propósito (mismo
 * criterio de identidad que Insumo/Producto). La Server Action quedó como adaptador (`conPermisoDeEmpresa("proveedores")` → este caso de uso → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos. Sin guard: la validación va después de leer el proveedor.
 *
 * @contract Reescribe contacto, teléfono, email, CUIT, condiciones de pago y notas del proveedor, salvo que no exista, un dato sea inválido o el CUIT sea de otro.
 * @idempotency No aplica — repetir el pedido vuelve a escribir los mismos datos.
 * @transaction Ninguna: lecturas y una escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (un proveedor no tiene columnas de plata: sin auditoría).
 * @ficha permiso=proveedores transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarProveedorCasoDeUso(actor: Pick<ContextoUsuario, "db">, comando: ComandoActualizarProveedor): Promise<ResultadoActualizarProveedor> {
  const { proveedorId } = comando;
  const proveedor = await actor.db.proveedor.findUnique({ where: { id: proveedorId } });
  if (!proveedor) return fracaso("NO_ENCONTRADO", "No se encontró ese proveedor.");
  const campos = validarContactoDeProveedor(comando.datos);
  if (!campos.ok) return fracaso("DATO_INVALIDO", campos.mensaje);

  const conMismoCuit = await proveedorConCuit(actor.db, campos.valor.cuit, proveedorId);
  if (conMismoCuit) return fracaso("CUIT_REPETIDO", mensajeCuitDuplicado(conMismoCuit));

  try {
    await guardarContactoDeProveedor(actor.db, { id: proveedorId, valores: campos.valor });
  } catch (e) {
    if (!esErrorDeUnicidad(e)) throw e;
    const carrera = await proveedorConCuit(actor.db, campos.valor.cuit, proveedorId);
    return carrera ? fracaso("CUIT_REPETIDO", mensajeCuitDuplicado(carrera)) : fracaso("CHOQUE_DE_UNICIDAD", "No se pudo guardar: el dato choca con otro proveedor.");
  }
  return exito(`Proveedor "${proveedor.nombre}" actualizado.`, null);
}
