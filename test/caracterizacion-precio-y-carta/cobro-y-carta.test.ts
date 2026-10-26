import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));
// S-26: la carta pública se cachea con `unstable_cache` (necesita el caché de Next, que fuera de un pedido no existe): acá corre directo, como en `carta-publica-sin-ids.test.tsx`.
vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), unstable_cache: (fn: () => unknown) => fn }));

import type { ItemParaAgregar } from "../../src/core/features/cuentas/cuenta-pedido.schema";
import type { CartaPublicaV1, ItemCartaPublico } from "../../src/core/carta/public";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";
import { sembrarCatalogoPrecioYCarta, sembrarPrecioDeSucursalDeTamano, type CatalogoPrecioYCarta } from "../setup/siembra-precio-y-carta";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { agregarItems } from "../../src/server/actions/pos/cuenta-pedido";
import { cartaPublica, empresaCartaPublica } from "../../src/server/carta-publica/sin-sesion";

/**
 * CARACTERIZACIÓN INTEGRADA del precio COBRADO y del precio MOSTRADO (Fase 0 de la ola «precio y carta», 2026-10-19), contra Postgres: la contraparte con base de `precios.test.ts`
 * (que congela las funciones puras). Con el catálogo de producción sembrado en la base (`test/setup/siembra-precio-y-carta.ts`: pizzas, milanesas, café, bife, gaseosa y wok, con los
 * nombres, tipos y precios del catálogo de referencia puro), congela:
 *  - la CARTA PÚBLICA tal como la entrega la entrada sin sesión (`cartaPublica` de `server/carta-publica/sin-sesion.ts`: `resolverCartaPublica` con opciones + la proyección sin ids,
 *    `CartaPublicaV1`, que es exactamente lo que recibe el navegador), por sección e ítem, con TODAS sus claves;
 *  - el COBRO: lo que la acción real del POS (`agregarItems`, con la sesión del admin simulada) escribe por cada venta representativa —precio unitario, precio de lista de carta,
 *    cantidad, adicionales y la foto de cada opción elegida (`OpcionElegidaEnLinea`) con su importe—, los rechazos (precio que cambió y grupo obligatorio faltante) y el tamaño con
 *    precio de sucursal (la grilla), con la carta de ese producto otra vez.
 *
 * Solo campos de precio y de lo elegido (nunca la fila entera): las fases siguientes cambian columnas y lecturas, y este golden tiene que salir IDÉNTICO si el precio no cambió. Ids
 * con nombres simbólicos, sin fechas, una venta por llamada (el orden de las líneas no depende de la base). No ejercita combinaciones, combos ni menú del día.
 *
 * Es una FOTO de hoy, no una aprobación. Para regenerarla A PROPÓSITO (una decisión de producto): `REGENERAR_COBRO_Y_CARTA=1 npx vitest run test/caracterizacion-precio-y-carta/cobro-y-carta.test.ts`,
 * y declararlo en `test/arquitectura/caracterizaciones-congeladas.test.ts`.
 */
const ARCHIVO = join(__dirname, "cobro-y-carta.golden.txt");

afterAll(async () => {
  await limpiarBaseDeTest();
});

/** Un `Decimal` de la base (exacto, con su escala) con dos decimales, o «-». */
const dinero = (v: { toFixed(d: number): string } | null) => (v === null ? "-" : v.toFixed(2));
const cantidadTexto = (v: { toString(): string }) => Number(v.toString()).toString();

/** Un valor escalar de la carta pública, en JSON: los números EXACTOS como viajan al navegador (sin redondear: un 4599.999999 tiene que verse). */
const valorDeCarta = (v: unknown) => JSON.stringify(v);

