import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, prisma, prismaAdmin } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { agregarSucursalAlPortal, guardarSucursalPublica, moverSucursalEnMapa, quitarSucursalDelPortal } from "../../src/server/actions/carta/registro-publico";
import { actualizarCapacidad } from "../../src/server/actions/permisos/capacidades-sucursal";
import { guardarMargenObjetivo } from "../../src/server/actions/reportes/margen-objetivo";
import type { AccionClave } from "../../src/core/permisos/acciones";

// S-07: Prisma toma `undefined` en un `where` como "sin filtro". Un id roto que llega a la acción no puede tocar filas de otras sucursales.
const ROTOS: [string, unknown][] = [
  ["undefined", undefined],
  ["cadena vacía", ""],
  ["objeto", { not: "x" }],
  ["número", 7],
];

describe("acciones con un identificador roto no tocan filas", () => {
  let centralId: string;
  let norteId: string;
  let adminId: string;
  // O.41: cambiar una capacidad es solo del gerente. Los casos de capacidades de abajo son sobre ids rotos, no sobre ese punto: en ellos quien actúa es el gerente.
  const hacerGerenteAlAdmin = () =>
    prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: adminId, empresaId: EMPRESA_POR_DEFECTO_ID } }, data: { rolEmpresa: "gerente" } });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    centralId = base.sucursal.id;
    norteId = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: centralId, rolId: base.admin.id });
    adminId = admin.id;
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    for (const id of [centralId, norteId]) {
      await agregarSucursalAlPortal(id);
      await prisma.sucursalPublica.updateMany({ where: { sucursalId: id }, data: { posX: 10, posY: 20, posW: 30 } });
    }
  });

  describe.each(ROTOS)("sucursalId = %s", (_n, roto) => {
    it("registro público: ninguna acción cambia ni borra filas", async () => {
      const antes = await prisma.sucursalPublica.findMany({ orderBy: { slug: "asc" } });
      const id = roto as string;
      const resultados = [
        await agregarSucursalAlPortal(id),
        await guardarSucursalPublica(id, { slug: "otro", publicada: true }),
        await quitarSucursalDelPortal(id),
        await moverSucursalEnMapa(id, 50, 50),
      ];
      for (const r of resultados) expect(r).toEqual({ ok: false, mensaje: expect.any(String) });
      expect(await prisma.sucursalPublica.findMany({ orderBy: { slug: "asc" } })).toEqual(antes);
    });

    it("capacidades: no modifica ninguna fila ni audita", async () => {
      await hacerGerenteAlAdmin();
      await actualizarCapacidad("proceso_venta", centralId, true);
      const antes = await prisma.capacidadSucursal.findMany();
      const auditoriaAntes = await prisma.registroAuditoria.count();
      const r = await actualizarCapacidad("proceso_venta", roto as string, false);
      expect(r.ok).toBe(false);
      expect(await prisma.capacidadSucursal.findMany()).toEqual(antes);
      expect(await prisma.registroAuditoria.count()).toBe(auditoriaAntes);
    });
  });

  it("capacidades: null sigue siendo la fila por defecto y una sucursal inexistente se rechaza", async () => {
    await hacerGerenteAlAdmin();
    expect((await actualizarCapacidad("proceso_venta", null, false)).ok).toBe(true);
    expect(await prisma.capacidadSucursal.findMany({ where: { sucursalId: null } })).toHaveLength(1);
    expect(await actualizarCapacidad("proceso_venta", "no-existe", false)).toEqual({ ok: false, mensaje: "No se encontró la sucursal." });
    expect(await prisma.capacidadSucursal.count()).toBe(1);
  });

  it("capacidades: habilitado y acción inválidos se rechazan sin escribir", async () => {
    await hacerGerenteAlAdmin();
    expect((await actualizarCapacidad("proceso_venta", centralId, "false" as unknown as boolean)).ok).toBe(false);
    expect((await actualizarCapacidad("no_existe" as AccionClave, centralId, false)).ok).toBe(false);
    expect(await prisma.capacidadSucursal.count()).toBe(0);
  });

  it("capacidades: el cambio y su auditoría quedan juntos", async () => {
    await hacerGerenteAlAdmin();
    await actualizarCapacidad("proceso_venta", centralId, false);
    await actualizarCapacidad("proceso_venta", centralId, true);
    expect(await prisma.capacidadSucursal.count({ where: { sucursalId: centralId } })).toBe(1);
    const reg = await prisma.registroAuditoria.findMany({ where: { entidad: "CapacidadSucursal" }, orderBy: { creadoEn: "asc" } });
    expect(reg.map((r) => [r.valorAnterior, r.valorNuevo])).toEqual([[null, "false"], ["false", "true"]]);
  });

  it("margen objetivo: una categoría rota se rechaza; null sigue siendo la empresa", async () => {
    for (const roto of [undefined, "", { a: 1 }, 7]) {
      expect(await guardarMargenObjetivo(roto as never, 30)).toMatchObject({ ok: false });
    }
    expect(await prisma.margenObjetivo.count()).toBe(0);
    expect((await guardarMargenObjetivo(null, 30)).ok).toBe(true);
    expect(await prisma.margenObjetivo.count({ where: { categoriaId: null } })).toBe(1);
  });
});
