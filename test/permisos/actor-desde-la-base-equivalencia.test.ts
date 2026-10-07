import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearMembresia } from "../setup/membresia";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { obtenerContextoUsuario, type ContextoUsuario } from "../../src/core/auth/contexto";
import { conTransaccionSerializable } from "../../src/core/movimientos/public-servidor";
import type { PersonaParaJerarquia } from "../../src/core/permisos/jerarquia";
import { requierePermiso, requierePermisoDeEmpresa } from "../../src/server/acceso/gate";
import { actorDesdeLaBase, objetivoEnLaEmpresa } from "../../src/server/lecturas/permisos/gestion-de-usuarios";

/**
 * O35-A (O.35, «releer el actor dentro de la transacción»; `docs/plan-hito-3-pureza.md` §9): EQUIVALENCIA PRIMERO, sin cambio de comportamiento.
 *
 * Los casos de uso de gobierno (alta y cambio de rol de usuarios, activar/desactivar membresías y cuentas, notas, invitaciones, alta de sucursal) miden HOY a
 * quien actúa con lo que dice el contexto de la sesión (`ctx.rolEmpresa` y `ctx.membresias`, vía `actorEnSucursal` / `actorEnLaEmpresa`). El paso siguiente
 * (O35-B) los hace releer a quien actúa DESDE LA BASE, dentro de su transacción, con las lecturas que ya existen (`actorDesdeLaBase` para una sucursal y
 * `objetivoEnLaEmpresa` para el contexto empresa, las mismas con las que se mide a quien se toca y al otorgante de una invitación). Este archivo demuestra,
 * contra Postgres real y con el contexto armado por `obtenerContextoUsuario` de verdad, que fuera de las carreras (el contexto se arma al principio del pedido;
 * la base puede cambiar antes de que abra la transacción) las dos mediciones dan lo MISMO para los usuarios del escenario de `caracterizacion-del-acceso`:
 * administrador, gerente, operador, rol personalizado, rol apagado, dos sucursales, membresía apagada y sucursal inactiva.
 *
 * Diferencia encontrada FUERA de las carreras (se deja fijada y dicha, NO se arregla acá): el contexto solo cuenta membresías de sucursales ACTIVAS
 * (`core/auth/contexto.ts`), y la lectura de la base (`filtroMembresiaConAutoridadDeAdmin`, C1) no mira si la sucursal está activa. Para quien tiene el rol admin
 * en una sucursal INACTIVA, el contexto dice «operario» en esa sucursal (y en la empresa, si no es admin en ninguna activa) y la base dice «administrador».
 *  - En el contexto empresa no se alcanza: las acciones de gobierno de empresa (`alta_sucursal`, `apagar_cuenta_empresa`) tienen piso administrador de sistema y
 *    el gate de empresa solo cuenta membresías de sucursales activas, así que quien llega al caso de uso ya es administrador en una activa (las dos dicen lo mismo).
 *  - En una sucursal SÍ se alcanza: el gate de sucursal (`requierePermiso`) no mira si la sucursal está activa. Un administrador de una sucursal activa que también
 *    es administrador de una inactiva pasa el permiso extra de `agregarOActualizarUsuario` (o el de `invitacionGestionable`) sobre la inactiva, y ahí el techo del
 *    contexto lo mide «operario» (no puede dar el rol admin) mientras que la base lo mide «administrador» (sí puede). Al pasar a la base (O35-B) el techo queda
 *    alineado con el gate de sucursal. Se informa al dueño en el informe del paso.
 *
 * Desde O35-B los casos de uso ya no usan el contexto y `core/permisos/gestion-de-usuarios.ts` dejó de exportar `actorEnSucursal` y `actorEnLaEmpresa`: la
 * medición del contexto quedó acá, copiada TAL CUAL, como la descripción de lo que los casos de uso hacían hasta O35-A (este test sigue diciendo que pasarse a la
 * base no cambió nada fuera de las carreras, salvo la diferencia fijada).
 */
type ActorDelContexto = Pick<ContextoUsuario, "rolEmpresa" | "membresias">;

