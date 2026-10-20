import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";
import { sembrarCatalogoPrecioYCarta, type CatalogoPrecioYCarta } from "../setup/siembra-precio-y-carta";
import { sembrarSalon } from "../pos/salon-fixture";
import { basesDeUnEjeEnLaCarta } from "../../src/server/consultas/carta/admin";
import { resolverMenuCartaConDiagnostico } from "../../src/server/lecturas/carta/menu";

/**
 * Fase 5 de la ola «precio y carta» (DEC-11), contra Postgres, con el catálogo de producción sembrado (`test/setup/siembra-precio-y-carta.ts`) y Pizzas y Milanesas marcadas como base:
 *  - `basesDeUnEjeEnLaCarta` (lo que decide si el formulario del contenido muestra «Mostrar el nombre arriba») trae SOLO las bases de un eje, con el valor guardado; una base de dos ejes (milanesas con
 *    «De») y un producto directo (el café) no;
 *  - la carta armada lee de la base el modo, el prefijo del grupo y el interruptor (`menu.ts` → `armarMenuCarta`): pizzas ocultas o con el nombre arriba según el interruptor, milanesas en tabla con
 *    «De carne» / «De pollo» en cuanto el grupo tiene prefijo.
 */
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
});

const presentacionDe = async (nombre: string) => {
  const armado = await resolverMenuCartaConDiagnostico(s.sucursalId, prisma, AHORA_DE_LA_CORRIDA, undefined, true, true);
  return armado!.carta.secciones.flatMap((x) => x.items).find((i) => i.nombre === nombre)!.presentacion;
};

describe("Fase 5, DEC-11: las bases de un eje y lo que la carta lee de la base", () => {
  it("solo las bases de un eje, con el valor guardado; las pizzas salen ocultas y, con el interruptor prendido, con el nombre arriba", async () => {
    expect(await basesDeUnEjeEnLaCarta(s.sucursalId, prisma)).toEqual(
      new Map([
        [cat.producto.pizzas!, false],
        [cat.producto.milanesas!, false],
      ])
    );
    expect(await presentacionDe("Pizzas")).toMatchObject({ forma: "lista", encabezado: false });
    expect(await presentacionDe("Pizzas"), "una base: protagonizan las opciones").not.toHaveProperty("protagonista");

    await prisma.contenidoCartaProducto.updateMany({ where: { sucursalId: s.sucursalId, productoId: cat.producto.pizzas! }, data: { mostrarNombreArriba: true } });
    expect((await basesDeUnEjeEnLaCarta(s.sucursalId, prisma)).get(cat.producto.pizzas!)).toBe(true);
    expect(await presentacionDe("Pizzas")).toMatchObject({ forma: "lista", encabezado: true });
  });

  it("con «De» en «Milanesas de», la milanesa pasa a dos ejes: sale en tabla («De carne», «De pollo») y ya no es una base de un eje", async () => {
    expect(await presentacionDe("Milanesas")).toMatchObject({ forma: "lista", encabezado: false, aclaraciones: [{ tipo: "eleccion", rotulo: "Milanesas de", opciones: ["carne", "pollo"] }] });
    await prismaAdmin.grupoDeOpciones.updateMany({ where: { nombre: "Milanesas de" }, data: { prefijoEnCarta: "De" } });
    expect(await presentacionDe("Milanesas")).toEqual({
      forma: "tabla",
      columnas: ["Simple", "Napolitana"],
      filas: [
        { rotulo: "De carne", celdas: [20000, 25000] },
        { rotulo: "De pollo", celdas: [20000, 25000] },
      ],
      aclaraciones: [],
    });
    expect([...(await basesDeUnEjeEnLaCarta(s.sucursalId, prisma)).keys()]).toEqual([cat.producto.pizzas!]);
  });
});
