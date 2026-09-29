import { afterEach, describe, expect, it, vi } from "vitest";
import { resolverEmpresaCarta } from "@/core/carta/empresa-carta";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolverEmpresaCarta", () => {
  it("resuelve la empresa cuando el slug coincide con CARTA_EMPRESA_SLUG", async () => {
    vi.stubEnv("CARTA_EMPRESA_SLUG", "la-cuadra");
    await expect(resolverEmpresaCarta("la-cuadra")).resolves.toEqual({ slug: "la-cuadra" });
  });

  it("da null si el slug no coincide", async () => {
    vi.stubEnv("CARTA_EMPRESA_SLUG", "la-cuadra");
    await expect(resolverEmpresaCarta("otra-empresa")).resolves.toBeNull();
  });

  it("da null si CARTA_EMPRESA_SLUG no está configurada", async () => {
    vi.stubEnv("CARTA_EMPRESA_SLUG", "");
    await expect(resolverEmpresaCarta("la-cuadra")).resolves.toBeNull();
  });

  it("es estrictamente sensible a mayúsculas (el slug de la URL llega ya en minúsculas por convención, no se normaliza acá)", async () => {
    vi.stubEnv("CARTA_EMPRESA_SLUG", "la-cuadra");
    await expect(resolverEmpresaCarta("La-Cuadra")).resolves.toBeNull();
  });
});
