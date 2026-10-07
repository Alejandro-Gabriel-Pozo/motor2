import "server-only";
import { filtroRolAdmin } from "@/core/permisos/filtros";
import type { Db } from "@/lib/db-tipos";
import { obtenerGerenteDeEmpresa } from "@/server/lecturas/permisos/gerencia";
import { darAdminAlPrimerGerente, darLaGerenciaAlPrimerGerente } from "@/server/persistencia/auth/gerencia";

/**
 * PASO COMPARTIDO (sin ficha: no lo importa ninguna Server Action; lo compone el caso de uso `aceptar-invitacion-de-gerente.ts` de esta carpeta) — Hito 3, Fase II,
 * II.5 de `docs/plan-hito-3-pureza.md`. Es `incorporarPrimerGerente`, que vivía en `core/permisos/gerencia.ts`, con el MISMO nombre, la misma firma, las mismas
 * lecturas en el mismo orden y los mismos mensajes; sus dos escrituras pasaron a `server/persistencia/auth/gerencia.ts` (`darLaGerenciaAlPrimerGerente`,
 * `darAdminAlPrimerGerente`), en el mismo orden. Lo usan, además, el seed (`prisma/seed.ts`, que corre con `--conditions=react-server`) y, directo, la huella de
 * aceptación y la de gobierno (por su adaptador) y `test/persistencia/aceptar-invitacion-de-usuario.test.ts`.
 *
 * El primer gerente de una empresa que nació en alta (E5, ADR-020): recibe la gerencia y el rol admin en la primera sucursal activa. Es el único camino que
 * crea un gerente sin que haya uno anterior; si la empresa ya tiene gerente no hace nada y avisa (el índice único parcial lo frenaría igual). Corre DENTRO
 * de la transacción de la aceptación de la invitación, con la empresa fijada. Devuelve el id de la membresía de sucursal creada, para auditarla. NO audita:
 * la auditoría la escribe quien lo invoca.
 */
export async function incorporarPrimerGerente(
  tx: Db,
  input: { empresaId: string; usuarioId: string },
): Promise<{ ok: true; sucursalId: string; sucursalNombre: string; membresiaId: string } | { ok: false; mensaje: string }> {
  const { empresaId, usuarioId } = input;
  if (await obtenerGerenteDeEmpresa(tx, empresaId)) return { ok: false, mensaje: "Esta empresa ya tiene gerente." };
  const sucursal = await tx.sucursal.findFirst({ where: { empresaId, activo: true }, orderBy: { creadoEn: "asc" }, select: { id: true, nombre: true } });
  const rolAdmin = await tx.rol.findFirst({ where: { ...filtroRolAdmin(empresaId), activo: true }, select: { id: true } });
  if (!sucursal || !rolAdmin) return { ok: false, mensaje: "La empresa todavía no tiene sucursal o rol de administración: avisá a la plataforma." };

  await darLaGerenciaAlPrimerGerente(tx, { usuarioId, empresaId });
  const membresia = await darAdminAlPrimerGerente(tx, { usuarioId, empresaId, sucursalId: sucursal.id, rolId: rolAdmin.id });
  return { ok: true, sucursalId: sucursal.id, sucursalNombre: sucursal.nombre, membresiaId: membresia.id };
}
