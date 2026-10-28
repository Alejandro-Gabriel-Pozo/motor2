import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ContenidoExistente } from "../../../src/core/features/catalogo/importacion/estado";
import { normalizarCatalogo } from "../../../src/core/features/catalogo/importacion/normalizar";
import { contenidosAEscribir, planificarCarta, planificarFilaDeCarta, type HechosDeLaFilaDeCarta } from "../../../src/core/features/catalogo/importacion/planificar-carta";
import { planificarProductos } from "../../../src/core/features/catalogo/importacion/planificar-productos";
import { LOCALES_DEL_IMPORTADOR } from "../../../src/core/features/catalogo/importacion/tipos";
import { estadoVacio, idDeSucursal, permisosCompletos, productosAplicados, SECCIONES_DE_PRUEBA } from "./estado-de-prueba";
import { correccionesDe, libroDesde, type ProductoDeFixtura } from "./fixtura-de-catalogo";
import { resultadoEsperadoDeCarta, todasLasCombinacionesDeCarta, type CombinacionDeCarta } from "./oraculo-carta";

/** E1.3b del importador: el planificador de la carta mínima (A.2, I10 a I12) y el oráculo de 1.296 combinaciones (A.8). */
const PIZZAS = { id: "sec-pizzas", nombre: "Pizzas", activa: true };

function hechosDe(c: CombinacionDeCarta): HechosDeLaFilaDeCarta {
  const descripcion = c.descripcion === "VALIDA" ? ({ estado: "VALIDA", valor: "Con orégano" } as const) : c.descripcion === "AUSENTE" ? ({ estado: "AUSENTE" } as const) : ({ estado: "INVALIDA", texto: "x", mensaje: "inválida" } as const);
  const igual: ContenidoExistente = {
    sucursalId: "suc-1",
    visibleEnCarta: true,
    seccionCartaId: PIZZAS.id,
    descripcion: c.descripcion === "VALIDA" ? "Con orégano" : null,
    orden: 7,
    especial: false,
    tags: [],
    generoCartaId: null,
    mostrarNombreArriba: false,
  };
  return {
    accionDelProducto: c.accionDelProducto,
    seccionDelMapeo: c.categoria === "CON_SECCION" ? "Pizzas" : null,
    seccion: c.seccion === "NO_EXISTE" ? null : { ...PIZZAS, activa: c.seccion === "ACTIVA" },
    disponible: c.disponible === "TRUE",
    tienePrecio: c.precio === "SI",
    descripcion,
    contenidoExistente: c.contenidoExistente === "NO" ? null : c.contenidoExistente === "IGUAL" ? igual : { ...igual, orden: 8 },
    permisoDeCarta: c.permisoDeCartaEnElLocal === "SI",
    esAnclaDeAdicional: false,
    esMiembroDeAgrupado: false,
    orden: 7,
    sucursalId: "suc-1",
  };
}

describe("oráculo de la carta (1.296 combinaciones, recorridas completas)", () => {
  const combinaciones = todasLasCombinacionesDeCarta();

  it("son 3 × 2 × 3 × 2 × 2 × 3 × 3 × 2 = 1.296, sin repetir", () => {
    expect(combinaciones).toHaveLength(1296);
    expect(new Set(combinaciones.map((c) => JSON.stringify(c))).size).toBe(1296);
  });

  it("cada combinación da lo que dice la tabla de reglas", () => {
    const distintas: string[] = [];
    for (const c of combinaciones) {
      const esperado = resultadoEsperadoDeCarta(c);
      const real = planificarFilaDeCarta(hechosDe(c));
      if (real.accion !== esperado.accion || real.codigo !== esperado.codigo) distintas.push(`${JSON.stringify(c)}: esperado ${esperado.accion}/${esperado.codigo}, real ${real.accion}/${real.codigo}`);
    }
    expect(distintas).toEqual([]);
  });

  it("«disponible» no cambia el resultado en ninguna combinación (declarado en el oráculo: candidata a poda)", () => {
    for (const c of combinaciones.filter((x) => x.disponible === "TRUE")) {
      expect(planificarFilaDeCarta(hechosDe({ ...c, disponible: "FALSE" }))).toEqual(planificarFilaDeCarta(hechosDe(c)));
    }
  });
});

