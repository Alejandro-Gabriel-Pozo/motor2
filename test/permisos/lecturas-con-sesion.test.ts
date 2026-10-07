import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { getUsuarioActual } from "../../src/core/auth/session";
import { listarSucursales } from "../../src/server/actions/auth/sucursales";
import { listarUsuariosDeSucursal } from "../../src/server/actions/auth/usuarios";
import { listarCategoriasProducto } from "../../src/server/actions/catalogo/categorias-producto";
import { listarGrupos, listarInsumos, previsualizarFusionInsumo } from "../../src/server/actions/catalogo/insumos";
import {
  buscarProductosSelector,
  listarPresentaciones,
  listarProductosPagina,
  obtenerInsumoDeProducto,
  obtenerPrecioVentaProducto,
  obtenerProductoOpcion,
} from "../../src/server/actions/catalogo/productos";
import { listarProductosDeProveedor, obtenerComparativaPreciosPorInsumo } from "../../src/server/actions/catalogo/proveedor-por-producto";
import { listarProveedores } from "../../src/server/actions/catalogo/proveedores";
import { listarVersionesDeReceta, obtenerRecetaVigente } from "../../src/server/actions/catalogo/recetas";
import { listarUnidadesActivas, listarUnidadesParaPanel } from "../../src/server/actions/catalogo/unidades";
import { obtenerHistorialConteosFisicos } from "../../src/server/actions/movimientos/lecturas-conteo-fisico";
import { listarPreciosLocales, obtenerPrecioLocalProducto } from "../../src/server/actions/movimientos/precio-local";
import { listarSeccionesActivas, listarSeccionesParaPanel } from "../../src/server/actions/movimientos/secciones";
import { listarDestinosConsumoActivos, listarMotivosMermaActivos } from "../../src/server/actions/movimientos/motivos";
import { listarCapacidades } from "../../src/server/actions/permisos/capacidades-sucursal";
import { listarMatrizPermisos } from "../../src/server/actions/permisos/permisos";
import { listarRoles } from "../../src/server/actions/permisos/roles";
import { obtenerSaldoDisponibleParaReclasificar } from "../../src/server/actions/stock/lecturas-reclasificacion";
import { listarStockMinimo } from "../../src/server/actions/stock/stock-minimo";
import { listarSucursalesParaEnviar, listarSucursalesParaSolicitar, obtenerBandejaTransferencias } from "../../src/server/actions/traspasos/lecturas";

/**
 * Las lecturas de servidor (server actions que devuelven datos) se pueden invocar directo, sin pasar por la página que
 * las usa: la página las protege, pero el endpoint no. Cada una abre con `requerirSesion()` o, si recibe la sucursal por
 * parámetro (que viene del cliente), con `requerirSesionEnSucursal(id)`. Ver src/server/actions/con-sesion.ts.
 *
 * Los argumentos son irrelevantes: la guarda corre antes que cualquier otra cosa. La regla de que ninguna función
 * exportada quede sin guarda la hace cumplir test/arquitectura/acciones-con-guarda.test.ts.
 */
