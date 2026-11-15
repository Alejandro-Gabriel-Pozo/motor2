import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarProducto, darDeAltaProducto, darDeAltaProductoRapido, type DatosProductoEdicion } from "../../src/server/actions/catalogo/productos";
import { actualizarProveedor, altaProveedor } from "../../src/server/actions/catalogo/proveedores";
import { crearCategoriaProducto } from "../../src/server/actions/catalogo/categorias-producto";
import { crearInsumo } from "../../src/server/actions/catalogo/insumos";
import { actualizarCliente, altaCliente } from "../../src/server/actions/clientes/cliente";

/**
 * Etapa E1 del plan de paridad con Pedernal: la regla de nombre de Pedernal (`src/core/datos/nombre-de-ficha.ts`) conectada en producto, insumo, categoría, proveedor y cliente.
 * Por punto de conexión, contra Postgres real: (1) el ALTA con un nombre inválido falla con el mensaje de siempre y no escribe; el válido se guarda canónico; (2) la EDICIÓN que NO
 * cambia el nombre guardado no falla aunque ese nombre no cumpla la regla nueva (se cargó antes); (3) la edición que CAMBIA el nombre a uno inválido falla y no escribe;
 * (4) el servidor compara contra lo guardado, no contra lo que manda el formulario. La tabla de puntos (doc §5) la recorre `test/arquitectura/nombres-puntos-de-validacion.test.ts`.
 */
const NOMBRE_VIEJO = "Pan_integral Привет"; // cargado antes de la regla nueva: guion bajo y cirílico.

