import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, crearUsuarioConMembresia } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { EMPRESA_TESTIGO_ID, clienteConEmpresaDePrueba } from "../setup/empresa-de-prueba";
import { urlDeSembradoDeVitest } from "../setup/rol-de-pruebas";
import { buscarProductosSelector, listarProductosPagina } from "../../src/server/actions/catalogo/productos";
import { CASOS_DEL_ORACULO, CATALOGO_DEL_ORACULO } from "./oraculo-busqueda-de-producto";

/** El oráculo (`oraculo-busqueda-de-producto.ts`) contra Postgres real, por la lista de Productos y por el buscador de producto: «las dos buscan igual». Más el aislamiento por empresa. */
describe("oráculo de la búsqueda de producto: base real", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const { kg } = await sembrarCatalogoBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: "admin@test.com", nombre: null });
    for (const [i, nombre] of CATALOGO_DEL_ORACULO.entries()) {
      await sembrarProductoDisponible({ codigo: `P${i + 1}`, nombre, tipo: "MP", unidadStockId: kg.id }, base.sucursal.id);
    }
    // La OTRA empresa tiene productos con las mismas palabras: no tienen que aparecer nunca.
    const otra = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
    const u = await otra.unidad.create({ data: { nombre: "kg", magnitud: "PESO", decimales: 2 } });
    for (const [i, nombre] of CATALOGO_DEL_ORACULO.entries()) {
      await otra.producto.create({ data: { codigo: `AJ${i + 1}`, nombre: `${nombre} AJENO`, tipo: "MP", unidadStockId: u.id } });
    }
  });

  for (const { caso, termino, esperados } of CASOS_DEL_ORACULO) {
    it(`${caso}: «${termino}»`, async () => {
      const lista = (await listarProductosPagina(undefined, termino)).items.map((p) => p.nombre).sort();
      const selector = (await buscarProductosSelector(termino)).map((p) => p.nombre).sort();
      expect(lista).toEqual([...esperados].sort());
      expect(selector).toEqual([...esperados].sort());
    });
  }

  it("aislamiento: ninguna búsqueda devuelve productos de la otra empresa", async () => {
    for (const termino of ["ajeno", "tomate", "harina 25", "jamon", "pina", ""]) {
      const lista = (await listarProductosPagina(undefined, termino)).items.map((p) => p.nombre);
      const selector = (await buscarProductosSelector(termino)).map((p) => p.nombre);
      expect(lista.filter((n) => n.includes("AJENO")), termino).toEqual([]);
      expect(selector.filter((n) => n.includes("AJENO")), termino).toEqual([]);
    }
  });
});
