import { describe, expect, it } from "vitest";
import { armarMenuCarta, type EntradaArmarMenu, type ItemCartaV1, type OpcionesDeProductoEntrada, type ProductoCartaEntrada } from "../../src/core/carta/armar-menu";
import { proyectarCartaPublica } from "../../src/core/carta/carta-publica";
import type { GrupoParaVender, OpcionParaVender } from "../../src/core/pos/linea-configurada";
import { resumenDePrecios, tablaDePreciosParaLaCarta } from "../../src/core/pos/precio-de-configuracion";
import { PRODUCTOS_DE_REFERENCIA, type ProductoDeReferencia } from "../setup/referencia-precio-y-carta";

/**
 * Fase 5 de la ola «precio y carta» («carta pareja»): la FORMA con que la carta lee cada producto con opciones (`core/carta/presentacion-en-carta.ts`, por `armarMenuCarta`), sobre el catálogo de
 * referencia que reproduce producción (`test/setup/referencia-precio-y-carta.ts`). Cada precio sale de la tabla de la regla de la venta (`tablaDePreciosParaLaCarta`, como en `menu.ts`): acá se fija la
 * forma, no la cuenta (la paridad de cada celda la fija `test/pos/tabla-de-precios-para-la-carta.test.ts`). Casos: pizzas como base oculta (y con el nombre arriba), milanesas en tabla con «De carne»,
 * «De pollo» y «De trucha», café y cortado en una tanda con «–» y la medialuna debajo sin rótulos, bife con guarnición y extras, un plato con menos guarniciones, un grupo sin prefijo, lo agotado, el
 * descuento, más de 3 columnas, más de 8 filas y que la tanda se arma por `grupoId` y nunca por nombre. Nada de esto sale al público todavía (la proyección es del paso 7).
 */

const ref = (nombre: string): ProductoDeReferencia => PRODUCTOS_DE_REFERENCIA.find((p) => p.nombre === nombre)!;
const conPrefijo = (grupos: readonly GrupoParaVender[], nombre: string, prefijoEnCarta: string) => grupos.map((g) => (g.nombre === nombre ? { ...g, prefijoEnCarta } : g));
const mapearOpciones = (g: GrupoParaVender, f: (o: OpcionParaVender) => OpcionParaVender): GrupoParaVender => ({ ...g, opciones: g.opciones.map(f) });

interface ProductoDePrueba {
  id: string;
  nombre: string;
  precioBase: number;
  grupos: readonly (GrupoParaVender & { prefijoEnCarta?: string | null })[];
  esBase?: boolean;
  descuento?: number;
  orden?: number;
  mostrarNombreArriba?: boolean;
  seccion?: string;
}

/** La entrada de `armarMenuCarta` como la arma `menu.ts`: el resumen con y sin descuento y la tabla de precios de la regla de la venta. */
function carta(productos: readonly ProductoDePrueba[]) {
  const entrada: EntradaArmarMenu = {
    sucursal: { id: "suc", nombre: "Central" },
    generadoEn: new Date("2026-10-20T12:00:00.000Z"),
    secciones: [
      { id: "s1", nombre: "Clásicos", titulo: null, descripcion: null, imagenUrl: null, orden: 1 },
      { id: "s2", nombre: "Cafetería", titulo: null, descripcion: null, imagenUrl: null, orden: 2 },
    ],
    productos: productos.map(
      (p, i): ProductoCartaEntrada => ({
        id: p.id,
        nombre: p.nombre,
        precioVenta: p.precioBase,
        categoriaNombre: null,
        seccionCartaId: p.seccion ?? "s1",
        contenido: { descripcion: null, tags: [], especial: false, orden: p.orden ?? i, ...(p.mostrarNombreArriba !== undefined ? { mostrarNombreArriba: p.mostrarNombreArriba } : {}) },
      })
    ),
    preciosLocales: [],
    descuentos: productos.flatMap((p) => (p.descuento ? [{ productoId: p.id, porcentaje: p.descuento }] : [])),
    promos: [],
    opcionesDeProductos: productos
      .filter((p) => p.grupos.length > 0)
      .map((p): OpcionesDeProductoEntrada => {
        const esBase = p.esBase === true;
        const descuentoDeProducto = p.descuento ?? null;
        return {
          productoId: p.id,
          conDescuento: resumenDePrecios({ grupos: p.grupos, precioBase: p.precioBase, descuentoDeProducto, esBase }),
          sinDescuento: resumenDePrecios({ grupos: p.grupos, precioBase: p.precioBase, descuentoDeProducto: null, esBase }),
          tabla: tablaDePreciosParaLaCarta({ grupos: p.grupos, precioBase: p.precioBase, descuentoDeProducto, esBase }),
          esBase,
        };
      }),
  };
  return armarMenuCarta(entrada);
}

