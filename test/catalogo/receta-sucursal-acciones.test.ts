import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { crearMembresia } from "../setup/membresia";
import { versionVigenteDeReceta } from "../setup/version-de-receta";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import {
  actualizarIngredienteDeRecetaPropia,
  agregarIngredienteARecetaPropia,
  copiarRecetaPropiaDeOtraSucursal,
  crearRecetaPropiaDesdeLaCentral,
  quitarIngredienteDeRecetaPropia,
  volverALaRecetaCentral,
} from "../../src/server/actions/catalogo/receta-sucursal";
import { guardarReceta } from "../../src/server/actions/catalogo/recetas";
import { listarSucursalesConRecetaPropia, obtenerEstadoDeRecetaPropia } from "../../src/server/consultas/catalogo/receta-propia";
import { ALCANCE_CENTRAL, alcanceDeSucursal } from "../../src/core/catalogo/public";
import { cargarRecetaVigente } from "../../src/server/lecturas/catalogo/recetas-vigentes";

/**
 * Receta propia por sucursal (ADR-009 override, R3/R4) de punta a punta contra Postgres real: las seis acciones de
 * `server/actions/catalogo/receta-sucursal.ts`, con dos sucursales (Central y Norte) y un admin que pertenece a las dos.
 */
describe("receta propia por sucursal: acciones", () => {
  let centralId: string;
  let norteId: string;
  let kgId: string;
  let adminId: string;
  let operadorId: string;
  let pv: { id: string; nombre: string };
  let harina: { id: string };
  let queso: { id: string };
  let tomate: { id: string };
  let rolAdminId: string;

  const linea = (insumoProductoId: string, cantidad: number, mermaPorcentaje = 0) => ({ insumoProductoId, cantidad, unidadId: kgId, mermaPorcentaje });
  // La sucursal activa del test (la que fija la cookie; sin ella, la primera membresía: Central): de su receta propia es la versión que la pantalla mostraría (`versionVista`, H7).
  let sucursalActiva: string | undefined;
  const enSucursal = (id: string) => {
    sucursalActiva = id;
    return __setCookieDeTestParaSucursal(id);
  };
  const versionPropia = (productoId: string) => versionVigenteDeReceta(productoId, sucursalActiva ?? centralId);
  const propias = (sucursalId: string) => prisma.recetaVersion.findMany({ where: { productoId: pv.id, sucursalId }, orderBy: { version: "asc" }, include: { ingredientes: true } });
  const centrales = () => prisma.recetaVersion.findMany({ where: { productoId: pv.id, sucursalId: null }, orderBy: { version: "asc" }, include: { ingredientes: true } });
  const idsDe = (v: { ingredientes: { insumoProductoId: string }[] }) => v.ingredientes.map((i) => i.insumoProductoId).sort();
  const sinPropias = async () => {
    expect(await prisma.recetaSucursal.count()).toBe(0);
    expect(await prisma.recetaVersion.count({ where: { sucursalId: { not: null } } })).toBe(0);
  };

  beforeEach(async () => {
    await limpiarBaseDeTest();
    enSucursal(undefined as unknown as string);
    const base = await sembrarBase();
    centralId = base.sucursal.id;
    rolAdminId = base.admin.id;
    norteId = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    const { kg } = await sembrarCatalogoBase();
    kgId = kg.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: centralId, rolId: base.admin.id });
    await crearMembresia({ usuarioId: admin.id, sucursalId: norteId, rolId: base.admin.id });
    adminId = admin.id;
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: centralId, rolId: base.operador.id });
    operadorId = operador.id;
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    harina = await sembrarProductoDisponible({ codigo: "MP_H", nombre: "Harina", tipo: "MP", unidadStockId: kgId }, centralId);
    queso = await sembrarProductoDisponible({ codigo: "MP_Q", nombre: "Queso", tipo: "MP", unidadStockId: kgId }, centralId);
    tomate = await sembrarProductoDisponible({ codigo: "MP_T", nombre: "Tomate", tipo: "MP", unidadStockId: kgId }, centralId);
    pv = await sembrarProductoDisponible({ codigo: "PV_PIZZA", nombre: "Pizza", tipo: "PV", unidadStockId: kgId, precioVenta: 100 }, centralId);
    await prisma.disponibilidadProducto.create({ data: { sucursalId: norteId, productoId: pv.id, disponible: true } });
    // Receta central v1: harina 1 + queso 2 (con el actor en Central, cookie sin fijar = la membresía más antigua).
    const r = await guardarReceta(pv.id, [linea(harina.id, 1), linea(queso.id, 2, 10)]);
    expect(r.ok, r.mensaje).toBe(true);
  });

  describe("crear la receta propia a partir de la central", () => {
    it("copia la central vigente como v1 de la serie propia, la habilita y deja la central intacta", async () => {
      const central = (await centrales())[0];
      const r = await crearRecetaPropiaDesdeLaCentral(pv.id, await versionPropia(pv.id));
      expect(r.ok, r.mensaje).toBe(true);

      const [propia, ...resto] = await propias(centralId);
      expect(resto).toEqual([]);
      expect(propia).toMatchObject({ version: 1, sucursalId: centralId, basadaEnVersionId: central.id });
      expect(idsDe(propia)).toEqual([harina.id, queso.id].sort());
      expect(Number(propia.ingredientes.find((i) => i.insumoProductoId === queso.id)?.mermaPorcentaje)).toBe(10);
      expect(await prisma.recetaSucursal.findMany({ select: { sucursalId: true, productoId: true, habilitada: true } })).toEqual([{ sucursalId: centralId, productoId: pv.id, habilitada: true }]);
      expect((await centrales()).map((v) => v.version)).toEqual([1]);
    });

    it("deja auditoría de la versión y de la habilitación, con la sucursal", async () => {
      await crearRecetaPropiaDesdeLaCentral(pv.id, await versionPropia(pv.id));
      const filas = await prisma.registroAuditoria.findMany({ where: { sucursalId: centralId, entidad: { in: ["RecetaVersion", "RecetaSucursal"] } }, orderBy: { entidad: "asc" } });
      expect(filas.map((f) => [f.entidad, f.campo, f.actorId])).toEqual([
        ["RecetaSucursal", "habilitada", adminId],
        ["RecetaVersion", "version", adminId],
      ]);
      expect(filas.find((f) => f.entidad === "RecetaVersion")?.descripcion).toContain("Receta propia");
    });

    it("siempre opera sobre la sucursal ACTIVA de la sesión (no hay parámetro de sucursal)", async () => {
      enSucursal(norteId);
      const r = await crearRecetaPropiaDesdeLaCentral(pv.id, await versionPropia(pv.id));
      expect(r.ok, r.mensaje).toBe(true);
      expect(await propias(centralId)).toEqual([]);
      expect((await propias(norteId)).map((v) => v.version)).toEqual([1]);
      expect(await prisma.recetaSucursal.findMany({ select: { sucursalId: true } })).toEqual([{ sucursalId: norteId }]);
    });

    it("no se puede crear dos veces, ni sin receta central de la que partir", async () => {
      expect((await crearRecetaPropiaDesdeLaCentral(pv.id, await versionPropia(pv.id))).ok).toBe(true);
      const otra = await crearRecetaPropiaDesdeLaCentral(pv.id, await versionPropia(pv.id));
      expect(otra.ok).toBe(false);
      expect(otra.mensaje).toContain("ya tiene receta propia");
      expect(await propias(centralId)).toHaveLength(1);

      const sinCentral = await sembrarProductoDisponible({ codigo: "PV_SIN", nombre: "Sin receta", tipo: "PV", unidadStockId: kgId, precioVenta: 1 }, centralId);
      const r = await crearRecetaPropiaDesdeLaCentral(sinCentral.id, await versionPropia(sinCentral.id));
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("no tiene receta central");
    });
  });

  describe("editar la receta propia", () => {
    beforeEach(async () => {
      expect((await crearRecetaPropiaDesdeLaCentral(pv.id, await versionPropia(pv.id))).ok).toBe(true);
    });

    it("agregar, actualizar y quitar generan versiones de la serie propia (numeradas por su cuenta); la central no se mueve", async () => {
      expect((await agregarIngredienteARecetaPropia(pv.id, linea(tomate.id, 3), await versionPropia(pv.id))).ok).toBe(true);
      expect((await actualizarIngredienteDeRecetaPropia(pv.id, queso.id, { cantidad: 5, unidadId: kgId, mermaPorcentaje: 20 }, await versionPropia(pv.id))).ok).toBe(true);
      expect((await quitarIngredienteDeRecetaPropia(pv.id, harina.id, await versionPropia(pv.id))).ok).toBe(true);

      const versiones = await propias(centralId);
      expect(versiones.map((v) => v.version)).toEqual([1, 2, 3, 4]);
      expect(idsDe(versiones[1])).toEqual([harina.id, queso.id, tomate.id].sort());
      const vigente = versiones[3];
      expect(idsDe(vigente)).toEqual([queso.id, tomate.id].sort());
      const q = vigente.ingredientes.find((i) => i.insumoProductoId === queso.id);
      expect([Number(q?.cantidad), Number(q?.mermaPorcentaje)]).toEqual([5, 20]);

      const central = await centrales();
      expect(central.map((v) => v.version)).toEqual([1]);
      expect(idsDe(central[0])).toEqual([harina.id, queso.id].sort());
    });

    it("la numeración de la propia y la de la central son independientes", async () => {
      expect((await guardarReceta(pv.id, [linea(harina.id, 9)])).ok).toBe(true); // central v2
      expect((await agregarIngredienteARecetaPropia(pv.id, linea(tomate.id, 1), await versionPropia(pv.id))).ok).toBe(true); // propia v2
      expect((await centrales()).map((v) => v.version)).toEqual([1, 2]);
      expect((await propias(centralId)).map((v) => v.version)).toEqual([1, 2]);
    });

    it("rechaza un ingrediente repetido, y editar o quitar uno que no está", async () => {
      expect((await agregarIngredienteARecetaPropia(pv.id, linea(harina.id, 1), await versionPropia(pv.id))).mensaje).toContain("ya está");
      expect((await actualizarIngredienteDeRecetaPropia(pv.id, tomate.id, { cantidad: 1, unidadId: kgId }, await versionPropia(pv.id))).ok).toBe(false);
      expect((await quitarIngredienteDeRecetaPropia(pv.id, tomate.id, await versionPropia(pv.id))).ok).toBe(false);
      expect(await propias(centralId)).toHaveLength(1);
    });

    it("rechaza una cantidad inválida (la validación es la misma que la de la receta central)", async () => {
      const r = await actualizarIngredienteDeRecetaPropia(pv.id, queso.id, { cantidad: 0, unidadId: kgId }, await versionPropia(pv.id));
      expect(r.ok).toBe(false);
      expect(await propias(centralId)).toHaveLength(1);
    });

    it("editar, agregar o quitar sin receta propia habilitada se rechaza (no se edita la central por la puerta de atrás)", async () => {
      enSucursal(norteId);
      expect((await actualizarIngredienteDeRecetaPropia(pv.id, queso.id, { cantidad: 1, unidadId: kgId }, await versionPropia(pv.id))).ok).toBe(false);
      expect((await quitarIngredienteDeRecetaPropia(pv.id, queso.id, await versionPropia(pv.id))).ok).toBe(false);
      const agregar = await agregarIngredienteARecetaPropia(pv.id, linea(tomate.id, 1), await versionPropia(pv.id));
      expect(agregar.ok).toBe(false);
      expect(agregar.mensaje).toContain("Primero creá");
      expect(await propias(norteId)).toEqual([]);
      expect((await centrales()).map((v) => v.version)).toEqual([1]);
    });

    it("un plato sin receta central admite una receta propia armada desde cero con 'agregar ingrediente'", async () => {
      const sinCentral = await sembrarProductoDisponible({ codigo: "PV_SIN", nombre: "Sin receta", tipo: "PV", unidadStockId: kgId, precioVenta: 1 }, centralId);
      const r = await agregarIngredienteARecetaPropia(sinCentral.id, linea(harina.id, 4), await versionPropia(sinCentral.id));
      expect(r.ok, r.mensaje).toBe(true);
      const propia = await prisma.recetaVersion.findFirstOrThrow({ where: { productoId: sinCentral.id, sucursalId: centralId } });
      expect(propia).toMatchObject({ version: 1, basadaEnVersionId: null });
      expect(await prisma.recetaVersion.count({ where: { productoId: sinCentral.id, sucursalId: null } })).toBe(0);
      expect(await prisma.recetaSucursal.count({ where: { productoId: sinCentral.id, habilitada: true } })).toBe(1);
    });
  });

  describe("la receta efectiva y el aviso «la central cambió»", () => {
    it("con la propia habilitada rige la propia en esa sucursal; en las otras, la central", async () => {
      expect((await crearRecetaPropiaDesdeLaCentral(pv.id, await versionPropia(pv.id))).ok).toBe(true);
      expect((await actualizarIngredienteDeRecetaPropia(pv.id, queso.id, { cantidad: 8, unidadId: kgId }, await versionPropia(pv.id))).ok).toBe(true);
      const deCentral = await cargarRecetaVigente(prisma, alcanceDeSucursal(centralId), pv.id, { include: { ingredientes: true } });
      expect(deCentral).toMatchObject({ sucursalId: centralId, version: 2 });
      expect(Number(deCentral?.ingredientes.find((i) => i.insumoProductoId === queso.id)?.cantidad)).toBe(8);
      expect(await cargarRecetaVigente(prisma, alcanceDeSucursal(norteId), pv.id, {})).toMatchObject({ sucursalId: null, version: 1 });
      expect(await cargarRecetaVigente(prisma, ALCANCE_CENTRAL, pv.id, {})).toMatchObject({ sucursalId: null, version: 1 });
    });

    it("avisa cuando la central cambió después de armar la propia, nunca la aplica, y se calla al revisar la propia", async () => {
      expect((await crearRecetaPropiaDesdeLaCentral(pv.id, await versionPropia(pv.id))).ok).toBe(true);
      expect((await obtenerEstadoDeRecetaPropia(pv.id, centralId, prisma)).centralCambio).toBe(false);

      expect((await guardarReceta(pv.id, [linea(harina.id, 99)])).ok).toBe(true); // central v2
      const estado = await obtenerEstadoDeRecetaPropia(pv.id, centralId, prisma);
      expect(estado).toMatchObject({ habilitada: true, centralCambio: true, versionesPropias: 1 });
      expect(estado.centralVigente?.version).toBe(2);
      expect(idsDe((await propias(centralId))[0])).toEqual([harina.id, queso.id].sort()); // la propia no se tocó

      // Al editar la propia (la revisó), pasa a basarse en la central vigente y el aviso se apaga.
      expect((await agregarIngredienteARecetaPropia(pv.id, linea(tomate.id, 1), await versionPropia(pv.id))).ok).toBe(true);
      expect((await obtenerEstadoDeRecetaPropia(pv.id, centralId, prisma)).centralCambio).toBe(false);
    });

    it("sin propia habilitada no hay aviso, aunque la central cambie", async () => {
      expect((await guardarReceta(pv.id, [linea(harina.id, 99)])).ok).toBe(true);
      expect(await obtenerEstadoDeRecetaPropia(pv.id, centralId, prisma)).toMatchObject({ habilitada: false, propia: null, centralCambio: false, versionesPropias: 0 });
    });
  });

  describe("copiar la receta propia de otra sucursal", () => {
    beforeEach(async () => {
      enSucursal(norteId);
      expect((await crearRecetaPropiaDesdeLaCentral(pv.id, await versionPropia(pv.id))).ok).toBe(true);
      expect((await agregarIngredienteARecetaPropia(pv.id, linea(tomate.id, 3), await versionPropia(pv.id))).ok).toBe(true); // propia de Norte v2: harina, queso, tomate
      enSucursal(centralId);
    });

    it("exige la confirmación explícita", async () => {
      const r = await copiarRecetaPropiaDeOtraSucursal(pv.id, norteId, false, await versionPropia(pv.id));
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("Confirmá");
      expect(await propias(centralId)).toEqual([]);
    });

    it("copia la propia de la otra sucursal como versión nueva de la propia de la activa, y la de origen no se toca", async () => {
      const origen = await propias(norteId);
      const r = await copiarRecetaPropiaDeOtraSucursal(pv.id, norteId, true, await versionPropia(pv.id));
      expect(r.ok, r.mensaje).toBe(true);

      const [copia] = await propias(centralId);
      expect(copia).toMatchObject({ version: 1, sucursalId: centralId, basadaEnVersionId: origen[1].basadaEnVersionId });
      expect(idsDe(copia)).toEqual([harina.id, queso.id, tomate.id].sort());
      expect((await propias(norteId)).map((v) => v.version)).toEqual([1, 2]);
      expect(await prisma.recetaSucursal.count({ where: { habilitada: true } })).toBe(2);
      const auditoria = await prisma.registroAuditoria.findFirstOrThrow({ where: { entidad: "RecetaVersion", sucursalId: centralId } });
      expect(auditoria.descripcion).toContain("copiada de la receta propia de");
      expect(auditoria.descripcion).toContain("Norte");
    });

    it("pisa la propia que hubiera (la anterior queda en el historial) y numera sobre la serie", async () => {
      expect((await crearRecetaPropiaDesdeLaCentral(pv.id, await versionPropia(pv.id))).ok).toBe(true);
      expect((await copiarRecetaPropiaDeOtraSucursal(pv.id, norteId, true, await versionPropia(pv.id))).ok).toBe(true);
      const versiones = await propias(centralId);
      expect(versiones.map((v) => v.version)).toEqual([1, 2]);
      expect(idsDe(versiones[0])).toEqual([harina.id, queso.id].sort());
      expect(idsDe(versiones[1])).toEqual([harina.id, queso.id, tomate.id].sort());
    });

    it("no copia de la misma sucursal, de una sin receta propia, de una deshabilitada, ni de una inexistente", async () => {
      expect((await copiarRecetaPropiaDeOtraSucursal(pv.id, centralId, true, await versionPropia(pv.id))).mensaje).toContain("otra sucursal");
      expect((await copiarRecetaPropiaDeOtraSucursal(pv.id, "no-existe", true, await versionPropia(pv.id))).mensaje).toContain("No se encontró");

      const sur = await prisma.sucursal.create({ data: { nombre: "Sur" } });
      expect((await copiarRecetaPropiaDeOtraSucursal(pv.id, sur.id, true, await versionPropia(pv.id))).mensaje).toContain("no tiene receta propia");

      await prisma.recetaSucursal.update({ where: { sucursalId_productoId: { sucursalId: norteId, productoId: pv.id } }, data: { habilitada: false } });
      expect((await copiarRecetaPropiaDeOtraSucursal(pv.id, norteId, true, await versionPropia(pv.id))).mensaje).toContain("no tiene receta propia");
      expect(await propias(centralId)).toEqual([]);
    });

    it("lista, para copiar, solo las OTRAS sucursales con receta propia habilitada", async () => {
      expect((await listarSucursalesConRecetaPropia(pv.id, centralId, prisma)).map((s) => s.nombre)).toEqual(["Norte"]);
      expect(await listarSucursalesConRecetaPropia(pv.id, norteId, prisma)).toEqual([]);
      await prisma.recetaSucursal.update({ where: { sucursalId_productoId: { sucursalId: norteId, productoId: pv.id } }, data: { habilitada: false } });
      expect(await listarSucursalesConRecetaPropia(pv.id, centralId, prisma)).toEqual([]);
    });
  });

  describe("volver a la receta central", () => {
    beforeEach(async () => {
      expect((await crearRecetaPropiaDesdeLaCentral(pv.id, await versionPropia(pv.id))).ok).toBe(true);
      expect((await agregarIngredienteARecetaPropia(pv.id, linea(tomate.id, 3), await versionPropia(pv.id))).ok).toBe(true);
    });

    it("exige la confirmación explícita", async () => {
      const r = await volverALaRecetaCentral(pv.id, false);
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("Confirmá");
      expect((await prisma.recetaSucursal.findFirstOrThrow()).habilitada).toBe(true);
    });

    it("deshabilita la propia sin borrar nada: rige la central y las versiones propias quedan como historial", async () => {
      const r = await volverALaRecetaCentral(pv.id, true);
      expect(r.ok, r.mensaje).toBe(true);
      expect((await prisma.recetaSucursal.findFirstOrThrow()).habilitada).toBe(false);
      expect((await propias(centralId)).map((v) => v.version)).toEqual([1, 2]);
      expect(await cargarRecetaVigente(prisma, alcanceDeSucursal(centralId), pv.id, {})).toMatchObject({ sucursalId: null, version: 1 });
      expect(await obtenerEstadoDeRecetaPropia(pv.id, centralId, prisma)).toMatchObject({ habilitada: false, versionesPropias: 2, centralCambio: false });

      const auditoria = await prisma.registroAuditoria.findFirstOrThrow({ where: { entidad: "RecetaSucursal", campo: "habilitada", valorNuevo: "false" } });
      expect(auditoria).toMatchObject({ sucursalId: centralId, actorId: adminId, valorAnterior: "true" });
      expect(auditoria.descripcion).toContain("vuelve a usar la receta central");
    });

    it("no se puede volver si no hay propia habilitada, y se puede volver a crear una (la numeración sigue sobre su historial)", async () => {
      expect((await volverALaRecetaCentral(pv.id, true)).ok).toBe(true);
      expect((await volverALaRecetaCentral(pv.id, true)).mensaje).toContain("no tiene receta propia habilitada");
      expect((await editarSinPropia()).ok).toBe(false);

      expect((await crearRecetaPropiaDesdeLaCentral(pv.id, await versionPropia(pv.id))).ok).toBe(true);
      expect((await propias(centralId)).map((v) => v.version)).toEqual([1, 2, 3]);
      expect(idsDe((await propias(centralId))[2])).toEqual([harina.id, queso.id].sort()); // parte de la central, no de la propia vieja
      expect(await prisma.recetaSucursal.count({ where: { habilitada: true } })).toBe(1);
    });

    async function editarSinPropia() {
      return actualizarIngredienteDeRecetaPropia(pv.id, queso.id, { cantidad: 1, unidadId: kgId }, await versionPropia(pv.id));
    }

    it("las calibraciones de la sucursal se conservan y vuelven a regir al volver a la central", async () => {
      const ingCentral = (await centrales())[0].ingredientes.find((i) => i.insumoProductoId === harina.id)!;
      await prisma.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId: ingCentral.id, sucursalId: centralId, cantidad: 2, mermaPorcentaje: 5 } });
      expect((await volverALaRecetaCentral(pv.id, true)).ok).toBe(true);
      expect(await prisma.rendimientoLocalIngrediente.count({ where: { sucursalId: centralId } })).toBe(1);
    });
  });

  describe("permisos: una clave por acción", () => {
    it("un operador (sin ninguna de las tres) es rechazado en las seis acciones y no se escribe nada", async () => {
      await mockearUsuarioActual({ id: operadorId, email: "operador@test.com", nombre: null });
      const resultados = [
        await crearRecetaPropiaDesdeLaCentral(pv.id, await versionPropia(pv.id)),
        await agregarIngredienteARecetaPropia(pv.id, linea(tomate.id, 1), await versionPropia(pv.id)),
        await actualizarIngredienteDeRecetaPropia(pv.id, queso.id, { cantidad: 1, unidadId: kgId }, await versionPropia(pv.id)),
        await quitarIngredienteDeRecetaPropia(pv.id, queso.id, await versionPropia(pv.id)),
        await copiarRecetaPropiaDeOtraSucursal(pv.id, norteId, true, await versionPropia(pv.id)),
        await volverALaRecetaCentral(pv.id, true),
      ];
      expect(resultados.map((r) => r.ok)).toEqual([false, false, false, false, false, false]);
      await sinPropias();
    });

    it("cada acción responde a SU clave: quien solo puede editar no copia ni vuelve a la central, y al revés", async () => {
      // Norte con receta propia (como admin) para que copiar y volver tengan sobre qué actuar.
      enSucursal(norteId);
      expect((await crearRecetaPropiaDesdeLaCentral(pv.id, await versionPropia(pv.id))).ok).toBe(true);
      enSucursal(centralId);

      // Se recorta al admin la matriz a UNA sola clave.
      const conSoloUna = async (clave: string) => {
        for (const k of ["receta_sucursal_editar", "receta_sucursal_copiar", "receta_sucursal_volver_central"]) {
          await prisma.permisoRol.update({ where: { rolId_accionClave: { rolId: rolAdminId, accionClave: k } }, data: { puedeEditar: k === clave } });
        }
        await mockearUsuarioActual({ id: adminId, email: "admin@test.com", nombre: null });
      };

      await conSoloUna("receta_sucursal_editar");
      expect((await copiarRecetaPropiaDeOtraSucursal(pv.id, norteId, true, await versionPropia(pv.id))).ok).toBe(false);
      expect((await volverALaRecetaCentral(pv.id, true)).ok).toBe(false);
      const creada = await crearRecetaPropiaDesdeLaCentral(pv.id, await versionPropia(pv.id));
      expect(creada.ok, creada.mensaje).toBe(true);
      expect((await actualizarIngredienteDeRecetaPropia(pv.id, queso.id, { cantidad: 3, unidadId: kgId }, await versionPropia(pv.id))).ok).toBe(true);

      await conSoloUna("receta_sucursal_volver_central");
      expect((await crearRecetaPropiaDesdeLaCentral(pv.id, await versionPropia(pv.id))).ok).toBe(false);
      expect((await quitarIngredienteDeRecetaPropia(pv.id, queso.id, await versionPropia(pv.id))).ok).toBe(false);
      expect((await copiarRecetaPropiaDeOtraSucursal(pv.id, norteId, true, await versionPropia(pv.id))).ok).toBe(false);
      expect((await volverALaRecetaCentral(pv.id, true)).ok).toBe(true);

      await conSoloUna("receta_sucursal_copiar");
      expect((await volverALaRecetaCentral(pv.id, true)).ok).toBe(false);
      expect((await agregarIngredienteARecetaPropia(pv.id, linea(tomate.id, 1), await versionPropia(pv.id))).ok).toBe(false);
      expect((await copiarRecetaPropiaDeOtraSucursal(pv.id, norteId, true, await versionPropia(pv.id))).ok).toBe(true);
    });

    it("quien tiene el permiso en una sucursal pero no es miembro de la otra no puede operar ahí (cookie ajena se ignora)", async () => {
      const u = await crearUsuarioConMembresia({ email: "soloCentral@test.com", sucursalId: centralId, rolId: rolAdminId });
      await mockearUsuarioActual({ id: u.id, email: u.email, nombre: null });
      enSucursal(norteId);
      const r = await crearRecetaPropiaDesdeLaCentral(pv.id, await versionPropia(pv.id));
      expect(r.ok, r.mensaje).toBe(true);
      expect(await propias(norteId)).toEqual([]);
      expect(await propias(centralId)).toHaveLength(1);
    });

    it("la Central puede apagar cada acción por sucursal (capacidad de sucursal, como toda acción de sucursal)", async () => {
      await prisma.capacidadSucursal.create({ data: { accionClave: "receta_sucursal_editar", sucursalId: norteId, habilitado: false } });
      enSucursal(norteId);
      const r = await crearRecetaPropiaDesdeLaCentral(pv.id, await versionPropia(pv.id));
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("no habilitó");
      expect(await propias(norteId)).toEqual([]);
      enSucursal(centralId);
      expect((await crearRecetaPropiaDesdeLaCentral(pv.id, await versionPropia(pv.id))).ok).toBe(true);
    });
  });
});
