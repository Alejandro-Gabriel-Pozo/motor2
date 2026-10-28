import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { coincideLaHuella, huellaDeLaImportacion } from "../../../src/core/features/catalogo/importacion/huella";
import { normalizarCatalogo } from "../../../src/core/features/catalogo/importacion/normalizar";
import { diferenciasPorLocal, disponibilidadesAEscribir, planificarProductos, precioUnicoDe, productosAEscribir } from "../../../src/core/features/catalogo/importacion/planificar-productos";
import { LOCALES_DEL_IMPORTADOR, type CorreccionNominal, type FilaDePrecioNormalizada, type LocalDelImportador } from "../../../src/core/features/catalogo/importacion/tipos";
import { estadoVacio, idDeSucursal, permisosCompletos, productosAplicados } from "./estado-de-prueba";
import { correccionesDe, libroDesde, type ProductoDeFixtura } from "./fixtura-de-catalogo";
import { resultadoEsperadoDeProducto, todasLasCombinacionesDeProducto, type CombinacionDeProducto } from "./oraculo-productos";

/** E1.3 del importador: el planificador de productos (precio único, disponibilidad, CREAR/SIN_CAMBIOS/ERROR), la huella y el oráculo de 72 combinaciones (ADENDA A.8). */
const c = (pesos: number) => BigInt(pesos) * BigInt(100);
const fila = (local: LocalDelImportador, pesos: number | null, disponible = true): FilaDePrecioNormalizada => ({
  fila: 2,
  sku: "X",
  local,
  precioCentavos: pesos === null ? null : c(pesos),
  disponible,
  nombreEnCarta: null,
  descripcion: { estado: "AUSENTE" },
});

/** El escenario de una combinación del oráculo, armado como Excel + correcciones + estado + permisos. */
function escenario(comb: CombinacionDeProducto) {
  const distintos = comb.precios !== "UNICOS";
  const precios: ProductoDeFixtura["precios"] = { Huinganco: 1000, "Los Miches": distintos ? 1200 : 1000 };
  if (distintos) precios["Las Ovejas"] = 1200;
  if (comb.disponibleEnVarvarco !== "SIN_FILA") precios.Varvarco = 1000;
  const producto: ProductoDeFixtura = { sku: "PIZZA-X", categoria: "Pizzas", base: "Pizza", variantes: ["X"], precios, disponible: { Varvarco: comb.disponibleEnVarvarco === "TRUE" } };
  const correcciones: CorreccionNominal[] =
    comb.precios === "DISTINTOS_CON_CORRECCION" ? [{ tipo: "precioUnico", sku: "PIZZA-X", preciosEnElExcel: precios as Record<string, number>, valorACargar: 900, fecha: "2026-10-28", motivo: "x" }] : [];
  const catalogo = normalizarCatalogo(libroDesde([producto]), correccionesDe({ correcciones, reglaDePrecioUnico: comb.precios === "DISTINTOS_SIN_REGLA" ? null : correccionesDe().reglaDePrecioUnico }));
  const esperado = resultadoEsperadoDeProducto(comb);
  const precioDeLaBase = (esperado.precio ?? 1000) + (comb.existencia === "EXISTE_DISTINTO" ? 1 : 0);
  const existentes =
    comb.existencia === "NO_EXISTE"
      ? []
      : [
          {
            id: "prod-1",
            codigo: "PIZZA-X",
            nombre: "Pizza X",
            tipo: "PV",
            precioVenta: `${precioDeLaBase}.00`,
            modoDeVenta: "DIRECTO",
            seProduce: false,
            factorConversion: "1",
            unidadStockId: "unidad-1",
            filasDeDisponibilidad: Object.entries(esperado.disponibilidad).map(([local, disponible]) => ({ sucursalId: idDeSucursal(local as LocalDelImportador), disponible })),
            preciosLocales: [],
            contenidos: [],
            agrupadoEn: [],
            esAnclaDeAdicional: false,
          },
        ];
  const permisos = permisosCompletos(comb.alcanceDelActor === "NO" ? { porLocal: { ...permisosCompletos().porLocal, Huinganco: { disponibilidad: false, carta: true } } } : {});
  return { catalogo, estado: estadoVacio({ productos: existentes }), permisos, esperado };
}

