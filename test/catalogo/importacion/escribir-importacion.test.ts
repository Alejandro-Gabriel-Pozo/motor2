import { beforeEach, describe, expect, it, vi } from "vitest";

// Rompe la auditoría A MITAD de la importación cuando el test lo pide (auditoria-un-solo-escritor: el factory define el escritor y apunta a su archivo).
const romperLaAuditoria = vi.hoisted(() => ({ activo: false }));
vi.mock("../../../src/server/auditoria/registrar-cambio-auditado", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../src/server/auditoria/registrar-cambio-auditado")>();
  return {
    ...real,
    registrarCambioAuditado: async (...args: Parameters<typeof real.registrarCambioAuditado>) => {
      if (romperLaAuditoria.activo) throw new Error("falla simulada de la auditoría");
      return real.registrarCambioAuditado(...args);
    },
  };
});

import { baseDeTest, limpiarBaseDeTest, prisma } from "../../setup/test-db";
import { conTransaccionSerializable } from "../../../src/lib/transaccion-serializable";
import { crearContenidosImportados } from "../../../src/server/persistencia/carta/contenido-producto";
import { escribirImportacionDeCatalogoEnTx } from "../../../src/server/actions/catalogo/casos-de-uso/escribir-importacion-de-catalogo-en-tx";
import { normalizarCatalogo } from "../../../src/core/features/catalogo/importacion/normalizar";
import { planificarCarta } from "../../../src/core/features/catalogo/importacion/planificar-carta";
import { planificarProductos } from "../../../src/core/features/catalogo/importacion/planificar-productos";
import { LOCALES_DEL_IMPORTADOR } from "../../../src/core/features/catalogo/importacion/tipos";
import { permisosCompletos } from "./estado-de-prueba";
import { correccionesDe, libroDesde, type ProductoDeFixtura } from "./fixtura-de-catalogo";
import { sembrarEmpresaDelImportador } from "./base-de-importacion";

/**
 * E1.4 del importador: las ESCRITURAS EN LOTE (productos, disponibilidad, contenido de carta y auditoría) contra Postgres real, como `motor2_app` con el alcance de las 5 sucursales, dentro
 * de UNA transacción: lo escrito es exactamente el plan, los importes viajan como texto, y si la auditoría falla a mitad no queda nada (rollback de todo).
 */
const PRODUCTOS: ProductoDeFixtura[] = [
  { sku: "PIZZA-MUZZA", categoria: "Pizzas", base: "Pizza", variantes: ["Muzza"], precios: { Huinganco: 22000, "Los Miches": 22000, Varvarco: 20000 }, disponible: { Varvarco: false }, descripcion: { Huinganco: "Con orégano" } },
  { sku: "CAFE-CHICO", categoria: "Confitería", base: "Café", variantes: ["Chico"], precios: { Varvarco: 4100 } },
  { sku: "VINO-VENTUS", categoria: "Vinos Neuquinos", base: "Vino", variantes: ["Ventus"], precios: { "Los Miches": null }, disponible: { "Los Miches": false } },
];

