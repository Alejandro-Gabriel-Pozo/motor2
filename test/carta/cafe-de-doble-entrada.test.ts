import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));
// S-26: la carta pública se cachea con `unstable_cache` (necesita el caché de Next, que fuera de un pedido no existe): acá corre directo, como en `carta-publica-sin-ids.test.tsx`.
vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), unstable_cache: (fn: () => unknown) => fn }));

import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";
import { darRecetaDeReventa } from "../setup/receta-de-venta";
import { sembrarCatalogoPrecioYCarta, type CatalogoPrecioYCarta } from "../setup/siembra-precio-y-carta";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { agregarItems } from "../../src/server/actions/pos/cuenta-pedido";
import { cartaPublica, empresaCartaPublica } from "../../src/server/carta-publica/sin-sesion";
import { resolverMenuCartaConDiagnostico } from "../../src/server/lecturas/carta/menu";
import { Seccion } from "../../src/components/carta-publica/seccion";

/**
 * Fase 5 de la ola «precio y carta», paso C10: un café de especialidad con TAMAÑO y PREPARACIÓN OBLIGATORIA sale en la carta como TABLA DE DOBLE ENTRADA con precios FINALES, contra Postgres.
 *  - «Café de especialidad» es un producto DIRECTO (no base) en «Cafetería», con el MISMO grupo de tamaño que el café del catálogo de referencia (MEDIDA en ABSOLUTO: Chico $4.000, Mediano $4.100,
 *    Grande $4.300; el precio por tamaño vive en la admisión del producto) y un grupo propio «Preparación obligatoria» (VARIANTE 1..1, sin prefijo en la carta): Solo +$0, Cortado +$0,
 *    Lágrima +$200, Con leche +$300 (MONTO);
 *  - la carta lee de la base la forma «tabla» (rótulo = el nombre, filas = las preparaciones, columnas = los tamaños) y cada celda es la composición precio del tamaño + diferencia de la preparación,
 *    calculada por la regla de la venta (`tablaDePreciosParaLaCarta`), la misma que cobra la caja: acá se compara las 12 celdas con lo que cobra `agregarItems`, la acción real del POS;
 *  - las filas no se juntan aunque cuesten igual (Solo y Cortado);
 *  - el HTML de la carta pública (`Seccion`) muestra el rótulo con el nombre, 4 encabezados de fila y los 12 precios finales.
 * Sin prefijo, la fila se lee con el nombre de la opción tal cual está cargado.
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
let cat: CatalogoPrecioYCarta;
let productoId: string;
let grupoPreparacionId: string;

afterAll(async () => {
  await limpiarBaseDeTest();
});

/** Las preparaciones en el orden de la carta, con su diferencia (MONTO) sobre el precio del tamaño. */
const PREPARACIONES = [
  { nombre: "Solo", diferencia: "0.00" },
  { nombre: "Cortado", diferencia: "0.00" },
  { nombre: "Lágrima", diferencia: "200.00" },
  { nombre: "Con leche", diferencia: "300.00" },
] as const;

/** Los tamaños del café de referencia (la clave simbólica de la siembra), con el precio absoluto que tiene en el café de especialidad. */
const TAMANOS = [
  { clave: "chico", nombre: "Chico", absoluto: "4000.00" },
  { clave: "mediano", nombre: "Mediano", absoluto: "4100.00" },
  { clave: "grande", nombre: "Grande", absoluto: "4300.00" },
] as const;

const TABLA_ESPERADA = [
  { rotulo: "Solo", celdas: [4000, 4100, 4300] },
  { rotulo: "Cortado", celdas: [4000, 4100, 4300] },
  { rotulo: "Lágrima", celdas: [4200, 4300, 4500] },
  { rotulo: "Con leche", celdas: [4300, 4400, 4600] },
];