describe("oráculo de producto (72 combinaciones, recorridas completas)", () => {
  const combinaciones = todasLasCombinacionesDeProducto();

  it("son 3 × 4 × 3 × 2 = 72", () => {
    expect(combinaciones).toHaveLength(72);
  });

  it.each(combinaciones.map((comb) => [JSON.stringify(comb), comb] as const))("%s", (_, comb) => {
    const { catalogo, estado, permisos, esperado } = escenario(comb);
    expect(catalogo.errores).toEqual([]);
    const plan = planificarProductos(catalogo, estado, permisos);
    expect(plan.errores).toEqual([]);
    const [p] = plan.productos;
    expect({ accion: p.accion, codigo: p.errores[0]?.codigo ?? null }).toEqual({ accion: esperado.accion, codigo: esperado.codigo });
    expect(p.precio ? { precio: Number(p.precio.centavos / BigInt(100)), origen: p.precio.origen } : { precio: null, origen: null }).toEqual({ precio: esperado.precio, origen: esperado.origen });
    expect(Object.fromEntries(p.disponibilidad.map((d) => [d.local, d.disponible]))).toEqual(esperado.disponibilidad);
  });
});

describe("precio único (A.1)", () => {
  it("todos iguales → ese; distintos con la regla → el más frecuente y, si empatan, el mayor; la corrección manda; sin precio → 0", () => {
    expect(precioUnicoDe([fila("Huinganco", 3000), fila("Los Miches", 3000)], undefined, true)).toEqual({ centavos: c(3000), origen: "UNICO_EN_EL_EXCEL", empate: false });
    expect(precioUnicoDe([fila("Huinganco", 9000), fila("Los Miches", 9000), fila("Manzano Amargo", 10000), fila("Las Ovejas", 9000)], undefined, true)).toEqual({ centavos: c(9000), origen: "REGLA", empate: false });
    expect(precioUnicoDe([fila("Los Miches", 3500), fila("Las Ovejas", 3000)], undefined, true)).toEqual({ centavos: c(3500), origen: "REGLA", empate: true });
    expect(precioUnicoDe([fila("Los Miches", 3500), fila("Las Ovejas", 3000)], undefined, false)).toBeNull();
    expect(precioUnicoDe([fila("Huinganco", 3000, false), fila("Los Miches", 25000)], c(3000), true)).toEqual({ centavos: c(3000), origen: "CORRECCION", empate: false });
    expect(precioUnicoDe([fila("Huinganco", 3000), fila("Los Miches", 3000)], c(2500), true)?.origen).toBe("CORRECCION");
    expect(precioUnicoDe([fila("Los Miches", null, false)], undefined, true)).toEqual({ centavos: BigInt(0), origen: "SIN_PRECIO_EN_EL_EXCEL", empate: false });
  });

  it("caso explícito: Sorrentinos de trucha (4 precios por local) → $33.000; la diferencia por local en $ y % (un no disponible también cuenta)", () => {
    const filas = [fila("Huinganco", 30000, false), fila("Varvarco", 33000), fila("Manzano Amargo", 23000), fila("Las Ovejas", 33000)];
    const unico = precioUnicoDe(filas, undefined, true)!;
    expect(unico).toEqual({ centavos: c(33000), origen: "REGLA", empate: false });
    expect(diferenciasPorLocal(filas, unico.centavos).map((d) => [d.local, Number(d.diferencia / BigInt(100)), Number(d.porcentajeEnDecimas) / 10, d.sentido])).toEqual([
      ["Huinganco", 3000, 10, "MAS"],
      ["Varvarco", 0, 0, "IGUAL"],
      ["Manzano Amargo", 10000, 43.5, "MAS"],
      ["Las Ovejas", 0, 0, "IGUAL"],
    ]);
    // Y los dos ejemplos de la ADENDA que bajan: Saurus Estate Malbec y la gaseosa de 1500.
    expect(Number(diferenciasPorLocal([fila("Manzano Amargo", 28000)], c(20000))[0].porcentajeEnDecimas) / 10).toBe(-28.6);
    expect(Number(diferenciasPorLocal([fila("Manzano Amargo", 10000)], c(9000))[0].porcentajeEnDecimas) / 10).toBe(-10);
  });
});

