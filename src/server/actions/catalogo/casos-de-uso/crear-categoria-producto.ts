import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoCrearCategoriaProducto, ResultadoCrearCategoriaProducto } from "@/core/features/catalogo/categorias-producto.schema";
import { exito } from "@/core/resultado-caso";
import { crearCategoriaNueva } from "@/server/persistencia/catalogo/categorias-producto";

/**
 * Caso de uso «crear (o reusar) una categoría de producto» (equivalente de crearCategoriaDesdePanel/crearCategoria_, Catalogo.js:3054-3076; Hito 4 de la pureza,
 * bloque 4.3, paso H4C-7 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en línea en la Server Action `crearCategoriaProducto`
 * (`src/server/actions/catalogo/categorias-producto.ts`), movido TAL CUAL: busca una categoría con ese nombre sin distinguir mayúsculas con la base del contexto y,
 * si existe, la reusa («— se reusa.»); si no, la crea (escritura en server/persistencia/catalogo/categorias-producto.ts). Sin transacción ni auditoría, como antes.
 * La Server Action quedó como adaptador (`conPermisoDeEmpresa("categoria_alta")` → `guardComandoCrearCategoriaProducto` → este caso de uso → `aResultadoAccion` y
 * el id y el nombre de la categoría para su `ResultadoConId`).
 *
 * NO pide el refresco de la vista (la acción tampoco): la llaman DOS flujos y a uno le sobraría — la pantalla de Categorías (closure "use server" de la página, que
 * sí lo pide ahí) y el alta rápida inline del formulario de Producto (ver la regla en refrescar.ts).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato del nombre (el guard).
 *
 * @contract Deja una categoría con ese nombre (la existente o una nueva) y devuelve su id y su nombre.
 * @idempotency Por estado — repetir el pedido encuentra la categoría ya creada y la reusa: no crea otra.
 * @transaction Ninguna: una lectura y, si hace falta, una escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (una categoría no es plata: sin auditoría).
 * @ficha permiso=categoria_alta transaccion=NINGUNA idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function crearCategoriaProductoCasoDeUso(actor: Pick<ContextoUsuario, "db">, comando: ComandoCrearCategoriaProducto): Promise<ResultadoCrearCategoriaProducto> {
  const n = comando.nombre;
  const existente = await actor.db.categoriaProducto.findFirst({ where: { nombre: { equals: n, mode: "insensitive" } } });
  if (existente) return exito(`Ya existía la categoría "${existente.nombre}" — se reusa.`, { id: existente.id, nombre: existente.nombre });

  const creada = await crearCategoriaNueva(actor.db, { nombre: n });
  return exito(`Categoría "${creada.nombre}" creada.`, { id: creada.id, nombre: creada.nombre });
}
