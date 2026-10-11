import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarDisponibilidadProducto, actualizarProducto, darDeAltaProducto, darDeAltaProductoRapido, type DatosProducto } from "../../src/server/actions/catalogo/productos";
import { cargarSelectorCartaPos } from "../../src/server/lecturas/pos/selector-carta";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";

/**
 * M.2 (P4, D-2 del dueño) — la clave fina `producto_campos_sensibles` en el ALTA de un producto. Crear un producto con precio de venta, con un factor de conversión distinto de 1 o con
 * unidad de compra es fijar justo lo que la edición ya protege (si el alta lo dejara libre, el que no puede editar el precio lo fijaría dando de alta un producto nuevo). Fallo cerrado:
 * sin la clave el alta no puede traer precio distinto de 0, factor distinto de 1 ni unidad de compra; la unidad de STOCK queda libre (sin ella no hay producto). El alta rápida
 * (`darDeAltaProductoRapido`: solo la unidad de stock, factor 1, precio 0) no cambia.
 */
describe("M.2: el alta de un producto con precio, factor o unidad de compra es de quien tiene producto_campos_sensibles", () => {
  const MENSAJE = "No tenés permiso para cambiar el precio de venta, el factor de conversión ni las unidades del producto.";
  let sucursalId: string;
  let adminId: string;
  let operadorId: string;
  let soloAltaId: string;
  let conClaveId: string;
  let kgId: string;
  let gId: string;

  const como = (id: string, email: string) => mockearUsuarioActual({ id, email, nombre: null });
  const nuevo = (extra: Partial<DatosProducto> = {}): DatosProducto => ({ nombre: "Vino", tipo: "MP", unidadStockId: kgId, factorConversion: 1, ...extra });
  const cantidad = (nombre = "Vino") => prisma.producto.count({ where: { nombre } });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    kgId = catalogo.kg.id;
    gId = catalogo.g.id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    operadorId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: base.operador.id })).id;
    // Un rol propio con SOLO alta_producto y otro que además tiene la clave fina (la delegó el gerente por configuración).
    const soloAlta = await prisma.rol.create({ data: { nombre: "Altas" } });
    await prisma.permisoRol.create({ data: { rolId: soloAlta.id, accionClave: "alta_producto", puedeVer: true, puedeEditar: true } });
    soloAltaId = (await crearUsuarioConMembresia({ email: "altas@test.com", sucursalId, rolId: soloAlta.id })).id;
    const precios = await prisma.rol.create({ data: { nombre: "Precios" } });
    for (const accionClave of ["alta_producto", "producto_campos_sensibles"]) {
      await prisma.permisoRol.create({ data: { rolId: precios.id, accionClave, puedeVer: true, puedeEditar: true } });
    }
    conClaveId = (await crearUsuarioConMembresia({ email: "precios@test.com", sucursalId, rolId: precios.id })).id;
    await como(operadorId, "operador@test.com");
  });

  describe("EL ATAQUE: sin la clave, el alta con precio, factor o unidad de compra se rechaza y no crea el producto", () => {
    const ATAQUES: [string, () => Partial<DatosProducto>][] = [
      ["un precio de venta de 7000", () => ({ precioVenta: 7000 })],
      ["un factor de conversión de 25", () => ({ factorConversion: 25 })],
      ["una unidad de compra", () => ({ unidadCompraId: gId })],
    ];
    const ACTORES: [string, () => Promise<void>][] = [
      ["el operador de fábrica", () => como(operadorId, "operador@test.com")],
      ["un rol propio con solo alta_producto", () => como(soloAltaId, "altas@test.com")],
    ];

    for (const [quien, actuar] of ACTORES) {
      it.each(ATAQUES)(`${quien} da de alta con %s → rechazo y no se crea el producto`, async (_nombre, cambios) => {
        await actuar();
        const r = await darDeAltaProducto(nuevo(cambios()));
        expect(r.ok).toBe(false);
        expect(r.mensaje).toContain(MENSAJE);
        expect(await cantidad()).toBe(0);
      });
    }

    it("un precio escrito como texto o un factor que no es un número también se rechazan (fallo cerrado, nunca «cero» por no entenderlo)", async () => {
      expect((await darDeAltaProducto(nuevo({ precioVenta: "7000" as unknown as number }))).ok).toBe(false);
      expect((await darDeAltaProducto(nuevo({ factorConversion: "25" as unknown as number }))).ok).toBe(false);
      expect(await cantidad()).toBe(0);
    });
  });

  describe("controles: lo que sigue andando sin la clave", () => {
    it("el alta con precio 0 y factor 1 (el formulario con los campos en su valor por defecto)", async () => {
      const r = await darDeAltaProducto(nuevo({ precioVenta: 0, unidadCompraId: null }));
      expect(r.ok, r.mensaje).toBe(true);
      expect(await cantidad()).toBe(1);
    });

    it("el alta sin mandar el precio ni la unidad de compra", async () => {
      expect((await darDeAltaProducto(nuevo({ nombre: "Vino tinto" }))).ok).toBe(true);
    });

    it("la unidad de stock es libre: el alta elige la que quiera", async () => {
      expect((await darDeAltaProducto(nuevo({ unidadStockId: gId }))).ok).toBe(true);
      expect((await prisma.producto.findFirstOrThrow({ where: { nombre: "Vino" } })).unidadStockId).toBe(gId);
    });

    it("el alta rápida (solo nombre y unidad de stock) no cambia", async () => {
      const r = await darDeAltaProductoRapido("Aceite", kgId);
      expect(r.ok, r.mensaje).toBe(true);
      const p = await prisma.producto.findFirstOrThrow({ where: { nombre: "Aceite" } });
      expect([Number(p.precioVenta), Number(p.factorConversion), p.unidadCompraId]).toEqual([0, 1, null]);
    });
  });

  describe("controles: quien tiene la clave", () => {
    it("el administrador da de alta con precio, factor y unidad de compra", async () => {
      await como(adminId, "admin@test.com");
      const r = await darDeAltaProducto(nuevo({ precioVenta: 7000, factorConversion: 25, unidadCompraId: gId }));
      expect(r.ok, r.mensaje).toBe(true);
      const p = await prisma.producto.findFirstOrThrow({ where: { nombre: "Vino" } });
      expect([Number(p.precioVenta), Number(p.factorConversion), p.unidadCompraId]).toEqual([7000, 25, gId]);
    });

    it("un rol propio CON la clave también", async () => {
      await como(conClaveId, "precios@test.com");
      expect((await darDeAltaProducto(nuevo({ precioVenta: 7000 }))).ok).toBe(true);
    });

    it("la clave NO reemplaza a alta_producto: sin ella, ni quien tiene la clave fina da de alta", async () => {
      const soloClave = await prisma.rol.create({ data: { nombre: "SoloClave" } });
      await prisma.permisoRol.create({ data: { rolId: soloClave.id, accionClave: "producto_campos_sensibles", puedeVer: true, puedeEditar: true } });
      const u = await crearUsuarioConMembresia({ email: "soloclave@test.com", sucursalId, rolId: soloClave.id });
      await como(u.id, "soloclave@test.com");
      expect((await darDeAltaProducto(nuevo())).ok).toBe(false);
      expect(await cantidad()).toBe(0);
    });
  });
});

