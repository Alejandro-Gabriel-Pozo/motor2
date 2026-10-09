import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoCrearInsumo, ResultadoCrearInsumo } from "@/core/features/catalogo/insumos.schema";
import { exito } from "@/core/resultado-caso";
import { crearInsumoNuevo } from "@/server/persistencia/catalogo/insumos";

/**
 * Caso de uso «crear (o reusar) un insumo» (equivalente de crearFamiliaDesdePanel/crearFamilia_, Catalogo.js:2939-2967; Hito 4 de la pureza, bloque 4.3, paso
 * H4C-9 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en línea en la Server Action `crearInsumo` (`src/server/actions/catalogo/insumos.ts`),
 * movido TAL CUAL: busca un insumo con ese nombre sin distinguir mayúsculas con la base del contexto y, si existe, lo reusa en silencio («— se reusa.»); si no, lo
 * crea (escritura en server/persistencia/catalogo/insumos.ts). Sin transacción ni auditoría, como antes. La Server Action quedó como adaptador
 * (`conPermisoDeEmpresa("insumo_alta")` → `guardComandoCrearInsumo` → este caso de uso → `aResultadoAccion` y el id y el nombre para su `ResultadoConId`).
 *
 * NO pide el refresco de la vista (la acción tampoco): la llaman TRES flujos y a dos les sobraría — la pantalla de Insumos (closure "use server" de la página, que
 * sí lo pide ahí), el alta rápida inline del formulario de Producto (QuickCrear) y el AsistenteHermanar (ver la regla en refrescar.ts).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato del nombre (el guard).
 *
 * @contract Deja un insumo con ese nombre (el existente o uno nuevo) y devuelve su id y su nombre.
 * @idempotency Por estado — repetir el pedido encuentra el insumo ya creado y lo reusa: no crea otro.
 * @transaction Ninguna: una lectura y, si hace falta, una escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (un insumo no es plata: sin auditoría).
 * @ficha permiso=insumo_alta transaccion=NINGUNA idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function crearInsumoCasoDeUso(actor: Pick<ContextoUsuario, "db">, comando: ComandoCrearInsumo): Promise<ResultadoCrearInsumo> {
  const n = comando.nombre;
  const existente = await actor.db.insumo.findFirst({ where: { nombre: { equals: n, mode: "insensitive" } } });
  if (existente) return exito(`Ya existía el insumo "${existente.nombre}" — se reusa.`, { id: existente.id, nombre: existente.nombre });

  const creado = await crearInsumoNuevo(actor.db, { nombre: n });
  return exito(`Insumo "${creado.nombre}" creado.`, { id: creado.id, nombre: creado.nombre });
}
