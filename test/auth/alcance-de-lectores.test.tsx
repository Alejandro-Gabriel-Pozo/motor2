import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

// Las consultas que cruzan sucursales se reemplazan por espías que devuelven «nada»: lo que se mide es CON QUÉ BASE (y por lo tanto con qué alcance por sucursal) las llama cada pantalla.
vi.mock("../../src/server/consultas/reportes/resumen-consolidado", () => ({ obtenerResumenConsolidado: vi.fn(async () => []) }));
vi.mock("../../src/server/consultas/reportes/rendimiento-por-sucursal", () => ({ compararRendimientosDeSucursales: vi.fn(async () => []) }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { crearMembresia } from "../setup/membresia";
import { obtenerResumenConsolidado } from "../../src/server/consultas/reportes/resumen-consolidado";
import { compararRendimientosDeSucursales } from "../../src/server/consultas/reportes/rendimiento-por-sucursal";
import ConsolidadoPage from "../../src/app/(app)/reportes/consolidado/page";
import RendimientoPorSucursalPage from "../../src/app/(app)/reportes/rendimiento-recetas/por-sucursal/page";

/**
 * M.3-A5, paso 3: las pantallas que miran VARIAS sucursales leen con la LECTURA ensanchada a las sucursales donde el usuario puede ver su clave (`lecturaEnSucursalesVisibles`), nunca con
 * la escritura ensanchada, y nunca con una sucursal donde el usuario no tiene membresía o su rol no tiene el «Ver». Postgres real, sucursales A (activa), B y C. Todavía no hay políticas por
 * sucursal (Fase B): lo que se mide es el alcance de la base con que cada pantalla llama a su consulta.
 * Mutaciones (revertidas editando): la consulta con `ctx.db` en lugar de la base ampliada; `lecturaEnSucursalesVisibles` con otra clave.
 */
type Variables = { lectura: string | null; escritura: string | null };
const lista = (v: string | null) => (v ? v.split(",").sort() : []);

/** El alcance con que quedó fijada una base (las variables que ve una consulta suya). */
async function alcanceDe(db: { $queryRaw: <T>(q: TemplateStringsArray) => Promise<T> }): Promise<{ lectura: string[]; escritura: string[] }> {
  const [fila] = await (db.$queryRaw as unknown as (q: TemplateStringsArray) => Promise<Variables[]>)`SELECT current_setting('app.sucursales_lectura', true) AS lectura, current_setting('app.sucursales_escritura', true) AS escritura`;
  return { lectura: lista(fila!.lectura), escritura: lista(fila!.escritura) };
}

/** Todo el texto que dibuja un árbol de elementos de React (sin renderizarlo: la página es un componente de servidor `async`). */
function textoDe(nodo: ReactNode): string {
  if (nodo === null || nodo === undefined || typeof nodo === "boolean") return "";
  if (typeof nodo === "string" || typeof nodo === "number") return String(nodo);
  if (Array.isArray(nodo)) return nodo.map(textoDe).join(" ");
  return textoDe((nodo as { props?: { children?: ReactNode } }).props?.children);
}

describe("M.3-A5: los lectores de varias sucursales", () => {
  let A: string;
  let B: string;
  let C: string;
  let rolAdminId: string;
  let rolOperadorId: string;
  let usuarioId: string;
  const como = (id: string, email: string) => mockearUsuarioActual({ id, email, nombre: null });

  beforeEach(async () => {
    vi.clearAllMocks();
    await limpiarBaseDeTest();
    __setCookieDeTestParaSucursal(undefined);
    const base = await sembrarBase();
    A = base.sucursal.id;
    B = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    C = (await prisma.sucursal.create({ data: { nombre: "Sur" } })).id;
    rolAdminId = base.admin.id;
    rolOperadorId = base.operador.id;
    const gerente = await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: A, rolId: rolAdminId });
    await crearMembresia({ usuarioId: gerente.id, sucursalId: B, rolId: rolAdminId, activo: true });
    usuarioId = gerente.id;
    await como(gerente.id, gerente.email);
  });

  describe("reporte consolidado (reporte_consolidado)", () => {
    it("un gerente con membresía en A y B lee A y B (no C), con la ESCRITURA solo en la activa, y la consulta recibe esas dos sucursales", async () => {
      await ConsolidadoPage();
      const llamada = vi.mocked(obtenerResumenConsolidado).mock.calls.at(-1)!;
      expect(llamada[0].map((s) => s.id).sort()).toEqual([A, B].sort());
      expect(await alcanceDe(llamada[1] as never)).toEqual({ lectura: [A, B].sort(), escritura: [A] });
    });

    it("donde el rol NO tiene el «Ver» de la clave (B como operador) no se lee B: la pantalla avisa que no hay nada que consolidar y la consulta no corre", async () => {
      await prisma.usuarioSucursal.updateMany({ where: { usuarioId, sucursalId: B }, data: { rolId: rolOperadorId } });
      const texto = textoDe(await ConsolidadoPage());
      expect(texto).toContain("no hay nada que consolidar");
      expect(obtenerResumenConsolidado).not.toHaveBeenCalled();
    });

    it("un usuario con membresía en una sola sucursal no lee otra: la pantalla no consulta (y su alcance es solo la activa)", async () => {
      const solo = await crearUsuarioConMembresia({ email: "solo@test.com", sucursalId: A, rolId: rolAdminId });
      await como(solo.id, solo.email);
      const texto = textoDe(await ConsolidadoPage());
      expect(texto).toContain("no hay nada que consolidar");
      expect(obtenerResumenConsolidado).not.toHaveBeenCalled();
    });

    it("la sucursal activa se elige por cookie, pero la cookie no agranda el alcance: con B activa, la lectura es A y B y la escritura solo B", async () => {
      __setCookieDeTestParaSucursal(B);
      await ConsolidadoPage();
      const llamada = vi.mocked(obtenerResumenConsolidado).mock.calls.at(-1)!;
      expect(await alcanceDe(llamada[1] as never)).toEqual({ lectura: [A, B].sort(), escritura: [B] });
      __setCookieDeTestParaSucursal(C);
      vi.mocked(obtenerResumenConsolidado).mockClear();
      await ConsolidadoPage();
      const sinC = vi.mocked(obtenerResumenConsolidado).mock.calls.at(-1)!;
      expect(sinC[0].map((s) => s.id)).not.toContain(C);
      expect((await alcanceDe(sinC[1] as never)).lectura).not.toContain(C);
    });
  });

  describe("rendimiento de recetas por sucursal (reporte_rendimiento_sucursal)", () => {
    const sinParametros = { searchParams: Promise.resolve({}) };

    it("un gerente con membresía en A y B compara A y B (no C), lee las dos y escribe solo en la activa", async () => {
      await RendimientoPorSucursalPage(sinParametros);
      const llamada = vi.mocked(compararRendimientosDeSucursales).mock.calls.at(-1)!;
      expect(llamada[0].map((s) => s.id).sort()).toEqual([A, B].sort());
      expect(await alcanceDe(llamada[2] as never)).toEqual({ lectura: [A, B].sort(), escritura: [A] });
    });

    it("donde el rol no ve la clave (B como operador) o con una sola membresía, la comparación es solo de la activa y la base lee solo la activa", async () => {
      await prisma.usuarioSucursal.updateMany({ where: { usuarioId, sucursalId: B }, data: { rolId: rolOperadorId } });
      await RendimientoPorSucursalPage(sinParametros);
      const sinB = vi.mocked(compararRendimientosDeSucursales).mock.calls.at(-1)!;
      expect(sinB[0].map((s) => s.id)).toEqual([A]);
      expect(await alcanceDe(sinB[2] as never)).toEqual({ lectura: [A], escritura: [A] });

      const solo = await crearUsuarioConMembresia({ email: "solo@test.com", sucursalId: A, rolId: rolAdminId });
      await como(solo.id, solo.email);
      await RendimientoPorSucursalPage(sinParametros);
      const unica = vi.mocked(compararRendimientosDeSucursales).mock.calls.at(-1)!;
      expect(unica[0].map((s) => s.id)).toEqual([A]);
      expect(await alcanceDe(unica[2] as never)).toEqual({ lectura: [A], escritura: [A] });
    });

    it("un filtro de la URL (`productoId`) llega a la consulta tal cual y no cambia el alcance; una sucursal en la URL no existe como parámetro", async () => {
      await RendimientoPorSucursalPage({ searchParams: Promise.resolve({ productoId: "x", sucursalId: C, sucursalIds: [C] }) });
      const llamada = vi.mocked(compararRendimientosDeSucursales).mock.calls.at(-1)!;
      expect(llamada[1]).toEqual({ productoId: "x", todas: false });
      expect(llamada[0].map((s) => s.id).sort()).toEqual([A, B].sort());
      expect((await alcanceDe(llamada[2] as never)).lectura).not.toContain(C);
    });
  });
});