const LECTURAS: Array<[string, () => Promise<unknown>]> = [
  ["listarSucursales", () => listarSucursales()],
  ["listarUsuariosDeSucursal", () => listarUsuariosDeSucursal("x")],
  ["listarCategoriasProducto", () => listarCategoriasProducto()],
  ["listarGrupos", () => listarGrupos()],
  ["listarInsumos", () => listarInsumos()],
  ["previsualizarFusionInsumo", () => previsualizarFusionInsumo("x", "y")],
  ["buscarProductosSelector", () => buscarProductosSelector("a")],
  ["listarPresentaciones", () => listarPresentaciones("x")],
  ["listarProductosPagina", () => listarProductosPagina()],
  ["obtenerInsumoDeProducto", () => obtenerInsumoDeProducto("x")],
  ["obtenerPrecioVentaProducto", () => obtenerPrecioVentaProducto("x")],
  ["obtenerProductoOpcion", () => obtenerProductoOpcion("x")],
  ["listarProductosDeProveedor", () => listarProductosDeProveedor("x")],
  ["obtenerComparativaPreciosPorInsumo", () => obtenerComparativaPreciosPorInsumo()],
  ["listarProveedores", () => listarProveedores()],
  ["listarVersionesDeReceta", () => listarVersionesDeReceta("x")],
  ["obtenerRecetaVigente", () => obtenerRecetaVigente("x")],
  ["listarUnidadesActivas", () => listarUnidadesActivas()],
  ["listarUnidadesParaPanel", () => listarUnidadesParaPanel()],
  ["obtenerHistorialConteosFisicos", () => obtenerHistorialConteosFisicos("x")],
  ["listarMotivosMermaActivos", () => listarMotivosMermaActivos()],
  ["listarDestinosConsumoActivos", () => listarDestinosConsumoActivos()],
  ["listarPreciosLocales", () => listarPreciosLocales("x")],
  ["obtenerPrecioLocalProducto", () => obtenerPrecioLocalProducto("x", "y")],
  ["listarSeccionesActivas", () => listarSeccionesActivas("x")],
  ["listarSeccionesParaPanel", () => listarSeccionesParaPanel("x")],
  ["listarCapacidades", () => listarCapacidades()],
  ["listarMatrizPermisos", () => listarMatrizPermisos()],
  ["listarRoles", () => listarRoles()],
  ["listarStockMinimo", () => listarStockMinimo("x")],
  ["obtenerSaldoDisponibleParaReclasificar", () => obtenerSaldoDisponibleParaReclasificar("x", "y", null)],
  ["listarSucursalesParaSolicitar", () => listarSucursalesParaSolicitar("x")],
  ["listarSucursalesParaEnviar", () => listarSucursalesParaEnviar("x")],
  ["obtenerBandejaTransferencias", () => obtenerBandejaTransferencias("x")],
];

/** Las que reciben la sucursal por parámetro: cada una, con el id de una sucursal a la que el usuario NO pertenece. */
const LECTURAS_POR_SUCURSAL: Array<[string, (sucursalId: string) => Promise<unknown>]> = [
  ["listarUsuariosDeSucursal", (id) => listarUsuariosDeSucursal(id)],
  ["obtenerHistorialConteosFisicos", (id) => obtenerHistorialConteosFisicos(id)],
  ["listarPreciosLocales", (id) => listarPreciosLocales(id)],
  ["obtenerPrecioLocalProducto", (id) => obtenerPrecioLocalProducto(id, "y")],
  ["listarSeccionesActivas", (id) => listarSeccionesActivas(id)],
  ["listarSeccionesParaPanel", (id) => listarSeccionesParaPanel(id)],
  ["listarStockMinimo", (id) => listarStockMinimo(id)],
  ["listarSucursalesParaSolicitar", (id) => listarSucursalesParaSolicitar(id)],
  ["listarSucursalesParaEnviar", (id) => listarSucursalesParaEnviar(id)],
  ["obtenerBandejaTransferencias", (id) => obtenerBandejaTransferencias(id)],
];

describe("lecturas de servidor: exigen sesión y, si reciben la sucursal, membresía en ella", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    vi.mocked(getUsuarioActual).mockReset();
  });

  it.each(LECTURAS)("%s sin sesión se rechaza", async (_nombre, llamar) => {
    vi.mocked(getUsuarioActual).mockResolvedValue(null);
    await expect(llamar()).rejects.toThrow("No autenticado");
  });

  it("un usuario con la membresía desactivada tampoco pasa (no tiene contexto)", async () => {
    const base = await sembrarBase();
    const inactivo = await crearUsuarioConMembresia({ email: "inactivo@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id, activo: false });
    await mockearUsuarioActual({ id: inactivo.id, email: inactivo.email, nombre: null });
    await expect(listarUsuariosDeSucursal(base.sucursal.id)).rejects.toThrow("No autenticado");
  });

  it.each(LECTURAS_POR_SUCURSAL)("%s con la sucursal de otro se rechaza aunque haya sesión", async (_nombre, llamar) => {
    const base = await sembrarBase();
    const ajena = await prisma.sucursal.create({ data: { nombre: "Sucursal ajena" } });
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });

    await expect(llamar(ajena.id)).rejects.toThrow("No tenés acceso a esa sucursal");
  });

  it("con sesión y la sucursal propia la lectura responde", async () => {
    const base = await sembrarBase();
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });

    await expect(listarSeccionesActivas(base.sucursal.id)).resolves.toEqual([]);
    await expect(listarSucursalesParaSolicitar(base.sucursal.id)).resolves.toEqual([]);
    await expect(listarSucursalesParaEnviar(base.sucursal.id)).resolves.toEqual([]);
  });
});