/** Las claves escalares de un objeto (orden alfabético), salvo las que se vuelcan aparte: así una clave nueva de la proyección aparece en el golden. */
const claves = (o: object, salvo: readonly string[]) =>
  Object.entries(o)
    .filter(([k]) => !salvo.includes(k))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${valorDeCarta(v)}`)
    .join(" ");

function textoDelItem(i: ItemCartaPublico): string[] {
  const out = [`  ITEM «${i.nombre}» ${claves(i, ["nombre", "grupos", "opcionesSinCosto", "opciones", "presentacion"])}`];
  for (const o of i.opciones ?? []) out.push(`    agrupada «${o.nombre}» ${claves(o, ["nombre"])}`);
  for (const g of i.grupos ?? []) {
    out.push(`    lista «${g.nombre}»: ${g.opciones.map((o) => `${o.nombre} ${o.tipo === "final" ? `precio=${valorDeCarta(o.precio)}` : `recargo=${o.recargo < 0 ? "" : "+"}${valorDeCarta(o.recargo)}`}`).join(" | ")}`);
  }
  for (const s of i.opcionesSinCosto ?? []) out.push(`    pastillas «${s.grupo}»: ${s.opciones.join(" | ")}`);
  // Fase 5 («carta pareja», paso 7): la forma ya resuelta, en su propia línea y ENTERA (JSON tal como viaja: una clave nueva adentro aparece acá).
  if (i.presentacion !== undefined) out.push(`    presentacion ${valorDeCarta(i.presentacion)}`);
  return out;
}

function textoDeCarta(c: CartaPublicaV1, soloItem?: string): string[] {
  const out: string[] = [];
  if (soloItem === undefined) out.push(`carta: version=${c.version} generadoEn=<fecha> sucursal=${JSON.stringify(c.sucursal)} secciones=${c.secciones.length}`);
  for (const s of c.secciones) {
    const items = soloItem === undefined ? s.items : s.items.filter((i) => i.nombre === soloItem);
    if (soloItem === undefined) out.push(`SECCION «${s.nombre}» ${claves(s, ["nombre", "items", "promos", "tandas"])} items=${s.items.length} promos=${s.promos.length}`);
    // Fase 5 (paso 7): las tandas de la sección, en su propia línea (JSON tal como viaja).
    if (soloItem === undefined && s.tandas !== undefined) out.push(`  tandas ${valorDeCarta(s.tandas)}`);
    for (const i of items) out.push(...textoDelItem(i));
    for (const p of s.promos) out.push(`  PROMO ${claves(p, [])}`);
  }
  return out;
}

describe("Caracterización integrada del cobro y de la carta (Fase 0, contra Postgres)", () => {
  const lineas: string[] = [];

  beforeEach(async () => {
    lineas.length = 0;
    await limpiarBaseDeTest();
  });

  it("lo que cobra el POS y lo que muestra la carta pública es lo congelado en cobro-y-carta.golden.txt", async () => {
    const s = await sembrarSalon();
    const cat: CatalogoPrecioYCarta = await sembrarCatalogoPrecioYCarta(s);
    await entrarComo(s.admin);
    const nombres = new Map<string, string>(cat.nombres);
    nombres.set(s.mesa.id, "mesa4");

    const leerCarta = async (): Promise<CartaPublicaV1> => {
      const empresa = await empresaCartaPublica("principal");
      expect(empresa, "la empresa de prueba tiene que resolver por su slug").not.toBeNull();
      const entregada = await cartaPublica(empresa!, cat.slug, AHORA_DE_LA_CORRIDA);
      expect(entregada, "la carta de la sucursal sembrada tiene que publicarse").not.toBeNull();
      return entregada!.carta;
    };

    // 1. CARTA PÚBLICA
    lineas.push("# Caracterización integrada (Fase 0): lo que cobra el POS y lo que muestra la carta pública, contra Postgres. Foto de hoy, no aprobación.", "");
    lineas.push("## CARTA PÚBLICA (cartaPublica → CartaPublicaV1, lo que recibe el navegador)");
    lineas.push(...textoDeCarta(await leerCarta()), "");

    // 2. COBRO: cada venta en su propia llamada a la acción real, sobre la misma cuenta; se vuelcan las líneas NUEVAS de cada llamada.
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id);
    const vistas = new Set<string>();
    const u = (clave: string, cantidad = 1) => ({ opcionId: cat.opcion[clave]!, cantidad, versionDeOpcionId: cat.version[clave]! });
    const P = cat.producto;

    async function lineasNuevas(): Promise<string[]> {
      const items = await prismaAdmin.cuentaItem.findMany({
        where: { empresaId: EMPRESA_POR_DEFECTO_ID, cuentaId: cuenta.id },
        select: {
          id: true,
          productoId: true,
          cantidad: true,
          precioUnitario: true,
          precioCartaUnitario: true,
          huellaOpciones: true,
          lineaPadreId: true,
          numeroEnvio: true,
          promoCuentaId: true,
          producto: { select: { nombre: true } },
          opcionesElegidas: {
            orderBy: [{ orden: "asc" }, { nombreGrupo: "asc" }, { nombreOpcion: "asc" }],
            select: {
              grupoId: true,
              opcionId: true,
              versionDeOpcionId: true,
              tipoGrupo: true,
              nombreGrupo: true,
              nombreOpcion: true,
              cantidad: true,
              modoPrecio: true,
              tipoDeDiferencia: true,
              porcentaje: true,
              importeUnitario: true,
              precioDeSucursal: true,
              factorEscala: true,
              orden: true,
            },
          },
        },
      });
      const nuevas = items.filter((i) => !vistas.has(i.id));
      nuevas.forEach((i) => vistas.add(i.id));
      // Orden determinista sin depender de la base: la línea padre primero y sus adicionales por nombre de producto.
      const padres = nuevas.filter((i) => i.lineaPadreId === null).sort((a, b) => a.producto.nombre.localeCompare(b.producto.nombre, "es"));
      const out: string[] = [];
      const sim = (id: string | null) => (id === null ? "-" : (nombres.get(id) ?? "<id-sin-nombre>"));
      for (const padre of padres) {
        const adicionales = nuevas.filter((i) => i.lineaPadreId === padre.id).sort((a, b) => a.producto.nombre.localeCompare(b.producto.nombre, "es"));
        for (const l of [padre, ...adicionales]) {
          out.push(
            `  ${l.lineaPadreId === null ? "LINEA" : "  ADICIONAL"} «${l.producto.nombre}» producto=${sim(l.productoId)} cantidad=${cantidadTexto(l.cantidad)} precioUnitario=${dinero(l.precioUnitario)} precioCartaUnitario=${dinero(l.precioCartaUnitario)} huella=${l.huellaOpciones === null ? "-" : "sí"} envio=${l.numeroEnvio ?? "-"} promo=${l.promoCuentaId === null ? "-" : "sí"}`
          );
          for (const f of l.opcionesElegidas) {
            out.push(
              `      FOTO ${f.tipoGrupo} «${f.nombreGrupo}» ${f.nombreOpcion} grupo=${sim(f.grupoId)} opcion=${sim(f.opcionId)} version=${sim(f.versionDeOpcionId)} x${f.cantidad} orden=${f.orden} modo=${f.modoPrecio ?? "-"} dif=${f.tipoDeDiferencia ?? "-"} porcentaje=${dinero(f.porcentaje)} importe=${dinero(f.importeUnitario)} precioDeSucursal=${f.precioDeSucursal} factor=${f.factorEscala === null ? "-" : f.factorEscala.toString()}`
            );
          }
        }
      }
      if (nuevas.some((i) => i.lineaPadreId !== null && !padres.some((p) => p.id === i.lineaPadreId))) out.push("  (ADICIONAL HUÉRFANO: colgado de una línea de otra llamada)");
      return out.length > 0 ? out : ["  (no se escribió ninguna línea)"];
    }

    const venta = async (titulo: string, item: ItemParaAgregar) => {
      const r = await agregarItems(cuenta.id, [item]);
      lineas.push(`### ${titulo}`, `  resultado: ok=${r.ok} mensaje=${JSON.stringify(r.mensaje)}`, ...(await lineasNuevas()), "");
    };

    lineas.push("## COBRO (agregarItems, la acción real del POS)", "");
    await venta("Pizza muzzarella", { productoId: P.pizzas!, cantidad: 1, opciones: [u("pizzaMuzzarella")] });
    await venta("Pizza de verduras asadas", { productoId: P.pizzas!, cantidad: 1, opciones: [u("pizzaVerduras")] });
    await venta("Pizza fugazzeta", { productoId: P.pizzas!, cantidad: 1, opciones: [u("pizzaFugazzeta")] });
    await venta("Pizza napolitana", { productoId: P.pizzas!, cantidad: 1, opciones: [u("pizzaNapolitana")] });
    await venta("Pizza con papas fritas", { productoId: P.pizzas!, cantidad: 1, opciones: [u("pizzaPapas")] });
    await venta("Pizza bomba, 2 unidades", { productoId: P.pizzas!, cantidad: 2, opciones: [u("pizzaBomba")] });
    await venta("Milanesa simple de carne", { productoId: P.milanesas!, cantidad: 1, opciones: [u("simple"), u("carne")] });
    await venta("Milanesa napolitana de pollo", { productoId: P.milanesas!, cantidad: 1, opciones: [u("napolitana"), u("pollo")] });
    await venta("Café chico solo", { productoId: P.cafe!, cantidad: 1, opciones: [u("chico"), u("solo")] });
    await venta("Café grande con leche", { productoId: P.cafe!, cantidad: 1, opciones: [u("grande"), u("conLeche")] });
    await venta("Café mediano sin preparación (la variante es opcional)", { productoId: P.cafe!, cantidad: 1, opciones: [u("mediano")] });
    await venta("Bife a la criolla con puré y un extra de papas", { productoId: P.bife!, cantidad: 1, opciones: [u("pure"), u("extraPapas")] });
    await venta("Bife a la criolla con ensalada, extra de papas y dos huevos fritos, 2 unidades", { productoId: P.bife!, cantidad: 2, opciones: [u("ensalada"), u("extraPapas"), u("huevo", 2)] });
    await venta("Gaseosa 500 cc", { productoId: P.gaseosa!, cantidad: 1 });
    await venta("Gaseosa 500 cc, 3 unidades", { productoId: P.gaseosa!, cantidad: 3 });
    await venta("Wok de verduras", { productoId: P.wok!, cantidad: 1 });

    lineas.push("## COBRO: el precio de lista que vio el mozo (precioDeListaEsperado)", "");
    await venta("Pizza muzzarella vista a 18.000 (el precio de hoy): se agrega", { productoId: P.pizzas!, cantidad: 1, opciones: [u("pizzaMuzzarella")], precioDeListaEsperado: 18000 });
    await venta("RECHAZO (PRECIO_CAMBIO): pizza muzzarella vista a 17.000", { productoId: P.pizzas!, cantidad: 1, opciones: [u("pizzaMuzzarella")], precioDeListaEsperado: 17000 });
    await venta("RECHAZO (PRECIO_CAMBIO): café grande con leche visto a 4.300 (sin la preparación)", { productoId: P.cafe!, cantidad: 1, opciones: [u("grande"), u("conLeche")], precioDeListaEsperado: 4300 });
    await venta("RECHAZO (PRECIO_CAMBIO): gaseosa (sin opciones) vista a 3.500", { productoId: P.gaseosa!, cantidad: 1, precioDeListaEsperado: 3500 });

    lineas.push("## COBRO: grupo obligatorio faltante", "");
    await venta("RECHAZO: bife a la criolla sin guarnición (INCLUIDA obligatoria)", { productoId: P.bife!, cantidad: 1, opciones: [u("extraPapas")] });
    await venta("RECHAZO: pizzas sin tipo (MEDIDA obligatoria)", { productoId: P.pizzas!, cantidad: 1 });
    await venta("RECHAZO: milanesa simple sin «Milanesas de» (VARIANTE obligatoria)", { productoId: P.milanesas!, cantidad: 1, opciones: [u("simple")] });

    // 3. PRECIO DE SUCURSAL: la grilla de la sucursal para el café mediano (4.200 en vez de 4.100), cobrada y mostrada.
    await sembrarPrecioDeSucursalDeTamano(s.sucursalId, P.cafe!, cat.opcion.mediano!, "4200.00");
    lineas.push("## PRECIO DE SUCURSAL: café mediano a 4.200 en la grilla de la sucursal (PrecioLocalDeOpcion)", "");
    await venta("Café mediano con lágrima (grilla de sucursal)", { productoId: P.cafe!, cantidad: 1, opciones: [u("mediano"), u("lagrima")] });
    lineas.push("### La carta pública del café con la grilla", ...textoDeCarta(await leerCarta(), "Café"), "");

    const texto = `${lineas.join("\n")}\n`;
    if (process.env.REGENERAR_COBRO_Y_CARTA === "1" || !existsSync(ARCHIVO)) writeFileSync(ARCHIVO, texto);
    expect(texto).toBe(readFileSync(ARCHIVO, "utf8").replace(/\r\n/g, "\n"));
  });
});
