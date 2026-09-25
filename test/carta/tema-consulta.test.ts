import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { resolverTemaCarta } from "../../src/core/carta/tema-consulta";
import { cargarTemaAdmin } from "../../src/core/carta/admin-consulta";
import { CLAVES_TEMA_V1 } from "../../src/core/carta/tema";

/**
 * resolverTemaCarta contra Postgres real (docs/plan-tema-carta-2026-09-24.md, M4): null sin fila, con el tema sin aplicar
 * (borrador) o con la sucursal inactiva; si no, las 67 claves del catálogo. En una sola consulta. Y cargarTemaAdmin, lo que lee
 * la pantalla.
 */
describe("resolverTemaCarta", () => {
  let central: string;
  let cerrada: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    central = (await prisma.sucursal.create({ data: { nombre: "Central" } })).id;
    cerrada = (await prisma.sucursal.create({ data: { nombre: "Cerrada", activo: false } })).id;
  });

  it("sin fila → null", async () => {
    expect(await resolverTemaCarta(central)).toBeNull();
    expect(await resolverTemaCarta("no-existe")).toBeNull();
  });

  it("con el tema sin aplicar (borrador) → null", async () => {
    await prisma.temaCartaSucursal.create({ data: { sucursalId: central, valores: { color_marca: "#8b4513" } } });
    expect(await resolverTemaCarta(central)).toBeNull();
  });

  it("aplicado pero con la sucursal inactiva → null", async () => {
    await prisma.temaCartaSucursal.create({ data: { sucursalId: cerrada, valores: { color_marca: "#8b4513" }, aplicarEnCarta: true } });
    expect(await resolverTemaCarta(cerrada)).toBeNull();
  });

  it("aplicado → las 67 claves, con los valores cargados y null en el resto", async () => {
    const fila = await prisma.temaCartaSucursal.create({
      data: { sucursalId: central, aplicarEnCarta: true, valores: { color_marca: "#8b4513", restaurante_nombre: "La Parrilla", precio_simbolo: "US$" } },
    });
    const ahora = new Date("2026-09-24T12:00:00.000Z");
    const tema = await resolverTemaCarta(central, prisma, ahora);
    expect(tema).not.toBeNull();
    expect(tema).toMatchObject({ version: 1, generadoEn: ahora.toISOString(), sucursalId: central, actualizadoEn: fila.actualizadoEn.toISOString() });
    expect(Object.keys(tema!.valores).sort()).toEqual(CLAVES_TEMA_V1.map((d) => d.clave as string).sort());
    expect(tema!.valores.color_marca).toBe("#8b4513");
    expect(tema!.valores.restaurante_nombre).toBe("La Parrilla");
    expect(tema!.valores.color_item_nombre).toBeNull();
    expect("precio_simbolo" in tema!.valores).toBe(false);
  });

  it("hace exactamente una consulta (temaCartaSucursal.findUnique, con la sucursal incluida)", async () => {
    await prisma.temaCartaSucursal.create({ data: { sucursalId: central, aplicarEnCarta: true, valores: { color_marca: "red" } } });
    const operaciones: string[] = [];
    const contador = prisma.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            operaciones.push(`${model}.${operation}`);
            return query(args);
          },
        },
      },
    }) as unknown as PrismaClient;
    const tema = await resolverTemaCarta(central, contador);
    expect(tema?.valores.color_marca).toBe("red");
    expect(operaciones).toEqual(["TemaCartaSucursal.findUnique"]);
  });
});

describe("cargarTemaAdmin", () => {
  let central: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    central = (await prisma.sucursal.create({ data: { nombre: "Central" } })).id;
  });

  it("sin tema y fuera del portal", async () => {
    expect(await cargarTemaAdmin(central)).toEqual({ sucursalId: central, nombre: "Central", tema: null, publica: null });
    expect(await cargarTemaAdmin("no-existe")).toBeNull();
  });

  it("los valores guardados tal cual (también los inválidos, para poder corregirlos), solo claves del catálogo con texto; y el portal", async () => {
    await prisma.sucursalPublica.create({ data: { sucursalId: central, slug: "central", publicada: true } });
    await prisma.temaCartaSucursal.create({ data: { sucursalId: central, valores: { color_marca: "red;x", restaurante_nombre: "La Parrilla", precio_simbolo: "US$", carta_imagen_opacidad: 38 } } });
    const t = await cargarTemaAdmin(central);
    expect(t?.publica).toEqual({ slug: "central", publicada: true });
    expect(t?.tema?.aplicarEnCarta).toBe(false);
    expect(t?.tema?.valores).toEqual({ color_marca: "red;x", restaurante_nombre: "La Parrilla" });
    expect(t?.tema?.actualizadoEn).toBeInstanceOf(Date);
  });
});
