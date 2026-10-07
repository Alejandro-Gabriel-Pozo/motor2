import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { esErrorDeUnicidad } from "@/core/catalogo/public-servidor";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { exito, fracaso, type ResultadoCaso } from "@/core/resultado-caso";
import { insertarRol } from "@/server/persistencia/permisos/roles";

type ResultadoCrearRol = ResultadoCaso<{ rolId: string }, "NOMBRE_TOMADO">;

/**
 * Caso de uso «crear un rol» (equivalente de crearRolDesdePanel, Core.js:968-983; Hito 3, Fase I, I.2 de `docs/plan-hito-3-pureza.md`). Es el cuerpo que antes
 * vivía en línea en la Server Action `crearRol` (`src/server/actions/permisos/roles.ts`), movido TAL CUAL: mismas consultas, mismo orden, mismos mensajes. La
 * Server Action quedó como adaptador (`conEdicionDePermisos("gestion_roles")` → `guardComandoCrearRol` → este caso de uso → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea el permiso ni la política de plataforma (eso ya lo hizo `conEdicionDePermisos`)
 * ni el nombre (`guardComandoCrearRol`, `core/features/permisos/rol.guard.ts`): recibe el nombre ya normalizado y aceptado. Escribe `Rol` por
 * `server/persistencia/permisos/roles.ts`, y solo se lo llama dentro de `conEdicionDePermisos` (contrato C5, modo ii de `escrituras-de-permisos-por-politica`).
 *
 * Orden, igual que antes: (1) «Ya existe el rol» si otro rol ya usa ese nombre (con `actor.db`, fuera de la transacción); (2) en UNA transacción, el alta y
 * su auditoría; (3) si dos altas con el mismo nombre se cruzan, la unicidad de la base frena a la segunda y se devuelve el mismo «Ya existe el rol».
 *
 * @contract Da de alta un rol con el nombre pedido (sin clave: es un rol de la empresa, no de sistema) junto con su registro de auditoría.
 * @idempotency No aplica — repetir el pedido devuelve «Ya existe el rol» (el nombre es único: lo frena la lectura previa o, en una carrera, la unicidad de la base).
 * @transaction `actor.transaccion` (READ COMMITTED, la del contexto): alta y auditoría juntas. La búsqueda del nombre queda fuera, como antes.
 * @sideEffects registrarCambioAuditado (Rol.nombre: alta, de null al nombre). Sin efectos externos.
 * @ficha permiso=gestion_roles transaccion=SIMPLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function crearRolCasoDeUso(actor: Pick<ContextoUsuario, "usuarioId" | "db" | "transaccion">, comando: { nombre: string }): Promise<ResultadoCrearRol> {
  const n = comando.nombre;
  const existente = await actor.db.rol.findFirst({ where: { nombre: n } });
  if (existente) return fracaso("NOMBRE_TOMADO", `Ya existe el rol "${n}".`);

  let rolId: string;
  try {
    rolId = await actor.transaccion(async (tx) => {
      const rol = await insertarRol(tx, { nombre: n });
      await registrarCambioAuditado(tx, {
        entidad: "Rol", entidadId: rol.id, campo: "nombre", descripcion: `Rol "${n}": alta`,
        valorAnterior: null, valorNuevo: n, actorId: actor.usuarioId,
      });
      return rol.id;
    });
  } catch (e) {
    if (esErrorDeUnicidad(e)) return fracaso("NOMBRE_TOMADO", `Ya existe el rol "${n}".`);
    throw e;
  }
  return exito(`Rol "${n}" creado.`, { rolId });
}
