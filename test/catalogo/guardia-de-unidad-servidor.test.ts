import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { habilitadaDeRecetaPropia, versionVigenteDeReceta } from "../setup/version-de-receta";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { guardarRecetaACiegas } from "../../src/server/actions/catalogo/receta-a-ciegas";
import { actualizarCabeceraDeReceta, actualizarIngredienteDeReceta, agregarIngredienteAReceta, quitarIngredienteDeReceta } from "../../src/server/actions/catalogo/recetas";
import { agregarIngredienteARecetaPropia, crearRecetaPropiaDesdeLaCentral } from "../../src/server/actions/catalogo/receta-sucursal";

/**
 * Guardia de unidad de las recetas (`docs/diseno-guardia-de-unidad-receta-2026-11-09.md`) contra Postgres real: el servidor rechaza una cantidad desproporcionada para la unidad de stock aunque el cliente no
 * valide, la acepta con la confirmación explícita, no duplica nada si se repite o se hace a la vez, no toca lo ya guardado ni las recetas «Se produce», y las rutas de carga en bloque y de copia no pasan por ella.
 */
const MENSAJE_PAN_100 =
  "Esto descuenta 100 kg de Pan rallado por cada unidad vendida de Milanesa. Si querías 100 gramos, escribí 0,1 (la receta se carga en kg). Si de verdad es 100 kg, confirmalo.";

