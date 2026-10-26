import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { EMPRESA_POR_DEFECTO_ID, crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase } from "../setup/test-db";
import { activarTodosLosModulos, fijarModulosActivos } from "../setup/modulos";
import { accionesQueElUsuarioPuedeVer, requierePermisoVer, requierePermisoVerDeAlguna } from "../../src/server/acceso/gate";
import type { AccionDeSucursal } from "../../src/core/permisos/acciones";

/**
 * Fase 7, P2: `requierePermisoVerDeAlguna(usuarioId, sucursalId, claves, db)`, el gate de la página que es la entrada de varias pantallas. Contra Postgres real.
 * La regla: pasa si y solo si pasa `requierePermisoVer` de ALGUNA de las claves (membresía vigente, módulo de la empresa, capacidad de la sucursal y «Ver» del rol por encima
 * de su piso), devuelve las claves que se ven, y lo hace con la lectura única (sin una tanda de consultas por clave).
 */

// Cuatro claves de sucursal de módulos y pisos distintos: ajuste es de piso administrador (un operador no llega aunque la matriz diga «Ver»), consumo y transferencia son de
// `stock`, producción es de `produccion`.
const CLAVES: readonly [AccionDeSucursal, ...AccionDeSucursal[]] = ["proceso_ajuste", "proceso_consumo", "proceso_produccion", "proceso_transferencia"];

async function montar() {
  const base = await sembrarBase();
  await activarTodosLosModulos(EMPRESA_POR_DEFECTO_ID);
  const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
  const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
  return { base, admin, operador, sucursalId: base.sucursal.id };
}

/** Deja la matriz del rol EXACTAMENTE con «Ver» (y «Editar») en estas claves, de las cuatro. */
async function matrizDelRol(rolId: string, conVer: readonly AccionDeSucursal[]) {
  for (const clave of CLAVES) {
    const tiene = conVer.includes(clave);
    await prisma.permisoRol.update({ where: { rolId_accionClave: { rolId, accionClave: clave } }, data: { puedeVer: tiene, puedeEditar: tiene } });
  }
}

/** Lo que dice `requierePermisoVer` por cada clave: la referencia contra la que se compara. */
async function referencia(usuarioId: string, sucursalId: string, claves: readonly AccionDeSucursal[]) {
  const porClave = await Promise.all(claves.map(async (clave) => [clave, await requierePermisoVer(usuarioId, sucursalId, clave, prisma)] as const));
  return { algunaOk: porClave.some(([, g]) => g.ok), visibles: new Set(porClave.filter(([, g]) => g.ok).map(([c]) => c)), primera: porClave[0][1] };
}

const subconjuntos = <T,>(xs: readonly T[]): T[][] => xs.reduce<T[][]>((acc, x) => [...acc, ...acc.map((s) => [...s, x])], [[]]);

async function contarConsultas<T>(f: (db: PrismaClient) => Promise<T>): Promise<number> {
  let n = 0;
  const db = prisma.$extends({
    query: {
      $allModels: {
        $allOperations({ args, query }) {
          n++;
          return query(args);
        },
      },
    },
  }) as unknown as PrismaClient;
  await f(db);
  return n;
}

