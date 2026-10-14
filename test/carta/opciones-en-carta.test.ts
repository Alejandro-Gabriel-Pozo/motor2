import { describe, expect, it } from "vitest";
import { armarMenuCarta } from "../../src/core/carta/armar-menu";
import { opcionesParaLaCarta, type ResumenDePreciosParaCarta } from "../../src/core/carta/opciones-en-carta";
import { proyectarCartaPublica } from "../../src/core/carta/carta-publica";

/**
 * CARTA-B (decisión del dueño, variante B «lista clásica»): en la carta SOLO aparece lo que CAMBIA EL PRECIO. Esta prueba fija la regla «qué grupos se muestran» (pura, en el servidor):
 *  - tamaños con precios finales distintos → una lista con el precio final de cada uno; todos iguales (o uno solo) → no sale;
 *  - guarnición, punto de cocción, «Solo»/«Sin guarnición» sin costo y la «ninguna» → no salen;
 *  - extras y variantes con «+ $» → salen con su recargo; un grupo sin nada que sume → no sale;
 *  - un grupo obligatorio ya está en el precio con su opción más barata: sus recargos se cuentan sobre esa;
 *  - un producto que hoy no se puede pedir (un grupo obligatorio sin opciones disponibles) → null.
 * Lo agotado ya llega afuera (lo saca `resumenDePrecios`, probado en test/pos). Los precios son exactos (centavos, sin ruido de coma flotante).
 */
type Grupo = ResumenDePreciosParaCarta["grupos"][number];
type Opcion = Grupo["opciones"][number];

const op = (nombre: string, extra: Partial<Opcion> = {}): Opcion => ({ nombre, esNinguna: false, precioFinal: null, diferencia: 0, ...extra });
const tamanos = (opciones: Opcion[], nombre = "Tamaño"): Grupo => ({ nombre, tipo: "MEDIDA", cantidadMinima: 1, opciones });
const resumen = (grupos: Grupo[], extra: Partial<ResumenDePreciosParaCarta> = {}): ResumenDePreciosParaCarta => ({ grupos, desde: 2500, vendible: true, ...extra });

const CHICO_MEDIANO_GRANDE = tamanos([op("Chico", { precioFinal: 2500, diferencia: -300 }), op("Mediano", { precioFinal: 2800 }), op("Grande", { precioFinal: 3100, diferencia: 300 })]);
const GUARNICION: Grupo = { nombre: "Guarnición", tipo: "INCLUIDA", cantidadMinima: 1, opciones: [op("Papas"), op("Puré"), op("Ensalada"), op("Sin guarnición", { esNinguna: true })] };
const PUNTO: Grupo = { nombre: "Punto de cocción", tipo: "VARIANTE", cantidadMinima: 1, opciones: [op("Jugoso"), op("A punto"), op("Bien cocido")] };
const PREPARACION: Grupo = { nombre: "Preparación", tipo: "VARIANTE", cantidadMinima: 1, opciones: [op("Solo"), op("Con leche", { diferencia: 400 })] };
const EXTRAS: Grupo = {
  nombre: "Extras",
  tipo: "ADICIONAL",
  cantidadMinima: 0,
  opciones: [op("Sin extras", { esNinguna: true }), op("Medialuna", { diferencia: 600 }), op("Shot", { diferencia: 500 })],
};

