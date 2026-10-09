import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible } from "../setup/test-db";
import { capacidadesDeSucursal, sucursalTieneCapacidad } from "../../src/server/acceso/capacidades-sucursal";
import { preciosLocalesVigentes } from "../../src/server/lecturas/catalogo/precio-local";

afterAll(() => prismaAdmin.$disconnect());

const OTRA_EMPRESA_ID = "empresa_otra_capacidad";

/**
 * O.47 de docs/pureza-integracion.md (reserva M3 de la auditoría del Hito 5): la fila «por defecto» de `CapacidadSucursal` (`sucursalId: null`) es de CADA empresa, y las dos lecturas
 * (`sucursalTieneCapacidad` para el gate y la carta, `capacidadesDeSucursal` para el menú) la leían SIN filtrar por empresa. Con RLS (el rol de la aplicación) no se cruzan; con un cliente que
 * se saltea el RLS (el rol dueño, `prismaAdmin`; solo con `MOTOR2_ROL_ESTRICTO=0` fuera de producción) la fila por defecto APAGADA de otra empresa apagaba la capacidad en esta. Mismo estilo que
 * `menu-consulta-empresas.test.ts` (S-11): se prueba con `prismaAdmin`, que NO filtra por empresa por su cuenta.
 */
describe("capacidades de sucursal — la fila «por defecto» de otra empresa no cuenta (sin RLS)", () => {
  let central: string;
  let productoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    central = base.sucursal.id;
    await prismaAdmin.empresa.upsert({
      where: { id: OTRA_EMPRESA_ID },
      update: {},
      create: { id: OTRA_EMPRESA_ID, nombre: "Otra", slug: "otra-capacidad", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "PROVISIONING" },
    });
    const catalogo = await sembrarCatalogoBase();
    productoId = (await sembrarProductoDisponible({ codigo: "PV_PIZZA", nombre: "Pizza", tipo: "PV", unidadStockId: catalogo.kg.id, precioVenta: 1000 }, central)).id;
    await prismaAdmin.precioLocalProducto.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId: central, productoId, precio: 800, habilitado: true } });
  });

  const porDefecto = (empresaId: string, habilitado: boolean, accionClave = "precio_local") =>
    prismaAdmin.capacidadSucursal.create({ data: { empresaId, accionClave, sucursalId: null, habilitado } });

  it("la fila por defecto apagada de OTRA empresa no apaga la capacidad de una sucursal sin fila propia (gate y carta)", async () => {
    await porDefecto(OTRA_EMPRESA_ID, false);

    expect(await sucursalTieneCapacidad(central, "precio_local", prismaAdmin)).toBe(true);
    expect((await preciosLocalesVigentes(central, prismaAdmin)).get(productoId)?.precio).toBe(800);
  });

  it("la fila por defecto apagada de OTRA empresa no apaga la capacidad en el menú (capacidadesDeSucursal): se conservan las demás y la autoprotegida", async () => {
    await porDefecto(OTRA_EMPRESA_ID, false);
    await porDefecto(OTRA_EMPRESA_ID, false, "carta_tema");

    const habilitadas = await capacidadesDeSucursal(central, ["precio_local", "carta_tema", "capacidades_sucursal"], prismaAdmin);

    expect([...habilitadas].sort()).toEqual(["capacidades_sucursal", "carta_tema", "precio_local"]);
  });

  it("la fila por defecto de la PROPIA empresa sí rige, sin que la de otra empresa la pise (encendida o apagada)", async () => {
    await porDefecto(OTRA_EMPRESA_ID, true);
    await porDefecto(EMPRESA_POR_DEFECTO_ID, false);

    expect(await sucursalTieneCapacidad(central, "precio_local", prismaAdmin)).toBe(false);
    expect((await capacidadesDeSucursal(central, ["precio_local"], prismaAdmin)).has("precio_local")).toBe(false);
    expect((await preciosLocalesVigentes(central, prismaAdmin)).size).toBe(0);
  });

  it("la fila propia de la sucursal sigue pisando a la por defecto de su empresa", async () => {
    await porDefecto(OTRA_EMPRESA_ID, false);
    await porDefecto(EMPRESA_POR_DEFECTO_ID, false);
    await prismaAdmin.capacidadSucursal.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, accionClave: "precio_local", sucursalId: central, habilitado: true } });

    expect(await sucursalTieneCapacidad(central, "precio_local", prismaAdmin)).toBe(true);
    expect((await capacidadesDeSucursal(central, ["precio_local"], prismaAdmin)).has("precio_local")).toBe(true);
  });
});