describe("requierePermisoVerDeAlguna: pasa si y solo si pasa requierePermisoVer de alguna de las claves", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  it("equivalencia sobre TODAS las matrices posibles de las cuatro claves para un rol de operador (el piso de ajuste lo deja afuera aunque la matriz diga Ver)", async () => {
    const { base, operador, sucursalId } = await montar();
    let probadas = 0;
    for (const conVer of subconjuntos(CLAVES)) {
      await matrizDelRol(base.operador.id, conVer);
      const ref = await referencia(operador.id, sucursalId, CLAVES);
      const gate = await requierePermisoVerDeAlguna(operador.id, sucursalId, CLAVES, prisma);
      const etiqueta = `matriz [${conVer.join(", ")}]`;
      expect(gate.ok, etiqueta).toBe(ref.algunaOk);
      expect([...gate.visibles].sort(), etiqueta).toEqual([...ref.visibles].sort());
      if (gate.ok) expect(gate.visibles.size, `${etiqueta}: si pasa, ve alguna`).toBeGreaterThan(0);
      else {
        expect(gate.visibles.size, `${etiqueta}: si se niega, no ve ninguna`).toBe(0);
        // El porqué es el del gate de la primera clave.
        expect(gate, etiqueta).toMatchObject({ ok: false, mensaje: ref.primera.ok ? undefined : ref.primera.mensaje });
      }
      probadas++;
    }
    expect(probadas).toBe(16);
  }, 120_000);

  it("el orden de las claves y las repetidas no cambian si pasa ni cuáles ve; el motivo de la negativa es el de la PRIMERA", async () => {
    const { base, operador, sucursalId } = await montar();
    await matrizDelRol(base.operador.id, ["proceso_produccion"]);
    const alReves = [...CLAVES].reverse() as unknown as typeof CLAVES;
    const conRepetidas: typeof CLAVES = ["proceso_produccion", "proceso_produccion", "proceso_consumo", "proceso_produccion"];
    for (const claves of [CLAVES, alReves, conRepetidas]) {
      const gate = await requierePermisoVerDeAlguna(operador.id, sucursalId, claves, prisma);
      expect(gate.ok).toBe(true);
      expect([...gate.visibles]).toEqual(["proceso_produccion"]);
    }

    await matrizDelRol(base.operador.id, []);
    const porAjuste = await requierePermisoVerDeAlguna(operador.id, sucursalId, ["proceso_ajuste", "proceso_consumo"], prisma);
    const porConsumo = await requierePermisoVerDeAlguna(operador.id, sucursalId, ["proceso_consumo", "proceso_ajuste"], prisma);
    expect(porAjuste).toMatchObject({ ok: false, mensaje: expect.stringContaining('"proceso_ajuste"') });
    expect(porConsumo).toMatchObject({ ok: false, mensaje: expect.stringContaining('"proceso_consumo"') });
  });

  it("un administrador ve las cuatro", async () => {
    const { admin, sucursalId } = await montar();
    const gate = await requierePermisoVerDeAlguna(admin.id, sucursalId, CLAVES, prisma);
    expect(gate.ok).toBe(true);
    expect([...gate.visibles].sort()).toEqual([...CLAVES].sort());
  });

  it("una sola clave se comporta como requierePermisoVer de esa clave (ok y mensaje)", async () => {
    const { base, operador, sucursalId } = await montar();
    await matrizDelRol(base.operador.id, ["proceso_consumo"]);
    for (const clave of CLAVES) {
      const ref = await requierePermisoVer(operador.id, sucursalId, clave, prisma);
      const gate = await requierePermisoVerDeAlguna(operador.id, sucursalId, [clave], prisma);
      expect(gate.ok, clave).toBe(ref.ok);
      if (!ref.ok) expect(gate, clave).toMatchObject({ ok: false, mensaje: ref.mensaje, motivo: ref.motivo });
    }
  });

  it("una membresía inactiva, o ninguna, se niega con el motivo de siempre y sin claves visibles", async () => {
    const { base, sucursalId } = await montar();
    const inactivo = await crearUsuarioConMembresia({ email: "inactivo@test.com", sucursalId, rolId: base.admin.id, activo: false });
    const sinMembresia = await prisma.user.create({ data: { email: "suelto@test.com" } });
    for (const usuario of [inactivo, sinMembresia]) {
      const ref = await referencia(usuario.id, sucursalId, CLAVES);
      expect(ref.algunaOk).toBe(false);
      const gate = await requierePermisoVerDeAlguna(usuario.id, sucursalId, CLAVES, prisma);
      expect(gate).toMatchObject({ ok: false, motivo: "SIN_PERMISO", caso: "SIN_ACCESO_A_SUCURSAL" });
      expect(gate.visibles.size).toBe(0);
    }
  });

  it("una capacidad apagada saca esa clave del conjunto; con todas apagadas se niega por la capacidad de la primera", async () => {
    const { admin, sucursalId } = await montar();
    await prisma.capacidadSucursal.create({ data: { accionClave: "proceso_consumo", sucursalId, habilitado: false } });
    const parcial = await requierePermisoVerDeAlguna(admin.id, sucursalId, CLAVES, prisma);
    expect(parcial.ok).toBe(true);
    expect([...parcial.visibles].sort()).toEqual(["proceso_ajuste", "proceso_produccion", "proceso_transferencia"]);
    expect([...parcial.visibles].sort()).toEqual([...(await referencia(admin.id, sucursalId, CLAVES)).visibles].sort());

    for (const clave of CLAVES) {
      if (clave !== "proceso_consumo") await prisma.capacidadSucursal.create({ data: { accionClave: clave, sucursalId, habilitado: false } });
    }
    const ninguna = await requierePermisoVerDeAlguna(admin.id, sucursalId, CLAVES, prisma);
    expect(ninguna).toMatchObject({ ok: false, motivo: "SIN_CAPACIDAD", accion: "proceso_ajuste" });
    expect(ninguna.visibles.size).toBe(0);
    expect((await referencia(admin.id, sucursalId, CLAVES)).algunaOk).toBe(false);
  });

  it("un módulo apagado saca las claves de ese módulo; sin ninguno activo se niega por el módulo de la primera", async () => {
    const { admin, sucursalId } = await montar();
    // `stock` (ajuste, consumo, transferencia) activo, `produccion` apagado.
    await fijarModulosActivos(EMPRESA_POR_DEFECTO_ID, ["stock"]);
    const parcial = await requierePermisoVerDeAlguna(admin.id, sucursalId, CLAVES, prisma);
    expect(parcial.ok).toBe(true);
    expect([...parcial.visibles].sort()).toEqual(["proceso_ajuste", "proceso_consumo", "proceso_transferencia"]);
    expect([...parcial.visibles].sort()).toEqual([...(await referencia(admin.id, sucursalId, CLAVES)).visibles].sort());

    await fijarModulosActivos(EMPRESA_POR_DEFECTO_ID, []);
    const ninguno = await requierePermisoVerDeAlguna(admin.id, sucursalId, CLAVES, prisma);
    expect(ninguno).toMatchObject({ ok: false, motivo: "MODULO_NO_ACTIVO", modulo: "stock" });
    expect(ninguno.visibles.size).toBe(0);
    expect((await referencia(admin.id, sucursalId, CLAVES)).algunaOk).toBe(false);
  });

  it("sin N+1: cuando pasa, hace las mismas consultas que la lectura única, con una clave o con cuatro", async () => {
    const { admin, sucursalId } = await montar();
    const lecturaUnica = await contarConsultas((db) => accionesQueElUsuarioPuedeVer(admin.id, sucursalId, CLAVES, db));
    const conCuatro = await contarConsultas((db) => requierePermisoVerDeAlguna(admin.id, sucursalId, CLAVES, db));
    const conUna = await contarConsultas((db) => requierePermisoVerDeAlguna(admin.id, sucursalId, ["proceso_consumo"], db));
    const porClave = await contarConsultas(async (db) => {
      for (const clave of CLAVES) await requierePermisoVer(admin.id, sucursalId, clave, db);
    });
    expect(conCuatro).toBe(lecturaUnica);
    expect(conUna).toBe(conCuatro);
    expect(conCuatro).toBeLessThan(porClave);
  });

  it("sin N+1 también cuando se niega: la tanda de consultas extra es la de UN gate (el de la primera clave), no una por clave", async () => {
    const { base, operador, sucursalId } = await montar();
    await matrizDelRol(base.operador.id, []);
    const lecturaUnica = await contarConsultas((db) => accionesQueElUsuarioPuedeVer(operador.id, sucursalId, CLAVES, db));
    const unGate = await contarConsultas((db) => requierePermisoVer(operador.id, sucursalId, CLAVES[0], db));
    const conCuatro = await contarConsultas((db) => requierePermisoVerDeAlguna(operador.id, sucursalId, CLAVES, db));
    const conDos = await contarConsultas((db) => requierePermisoVerDeAlguna(operador.id, sucursalId, [CLAVES[0], CLAVES[1]], db));
    expect(conCuatro).toBe(lecturaUnica + unGate);
    expect(conDos).toBe(conCuatro);
  });
});