describe("opcionesParaLaCarta · qué grupos se muestran (CARTA-B)", () => {
  it("el café del dueño: tamaños con precio final distinto → lista; «Con leche +400» y los extras → recargos; «Solo» y «Sin extras» no salen", () => {
    expect(opcionesParaLaCarta(resumen([CHICO_MEDIANO_GRANDE, PREPARACION, EXTRAS]))).toEqual({
      grupos: [
        { nombre: "Tamaño", opciones: [{ nombre: "Chico", precio: 2500 }, { nombre: "Mediano", precio: 2800 }, { nombre: "Grande", precio: 3100 }] },
        { nombre: "Preparación", opciones: [{ nombre: "Con leche", recargo: 400 }] },
        { nombre: "Extras", opciones: [{ nombre: "Medialuna", recargo: 600 }, { nombre: "Shot", recargo: 500 }] },
      ],
      desde: 2500,
    });
  });

  it("tamaños con el MISMO precio final (o uno solo): el grupo no se muestra, lo elige el mozo", () => {
    const iguales = tamanos([op("Chico", { precioFinal: 2500 }), op("Grande", { precioFinal: 2500 })]);
    expect(opcionesParaLaCarta(resumen([iguales]))).toEqual({ grupos: [], desde: 2500 });
    expect(opcionesParaLaCarta(resumen([tamanos([op("Única", { precioFinal: 2500 })])]))).toEqual({ grupos: [], desde: 2500 });
  });

  it("dos tamaños que difieren por un centavo SÍ cambian el precio; 0,1 + 0,2 contra 0,3 es el mismo precio (sin ruido de coma flotante)", () => {
    const centavo = tamanos([op("Chico", { precioFinal: 2500 }), op("Grande", { precioFinal: 2500.01 })]);
    expect(opcionesParaLaCarta(resumen([centavo]))!.grupos).toEqual([{ nombre: "Tamaño", opciones: [{ nombre: "Chico", precio: 2500 }, { nombre: "Grande", precio: 2500.01 }] }]);
    const ruido = tamanos([op("Chico", { precioFinal: 0.1 + 0.2 }), op("Grande", { precioFinal: 0.3 })]);
    expect(opcionesParaLaCarta(resumen([ruido], { desde: 0.3 }))!.grupos).toEqual([]);
  });

  it("un tamaño repetido entre distintos sigue en la lista: Chico 2.500, Mediano 2.500, Grande 3.100", () => {
    const g = tamanos([op("Chico", { precioFinal: 2500 }), op("Mediano", { precioFinal: 2500 }), op("Grande", { precioFinal: 3100 })]);
    expect(opcionesParaLaCarta(resumen([g]))!.grupos).toEqual([{ nombre: "Tamaño", opciones: [{ nombre: "Chico", precio: 2500 }, { nombre: "Mediano", precio: 2500 }, { nombre: "Grande", precio: 3100 }] }]);
  });

  it("un tamaño sin precio que se componga no se lista", () => {
    const g = tamanos([op("Chico", { precioFinal: 2500 }), op("Sin precio"), op("Grande", { precioFinal: 3100 })]);
    expect(opcionesParaLaCarta(resumen([g]))!.grupos[0]!.opciones.map((o) => o.nombre)).toEqual(["Chico", "Grande"]);
  });

  it("la milanesa: guarnición y punto de cocción sin costo NO salen (ni «Sin guarnición» ni la «ninguna»); el precio es el base", () => {
    expect(opcionesParaLaCarta(resumen([GUARNICION, PUNTO], { desde: 9500 }))).toEqual({ grupos: [], desde: 9500 });
  });

  it("una guarnición con una opción que SÍ cuesta más (papas fritas +300) muestra solo esa", () => {
    const g: Grupo = { ...GUARNICION, opciones: [op("Puré"), op("Papas fritas", { diferencia: 300 }), op("Sin guarnición", { esNinguna: true })] };
    expect(opcionesParaLaCarta(resumen([g], { desde: 9500 }))!.grupos).toEqual([{ nombre: "Guarnición", opciones: [{ nombre: "Papas fritas", recargo: 300 }] }]);
  });

  it("solo extras: el precio base queda y sale la línea de recargos; sin extras con costo, nada", () => {
    expect(opcionesParaLaCarta(resumen([EXTRAS], { desde: 3200 }))).toEqual({ grupos: [{ nombre: "Extras", opciones: [{ nombre: "Medialuna", recargo: 600 }, { nombre: "Shot", recargo: 500 }] }], desde: 3200 });
    const sinCosto: Grupo = { ...EXTRAS, opciones: [op("Sin extras", { esNinguna: true }), op("Sal", { diferencia: 0 })] };
    expect(opcionesParaLaCarta(resumen([sinCosto], { desde: 3200 }))!.grupos).toEqual([]);
  });

  it("la «ninguna» de un adicional no se muestra aunque traiga una diferencia", () => {
    const g: Grupo = { ...EXTRAS, opciones: [op("Sin extras", { esNinguna: true, diferencia: 100 }), op("Shot", { diferencia: 500 })] };
    expect(opcionesParaLaCarta(resumen([g]))!.grupos).toEqual([{ nombre: "Extras", opciones: [{ nombre: "Shot", recargo: 500 }] }]);
  });

  it("un grupo obligatorio ya está en el precio con su opción más barata: «Pollo +500 / Carne +800» sale como «Carne +300»", () => {
    const g: Grupo = { nombre: "Relleno", tipo: "VARIANTE", cantidadMinima: 1, opciones: [op("Pollo", { diferencia: 500 }), op("Carne", { diferencia: 800 })] };
    expect(opcionesParaLaCarta(resumen([g], { desde: 3000 }))!.grupos).toEqual([{ nombre: "Relleno", opciones: [{ nombre: "Carne", recargo: 300 }] }]);
  });

  it("un grupo opcional cuenta sobre el precio base (sin elegir nada): un descuento sale con su signo", () => {
    const g: Grupo = { nombre: "Quitar", tipo: "VARIANTE", cantidadMinima: 0, opciones: [op("Sin queso", { diferencia: -300 }), op("Con jamón", { diferencia: 450.5 })] };
    expect(opcionesParaLaCarta(resumen([g]))!.grupos).toEqual([{ nombre: "Quitar", opciones: [{ nombre: "Sin queso", recargo: -300 }, { nombre: "Con jamón", recargo: 450.5 }] }]);
  });

  it("los recargos se restan en decimal exacto: 0,3 − 0,1 es 0,2, no 0,19999999999999998", () => {
    const g: Grupo = { nombre: "Salsa", tipo: "VARIANTE", cantidadMinima: 1, opciones: [op("Común", { diferencia: 0.1 }), op("Especial", { diferencia: 0.3 })] };
    expect(opcionesParaLaCarta(resumen([g]))!.grupos).toEqual([{ nombre: "Salsa", opciones: [{ nombre: "Especial", recargo: 0.2 }] }]);
  });

  it("un grupo sin ninguna opción disponible (todas agotadas) y no obligatorio no sale; el producto sigue", () => {
    expect(opcionesParaLaCarta(resumen([{ ...EXTRAS, opciones: [] }]))).toEqual({ grupos: [], desde: 2500 });
  });

  it("un producto que hoy no se puede pedir (sin opción obligatoria disponible) no sale en la carta", () => {
    expect(opcionesParaLaCarta(resumen([CHICO_MEDIANO_GRANDE], { vendible: false, desde: null }))).toBeNull();
    expect(opcionesParaLaCarta(resumen([CHICO_MEDIANO_GRANDE], { desde: null }))).toBeNull();
    expect(opcionesParaLaCarta(resumen([CHICO_MEDIANO_GRANDE], { vendible: false }))).toBeNull();
  });

  it("sin grupos: sin opciones y con el «desde» del resumen", () => {
    expect(opcionesParaLaCarta(resumen([], { desde: 3200 }))).toEqual({ grupos: [], desde: 3200 });
  });
});

