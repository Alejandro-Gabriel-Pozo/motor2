import { afterEach, describe, expect, it } from "vitest";
import { prisma, prismaAdmin } from "../../setup/test-db";
import { DATOS_EMPRESA_TESTIGO, EMPRESA_DE_PRUEBA_ID, EMPRESA_TESTIGO_ID } from "../../setup/empresa-de-prueba";
import { obtenerPerfilDeEmpresa } from "../../../src/server/consultas/empresa/perfil";

/**
 * `src/server/consultas/empresa/perfil.ts` contra Postgres real. `Empresa` no tiene RLS: lo único que separa los datos de una empresa de los de otra es el
 * filtro por `id` que la consulta lleva siempre, así que acá se prueba justamente eso, con la empresa de prueba y la testigo (las dos viven en toda base de prueba).
 */

const CUIT_DE_PRUEBA = "20123456786";

describe("server/consultas/empresa/perfil", () => {
  afterEach(async () => {
    await prismaAdmin.empresa.update({ where: { id: EMPRESA_DE_PRUEBA_ID }, data: { cuit: null } });
  });

  it("devuelve nombre, CUIT, zona horaria y moneda de la empresa pedida, y nada más", async () => {
    await prismaAdmin.empresa.update({ where: { id: EMPRESA_DE_PRUEBA_ID }, data: { cuit: CUIT_DE_PRUEBA } });
    const esperada = await prismaAdmin.empresa.findUniqueOrThrow({ where: { id: EMPRESA_DE_PRUEBA_ID } });

    const perfil = await obtenerPerfilDeEmpresa(EMPRESA_DE_PRUEBA_ID, prisma);

    expect(perfil).toEqual({ nombre: esperada.nombre, cuit: CUIT_DE_PRUEBA, zonaHoraria: esperada.zonaHoraria, moneda: esperada.moneda });
    // Ni el estado ni la política de plataforma (permisosEditables, dosPaneles) salen de acá: la pantalla no los muestra.
    expect(Object.keys(perfil!).sort()).toEqual(["cuit", "moneda", "nombre", "zonaHoraria"]);
  });

  it("una empresa sin CUIT confirmado devuelve cuit null", async () => {
    const perfil = await obtenerPerfilDeEmpresa(EMPRESA_DE_PRUEBA_ID, prisma);
    expect(perfil?.cuit).toBeNull();
  });

  it("cada empresa ve la suya: pedir la testigo trae la testigo, no la de prueba", async () => {
    await prismaAdmin.empresa.update({ where: { id: EMPRESA_DE_PRUEBA_ID }, data: { cuit: CUIT_DE_PRUEBA } });

    const testigo = await obtenerPerfilDeEmpresa(EMPRESA_TESTIGO_ID, prisma);

    expect(testigo?.nombre).toBe(DATOS_EMPRESA_TESTIGO.nombre);
    expect(testigo?.cuit).toBeNull();
    expect(testigo?.nombre).not.toBe((await obtenerPerfilDeEmpresa(EMPRESA_DE_PRUEBA_ID, prisma))?.nombre);
  });

  it("una empresa que no existe devuelve null", async () => {
    expect(await obtenerPerfilDeEmpresa("empresa_que_no_existe", prisma)).toBeNull();
  });
});
