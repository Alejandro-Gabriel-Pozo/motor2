import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// El formulario es un componente de cliente: fuera de Next no hay router ni se llama a ninguna acción de servidor. Esta prueba mide solo lo que DIBUJA.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));
vi.mock("../../src/server/actions/catalogo/productos", () => ({
  darDeAltaProducto: vi.fn(),
  actualizarProducto: vi.fn(),
  sincronizarPrecioGrupoCarta: vi.fn(),
  obtenerInsumoDeProducto: vi.fn(),
  asignarInsumoAProducto: vi.fn(),
  agregarPresentacionAlternativa: vi.fn(),
  actualizarActivaPresentacion: vi.fn(),
  listarPresentaciones: vi.fn(),
  buscarProductosSelector: vi.fn(),
}));
vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
vi.mock("../../src/server/actions/catalogo/insumos", () => ({ crearInsumo: vi.fn() }));
vi.mock("../../src/server/actions/catalogo/categorias-producto", () => ({ crearCategoriaProducto: vi.fn() }));
vi.mock("../../src/server/actions/catalogo/proveedores", () => ({ altaProveedor: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, EMPRESA_POR_DEFECTO_ID } from "../setup/test-db";
import { puedeEditarCamposSensiblesDelProducto } from "../../src/app/(app)/catalogo/productos/opciones-formulario";
import { ProductoForm, type ProductoExistente } from "../../src/app/(app)/catalogo/productos/producto-form";
import { GestionPresentaciones } from "../../src/components/catalogo/gestion-presentaciones";

/**
 * M.2 (P6) — las pantallas de producto y la clave fina `producto_campos_sensibles`. El SERVIDOR ya la exige (P2 a P5); acá se mide la otra mitad: que quien no la tiene no vea como editable lo que el
 * servidor le va a rechazar. Tres eslabones: (1) el permiso lo calcula el servidor con el gate y baja a la pantalla como dato; (2) las dos páginas lo calculan así y se lo pasan al formulario; (3) el
 * formulario y la gestión de presentaciones dibujan solo lectura (con el valor guardado y el permiso que hace falta) sin la clave, y los controles de siempre con ella.
 */
describe("(1) el permiso lo calcula el servidor con el gate", () => {
  let sucursalId: string;
  let rolAdminId: string;
  let rolOperadorId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    rolAdminId = base.admin.id;
    rolOperadorId = base.operador.id;
  });

  const puede = async (rolId: string, email: string) => {
    const usuario = await crearUsuarioConMembresia({ email, sucursalId, rolId });
    return puedeEditarCamposSensiblesDelProducto({ usuarioId: usuario.id, empresaId: EMPRESA_POR_DEFECTO_ID, db: prisma });
  };

  it("el administrador (semilla) sí; el operador de fábrica no, aunque edite productos", async () => {
    expect(await puede(rolAdminId, "admin@test.com")).toBe(true);
    expect(await puede(rolOperadorId, "operador@test.com")).toBe(false);
    expect((await prisma.permisoRol.findFirstOrThrow({ where: { rolId: rolOperadorId, accionClave: "producto_editar" } })).puedeEditar, "control: el operador sí edita productos").toBe(true);
  });

  it("un rol propio con la clave en Editar sí; con la clave solo en Ver no; sin la clave no", async () => {
    const conClave = await prisma.rol.create({ data: { nombre: "Precios" } });
    await prisma.permisoRol.create({ data: { rolId: conClave.id, accionClave: "producto_campos_sensibles", puedeVer: true, puedeEditar: true } });
    const soloVer = await prisma.rol.create({ data: { nombre: "Mira" } });
    await prisma.permisoRol.create({ data: { rolId: soloVer.id, accionClave: "producto_campos_sensibles", puedeVer: true, puedeEditar: false } });
    const sinClave = await prisma.rol.create({ data: { nombre: "Altas" } });
    await prisma.permisoRol.create({ data: { rolId: sinClave.id, accionClave: "alta_producto", puedeVer: true, puedeEditar: true } });
    expect(await puede(conClave.id, "precios@test.com")).toBe(true);
    expect(await puede(soloVer.id, "mira@test.com")).toBe(false);
    expect(await puede(sinClave.id, "altas@test.com")).toBe(false);
  });
});

describe("(2) las páginas de alta y de edición se lo pasan al formulario", () => {
  const raiz = join(__dirname, "../../src/app/(app)/catalogo/productos");
  it.each([["nuevo/page.tsx"], ["[id]/editar/page.tsx"]])("%s calcula el permiso con el gate del servidor y no lo fija", (ruta) => {
    const fuente = readFileSync(join(raiz, ruta), "utf8");
    expect(fuente).toMatch(/const puedeEditarCamposSensibles = await puedeEditarCamposSensiblesDelProducto\(ctx\);/);
    expect(fuente).toMatch(/<ProductoForm[^>]*puedeEditarCamposSensibles=\{puedeEditarCamposSensibles\}/);
  });
});