/** Arma el producto del dueño sobre el catálogo de referencia. `cantidadMinima` de la preparación: 1 = obligatoria (el caso), 0 = opcional. */
async function sembrarCafeDeEspecialidad(cantidadMinima: number) {
  const pv = await prisma.producto.create({ data: { codigo: "PV_CAFE_ESPECIALIDAD", nombre: "Café de especialidad", tipo: "PV", unidadStockId: s.unidad.id, precioVenta: "4000.00" } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId: s.sucursalId, productoId: pv.id, disponible: true } });
  await darRecetaDeReventa(prisma, pv, { sucursalIds: [s.sucursalId] });
  const seccionCafeteria = [...cat.nombres.entries()].find(([, nombre]) => nombre === "seccion«Cafetería»")![0];
  await prisma.contenidoCartaProducto.create({ data: { sucursalId: s.sucursalId, productoId: pv.id, visibleEnCarta: true, seccionCartaId: seccionCafeteria, orden: 1 } });

  // El tamaño: el grupo y las opciones del café de referencia, con el precio de este producto en su admisión.
  const grupoTamano = (await prisma.opcionDeGrupo.findUniqueOrThrow({ where: { id: cat.opcion.chico! }, select: { grupoId: true } })).grupoId;
  await prisma.productoAdmiteGrupo.create({ data: { productoId: pv.id, grupoId: grupoTamano, orden: 0, modoPrecio: "ABSOLUTO" } });
  for (const t of TAMANOS) await prisma.productoAdmiteOpcion.create({ data: { productoId: pv.id, opcionId: cat.opcion[t.clave]!, precioAbsoluto: t.absoluto } });

  // La preparación: un grupo propio, VARIANTE de una sola elección, sin prefijo en la carta.
  grupoPreparacionId = (await prisma.grupoDeOpciones.create({ data: { nombre: "Preparación obligatoria", tipo: "VARIANTE", cantidadMinima, cantidadMaxima: 1 } })).id;
  await prisma.productoAdmiteGrupo.create({ data: { productoId: pv.id, grupoId: grupoPreparacionId, orden: 1 } });
  const opcionPreparacion: Record<string, { opcionId: string; versionId: string }> = {};
  for (const [orden, p] of PREPARACIONES.entries()) {
    const opcionId = (await prisma.opcionDeGrupo.create({ data: { grupoId: grupoPreparacionId, nombre: p.nombre, orden } })).id;
    const versionId = (await prisma.versionDeOpcion.create({ data: { opcionId, numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio: p.diferencia, creadoPorId: s.admin.id } })).id;
    await prisma.productoAdmiteOpcion.create({ data: { productoId: pv.id, opcionId } });
    opcionPreparacion[p.nombre] = { opcionId, versionId };
  }
  productoId = pv.id;
  return opcionPreparacion;
}

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  cat = await sembrarCatalogoPrecioYCarta(s);
  await entrarComo(s.admin);
});

const itemDeLaCarta = async (nombre: string) => {
  const armado = await resolverMenuCartaConDiagnostico(s.sucursalId, prisma, AHORA_DE_LA_CORRIDA, undefined, "publico", true);
  return armado!.carta.secciones.flatMap((x) => x.items).find((i) => i.nombre === nombre)!;
};

