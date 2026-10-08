import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { crearConCodigoAutogenerado, esErrorDeUnicidad } from "@/core/catalogo/public-servidor";
import { mensajeCuitDuplicado } from "@/core/features/catalogo/contacto-de-proveedor";
import type { ComandoAltaProveedor, ResultadoAltaProveedor } from "@/core/features/catalogo/proveedores.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import type { FuenteDeAzar } from "@/core/seguridad/azar";
import { proveedorConCuit } from "@/server/lecturas/catalogo/proveedor-con-cuit";
import { crearProveedorNuevo } from "@/server/persistencia/catalogo/proveedores";

/**
 * Caso de uso «alta de un proveedor» (equivalente de altaProveedor, Catalogo.js:3757-3775; Hito 4 de la pureza, bloque C de la pieza carta/catálogo/stock, paso
 * H4C-14 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en línea en la Server Action `altaProveedor` (`src/server/actions/catalogo/proveedores.ts`),
 * movido TAL CUAL: rechaza un nombre ya usado (sin distinguir mayúsculas) y un CUIT que ya tiene otro proveedor de la empresa, y crea el proveedor con un código
 * autogenerado (`PRV…`) con reintento ante un choque, con la base del contexto y SIN transacción (el reintento atrapa el P2002 del INSERT: dentro de una
 * transacción interactiva de Postgres el primer INSERT fallido abortaría la transacción entera). Si el índice único salta igual —dos altas con el mismo CUIT a la
 * vez pasan el chequeo de arriba y las frena `(empresaId, cuit)`—, vuelve a leer quién tiene el CUIT para nombrarlo; si no es el CUIT, es el código. La Server
 * Action quedó como adaptador (`conPermisoDeEmpresa("proveedor_alta")` → `guardComandoAltaProveedor` → este caso de uso, con la fuente de azar del proceso →
 * `aResultadoAccion` y el id y el nombre para su `ResultadoConId`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato (el guard). No lee el azar por su cuenta: lo recibe (`azar`,
 * para el código autogenerado; precedente: `dar-de-alta-producto-rapido.ts`).
 *
 * @contract Crea el proveedor con un código único, salvo que ya haya uno con ese nombre o con ese CUIT; devuelve su id y su nombre.
 * @idempotency Por estado — repetir el pedido encuentra el proveedor ya creado con ese nombre y se rechaza: no crea otro.
 * @transaction Ninguna, a propósito: el reintento del código autogenerado necesita que el INSERT fallido no aborte nada.
 * @sideEffects Ninguno (un proveedor no tiene columnas de plata: sin auditoría).
 * @ficha permiso=proveedor_alta transaccion=NINGUNA idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function altaProveedorCasoDeUso(actor: Pick<ContextoUsuario, "db">, comando: ComandoAltaProveedor, azar: FuenteDeAzar): Promise<ResultadoAltaProveedor> {
  const { nombre, valores } = comando;
  const dup = await actor.db.proveedor.findFirst({ where: { nombre: { equals: nombre, mode: "insensitive" } } });
  if (dup) return fracaso("NOMBRE_REPETIDO", `Ya existe un proveedor llamado "${nombre}".`);
  const conMismoCuit = await proveedorConCuit(actor.db, valores.cuit);
  if (conMismoCuit) return fracaso("CUIT_REPETIDO", mensajeCuitDuplicado(conMismoCuit));

  try {
    const proveedor = await crearConCodigoAutogenerado("PRV", undefined, (codigo) => crearProveedorNuevo(actor.db, { codigo, nombre, valores }), azar);
    return exito(`Proveedor "${proveedor.nombre}" creado.`, { id: proveedor.id, nombre: proveedor.nombre });
  } catch (e) {
    // Carrera: dos altas con el mismo CUIT a la vez pasan el chequeo de arriba y las frena el índice único (empresaId, cuit).
    if (esErrorDeUnicidad(e)) {
      const carrera = await proveedorConCuit(actor.db, valores.cuit);
      return carrera ? fracaso("CUIT_REPETIDO", mensajeCuitDuplicado(carrera)) : fracaso("CODIGO_REPETIDO", "Colisión generando el código del proveedor — reintentá.");
    }
    throw e;
  }
}