const item = (armado: ReturnType<typeof carta>, nombre: string): ItemCartaV1 | undefined => armado.carta.secciones.flatMap((s) => s.items).find((i) => i.nombre === nombre);

const PIZZAS = ref("Pizzas");
const MILANESA = ref("Milanesas (M1: terminación con precio absoluto)");
const CAFE = ref("Café");
const BIFE = ref("Bife a la criolla");

/** Las milanesas de producción con «De» y una trucha que suma $3.000 (DEC-10). */
const milanesaConTrucha = (): ProductoDePrueba => ({
  id: "milanesas",
  nombre: "Milanesas",
  precioBase: MILANESA.precioBase,
  esBase: true,
  grupos: conPrefijo(MILANESA.grupos, "Milanesas de", "De").map((g) =>
    g.nombre === "Milanesas de" ? { ...g, opciones: [...g.opciones, { ...g.opciones[0]!, opcionId: "o-trucha", nombre: "Trucha", versionVigenteId: "v-trucha", orden: 2, diferenciaDeLaVersion: { tipo: "MONTO" as const, monto: 3000 } }] } : g
  ),
});

describe("6a · simple con aclaraciones: bife, plato con menos guarniciones y grupo sin prefijo", () => {
  it("el bife: forma simple; «Guarnición: ensalada, papas fritas o puré» y «Extras» con su recargo, en el orden del producto y con la primera letra en minúscula", () => {
    const bife = item(carta([{ id: "bife", nombre: BIFE.nombre, precioBase: BIFE.precioBase, grupos: BIFE.grupos }]), BIFE.nombre)!;
    expect(bife.precio).toBe(20000);
    expect(bife.presentacion).toEqual({
      forma: "simple",
      aclaraciones: [
        { tipo: "eleccion", rotulo: "Guarnición", opciones: ["ensalada", "papas fritas", "puré"] },
        { tipo: "extras", rotulo: "Extras", opciones: [{ nombre: "extra de papas", recargo: 2000 }, { nombre: "huevo frito", recargo: 1500 }] },
      ],
    });
  });

  it("un plato que admite menos guarniciones lista solo las suyas; con una sola, no hay línea", () => {
    const sinPure = BIFE.grupos.map((g) => (g.nombre === "Guarnición" ? mapearOpciones(g, (o) => (o.nombre === "Puré" ? { ...o, admitida: false } : o)) : g));
    const soloPapas = BIFE.grupos.map((g) => (g.nombre === "Guarnición" ? mapearOpciones(g, (o) => (o.nombre === "Papas fritas" ? o : { ...o, admitida: false })) : g));
    const armado = carta([
      { id: "chorizo", nombre: "Bife de chorizo", precioBase: 24000, grupos: sinPure },
      { id: "lomo", nombre: "Lomo", precioBase: 26000, grupos: soloPapas },
    ]);
    expect(item(armado, "Bife de chorizo")!.presentacion!.aclaraciones[0]).toEqual({ tipo: "eleccion", rotulo: "Guarnición", opciones: ["ensalada", "papas fritas"] });
    expect(item(armado, "Lomo")!.presentacion!.aclaraciones.map((a) => a.rotulo)).toEqual(["Extras"]);
  });

  it("«Milanesas de» SIN prefijo y sin costo no es un eje: la base queda de un eje (oculta) y la variante va como aclaración", () => {
    const armado = carta([{ id: "milanesas", nombre: "Milanesas", precioBase: MILANESA.precioBase, esBase: true, grupos: MILANESA.grupos }]);
    expect(item(armado, "Milanesas")!.presentacion).toEqual({
      forma: "lista",
      encabezado: false,
      filas: [
        { rotulo: "Simple", precio: 20000 },
        { rotulo: "Napolitana", precio: 25000 },
      ],
      aclaraciones: [{ tipo: "eleccion", rotulo: "Milanesas de", opciones: ["carne", "pollo"] }],
    });
  });
});

