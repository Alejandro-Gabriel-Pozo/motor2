import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// El aviso a Sentry se cuenta, no se manda (mismo criterio que test/carta/api-carta.test.ts).
const reportarErrorUnaVez = vi.hoisted(() => vi.fn(async () => {}));
const reportarError = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../src/lib/reportar-error", () => ({ reportarErrorUnaVez, reportarError }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { GET } from "../../src/app/api/carta/tenants/route";

/**
 * GET /api/carta/tenants (docs/plan-registro-tenants-2026-09-24.md, M4): la misma autenticación de servicio que
 * GET /api/carta/[sucursal], lista vacía = 200 (no 404), la lista completa (publicadas y no publicadas) en la forma v1, y nada
 * interno (ids de la fila, fechas de actualización).
 */
const TOKEN = "token-de-prueba-carta-tenants";
const SHEET = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abc";

const pedir = (authorization?: string) => GET(new Request("http://localhost/api/carta/tenants", { headers: authorization ? { authorization } : {} }));

describe("GET /api/carta/tenants", () => {
  let central: string;
  let norte: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    reportarErrorUnaVez.mockClear();
    reportarError.mockClear();
    process.env.CARTA_API_TOKEN = TOKEN;
    central = (await prisma.sucursal.create({ data: { nombre: "Central" } })).id;
    norte = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
  });

  afterEach(() => {
    delete process.env.CARTA_API_TOKEN;
  });

  it("sin header Authorization → 401", async () => {
    const r = await pedir();
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "No autorizado" });
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(reportarErrorUnaVez).not.toHaveBeenCalled();
  });

  it("token incorrecto → 401", async () => {
    const r = await pedir("Bearer otro-token");
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "No autorizado" });
  });

  it("sin CARTA_API_TOKEN configurada → 401 siempre, y se avisa a Sentry (misma clave que el endpoint de la carta)", async () => {
    delete process.env.CARTA_API_TOKEN;
    expect((await pedir("Bearer ")).status).toBe(401);
    expect((await pedir(`Bearer ${TOKEN}`)).status).toBe(401);
    expect(reportarErrorUnaVez).toHaveBeenCalledWith("carta-api-sin-token", expect.any(Error), "carta-api");
  });

  it("base sin filas → 200 con la lista vacía (no 404)", async () => {
    const r = await pedir(`Bearer ${TOKEN}`);
    expect(r.status).toBe(200);
    const cuerpo = await r.json();
    expect(cuerpo.version).toBe(1);
    expect(cuerpo.tenants).toEqual([]);
  });

  it("200: forma v1 con la fila publicada y la no publicada, posición numérica, sin claves internas, sin caché", async () => {
    await prisma.sucursalPublica.create({
      data: { sucursalId: central, slug: "central", publicada: true, sheetId: SHEET, posX: 12.5, posY: 40, posW: 8, posH: 5, subtituloPortal: "Frente al lago", dominio: "carta.central.com" },
    });
    await prisma.sucursalPublica.create({ data: { sucursalId: norte, slug: "norte", orden: 1 } });

    const r = await pedir(`Bearer ${TOKEN}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const cuerpo = await r.json();
    expect(cuerpo.version).toBe(1);
    expect(typeof cuerpo.generadoEn).toBe("string");
    expect(cuerpo.tenants).toEqual([
      {
        slug: "central",
        etiqueta: "Central",
        dominio: "carta.central.com",
        subtitulo: "Frente al lago",
        posicion: { x: 12.5, y: 40, w: 8, h: 5 },
        orden: 0,
        activo: true,
        sucursalId: central,
        menuDesdeMotor2: false,
        temaDesdeMotor2: false,
        sheetId: SHEET,
        sheetMenuNombre: "Menu",
      },
      {
        slug: "norte",
        etiqueta: "Norte",
        dominio: null,
        subtitulo: null,
        posicion: null,
        orden: 1,
        activo: false,
        sucursalId: norte,
        menuDesdeMotor2: false,
        temaDesdeMotor2: false,
        sheetId: null,
        sheetMenuNombre: "Menu",
      },
    ]);
    expect(typeof cuerpo.tenants[0].posicion.x).toBe("number");
    const texto = JSON.stringify(cuerpo);
    for (const interno of ["actualizadoEn", "publicada", "subtituloPortal", "posX", "creadoEn"]) expect(texto, interno).not.toContain(interno);
  });

  it("un error inesperado → 500 genérico (sin el mensaje interno) y se reporta", async () => {
    const espia = vi.spyOn(prisma.sucursalPublica, "findMany").mockRejectedValueOnce(new Error("detalle interno de la base"));
    try {
      const r = await pedir(`Bearer ${TOKEN}`);
      expect(r.status).toBe(500);
      expect(await r.json()).toEqual({ error: "Error interno" });
      expect(reportarError).toHaveBeenCalledWith(expect.any(Error), "carta-api");
    } finally {
      espia.mockRestore();
    }
  });
});