describe("planificarProductos: errores globales y de SKU", () => {
  const base: ProductoDeFixtura = { sku: "BIFE-CHORIZO", categoria: "Platos Principales", base: "Bife", variantes: ["Chorizo"], precios: { Huinganco: 30000 } };
  const catalogo = normalizarCatalogo(libroDesde([base]), correccionesDe());

  it("una sucursal que no existe o está dada de baja, sin la unidad «unidad» o sin las claves de empresa: error global", () => {
    const sinVarvarco = Object.fromEntries(Object.entries(estadoVacio().sucursales).filter(([local]) => local !== "Varvarco"));
    expect(planificarProductos(catalogo, estadoVacio({ sucursales: sinVarvarco }), permisosCompletos()).errores.map((e) => e.codigo)).toEqual(["SUCURSAL_INEXISTENTE"]);
    const conBaja = { ...estadoVacio().sucursales, "Las Ovejas": { id: "x", nombre: "Las Ovejas", activa: false } };
    expect(planificarProductos(catalogo, estadoVacio({ sucursales: conBaja }), permisosCompletos()).errores.map((e) => e.codigo)).toEqual(["SUCURSAL_INACTIVA"]);
    expect(planificarProductos(catalogo, estadoVacio({ unidadId: null }), permisosCompletos()).errores.map((e) => e.codigo)).toEqual(["UNIDAD_INEXISTENTE"]);
    const sinClave = planificarProductos(catalogo, estadoVacio(), permisosCompletos({ camposSensibles: false }));
    expect(sinClave.errores.map((e) => e.codigo)).toEqual(["SIN_PERMISO"]);
    expect(sinClave.productos[0].accion).toBe("ERROR");
  });

  it("otro producto (otro código) con el mismo nombre sin distinguir mayúsculas: NOMBRE_EN_USO", () => {
    const otro = productosAplicados(planificarProductos(normalizarCatalogo(libroDesde([{ ...base, sku: "OTRO", variantes: ["CHORIZO"] }]), correccionesDe()), estadoVacio(), permisosCompletos()), "unidad-1");
    const plan = planificarProductos(catalogo, estadoVacio({ productos: otro }), permisosCompletos());
    expect(plan.productos[0]).toMatchObject({ accion: "ERROR", errores: [{ codigo: "NOMBRE_EN_USO" }] });
  });

  it("EXISTE_DISTINTO detalla cada campo (y una fila de precio local también lo vuelve distinto)", () => {
    const [existente] = productosAplicados(planificarProductos(catalogo, estadoVacio(), permisosCompletos()), "unidad-1");
    const distinto = { ...existente, nombre: "Bife de chorizo", modoDeVenta: "BASE_CONFIGURABLE", preciosLocales: [{ sucursalId: idDeSucursal("Huinganco"), precio: "1.00" }] };
    const [p] = planificarProductos(catalogo, estadoVacio({ productos: [distinto] }), permisosCompletos()).productos;
    expect(p.accion).toBe("ERROR");
    expect(p.errores[0].motivo).toMatch(/nombre: «Bife de chorizo»/);
    expect(p.errores[0].motivo).toMatch(/modo de venta: BASE_CONFIGURABLE/);
    expect(p.errores[0].motivo).toMatch(/precio\(s\) local/);
  });

  it("lo que se escribe: el producto con el precio único y defectos declarados, y una fila de disponibilidad por local con fila", () => {
    const plan = planificarProductos(catalogo, estadoVacio(), permisosCompletos());
    expect(productosAEscribir(plan, "unidad-1")).toEqual([
      { codigo: "BIFE-CHORIZO", nombre: "Bife Chorizo", tipo: "PV", unidadStockId: "unidad-1", factorConversion: "1", precioVenta: "30000.00", modoDeVenta: "DIRECTO", seProduce: false },
    ]);
    expect(disponibilidadesAEscribir(plan, new Map([["BIFE-CHORIZO", "p1"]]))).toEqual([{ sucursalId: idDeSucursal("Huinganco"), productoId: "p1", disponible: true }]);
    expect(() => disponibilidadesAEscribir(plan, new Map())).toThrow(/no se creó/);
  });
});

