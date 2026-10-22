import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { presentacionDeUnProductoSolo, vistaPreviaDeLaForma } from "../../src/core/carta/public";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { sembrarCatalogoPrecioYCarta, type CatalogoPrecioYCarta } from "../setup/siembra-precio-y-carta";
import { sembrarSalon } from "../pos/salon-fixture";
import { cargarCartaParaMantener } from "../../src/server/consultas/carta/mantenimiento";

/**
 * Fase 5 de la ola «precio y carta», paso 9: la vista previa «Va a mostrar» de «Agregar a la carta» (Carta › Mantenimiento › «Fuera de carta») pasa a la PROYECCIÓN NUEVA: dice la forma que la carta
 * pública le va a dar al producto (la misma, `presentacionDeUnProductoSolo`, con la misma tabla de precios de la regla de la venta) en vez de las listas de antes.
 *  - Puro: el texto de cada forma.
 *  - Contra Postgres, con el catálogo de producción sembrado y Pizzas y Milanesas como base (sin contenido de carta: quedan «Fuera de carta»): pizzas como platos sueltos, milanesas en tabla con «De»,
 *    el café en columnas y el bife con su precio y lo que se lee debajo.
 */

describe("vistaPreviaDeLaForma (puro)", () => {
  it("cada forma con sus precios y lo que se lee debajo", () => {
    expect(vistaPreviaDeLaForma("Bife", { presentacion: { forma: "simple", aclaraciones: [{ tipo: "eleccion", rotulo: "Guarnicion", opciones: ["ensalada", "puré"] }] }, rotulos: [] })).toBe(
      "Va a mostrar «Bife» con su precio · Guarnicion: ensalada o puré.",
    );
    expect(vistaPreviaDeLaForma("Café", { presentacion: { forma: "columnas", celdas: [4000, null], aclaraciones: [] }, rotulos: ["Chico", "Grande"] })).toBe("Va a mostrar «Café» en columnas: Chico $4.000, Grande –.");
    expect(
      vistaPreviaDeLaForma("Milanesas", { presentacion: { forma: "tabla", columnas: ["Simple", "Napolitana"], filas: [{ rotulo: "De carne", celdas: [20000, 25000] }], aclaraciones: [] }, rotulos: [] }),
    ).toBe("Va a mostrar una tabla «Milanesas» (Simple / Napolitana): De carne $20.000 / $25.000.");
    expect(vistaPreviaDeLaForma("Pizzas", { presentacion: { forma: "lista", encabezado: false, filas: [{ rotulo: "Pizza muzzarella", precio: 18000 }], aclaraciones: [] }, rotulos: [] })).toBe(
      "Va a mostrar cada opción como un plato: Pizza muzzarella $18.000.",
    );
    expect(vistaPreviaDeLaForma("Pizzas", { presentacion: { forma: "lista", encabezado: true, filas: [{ rotulo: "Muzzarella", precio: 18000 }], aclaraciones: [] }, rotulos: [] })).toBe(
      "Va a mostrar «Pizzas» y debajo: Muzzarella $18.000.",
    );
  });

  it("un producto solo con columnas: la tanda de él solo, con sus rótulos", () => {
    const tabla = {
      grupos: [{ grupoId: "g", nombre: "Tamaño", tipo: "MEDIDA" as const, cantidadMinima: 1, cantidadMaxima: 1, prefijoEnCarta: null, papel: "define-el-precio" as const, opciones: [
        { opcionId: "a", nombre: "Chico", esNinguna: false, orden: 0, precioFinal: 4000, diferencia: 0 },
        { opcionId: "b", nombre: "Grande", esNinguna: false, orden: 1, precioFinal: 4300, diferencia: 300 },
      ] }],
      ejes: { columnas: "g", filas: null, sinLugar: [] },
      celdas: [[4000, 4300]],
    };
    expect(presentacionDeUnProductoSolo({ tabla, esBase: false, mostrarNombreArriba: false, conDescuento: false })).toEqual({ presentacion: { forma: "columnas", celdas: [4000, 4300], aclaraciones: [] }, rotulos: ["Chico", "Grande"] });
  });
});

describe("«Va a mostrar» de «Agregar a la carta», contra Postgres", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let cat: CatalogoPrecioYCarta;

  afterAll(async () => {
    await limpiarBaseDeTest();
  });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    cat = await sembrarCatalogoPrecioYCarta(s);
    await prisma.producto.updateMany({ where: { id: { in: [cat.producto.pizzas!, cat.producto.milanesas!] } }, data: { modoDeVenta: "BASE_CONFIGURABLE" } });
    await prismaAdmin.grupoDeOpciones.updateMany({ where: { nombre: "Milanesas de" }, data: { prefijoEnCarta: "De" } });
    // Sin contenido de carta: quedan en «Fuera de carta», que es donde se ve la vista previa.
    await prisma.contenidoCartaProducto.deleteMany({ where: { sucursalId: s.sucursalId } });
  });

  it("pizzas como platos sueltos, milanesas en tabla, el café en columnas y el bife con su precio y lo que se lee debajo", async () => {
    const carta = await cargarCartaParaMantener(prisma, s.sucursalId);
    const vista = (nombre: string) => carta.fueraDeCarta.find((p) => p.nombre === nombre)?.vistaPrevia;
    expect(vista("Pizzas")).toBe(
      "Va a mostrar cada opción como un plato: Pizza muzzarella $18.000, Pizza de verduras asadas $20.000, Pizza fugazzeta $22.000, Pizza napolitana $22.000, Pizza con papas fritas $25.000, Pizza bomba $25.000.",
    );
    expect(vista("Milanesas")).toBe("Va a mostrar una tabla «Milanesas» (Simple / Napolitana): De carne $20.000 / $25.000; De pollo $20.000 / $25.000.");
    expect(vista("Café")).toMatch(/^Va a mostrar «Café» en columnas: Chico \$4\.000, Mediano \$4\.100, Grande \$4\.300 · Preparación del café: /);
    expect(vista("Bife a la criolla")).toBe("Va a mostrar «Bife a la criolla» con su precio · Guarnicion: ensalada, papas fritas o puré · Extras: extra de papas +$2.000, huevo frito +$1.500.");
  });
});