describe("planificarCarta: de las filas del Excel al contenido de carta", () => {
  const PIZZA: ProductoDeFixtura = { sku: "PIZZA-MUZZA", categoria: "Pizzas", base: "Pizza", variantes: ["Muzza"], precios: { Huinganco: 22000, "Los Miches": 22000 }, disponible: { "Los Miches": false }, descripcion: { Huinganco: "Con orégano" } };
  const CAFE: ProductoDeFixtura = { sku: "CAFE-CHICO", categoria: "Confitería", base: "Café", variantes: ["Chico"], precios: { Varvarco: 4000 }, descripcion: { Varvarco: "Tazón" } };
  const VINO: ProductoDeFixtura = { sku: "VINO-VENTUS", categoria: "Vinos Neuquinos", base: "Vino", variantes: ["Ventus"], precios: { "Los Miches": null }, disponible: { "Los Miches": false } };
  const catalogo = normalizarCatalogo(libroDesde([PIZZA, CAFE, VINO]), correccionesDe());
  const plan = (estado = estadoVacio(), permisos = permisosCompletos()) => {
    const productos = planificarProductos(catalogo, estado, permisos);
    return { productos, carta: planificarCarta(catalogo, productos, estado, permisos) };
  };

  it("visible en la sección del mapeo, con la descripción de SU fila y el orden de la fila del SKU en «Catálogo»; un no disponible también; sin sección o sin precio, fuera de carta", () => {
    const { carta } = plan();
    expect(catalogo.errores).toEqual([]);
    expect(carta.contenidos.map((c) => [c.sku, c.local, c.accion, c.codigo, c.seccion, c.descripcion, c.orden, c.disponible, c.descripcionNoCargada])).toEqual([
      ["PIZZA-MUZZA", "Huinganco", "CREAR", null, "Pizzas", "Con orégano", 2, true, null],
      ["PIZZA-MUZZA", "Los Miches", "CREAR", null, "Pizzas", null, 2, false, null],
      ["CAFE-CHICO", "Varvarco", "FUERA_DE_CARTA", "SIN_SECCION", null, null, 3, true, "Tazón"],
      ["VINO-VENTUS", "Los Miches", "FUERA_DE_CARTA", "SIN_PRECIO", "Bebidas", null, 4, false, null],
    ]);
    expect(contenidosAEscribir(carta, new Map([["PIZZA-MUZZA", "p1"]]))).toEqual([
      { sucursalId: idDeSucursal("Huinganco"), productoId: "p1", visibleEnCarta: true, seccionCartaId: "sec-Pizzas", descripcion: "Con orégano", orden: 2, especial: false, tags: [], generoCartaId: null, mostrarNombreArriba: false },
      { sucursalId: idDeSucursal("Los Miches"), productoId: "p1", visibleEnCarta: true, seccionCartaId: "sec-Pizzas", descripcion: null, orden: 2, especial: false, tags: [], generoCartaId: null, mostrarNombreArriba: false },
    ]);
  });

  it("la sección se resuelve por nombre EXACTO: una de otra empresa no está en el estado (la RLS la esconde) y otro nombre no coincide", () => {
    const { carta } = plan(estadoVacio({ secciones: SECCIONES_DE_PRUEBA.map((s) => (s.nombre === "Pizzas" ? { ...s, nombre: "pizzas" } : s)) }));
    expect(carta.contenidos.filter((c) => c.sku === "PIZZA-MUZZA").map((c) => c.codigo)).toEqual(["SECCION_INEXISTENTE", "SECCION_INEXISTENTE"]);
  });

  it("I10: el ancla de un adicional y un miembro de un ítem agrupado de ese local no van a la carta (error)", () => {
    const [p] = productosAplicados(plan().productos, "unidad-1");
    const ancla = plan(estadoVacio({ productos: [{ ...p, esAnclaDeAdicional: true }] }));
    expect(ancla.carta.contenidos.filter((c) => c.sku === "PIZZA-MUZZA").map((c) => c.codigo)).toEqual(["ES_ANCLA_DE_ADICIONAL", "ES_ANCLA_DE_ADICIONAL"]);
    const agrupado = plan(estadoVacio({ productos: [{ ...p, agrupadoEn: [idDeSucursal("Los Miches")] }] }));
    expect(agrupado.carta.contenidos.filter((c) => c.sku === "PIZZA-MUZZA").map((c) => [c.local, c.accion, c.codigo])).toEqual([
      ["Huinganco", "CREAR", null],
      ["Los Miches", "ERROR", "ES_MIEMBRO_DE_AGRUPADO"],
    ]);
  });

  it("sin «carta_contenido_producto» en un local: error en las filas con sección de ese local", () => {
    const { carta } = plan(estadoVacio(), permisosCompletos({ porLocal: { ...permisosCompletos().porLocal, Huinganco: { disponibilidad: true, carta: false } } }));
    expect(carta.contenidos.map((c) => c.codigo)).toEqual(["SIN_PERMISO_CARTA", null, "SIN_SECCION", "SIN_PRECIO"]);
  });

  it("un producto SIN_CAMBIOS sin contenido en un local: se crea su contenido con el id del producto existente", () => {
    const [p] = productosAplicados(plan().productos, "unidad-1");
    const { productos, carta } = plan(estadoVacio({ productos: [p] }));
    expect(productos.productos[0].accion).toBe("SIN_CAMBIOS");
    expect(contenidosAEscribir(carta, new Map()).map((c) => c.productoId)).toEqual([p.id, p.id]);
  });
});

