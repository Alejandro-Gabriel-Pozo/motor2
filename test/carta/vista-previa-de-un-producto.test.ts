import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { vistaPreviaDeLaForma, vistaPreviaDeOpciones, type VistaPreviaDeLaCarta } from "../../src/core/carta/public";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { sembrarCatalogoPrecioYCarta, type CatalogoPrecioYCarta } from "../setup/siembra-precio-y-carta";
import { sembrarSalon } from "../pos/salon-fixture";
import { cargarCartaParaMantener } from "../../src/server/consultas/carta/mantenimiento";
import { cargarVistaPreviaDeLaCarta } from "../../src/server/consultas/carta/vista-previa-de-un-producto";

/**
 * Fase 6, bloque 3, 6.18: la vista previa de UN producto en la carta (`cargarVistaPreviaDeLaCarta`), contra Postgres con el catálogo de producción sembrado. Lo que se afirma:
 *  - es la MISMA proyección que ya usa «Agregar a la carta» (`cargarCartaParaMantener`): para cada producto del catálogo, lo que dice la vista previa del espacio es, texto por texto, lo que dice «Va a mostrar»;
 *  - la forma de cada uno (pizzas como platos sueltos, milanesas en tabla, café en columnas, el bife con su precio y lo que se lee debajo), el producto sin opciones y el que hoy no se puede pedir;
 *  - el «nombre arriba» de la carta cambia el encabezado de una base con un solo eje.
 */
describe("cargarVistaPreviaDeLaCarta, contra Postgres", () => {
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
    // Sin contenido de carta: quedan en «Fuera de carta», que es donde «Agregar a la carta» muestra su vista previa (la que se cruza acá).
    await prisma.contenidoCartaProducto.deleteMany({ where: { sucursalId: s.sucursalId } });
  });

  const vista = async (clave: string, mostrarNombreArriba = false): Promise<VistaPreviaDeLaCarta> => {
    const p = await prisma.producto.findUniqueOrThrow({ where: { id: cat.producto[clave]! }, select: { id: true, precioVenta: true, modoDeVenta: true } });
    return cargarVistaPreviaDeLaCarta(prisma, s.sucursalId, { id: p.id, precioVenta: Number(p.precioVenta), esBase: p.modoDeVenta === "BASE_CONFIGURABLE" }, mostrarNombreArriba);
  };
  /** El texto de «Va a mostrar» que corresponde a una vista previa: lo que `cargarCartaParaMantener` arma con las mismas piezas. */
  const comoVaAMostrar = (nombre: string, v: VistaPreviaDeLaCarta): string =>
    v.tipo === "forma" ? vistaPreviaDeLaForma(nombre, v.presentacion) : v.tipo === "texto" ? v.texto : v.tipo === "sin-opciones" ? vistaPreviaDeOpciones(false, null) : vistaPreviaDeOpciones(true, null);

  it("coincide, producto por producto, con el «Va a mostrar» de «Agregar a la carta»", async () => {
    const carta = await cargarCartaParaMantener(prisma, s.sucursalId);
    for (const clave of ["pizzas", "milanesas", "cafe", "bife", "wok"]) {
      const nombre = (await prisma.producto.findUniqueOrThrow({ where: { id: cat.producto[clave]! }, select: { nombre: true } })).nombre;
      const enMantenimiento = carta.fueraDeCarta.find((p) => p.nombre === nombre)?.vistaPrevia;
      expect(enMantenimiento, `${clave} tiene que estar en «Fuera de carta»`).toBeDefined();
      expect(comoVaAMostrar(nombre, await vista(clave)), clave).toBe(enMantenimiento);
    }
  });

  it("la forma de cada producto: pizzas como platos, milanesas en tabla, café en una tabla de tamaños, el bife con su precio y lo que se lee debajo, el wok sin opciones", async () => {
    expect(await vista("pizzas")).toMatchObject({ tipo: "forma", presentacion: { forma: "tabla", titulo: false } });
    expect(await vista("milanesas")).toMatchObject({ tipo: "forma", presentacion: { forma: "tabla", columnas: ["Simple", "Napolitana"] } });
    expect(await vista("cafe")).toMatchObject({ tipo: "forma", presentacion: { forma: "tabla", titulo: true, columnas: ["Chico", "Mediano", "Grande"], filas: [{ rotulo: null, celdas: [4000, 4100, 4300] }] } });
    const bife = await vista("bife");
    expect(bife).toMatchObject({ tipo: "forma", presentacion: { forma: "simple" } });
    expect(bife.tipo === "forma" && bife.presentacion.aclaraciones.map((a) => a.rotulo)).toEqual(["Guarnicion", "Extras"]);
    expect(await vista("wok")).toEqual({ tipo: "sin-opciones" });
  });

  it("el «nombre arriba» de la carta pone el nombre del producto como encabezado de una base con un solo eje", async () => {
    expect(await vista("pizzas", true)).toMatchObject({ tipo: "forma", presentacion: { forma: "tabla", titulo: true } });
    expect(await vista("pizzas", false)).toMatchObject({ tipo: "forma", presentacion: { forma: "tabla", titulo: false } });
  });

  it("un producto con un grupo obligatorio sin ninguna opción disponible hoy no se puede pedir: no sale en la carta (igual que en «Agregar a la carta»)", async () => {
    await prismaAdmin.productoAdmiteOpcion.updateMany({ where: { productoId: cat.producto.cafe!, opcion: { grupo: { nombre: "Tamaño del Café" } } }, data: { activo: false } });
    expect(await vista("cafe")).toEqual({ tipo: "no-se-puede-pedir" });
    const carta = await cargarCartaParaMantener(prisma, s.sucursalId);
    expect(carta.fueraDeCarta.find((p) => p.nombre === "Café")?.vistaPrevia).toBe(comoVaAMostrar("Café", { tipo: "no-se-puede-pedir" }));
  });

  it("lo que se lee debajo del bife: la guarnición se elige y los extras suman su recargo exacto", async () => {
    const bife = await vista("bife");
    const debajo = bife.tipo === "forma" ? bife.presentacion.aclaraciones : [];
    expect(debajo.find((a) => a.rotulo === "Guarnicion")).toMatchObject({ tipo: "eleccion", opciones: ["ensalada", "papas fritas", "puré"] });
    expect(debajo.find((a) => a.rotulo === "Extras")).toMatchObject({ tipo: "extras", opciones: [{ nombre: "extra de papas", recargo: 2000 }, { nombre: "huevo frito", recargo: 1500 }] });
  });
});