describe("guardia de unidad de las recetas", () => {
  let sucursalId: string;
  let kgId: string;
  let gId: string;
  let pan: { id: string };
  let bife: { id: string };
  let harinaEnGramos: { id: string };
  let milanesa: { id: string };
  let adminId: string;

  const linea = (insumoProductoId: string, cantidad: number, unidad = kgId) => ({ insumoProductoId, cantidad, unidadId: unidad });
  const versiones = (productoId: string, sucursal: string | null = null) => prisma.recetaVersion.count({ where: { productoId, sucursalId: sucursal } });
  const cantidadVigente = async (productoId: string, insumoProductoId: string) => {
    const v = await prisma.recetaVersion.findFirstOrThrow({ where: { productoId, sucursalId: null }, orderBy: { version: "desc" }, include: { ingredientes: true } });
    return Number(v.ingredientes.find((i) => i.insumoProductoId === insumoProductoId)?.cantidad);
  };

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    kgId = catalogo.kg.id;
    gId = catalogo.g.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    adminId = admin.id;
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    pan = await sembrarProductoDisponible({ codigo: "MP_PAN", nombre: "Pan rallado", tipo: "MP", unidadStockId: kgId }, sucursalId);
    bife = await sembrarProductoDisponible({ codigo: "MP_BIFE", nombre: "Bife de nalga", tipo: "MP", unidadStockId: kgId }, sucursalId);
    harinaEnGramos = await sembrarProductoDisponible({ codigo: "MP_HAR", nombre: "Harina 000", tipo: "MP", unidadStockId: gId }, sucursalId);
    milanesa = await sembrarProductoDisponible({ codigo: "PV_MILA", nombre: "Milanesa", tipo: "PV", unidadStockId: kgId, precioVenta: 100 }, sucursalId);
  });

  describe("receta central: agregar un ingrediente", () => {
    it("rechaza 100 kg sin confirmar, con el mensaje exacto y la marca para ofrecer confirmar, y no escribe nada", async () => {
      const r = await agregarIngredienteAReceta(milanesa.id, linea(pan.id, 100), 0);
      expect(r).toEqual({ ok: false, mensaje: MENSAJE_PAN_100, requiereConfirmacion: true });
      expect(await versiones(milanesa.id)).toBe(0);
    });

    it("lo acepta con la confirmación explícita", async () => {
      const r = await agregarIngredienteAReceta(milanesa.id, linea(pan.id, 100), 0, true);
      expect(r.ok, r.mensaje).toBe(true);
      expect(await cantidadVigente(milanesa.id, pan.id)).toBe(100);
    });

    it("solo un `true` estricto confirma: un «true» de texto, 1 o un objeto llegados de la red se rechazan igual", async () => {
      for (const falsa of ["true", 1, {}, "1"]) {
        const r = await agregarIngredienteAReceta(milanesa.id, linea(pan.id, 100), 0, falsa as unknown as boolean);
        expect(r.ok).toBe(false);
      }
      expect(await versiones(milanesa.id)).toBe(0);
    });

    it("una cantidad normal pasa sin molestar; justo en el umbral (5 kg) se rechaza y 4,9999 pasa", async () => {
      expect((await agregarIngredienteAReceta(milanesa.id, linea(bife.id, 0.22), 0)).ok).toBe(true);
      const enElUmbral = await agregarIngredienteAReceta(milanesa.id, linea(pan.id, 5), 1);
      expect(enElUmbral.ok).toBe(false);
      expect(await versiones(milanesa.id)).toBe(1);
      expect((await agregarIngredienteAReceta(milanesa.id, linea(pan.id, 4.9999), 1)).ok).toBe(true);
    });

    it("la confirmación de una cantidad que no es desproporcionada no hace nada raro", async () => {
      const r = await agregarIngredienteAReceta(milanesa.id, linea(pan.id, 0.06), 0, true);
      expect(r.ok, r.mensaje).toBe(true);
      expect(await cantidadVigente(milanesa.id, pan.id)).toBe(0.06);
    });

    it("con el stock en gramos, 100 g no se juzga; 20000 g sí", async () => {
      expect((await agregarIngredienteAReceta(milanesa.id, linea(harinaEnGramos.id, 100, gId), 0)).ok).toBe(true);
      const r = await agregarIngredienteAReceta(milanesa.id, linea(pan.id, 20000, kgId), 1);
      expect(r.ok).toBe(false);
      const g = await prisma.producto.update({ where: { id: pan.id }, data: { unidadStockId: gId } });
      const enGramos = await agregarIngredienteAReceta(milanesa.id, linea(g.id, 20000, gId), 1);
      expect(enGramos).toMatchObject({ ok: false, requiereConfirmacion: true });
      expect(enGramos.mensaje).toBe("Esto descuenta 20000 g de Pan rallado por cada unidad vendida de Milanesa. Si de verdad es así, confirmalo.");
    });
  });

  describe("idempotencia y concurrencia", () => {
    it("doble clic en «confirmar»: el segundo llega con la versión vieja y se rechaza, sin duplicar", async () => {
      const primero = await agregarIngredienteAReceta(milanesa.id, linea(pan.id, 100), 0, true);
      expect(primero.ok, primero.mensaje).toBe(true);
      const segundo = await agregarIngredienteAReceta(milanesa.id, linea(pan.id, 100), 0, true);
      expect(segundo.ok).toBe(false);
      expect(await versiones(milanesa.id)).toBe(1);
    });

    it("el pedido sin confirmar, repetido, da siempre el mismo rechazo y no escribe", async () => {
      const resultados = [];
      for (let i = 0; i < 3; i++) resultados.push(await agregarIngredienteAReceta(milanesa.id, linea(pan.id, 100), 0));
      expect(new Set(resultados.map((r) => r.mensaje)).size).toBe(1);
      expect(resultados.every((r) => !r.ok)).toBe(true);
      expect(await versiones(milanesa.id)).toBe(0);
    });

    it("dos confirmaciones a la vez: gana una sola, queda una versión", async () => {
      const [a, b] = await Promise.all([
        agregarIngredienteAReceta(milanesa.id, linea(pan.id, 100), 0, true),
        agregarIngredienteAReceta(milanesa.id, linea(pan.id, 100), 0, true),
      ]);
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      expect(await versiones(milanesa.id)).toBe(1);
    });
  });

  describe("receta central: editar", () => {
    beforeEach(async () => {
      expect((await guardarRecetaACiegas(milanesa.id, [linea(bife.id, 0.22), linea(pan.id, 0.06)])).ok).toBe(true);
    });

    it("pasar un ingrediente de 0,06 a 100 kg se rechaza sin confirmar y se acepta confirmando", async () => {
      const v = await versionVigenteDeReceta(milanesa.id);
      const r = await actualizarIngredienteDeReceta(milanesa.id, pan.id, { cantidad: 100, unidadId: kgId }, v);
      expect(r).toEqual({ ok: false, mensaje: MENSAJE_PAN_100, requiereConfirmacion: true });
      expect(await cantidadVigente(milanesa.id, pan.id)).toBe(0.06);
      const ok = await actualizarIngredienteDeReceta(milanesa.id, pan.id, { cantidad: 100, unidadId: kgId }, v, true);
      expect(ok.ok, ok.mensaje).toBe(true);
      expect(await cantidadVigente(milanesa.id, pan.id)).toBe(100);
    });

    it("lo ya guardado no se re-juzga: con 100 kg cargados a ciegas, se puede tocar la cabecera, quitar otro ingrediente o editar otro sin confirmar", async () => {
      await guardarRecetaACiegas(milanesa.id, [linea(bife.id, 0.22), linea(pan.id, 100)]);
      let v = await versionVigenteDeReceta(milanesa.id);
      expect((await actualizarCabeceraDeReceta(milanesa.id, { racionesCantidad: 1 }, v)).ok).toBe(true);
      v = await versionVigenteDeReceta(milanesa.id);
      expect((await actualizarIngredienteDeReceta(milanesa.id, bife.id, { cantidad: 0.25, unidadId: kgId }, v)).ok).toBe(true);
      v = await versionVigenteDeReceta(milanesa.id);
      expect((await quitarIngredienteDeReceta(milanesa.id, bife.id, v)).ok).toBe(true);
      expect(await cantidadVigente(milanesa.id, pan.id)).toBe(100);
    });
  });

  describe("lo que NO pasa por la guardia", () => {
    it("una receta «Se produce» acepta cantidades grandes (tandas) sin confirmar", async () => {
      const masa = await sembrarProductoDisponible({ codigo: "MP_MASA", nombre: "Masa madre", tipo: "MP", unidadStockId: kgId, seProduce: true }, sucursalId);
      const r = await agregarIngredienteAReceta(masa.id, linea(harinaEnGramos.id, 20000, gId), 0);
      expect(r.ok, r.mensaje).toBe(true);
      const r2 = await agregarIngredienteAReceta(masa.id, linea(pan.id, 100), 1);
      expect(r2.ok, r2.mensaje).toBe(true);
    });

    it("la carga a ciegas (seeds, scripts, tests) no se juzga", async () => {
      const r = await guardarRecetaACiegas(milanesa.id, [linea(pan.id, 100)]);
      expect(r.ok, r.mensaje).toBe(true);
    });
  });

  describe("receta propia de la sucursal", () => {
    it("agregar un ingrediente desproporcionado a la propia: se rechaza sin confirmar y se acepta confirmando", async () => {
      const v = await versionVigenteDeReceta(milanesa.id, sucursalId);
      const h = await habilitadaDeRecetaPropia(milanesa.id, sucursalId);
      const r = await agregarIngredienteARecetaPropia(milanesa.id, linea(pan.id, 100), v, h);
      expect(r).toEqual({ ok: false, mensaje: MENSAJE_PAN_100, requiereConfirmacion: true });
      expect(await versiones(milanesa.id, sucursalId)).toBe(0);
      const ok = await agregarIngredienteARecetaPropia(milanesa.id, linea(pan.id, 100), v, h, true);
      expect(ok.ok, ok.mensaje).toBe(true);
      expect(await versiones(milanesa.id, sucursalId)).toBe(1);
    });

    it("crear la propia desde una central que ya tenía 100 kg COPIA lo aceptado: no se juzga", async () => {
      await guardarRecetaACiegas(milanesa.id, [linea(bife.id, 0.22), linea(pan.id, 100)]);
      const v = await versionVigenteDeReceta(milanesa.id, sucursalId);
      const h = await habilitadaDeRecetaPropia(milanesa.id, sucursalId);
      const r = await crearRecetaPropiaDesdeLaCentral(milanesa.id, v, h);
      expect(r.ok, r.mensaje).toBe(true);
      expect(await versiones(milanesa.id, sucursalId)).toBe(1);
    });
  });

  it("quien guarda queda registrado en la auditoría de la versión confirmada (la de siempre)", async () => {
    await agregarIngredienteAReceta(milanesa.id, linea(pan.id, 100), 0, true);
    const filas = await prisma.registroAuditoria.findMany({ where: { entidad: "RecetaVersion" } });
    expect(filas).toHaveLength(1);
    expect(filas[0]?.actorId).toBe(adminId);
  });
});
