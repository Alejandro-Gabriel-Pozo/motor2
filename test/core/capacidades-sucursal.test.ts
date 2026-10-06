import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, sembrarBase, prisma } from "../setup/test-db";
import { sucursalTieneCapacidad } from "../../src/core/permisos/capacidades-sucursal";

describe("sucursalTieneCapacidad", () => {
  let sucursalId: string;
  let otraSucursalId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    otraSucursalId = (await prisma.sucursal.create({ data: { nombre: "Sucursal 2" } })).id;
  });

  it("sin ninguna fila configurada, la acción está habilitada (comportamiento por defecto)", async () => {
    expect(await sucursalTieneCapacidad(sucursalId, "proceso_venta", prisma)).toBe(true);
  });

  it("la fila default (sucursalId null) aplica a cualquier sucursal sin fila específica", async () => {
    await prisma.capacidadSucursal.create({ data: { accionClave: "proceso_venta", sucursalId: null, habilitado: false } });
    expect(await sucursalTieneCapacidad(sucursalId, "proceso_venta", prisma)).toBe(false);
    expect(await sucursalTieneCapacidad(otraSucursalId, "proceso_venta", prisma)).toBe(false);
  });

  it("una fila específica de la sucursal prevalece sobre la fila default", async () => {
    await prisma.capacidadSucursal.create({ data: { accionClave: "proceso_venta", sucursalId: null, habilitado: false } });
    await prisma.capacidadSucursal.create({ data: { accionClave: "proceso_venta", sucursalId, habilitado: true } });

    expect(await sucursalTieneCapacidad(sucursalId, "proceso_venta", prisma)).toBe(true);
    expect(await sucursalTieneCapacidad(otraSucursalId, "proceso_venta", prisma)).toBe(false);
  });

  it("'capacidades_sucursal' siempre da true, pase lo que pase configurado", async () => {
    await prisma.capacidadSucursal.create({ data: { accionClave: "capacidades_sucursal", sucursalId, habilitado: false } });
    expect(await sucursalTieneCapacidad(sucursalId, "capacidades_sucursal", prisma)).toBe(true);
  });

  it("'gestion_usuarios' y 'gestion_permisos' también se auto-protegen, aunque se intenten deshabilitar por fila específica o default", async () => {
    await prisma.capacidadSucursal.create({ data: { accionClave: "gestion_usuarios", sucursalId, habilitado: false } });
    await prisma.capacidadSucursal.create({ data: { accionClave: "gestion_permisos", sucursalId: null, habilitado: false } });

    expect(await sucursalTieneCapacidad(sucursalId, "gestion_usuarios", prisma)).toBe(true);
    expect(await sucursalTieneCapacidad(sucursalId, "gestion_permisos", prisma)).toBe(true);
    expect(await sucursalTieneCapacidad(otraSucursalId, "gestion_permisos", prisma)).toBe(true); // la fila default tampoco alcanza a bloquearla
  });
});
