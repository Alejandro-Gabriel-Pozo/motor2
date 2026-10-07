import type { Db } from "@/lib/db-tipos";
import { esAdminEfectivoEnAlgunaSucursal, membresiaDeAdminEfectivo } from "./invariantes";
import { CLAVE_ROL_ADMIN } from "./jerarquia";
import { filtroDelGerente } from "./filtros";
import { ROL_EMPRESA_GERENTE } from "./rol-empresa";

export type ResultadoGerencia = { ok: true; mensaje: string; gerenteAnteriorId: string | null } | { ok: false; mensaje: string };

/** El gerente de la empresa (a lo sumo uno: lo garantiza el índice único parcial de `20261001240000_gerente_unico_indice`). */
export async function obtenerGerenteDeEmpresa(db: Db, empresaId: string) {
  return db.usuarioEmpresa.findFirst({ where: filtroDelGerente(empresaId), select: { id: true, usuarioId: true, activo: true } });
}

/** Tiene (o tuvo) el rol admin en alguna sucursal de la empresa, activa o no: la cuenta de alguien así la reactiva solo el gerente. */
export async function tuvoRolAdminEnLaEmpresa(db: Db, empresaId: string, usuarioId: string): Promise<boolean> {
  return Boolean(await db.usuarioSucursal.findFirst({ where: { empresaId, usuarioId, rol: { clave: CLAVE_ROL_ADMIN } }, select: { id: true } }));
}

/**
 * Apagar `sucursalId` deja sin contexto (core/auth/contexto.ts, que solo cuenta membresías de sucursales activas) a un gerente que no
 * tenga otra membresía activa en OTRA sucursal activa: la empresa quedaría sin quien la gestione. Devuelve los emails de esos gerentes.
 */
export async function gerentesQueQuedaranSinSucursalActiva(db: Db, empresaId: string, sucursalId: string): Promise<string[]> {
  const gerentes = await db.usuarioEmpresa.findMany({
    where: { empresaId, rolEmpresa: ROL_EMPRESA_GERENTE, activo: true },
    select: { usuarioId: true, usuario: { select: { email: true } } },
  });
  const sinSucursal: string[] = [];
  for (const g of gerentes) {
    const otra = await db.usuarioSucursal.findFirst({
      where: { empresaId, usuarioId: g.usuarioId, activo: true, sucursalId: { not: sucursalId }, sucursal: { activo: true } },
      select: { id: true },
    });
    if (!otra) sinSucursal.push(g.usuario.email);
  }
  return sinSucursal;
}

/**
 * Quiénes pueden recibir la gerencia: las mismas condiciones que `transferirGerenciaDeEmpresa` exige al destino (pertenencia y cuenta activas,
 * admin efectivo en alguna sucursal: el MISMO predicado que la validación, `membresiaDeAdminEfectivo`) y que no sea ya el gerente. Alimenta el selector de la pantalla de traspaso; el traspaso vuelve a validar.
 */
export async function listarCandidatosAGerente(db: Db, empresaId: string) {
  const filas = await db.usuarioEmpresa.findMany({
    where: {
      empresaId,
      activo: true,
      OR: [{ rolEmpresa: null }, { rolEmpresa: { not: ROL_EMPRESA_GERENTE } }],
      usuario: { activoGlobal: true, sucursales: { some: membresiaDeAdminEfectivo(empresaId) } },
    },
    select: { usuarioId: true, usuario: { select: { email: true, name: true } } },
    orderBy: { usuario: { email: "asc" } },
  });
  return filas.map((f) => ({ id: f.usuarioId, email: f.usuario.email, nombre: f.usuario.name }));
}

/**
 * Pasa la gerencia de la empresa a `usuarioDestinoId`: el gerente actual deja de serlo y el destino lo es, en un solo paso. La empresa
 * nunca queda sin gerente ni con dos: la baja del actual es condicional («sigue siendo el gerente»), así que dos traspasos simultáneos
 * no pueden aplicarse los dos. Corre DENTRO de una transacción (`ctx.transaccion`), con el cliente `tx`.
 *
 * Quién puede pedirlo se decide afuera: el gerente actual (`transferirGerencia`) o la plataforma. El destino tiene que ser alguien de la
 * empresa, con cuenta y pertenencia activas y admin activo en alguna sucursal (el gerente está por encima del admin: no se salta el escalón).
 */
