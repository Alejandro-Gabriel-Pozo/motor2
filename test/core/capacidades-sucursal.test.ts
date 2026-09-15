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
    expect(await sucursalTieneCapacidad(sucursalId, "proceso_venta")).toBe(true);
  });

  it("la fila default (sucursalId null) aplica a cualquier sucursal sin fila específica", async () => {
    await prisma.capacidadSucursal.create({ data: { accionClave: "proceso_venta", sucursalId: null, habilitado: false } });
    expect(await sucursalTieneCapacidad(sucursalId, "proceso_venta")).toBe(false);
    expect(await sucursalTieneCapacidad(otraSucursalId, "proceso_venta")).toBe(false);
  });

  it("una fila específica de la sucursal prevalece sobre la fila default", async () => {
    await prisma.capacidadSucursal.create({ data: { accionClave: "proceso_venta", sucursalId: null, habilitado: false } });
    await prisma.capacidadSucursal.create({ data: { accionClave: "proceso_venta", sucursalId, habilitado: true } });

    expect(await sucursalTieneCapacidad(sucursalId, "proceso_venta")).toBe(true);
    expect(await sucursalTieneCapacidad(otraSucursalId, "proceso_venta")).toBe(false);
  });

  it("'capacidades_sucursal' siempre da true, pase lo que pase configurado", async () => {
    await prisma.capacidadSucursal.create({ data: { accionClave: "capacidades_sucursal", sucursalId, habilitado: false } });
    expect(await sucursalTieneCapacidad(sucursalId, "capacidades_sucursal")).toBe(true);
  });
});