describe("6b · columnas y tandas: el café y el cortado comparten columnas; la medialuna, debajo y sin rótulos", () => {
  const cortado = (): ProductoDePrueba => ({
    id: "cortado",
    nombre: "Cortado",
    precioBase: 3500,
    grupos: [mapearOpciones(CAFE.grupos[0]!, (o) => (o.nombre === "Grande" ? { ...o, admitida: false } : { ...o, precioAbsoluto: (o.precioAbsoluto ?? 0) - 500 }))],
  });
  const seccionCafe = (extra: Partial<Record<"cafe" | "cortado", (p: ProductoDePrueba) => ProductoDePrueba>> = {}) =>
    carta([
      (extra.cafe ?? ((p) => p))({ id: "cafe", nombre: "Café", precioBase: CAFE.precioBase, grupos: CAFE.grupos, seccion: "s2", orden: 1 }),
      (extra.cortado ?? ((p) => p))({ ...cortado(), seccion: "s2", orden: 2 }),
      { id: "medialuna", nombre: "Medialuna", precioBase: 1200, grupos: [], seccion: "s2", orden: 3 },
    ]);

  it("una tanda con la unión de las columnas en el orden del grupo; el cortado no ofrece «Grande»: «–» (null); la medialuna no lleva forma ni rótulos", () => {
    const seccion = seccionCafe().carta.secciones.find((s) => s.nombre === "Cafetería")!;
    expect(seccion.items.map((i) => i.nombre)).toEqual(["Café", "Cortado", "Medialuna"]);
    expect(seccion.tandas).toEqual([{ primero: 0, ultimo: 1, rotulos: ["Chico", "Mediano", "Grande"] }]);
    expect(seccion.items[0]!.presentacion).toEqual({
      forma: "columnas",
      celdas: [4000, 4100, 4300],
      aclaraciones: [
        // Una línea por grupo, en su orden: lo que no suma va con recargo 0.
        {
          tipo: "extras",
          rotulo: "Preparación del café",
          opciones: [
            { nombre: "solo", recargo: 0 },
            { nombre: "cortado", recargo: 0 },
            { nombre: "lágrima", recargo: 200 },
            { nombre: "con leche", recargo: 300 },
          ],
        },
        { tipo: "extras", rotulo: "Intensidad", opciones: [{ nombre: "doble", recargo: 400 }] },
        { tipo: "extras", rotulo: "Extras", opciones: [{ nombre: "shot", recargo: 600 }] },
      ],
    });
    expect(seccion.items[1]!.presentacion).toEqual({ forma: "columnas", celdas: [3500, 3600, null], aclaraciones: [] });
    expect(seccion.items[2]).not.toHaveProperty("presentacion");
  });

  it("una columna agotada en TODA la tanda desaparece; agotada solo en uno, «–» en ese", () => {
    const sinGrande = (p: ProductoDePrueba): ProductoDePrueba => ({ ...p, grupos: p.grupos.map((g, i) => (i === 0 ? mapearOpciones(g, (o) => (o.nombre === "Grande" ? { ...o, apagadaEnSucursal: true } : o)) : g)) });
    const seccion = seccionCafe({ cafe: sinGrande }).carta.secciones.find((s) => s.nombre === "Cafetería")!;
    expect(seccion.tandas).toEqual([{ primero: 0, ultimo: 1, rotulos: ["Chico", "Mediano"] }]);
    expect(seccion.items.map((i) => (i.presentacion?.forma === "columnas" ? i.presentacion.celdas : null))).toEqual([[4000, 4100], [3500, 3600], null]);
  });

  it("la tanda se arma por el grupo (`grupoId`), nunca por el nombre: dos grupos que se llaman igual y tienen las mismas opciones son dos tandas", () => {
    const otroGrupo = (p: ProductoDePrueba): ProductoDePrueba => ({ ...p, grupos: p.grupos.map((g, i) => (i === 0 ? { ...g, grupoId: "g-otro-tamano" } : g)) });
    const seccion = seccionCafe({ cortado: otroGrupo }).carta.secciones.find((s) => s.nombre === "Cafetería")!;
    expect(seccion.items[1]!.presentacion).toMatchObject({ forma: "columnas", celdas: [3500, 3600] });
    expect(seccion.tandas).toEqual([
      { primero: 0, ultimo: 0, rotulos: ["Chico", "Mediano", "Grande"] },
      { primero: 1, ultimo: 1, rotulos: ["Chico", "Mediano"] },
    ]);
  });

  it("dos productos del mismo grupo separados por otro no comparten tanda (solo los consecutivos)", () => {
    const armado = carta([
      { id: "cafe", nombre: "Café", precioBase: CAFE.precioBase, grupos: CAFE.grupos, seccion: "s2", orden: 1 },
      { id: "medialuna", nombre: "Medialuna", precioBase: 1200, grupos: [], seccion: "s2", orden: 2 },
      { ...cortado(), seccion: "s2", orden: 3 },
    ]);
    expect(armado.carta.secciones[0]!.tandas!.map((t) => [t.primero, t.ultimo])).toEqual([
      [0, 0],
      [2, 2],
    ]);
  });
});

