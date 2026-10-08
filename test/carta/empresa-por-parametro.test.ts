import { beforeEach, describe, expect, it, vi } from "vitest";

const EMPRESA = { id: "empresa_la_cuadra", slug: "la-cuadra", nombre: "La Cuadra" };

const { prismaFalso, resolverPortalCarta, resolverCartaPublica, resolverConfigPortal, portalCartaPublico, configPortalPublica, cartaPublica, resolverEmpresaCarta } = vi.hoisted(() => ({
  prismaFalso: { esPrismaFalso: true },
  resolverEmpresaCarta: vi.fn(async (slug: string) => (slug === "la-cuadra" ? { id: "empresa_la_cuadra", slug, nombre: "La Cuadra" } : null)),
  resolverPortalCarta: vi.fn(async () => []),
  resolverCartaPublica: vi.fn(async () => null),
  resolverConfigPortal: vi.fn(async () => ({})),
  portalCartaPublico: vi.fn(async () => []),
  configPortalPublica: vi.fn(async () => ({ variablesCss: {}, valores: {} })),
  cartaPublica: vi.fn(async () => null),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaFalso }));
vi.mock("@/core/auth/base", () => ({ dbDeEmpresa: (empresaId: string) => ({ dbDeEmpresa: empresaId }), verificarRolDeEjecucionDelProceso: async () => undefined }));
vi.mock("@/server/lecturas/carta/publica", () => ({ resolverPortalCarta, resolverCartaPublica, resolverConfigPortal }));
vi.mock("@/server/lecturas/carta/empresa", () => ({ resolverEmpresaCarta }));
vi.mock("@/server/carta-publica/sin-sesion", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/carta-publica/sin-sesion")>();
  return { ...real, portalCartaPublico, configPortalPublica, cartaPublica };
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
 * ADR-007, N3 + A3: la empresa se resuelve desde la base por el slug del segmento de ruta y llega por parámetro hasta la
 * consulta, que filtra por su id. Lo que se protege acá es que el contrato no se corte en ningún tramo.
 */
beforeEach(() => {
  vi.clearAllMocks();
});

describe("punto público sin sesión", () => {
  it("empresaCartaPublica resuelve el slug contra la base (el cliente sin sesión)", async () => {
    const real = await vi.importActual<typeof import("@/server/carta-publica/sin-sesion")>("@/server/carta-publica/sin-sesion");
    await real.empresaCartaPublica("la-cuadra");
    expect(resolverEmpresaCarta).toHaveBeenCalledWith("la-cuadra", prismaFalso);
  });

  it("portalCartaPublico y cartaPublica pasan la empresa recibida y la base DE ESA empresa (con contexto RLS) a la consulta", async () => {
    const real = await vi.importActual<typeof import("@/server/carta-publica/sin-sesion")>("@/server/carta-publica/sin-sesion");

    await real.portalCartaPublico(EMPRESA);
    await real.configPortalPublica(EMPRESA);
    const ahora = new Date();
    await real.cartaPublica(EMPRESA, "central", ahora);

    expect(resolverPortalCarta).toHaveBeenCalledWith(EMPRESA, { dbDeEmpresa: EMPRESA.id });
    expect(resolverConfigPortal).toHaveBeenCalledWith(EMPRESA, { dbDeEmpresa: EMPRESA.id });
    expect(resolverCartaPublica).toHaveBeenCalledWith(EMPRESA, "central", { dbDeEmpresa: EMPRESA.id }, ahora);
  });
});

describe("páginas de la carta pública", () => {
  it("el portal pasa a la consulta la empresa que resolvió del segmento de ruta", async () => {
    await PortalPage({ params: Promise.resolve({ empresa: "la-cuadra" }) });
    expect(portalCartaPublico).toHaveBeenCalledWith(EMPRESA);
    expect(configPortalPublica).toHaveBeenCalledWith(EMPRESA);
  });

  it("el portal no consulta nada si la empresa no resuelve", async () => {
    await expect(PortalPage({ params: Promise.resolve({ empresa: "otra" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(portalCartaPublico).not.toHaveBeenCalled();
    expect(configPortalPublica).not.toHaveBeenCalled();
  });

  it("la sucursal pasa a la consulta la empresa que resolvió del segmento de ruta", async () => {
    cartaPublica.mockResolvedValueOnce({ carta: {}, estilo: {} } as never);
    await CartaPage({ params: Promise.resolve({ empresa: "la-cuadra", sucursal: "central" }) });
    expect(cartaPublica).toHaveBeenCalledWith(EMPRESA, "central", expect.any(Date));
  });

  it("la sucursal no consulta nada si la empresa no resuelve", async () => {
    await expect(CartaPage({ params: Promise.resolve({ empresa: "otra", sucursal: "central" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(cartaPublica).not.toHaveBeenCalled();
  });
});
