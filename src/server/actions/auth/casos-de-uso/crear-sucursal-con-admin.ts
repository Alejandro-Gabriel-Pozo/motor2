import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { productosUniversales, type FilaDisponibilidadEnSucursal } from "@/core/catalogo/public";
import type { ComandoCrearSucursal } from "@/core/features/sucursales/sucursal.guard";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { actorEnLaEmpresa, buscarRolAdmin, mensajeSiReactivaAdminSinSerGerente, reactivaAUnAdmin } from "@/core/permisos/gestion-de-usuarios";
import { conInvariantesDeGobierno } from "@/core/permisos/invariantes";
import { exito, fracaso, type ResultadoCaso } from "@/core/resultado-caso";
import { crearSucursal, sembrarDisponibilidadDeSucursalNueva } from "@/server/persistencia/auth/sucursales";
import { crearMembresiaEnSucursal, reactivarCuentaEnEmpresa } from "@/server/persistencia/permisos/membresias";
import { conGobierno } from "../../con-gobierno";

type ResultadoCrearSucursal = ResultadoCaso<
  { sucursalId: string },
  "NOMBRE_TOMADO" | "SIN_ROL_ADMIN" | "NO_ES_DE_LA_EMPRESA" | "REACTIVA_ADMIN_SIN_SER_GERENTE" | "INVARIANTE_DE_GOBIERNO"
>;