describe("6c · tabla de dos ejes: las milanesas", () => {
  it("«Simple | Napolitana» y una fila por opción de «Milanesas de» con su prefijo («De carne», «De pollo», «De trucha»); carne y pollo cuestan igual y NO se juntan", () => {
    const armado = carta([milanesaConTrucha()]);
    expect(item(armado, "Milanesas")!.presentacion).toEqual({
      forma: "tabla",
      columnas: ["Simple", "Napolitana"],
      filas: [
        { rotulo: "De carne", celdas: [20000, 25000] },
        { rotulo: "De pollo", celdas: [20000, 25000] },
        { rotulo: "De trucha", celdas: [23000, 28000] },
      ],
      aclaraciones: [],
    });
    // Una base de dos ejes sale SIEMPRE en tabla: el interruptor no la cambia, y no es una base oculta.
    expect(item(carta([{ ...milanesaConTrucha(), mostrarNombreArriba: true }]), "Milanesas")!.presentacion!.forma).toBe("tabla");
    expect(armado.diagnostico.basesOcultas).toBeUndefined();
  });

  it("una fila agotada no sale; una columna agotada no sale (la tabla queda con las columnas que hay)", () => {
    const m = milanesaConTrucha();
    const agotar = (nombre: string) => ({ ...m, grupos: m.grupos.map((g) => mapearOpciones(g, (o) => (o.nombre === nombre ? { ...o, apagadaEnSucursal: true } : o))) });
    expect(item(carta([agotar("Trucha")]), "Milanesas")!.presentacion).toMatchObject({ filas: [{ rotulo: "De carne" }, { rotulo: "De pollo" }] });
    expect(item(carta([agotar("Napolitana")]), "Milanesas")!.presentacion).toMatchObject({ forma: "tabla", columnas: ["Simple"], filas: [{ rotulo: "De carne", celdas: [20000] }, { rotulo: "De pollo" }, { rotulo: "De trucha" }] });
  });
});

describe("6d · lista de una base: las pizzas", () => {
  it("por defecto OCULTA (DEC-11): cada opción con su nombre completo y su precio final, sin encabezado; queda en el diagnóstico con los nombres tal como se leen", () => {
    const armado = carta([{ id: "pizzas", nombre: "Pizzas", precioBase: PIZZAS.precioBase, esBase: true, grupos: PIZZAS.grupos }]);
    expect(item(armado, "Pizzas")!.presentacion).toEqual({
      forma: "lista",
      encabezado: false,
      filas: [
        { rotulo: "Pizza muzzarella", precio: 18000 },
        { rotulo: "Pizza de verduras asadas", precio: 20000 },
        { rotulo: "Pizza fugazzeta", precio: 22000 },
        { rotulo: "Pizza napolitana", precio: 22000 },
        { rotulo: "Pizza con papas fritas", precio: 25000 },
        { rotulo: "Pizza bomba", precio: 25000 },
      ],
      aclaraciones: [],
    });
    expect(armado.diagnostico.basesOcultas).toEqual([{ productoId: "pizzas", nombre: "Pizzas", filas: ["Pizza muzzarella", "Pizza de verduras asadas", "Pizza fugazzeta", "Pizza napolitana", "Pizza con papas fritas", "Pizza bomba"] }]);
  });

  it("con «Mostrar el nombre arriba» prendido, el nombre va de encabezado; el prefijo es opcional y NO decide el encabezado", () => {
    const conNombre = carta([{ id: "pizzas", nombre: "Pizzas", precioBase: PIZZAS.precioBase, esBase: true, grupos: PIZZAS.grupos, mostrarNombreArriba: true }]);
    expect(item(conNombre, "Pizzas")!.presentacion).toMatchObject({ forma: "lista", encabezado: true });
    expect(conNombre.diagnostico.basesOcultas).toBeUndefined();
    const conPrefijoSinInterruptor = carta([{ id: "pizzas", nombre: "Pizzas", precioBase: PIZZAS.precioBase, esBase: true, grupos: conPrefijo(PIZZAS.grupos, "Tipos de Pizza", "De") }]);
    const conPrefijoLista = item(conPrefijoSinInterruptor, "Pizzas")!.presentacion!;
    expect(conPrefijoLista).toMatchObject({ forma: "lista", encabezado: false });
    expect(conPrefijoLista.forma === "lista" && conPrefijoLista.filas[0]).toEqual({ rotulo: "De pizza muzzarella", precio: 18000 });
  });

  it("el mismo grupo en un producto DIRECTO no es una base: sale en columnas (o en lista con el nombre arriba si son más de 3)", () => {
    const directo = carta([{ id: "pizzas", nombre: "Pizzas", precioBase: PIZZAS.precioBase, grupos: PIZZAS.grupos }]);
    expect(item(directo, "Pizzas")!.presentacion).toMatchObject({ forma: "lista", encabezado: true });
  });
});

