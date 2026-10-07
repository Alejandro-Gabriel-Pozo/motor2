import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { guardarMargenObjetivo } from "../../src/server/actions/reportes/margen-objetivo";
import { calcularCostosYMargenes } from "../../src/server/lecturas/reportes/costos";
import { cargarObjetivosDeMargen } from "../../src/server/consultas/reportes/margen-objetivo-consulta";
import { FOOD_COST_OBJETIVO_PCT } from "../../src/core/reportes/margen-objetivo";

/**
 * Margen objetivo configurable (Etapa 1): `guardarMargenObjetivo` fija el objetivo de la empresa o de una categoría (solo administración), y
 * `calcularCostosYMargenes` lo usa si se le pasan los objetivos cargados: categoría > empresa > 40 % por defecto.
 */
describe("margen objetivo configurable", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;
  let operadorRolId: string;
  let adminId: string;
  let categoriaPizzaId: string;
  let categoriaBebidaId: string;
  let pizzaId: string;
  let bebidaId: string;
  let sinCategoriaId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    operadorRolId = base.operador.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    adminId = admin.id;
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    categoriaPizzaId = (await prisma.categoriaProducto.create({ data: { nombre: "Pizzas" } })).id;
    categoriaBebidaId = (await prisma.categoriaProducto.create({ data: { nombre: "Bebidas" } })).id;
    const mp = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId: catalogo.insumo.id }, sucursalId);
    // Tres platos con el MISMO costo ($4000 sobre $10.000 = 40 %): solo cambia la categoría.
    const plato = async (codigo: string, categoriaId: string | null) => {
      const pv = await sembrarProductoDisponible({ codigo, nombre: codigo, tipo: "PV", unidadStockId: unidadKgId, precioVenta: 10000, categoriaId }, sucursalId);
      await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadKgId }] } } });
      return pv.id;
    };
    pizzaId = await plato("PV_PIZZA", categoriaPizzaId);
    bebidaId = await plato("PV_BEBIDA", categoriaBebidaId);
    sinCategoriaId = await plato("PV_SIN_CAT", null);
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 1, precioTotal: 4000 }] });
  });

  async function filas() {
    const objetivos = await cargarObjetivosDeMargen(prisma);
    const todas = await calcularCostosYMargenes(sucursalId, prisma, undefined, undefined, objetivos);
    return { pizza: todas.find((f) => f.productoId === pizzaId)!, bebida: todas.find((f) => f.productoId === bebidaId)!, sinCategoria: todas.find((f) => f.productoId === sinCategoriaId)! };
  }

  describe("guardarMargenObjetivo", () => {
    it("fija, cambia y borra el objetivo de la empresa: siempre una sola fila sin categoría", async () => {
      expect((await guardarMargenObjetivo(null, 30)).ok).toBe(true);
      expect((await guardarMargenObjetivo(null, "35,5")).ok).toBe(true);
      const filas = await prisma.margenObjetivo.findMany();
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({ categoriaId: null });
      expect(Number(filas[0].foodCostObjetivoPct)).toBe(35.5);

      expect((await guardarMargenObjetivo(null, "")).ok).toBe(true);
      expect(await prisma.margenObjetivo.count()).toBe(0);
    });

    it("fija y borra el objetivo de una categoría, una fila por categoría", async () => {
      await guardarMargenObjetivo(categoriaPizzaId, 25);
      await guardarMargenObjetivo(categoriaBebidaId, 50);
      await guardarMargenObjetivo(categoriaPizzaId, 28);
      const filas = await prisma.margenObjetivo.findMany({ orderBy: { foodCostObjetivoPct: "asc" } });
      expect(filas.map((f) => [f.categoriaId, Number(f.foodCostObjetivoPct)])).toEqual([[categoriaPizzaId, 28], [categoriaBebidaId, 50]]);
      await guardarMargenObjetivo(categoriaPizzaId, null);
      expect(await prisma.margenObjetivo.count()).toBe(1);
    });

    it("rechaza un valor fuera de rango, con decimales de más o no numérico, sin escribir nada", async () => {
      for (const malo of [0, 100, 150, -5, "abc", 12.345]) {
        expect((await guardarMargenObjetivo(null, malo)).ok, String(malo)).toBe(false);
        expect((await guardarMargenObjetivo(categoriaPizzaId, malo)).ok, String(malo)).toBe(false);
      }
      expect(await prisma.margenObjetivo.count()).toBe(0);
    });

    it("rechaza una categoría que no existe", async () => {
      expect(await guardarMargenObjetivo("no-existe", 30)).toMatchObject({ ok: false, mensaje: "No se encontró la categoría." });
      expect(await prisma.margenObjetivo.count()).toBe(0);
    });

    it("borrar un objetivo que no existía, o repetir el mismo valor, responde ok sin escribir ni auditar", async () => {
      expect((await guardarMargenObjetivo(null, null)).ok).toBe(true);
      await guardarMargenObjetivo(null, 30);
      const antes = await prisma.registroAuditoria.count({ where: { entidad: "MargenObjetivo" } });
      expect((await guardarMargenObjetivo(null, 30)).ok).toBe(true);
      expect(await prisma.registroAuditoria.count({ where: { entidad: "MargenObjetivo" } })).toBe(antes);
    });

    it("audita el alta, el cambio y la baja, con sucursalId nulo (es de la empresa)", async () => {
      await guardarMargenObjetivo(null, 30);
      await guardarMargenObjetivo(null, 32);
      await guardarMargenObjetivo(null, null);
      await guardarMargenObjetivo(categoriaPizzaId, 25);
      const registros = await prisma.registroAuditoria.findMany({ where: { entidad: "MargenObjetivo" }, orderBy: { creadoEn: "asc" } });
      expect(registros.map((r) => [r.entidadId, r.campo, r.valorAnterior, r.valorNuevo])).toEqual([
        ["empresa", "foodCostObjetivoPct", null, "30"],
        ["empresa", "foodCostObjetivoPct", "30", "32"],
        ["empresa", "foodCostObjetivoPct", "32", null],
        [categoriaPizzaId, "foodCostObjetivoPct", null, "25"],
      ]);
      expect(registros[0]).toMatchObject({ actorId: adminId, sucursalId: null, descripcion: "Food cost objetivo de la empresa" });
      expect(registros[3].descripcion).toBe("Food cost objetivo de la categoría «Pizzas»");
    });

    it("un operario (sin `margen_objetivo_editar`) no escribe nada", async () => {
      const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: operadorRolId });
      await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });
      const r = await guardarMargenObjetivo(null, 30);
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/No tenés permiso/);
      expect(await prisma.margenObjetivo.count()).toBe(0);
    });

    it("ni siquiera un rol que no es de administración, aunque se le habilite la clave: el piso de nivel lo corta", async () => {
      const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: operadorRolId });
      await prisma.permisoRol.updateMany({ where: { rolId: operadorRolId, accionClave: "margen_objetivo_editar" }, data: { puedeVer: true, puedeEditar: true } });
      await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });
      const r = await guardarMargenObjetivo(null, 30);
      expect(r.ok).toBe(false);
      expect(await prisma.margenObjetivo.count()).toBe(0);
    });
  });

  describe("calcularCostosYMargenes con objetivos", () => {
    it("sin objetivos cargados rige el 40 % por defecto: los tres platos justos están OK", async () => {
      const { pizza, bebida, sinCategoria } = await filas();
      for (const f of [pizza, bebida, sinCategoria]) {
        expect(f.objetivoFoodCostPct).toBe(FOOD_COST_OBJETIVO_PCT);
        expect(f.estado).toBe("OK");
        expect(f.precioSugerido).toBe(10000);
      }
    });

    it("sin pasar objetivos (quien llama no los cargó) también rige el 40 %", async () => {
      const todas = await calcularCostosYMargenes(sucursalId, prisma);
      expect(todas.every((f) => f.objetivoFoodCostPct === FOOD_COST_OBJETIVO_PCT)).toBe(true);
    });

    it("el objetivo de la empresa rige para todos los platos: bajarlo a 30 % los deja en «Food cost alto» con el precio redondeado hacia arriba", async () => {
      await guardarMargenObjetivo(null, 30);
      const { pizza, bebida, sinCategoria } = await filas();
      for (const f of [pizza, bebida, sinCategoria]) {
        expect(f.objetivoFoodCostPct).toBe(30);
        expect(f.estado).toBe("FOOD_COST_ALTO");
        expect(f.precioSugerido).toBe(13333.34); // 4000 ÷ 0,30 = 13333,333… → hacia arriba al centavo
      }
    });

    it("el de la categoría gana sobre el de la empresa y solo mueve a SUS productos", async () => {
      await guardarMargenObjetivo(null, 30);
      await guardarMargenObjetivo(categoriaBebidaId, 50);
      const { pizza, bebida, sinCategoria } = await filas();
      expect(bebida).toMatchObject({ objetivoFoodCostPct: 50, estado: "OK", precioSugerido: 8000 });
      expect(pizza).toMatchObject({ objetivoFoodCostPct: 30, estado: "FOOD_COST_ALTO" });
      expect(sinCategoria).toMatchObject({ objetivoFoodCostPct: 30, estado: "FOOD_COST_ALTO" });
    });

    it("el objetivo de una categoría rige aunque la empresa no cargue ninguno; el resto sigue en 40 %", async () => {
      await guardarMargenObjetivo(categoriaPizzaId, 20);
      const { pizza, bebida } = await filas();
      expect(pizza).toMatchObject({ objetivoFoodCostPct: 20, estado: "FOOD_COST_ALTO", precioSugerido: 20000 });
      expect(bebida).toMatchObject({ objetivoFoodCostPct: FOOD_COST_OBJETIVO_PCT, estado: "OK" });
    });

    it("borrar el objetivo vuelve al que corresponde por defecto", async () => {
      await guardarMargenObjetivo(null, 30);
      await guardarMargenObjetivo(null, null);
      expect((await filas()).pizza).toMatchObject({ objetivoFoodCostPct: FOOD_COST_OBJETIVO_PCT, estado: "OK" });
    });
  });
});
