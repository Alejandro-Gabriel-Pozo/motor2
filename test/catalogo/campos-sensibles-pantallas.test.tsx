import type { ReactElement, ReactNode } from "react";
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
// Las acciones de alta rápida que usa el formulario se reemplazan; las LECTURAS que usan las páginas (listas de insumos, categorías y proveedores) son las reales: las páginas se llaman de verdad contra la base.
vi.mock("../../src/server/actions/catalogo/insumos", async (original) => ({ ...(await original<typeof import("../../src/server/actions/catalogo/insumos")>()), crearInsumo: vi.fn() }));
vi.mock("../../src/server/actions/catalogo/categorias-producto", async (original) => ({ ...(await original<typeof import("../../src/server/actions/catalogo/categorias-producto")>()), crearCategoriaProducto: vi.fn() }));
vi.mock("../../src/server/actions/catalogo/proveedores", async (original) => ({ ...(await original<typeof import("../../src/server/actions/catalogo/proveedores")>()), altaProveedor: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, EMPRESA_POR_DEFECTO_ID } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { puedeEditarCamposSensiblesDelProducto } from "../../src/server/acceso/campos-sensibles-de-producto";
import { ProductoForm, type ProductoExistente } from "../../src/app/(app)/catalogo/productos/producto-form";
import NuevoProductoPage from "../../src/app/(app)/catalogo/productos/nuevo/page";
import EditarProductoPage from "../../src/app/(app)/catalogo/productos/[id]/editar/page";
import { conLasUnidadesDelProducto } from "../../src/app/(app)/catalogo/productos/opciones-formulario";
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

/** Los props de cada `tipo` de componente que el árbol (ya armado por la página) lleva: lo que la página le pasa al formulario, que es lo que viaja al navegador. */
function propsDe(arbol: ReactNode, tipo: unknown): Record<string, unknown>[] {
  const hallados: Record<string, unknown>[] = [];
  const recorrer = (nodo: ReactNode) => {
    if (Array.isArray(nodo)) return nodo.forEach(recorrer);
    if (!nodo || typeof nodo !== "object" || !("props" in nodo)) return;
    const el = nodo as ReactElement<Record<string, unknown> & { children?: ReactNode }>;
    if (el.type === tipo) hallados.push(el.props);
    recorrer(el.props.children);
  };
  recorrer(arbol);
  return hallados;
}

/**
 * (2) y (D): las PÁGINAS reales (alta y edición) contra la base. Antes este eslabón era una expresión regular sobre el código fuente de las páginas; ahora se las llama de verdad, con una persona real (rol y
 * permisos en la base) y se mira lo que le pasan al formulario: el permiso que calcula el servidor y las unidades.
 */
describe("(2) las páginas de alta y de edición le pasan al formulario el permiso que calcula el servidor", () => {
  let sucursalId: string;
  let usuarios: { admin: string; operador: string; conClave: string; soloVer: string };
  let productoId: string;
  let kgId: string;
  let gId: string;

  const como = (id: string, email: string) => mockearUsuarioActual({ id, email, nombre: null });
  const alta = async () => propsDe(await NuevoProductoPage(), ProductoForm)[0]!;
  const edicion = async () => propsDe(await EditarProductoPage({ params: Promise.resolve({ id: productoId }) }), ProductoForm)[0]!;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    kgId = catalogo.kg.id;
    gId = catalogo.g.id;
    productoId = (await sembrarProductoDisponible({ codigo: "MP_QUESO", nombre: "Queso", tipo: "MP", unidadStockId: kgId, unidadCompraId: gId, factorConversion: 25 }, sucursalId)).id;
    const rolPropio = async (nombre: string, editar: boolean) => {
      const rol = await prisma.rol.create({ data: { nombre } });
      // Lo que hace falta para abrir las dos pantallas, más la clave fina en el nivel pedido (Ver solamente, o Ver y Editar).
      for (const accionClave of ["alta_producto", "producto_editar", "producto_ver_catalogo"]) await prisma.permisoRol.create({ data: { rolId: rol.id, accionClave, puedeVer: true, puedeEditar: true } });
      await prisma.permisoRol.create({ data: { rolId: rol.id, accionClave: "producto_campos_sensibles", puedeVer: true, puedeEditar: editar } });
      return rol.id;
    };
    usuarios = {
      admin: (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id,
      operador: (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: base.operador.id })).id,
      conClave: (await crearUsuarioConMembresia({ email: "precios@test.com", sucursalId, rolId: await rolPropio("Precios", true) })).id,
      soloVer: (await crearUsuarioConMembresia({ email: "mira@test.com", sucursalId, rolId: await rolPropio("Mira", false) })).id,
    };
  });

  it.each([
    ["admin", "admin@test.com", true],
    ["conClave", "precios@test.com", true],
    ["operador", "operador@test.com", false],
    ["soloVer", "mira@test.com", false],
  ] as const)("%s: el formulario de ALTA recibe puedeEditarCamposSensibles=%s según lo que dice la base, no un valor fijo", async (quien, email, esperado) => {
    await como(usuarios[quien], email);
    expect((await alta()).puedeEditarCamposSensibles).toBe(esperado);
  });

  it.each([
    ["admin", "admin@test.com", true],
    ["conClave", "precios@test.com", true],
    ["operador", "operador@test.com", false],
    ["soloVer", "mira@test.com", false],
  ] as const)("%s: el formulario de EDICIÓN recibe puedeEditarCamposSensibles=%s según lo que dice la base, no un valor fijo", async (quien, email, esperado) => {
    await como(usuarios[quien], email);
    expect((await edicion()).puedeEditarCamposSensibles).toBe(esperado);
  });

  it("cambiar la clave en la base cambia lo que recibe la pantalla en la siguiente carga (nada queda fijo en el código de la página)", async () => {
    await como(usuarios.conClave, "precios@test.com");
    expect((await edicion()).puedeEditarCamposSensibles).toBe(true);
    await prisma.permisoRol.updateMany({ where: { accionClave: "producto_campos_sensibles", rol: { nombre: "Precios" } }, data: { puedeEditar: false } });
    expect((await edicion()).puedeEditarCamposSensibles).toBe(false);
  });

  describe("(D) la unidad inactiva del producto sigue en las opciones de la edición", () => {
    const unidadesDe = async () => (await edicion()).unidades as { id: string; nombre: string; inactiva?: boolean }[];

    it("con todas las unidades activas, el formulario recibe solo las activas y ninguna marcada", async () => {
      await como(usuarios.admin, "admin@test.com");
      expect((await unidadesDe()).some((u) => u.inactiva)).toBe(false);
    });

    it("si la unidad de COMPRA del producto se desactivó, está igual en las opciones, marcada inactiva (antes: faltaba y se mostraba «Sin unidad de compra»)", async () => {
      await prisma.unidad.update({ where: { id: gId }, data: { activa: false } });
      for (const [quien, email] of [["admin", "admin@test.com"], ["operador", "operador@test.com"]] as const) {
        await como(usuarios[quien], email);
        const g = (await unidadesDe()).find((u) => u.id === gId);
        expect(g, `${quien}: la unidad de compra inactiva tiene que estar en las opciones`).toBeDefined();
        expect(g!.inactiva).toBe(true);
      }
    });

    it("si la unidad de STOCK se desactivó, también", async () => {
      await prisma.unidad.update({ where: { id: kgId }, data: { activa: false } });
      await como(usuarios.admin, "admin@test.com");
      expect((await unidadesDe()).find((u) => u.id === kgId)?.inactiva).toBe(true);
    });

    it("una unidad inactiva que el producto NO usa no aparece", async () => {
      const ml = await prisma.unidad.create({ data: { nombre: "ml", magnitud: "VOLUMEN", decimales: 0, activa: false } });
      await como(usuarios.admin, "admin@test.com");
      expect((await unidadesDe()).some((u) => u.id === ml.id)).toBe(false);
    });
  });
});

