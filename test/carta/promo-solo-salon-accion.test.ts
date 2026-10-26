import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

import { revalidateTag } from "next/cache";
import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { guardarSoloSalonPromoCarta } from "../../src/server/actions/carta/promos";
import { etiquetaDeCacheDeCartasPublicas } from "../../src/core/carta/public";
import { guardComandoGuardarSoloSalonPromoCarta } from "../../src/core/features/carta/promos.guard";

/**
 * Interruptor «solo salón» (docs/diseno-promo-solo-salon-2026-10-26.md, paso 4): la Server Action `guardarSoloSalonPromoCarta`, contra Postgres real. Autorización en el SERVIDOR (`carta_promo_definir`, de la empresa), validación de las entradas
 * (el guard), errores explícitos, la auditoría y la revalidación de la carta pública: SOLO si hubo cambio y DESPUÉS de confirmar (un rechazo, una versión vieja y un pedido repetido no invalidan el caché).
 *
 * Mutaciones demostradas (rojo y revertidas): cambiar `conPermisoDeEmpresa("carta_promo_definir", …)` por `conPermiso("carta_ver", …)` (rojo: «sin el permiso»); revalidar siempre que salga bien, no solo con cambio (rojo: «repetido»); revalidar antes de
 * llamar al caso de uso (rojo: «versión vieja»).
 */