describe("C10: un café con tamaño y preparación obligatoria sale como tabla de doble entrada con precios finales", () => {
  it("la carta lo lee como «tabla»: columnas Chico, Mediano y Grande; una fila por preparación, en ese orden, con el precio final de cada combinación; Solo y Cortado no se juntan", async () => {
    await sembrarCafeDeEspecialidad(1);
    const item = await itemDeLaCarta("Café de especialidad");
    // (a) la forma
    expect(item.presentacion?.forma).toBe("tabla");
    // (b) y (c) las columnas, las filas en orden y los precios finales exactos
    expect(item.presentacion).toEqual({ forma: "tabla", columnas: ["Chico", "Mediano", "Grande"], filas: TABLA_ESPERADA, aclaraciones: [] });
    // El café de referencia, en su sección y al lado, sigue como estaba (columnas, con su preparación opcional).
    expect((await itemDeLaCarta("Café")).presentacion).toMatchObject({ forma: "columnas", celdas: [4000, 4100, 4300] });
  });

  it("con la preparación OPCIONAL (cantidad mínima 0) ya no es un eje obligatorio: el café de especialidad NO sale como tabla", async () => {
    await sembrarCafeDeEspecialidad(1);
    await prismaAdmin.grupoDeOpciones.updateMany({ where: { id: grupoPreparacionId }, data: { cantidadMinima: 0 } });
    const forma = (await itemDeLaCarta("Café de especialidad")).presentacion?.forma;
    expect(forma).toBeDefined();
    expect(forma).not.toBe("tabla");
  });

  it("(d) PARIDAD con la caja: cada una de las 12 celdas es lo que cobra la acción real del POS (`agregarItems`) para esa elección de tamaño y preparación", async () => {
    const preparacion = await sembrarCafeDeEspecialidad(1);
    const item = await itemDeLaCarta("Café de especialidad");
    expect(item.presentacion?.forma).toBe("tabla");
    const tabla = item.presentacion as Extract<NonNullable<typeof item.presentacion>, { forma: "tabla" }>;
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id);
    const vistas = new Set<string>();
    for (const fila of tabla.filas) {
      for (const [c, columna] of tabla.columnas.entries()) {
        const tamano = TAMANOS.find((t) => t.nombre === columna)!;
        const prep = preparacion[fila.rotulo]!;
        const r = await agregarItems(cuenta.id, [
          {
            productoId,
            cantidad: 1,
            opciones: [
              { opcionId: cat.opcion[tamano.clave]!, cantidad: 1, versionDeOpcionId: cat.version[tamano.clave]! },
              { opcionId: prep.opcionId, cantidad: 1, versionDeOpcionId: prep.versionId },
            ],
          },
        ]);
        expect(r.ok, `${fila.rotulo} × ${columna}: ${r.mensaje}`).toBe(true);
        const nuevas = (await prismaAdmin.cuentaItem.findMany({ where: { empresaId: EMPRESA_POR_DEFECTO_ID, cuentaId: cuenta.id, productoId }, select: { id: true, precioUnitario: true } })).filter((i) => !vistas.has(i.id));
        expect(nuevas, `${fila.rotulo} × ${columna}: una línea nueva`).toHaveLength(1);
        vistas.add(nuevas[0]!.id);
        expect(Number(nuevas[0]!.precioUnitario.toString()), `${fila.rotulo} × ${columna}: lo que cobra la caja`).toBe(fila.celdas[c]);
      }
    }
    expect(vistas.size).toBe(12);
  });

  it("(e) el HTML de la carta pública: el nombre como rótulo antes de la tabla, 4 encabezados de fila (`th scope=\"row\"`) y los 12 precios finales", async () => {
    await sembrarCafeDeEspecialidad(1);
    const empresa = (await empresaCartaPublica("principal"))!;
    const entregada = (await cartaPublica(empresa, cat.slug, AHORA_DE_LA_CORRIDA))!;
    const indice = entregada.carta.secciones.findIndex((x) => x.nombre === "Cafetería");
    const html = renderToStaticMarkup(createElement(Seccion, { seccion: entregada.carta.secciones[indice]!, indice, total: entregada.carta.secciones.length, estilo: entregada.estilo }));

    const li = html.split(/(?=<li data-forma=)/).find((x) => x.includes("Café de especialidad"))!;
    expect(li, "el café de especialidad sale como tabla").toMatch(/^<li data-forma="tabla"/);
    expect(li).toMatch(/<h3 data-rol="rotulo" class="carta-rol-rotulo[^"]*"[^>]*>Café de especialidad<\/h3>/);
    expect(li.indexOf('<h3 data-rol="rotulo"')).toBeLessThan(li.indexOf("<table"));
    const tabla = li.slice(li.indexOf("<table"), li.indexOf("</table>"));
    const texto = (fragmento: string) => fragmento.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    expect(tabla.match(/<th scope="col"[^>]*>([^<]*)<\/th>/g)?.map(texto)).toEqual(["Chico", "Mediano", "Grande"]);
    expect(tabla.match(/<th scope="row"[^>]*>[\s\S]*?<\/th>/g)?.map(texto)).toEqual(["Solo", "Cortado", "Lágrima", "Con leche"]);
    const precios = [...tabla.matchAll(/data-rol="precio"[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(precios).toEqual(["$4.000", "$4.100", "$4.300", "$4.000", "$4.100", "$4.300", "$4.200", "$4.300", "$4.500", "$4.300", "$4.400", "$4.600"]);
    // El café de referencia, en su propia fila de la sección, no se mezcla con la tabla.
    expect(li).not.toContain("Preparación del café");
  });
});
