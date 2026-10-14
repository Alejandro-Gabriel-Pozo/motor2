import { describe, expect, it } from "vitest";
import { armarMenuCarta } from "../../src/core/carta/armar-menu";
import { opcionesParaLaCarta, type ResumenDePreciosParaCarta } from "../../src/core/carta/opciones-en-carta";
import { proyectarCartaPublica } from "../../src/core/carta/carta-publica";

/**
 * CARTA-B (decisión del dueño, variante B «lista clásica») y CARTA-C (pastillas): esta prueba fija la regla «qué se muestra de cada grupo» (pura, en el servidor):
 *  - tamaños con precios finales distintos → una lista con el precio final de cada uno; todos iguales → sus nombres como pastillas; uno solo → no sale;
 *  - guarnición, punto de cocción, «Solo»/«Flat white» sin costo → PASTILLAS bajo el nombre del grupo (`sinCosto`), en el orden del grupo; una sola sin costo, la «ninguna» y lo agotado → no salen;
 *  - extras y variantes con «+ $» → salen con su recargo; un grupo mixto sale con las dos cosas;
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
const PREPARACION_DE_CAFE: Grupo = {
  nombre: "Preparación",
  tipo: "VARIANTE",
  cantidadMinima: 1,
  opciones: [op("Solo"), op("Flat white"), op("Cortado"), op("Con leche", { diferencia: 400 })],
};
const PREPARACION: Grupo = { nombre: "Preparación", tipo: "VARIANTE", cantidadMinima: 1, opciones: [op("Solo"), op("Con leche", { diferencia: 400 })] };
const EXTRAS: Grupo = {
  nombre: "Extras",
  tipo: "ADICIONAL",
  cantidadMinima: 0,
  opciones: [op("Sin extras", { esNinguna: true }), op("Medialuna", { diferencia: 600 }), op("Shot", { diferencia: 500 })],
};

describe("opcionesParaLaCarta · qué grupos se muestran (CARTA-B)", () => {
  it("el café del dueño: tamaños con precio final distinto → lista; «Con leche +400» y los extras → recargos; «Solo», «Flat white» y «Cortado» → pastillas de «Preparación»; «Sin extras» no sale", () => {
    expect(opcionesParaLaCarta(resumen([CHICO_MEDIANO_GRANDE, PREPARACION_DE_CAFE, EXTRAS]))).toEqual({
      grupos: [
        { nombre: "Tamaño", opciones: [{ nombre: "Chico", precio: 2500 }, { nombre: "Mediano", precio: 2800 }, { nombre: "Grande", precio: 3100 }] },
        { nombre: "Preparación", opciones: [{ nombre: "Con leche", recargo: 400 }] },
        { nombre: "Extras", opciones: [{ nombre: "Medialuna", recargo: 600 }, { nombre: "Shot", recargo: 500 }] },
      ],
      sinCosto: [{ grupo: "Preparación", opciones: ["Solo", "Flat white", "Cortado"] }],
      desde: 2500,
    });
  });

  it("un grupo sin costo en todas sus opciones (café: Solo, Flat white, Cortado, todas $0) sale solo como pastillas, sin recargos", () => {
    const g: Grupo = { ...PREPARACION_DE_CAFE, opciones: [op("Solo"), op("Flat white"), op("Cortado")] };
    expect(opcionesParaLaCarta(resumen([CHICO_MEDIANO_GRANDE, g]))).toEqual({
      grupos: [{ nombre: "Tamaño", opciones: [{ nombre: "Chico", precio: 2500 }, { nombre: "Mediano", precio: 2800 }, { nombre: "Grande", precio: 3100 }] }],
      sinCosto: [{ grupo: "Preparación", opciones: ["Solo", "Flat white", "Cortado"] }],
      desde: 2500,
    });
  });

  it("un grupo mixto (Solo $0, Flat white $0, Con leche +$400): pastillas Solo y Flat white, y «Con leche +400» en los recargos", () => {
    const g: Grupo = { ...PREPARACION_DE_CAFE, opciones: [op("Solo"), op("Flat white"), op("Con leche", { diferencia: 400 })] };
    expect(opcionesParaLaCarta(resumen([g]))).toEqual({
      grupos: [{ nombre: "Preparación", opciones: [{ nombre: "Con leche", recargo: 400 }] }],
      sinCosto: [{ grupo: "Preparación", opciones: ["Solo", "Flat white"] }],
      desde: 2500,
    });
  });

  it("un grupo con UNA sola opción sin costo no muestra pastillas (no hay nada que elegir), pero sus recargos sí: «Solo» y «Con leche +400» → solo el recargo", () => {
    expect(opcionesParaLaCarta(resumen([PREPARACION]))).toEqual({ grupos: [{ nombre: "Preparación", opciones: [{ nombre: "Con leche", recargo: 400 }] }], sinCosto: [], desde: 2500 });
    const unica: Grupo = { nombre: "Cocción", tipo: "VARIANTE", cantidadMinima: 1, opciones: [op("A punto")] };
    expect(opcionesParaLaCarta(resumen([unica]))).toEqual({ grupos: [], sinCosto: [], desde: 2500 });
  });

  it("tamaños con el MISMO precio final: no cambian el precio, salen como pastillas con el nombre del grupo; uno solo, no sale", () => {
    const iguales = tamanos([op("Chico", { precioFinal: 2500 }), op("Grande", { precioFinal: 2500 })], "Vaso");
    expect(opcionesParaLaCarta(resumen([iguales]))).toEqual({ grupos: [], sinCosto: [{ grupo: "Vaso", opciones: ["Chico", "Grande"] }], desde: 2500 });
    expect(opcionesParaLaCarta(resumen([tamanos([op("Única", { precioFinal: 2500 })])]))).toEqual({ grupos: [], sinCosto: [], desde: 2500 });
  });

  it("tamaños con precios distintos NO se repiten como pastillas: salen solo en la lista con su precio", () => {
    const r = opcionesParaLaCarta(resumen([CHICO_MEDIANO_GRANDE]))!;
    expect(r.grupos).toHaveLength(1);
    expect(r.sinCosto).toEqual([]);
  });

  it("dos tamaños que difieren por un centavo SÍ cambian el precio; 0,1 + 0,2 contra 0,3 es el mismo precio (sin ruido de coma flotante)", () => {
    const centavo = tamanos([op("Chico", { precioFinal: 2500 }), op("Grande", { precioFinal: 2500.01 })]);
    expect(opcionesParaLaCarta(resumen([centavo]))!.grupos).toEqual([{ nombre: "Tamaño", opciones: [{ nombre: "Chico", precio: 2500 }, { nombre: "Grande", precio: 2500.01 }] }]);
    const ruido = tamanos([op("Chico", { precioFinal: 0.1 + 0.2 }), op("Grande", { precioFinal: 0.3 })]);
    // 0,1 + 0,2 es 0,3: el mismo precio, así que NO es una lista de precios sino pastillas.
    expect(opcionesParaLaCarta(resumen([ruido], { desde: 0.3 }))).toEqual({ grupos: [], sinCosto: [{ grupo: "Tamaño", opciones: ["Chico", "Grande"] }], desde: 0.3 });
  });

  it("un tamaño repetido entre distintos sigue en la lista: Chico 2.500, Mediano 2.500, Grande 3.100", () => {
    const g = tamanos([op("Chico", { precioFinal: 2500 }), op("Mediano", { precioFinal: 2500 }), op("Grande", { precioFinal: 3100 })]);
    expect(opcionesParaLaCarta(resumen([g]))!.grupos).toEqual([{ nombre: "Tamaño", opciones: [{ nombre: "Chico", precio: 2500 }, { nombre: "Mediano", precio: 2500 }, { nombre: "Grande", precio: 3100 }] }]);
  });

  it("un tamaño sin precio que se componga no se lista (ni como pastilla)", () => {
    const g = tamanos([op("Chico", { precioFinal: 2500 }), op("Sin precio"), op("Grande", { precioFinal: 3100 })]);
    expect(opcionesParaLaCarta(resumen([g]))!.grupos[0]!.opciones.map((o) => o.nombre)).toEqual(["Chico", "Grande"]);
    const iguales = tamanos([op("Chico", { precioFinal: 2500 }), op("Sin precio"), op("Grande", { precioFinal: 2500 })]);
    expect(opcionesParaLaCarta(resumen([iguales]))!.sinCosto).toEqual([{ grupo: "Tamaño", opciones: ["Chico", "Grande"] }]);
  });

  it("la milanesa: guarnición y punto de cocción sin costo salen como pastillas (sin la «ninguna» «Sin guarnición»); el precio es el base", () => {
    expect(opcionesParaLaCarta(resumen([GUARNICION, PUNTO], { desde: 9500 }))).toEqual({
      grupos: [],
      sinCosto: [
        { grupo: "Guarnición", opciones: ["Papas", "Puré", "Ensalada"] },
        { grupo: "Punto de cocción", opciones: ["Jugoso", "A punto", "Bien cocido"] },
      ],
      desde: 9500,
    });
  });

  it("las pastillas van en el orden del grupo", () => {
    const g: Grupo = { ...PUNTO, opciones: [op("Bien cocido"), op("Jugoso"), op("A punto")] };
    expect(opcionesParaLaCarta(resumen([g]))!.sinCosto).toEqual([{ grupo: "Punto de cocción", opciones: ["Bien cocido", "Jugoso", "A punto"] }]);
  });

  it("la «ninguna» nunca es una pastilla, ni en una guarnición ni en un adicional: sin ella queda una sola opción y el grupo no sale", () => {
    const g: Grupo = { ...GUARNICION, opciones: [op("Puré"), op("Sin guarnición", { esNinguna: true })] };
    expect(opcionesParaLaCarta(resumen([g]))).toEqual({ grupos: [], sinCosto: [], desde: 2500 });
    const extras: Grupo = { ...EXTRAS, opciones: [op("Sin extras", { esNinguna: true }), op("Sal"), op("Pimienta")] };
    expect(opcionesParaLaCarta(resumen([extras]))!.sinCosto).toEqual([{ grupo: "Extras", opciones: ["Sal", "Pimienta"] }]);
  });

  it("lo agotado no llega (lo saca `resumenDePrecios`): sin la opción agotada, una guarnición de dos queda con una y no sale; un grupo sin opciones tampoco", () => {
    const g: Grupo = { ...GUARNICION, opciones: [op("Puré")] };
    expect(opcionesParaLaCarta(resumen([g]))).toEqual({ grupos: [], sinCosto: [], desde: 2500 });
    expect(opcionesParaLaCarta(resumen([{ ...GUARNICION, opciones: [] }]))).toEqual({ grupos: [], sinCosto: [], desde: 2500 });
  });

  it("solo extras: el precio base queda y sale la línea de recargos; sin extras con costo, nada", () => {
    expect(opcionesParaLaCarta(resumen([EXTRAS], { desde: 3200 }))).toEqual({ grupos: [{ nombre: "Extras", opciones: [{ nombre: "Medialuna", recargo: 600 }, { nombre: "Shot", recargo: 500 }] }], sinCosto: [], desde: 3200 });
    const sinCosto: Grupo = { ...EXTRAS, opciones: [op("Sin extras", { esNinguna: true }), op("Sal", { diferencia: 0 })] };
    expect(opcionesParaLaCarta(resumen([sinCosto], { desde: 3200 }))).toEqual({ grupos: [], sinCosto: [], desde: 3200 });
  });

  it("la «ninguna» de un adicional no se muestra aunque traiga una diferencia", () => {
    const g: Grupo = { ...EXTRAS, opciones: [op("Sin extras", { esNinguna: true, diferencia: 100 }), op("Shot", { diferencia: 500 })] };
    expect(opcionesParaLaCarta(resumen([g]))!.grupos).toEqual([{ nombre: "Extras", opciones: [{ nombre: "Shot", recargo: 500 }] }]);
  });

  it("un grupo obligatorio ya está en el precio con su opción más barata: «Pollo +500 / Carne +800» sale como «Carne +300» (y «Pollo», la única sin costo, no es pastilla)", () => {
    const g: Grupo = { nombre: "Relleno", tipo: "VARIANTE", cantidadMinima: 1, opciones: [op("Pollo", { diferencia: 500 }), op("Carne", { diferencia: 800 })] };
    expect(opcionesParaLaCarta(resumen([g], { desde: 3000 }))).toEqual({ grupos: [{ nombre: "Relleno", opciones: [{ nombre: "Carne", recargo: 300 }] }], sinCosto: [], desde: 3000 });
  });

  it("un grupo obligatorio con dos opciones al precio más barato las muestra como pastillas: «Pollo +500 / Jamón +500 / Carne +800» → pastillas Pollo y Jamón, «Carne +300»", () => {
    const g: Grupo = { nombre: "Relleno", tipo: "VARIANTE", cantidadMinima: 1, opciones: [op("Pollo", { diferencia: 500 }), op("Jamón", { diferencia: 500 }), op("Carne", { diferencia: 800 })] };
    expect(opcionesParaLaCarta(resumen([g], { desde: 3000 }))).toEqual({
      grupos: [{ nombre: "Relleno", opciones: [{ nombre: "Carne", recargo: 300 }] }],
      sinCosto: [{ grupo: "Relleno", opciones: ["Pollo", "Jamón"] }],
      desde: 3000,
    });
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
    expect(opcionesParaLaCarta(resumen([{ ...EXTRAS, opciones: [] }]))).toEqual({ grupos: [], sinCosto: [], desde: 2500 });
  });

  it("un producto que hoy no se puede pedir (sin opción obligatoria disponible) no sale en la carta", () => {
    expect(opcionesParaLaCarta(resumen([CHICO_MEDIANO_GRANDE], { vendible: false, desde: null }))).toBeNull();
    expect(opcionesParaLaCarta(resumen([CHICO_MEDIANO_GRANDE], { desde: null }))).toBeNull();
    expect(opcionesParaLaCarta(resumen([CHICO_MEDIANO_GRANDE], { vendible: false }))).toBeNull();
  });

  it("sin grupos: sin opciones y con el «desde» del resumen", () => {
    expect(opcionesParaLaCarta(resumen([], { desde: 3200 }))).toEqual({ grupos: [], sinCosto: [], desde: 3200 });
  });
});

describe("la carta armada con las opciones (CARTA-B y CARTA-C)", () => {
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
          { productoId: "cafe", conDescuento: resumen([CHICO_MEDIANO_GRANDE, PREPARACION_DE_CAFE, EXTRAS]), sinDescuento: resumen([CHICO_MEDIANO_GRANDE, PREPARACION_DE_CAFE, EXTRAS]) },
          { productoId: "mila", conDescuento: resumen([GUARNICION, PUNTO], { desde: 9500 }), sinDescuento: resumen([GUARNICION, PUNTO], { desde: 9500 }) },
          // Un grupo obligatorio sin nada disponible: el producto no se puede pedir hoy y sale de la carta.
          { productoId: "te", conDescuento: resumen([], { vendible: false, desde: null }), sinDescuento: resumen([], { vendible: false, desde: null }) },
        ],
      }).carta,
    );

  it("el café lleva sus tamaños, recargos y pastillas; la milanesa lleva solo pastillas (sin `grupos`); el flan sale sin nada; y el té sin opción obligatoria disponible no sale", () => {
    const items = armar().secciones[0]!.items;
    expect(items.map((i) => i.nombre)).toEqual(["Café", "Flan", "Milanesa"]);
    const cafe = items.find((i) => i.nombre === "Café")!;
    expect(cafe.precio).toBe(2500);
    expect(cafe.grupos).toEqual([
      { nombre: "Tamaño", opciones: [{ nombre: "Chico", precio: 2500 }, { nombre: "Mediano", precio: 2800 }, { nombre: "Grande", precio: 3100 }] },
      { nombre: "Preparación", opciones: [{ nombre: "Con leche", recargo: 400 }] },
      { nombre: "Extras", opciones: [{ nombre: "Medialuna", recargo: 600 }, { nombre: "Shot", recargo: 500 }] },
    ]);
    expect(cafe.opcionesSinCosto).toEqual([{ grupo: "Preparación", opciones: ["Solo", "Flat white", "Cortado"] }]);
    const milanesa = items.find((i) => i.nombre === "Milanesa")!;
    expect(Object.keys(milanesa)).not.toContain("grupos");
    expect(milanesa.precio).toBe(9500);
    expect(milanesa.opcionesSinCosto).toEqual([
      { grupo: "Guarnición", opciones: ["Papas", "Puré", "Ensalada"] },
      { grupo: "Punto de cocción", opciones: ["Jugoso", "A punto", "Bien cocido"] },
    ]);
    const flan = items.find((i) => i.nombre === "Flan")!;
    expect(Object.keys(flan)).not.toContain("grupos");
    expect(Object.keys(flan)).not.toContain("opcionesSinCosto");
  });

  it("la salida pública del café lleva las pastillas solo como textos: ni precios, ni ids, ni la «ninguna»", () => {
    const salida = JSON.stringify(armar().secciones[0]!.items.find((i) => i.nombre === "Milanesa"));
    expect(salida).toContain('"opcionesSinCosto":[{"grupo":"Guarnición","opciones":["Papas","Puré","Ensalada"]}');
    expect(salida).not.toContain("Sin guarnición");
  });

  it("la salida pública no lleva `precioDesde`, ni `obligatorio` ni `maximo` (la carta ya no los dibuja)", () => {
    const json = JSON.stringify(armar());
    for (const clave of ["precioDesde", "obligatorio", "maximo"]) expect(json).not.toContain(clave);
  });
});
