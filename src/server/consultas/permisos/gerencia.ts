import "server-only";
import type { Db } from "@/lib/db-tipos";
import { filtroAdminEfectivo } from "@/core/permisos/filtros";
import { ROL_EMPRESA_GERENTE } from "@/core/permisos/rol-empresa";

/**
 * Lecturas de Administración › Gerencia para los Server Components (Hito 3, Fase I, I.5d' de `docs/plan-hito-3-pureza.md`: antes vivía en
 * `core/permisos/gerencia.ts`). Mismo contrato que el resto de `server/consultas`: `server-only`, sin `"use server"`, sin guarda de permiso adentro (la página
 * hace `requierePermisoVerDeEmpresa(…, "traspasar_gerencia", …)` antes; sin cambios de permiso), `db: Db` primero, devuelve exactamente lo mismo que antes.
 */

/**
 * Quiénes pueden recibir la gerencia: las mismas condiciones que el traspaso exige al destino (`transferirGerenciaDeEmpresa`, el paso compartido de
 * `server/actions/auth/casos-de-uso/transferir-gerencia-en-tx.ts`: pertenencia y cuenta activas, admin efectivo en alguna sucursal —el MISMO predicado que la
 * validación, `filtroAdminEfectivo`—) y que no sea ya el gerente. Alimenta el selector de la pantalla de traspaso; el traspaso vuelve a validar.
 */
export async function listarCandidatosAGerente(db: Db, empresaId: string) {
  const filas = await db.usuarioEmpresa.findMany({
    where: {
      empresaId,
      activo: true,
      OR: [{ rolEmpresa: null }, { rolEmpresa: { not: ROL_EMPRESA_GERENTE } }],
      usuario: { activoGlobal: true, sucursales: { some: filtroAdminEfectivo(empresaId) } },
    },
    select: { usuarioId: true, usuario: { select: { email: true, name: true } } },
    orderBy: { usuario: { email: "asc" } },
  });
  return filas.map((f) => ({ id: f.usuarioId, email: f.usuario.email, nombre: f.usuario.name }));
}
