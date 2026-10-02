import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { resolverMenuCartaConDiagnostico } from "../../src/core/carta/menu-consulta";

afterAll(() => prismaAdmin.$disconnect());

const OTRA_EMPRESA_ID = "empresa_otra_menu";

/**
 * Defensa en profundidad (S-11): la lectura del menú filtra por la empresa de la sucursal además del RLS. Se prueba con el cliente
 * dueño (`prismaAdmin`, salta el RLS): si el filtro explícito falta, las secciones y los ítems agrupados de otra empresa se mezclan.
 */
describe("resolverMenuCartaConDiagnostico — aislamiento por empresa sin RLS", () => {
  let central: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    central = (await prisma.sucursal.create({ data: { nombre: "Central" } })).id;
    await prismaAdmin.empresa.upsert({
      where: { id: OTRA_EMPRESA_ID },
      update: {},
      create: { id: OTRA_EMPRESA_ID, nombre: "Otra", slug: "otra-menu", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "PROVISIONING" },
    });
  });

  it("los ítems agrupados de otra empresa no aparecen en el diagnóstico de la carta de esta", async () => {
    const propia = await prismaAdmin.seccionCarta.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, nombre: "Propia" } });
    await prismaAdmin.itemAgrupadoCarta.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, nombre: "Gaseosa propia", seccionCartaId: propia.id } });
    const ajena = await prismaAdmin.seccionCarta.create({ data: { empresaId: OTRA_EMPRESA_ID, nombre: "Ajena" } });
    await prismaAdmin.itemAgrupadoCarta.create({ data: { empresaId: OTRA_EMPRESA_ID, nombre: "Gaseosa ajena", seccionCartaId: ajena.id } });

    const armado = await resolverMenuCartaConDiagnostico(central, prismaAdmin);

    expect(armado!.diagnostico.agrupadosSinOpciones.map((a) => a.nombre)).toEqual(["Gaseosa propia"]);
  });
});
