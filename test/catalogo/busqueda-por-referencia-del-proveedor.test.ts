import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { EMPRESA_TESTIGO_ID, clienteConEmpresaDePrueba } from "../setup/empresa-de-prueba";
import { urlDeSembradoDeVitest } from "../setup/rol-de-pruebas";
import type { AccionClave } from "../../src/core/permisos/acciones";
import { buscarProductosSelector, listarProductosPagina } from "../../src/server/actions/catalogo/productos";

/**
 * Fase 7, Catálogo, M2 (diseño `docs/diseno-modulo-catalogo-2026-10-28.md` §9 e I9): el operario escribe lo que dice la factura del proveedor («ojo de bife rioplatense») y encuentra el producto del sistema
 * («Ojo de bife»), en la lista de Productos y en el buscador de producto de la compra. Es una LECTURA (sin escrituras, sin concurrencia que probar). Lo que se prueba: el permiso (solo quien ya ve ese dato
 * en otra pantalla: `proveedores` o `proceso_compra`), el aislamiento por empresa (la referencia de otra empresa no aparece), los comodines como letras y que el nombre y el código siguen buscando igual.
 */
describe("buscar un producto por cómo lo llama el proveedor (M2)", () => {
  let sucursalId: string;
  let rolAdminId: string;
  let ojoDeBifeId: string;

  const testigo = () => clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
  const sinVer = async (...claves: AccionClave[]) => {
    const { count } = await prisma.permisoRol.updateMany({ where: { rolId: rolAdminId, accionClave: { in: claves } }, data: { puedeVer: false, puedeEditar: false } });
    expect(count, `control: el rol administrador tiene la fila de ${claves.join(", ")}`).toBe(claves.length);
  };
  const enLaLista = async (termino: string) => (await listarProductosPagina(undefined, termino)).items.map((p) => p.nombre);
  const enElBuscador = async (termino: string) => (await buscarProductosSelector(termino)).map((p) => p.nombre);

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    rolAdminId = base.admin.id;
    const { kg, insumo } = await sembrarCatalogoBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: rolAdminId });
    await mockearUsuarioActual({ id: admin.id, email: "admin@test.com", nombre: null });

    ojoDeBifeId = (await sembrarProductoDisponible({ codigo: "MP_OJO", nombre: "Ojo de bife", tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id }, sucursalId)).id;
    await sembrarProductoDisponible({ codigo: "MP_NALGA", nombre: "Nalga", tipo: "MP", unidadStockId: kg.id }, sucursalId);
    const frigorifico = await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Frigorífico del Sur" } });
    const carniceria = await prisma.proveedor.create({ data: { codigo: "PRV_2", nombre: "Carnicería Don Pepe" } });
    await prisma.proveedorPorProducto.create({ data: { productoId: ojoDeBifeId, proveedorId: frigorifico.id, unidadCompraId: kg.id, referenciaProveedor: "Ojo de bife rioplatense x kg" } });
    await prisma.proveedorPorProducto.create({ data: { productoId: ojoDeBifeId, proveedorId: carniceria.id, unidadCompraId: kg.id, referenciaProveedor: "Bife ancho 100%_premium" } });

    // La OTRA empresa: un producto suyo que su proveedor llama «Corte secreto».
    const otra = testigo();
    const u = await otra.unidad.create({ data: { nombre: "kg", magnitud: "PESO", decimales: 2 } });
    const ajeno = await otra.producto.create({ data: { codigo: "MP_AJENO", nombre: "Producto ajeno", tipo: "MP", unidadStockId: u.id } });
    const proveedorAjeno = await otra.proveedor.create({ data: { codigo: "PRV_A", nombre: "Proveedor ajeno" } });
    await otra.proveedorPorProducto.create({ data: { productoId: ajeno.id, proveedorId: proveedorAjeno.id, unidadCompraId: u.id, referenciaProveedor: "Corte secreto" } });
  });

  it("con el «Ver» de proveedores y de la compra (administrador): lo encuentra por cómo lo llama cualquiera de sus proveedores, sin distinguir mayúsculas", async () => {
    expect(await enLaLista("rioplatense")).toEqual(["Ojo de bife"]);
    expect(await enLaLista("BIFE ANCHO")).toEqual(["Ojo de bife"]);
    expect(await enElBuscador("rioplatense")).toEqual(["Ojo de bife"]);
    // Una sola fila aunque dos proveedores lo nombren (el EXISTS no duplica).
    expect(await enLaLista("bife")).toEqual(["Ojo de bife"]);
  });

  it("el nombre y el código siguen buscando igual", async () => {
    expect(await enLaLista("nalga")).toEqual(["Nalga"]);
    expect(await enElBuscador("MP_OJO")).toEqual(["Ojo de bife"]);
  });

  it("con solo el «Ver» de proveedores (sin la compra), o solo el de la compra (sin proveedores), también", async () => {
    await sinVer("proceso_compra");
    expect(await enLaLista("rioplatense")).toEqual(["Ojo de bife"]);
    await prisma.permisoRol.updateMany({ where: { rolId: rolAdminId, accionClave: "proceso_compra" }, data: { puedeVer: true } });
    await sinVer("proveedores");
    expect(await enElBuscador("rioplatense")).toEqual(["Ojo de bife"]);
  });

  it("sin el «Ver» de proveedores NI el de la compra: la referencia no busca (no se revela cómo lo llama el proveedor), el nombre sí", async () => {
    await sinVer("proveedores", "proceso_compra");
    expect(await enLaLista("rioplatense")).toEqual([]);
    expect(await enElBuscador("rioplatense")).toEqual([]);
    expect(await enLaLista("ojo")).toEqual(["Ojo de bife"]);
  });

  it("la referencia de OTRA empresa no aparece", async () => {
    expect(await enLaLista("secreto")).toEqual([]);
    expect(await enElBuscador("secreto")).toEqual([]);
    // Control: en su empresa, el dato existe.
    expect(await testigo().proveedorPorProducto.count({ where: { referenciaProveedor: "Corte secreto" } })).toBe(1);
  });

  it("los comodines se buscan como letras: «%_» encuentra solo la referencia que los tiene, «_» suelto no encuentra todo", async () => {
    expect(await enLaLista("100%_")).toEqual(["Ojo de bife"]);
    expect(await enLaLista("%")).toEqual(["Ojo de bife"]);
    expect(await enLaLista("x_kg")).toEqual([]);
  });
});
