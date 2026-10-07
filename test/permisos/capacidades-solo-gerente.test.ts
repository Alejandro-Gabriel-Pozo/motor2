import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { mensajeSiNoPuedeCambiarCapacidades } from "../../src/core/permisos/matriz";
import { requierePermisoDeEmpresa } from "../../src/server/acceso/gate";
import { actualizarCapacidad } from "../../src/server/actions/permisos/capacidades-sucursal";

/**
 * O.41 (decisión del dueño del 2026-10-08, «esa perilla solo del gerente»; ADR-027, «Casos que D13/D14 deja abiertos»): cambiar una capacidad por sucursal es
 * SOLO del gerente de la empresa. Hasta acá un administrador que no era el gerente, con `capacidades_sucursal`, apagaba por sucursal (o en la fila default)
 * acciones de gobierno de piso administrador —`renombrar_rol`, `alta_sucursal`, `activar_sucursal`, `renombrar_sucursal`, `ver_auditoria`— y con eso se las
 * sacaba también al gerente, que usa el mismo rol (`decision-de-acceso.ts` aplica la capacidad a las acciones de empresa de piso no gerente). Es la vía hermana
 * de la que cerró D13/D14 (`matriz-del-admin-solo-gerente.test.ts`).
 *
 * La regla es pura (`core/permisos/matriz.ts`) y la aplica el caso de uso `actualizarCapacidad`, con quien actúa leído de la base dentro de la transacción y
 * antes de escribir. El permiso de la pantalla (`capacidades_sucursal`) y el envoltorio no cambian: la matriz de acceso queda igual.
 */
const MENSAJE = "Solo el gerente de la empresa puede cambiar las capacidades de una sucursal. No se guardó nada.";

describe("O.41, la regla pura", () => {
  it("rechaza al administrador y al operario; deja al gerente", () => {
    expect(mensajeSiNoPuedeCambiarCapacidades({ rolEmpresa: null, esAdminEnElContexto: true })).toBe(MENSAJE);
    expect(mensajeSiNoPuedeCambiarCapacidades({ rolEmpresa: "usuario", esAdminEnElContexto: true })).toBe(MENSAJE);
    expect(mensajeSiNoPuedeCambiarCapacidades({ rolEmpresa: null, esAdminEnElContexto: false })).toBe(MENSAJE);
    expect(mensajeSiNoPuedeCambiarCapacidades({ rolEmpresa: "gerente", esAdminEnElContexto: true })).toBeNull();
  });
});

describe("O.41 por la Server Action, contra Postgres", () => {
  let base: Awaited<ReturnType<typeof sembrarBase>>;
  let admin: { id: string; email: string };
  let gerente: { id: string; email: string };

  const foto = async () => ({
    capacidades: await prisma.capacidadSucursal.findMany({ orderBy: { id: "asc" } }),
    auditoria: await prisma.registroAuditoria.count({ where: { entidad: "CapacidadSucursal" } }),
  });
  const actuarComo = (u: { id: string; email: string }) => mockearUsuarioActual({ id: u.id, email: u.email, nombre: null });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    base = await sembrarBase();
    admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    gerente = await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: gerente.id, empresaId: EMPRESA_POR_DEFECTO_ID } }, data: { rolEmpresa: "gerente" } });
  });
  afterEach(() => __setCookieDeTestParaSucursal(undefined));

  it("un administrador que no es el gerente NO apaga una acción de gobierno: rechazo, no cambia nada (ni la fila ni la auditoría) y el gerente la conserva", async () => {
    await actuarComo(admin);
    const antes = await foto();
    expect(await actualizarCapacidad("alta_sucursal", base.sucursal.id, false)).toEqual({ ok: false, mensaje: MENSAJE });
    expect(await actualizarCapacidad("ver_auditoria", null, false)).toEqual({ ok: false, mensaje: MENSAJE });
    expect(await foto()).toEqual(antes);
    expect((await requierePermisoDeEmpresa(gerente.id, EMPRESA_POR_DEFECTO_ID, "alta_sucursal", prisma)).ok).toBe(true);
  });

  it("el gerente sí cambia una capacidad, con su auditoría", async () => {
    await actuarComo(gerente);
    const r = await actualizarCapacidad("proceso_venta", base.sucursal.id, false);
    expect(r.ok, r.mensaje).toBe(true);
    expect((await prisma.capacidadSucursal.findFirstOrThrow({ where: { accionClave: "proceso_venta", sucursalId: base.sucursal.id } })).habilitado).toBe(false);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "CapacidadSucursal", actorId: gerente.id } })).toBe(1);
  });

  it("control: lo que apagó el gerente sigue apagado después del rechazo al administrador (no lo vuelve a prender)", async () => {
    await actuarComo(gerente);
    expect((await actualizarCapacidad("proceso_venta", base.sucursal.id, false)).ok).toBe(true);
    await actuarComo(admin);
    const antes = await foto();
    expect(await actualizarCapacidad("proceso_venta", base.sucursal.id, true)).toEqual({ ok: false, mensaje: MENSAJE });
    expect(await foto()).toEqual(antes);
    expect((await prisma.capacidadSucursal.findFirstOrThrow({ where: { accionClave: "proceso_venta", sucursalId: base.sucursal.id } })).habilitado).toBe(false);
  });
});
