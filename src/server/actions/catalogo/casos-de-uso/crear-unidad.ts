import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoCrearUnidad, ResultadoCrearUnidad } from "@/core/features/catalogo/unidades.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { crearUnidadNueva } from "@/server/persistencia/catalogo/unidades";

/**
 * Caso de uso «crear una unidad de medida» (Hito 4 de la pureza, bloque 4.3, paso H4C-8 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en línea en
 * la Server Action `crearUnidad` (`src/server/actions/catalogo/unidades.ts`), movido TAL CUAL: busca una unidad con ese nombre sin distinguir mayúsculas con la base
 * del contexto (si existe, se rechaza) y la crea (escritura en server/persistencia/catalogo/unidades.ts). Sin transacción ni auditoría, como antes: el alta no tiene
 * valor anterior ni cantidades que ya dependan de ella (cada cambio posterior de los decimales lo audita `actualizarDecimalesUnidadCasoDeUso`). La Server Action
 * quedó como adaptador (`conPermisoDeEmpresa("unidades")` → `guardComandoCrearUnidad` → este caso de uso → `refrescarVistaSiHaceFalta` si salió bien →
 * `aResultadoAccion` y el id y el nombre para su `ResultadoConId`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato (el guard).
 *
 * @contract Crea la unidad con ese nombre, magnitud y decimales, salvo que ya exista una con el mismo nombre; devuelve su id y su nombre.
 * @idempotency Por estado — repetir el pedido encuentra la unidad ya creada y se rechaza («Ya existe una unidad llamada…»): no crea otra.
 * @transaction Ninguna: una lectura y una escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (el alta no se audita: excepción `crearUnidadNueva` de escrituras-auditadas). El refresco de la vista lo hace la Server Action.
 * @ficha permiso=unidades transaccion=NINGUNA idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function crearUnidadCasoDeUso(actor: Pick<ContextoUsuario, "db">, comando: ComandoCrearUnidad): Promise<ResultadoCrearUnidad> {
  const { nombre, magnitud, decimales } = comando;
  const existente = await actor.db.unidad.findFirst({ where: { nombre: { equals: nombre, mode: "insensitive" } } });
  if (existente) return fracaso("YA_EXISTE", `Ya existe una unidad llamada "${nombre}".`);

  const creada = await crearUnidadNueva(actor.db, { nombre, magnitud, decimales });
  return exito(`Unidad "${creada.nombre}" creada.`, { id: creada.id, nombre: creada.nombre });
}