/** Lo que hacía `actorEnSucursal` (hasta O35-B): administrador en la sucursal si su membresía de esa sucursal, en el contexto, lo es. */
const actorEnSucursal = (ctx: ActorDelContexto, sucursalId: string): PersonaParaJerarquia => ({
  rolEmpresa: ctx.rolEmpresa,
  esAdminEnElContexto: ctx.membresias.some((m) => m.sucursalId === sucursalId && m.esAdmin),
});

/** Lo que hacía `actorEnLaEmpresa` (hasta O35-B): administrador en la empresa si lo es en CUALQUIER sucursal del contexto. */
const actorEnLaEmpresa = (ctx: ActorDelContexto): PersonaParaJerarquia => ({ rolEmpresa: ctx.rolEmpresa, esAdminEnElContexto: ctx.membresias.some((m) => m.esAdmin) });

type Medicion = { usuario: string; contexto: string; delCtx: PersonaParaJerarquia; deLaBase: PersonaParaJerarquia };

let s1: string;
let s2: string;
let s3: string;
const usuarios: { nombre: string; id: string; email: string }[] = [];

async function usuario(nombre: string) {
  const u = await prismaAdmin.user.create({ data: { email: `${nombre.replace(/ /g, "-")}@equivalencia.test` } });
  usuarios.push({ nombre, id: u.id, email: u.email });
  return u;
}

async function contextoDe(u: { id: string; email: string }): Promise<ContextoUsuario> {
  await mockearUsuarioActual({ id: u.id, email: u.email, nombre: null });
  const ctx = await obtenerContextoUsuario();
  if (!ctx) throw new Error(`sin contexto: ${u.email}`);
  return ctx;
}

/** Lo que el caso de uso mediría con el contexto y lo que mide la base dentro de UNA transacción serializable (la de `conGobierno`), en Central, Norte, Cerrada y la empresa. */
async function medir(u: { nombre: string; id: string; email: string }): Promise<Medicion[]> {
  const ctx = await contextoDe(u);
  return conTransaccionSerializable(ctx.transaccion, async (tx) => {
    const filas: Medicion[] = [];
    for (const [nombre, sucursalId] of [["Central", s1], ["Norte", s2], ["Cerrada", s3]] as const) {
      filas.push({ usuario: u.nombre, contexto: nombre, delCtx: actorEnSucursal(ctx, sucursalId), deLaBase: await actorDesdeLaBase(tx, ctx.empresaId, ctx.usuarioId, sucursalId) });
    }
    filas.push({ usuario: u.nombre, contexto: "empresa", delCtx: actorEnLaEmpresa(ctx), deLaBase: await objetivoEnLaEmpresa(tx, ctx.empresaId, ctx.usuarioId) });
    return filas;
  });
}

const operario = { rolEmpresa: null, esAdminEnElContexto: false };
const administrador = { rolEmpresa: null, esAdminEnElContexto: true };

