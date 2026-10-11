import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import type { Prisma } from "@prisma/client";
import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaSinEmpresa, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { crearMembresia } from "../setup/membresia";
import { agregarOActualizarUsuario } from "../../src/server/actions/auth/usuarios";
import { copiarCartaDeSucursal } from "../../src/server/actions/carta/copiar-carta";
import { copiarRecetaPropiaDeOtraSucursal, crearRecetaPropiaDesdeLaCentral } from "../../src/server/actions/catalogo/receta-sucursal";
import { guardarRecetaACiegas } from "../../src/server/actions/catalogo/receta-a-ciegas";
import { obtenerEstadoDeRecetaPropia } from "../../src/server/lecturas/catalogo/receta-propia";
import { habilitadaDeRecetaPropia, versionVigenteDeReceta } from "../setup/version-de-receta";

// Un espía transparente en la lectura del estado de la receta propia: deja ver con qué base se leyó el ORIGEN de la copia.
vi.mock("../../src/server/lecturas/catalogo/receta-propia", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/server/lecturas/catalogo/receta-propia")>();
  return { ...original, obtenerEstadoDeRecetaPropia: vi.fn(original.obtenerEstadoDeRecetaPropia) };
});

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

describe("M.3-A5: copiar la carta y la receta propias de otra sucursal (MEMBRESIA_EN_ORIGEN)", () => {
  // Central (activa de todos) y Norte (origen, con receta propia y carta propia). `dueno` es admin de las dos; `atacante`, admin solo de Central; `mixto`, admin de Central y operador de Norte.
  let central: string;
  let norte: string;
  let kgId: string;
  let pvId: string;
  let duenoId: string;
  let atacanteId: string;
  let mixtoId: string;
  const como = (id: string, email: string) => mockearUsuarioActual({ id, email, nombre: null });
  const copiarReceta = async (origen: string) => copiarRecetaPropiaDeOtraSucursal(pvId, origen, true, await versionVigenteDeReceta(pvId, central), await habilitadaDeRecetaPropia(pvId, central));
  /** Con qué alcance se leyó el estado de la receta propia de `sucursalId` (la base que recibió la lectura del origen), consultado en la propia base. */
  const alcanceDeLaLecturaDe = async (sucursalId: string): Promise<{ lectura: string[]; escritura: string[] } | null> => {
    const llamada = vi.mocked(obtenerEstadoDeRecetaPropia).mock.calls.find((c) => c[1] === sucursalId);
    if (!llamada) return null;
    const db = llamada[2];
    const [fila] = await db.$queryRaw<Variables[]>`SELECT current_setting('app.sucursales_lectura', true) AS lectura, current_setting('app.sucursales_escritura', true) AS escritura`;
    return { lectura: lista(fila!.lectura), escritura: lista(fila!.escritura) };
  };

  beforeEach(async () => {
    vi.restoreAllMocks();
    await limpiarBaseDeTest();
    __setCookieDeTestParaSucursal(undefined);
    const base = await sembrarBase();
    central = base.sucursal.id;
    norte = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    kgId = (await sembrarCatalogoBase()).kg.id;
    const dueno = await crearUsuarioConMembresia({ email: "dueno@test.com", sucursalId: central, rolId: base.admin.id });
    await crearMembresia({ usuarioId: dueno.id, sucursalId: norte, rolId: base.admin.id });
    duenoId = dueno.id;
    atacanteId = (await crearUsuarioConMembresia({ email: "atacante@test.com", sucursalId: central, rolId: base.admin.id })).id;
    const mixto = await crearUsuarioConMembresia({ email: "mixto@test.com", sucursalId: central, rolId: base.admin.id });
    await crearMembresia({ usuarioId: mixto.id, sucursalId: norte, rolId: base.operador.id });
    mixtoId = mixto.id;

    const harina = await sembrarProductoDisponible({ codigo: "MP_H", nombre: "Harina", tipo: "MP", unidadStockId: kgId }, central);
    pvId = (await sembrarProductoDisponible({ codigo: "PV_PIZZA", nombre: "Pizza", tipo: "PV", unidadStockId: kgId, precioVenta: 100 }, central)).id;
    await prisma.disponibilidadProducto.create({ data: { sucursalId: norte, productoId: pvId, disponible: true } });
    await como(dueno.id, dueno.email);
    __setCookieDeTestParaSucursal(central);
    expect((await guardarRecetaACiegas(pvId, [{ insumoProductoId: harina.id, cantidad: 1, unidadId: kgId, mermaPorcentaje: 0 }])).ok).toBe(true);
    __setCookieDeTestParaSucursal(norte);
    expect((await crearRecetaPropiaDesdeLaCentral(pvId, 0, false)).ok).toBe(true);
    __setCookieDeTestParaSucursal(undefined);
    const seccion = await prisma.seccionCarta.create({ data: { nombre: "Platos", orden: 1 } });
    await prisma.generoCarta.create({ data: { sucursalId: norte, nombre: "Pizzas", orden: 1 } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: norte, productoId: pvId, visibleEnCarta: true, seccionCartaId: seccion.id, descripcion: "Muzza" } });
    vi.mocked(obtenerEstadoDeRecetaPropia).mockClear();
  });

  describe("copiarCartaDeSucursal", () => {
    it("con «Ver» de la carta en Norte, la copia corre con LECTURA en Central y Norte y ESCRITURA solo en Central (nunca en el origen)", async () => {
      await como(duenoId, "dueno@test.com");
      const captura = capturarTransacciones();
      const r = await copiarCartaDeSucursal(norte, true);
      captura.restaurar();
      expect(r.ok, r.mensaje).toBe(true);
      expect(await prisma.generoCarta.count({ where: { sucursalId: central } })).toBe(1);
      const vista = captura.capturas.at(-1)!;
      expect(lista(vista.lectura)).toEqual([central, norte].sort());
      expect(lista(vista.escritura)).toEqual([central]);
    });

    it("sin membresía en Norte (atacante) o sin «Ver» de la carta allá (operador) se rechaza ANTES de ensanchar: ninguna transacción ve a Norte", async () => {
      for (const [id, email] of [[atacanteId, "atacante@test.com"], [mixtoId, "mixto@test.com"]] as const) {
        await como(id, email);
        const captura = capturarTransacciones();
        const r = await copiarCartaDeSucursal(norte, true);
        captura.restaurar();
        expect(r.ok).toBe(false);
        expect(await prisma.generoCarta.count({ where: { sucursalId: central } })).toBe(0);
        expect(captura.capturas.filter((v) => lista(v.lectura).includes(norte) || lista(v.escritura).includes(norte))).toEqual([]);
      }
    });
  });

  describe("copiarRecetaPropiaDeOtraSucursal", () => {
    it("con «Ver» de la copia en Norte, el origen se lee con LECTURA en Central y Norte, y la escritura de la copia corre solo con Central", async () => {
      await como(duenoId, "dueno@test.com");
      const captura = capturarTransacciones();
      const r = await copiarReceta(norte);
      captura.restaurar();
      expect(r.ok, r.mensaje).toBe(true);
      expect(await prisma.recetaVersion.count({ where: { sucursalId: central } })).toBe(1);
      expect(await alcanceDeLaLecturaDe(norte)).toEqual({ lectura: [central, norte].sort(), escritura: [central] });
      const escritura = captura.capturas.at(-1)!;
      expect(lista(escritura.lectura)).toEqual([central]);
      expect(lista(escritura.escritura)).toEqual([central]);
    });

    it("sin membresía en Norte (atacante) o sin «Ver» de la copia allá (operador) se rechaza ANTES de ensanchar: el origen nunca se lee", async () => {
      for (const [id, email] of [[atacanteId, "atacante@test.com"], [mixtoId, "mixto@test.com"]] as const) {
        await como(id, email);
        vi.mocked(obtenerEstadoDeRecetaPropia).mockClear();
        const captura = capturarTransacciones();
        const r = await copiarReceta(norte);
        captura.restaurar();
        expect(r.ok).toBe(false);
        expect(await alcanceDeLaLecturaDe(norte)).toBeNull();
        expect(await prisma.recetaVersion.count({ where: { sucursalId: central } })).toBe(0);
        expect(captura.capturas.filter((v) => lista(v.lectura).includes(norte) || lista(v.escritura).includes(norte))).toEqual([]);
      }
    });
  });
});