describe("la carta armada con las opciones que cambian el precio (CARTA-B)", () => {
  const producto = (id: string, nombre: string, precioVenta: number) => ({ id, nombre, precioVenta, categoriaNombre: null, seccionCartaId: "s1", contenido: { descripcion: null, tags: [], especial: false, orden: 0 } });
  const armar = () =>
    proyectarCartaPublica(
      armarMenuCarta({
        sucursal: { id: "suc", nombre: "Central" },
        generadoEn: new Date("2026-10-14T12:00:00Z"),
        secciones: [{ id: "s1", nombre: "Carta", titulo: null, descripcion: null, imagenUrl: null, orden: 0 }],
        productos: [producto("cafe", "Café", 2500), producto("mila", "Milanesa", 9500), producto("flan", "Flan", 3200), producto("te", "Té", 1800)],
        preciosLocales: [],
        promos: [],
        opcionesDeProductos: [
          { productoId: "cafe", conDescuento: resumen([CHICO_MEDIANO_GRANDE, PREPARACION, EXTRAS]), sinDescuento: resumen([CHICO_MEDIANO_GRANDE, PREPARACION, EXTRAS]) },
          { productoId: "mila", conDescuento: resumen([GUARNICION, PUNTO], { desde: 9500 }), sinDescuento: resumen([GUARNICION, PUNTO], { desde: 9500 }) },
          // Un grupo obligatorio sin nada disponible: el producto no se puede pedir hoy y sale de la carta.
          { productoId: "te", conDescuento: resumen([], { vendible: false, desde: null }), sinDescuento: resumen([], { vendible: false, desde: null }) },
        ],
      }).carta,
    );

  it("el café lleva sus tamaños y recargos, la milanesa y el flan salen sin `grupos`, y el té sin opción obligatoria disponible no sale", () => {
    const items = armar().secciones[0]!.items;
    expect(items.map((i) => i.nombre)).toEqual(["Café", "Flan", "Milanesa"]);
    const cafe = items.find((i) => i.nombre === "Café")!;
    expect(cafe.precio).toBe(2500);
    expect(cafe.grupos).toEqual([
      { nombre: "Tamaño", opciones: [{ nombre: "Chico", precio: 2500 }, { nombre: "Mediano", precio: 2800 }, { nombre: "Grande", precio: 3100 }] },
      { nombre: "Preparación", opciones: [{ nombre: "Con leche", recargo: 400 }] },
      { nombre: "Extras", opciones: [{ nombre: "Medialuna", recargo: 600 }, { nombre: "Shot", recargo: 500 }] },
    ]);
    expect(Object.keys(items.find((i) => i.nombre === "Milanesa")!)).not.toContain("grupos");
    expect(items.find((i) => i.nombre === "Milanesa")!.precio).toBe(9500);
    expect(Object.keys(items.find((i) => i.nombre === "Flan")!)).not.toContain("grupos");
  });

  it("la salida pública no lleva `precioDesde`, ni `obligatorio` ni `maximo` (la carta ya no los dibuja)", () => {
    const json = JSON.stringify(armar());
    for (const clave of ["precioDesde", "obligatorio", "maximo"]) expect(json).not.toContain(clave);
  });
});