describe("guardarSoloSalonPromoCarta (Server Action)", () => {
  let sucursalId: string;
  let promoId: string;
  let adminId: string;
  let operadorRolId: string;
  let operadorSinPermiso: { id: string; email: string };

  beforeEach(async () => {
    await limpiarBaseDeTest();
    vi.mocked(revalidateTag).mockClear();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    operadorRolId = base.operador.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    adminId = admin.id;
    operadorSinPermiso = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: operadorRolId });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    const seccionId = (await prisma.seccionCarta.create({ data: { nombre: "Menús" } })).id;
    promoId = (await prisma.promoCarta.create({ data: { seccionCartaId: seccionId, titulo: "Menú pactado", precio: 20000, sucursales: { create: { sucursalId } } } })).id;
  });

  const promo = () => prisma.promoCarta.findUniqueOrThrow({ where: { id: promoId } });
  const filasDeAuditoria = () => prismaAdmin.registroAuditoria.findMany({ where: { entidad: "PromoCarta", campo: "soloSalon" } });

  it("con el permiso: prende el interruptor, audita (quién y de qué a qué) y revalida la carta pública de ESA empresa, una vez, después de confirmar", async () => {
    const r = await guardarSoloSalonPromoCarta({ promoCartaId: promoId, versionEsperada: 1, soloSalon: true });
    expect(r).toMatchObject({ ok: true });
    expect(await promo()).toMatchObject({ soloSalon: true, version: 2 });
    const filas = await filasDeAuditoria();
    expect(filas.map((f) => [f.entidadId, f.valorAnterior, f.valorNuevo, f.actorId])).toEqual([[promoId, "false", "true", adminId]]);
    expect(vi.mocked(revalidateTag).mock.calls).toHaveLength(1);
    const [etiqueta, opciones] = vi.mocked(revalidateTag).mock.calls[0]!;
    expect(etiqueta).toBe(etiquetaDeCacheDeCartasPublicas("principal"));
    expect(opciones).toEqual({ expire: 0 });
  });

  it("un pedido repetido (doble clic) es éxito sin cambio: ni auditoría duplicada ni revalidación", async () => {
    expect(await guardarSoloSalonPromoCarta({ promoCartaId: promoId, versionEsperada: 1, soloSalon: true })).toMatchObject({ ok: true });
    vi.mocked(revalidateTag).mockClear();
    expect(await guardarSoloSalonPromoCarta({ promoCartaId: promoId, versionEsperada: 1, soloSalon: true })).toMatchObject({ ok: true });
    expect(await promo()).toMatchObject({ soloSalon: true, version: 2 });
    expect(await filasDeAuditoria()).toHaveLength(1);
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
  });

  it("con una versión vieja y otro valor: error explícito que pide recargar, sin escribir, auditar ni revalidar", async () => {
    expect(await guardarSoloSalonPromoCarta({ promoCartaId: promoId, versionEsperada: 1, soloSalon: true })).toMatchObject({ ok: true });
    vi.mocked(revalidateTag).mockClear();
    const r = await guardarSoloSalonPromoCarta({ promoCartaId: promoId, versionEsperada: 1, soloSalon: false });
    expect(r).toMatchObject({ ok: false });
    expect(r.mensaje).toMatch(/Otra persona cambió «Menú pactado».*Recargá la pantalla/);
    expect(await promo()).toMatchObject({ soloSalon: true, version: 2 });
    expect(await filasDeAuditoria()).toHaveLength(1);
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
  });

  it("sin el permiso `carta_promo_definir` (el operador arranca sin él) no escribe, no audita ni revalida", async () => {
    await mockearUsuarioActual({ id: operadorSinPermiso.id, email: operadorSinPermiso.email, nombre: null });
    const r = await guardarSoloSalonPromoCarta({ promoCartaId: promoId, versionEsperada: 1, soloSalon: true });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/No tenés permiso/);
    expect(await promo()).toMatchObject({ soloSalon: false, version: 1 });
    expect(await filasDeAuditoria()).toHaveLength(0);
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
  });

  it("sin sesión no hace nada (la acción manda al login)", async () => {
    const { getUsuarioActual } = await import("../../src/server/sesion/session");
    vi.mocked(getUsuarioActual).mockResolvedValue(null);
    await expect(guardarSoloSalonPromoCarta({ promoCartaId: promoId, versionEsperada: 1, soloSalon: true })).rejects.toThrow("NEXT_REDIRECT");
    expect(await promo()).toMatchObject({ soloSalon: false, version: 1 });
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
  });

  it("una promo que no existe: «No se encontró la promo.», sin revalidar", async () => {
    const r = await guardarSoloSalonPromoCarta({ promoCartaId: "no-existe", versionEsperada: 1, soloSalon: true });
    expect(r).toMatchObject({ ok: false, mensaje: "No se encontró la promo." });
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
  });

  describe("validación de las entradas (el guard): errores explícitos, sin tocar la base", () => {
    const malas: [string, Record<string, unknown>][] = [
      ["el id no es un texto", { promoCartaId: 7, versionEsperada: 1, soloSalon: true }],
      ["el id está vacío", { promoCartaId: "", versionEsperada: 1, soloSalon: true }],
      ["el id es larguísimo", { promoCartaId: "x".repeat(65), versionEsperada: 1, soloSalon: true }],
      ["la versión no es un número", { promoCartaId: "p", versionEsperada: "1", soloSalon: true }],
      ["la versión no es entera", { promoCartaId: "p", versionEsperada: 1.5, soloSalon: true }],
      ["la versión es 0", { promoCartaId: "p", versionEsperada: 0, soloSalon: true }],
      ["falta la versión", { promoCartaId: "p", soloSalon: true }],
      ["el interruptor es un texto", { promoCartaId: "p", versionEsperada: 1, soloSalon: "true" }],
      ["el interruptor es un número", { promoCartaId: "p", versionEsperada: 1, soloSalon: 1 }],
      ["falta el interruptor", { promoCartaId: "p", versionEsperada: 1 }],
    ];
    for (const [caso, entrada] of malas) {
      it(`rechaza si ${caso}`, async () => {
        expect(guardComandoGuardarSoloSalonPromoCarta(entrada as never).ok, caso).toBe(false);
        const r = await guardarSoloSalonPromoCarta(entrada as never);
        expect(r.ok).toBe(false);
        expect(r.mensaje.length).toBeGreaterThan(5);
        expect(await promo()).toMatchObject({ soloSalon: false, version: 1 });
        expect(await filasDeAuditoria()).toHaveLength(0);
        expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
      });
    }

    it("acepta el comando bien formado", () => {
      expect(guardComandoGuardarSoloSalonPromoCarta({ promoCartaId: "p", versionEsperada: 3, soloSalon: false })).toEqual({ ok: true, valor: { promoCartaId: "p", versionEsperada: 3, soloSalon: false } });
    });
  });
});
