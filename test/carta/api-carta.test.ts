import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// El aviso a Sentry se cuenta, no se manda (mismo criterio que test/reportes/sincronizar-ipc.test.ts).
const reportarErrorUnaVez = vi.hoisted(() => vi.fn(async () => {}));
const reportarError = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../src/lib/reportar-error", () => ({ reportarErrorUnaVez, reportarError }));

import { limpiarBaseDeTest, prisma, sembrarProductoDisponible } from "../setup/test-db";
import { GET } from "../../src/app/api/carta/[sucursal]/route";
import { tokenDeServicioValido } from "../../src/core/carta/token-servicio";

/**
 * GET /api/carta/[sucursal] (docs/plan-carta-catalogo-2026-09-24.md, M5): autenticación de servicio, 404 sin revelar si la
 * sucursal no existe o está inactiva, y la forma v1 sin nada interno (código, costos, observaciones, diagnóstico).
 */
const TOKEN = "token-de-prueba-carta";

const pedir = (sucursal: string, authorization?: string) =>
  GET(new Request(`http://localhost/api/carta/${encodeURIComponent(sucursal)}`, { headers: authorization ? { authorization } : {} }), {
    params: Promise.resolve({ sucursal }),
  });

describe("tokenDeServicioValido", () => {
  it("acepta 'Bearer <token>' exacto (el esquema sin distinguir mayúsculas)", () => {
    expect(tokenDeServicioValido(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(tokenDeServicioValido(`bearer ${TOKEN}`, TOKEN)).toBe(true);
  });

  it("rechaza token distinto, prefijo, sufijo, sin esquema o vacío", () => {
    expect(tokenDeServicioValido("Bearer otro", TOKEN)).toBe(false);
    expect(tokenDeServicioValido(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(tokenDeServicioValido(`Bearer ${TOKEN.slice(0, -1)}`, TOKEN)).toBe(false);
    expect(tokenDeServicioValido(TOKEN, TOKEN)).toBe(false);
    expect(tokenDeServicioValido(`Basic ${TOKEN}`, TOKEN)).toBe(false);
    expect(tokenDeServicioValido("Bearer ", TOKEN)).toBe(false);
    expect(tokenDeServicioValido(null, TOKEN)).toBe(false);
    expect(tokenDeServicioValido(undefined, TOKEN)).toBe(false);
  });

  it("sin token esperado (variable vacía o ausente) no acepta NADA, ni siquiera 'Bearer ' vacío", () => {
    expect(tokenDeServicioValido("Bearer ", "")).toBe(false);
    expect(tokenDeServicioValido("Bearer x", undefined)).toBe(false);
    expect(tokenDeServicioValido("Bearer x", " , ")).toBe(false);
  });

  it("admite una lista separada por comas para rotar el token", () => {
    expect(tokenDeServicioValido("Bearer nuevo", "nuevo, viejo")).toBe(true);
    expect(tokenDeServicioValido("Bearer viejo", "nuevo, viejo")).toBe(true);
    expect(tokenDeServicioValido("Bearer otro", "nuevo, viejo")).toBe(false);
  });
});

describe("GET /api/carta/[sucursal]", () => {
  let central: string;
  let cerrada: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    reportarErrorUnaVez.mockClear();
    reportarError.mockClear();
    process.env.CARTA_API_TOKEN = TOKEN;

    const u = await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
    central = (await prisma.sucursal.create({ data: { nombre: "Central" } })).id;
    cerrada = (await prisma.sucursal.create({ data: { nombre: "Cerrada", activo: false } })).id;
    const cat = await prisma.categoriaProducto.create({ data: { nombre: "Bife" } });
    const seccion = await prisma.seccionCarta.create({ data: { nombre: "Platos Principales", titulo: "Del fuego", orden: 2 } });
    const bife = await sembrarProductoDisponible(
      { codigo: "PV_SECRETO_123", nombre: "Bife de chorizo", tipo: "PV", categoriaId: cat.id, precioVenta: 34000, observaciones: "nota interna", unidadStockId: u.id },
      central
    );
    await prisma.contenidoCartaProducto.create({ data: { productoId: bife.id, visibleEnCarta: true, seccionCartaId: seccion.id, tags: ["Regional"], especial: true } });
    await prisma.promoCarta.create({ data: { sucursalId: central, seccionCartaId: seccion.id, titulo: "Bife + vino", precio: 40000 } });
  });

  afterEach(() => {
    delete process.env.CARTA_API_TOKEN;
  });

  it("sin header Authorization → 401", async () => {
    const r = await pedir(central);
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "No autorizado" });
    expect(reportarErrorUnaVez).not.toHaveBeenCalled();
  });

  it("token incorrecto → 401", async () => {
    const r = await pedir(central, "Bearer otro-token");
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "No autorizado" });
  });

  it("sin CARTA_API_TOKEN configurada → 401 siempre, y se avisa a Sentry una vez", async () => {
    delete process.env.CARTA_API_TOKEN;
    const r = await pedir(central, "Bearer ");
    expect(r.status).toBe(401);
    const r2 = await pedir(central, `Bearer ${TOKEN}`);
    expect(r2.status).toBe(401);
    expect(reportarErrorUnaVez).toHaveBeenCalledWith("carta-api-sin-token", expect.any(Error), "carta-api");
  });

  it("id desconocido o sucursal inactiva → 404 con el mismo cuerpo", async () => {
    for (const id of ["no-existe", cerrada, "x".repeat(500)]) {
      const r = await pedir(id, `Bearer ${TOKEN}`);
      expect(r.status, id.slice(0, 20)).toBe(404);
      expect(await r.json()).toEqual({ error: "Sucursal no encontrada" });
    }
  });

  it("200: forma v1, precio numérico, sin claves internas, y sin caché", async () => {
    const r = await pedir(central, `Bearer ${TOKEN}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const cuerpo = await r.json();
    expect(cuerpo.version).toBe(1);
    expect(typeof cuerpo.generadoEn).toBe("string");
    expect(cuerpo.sucursal).toEqual({ id: central, nombre: "Central" });
    expect(cuerpo.secciones).toHaveLength(1);
    const [seccion] = cuerpo.secciones;
    expect(seccion.titulo).toBe("Del fuego");
    expect(seccion.items).toEqual([
      { productoId: expect.any(String), nombre: "Bife de chorizo", categoria: "Bife", descripcion: null, precio: 34000, tags: ["Regional"], especial: true, imagenUrl: null },
    ]);
    expect(typeof seccion.items[0].precio).toBe("number");
    expect(seccion.promos).toEqual([{ id: expect.any(String), titulo: "Bife + vino", descripcion: null, precio: 40000, orden: 0 }]);
    expect(typeof seccion.promos[0].precio).toBe("number");

    const texto = JSON.stringify(cuerpo);
    for (const interno of ["PV_SECRETO_123", "codigo", "nota interna", "observaciones", "costo", "diagnostico", "visiblesSinSeccion", "precioVenta"]) {
      expect(texto, interno).not.toContain(interno);
    }
  });

  it("un error inesperado → 500 genérico (sin el mensaje interno) y se reporta", async () => {
    const espia = vi.spyOn(prisma.sucursal, "findUnique").mockRejectedValueOnce(new Error("detalle interno de la base"));
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