export async function transferirGerenciaDeEmpresa(tx: Db, input: { empresaId: string; usuarioDestinoId: string }): Promise<ResultadoGerencia> {
  const { empresaId, usuarioDestinoId } = input;

  const destino = await tx.usuarioEmpresa.findUnique({
    where: { usuarioId_empresaId: { usuarioId: usuarioDestinoId, empresaId } },
    select: { id: true, activo: true, rolEmpresa: true, usuario: { select: { email: true, activoGlobal: true } } },
  });
  if (!destino) return { ok: false, mensaje: "Ese usuario no pertenece a esta empresa." };
  if (destino.rolEmpresa === ROL_EMPRESA_GERENTE) return { ok: false, mensaje: "Esa persona ya es el gerente de la empresa." };
  if (!destino.activo || !destino.usuario.activoGlobal) return { ok: false, mensaje: "Esa persona tiene la cuenta desactivada: no puede ser gerente." };

  if (!(await esAdminEfectivoEnAlgunaSucursal(tx, empresaId, usuarioDestinoId))) return { ok: false, mensaje: "Para ser gerente primero tiene que ser admin activo en alguna sucursal." };

  const actual = await obtenerGerenteDeEmpresa(tx, empresaId);
  if (actual) {
    const baja = await tx.usuarioEmpresa.updateMany({ where: { id: actual.id, rolEmpresa: ROL_EMPRESA_GERENTE }, data: { rolEmpresa: null } });
    if (baja.count !== 1) return { ok: false, mensaje: "La gerencia cambió mientras tanto. Recargá la pantalla y volvé a intentar." };
  }
  await tx.usuarioEmpresa.update({ where: { id: destino.id }, data: { rolEmpresa: ROL_EMPRESA_GERENTE } });

  return { ok: true, mensaje: `«${destino.usuario.email}» es ahora el gerente de la empresa.`, gerenteAnteriorId: actual?.usuarioId ?? null };
}

/**
 * El primer gerente de una empresa que nació en alta (E5, ADR-020): recibe la gerencia y el rol admin en la primera sucursal activa. Es el único camino que
 * crea un gerente sin que haya uno anterior; si la empresa ya tiene gerente no hace nada y avisa (el índice único parcial lo frenaría igual). Corre DENTRO
 * de la transacción de la aceptación de la invitación, con la empresa fijada. Devuelve el id de la membresía de sucursal creada, para auditarla.
 */
export async function incorporarPrimerGerente(
  tx: Db,
  input: { empresaId: string; usuarioId: string },
): Promise<{ ok: true; sucursalId: string; sucursalNombre: string; membresiaId: string } | { ok: false; mensaje: string }> {
  const { empresaId, usuarioId } = input;
  if (await obtenerGerenteDeEmpresa(tx, empresaId)) return { ok: false, mensaje: "Esta empresa ya tiene gerente." };
  const sucursal = await tx.sucursal.findFirst({ where: { empresaId, activo: true }, orderBy: { creadoEn: "asc" }, select: { id: true, nombre: true } });
  const rolAdmin = await tx.rol.findFirst({ where: { empresaId, clave: CLAVE_ROL_ADMIN, activo: true }, select: { id: true } });
  if (!sucursal || !rolAdmin) return { ok: false, mensaje: "La empresa todavía no tiene sucursal o rol de administración: avisá a la plataforma." };

  await tx.usuarioEmpresa.upsert({
    where: { usuarioId_empresaId: { usuarioId, empresaId } },
    update: { activo: true, rolEmpresa: ROL_EMPRESA_GERENTE },
    create: { usuarioId, empresaId, rolEmpresa: ROL_EMPRESA_GERENTE },
  });
  const membresia = await tx.usuarioSucursal.upsert({
    where: { usuarioId_sucursalId: { usuarioId, sucursalId: sucursal.id } },
    update: { rolId: rolAdmin.id, activo: true },
    create: { usuarioId, sucursalId: sucursal.id, empresaId, rolId: rolAdmin.id, notas: "Alta por invitación de la plataforma." },
    select: { id: true },
  });
  return { ok: true, sucursalId: sucursal.id, sucursalNombre: sucursal.nombre, membresiaId: membresia.id };
}