describe("O35-A: el actor medido desde la base, dentro de la transacción, es el mismo que el del contexto de la sesión (fuera de las carreras)", () => {
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await limpiarBaseDeTest();
    usuarios.length = 0;
    const base = await sembrarBase();
    s1 = base.sucursal.id;
    s2 = (await prismaAdmin.sucursal.create({ data: { nombre: "Norte", empresaId: EMPRESA_POR_DEFECTO_ID } })).id;
    s3 = (await prismaAdmin.sucursal.create({ data: { nombre: "Cerrada", empresaId: EMPRESA_POR_DEFECTO_ID, activo: false } })).id;
    const especial = await prismaAdmin.rol.create({ data: { nombre: "especial", clave: null } });
    const apagado = await prismaAdmin.rol.create({ data: { nombre: "rol apagado", clave: null, activo: false } });

    const alta = async (nombre: string, membresias: { sucursalId: string; rolId: string; activo?: boolean }[]) => {
      const u = await usuario(nombre);
      ids[nombre] = u.id;
      for (const m of membresias) await crearMembresia({ usuarioId: u.id, ...m });
    };
    await alta("admin", [{ sucursalId: s1, rolId: base.admin.id }]);
    await alta("gerente", [{ sucursalId: s1, rolId: base.admin.id }]);
    await prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: ids.gerente!, empresaId: EMPRESA_POR_DEFECTO_ID } }, data: { rolEmpresa: "gerente" } });
    await alta("operador", [{ sucursalId: s1, rolId: base.operador.id }]);
    await alta("especial", [{ sucursalId: s1, rolId: especial.id }]);
    await alta("rol apagado", [{ sucursalId: s1, rolId: base.operador.id }, { sucursalId: s2, rolId: apagado.id }]);
    await alta("dos sucursales", [{ sucursalId: s1, rolId: base.operador.id }, { sucursalId: s2, rolId: base.admin.id }]);
    await alta("membresia apagada", [{ sucursalId: s1, rolId: base.operador.id }, { sucursalId: s2, rolId: base.admin.id, activo: false }]);
    await alta("sucursal inactiva", [{ sucursalId: s1, rolId: base.operador.id }, { sucursalId: s3, rolId: base.admin.id }]);
    await alta("admin y sucursal inactiva", [{ sucursalId: s1, rolId: base.admin.id }, { sucursalId: s3, rolId: base.admin.id }]);
  });

  it("para cada usuario, en cada sucursal y en la empresa: iguales salvo la sucursal inactiva (diferencia fijada abajo)", async () => {
    const mediciones: Medicion[] = [];
    for (const u of usuarios) mediciones.push(...(await medir(u))); // de a uno: la sesión simulada es una sola
    expect(mediciones).toHaveLength(usuarios.length * 4);

    const distintas = mediciones.filter((m) => JSON.stringify(m.delCtx) !== JSON.stringify(m.deLaBase));
    expect(distintas).toEqual([
      { usuario: "sucursal inactiva", contexto: "Cerrada", delCtx: operario, deLaBase: administrador },
      { usuario: "sucursal inactiva", contexto: "empresa", delCtx: operario, deLaBase: administrador },
      { usuario: "admin y sucursal inactiva", contexto: "Cerrada", delCtx: operario, deLaBase: administrador },
    ]);

    // Lo que sí coincide, a mano, para que una lectura que devolviera siempre lo mismo no pase en vacío.
    const de = (u: string, c: string) => mediciones.find((m) => m.usuario === u && m.contexto === c)!.deLaBase;
    expect(de("admin", "Central")).toEqual(administrador);
    expect(de("admin", "Norte")).toEqual(operario);
    expect(de("admin", "empresa")).toEqual(administrador);
    expect(de("gerente", "Central")).toEqual({ rolEmpresa: "gerente", esAdminEnElContexto: true });
    expect(de("gerente", "Norte")).toEqual({ rolEmpresa: "gerente", esAdminEnElContexto: false });
    expect(de("operador", "empresa")).toEqual(operario);
    expect(de("especial", "Central")).toEqual(operario);
    expect(de("rol apagado", "Norte")).toEqual(operario);
    expect(de("dos sucursales", "Central")).toEqual(operario);
    expect(de("dos sucursales", "Norte")).toEqual(administrador);
    expect(de("dos sucursales", "empresa")).toEqual(administrador);
    expect(de("membresia apagada", "Norte")).toEqual(operario);
    expect(de("membresia apagada", "empresa")).toEqual(operario);
  });

  it("la diferencia de la sucursal inactiva en el contexto EMPRESA no se alcanza: el gate de empresa no deja a ese usuario llegar a las acciones de gobierno", async () => {
    for (const accion of ["alta_sucursal", "apagar_cuenta_empresa"] as const) {
      expect((await requierePermisoDeEmpresa(ids["sucursal inactiva"]!, EMPRESA_POR_DEFECTO_ID, accion, prisma)).ok, accion).toBe(false);
    }
    // Ni las de sucursal desde su sucursal activa (Central, donde es operador): `conPermiso` evalúa la sucursal del contexto.
    for (const accion of ["gestion_usuarios", "activar_usuario_sucursal", "notas_usuario_sucursal"] as const) {
      expect((await requierePermiso(ids["sucursal inactiva"]!, s1, accion, prisma)).ok, accion).toBe(false);
    }
  });

  it("la diferencia en una SUCURSAL inactiva sí se alcanza: el gate de sucursal no mira si está activa (el permiso extra del alta de usuario sobre Cerrada pasa)", async () => {
    expect((await requierePermiso(ids["admin y sucursal inactiva"]!, s1, "gestion_usuarios", prisma)).ok).toBe(true);
    expect((await requierePermiso(ids["admin y sucursal inactiva"]!, s3, "gestion_usuarios", prisma)).ok).toBe(true);
  });
});
