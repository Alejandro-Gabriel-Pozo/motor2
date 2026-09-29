import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// El aviso a Sentry se cuenta, no se manda (mismo criterio que test/carta/api-carta.test.ts).
const reportarErrorUnaVez = vi.hoisted(() => vi.fn(async () => {}));
const reportarError = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../src/lib/reportar-error", () => ({ reportarErrorUnaVez, reportarError }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { GET } from "../../src/app/api/carta/[sucursal]/tema/route";
import { CLAVES_TEMA_V1 } from "../../src/core/carta/tema";

/**
 * GET /api/carta/[sucursal]/tema (docs/plan-tema-carta-2026-09-24.md, M5, D6): la misma autenticación de servicio que los otros
 * dos endpoints de la carta, el mismo 404 para todo lo que no es "tema aplicado de una sucursal activa", y la forma v1 con
 * EXACTAMENTE las 67 claves del catálogo (ninguna precio_*), sin nada interno.
 */
const TOKEN = "token-de-prueba-carta-tema";

const pedir = (sucursal: string, authorization?: string) =>
  GET(new Request(`http://localhost/api/carta/${encodeURIComponent(sucursal)}/tema`, { headers: authorization ? { authorization } : {} }), {
    params: Promise.resolve({ sucursal }),
  });

describe("GET /api/carta/[sucursal]/tema", () => {
  let central: string;
  let cerrada: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    reportarErrorUnaVez.mockClear();
    reportarError.mockClear();
    process.env.CARTA_API_TOKEN = TOKEN;
    central = (await prisma.sucursal.create({ data: { nombre: "Central" } })).id;
    cerrada = (await prisma.sucursal.create({ data: { nombre: "Cerrada", activo: false } })).id;
  });

  afterEach(() => {
    delete process.env.CARTA_API_TOKEN;
  });

  it("sin header Authorization → 401", async () => {
    const r = await pedir(central);
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "No autorizado" });
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(reportarErrorUnaVez).not.toHaveBeenCalled();
  });

  it("token incorrecto → 401", async () => {
    const r = await pedir(central, "Bearer otro-token");
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "No autorizado" });
  });

  it("sin CARTA_API_TOKEN configurada → 401 siempre, y se avisa a Sentry (misma clave que los otros endpoints de la carta)", async () => {
    delete process.env.CARTA_API_TOKEN;
    expect((await pedir(central, "Bearer ")).status).toBe(401);
    expect((await pedir(central, `Bearer ${TOKEN}`)).status).toBe(401);
    expect(reportarErrorUnaVez).toHaveBeenCalledWith("carta-api-sin-token", expect.any(Error), "carta-api");
  });

  it("el mismo 404 para: id inexistente, sucursal inactiva, sin fila, tema sin aplicar e id de más de 100 caracteres", async () => {
    await prisma.temaCartaSucursal.create({ data: { sucursalId: cerrada, aplicarEnCarta: true, valores: { color_marca: "red" } } });
    const casos: string[] = ["no-existe", cerrada, central];
    for (const id of casos) {
      const r = await pedir(id, `Bearer ${TOKEN}`);
      expect(r.status, id).toBe(404);
      expect(await r.json()).toEqual({ error: "Tema no encontrado" });
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
    // Sin aplicar (borrador).
    await prisma.temaCartaSucursal.create({ data: { sucursalId: central, valores: { color_marca: "red" } } });
    expect((await pedir(central, `Bearer ${TOKEN}`)).status).toBe(404);
    // Id larguísimo: ni se consulta.
    const espia = vi.spyOn(prisma.temaCartaSucursal, "findFirst");
    try {
      expect((await pedir("x".repeat(101), `Bearer ${TOKEN}`)).status).toBe(404);
      expect(espia).not.toHaveBeenCalled();
    } finally {
      espia.mockRestore();
    }
  });

  it("200: forma v1 con exactamente las 67 claves (ninguna precio_*), null en las no cargadas, sin nada interno, sin caché", async () => {
    await prisma.temaCartaSucursal.create({
      data: {
        sucursalId: central,
        aplicarEnCarta: true,
        valores: {
          restaurante_nombre: "La Parrilla",
          color_especial_item_nombre: "#aa3300",
          carta_texto_portada_cta: "Deslizá",
          carta_fuente_item_nombre: "clamp(0.8rem, 2vw, 1rem)",
          precio_simbolo: "US$",
        },
      },
    });
    const r = await pedir(central, `Bearer ${TOKEN}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const cuerpo = await r.json();
    expect(Object.keys(cuerpo).sort()).toEqual(["actualizadoEn", "generadoEn", "sucursalId", "valores", "version"]);
    expect(cuerpo.version).toBe(1);
    expect(cuerpo.sucursalId).toBe(central);
    expect(typeof cuerpo.generadoEn).toBe("string");
    expect(typeof cuerpo.actualizadoEn).toBe("string");
    const claves = Object.keys(cuerpo.valores);
    expect(claves).toHaveLength(67);
    expect(claves.sort()).toEqual(CLAVES_TEMA_V1.map((d) => d.clave as string).sort());
    expect(claves.filter((c) => c.startsWith("precio_"))).toEqual([]);
    expect(cuerpo.valores).toMatchObject({
      restaurante_nombre: "La Parrilla",
      color_especial_item_nombre: "#aa3300",
      carta_texto_portada_cta: "Deslizá",
      carta_fuente_item_nombre: "clamp(0.8rem, 2vw, 1rem)",
      color_marca: null,
      carta_banda_alto_desktop: null,
    });
    expect(Object.values(cuerpo.valores).filter((v) => v !== null)).toHaveLength(4);
    const texto = JSON.stringify(cuerpo);
    for (const interno of ["aplicarEnCarta", '"id"', "activo"]) expect(texto, interno).not.toContain(interno);
  });

  it("un error inesperado → 500 genérico (sin el mensaje interno) y se reporta", async () => {
    const espia = vi.spyOn(prisma.temaCartaSucursal, "findFirst").mockRejectedValueOnce(new Error("detalle interno de la base"));
    try {
      const r = await pedir(central, `Bearer ${TOKEN}`);
      expect(r.status).toBe(500);
      expect(await r.json()).toEqual({ error: "Error interno" });
      expect(reportarError).toHaveBeenCalledWith(expect.any(Error), "carta-api");
    } finally {
      espia.mockRestore();
    }
  });
});