describe("6e · lo agotado hoy", () => {
  it("una pizza agotada no sale; un grupo obligatorio sin nada para elegir saca el producto de la carta, como hoy", () => {
    const sinBomba = PIZZAS.grupos.map((g) => mapearOpciones(g, (o) => (o.nombre === "Pizza bomba" ? { ...o, apagadaEnSucursal: true } : o)));
    const presentacion = item(carta([{ id: "pizzas", nombre: "Pizzas", precioBase: 18000, esBase: true, grupos: sinBomba }]), "Pizzas")!.presentacion!;
    expect(presentacion.forma === "lista" && presentacion.filas.map((f) => f.rotulo)).not.toContain("Pizza bomba");
    const todas = PIZZAS.grupos.map((g) => mapearOpciones(g, (o) => ({ ...o, apagadaEnSucursal: true })));
    expect(item(carta([{ id: "pizzas", nombre: "Pizzas", precioBase: 18000, esBase: true, grupos: todas }]), "Pizzas")).toBeUndefined();
  });
});

describe("6f · descuento de producto", () => {
  it("cada celda con el descuento aplicado sobre lo compuesto (el aviso es el «−x %» del ítem, una vez); el recargo de un adicional NUNCA lleva el descuento", () => {
    const armado = carta([
      { id: "pizzas", nombre: "Pizzas", precioBase: 18000, esBase: true, grupos: PIZZAS.grupos, descuento: 12.5 },
      { id: "bife", nombre: BIFE.nombre, precioBase: BIFE.precioBase, grupos: BIFE.grupos, descuento: 10 },
    ]);
    const pizzas = item(armado, "Pizzas")!;
    expect(pizzas).toMatchObject({ precio: 15750, precioLista: 18000, descuentoPorcentaje: 12.5 });
    expect(pizzas.presentacion!.forma === "lista" && pizzas.presentacion!.filas.map((f) => f.precio)).toEqual([15750, 17500, 19250, 19250, 21875, 21875]);
    const bife = item(armado, BIFE.nombre)!;
    expect(bife).toMatchObject({ precio: 18000, descuentoPorcentaje: 10 });
    expect(bife.presentacion!.aclaraciones[1]).toEqual({ tipo: "extras", rotulo: "Extras", opciones: [{ nombre: "extra de papas", recargo: 2000 }, { nombre: "huevo frito", recargo: 1500 }] });
  });

  it("un recargo DENTRO del precio (una variante opcional con costo) con descuento no se puede leer exacto: el producto no toma forma nueva y queda en el diagnóstico", () => {
    const armado = carta([{ id: "cafe", nombre: "Café", precioBase: CAFE.precioBase, grupos: CAFE.grupos, descuento: 10 }]);
    expect(item(armado, "Café")).not.toHaveProperty("presentacion");
    expect(item(armado, "Café")!.grupos, "sale como antes").toBeDefined();
    expect(armado.diagnostico.productosSinPresentacion).toEqual([{ productoId: "cafe", nombre: "Café", motivo: "«Preparación del café» suma al precio y el producto tiene descuento: el recargo no se puede leer exacto" }]);
  });
});

