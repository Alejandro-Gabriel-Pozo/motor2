import { beforeEach, describe, expect, it, vi } from "vitest";

const { unstableCache, revalidateTag, revalidatePath } = vi.hoisted(() => ({
  unstableCache: vi.fn<(fn: () => unknown, claves: string[], opciones: { tags: string[]; revalidate: number }) => () => unknown>((fn) => fn),
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("next/cache", () => ({ unstable_cache: unstableCache, revalidateTag, revalidatePath }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/core/auth/base", () => ({ dbDeEmpresa: (empresaId: string) => ({ dbDeEmpresa: empresaId }), verificarRolDeEjecucionDelProceso: async () => undefined }));
vi.mock("@/server/acceso/modulos-de-empresa", () => ({ modulosEfectivosDeEmpresa: async () => new Set(["carta", "promociones"]) }));
vi.mock("@/server/lecturas/carta/publica", () => ({ resolverCartaPublica: vi.fn(async () => null), resolverPortalCarta: vi.fn(), resolverConfigPortal: vi.fn() }));
vi.mock("@/server/lecturas/carta/empresa", () => ({ resolverEmpresaCarta: vi.fn() }));

import { cartaPublica } from "@/server/carta-publica/sin-sesion";
import { revalidarCartasPublicas } from "@/server/actions/carta/revalidar";

/**
 * S-26 (plan de endurecimiento de seguridad, tanda T9): una mutación de carta de la empresa A invalida SOLO las cartas de A. Acá, los dos extremos de la mecánica, sin
 * Next: (1) la carta de cada empresa se marca con la etiqueta de SU empresa, y (2) la invalidación pide esa etiqueta y ninguna otra cosa (jamás `revalidatePath`, que
 * con el patrón `[empresa]` era la de todas). Que Next de verdad no saque del caché la carta de B lo prueba, sobre el artefacto de producción y con dos empresas,
 * `test/e2e/carta-publica-cache-por-empresa.spec.ts`.
 */
const A = { id: "empresa_a", slug: "empresa-a", nombre: "A" };
const B = { id: "empresa_b", slug: "empresa-b", nombre: "B" };

beforeEach(() => vi.clearAllMocks());

describe("la carta de cada empresa lleva la etiqueta de su empresa", () => {
  it("cartaPublica marca el caché con la etiqueta de la empresa, y la clave incluye empresa y sucursal (dos empresas con una sucursal «central» no comparten entrada)", async () => {
    await cartaPublica(A, "central", new Date());
    await cartaPublica(B, "central", new Date());
    const [llamadaA, llamadaB] = unstableCache.mock.calls;
    expect(llamadaA[2].tags).toEqual(["carta-publica:empresa-a"]);
    expect(llamadaB[2].tags).toEqual(["carta-publica:empresa-b"]);
    expect(llamadaA[1]).toContain(A.id);
    expect(llamadaB[1]).toContain(B.id);
    expect(llamadaA[1]).toContain("central");
    expect(llamadaA[1]).not.toEqual(llamadaB[1]);
  });

  it("el caché de la carta dura lo mismo que el ISR de la página (300 s): Next toma el menor de los dos, uno más corto acortaría la página", async () => {
    await cartaPublica(A, "central", new Date());
    expect(unstableCache.mock.calls[0][2].revalidate).toBe(300);
  });
});

describe("revalidarCartasPublicas(empresa) invalida la etiqueta de esa empresa y nada más", () => {
  it("pide la etiqueta de A con expiración inmediata, y no toca la de B ni ninguna ruta", () => {
    revalidarCartasPublicas(A.slug);
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(revalidateTag).toHaveBeenCalledWith("carta-publica:empresa-a", { expire: 0 });
    expect(revalidateTag).not.toHaveBeenCalledWith("carta-publica:empresa-b", expect.anything());
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("la etiqueta que invalida A es exactamente la que lleva la carta de A, y no la de B", async () => {
    await cartaPublica(A, "central", new Date());
    await cartaPublica(B, "central", new Date());
    revalidarCartasPublicas(A.slug);
    const invalidada = revalidateTag.mock.calls[0][0] as string;
    expect(unstableCache.mock.calls[0][2].tags).toContain(invalidada);
    expect(unstableCache.mock.calls[1][2].tags).not.toContain(invalidada);
  });

  it("traga solo el error E263 (fuera de un pedido de Next) y deja pasar cualquier otro", () => {
    revalidateTag.mockImplementationOnce(() => {
      throw Object.assign(new Error("static generation store missing"), { __NEXT_ERROR_CODE: "E263" });
    });
    expect(() => revalidarCartasPublicas(A.slug)).not.toThrow();
    revalidateTag.mockImplementationOnce(() => {
      throw new Error("otro");
    });
    expect(() => revalidarCartasPublicas(A.slug)).toThrow("otro");
  });
});