describe("(D) conLasUnidadesDelProducto", () => {
  const kg = { id: "u-kg", nombre: "kg" };
  const g = { id: "u-g", nombre: "g" };
  it("agrega las que faltan marcadas inactivas, sin duplicar las activas ni repetir, e ignora «sin unidad de compra»", () => {
    expect(conLasUnidadesDelProducto([kg], [kg, g, g, null])).toEqual([kg, { ...g, inactiva: true }]);
    expect(conLasUnidadesDelProducto([kg, g], [kg, null])).toEqual([kg, g]);
    expect(conLasUnidadesDelProducto([], [null])).toEqual([]);
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
const soloLectura = (html: string, campo: string) => html.match(new RegExp(`data-solo-lectura="${campo}"[^>]*>([\\s\\S]*?)</dl>`))?.[1] ?? null;
// Solo para leer el texto de un fragmento YA renderizado por React en un test (no sanea nada para mostrarlo): se parte por las etiquetas en vez de borrarlas con `replace`.
const textoPlano = (html: string | null) => (html ?? "").split(/<[^>]*>/).join("");

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
    expect(textoPlano(soloLectura(html, "precioVenta"))).toContain("$3.200,00");
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

describe("(3) ProductoForm: el solo lectura (M.2-A4, E)", () => {
  it("el precio se ve SIEMPRE con dos decimales (es plata): $3.200,00, $1.234,50 y $0,00", () => {
    const precio = (precioVenta: number) => textoPlano(soloLectura(dibujar(false, existente({ tipo: "PV", unidadCompraId: null, factorConversion: 1, precioVenta })), "precioVenta"));
    expect(precio(3200)).toContain("$3.200,00");
    expect(precio(1234.5)).toContain("$1.234,50");
    expect(precio(0)).toContain("$0,00");
  });

  it("la etiqueta y el valor van asociados (término y definición de una lista) y el valor no se dibuja como un campo editable", () => {
    const html = dibujar(false, existente({ tipo: "PV", unidadCompraId: null, factorConversion: 1, precioVenta: 3200 }));
    const bloque = html.match(/<dl[^>]*data-solo-lectura="precioVenta"[^>]*>[\s\S]*?<\/dl>/)?.[0] ?? "";
    expect(bloque).toMatch(/<dt[^>]*>Precio de venta<\/dt><dd[^>]*>\$3\.200,00<\/dd>/);
    expect(bloque).not.toMatch(/border/); // sin el recuadro (punteado) de un campo
    expect(bloque).not.toMatch(/<input|<select|<textarea/);
  });
});

describe("(3) ProductoForm: edición con una unidad INACTIVA (M.2-A4, D)", () => {
  // La edición recibe también las unidades que el producto usa aunque se hayan desactivado (`conLasUnidadesDelProducto`), marcadas `inactiva`.
  const conInactiva = [...unidades.filter((u) => u.id !== "u-bolsa"), { id: "u-bolsa", nombre: "bolsa", decimales: 0, inactiva: true }];
  const dibujarConInactiva = (puede: boolean) =>
    renderToStaticMarkup(<ProductoForm {...comunes} unidades={conInactiva} puedeEditarCamposSensibles={puede} productoExistente={existente()} presentacionesIniciales={[]} />);

  it("SIN la clave, la unidad de compra inactiva se ve con su nombre y «(inactiva)», no como «Sin unidad de compra» (antes: el dato falso)", () => {
    const html = dibujarConInactiva(false);
    expect(textoPlano(soloLectura(html, "unidadCompraId"))).toContain("bolsa (inactiva)");
    expect(html).not.toContain("Sin unidad de compra");
  });

  it("CON la clave, el desplegable de la unidad de compra ofrece la inactiva y la deja elegida (antes: no estaba, mandaba vacío y borraba la unidad al guardar)", () => {
    const html = dibujarConInactiva(true);
    const desplegable = html.match(/<select[^>]*aria-label="Unidad de compra"[^>]*>[\s\S]*?<\/select>/)?.[0] ?? "";
    expect(desplegable).toMatch(/<option value="u-bolsa"[^>]*selected[^>]*>bolsa \(inactiva\)<\/option>/);
  });

  it("la gestión de presentaciones NO ofrece la unidad inactiva para agregar una presentación nueva", () => {
    const html = dibujarConInactiva(true);
    const alta = html.slice(html.indexOf("Elegí una unidad"));
    expect(alta).toContain('value="u-kg"');
    expect(alta).not.toContain('value="u-bolsa"');
  });

  it("la unidad de STOCK inactiva también se ve con su nombre (solo lectura, sin la clave)", () => {
    const html = renderToStaticMarkup(
      <ProductoForm {...comunes} unidades={[{ id: "u-kg", nombre: "kg", decimales: 2, inactiva: true }, ...unidades.filter((u) => u.id !== "u-kg")]} puedeEditarCamposSensibles={false} productoExistente={existente()} presentacionesIniciales={[]} />,
    );
    expect(textoPlano(soloLectura(html, "unidadStockId"))).toContain("kg (inactiva)");
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

  // M.2-A4: el tilde de las sucursales y su aviso. Un PV sin la clave (tilde apagado, deshabilitado y con aviso) solo se puede dibujar tras elegir el tipo en el navegador: lo cubre el e2e
  // (`catalogo-campos-sensibles.spec.ts`). Acá, lo que NO debe cambiar en el alta de una materia prima, que no se vende.
  const tildeDeSucursales = (html: string) => html.match(/<input[^>]*type="checkbox"[^>]*\/>\s*Activo en todas las sucursales/)?.[0] ?? null;
  it("SIN la clave, el alta de una MATERIA PRIMA deja el tilde de sucursales tildado y libre, y no avisa que no se podrá vender", () => {
    const mp = dibujar(false);
    const tilde = tildeDeSucursales(mp);
    expect(tilde).not.toBeNull();
    expect(tilde).toContain('checked=""');
    expect(tilde).not.toContain("disabled");
    expect(mp).not.toContain("data-aviso-alta-sin-precio");
  });

  it("CON la clave el alta dibuja los controles de siempre", () => {
    const mp = dibujar(true);
    expect(tildeDeSucursales(mp)).toContain('checked=""');
    expect(mp).not.toContain("data-aviso-alta-sin-precio");
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
