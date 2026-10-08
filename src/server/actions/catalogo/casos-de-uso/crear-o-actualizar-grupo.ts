import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoCrearOActualizarGrupo, ResultadoCrearOActualizarGrupo } from "@/core/features/catalogo/insumos.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { creariaCiclo } from "@/server/lecturas/catalogo/grupos";
import { crearGrupoNuevo, fijarPadreDeGrupo } from "@/server/persistencia/catalogo/grupos";

/**
 * Caso de uso «crear un grupo de insumos, o cambiarle el padre si ya existe uno con ese nombre» (equivalente de crearOActualizarGrupo/actualizarGrupoPadre_,
 * Catalogo.js:2483-2519, con la misma validación de ciclo; Hito 4 de la pureza, bloque 4.3, paso H4C-9 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes
 * vivía en línea en la Server Action `crearOActualizarGrupo` (`src/server/actions/catalogo/insumos.ts`), movido TAL CUAL: busca el grupo por nombre sin distinguir
 * mayúsculas con la base del contexto; si existe, mira que el padre no cree un ciclo y le cambia el padre; si no, lo crea (un grupo recién creado nunca puede
 * formar un ciclo consigo mismo: su id todavía no existe). Escrituras en server/persistencia/catalogo/grupos.ts, sin transacción ni auditoría, como antes. La
 * Server Action quedó como adaptador (`conPermisoDeEmpresa("grupos_familia")` → `guardComandoCrearOActualizarGrupo` → este caso de uso →
 * `refrescarVistaSiHaceFalta` si salió bien → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato del nombre (el guard).
 *
 * @contract Deja un grupo con ese nombre y ese padre (el existente, con el padre nuevo, o uno nuevo), salvo que el padre cree un ciclo.
 * @idempotency Por estado — repetir el pedido encuentra el grupo ya creado y le vuelve a escribir el mismo padre: no crea otro.
 * @transaction Ninguna: lecturas y una escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (un grupo no es plata: sin auditoría). El refresco de la vista lo hace la Server Action.
 * @ficha permiso=grupos_familia transaccion=NINGUNA idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function crearOActualizarGrupoCasoDeUso(actor: Pick<ContextoUsuario, "db">, comando: ComandoCrearOActualizarGrupo): Promise<ResultadoCrearOActualizarGrupo> {
  const { nombre: n, grupoPadreId } = comando;
  const existente = await actor.db.grupo.findFirst({ where: { nombre: { equals: n, mode: "insensitive" } } });

  if (existente) {
    if (grupoPadreId && (await creariaCiclo(existente.id, grupoPadreId, actor.db))) {
      return fracaso("CREARIA_CICLO", `Ese padre ya desciende de "${n}", o es el mismo grupo — crearía un ciclo.`);
    }
    await fijarPadreDeGrupo(actor.db, { id: existente.id, grupoPadreId });
    return exito(`Grupo "${n}" actualizado.`, null);
  }

  const creado = await crearGrupoNuevo(actor.db, { nombre: n, grupoPadreId });
  return exito(`Grupo "${creado.nombre}" creado.`, null);
}