describe("huella (I2, A.5)", () => {
  const catalogo = normalizarCatalogo(libroDesde([{ sku: "A", categoria: "Pizzas", base: "Pizza", variantes: ["A"], precios: { Huinganco: 1000 } }]), correccionesDe());
  const plan = planificarProductos(catalogo, estadoVacio(), permisosCompletos());
  const aplicado = productosAplicados(plan, "unidad-1");
  const huella = (estado = estadoVacio(), sha = "abc", correcciones = correccionesDe()) => huellaDeLaImportacion({ shaDelArchivo: sha, correcciones, estado });

  it("la misma entrada da la misma huella, sin importar el orden de las filas ni «3000» contra «3000.00»", () => {
    const dos = [...aplicado, { ...aplicado[0], codigo: "B", id: "id-B" }];
    expect(huella(estadoVacio({ productos: dos }))).toBe(huella(estadoVacio({ productos: [...dos].reverse() })));
    expect(huella(estadoVacio({ productos: aplicado }))).toBe(huella(estadoVacio({ productos: [{ ...aplicado[0], precioVenta: "1000" }] })));
  });

  it("cambia si cambia el archivo, las correcciones, una sección, un producto o su disponibilidad", () => {
    const h = huella(estadoVacio({ productos: aplicado }));
    expect(huella(estadoVacio({ productos: aplicado }), "otro")).not.toBe(h);
    expect(huella(estadoVacio({ productos: aplicado }), "abc", correccionesDe({ reglaDePrecioUnico: null }))).not.toBe(h);
    expect(huella(estadoVacio({ productos: aplicado, secciones: [{ id: "s", nombre: "Pizzas", activa: false }] }))).not.toBe(h);
    expect(huella(estadoVacio({ productos: [{ ...aplicado[0], precioVenta: "1001.00" }] }))).not.toBe(h);
    expect(huella(estadoVacio({ productos: [{ ...aplicado[0], filasDeDisponibilidad: [] }] }))).not.toBe(h);
  });

  it("se confirma con la huella completa o con sus 12 primeros caracteres (sin distinguir mayúsculas); nunca con menos ni con otra", () => {
    const h = huella();
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(coincideLaHuella(h, h)).toBe(true);
    expect(coincideLaHuella(h.slice(0, 12).toUpperCase(), h)).toBe(true);
    expect(coincideLaHuella(h.slice(0, 11), h)).toBe(false);
    expect(coincideLaHuella(`x${h.slice(1, 12)}`, h)).toBe(false);
    expect(coincideLaHuella("", h)).toBe(false);
  });
});

describe("propiedades (fast-check)", () => {
  const locales = fc.subarray([...LOCALES_DEL_IMPORTADOR], { minLength: 1 });
  const productoArb = (i: number) =>
    fc.record({ locales, precios: fc.array(fc.integer({ min: 1, max: 60 }), { minLength: 5, maxLength: 5 }), disponibles: fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }) }).map(
      ({ locales: ls, precios, disponibles }): ProductoDeFixtura => ({
        sku: `SKU-${i}`,
        categoria: "Pizzas",
        base: "Pizza",
        variantes: [`V${i}`],
        precios: Object.fromEntries(ls.map((l) => [l, precios[LOCALES_DEL_IMPORTADOR.indexOf(l)] * 500])),
        disponible: Object.fromEntries(ls.map((l) => [l, disponibles[LOCALES_DEL_IMPORTADOR.indexOf(l)]])),
      }),
    );
  const catalogoArb = fc.integer({ min: 1, max: 6 }).chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => productoArb(i))));

  it("plan(aplicar(plan(x))) = todo SIN_CAMBIOS, sin nada para escribir", () => {
    fc.assert(
      fc.property(catalogoArb, (productos) => {
        const catalogo = normalizarCatalogo(libroDesde(productos), correccionesDe());
        const primero = planificarProductos(catalogo, estadoVacio(), permisosCompletos());
        expect(primero.productos.every((p) => p.accion === "CREAR")).toBe(true);
        const segundo = planificarProductos(catalogo, estadoVacio({ productos: productosAplicados(primero, "unidad-1") }), permisosCompletos());
        expect(segundo.productos.map((p) => p.accion)).toEqual(productos.map(() => "SIN_CAMBIOS"));
        expect(productosAEscribir(segundo, "unidad-1")).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it("el precio que rige en CADA local es el precio único: el del Excel donde todos coinciden, el más frecuente (y el mayor si empatan) donde no", () => {
    fc.assert(
      fc.property(catalogoArb, (productos) => {
        const catalogo = normalizarCatalogo(libroDesde(productos), correccionesDe());
        const plan = planificarProductos(catalogo, estadoVacio(), permisosCompletos());
        for (const [i, p] of plan.productos.entries()) {
          const delExcel = Object.values(productos[i].precios).map((x) => c(x as number));
          const cuenta = (x: bigint) => delExcel.filter((y) => y === x).length;
          const maxima = Math.max(...delExcel.map(cuenta));
          const esperado = delExcel.filter((x) => cuenta(x) === maxima).reduce((a, b) => (b > a ? b : a));
          expect(p.precio!.centavos).toBe(esperado);
          if (new Set(delExcel.map(String)).size === 1) for (const d of p.diferencias) expect(d.precioUnico).toBe(d.precioEnElExcel);
          // Un precio por empresa: lo que se escribe es SOLO `precioVenta` (el plan no tiene precios locales que escribir).
          expect(productosAEscribir(plan, "u").find((x) => x.codigo === p.sku)?.precioVenta).toBe(`${esperado / BigInt(100)}.00`);
        }
      }),
      { numRuns: 200 },
    );
  });
});