const unidades = [
  { id: "u-kg", nombre: "kg", decimales: 2 },
  { id: "u-bolsa", nombre: "bolsa", decimales: 0 },
];
const comunes = { unidades, insumosIniciales: [], categoriasIniciales: [], proveedoresIniciales: [], puedeCrear: { categoria: false, insumo: false, proveedor: false }, puedeGestionarConsignacion: false };
const existente = (extra: Partial<ProductoExistente> = {}): ProductoExistente => ({
  id: "p1",
  codigo: "MP_1",
  nombre: "Harina",
  tipo: "MP",
  unidadStockId: "u-kg",
  unidadCompraId: "u-bolsa",
  factorConversion: 25,
  precioVenta: 0,
  ...extra,
});
const dibujar = (puede: boolean, productoExistente?: ProductoExistente) =>
  renderToStaticMarkup(<ProductoForm {...comunes} puedeEditarCamposSensibles={puede} productoExistente={productoExistente} presentacionesIniciales={[]} cantidadSucursales={1} nombreSucursalActual="Central" />);
const soloLectura = (html: string, campo: string) => html.match(new RegExp(`data-solo-lectura="${campo}"[^>]*>(.*?)</div>`, "s"))?.[1] ?? null;
const textoPlano = (html: string | null) => (html ?? "").replace(/<[^>]*>/g, "");

describe("(3) ProductoForm: edición", () => {
  it("SIN la clave, una materia prima muestra factor y unidades guardados como solo lectura, sin ningún control para cambiarlos", () => {
    const html = dibujar(false, existente());
    expect(html).not.toContain('name="factorConversion"');
    expect(html).not.toContain('name="unidadCompraId"');
    expect(html).not.toContain('aria-label="Unidad de stock"');
    expect(textoPlano(soloLectura(html, "unidadStockId"))).toContain("kg");
    expect(textoPlano(soloLectura(html, "unidadCompraId"))).toContain("bolsa");
    expect(textoPlano(soloLectura(html, "factorConversion"))).toContain("25");
    expect(html).toContain("data-aviso-campos-sensibles");
    expect(html).toContain("campos sensibles del producto");
    expect(html).toContain('name="nombre"'); // lo demás sigue editable
  });

  it("SIN la clave, un producto de venta muestra el precio guardado como solo lectura y sin el campo de precio", () => {
    const html = dibujar(false, existente({ tipo: "PV", unidadCompraId: null, factorConversion: 1, precioVenta: 3200 }));
    expect(html).not.toContain('name="precioVenta"');
    expect(textoPlano(soloLectura(html, "precioVenta"))).toContain("$3.200");
    expect(html).toContain('name="pasoVenta"'); // el paso de venta no es un campo sensible
  });

  it("CON la clave dibuja los controles de siempre y ningún aviso", () => {
    const mp = dibujar(true, existente());
    for (const control of ['name="factorConversion"', 'name="unidadCompraId"', 'aria-label="Unidad de stock"']) expect(mp).toContain(control);
    expect(mp).not.toContain("data-solo-lectura");
    expect(mp).not.toContain("data-aviso-campos-sensibles");
    const pv = dibujar(true, existente({ tipo: "PV", precioVenta: 3200 }));
    expect(pv).toContain('name="precioVenta"');
  });
});

describe("(3) ProductoForm: alta", () => {
  it("SIN la clave el alta se ve como la crea el servidor: precio 0, factor 1 y sin unidad de compra; la unidad de stock sigue libre", () => {
    const mp = dibujar(false);
    expect(mp).not.toContain('name="factorConversion"');
    expect(mp).not.toContain('name="unidadCompraId"');
    expect(textoPlano(soloLectura(mp, "factorConversion"))).toContain("1");
    expect(textoPlano(soloLectura(mp, "unidadCompraId"))).toContain("Sin unidad de compra");
    expect(mp).toContain('aria-label="Unidad de stock"'); // el servidor deja libre la unidad de stock del alta
    expect(mp).not.toContain('data-solo-lectura="unidadStockId"');
    expect(mp).toContain("data-aviso-campos-sensibles");
  });

  it("CON la clave el alta dibuja los controles de siempre", () => {
    const mp = dibujar(true);
    for (const control of ['name="factorConversion"', 'name="unidadCompraId"', 'aria-label="Unidad de stock"']) expect(mp).toContain(control);
    expect(mp).not.toContain("data-aviso-campos-sensibles");
  });
});

describe("(3) GestionPresentaciones", () => {
  const presentaciones = [{ id: "pr1", unidadCompraId: "u-bolsa", unidadCompraNombre: "bolsa", factorConversion: 25, activa: true }];
  const dibujarPresentaciones = (puede: boolean) =>
    renderToStaticMarkup(<GestionPresentaciones productoId="p1" unidades={unidades} presentacionesIniciales={presentaciones} puedeEditarCamposSensibles={puede} />);

  it("SIN la clave se ve la lista (con su factor) pero no el alta de una presentación nueva: ni «Agregar» ni el campo del factor", () => {
    const html = dibujarPresentaciones(false);
    expect(html).toContain("bolsa");
    expect(html).toContain("25");
    expect(html).not.toMatch(/>Agregar</);
    expect(html).not.toContain("Elegí una unidad");
    expect(html).toContain("data-aviso-presentaciones-sin-permiso");
    expect(html).toContain("campos sensibles del producto");
    expect(html).toContain("Desactivar"); // activar y desactivar siguen siendo de producto_presentaciones
  });

  it("CON la clave está el alta de siempre y ningún aviso", () => {
    const html = dibujarPresentaciones(true);
    expect(html).toMatch(/>Agregar</);
    expect(html).toContain("Elegí una unidad");
    expect(html).not.toContain("data-aviso-presentaciones-sin-permiso");
  });
});