describe("propiedad: plan(aplicar(plan(x))) = todo SIN_CAMBIOS, también la carta", () => {
  const categorias = ["Pizzas", "Confitería", "Vinos Neuquinos", "Minutas"];
  const productoArb = (i: number) =>
    fc
      .record({
        categoria: fc.constantFrom(...categorias),
        locales: fc.subarray([...LOCALES_DEL_IMPORTADOR], { minLength: 1 }),
        precio: fc.integer({ min: 1, max: 40 }),
        descripcion: fc.option(fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim() !== ""), { nil: undefined }),
      })
      .map(({ categoria, locales, precio, descripcion }): ProductoDeFixtura => ({
        sku: `P-${i}`,
        categoria,
        base: "Producto",
        variantes: [`V${i}`],
        precios: Object.fromEntries(locales.map((l) => [l, precio * 1000])),
        descripcion: descripcion === undefined ? {} : Object.fromEntries(locales.map((l) => [l, descripcion])),
      }));
  const catalogoArb = fc.integer({ min: 1, max: 6 }).chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => productoArb(i))));

  it("después de aplicar productos, disponibilidad y contenidos, el segundo plan no escribe nada", () => {
    fc.assert(
      fc.property(catalogoArb, (productos) => {
        const catalogo = normalizarCatalogo(libroDesde(productos), correccionesDe());
        const estado1 = estadoVacio();
        const p1 = planificarProductos(catalogo, estado1, permisosCompletos());
        const c1 = planificarCarta(catalogo, p1, estado1, permisosCompletos());
        const ids = new Map(p1.productos.map((p) => [p.sku, `id-${p.sku}`]));
        const escritos = contenidosAEscribir(c1, ids);
        const aplicados = productosAplicados(p1, "unidad-1").map((p) => ({
          ...p,
          contenidos: escritos.filter((c) => c.productoId === p.id).map(({ productoId: _productoId, ...resto }) => resto),
        }));
        const estado2 = estadoVacio({ productos: aplicados });
        const p2 = planificarProductos(catalogo, estado2, permisosCompletos());
        const c2 = planificarCarta(catalogo, p2, estado2, permisosCompletos());
        expect(p2.productos.every((p) => p.accion === "SIN_CAMBIOS")).toBe(true);
        expect(c2.contenidos.map((c) => c.accion)).toEqual(c1.contenidos.map((c) => (c.accion === "CREAR" ? "SIN_CAMBIOS" : c.accion)));
        expect(contenidosAEscribir(c2, ids)).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });
});