/**
 * Caso de uso «crear una sucursal con su primer admin» (Hito 3, Fase I, I.4 de `docs/plan-hito-3-pureza.md`). Acción nueva respecto de Apps Script (ver plan,
 * «Bootstrap de admin sin hueco de seguridad», punto 2): reemplaza el paso manual de crear-contenedor.js por una acción del sistema, exclusiva de un admin ya
 * existente, que crea la sucursal Y asigna su primer admin en la MISMA transacción — nunca queda una sucursal sin ningún admin. Es el cuerpo que antes vivía en
 * línea en la Server Action `crearSucursalConAdmin` (`src/server/actions/auth/sucursales.ts`), movido TAL CUAL: mismas consultas, mismo orden, mismos mensajes,
 * mismas lecturas dentro y fuera de la transacción. La Server Action quedó como adaptador (`conPermisoDeEmpresa("alta_sucursal")` → `guardComandoCrearSucursal`
 * → este caso de uso → refresco de la vista → `aResultadoAccion`).
 *
 * Orden, igual que antes:
 *  1. «Ya existe una sucursal» si el nombre está tomado en la empresa (con `actor.db`, fuera de la transacción).
 *  2. La disponibilidad inicial (decisión 4 del dueño, 2026-09-23, docs/plan-disponibilidad-por-sucursal-2026-09-23.md §10): la sucursal nueva arranca SOLO con
 *     los productos que ya son «universales» — disponibles en TODAS las sucursales activas de hoy, sin excepción; nunca con los que son mayoría pero no
 *     unanimidad. Se resuelve ANTES de la transacción (lectura pura, no hace falta el aislamiento) y con `sucursalIdsActivas` vacío (la primerísima sucursal
 *     del sistema) `productosUniversales` da siempre `[]`: arranca en cero, no en «todos».
 *  3. En la transacción de gobierno (`conGobierno`, serializable con reintento) y midiendo las invariantes antes y después (`conInvariantesDeGobierno`): el rol
 *     admin de la empresa (por su clave), la persona por su email y su cuenta en la empresa —E8 (ADR-024): la sucursal nace con un admin que YA es parte de la
 *     empresa; a alguien nuevo primero se lo invita desde Usuarios—, y si nombrarlo reactivaría a un admin apagado, eso es solo del gerente (mismo criterio que
 *     `usuarios.ts`). Después las escrituras (sucursal, cuenta reactivada, membresía con el rol admin, disponibilidad) con sus tres auditorías.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. Escribe por `server/persistencia/auth/sucursales.ts` y `server/persistencia/permisos/membresias.ts`.
 *
 * @contract Crea la sucursal y deja a una persona que ya es de la empresa como su primer admin (con su cuenta de empresa activa), con los productos universales disponibles, todo o nada.
 * @idempotency No aplica — repetir el pedido devuelve «Ya existe una sucursal» (el nombre de la sucursal arbitra el reintento); no hay clave I3.
 * @transaction conGobierno (conTransaccionSerializable con reintento) + conInvariantesDeGobierno alrededor de las altas; una invariante violada vuelve como fracaso INVARIANTE_DE_GOBIERNO.
 * @sideEffects registrarCambioAuditado (Sucursal.activo: alta; UsuarioEmpresa.activo; UsuarioSucursal.rol). La disponibilidad inicial (DisponibilidadProducto) va en la misma transacción. El refresco de la vista lo hace la Server Action.
 * @ficha permiso=alta_sucursal transaccion=SERIALIZABLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function crearSucursalConAdminCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "empresaId" | "rolEmpresa" | "membresias" | "db" | "transaccion">,
  comando: ComandoCrearSucursal,
): Promise<ResultadoCrearSucursal> {
  const { nombre, email } = comando;
  const existente = await actor.db.sucursal.findFirst({ where: { empresaId: actor.empresaId, nombre } });
  if (existente) return fracaso("NOMBRE_TOMADO", `Ya existe una sucursal "${nombre}".`);

  const sucursalIdsActivas = (await actor.db.sucursal.findMany({ where: { empresaId: actor.empresaId, activo: true }, select: { id: true } })).map((s) => s.id);
  const filasDisponibilidad = sucursalIdsActivas.length
    ? await actor.db.disponibilidadProducto.findMany({ where: { sucursalId: { in: sucursalIdsActivas } }, select: { productoId: true, sucursalId: true, disponible: true } })
    : [];
  const disponibilidadPorProducto = new Map<string, FilaDisponibilidadEnSucursal[]>();
  for (const f of filasDisponibilidad) {
    const lista = disponibilidadPorProducto.get(f.productoId) ?? [];
    lista.push(f);
    disponibilidadPorProducto.set(f.productoId, lista);
  }
  const universales = productosUniversales(disponibilidadPorProducto, sucursalIdsActivas);

  const resultado = await conGobierno(
    actor,
    (tx) =>
      conInvariantesDeGobierno(tx, actor.empresaId, async (): Promise<ResultadoCrearSucursal> => {
        const rolAdmin = await buscarRolAdmin(tx, actor.empresaId);
        if (!rolAdmin || !rolAdmin.activo) {
          return fracaso("SIN_ROL_ADMIN", "No se encontró el rol de administrador de la empresa (¿corriste el seed?) — no se puede asignar el primer admin.");
        }

        // Nombrar primer admin a alguien cuya cuenta en la empresa está apagada la reactivaría: si fue admin, eso es solo del gerente (mismo criterio que `usuarios.ts`).
        const usuarioPrevio = await tx.user.findUnique({ where: { email }, select: { id: true } });
        const pertenenciaPrevia = usuarioPrevio
          ? await tx.usuarioEmpresa.findUnique({ where: { usuarioId_empresaId: { usuarioId: usuarioPrevio.id, empresaId: actor.empresaId } }, select: { activo: true } })
          : null;
        // E8 (ADR-024): la sucursal nace con un admin que YA es parte de la empresa. A alguien nuevo no se lo da de alta acá (no hay User ni membresía hasta que acepte una invitación):
        // primero se lo invita desde Usuarios. Así tampoco existe nunca una sucursal sin administrador.
        if (!usuarioPrevio || !pertenenciaPrevia) {
          return fracaso(
            "NO_ES_DE_LA_EMPRESA",
            `"${email}" todavía no forma parte de la empresa. Creá la sucursal con vos o con un administrador que ya esté en la empresa y después invitá a "${email}" desde Usuarios.`
          );
        }
        const reactivaAdmin = await reactivaAUnAdmin(tx, actor.empresaId, usuarioPrevio.id, { cuentaDeEmpresa: pertenenciaPrevia });
        const rechazoReactivar = mensajeSiReactivaAdminSinSerGerente(actorEnLaEmpresa(actor), reactivaAdmin);
        if (rechazoReactivar) return fracaso("REACTIVA_ADMIN_SIN_SER_GERENTE", rechazoReactivar);

        const sucursal = await crearSucursal(tx, { nombre, empresaId: actor.empresaId });
        await reactivarCuentaEnEmpresa(tx, { usuarioId: usuarioPrevio.id, empresaId: actor.empresaId });
        const membresia = await crearMembresiaEnSucursal(tx, {
          usuarioId: usuarioPrevio.id,
          sucursalId: sucursal.id,
          empresaId: actor.empresaId,
          rolId: rolAdmin.id,
          notas: "Alta automática al crear la sucursal.",
        });
        await registrarCambioAuditado(tx, {
          entidad: "Sucursal", entidadId: sucursal.id, campo: "activo", descripcion: `Sucursal "${nombre}": alta`,
          valorAnterior: null, valorNuevo: true, actorId: actor.usuarioId, sucursalId: null,
        });
        await registrarCambioAuditado(tx, {
          entidad: "UsuarioEmpresa", entidadId: usuarioPrevio.id, campo: "activo", descripcion: `Cuenta de "${email}" en la empresa`,
          valorAnterior: pertenenciaPrevia.activo, valorNuevo: true, actorId: actor.usuarioId, sucursalId: null,
        });
        await registrarCambioAuditado(tx, {
          entidad: "UsuarioSucursal", entidadId: membresia.id, campo: "rol", descripcion: `Usuario "${email}" en la sucursal "${nombre}": rol`,
          valorAnterior: null, valorNuevo: rolAdmin.nombre, actorId: actor.usuarioId, sucursalId: sucursal.id,
        });
        if (universales.length) {
          await sembrarDisponibilidadDeSucursalNueva(tx, { sucursalId: sucursal.id, empresaId: actor.empresaId, productoIds: universales });
        }
        return exito("", { sucursalId: sucursal.id });
      }),
    (mensaje) => fracaso("INVARIANTE_DE_GOBIERNO", mensaje),
  );
  if (!resultado.ok) return resultado;
  return exito(`Sucursal "${nombre}" creada, con "${email}" como primer admin.`, resultado.datos);
}
