import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { fijarModulosActivos } from "../setup/modulos";
import { EMPRESA_POR_DEFECTO_ID } from "../setup/test-db";
import PortalPage from "../../src/app/(carta-publica)/carta-publica/[empresa]/page";

/**
 * S-24 (plan de endurecimiento de seguridad, tanda T9; método del dueño: un anónimo no alcanza nada salvo lo que la empresa PUBLICA a propósito).
 *
 * El ATAQUE: `/carta-publica/<slug>` respondía 200 (con el nombre de la empresa) a TODA empresa ACTIVE aunque no hubiera publicado nada, y 404 a un slug que no
 * existe. Esa diferencia es un oráculo: cualquiera enumera qué empresas son clientes de la plataforma probando slugs, y se lleva el nombre comercial de cada una
 * sin que ella haya publicado nada. Ahora el portal de una empresa sin ninguna sucursal publicada (y activa) responde el MISMO 404 que un slug inexistente.
 *
 * Se prueba la página (lo que importa el servidor de Next), con la base real: el último punto donde se decide es la página, que es quien arma la respuesta.
 */
const SLUG_DE_LA_EMPRESA = "principal";

/** Lo que `notFound()` lanza: lo que Next convierte en la página 404. Se compara el error entero para probar que los dos casos son INDISTINGUIBLES. */
async function loQueResponde(slug: string): Promise<{ resultado: "pagina" } | { resultado: "404"; error: unknown }> {
  try {
    await PortalPage({ params: Promise.resolve({ empresa: slug }) });
    return { resultado: "pagina" };
  } catch (e) {
    const digest = (e as { digest?: string }).digest ?? "";
    if (digest.includes("404")) return { resultado: "404", error: { message: (e as Error).message, digest } };
    throw e;
  }
}

describe("S-24: el portal de una empresa responde 404 si no publicó nada", () => {
  let central: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    await fijarModulosActivos(EMPRESA_POR_DEFECTO_ID, ["carta"]);
    central = (await prisma.sucursal.create({ data: { nombre: "Central" } })).id;
  });

  it("control: con una sucursal publicada y activa el portal se sirve", async () => {
    await prisma.sucursalPublica.create({ data: { sucursalId: central, slug: "central", publicada: true } });
    expect((await loQueResponde(SLUG_DE_LA_EMPRESA)).resultado).toBe("pagina");
  });

  it("ATAQUE: una empresa ACTIVE sin ninguna sucursal en el registro público da el mismo 404 que un slug inexistente", async () => {
    const sinNadaPublicado = await loQueResponde(SLUG_DE_LA_EMPRESA);
    const inexistente = await loQueResponde("no-existe-esta-empresa");
    expect(inexistente.resultado).toBe("404");
    expect(sinNadaPublicado).toEqual(inexistente);
  });

  it("ATAQUE: con la sucursal en el registro pero SIN publicar, o publicada pero con la sucursal inactiva, también es el mismo 404", async () => {
    const inactiva = (await prisma.sucursal.create({ data: { nombre: "Cerrada", activo: false } })).id;
    await prisma.sucursalPublica.createMany({
      data: [
        { sucursalId: central, slug: "central", publicada: false },
        { sucursalId: inactiva, slug: "cerrada", publicada: true },
      ],
    });
    expect(await loQueResponde(SLUG_DE_LA_EMPRESA)).toEqual(await loQueResponde("no-existe-esta-empresa"));
  });

  it("quitar la última sucursal publicada devuelve el 404 (no queda un portal vacío con el nombre de la empresa)", async () => {
    await prisma.sucursalPublica.create({ data: { sucursalId: central, slug: "central", publicada: true } });
    expect((await loQueResponde(SLUG_DE_LA_EMPRESA)).resultado).toBe("pagina");
    await prisma.sucursalPublica.update({ where: { empresaId_slug: { empresaId: EMPRESA_POR_DEFECTO_ID, slug: "central" } }, data: { publicada: false } });
    expect((await loQueResponde(SLUG_DE_LA_EMPRESA)).resultado).toBe("404");
  });
});