describe("6g · límites y diagnóstico interno", () => {
  const tamanos = (n: number): GrupoParaVender => ({
    ...CAFE.grupos[0]!,
    opciones: Array.from({ length: n }, (_, i) => ({ ...CAFE.grupos[0]!.opciones[0]!, opcionId: `t${i}`, nombre: `T${i}`, versionVigenteId: `v-t${i}`, orden: i, precioAbsoluto: 1000 + i * 100 })),
  });

  it("más de 3 columnas en una tanda: cada producto cae a lista con el nombre arriba, sin tanda, y queda en el diagnóstico", () => {
    const armado = carta([{ id: "te", nombre: "Té", precioBase: 1000, grupos: [tamanos(4)] }]);
    expect(item(armado, "Té")!.presentacion).toMatchObject({ forma: "lista", encabezado: true, filas: [{ rotulo: "T0", precio: 1000 }, { rotulo: "T1" }, { rotulo: "T2" }, { rotulo: "T3", precio: 1300 }] });
    expect(armado.carta.secciones[0]).not.toHaveProperty("tandas");
    expect(armado.diagnostico.productosConMuchasColumnas).toEqual([{ productoId: "te", nombre: "Té", columnas: 4 }]);
  });

  it("una tabla de dos ejes con más de 3 columnas: una fila por combinación, con el nombre arriba", () => {
    const g = tamanos(4);
    const de = { ...MILANESA.grupos[1]!, prefijoEnCarta: "De" };
    const armado = carta([{ id: "mila", nombre: "Milanesas", precioBase: 1000, esBase: true, grupos: [g, de] }]);
    const p = item(armado, "Milanesas")!.presentacion!;
    expect(p.forma === "lista" && p.filas.slice(0, 2)).toEqual([
      { rotulo: "T0, de carne", precio: 1000 },
      { rotulo: "T1, de carne", precio: 1100 },
    ]);
    expect(armado.diagnostico.productosConMuchasColumnas).toEqual([{ productoId: "mila", nombre: "Milanesas", columnas: 4 }]);
  });

  it("más de 8 filas: se dibujan todas (nunca «desde» ni colapso) y se anota en el diagnóstico", () => {
    const armado = carta([{ id: "pizzas", nombre: "Pizzas", precioBase: 1000, esBase: true, grupos: [tamanos(9)] }]);
    const p = item(armado, "Pizzas")!.presentacion!;
    expect(p.forma === "lista" && p.filas).toHaveLength(9);
    expect(armado.diagnostico.productosConMuchasFilas).toEqual([{ productoId: "pizzas", nombre: "Pizzas", filas: 9 }]);
  });

  it("un tercer grupo que cambia el precio no cabe: sale como antes y queda en el diagnóstico; uno con prefijo y sin costo va como aclaración", () => {
    const conCosto = (grupoId: string, nombre: string): GrupoParaVender => ({ ...MILANESA.grupos[1]!, grupoId, nombre, opciones: MILANESA.grupos[1]!.opciones.map((o, i) => ({ ...o, opcionId: `${grupoId}-${i}`, diferenciaDeLaVersion: { tipo: "MONTO", monto: i * 500 } })) });
    const armado = carta([{ id: "cafe", nombre: "Café", precioBase: 4000, grupos: [CAFE.grupos[0]!, conCosto("a", "Leche"), conCosto("b", "Taza")] }]);
    expect(item(armado, "Café")).not.toHaveProperty("presentacion");
    expect(armado.diagnostico.productosSinPresentacion![0]!.motivo).toBe("más de dos grupos cambian el precio («Taza» no cabe en la tabla)");
    const conAclaracion = carta([{ id: "cafe", nombre: "Café", precioBase: 4000, grupos: [CAFE.grupos[0]!, conCosto("a", "Leche"), { ...MILANESA.grupos[1]!, grupoId: "b", nombre: "Punto", prefijoEnCarta: "Bien" }] }]);
    expect(item(conAclaracion, "Café")!.presentacion).toMatchObject({ forma: "tabla", aclaraciones: [{ tipo: "eleccion", rotulo: "Punto", opciones: ["carne", "pollo"] }] });
  });

  it("una carta sin opciones arma el mismo diagnóstico de siempre (sin claves nuevas); el diagnóstico nunca sale al público y la forma sale tal cual (paso 7)", () => {
    const sinOpciones = carta([{ id: "gaseosa", nombre: "Gaseosa", precioBase: 4000, grupos: [] }]);
    expect(Object.keys(sinOpciones.diagnostico).sort()).toEqual(["agrupadosConPreciosDistintos", "agrupadosSinOpciones", "agrupadosSinSeccion", "visiblesSinSeccion"]);
    const conOpciones = carta([{ id: "pizzas", nombre: "Pizzas", precioBase: PIZZAS.precioBase, esBase: true, grupos: PIZZAS.grupos }]);
    const publica = proyectarCartaPublica(conOpciones.carta);
    expect(JSON.stringify(publica)).not.toContain("basesOcultas");
    expect(publica.secciones[0]!.items[0]!.presentacion).toEqual(item(conOpciones, "Pizzas")!.presentacion);
  });
});