describe("E1: la regla de nombre de Pedernal en cada punto de conexión", () => {
  let sucursalId: string;
  let unidadId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
  });

  const noContiene = /tiene caracteres no permitidos/;

  describe("producto", () => {
    const formulario = (nombre: string): DatosProductoEdicion => ({ nombre, tipo: "MP", unidadStockId: unidadId, factorConversion: 1, precioVenta: 0, precioVentaVisto: 0 });

    it("alta: «Pan_integral» y un nombre en cirílico se rechazan y no se crea nada; «¿Querés?» y 120 letras entran; se guarda canónico", async () => {
      for (const nombre of ["Pan_integral", "Привет", "+Kota", "12"]) {
        const r = await darDeAltaProducto({ codigo: `MP_X${nombre.length}`, nombre, tipo: "MP", unidadStockId: unidadId, factorConversion: 1 });
        expect(r.ok, nombre).toBe(false);
      }
      expect(await prisma.producto.count()).toBe(0);
      expect((await darDeAltaProducto({ codigo: "MP_OK1", nombre: "  Pan   dulce ", tipo: "MP", unidadStockId: unidadId, factorConversion: 1 })).ok).toBe(true);
      expect((await prisma.producto.findFirstOrThrow({ where: { codigo: "MP_OK1" } })).nombre).toBe("Pan dulce");
      expect((await darDeAltaProducto({ codigo: "MP_OK2", nombre: "A".repeat(120), tipo: "MP", unidadStockId: unidadId, factorConversion: 1 })).ok).toBe(true);
      expect(await darDeAltaProducto({ codigo: "MP_BAD", nombre: "A".repeat(121), tipo: "MP", unidadStockId: unidadId, factorConversion: 1 })).toEqual({ ok: false, mensaje: "El nombre no puede superar los 120 caracteres." });
    });

    it("alta rápida: el nombre inválido se rechaza antes que la unidad y el válido se guarda canónico", async () => {
      expect(await darDeAltaProductoRapido("Pan_integral", unidadId)).toMatchObject({ ok: false, mensaje: expect.stringMatching(noContiene) });
      expect((await darDeAltaProductoRapido("  Pan   rápido ", unidadId)).ok).toBe(true);
      expect((await prisma.producto.findFirstOrThrow({ where: { nombre: "Pan rápido" } })).nombre).toBe("Pan rápido");
    });

    it("edición sin cambiar el nombre: un producto con nombre viejo que no cumple se sigue editando; cambiarlo a uno inválido falla; a uno válido, pasa", async () => {
      const id = (await sembrarProductoDisponible({ codigo: "MP_VIEJO", nombre: NOMBRE_VIEJO, tipo: "MP", precioVenta: 0, unidadStockId: unidadId }, sucursalId)).id;
      // Mismo nombre (aunque no cumpla la regla nueva): no falla.
      expect(await actualizarProducto(id, { ...formulario(NOMBRE_VIEJO), observaciones: "cambio de otro campo" })).toMatchObject({ ok: true });
      expect((await prisma.producto.findUniqueOrThrow({ where: { id } })).nombre).toBe(NOMBRE_VIEJO);
      // Cambia a uno inválido: falla con el mensaje de siempre y no escribe.
      expect(await actualizarProducto(id, formulario("Otro_nombre"))).toMatchObject({ ok: false, mensaje: expect.stringMatching(noContiene) });
      expect((await prisma.producto.findUniqueOrThrow({ where: { id } })).nombre).toBe(NOMBRE_VIEJO);
      // Cambia a uno válido: pasa y se guarda canónico.
      expect(await actualizarProducto(id, formulario("  Pan   nuevo "))).toMatchObject({ ok: true });
      expect((await prisma.producto.findUniqueOrThrow({ where: { id } })).nombre).toBe("Pan nuevo");
    });

    it("el servidor no confía en el formulario: un nombre editado que no es el guardado se valida aunque el formulario «diga» lo contrario", async () => {
      const id = (await sembrarProductoDisponible({ codigo: "MP_VIEJO2", nombre: NOMBRE_VIEJO, tipo: "MP", precioVenta: 0, unidadStockId: unidadId }, sucursalId)).id;
      // Un nombre que se parece al guardado pero no es el mismo (un espacio de más adentro se colapsa: es OTRO texto) se valida como cambio.
      expect(await actualizarProducto(id, formulario(`${NOMBRE_VIEJO}!_`))).toMatchObject({ ok: false });
    });
  });

  describe("insumo", () => {
    it("alta: «Harina_0000» se rechaza; «Harina 0000» entra", async () => {
      expect(await crearInsumo("Harina_0000")).toMatchObject({ ok: false, mensaje: expect.stringMatching(noContiene) });
      expect((await crearInsumo("  Harina   0000 ")).ok).toBe(true);
      expect((await prisma.insumo.findFirstOrThrow()).nombre).toBe("Harina 0000");
    });
  });

  describe("categoría de producto (ficha de elección: 80, sin letra)", () => {
    it("alta: guion bajo rechazado, «2x1» y «¿Y?» aceptados, 81 letras rechazadas", async () => {
      expect(await crearCategoriaProducto("Bebidas_frías")).toMatchObject({ ok: false, mensaje: expect.stringMatching(noContiene) });
      expect((await crearCategoriaProducto("2x1")).ok).toBe(true);
      expect((await crearCategoriaProducto("¿Y?")).ok).toBe(true);
      expect(await crearCategoriaProducto("A".repeat(81))).toEqual({ ok: false, mensaje: "El nombre de la categoría no puede superar los 80 caracteres." });
    });
  });

  describe("proveedor (razón social: 200, con letra, sin ¿ ¡ ? ! % $)", () => {
    const datos = (nombre: string) => ({ nombre, ofreceProductos: true, ofreceServicios: false });

    it("alta: el «%» y un nombre solo de dígitos se rechazan; 200 letras entran", async () => {
      expect(await altaProveedor(datos("Ferro 50%"))).toMatchObject({ ok: false, mensaje: expect.stringMatching(noContiene) });
      expect(await altaProveedor(datos("12345"))).toMatchObject({ ok: false, mensaje: "El nombre tiene que tener al menos una letra o un número." });
      expect((await altaProveedor(datos("A".repeat(200)))).ok).toBe(true);
    });

    it("edición: el nombre viejo que no cumple no bloquea editar otro dato; cambiarlo a uno inválido falla", async () => {
      const p = await prisma.proveedor.create({ data: { codigo: "PRV_VIEJO", nombre: "Ferro 50%", ofreceProductos: true } });
      // Sin cambiar el nombre: edita el contacto.
      expect(await actualizarProveedor(p.id, { nombre: "Ferro 50%", nombreEsperado: "Ferro 50%", contacto: "Ana" })).toMatchObject({ ok: true });
      expect((await prisma.proveedor.findUniqueOrThrow({ where: { id: p.id } })).contacto).toBe("Ana");
      expect(await actualizarProveedor(p.id, { nombre: "Ferro 60%", nombreEsperado: "Ferro 50%" })).toMatchObject({ ok: false, mensaje: expect.stringMatching(noContiene) });
      expect((await prisma.proveedor.findUniqueOrThrow({ where: { id: p.id } })).nombre).toBe("Ferro 50%");
    });
  });

  describe("cliente (razón social: 200, con letra, sin ¿ ¡ ? ! % $)", () => {
    it("alta: «50%» se rechaza; un nombre normal entra canónico", async () => {
      expect(await altaCliente("Club 50%", 0)).toMatchObject({ ok: false, mensaje: expect.stringMatching(noContiene) });
      expect((await altaCliente("  Club   Social ", 0)).ok).toBe(true);
      expect((await prisma.cliente.findFirstOrThrow()).nombre).toBe("Club Social");
    });

    it("edición: el nombre viejo no bloquea cambiar el %; cambiarlo a uno inválido falla", async () => {
      const c = await prisma.cliente.create({ data: { nombre: "Club 50%", descuentoPorcentaje: 0 } });
      expect(await actualizarCliente(c.id, "Club 50%", 10)).toMatchObject({ ok: true });
      expect(Number((await prisma.cliente.findUniqueOrThrow({ where: { id: c.id } })).descuentoPorcentaje)).toBe(10);
      expect(await actualizarCliente(c.id, "Club 60%", 10)).toMatchObject({ ok: false, mensaje: expect.stringMatching(noContiene) });
      expect((await prisma.cliente.findUniqueOrThrow({ where: { id: c.id } })).nombre).toBe("Club 50%");
    });
  });
});
