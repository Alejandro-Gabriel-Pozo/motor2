import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prismaFalso, resolverPortalCarta, resolverCartaPublica, portalCartaPublico, cartaPublica } = vi.hoisted(() => ({
  prismaFalso: { esPrismaFalso: true },
  resolverPortalCarta: vi.fn(async () => []),
  resolverCartaPublica: vi.fn(async () => null),
  portalCartaPublico: vi.fn(async () => []),
  cartaPublica: vi.fn(async () => null),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaFalso }));
vi.mock("@/core/carta/publica-consulta", () => ({ resolverPortalCarta, resolverCartaPublica }));
vi.mock("@/core/carta/publica-sin-sesion", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/core/carta/publica-sin-sesion")>();
  return { ...real, portalCartaPublico, cartaPublica };
});
vi.mock("@/components/carta-publica/portal-vista", () => ({ PortalVista: () => null }));
vi.mock("@/components/carta-publica/carta-vista", () => ({ CartaVista: () => null }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import PortalPage from "@/app/(carta-publica)/carta-publica/[empresa]/page";
import CartaPage from "@/app/(carta-publica)/carta-publica/[empresa]/[sucursal]/page";

/**
 * ADR-007, paso N3: la empresa resuelta llega por parámetro hasta la consulta. Hoy la base no tiene `empresaId`, así que la
 * empresa no cambia el resultado de la consulta — lo que se protege acá es que el contrato no se corte en ningún tramo.
 */
beforeEach(() => {
  vi.stubEnv("CARTA_EMPRESA_SLUG", "la-cuadra");
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("punto público sin sesión", () => {
  it("portalCartaPublico y cartaPublica pasan la empresa recibida (y la base) a la consulta", async () => {
    const empresa = { slug: "la-cuadra" };
    const real = await vi.importActual<typeof import("@/core/carta/publica-sin-sesion")>("@/core/carta/publica-sin-sesion");

    await real.portalCartaPublico(empresa);
    await real.cartaPublica(empresa, "central");

    expect(resolverPortalCarta).toHaveBeenCalledWith(empresa, prismaFalso);
    expect(resolverCartaPublica).toHaveBeenCalledWith(empresa, "central", prismaFalso);
  });
});

describe("páginas de la carta pública", () => {
  it("el portal pasa a la consulta la empresa que resolvió del segmento de ruta", async () => {
    await PortalPage({ params: Promise.resolve({ empresa: "la-cuadra" }) });
    expect(portalCartaPublico).toHaveBeenCalledWith({ slug: "la-cuadra" });
  });

  it("el portal no consulta nada si la empresa no resuelve", async () => {
    await expect(PortalPage({ params: Promise.resolve({ empresa: "otra" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(portalCartaPublico).not.toHaveBeenCalled();
  });

  it("la sucursal pasa a la consulta la empresa que resolvió del segmento de ruta", async () => {
    cartaPublica.mockResolvedValueOnce({ carta: {}, estilo: {} } as never);
    await CartaPage({ params: Promise.resolve({ empresa: "la-cuadra", sucursal: "central" }) });
    expect(cartaPublica).toHaveBeenCalledWith({ slug: "la-cuadra" }, "central");
  });

  it("la sucursal no consulta nada si la empresa no resuelve", async () => {
    await expect(CartaPage({ params: Promise.resolve({ empresa: "otra", sucursal: "central" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(cartaPublica).not.toHaveBeenCalled();
  });
});
