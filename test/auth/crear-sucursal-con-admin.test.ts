import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearSucursalConAdmin } from "../../src/server/actions/auth/sucursales";

describe("crearSucursalConAdmin — disponibilidad de productos en la sucursal nueva (decisión 4, docs/plan-disponibilidad-por-sucursal-2026-09-23.md §10)", () => {
  let kgId: string;
  let central: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const catalogo = await sembrarCatalogoBase();
    kgId = catalogo.kg.id;
    central = base.sucursal.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: central, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  async function producto(nombre: string) {
    return (await prisma.producto.create({ data: { codigo: `MP_${nombre}`, nombre, tipo: "MP", unidadStockId: kgId } })).id;
  }

  const disponibleEn = async (productoId: string, sucursalId: string) =>
    (await prisma.disponibilidadProducto.findUnique({ where: { sucursalId_productoId: { sucursalId, productoId } } }))?.disponible ?? false;

  // "Sin ninguna sucursal activa antes (la primerísima del sistema): arranca en cero" ya está cubierto a nivel de la función
  // pura en test/catalogo/disponibilidad-producto.test.ts — no es alcanzable vía ESTA acción: quien la ejecuta necesita una
  // membresía ACTIVA para pasar el gate de permiso, así que `sucursalIdsActivas` nunca puede dar vacío en este flujo real
  // (la propia sucursal del actor ya cuenta como una sucursal activa).

  it("con 3 sucursales activas, un producto universal en las 3 aparece en la 4ta nueva", async () => {
    const sucursalB = (await prisma.sucursal.create({ data: { nombre: "B" } })).id;
    const sucursalC = (await prisma.sucursal.create({ data: { nombre: "C" } })).id;
    const universal = await producto("Universal");
    await prisma.disponibilidadProducto.createMany({
      data: [central, sucursalB, sucursalC].map((sucursalId) => ({ sucursalId, productoId: universal, disponible: true })),
    });

    const r = await crearSucursalConAdmin({ nombre: "D", emailPrimerAdmin: "admin-d@test.com" });
    expect(r.ok).toBe(true);
    const nueva = await prisma.sucursal.findUniqueOrThrow({ where: { nombre: "D" } });
    expect(await disponibleEn(universal, nueva.id)).toBe(true);
  });

  it("un producto disponible en 2 de 3 (mayoría, no todas) NO aparece en la 4ta nueva", async () => {
    const sucursalB = (await prisma.sucursal.create({ data: { nombre: "B" } })).id;
    const sucursalC = (await prisma.sucursal.create({ data: { nombre: "C" } })).id;
    const parcial = await producto("Parcial");
    await prisma.disponibilidadProducto.createMany({
      data: [
        { sucursalId: central, productoId: parcial, disponible: true },
        { sucursalId: sucursalB, productoId: parcial, disponible: true },
        { sucursalId: sucursalC, productoId: parcial, disponible: false },
      ],
    });

    const r = await crearSucursalConAdmin({ nombre: "D", emailPrimerAdmin: "admin-d2@test.com" });
    expect(r.ok).toBe(true);
    const nueva = await prisma.sucursal.findUniqueOrThrow({ where: { nombre: "D" } });
    expect(await disponibleEn(parcial, nueva.id)).toBe(false);
  });

  it("una sucursal INACTIVA no cuenta para el cálculo de 'todas' — ni como universo ni truncando el criterio", async () => {
    const sucursalB = (await prisma.sucursal.create({ data: { nombre: "B" } })).id;
    const sucursalInactiva = (await prisma.sucursal.create({ data: { nombre: "Cerrada", activo: false } })).id;
    const universalEntreLasActivas = await producto("UniversalActivas");
    await prisma.disponibilidadProducto.createMany({
      data: [
        { sucursalId: central, productoId: universalEntreLasActivas, disponible: true },
        { sucursalId: sucursalB, productoId: universalEntreLasActivas, disponible: true },
        // Sin fila en la sucursal inactiva — no tendría que impedir la universalidad.
      ],
    });
    void sucursalInactiva;

    const r = await crearSucursalConAdmin({ nombre: "Nueva", emailPrimerAdmin: "admin-e@test.com" });
    expect(r.ok).toBe(true);
    const nueva = await prisma.sucursal.findUniqueOrThrow({ where: { nombre: "Nueva" } });
    expect(await disponibleEn(universalEntreLasActivas, nueva.id)).toBe(true);
  });

  it("sigue creando la sucursal y su primer admin, sin ningún producto de por medio", async () => {
    const r = await crearSucursalConAdmin({ nombre: "Sin catálogo", emailPrimerAdmin: "solo-admin@test.com" });
    expect(r.ok).toBe(true);
    const nueva = await prisma.sucursal.findUniqueOrThrow({ where: { nombre: "Sin catálogo" } });
    const membresia = await prisma.usuarioSucursal.findFirst({ where: { sucursalId: nueva.id }, include: { usuario: true } });
    expect(membresia?.usuario.email).toBe("solo-admin@test.com");
  });
});