describe("escribirImportacionDeCatalogoEnTx (E1.4)", () => {
  let semilla: Awaited<ReturnType<typeof sembrarEmpresaDelImportador>>;
  const transaccion = () => baseDeTest({ lectura: Object.values(semilla.sucursales), escritura: Object.values(semilla.sucursales) }).transaccion;
  const planes = () => {
    const catalogo = normalizarCatalogo(libroDesde(PRODUCTOS), correccionesDe());
    const estado = {
      sucursales: Object.fromEntries(LOCALES_DEL_IMPORTADOR.map((l) => [l, { id: semilla.sucursales[l], nombre: l, activa: true }])),
      unidadId: semilla.unidadId,
      secciones: Object.entries(semilla.secciones).map(([nombre, id]) => ({ id, nombre, activa: true })),
      productos: [],
    };
    const productos = planificarProductos(catalogo, estado, permisosCompletos());
    return { productos, carta: planificarCarta(catalogo, productos, estado, permisosCompletos()) };
  };
  const escribir = () =>
    conTransaccionSerializable(transaccion(), (tx) => escribirImportacionDeCatalogoEnTx(tx, { ...planes(), unidadId: semilla.unidadId, actorId: semilla.duena.id, huellaVisible: "abcdef012345" }));

  beforeEach(async () => {
    romperLaAuditoria.activo = false;
    await limpiarBaseDeTest();
    semilla = await sembrarEmpresaDelImportador();
  });

  it("escribe los productos con el precio único (texto → Decimal), su disponibilidad, la carta y UNA auditoría por producto y por contenido", async () => {
    expect(await escribir()).toEqual({ productos: 3, filasDeDisponibilidad: 5, contenidos: 3, auditorias: 6 });
    const productos = await prisma.producto.findMany({ orderBy: { codigo: "asc" }, select: { codigo: true, nombre: true, tipo: true, precioVenta: true, factorConversion: true, modoDeVenta: true, seProduce: true, unidadStockId: true } });
    expect(productos.map((p) => ({ ...p, precioVenta: p.precioVenta.toFixed(2), factorConversion: p.factorConversion.toString() }))).toEqual([
      { codigo: "CAFE-CHICO", nombre: "Café Chico", tipo: "PV", precioVenta: "4100.00", factorConversion: "1", modoDeVenta: "DIRECTO", seProduce: false, unidadStockId: semilla.unidadId },
      { codigo: "PIZZA-MUZZA", nombre: "Pizza Muzza", tipo: "PV", precioVenta: "22000.00", factorConversion: "1", modoDeVenta: "DIRECTO", seProduce: false, unidadStockId: semilla.unidadId },
      { codigo: "VINO-VENTUS", nombre: "Vino Ventus", tipo: "PV", precioVenta: "0.00", factorConversion: "1", modoDeVenta: "DIRECTO", seProduce: false, unidadStockId: semilla.unidadId },
    ]);
    expect(await prisma.precioLocalProducto.count()).toBe(0);
    expect(await prisma.disponibilidadProducto.count({ where: { sucursalId: semilla.oficinas } })).toBe(0);
    const pizza = await prisma.producto.findFirstOrThrow({ where: { codigo: "PIZZA-MUZZA" } });
    expect(await prisma.disponibilidadProducto.findMany({ where: { productoId: pizza.id }, orderBy: { sucursalId: "asc" }, select: { sucursalId: true, disponible: true } })).toEqual(
      [
        { sucursalId: semilla.sucursales.Huinganco, disponible: true },
        { sucursalId: semilla.sucursales["Los Miches"], disponible: true },
        { sucursalId: semilla.sucursales.Varvarco, disponible: false },
      ].sort((a, b) => (a.sucursalId < b.sucursalId ? -1 : 1)),
    );
    const contenidos = await prisma.contenidoCartaProducto.findMany({ orderBy: { sucursalId: "asc" } });
    // Tres: Huinganco, Los Miches y Varvarco (no disponible, pero con sección y precio: lleva su contenido visible; la carta lo oculta por la disponibilidad).
    expect(contenidos).toHaveLength(3);
    expect(contenidos.find((c) => c.sucursalId === semilla.sucursales.Huinganco)).toMatchObject({ productoId: pizza.id, visibleEnCarta: true, seccionCartaId: semilla.secciones.Pizzas, descripcion: "Con orégano", orden: 2, especial: false, tags: [], generoCartaId: null, mostrarNombreArriba: false });
    const auditorias = await prisma.registroAuditoria.findMany({ orderBy: { entidad: "asc" } });
    expect(auditorias.filter((a) => a.entidad === "Producto").map((a) => [a.campo, a.valorAnterior, a.valorNuevo, a.sucursalId]).sort()).toEqual([
      ["precioVenta", null, "0.00", null],
      ["precioVenta", null, "22000.00", null],
      ["precioVenta", null, "4100.00", null],
    ]);
    expect(auditorias.find((a) => a.entidad === "Producto" && a.valorNuevo === "22000.00")!.descripcion).toContain("abcdef012345");
    expect(auditorias.filter((a) => a.entidad === "ContenidoCartaProducto").map((a) => [a.entidadId, a.campo, a.valorAnterior, a.valorNuevo, a.sucursalId, a.actorId]).sort()).toEqual(
      [
        [`${semilla.sucursales.Huinganco}:${pizza.id}`, "visibleEnCarta", null, "true", semilla.sucursales.Huinganco, semilla.duena.id],
        [`${semilla.sucursales["Los Miches"]}:${pizza.id}`, "visibleEnCarta", null, "true", semilla.sucursales["Los Miches"], semilla.duena.id],
        [`${semilla.sucursales.Varvarco}:${pizza.id}`, "visibleEnCarta", null, "true", semilla.sucursales.Varvarco, semilla.duena.id],
      ].sort(),
    );
  });

  it("atomicidad: si la auditoría falla a mitad, no queda NADA (ni productos, ni disponibilidad, ni carta, ni auditoría)", async () => {
    romperLaAuditoria.activo = true;
    await expect(escribir()).rejects.toThrow("falla simulada de la auditoría");
    expect(await prisma.producto.count()).toBe(0);
    expect(await prisma.disponibilidadProducto.count()).toBe(0);
    expect(await prisma.contenidoCartaProducto.count()).toBe(0);
    expect(await prisma.registroAuditoria.count()).toBe(0);
  });

  it("un código que ya existe choca con el índice único (P2002) y tampoco deja nada", async () => {
    await prisma.producto.create({ data: { codigo: "CAFE-CHICO", nombre: "Otro café", tipo: "PV", unidadStockId: semilla.unidadId } });
    await expect(escribir()).rejects.toMatchObject({ code: "P2002" });
    expect(await prisma.producto.count()).toBe(1);
    expect(await prisma.contenidoCartaProducto.count()).toBe(0);
    expect(await prisma.registroAuditoria.count()).toBe(0);
  });

  it("crearContenidosImportados CREA y nunca pisa: con un contenido ya existente para (sucursal, producto) choca (P2002) y la fila queda idéntica (ni upsert ni skipDuplicates)", async () => {
    const producto = await prisma.producto.create({ data: { codigo: "PIZZA-EXISTENTE", nombre: "Pizza existente", tipo: "PV", unidadStockId: semilla.unidadId } });
    const sucursalId = semilla.sucursales.Huinganco;
    // Lo que ya cargó alguien: OTRA sección, OTRA descripción, oculto y con otro orden.
    await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: producto.id, visibleEnCarta: false, seccionCartaId: semilla.secciones.Entrada, descripcion: "Cargada a mano", orden: 9 } });
    const clave = { sucursalId_productoId: { sucursalId, productoId: producto.id } };
    const antes = await prisma.contenidoCartaProducto.findUniqueOrThrow({ where: clave });

    const delImportador: Parameters<typeof crearContenidosImportados>[1][number] = { sucursalId, productoId: producto.id, visibleEnCarta: true, seccionCartaId: semilla.secciones.Pizzas, descripcion: "Del importador", orden: 1, especial: false, tags: [], generoCartaId: null, mostrarNombreArriba: false };
    await expect(conTransaccionSerializable(transaccion(), (tx) => crearContenidosImportados(tx, [delImportador]))).rejects.toMatchObject({ code: "P2002" });

    expect(await prisma.contenidoCartaProducto.findUniqueOrThrow({ where: clave })).toEqual(antes);
    expect(await prisma.contenidoCartaProducto.count()).toBe(1);
  });
});