/**
 * M.2-A4 (A, hallazgo importante de la auditoría de P6; SUPUESTO declarado, el dueño lo corrige si no): sin `producto_campos_sensibles` el alta fija el precio en 0 (D-2), pero un producto de venta
 * nace «disponible en todas las sucursales» y el POS lista todo PV disponible: quedaba a la venta a $0. Ahora, sin la clave, un PV nace NO disponible para vender (filas de disponibilidad con
 * `disponible: false`, sin importar el tilde) hasta que alguien con la clave le cargue el precio y alguien con `producto_disponibilidad` lo active. Una MP no se vende: su alta no cambia.
 */
describe("M.2-A4: un producto de venta dado de alta SIN la clave nace no disponible para vender", () => {
  let sucursalId: string;
  let otraSucursalId: string;
  let adminId: string;
  let operadorId: string;
  let kgId: string;

  const como = (id: string, email: string) => mockearUsuarioActual({ id, email, nombre: null });
  const pv = (extra: Partial<DatosProducto> = {}): DatosProducto => ({ nombre: "Milanesa", tipo: "PV", unidadStockId: kgId, factorConversion: 1, precioVenta: 0, ...extra });
  const idDe = async (nombre: string) => (await prisma.producto.findFirstOrThrow({ where: { nombre } })).id;
  const filas = (productoId: string) => prisma.disponibilidadProducto.findMany({ where: { productoId }, orderBy: { sucursalId: "asc" } });

  /** ¿Lo ofrece el selector del POS de la sucursal? (la lectura REAL que arma la pantalla de la mesa: recorre toda la estructura buscando el producto). */
  async function loOfreceElPos(productoId: string, enSucursal = sucursalId): Promise<boolean> {
    const aparece = (nodo: unknown): boolean => {
      if (Array.isArray(nodo)) return nodo.some(aparece);
      if (nodo instanceof Map) return [...nodo.values()].some(aparece);
      if (nodo && typeof nodo === "object") {
        const o = nodo as Record<string, unknown>;
        return o.productoId === productoId || Object.values(o).some(aparece);
      }
      return false;
    };
    return aparece(await cargarSelectorCartaPos(enSucursal, prisma, AHORA_DE_LA_CORRIDA));
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    otraSucursalId = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    kgId = (await sembrarCatalogoBase()).kg.id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    operadorId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: base.operador.id })).id;
    await como(operadorId, "operador@test.com");
  });

  it("EL DEFECTO: el operador (sin la clave) da de alta un PV con el tilde por defecto → precio 0, NO disponible en ninguna sucursal y el POS no lo ofrece", async () => {
    const r = await darDeAltaProducto(pv({ activoEnTodasLasSucursales: true }));
    expect(r.ok, r.mensaje).toBe(true);
    const id = await idDe("Milanesa");
    expect(Number((await prisma.producto.findUniqueOrThrow({ where: { id } })).precioVenta)).toBe(0);
    const f = await filas(id);
    expect(f.map((x) => x.sucursalId).sort()).toEqual([sucursalId, otraSucursalId].sort()); // las filas existen (la ficha y el catálogo muestran «0 de 2»)…
    expect(f.every((x) => x.disponible === false)).toBe(true); // …pero apagadas
    expect(await loOfreceElPos(id)).toBe(false);
    expect(await loOfreceElPos(id, otraSucursalId)).toBe(false);
  });

  it("con el tilde sin marcar (solo la sucursal activa) tampoco queda disponible", async () => {
    expect((await darDeAltaProducto(pv({ activoEnTodasLasSucursales: false }))).ok).toBe(true);
    const id = await idDe("Milanesa");
    expect((await filas(id)).some((x) => x.disponible)).toBe(false);
    expect(await loOfreceElPos(id)).toBe(false);
  });

  it("el mensaje le dice a quien lo dio de alta que no se va a poder vender hasta que alguien con el permiso cargue el precio", async () => {
    const r = await darDeAltaProducto(pv());
    expect(r.ok).toBe(true);
    expect(r.mensaje).toContain("no queda disponible para vender");
    expect(r.mensaje).toContain("producto_campos_sensibles");
  });

  it("idempotencia: repetir el alta (doble envío) no crea un segundo PV a $0 aunque el primero no esté disponible (lo ataja el índice único del nombre de la base)", async () => {
    expect((await darDeAltaProducto(pv())).ok).toBe(true);
    const repetido = await darDeAltaProducto(pv({ nombre: "milanesa" }));
        expect(repetido.ok).toBe(false);
    expect(repetido.mensaje).toContain("Ya existe"); // (la base lo rechaza con su índice único del nombre; el mensaje es el del código repetido)
    expect(await prisma.producto.count({ where: { nombre: { equals: "Milanesa", mode: "insensitive" } } })).toBe(1);
  });

  it("el ciclo completo: el administrador (con la clave) le carga el precio y recién cuando alguien lo activa el POS lo ofrece", async () => {
    await darDeAltaProducto(pv());
    const id = await idDe("Milanesa");
    await como(adminId, "admin@test.com");
    const e = await actualizarProducto(id, pv({ precioVenta: 4500 }));
    expect(e.ok, e.mensaje).toBe(true);
    expect(await loOfreceElPos(id), "cargar el precio NO lo activa solo: la disponibilidad es una decisión aparte").toBe(false);
    const a = await actualizarDisponibilidadProducto(id, true);
    expect(a.ok, a.mensaje).toBe(true);
    expect(await loOfreceElPos(id)).toBe(true);
  });

  describe("controles: lo que no cambia", () => {
    it("CON la clave el PV nace disponible en todas las sucursales y el POS lo ofrece", async () => {
      await como(adminId, "admin@test.com");
      expect((await darDeAltaProducto(pv({ precioVenta: 4500 }))).ok).toBe(true);
      const id = await idDe("Milanesa");
      expect((await filas(id)).map((x) => x.disponible)).toEqual([true, true]);
      expect(await loOfreceElPos(id)).toBe(true);
    });

    it("CON la clave y el tilde sin marcar, solo la sucursal activa (el comportamiento de siempre)", async () => {
      await como(adminId, "admin@test.com");
      expect((await darDeAltaProducto(pv({ precioVenta: 4500, activoEnTodasLasSucursales: false }))).ok).toBe(true);
      const f = await filas(await idDe("Milanesa"));
      expect(f.map((x) => [x.sucursalId, x.disponible])).toEqual([[sucursalId, true]]);
    });

    it("una MATERIA PRIMA sin la clave sigue naciendo disponible en todas las sucursales (no se vende: no hay precio que proteger)", async () => {
      expect((await darDeAltaProducto(pv({ nombre: "Harina", tipo: "MP" }))).ok).toBe(true);
      expect((await filas(await idDe("Harina"))).map((x) => x.disponible)).toEqual([true, true]);
    });

    it("el alta rápida crea una MATERIA PRIMA (nunca un PV): el POS no puede ofrecerla y no cambia su disponibilidad", async () => {
      const r = await darDeAltaProductoRapido("Aceite", kgId);
      expect(r.ok, r.mensaje).toBe(true);
      const id = await idDe("Aceite");
      expect((await prisma.producto.findUniqueOrThrow({ where: { id } })).tipo).toBe("MP");
      expect((await filas(id)).map((x) => x.disponible)).toEqual([true, true]);
      expect(await loOfreceElPos(id), "el selector del POS solo lista PV").toBe(false);
    });
  });
});
