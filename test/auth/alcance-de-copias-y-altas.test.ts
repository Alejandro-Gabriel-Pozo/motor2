import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import type { Prisma } from "@prisma/client";
import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaSinEmpresa, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { crearMembresia } from "../setup/membresia";
import { agregarOActualizarUsuario } from "../../src/server/actions/auth/usuarios";

/**
 * M.3-A5, pasos 1 y 2: las acciones que trabajan en OTRA sucursal que la activa corren con el alcance ensanchado a ESA sucursal y a ninguna más. Postgres real; tres sucursales (A activa, B con
 * membresía, C sin membresía). Todavía no hay políticas por sucursal (Fase B): lo que se mide es CON QUÉ ALCANCE corre cada transacción del caso de uso (las variables `app.sucursales_*` que ve
 * su cuerpo), y que el resultado de siempre no cambie.
 * Mutaciones (revertidas editando): sacar `permisoYAlcanceEnSucursal` de `agregarOActualizarUsuario` (el alta en B corre solo con A); ensancharla antes del gate; pedir `LECTURA_Y_ESCRITURA` en el
 * origen de una copia (la escritura de la copia llegaría al origen).
 */
type Variables = { lectura: string | null; escritura: string | null };
const variables = async (tx: Prisma.TransactionClient): Promise<Variables> =>
  (await tx.$queryRaw<Variables[]>`SELECT current_setting('app.sucursales_lectura', true) AS lectura, current_setting('app.sucursales_escritura', true) AS escritura`)[0]!;
const lista = (v: string | null) => (v ? v.split(",").sort() : []);

/** Las variables que dejó cada transacción interactiva que abrió el cliente del proceso, leídas ANTES de que termine (lo que vio todo su cuerpo). */
function capturarTransacciones() {
  const capturas: Variables[] = [];
  const original = prismaSinEmpresa.$transaction.bind(prismaSinEmpresa) as (...args: unknown[]) => Promise<unknown>;
  const espia = vi.spyOn(prismaSinEmpresa, "$transaction").mockImplementation(((fn: unknown, opciones?: unknown) => {
    if (typeof fn !== "function") return original(fn, opciones);
    return original(async (tx: Prisma.TransactionClient) => {
      const resultado = await (fn as (t: Prisma.TransactionClient) => Promise<unknown>)(tx);
      capturas.push(await variables(tx));
      return resultado;
    }, opciones);
  }) as never);
  return { capturas, restaurar: () => espia.mockRestore() };
}

describe("M.3-A5: las altas y las copias en otra sucursal corren con el alcance de ESA sucursal", () => {
  let A: string;
  let B: string;
  let C: string;
  let rolAdminId: string;
  let rolOperadorId: string;
  let admin: { id: string; email: string };

  beforeEach(async () => {
    vi.restoreAllMocks();
    await limpiarBaseDeTest();
    __setCookieDeTestParaSucursal(undefined);
    const base = await sembrarBase();
    A = base.sucursal.id;
    B = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    C = (await prisma.sucursal.create({ data: { nombre: "Sur" } })).id;
    rolAdminId = base.admin.id;
    rolOperadorId = base.operador.id;
    admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: A, rolId: rolAdminId });
    await crearMembresia({ usuarioId: admin.id, sucursalId: B, rolId: rolAdminId, activo: true });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  describe("agregarOActualizarUsuario (GATE_EN_ESA_SUCURSAL)", () => {
    it("el alta en la sucursal B (donde el admin tiene `gestion_usuarios`) corre con lectura y escritura en A y B, y en ninguna más", async () => {
      const otro = await crearUsuarioConMembresia({ email: "otro@test.com", sucursalId: A, rolId: rolOperadorId });
      const captura = capturarTransacciones();
      const r = await agregarOActualizarUsuario({ email: otro.email, sucursalId: B, rolId: rolOperadorId });
      captura.restaurar();
      expect(r.ok, r.mensaje).toBe(true);
      expect(await prisma.usuarioSucursal.count({ where: { usuarioId: otro.id, sucursalId: B, activo: true } })).toBe(1);
      const vista = captura.capturas.at(-1)!;
      expect(lista(vista.lectura)).toEqual([A, B].sort());
      expect(lista(vista.escritura)).toEqual([A, B].sort());
      expect(lista(vista.escritura)).not.toContain(C);
    });

    it("el alta en la sucursal ACTIVA no ensancha nada: la transacción corre solo con A", async () => {
      const otro = await crearUsuarioConMembresia({ email: "otro@test.com", sucursalId: B, rolId: rolOperadorId });
      const captura = capturarTransacciones();
      const r = await agregarOActualizarUsuario({ email: otro.email, sucursalId: A, rolId: rolOperadorId });
      captura.restaurar();
      expect(r.ok, r.mensaje).toBe(true);
      const vista = captura.capturas.at(-1)!;
      expect(lista(vista.lectura)).toEqual([A]);
      expect(lista(vista.escritura)).toEqual([A]);
    });

    it("una sucursal sin membresía (C) o donde el rol no tiene la clave (B como operador) se rechaza y no corre ninguna transacción del caso de uso", async () => {
      const otro = await crearUsuarioConMembresia({ email: "otro@test.com", sucursalId: A, rolId: rolOperadorId });
      const sinMembresia = capturarTransacciones();
      const aC = await agregarOActualizarUsuario({ email: otro.email, sucursalId: C, rolId: rolOperadorId });
      sinMembresia.restaurar();
      expect(aC.ok).toBe(false);
      expect(await prisma.usuarioSucursal.count({ where: { usuarioId: otro.id, sucursalId: C } })).toBe(0);
      expect(sinMembresia.capturas.filter((v) => lista(v.escritura).includes(C))).toEqual([]);

      await prisma.usuarioSucursal.updateMany({ where: { usuarioId: admin.id, sucursalId: B }, data: { rolId: rolOperadorId } });
      const sinClave = capturarTransacciones();
      const aB = await agregarOActualizarUsuario({ email: otro.email, sucursalId: B, rolId: rolOperadorId });
      sinClave.restaurar();
      expect(aB.ok).toBe(false);
      expect(await prisma.usuarioSucursal.count({ where: { usuarioId: otro.id, sucursalId: B } })).toBe(0);
      expect(sinClave.capturas.filter((v) => lista(v.escritura).includes(B))).toEqual([]);
    });
  });
});
