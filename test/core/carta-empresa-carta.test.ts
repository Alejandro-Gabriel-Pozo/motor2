import { beforeEach, describe, expect, it } from "vitest";
import { empresaDeSucursalCarta, resolverEmpresaCarta } from "@/core/carta/empresa-carta";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma } from "../setup/test-db";

/**
 * ADR-007, A3: la empresa de la carta pública sale de la tabla `Empresa` (por slug, solo ACTIVE), no de una variable de entorno.
 * La empresa por defecto de la base de test es `empresa_principal` / slug `principal` / ACTIVE (la deja `limpiarBaseDeTest`).
 */
async function crearEmpresa(id: string, estado: "PROVISIONING" | "ACTIVE" | "SUSPENDED" | "DELETING") {
  return prisma.empresa.create({ data: { id, nombre: `Empresa ${id}`, slug: id, zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado } });
}

describe("resolverEmpresaCarta", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  it("resuelve una empresa ACTIVE por su slug, con su id", async () => {
    await expect(resolverEmpresaCarta("principal", prisma)).resolves.toEqual({ id: EMPRESA_POR_DEFECTO_ID, slug: "principal" });
  });

  it("da null si ninguna empresa tiene ese slug", async () => {
    await expect(resolverEmpresaCarta("otra-empresa", prisma)).resolves.toBeNull();
  });

  it("da null si la empresa existe pero no está ACTIVE (suspendida, en alta o en baja)", async () => {
    await crearEmpresa("suspendida", "SUSPENDED");
    await crearEmpresa("en-alta", "PROVISIONING");
    await crearEmpresa("en-baja", "DELETING");
    for (const slug of ["suspendida", "en-alta", "en-baja"]) await expect(resolverEmpresaCarta(slug, prisma), slug).resolves.toBeNull();
  });

  it("elige por slug entre varias empresas ACTIVE", async () => {
    await crearEmpresa("la-cuadra", "ACTIVE");
    await expect(resolverEmpresaCarta("la-cuadra", prisma)).resolves.toEqual({ id: "la-cuadra", slug: "la-cuadra" });
    await expect(resolverEmpresaCarta("principal", prisma)).resolves.toEqual({ id: EMPRESA_POR_DEFECTO_ID, slug: "principal" });
  });

  it("es estrictamente sensible a mayúsculas (el slug de la URL llega ya en minúsculas por convención, no se normaliza acá)", async () => {
    await expect(resolverEmpresaCarta("Principal", prisma)).resolves.toBeNull();
  });
});

describe("empresaDeSucursalCarta", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  it("devuelve la empresa a la que pertenece la sucursal", async () => {
    await crearEmpresa("la-cuadra", "PROVISIONING");
    const propia = await prisma.sucursal.create({ data: { nombre: "Central" } });
    const ajena = await prisma.sucursal.create({ data: { nombre: "Ajena", empresaId: "la-cuadra" } });
    await expect(empresaDeSucursalCarta(propia.id, prisma)).resolves.toEqual({ id: EMPRESA_POR_DEFECTO_ID, slug: "principal" });
    await expect(empresaDeSucursalCarta(ajena.id, prisma)).resolves.toEqual({ id: "la-cuadra", slug: "la-cuadra" });
  });

  it("da null si la sucursal no existe", async () => {
    await expect(empresaDeSucursalCarta("no-existe", prisma)).resolves.toBeNull();
  });
});
