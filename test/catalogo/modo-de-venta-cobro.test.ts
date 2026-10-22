import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));
// La carta pública se cachea con `unstable_cache` (necesita el caché de Next): acá corre directo, como en la caracterización de precio y carta.
vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), unstable_cache: (fn: () => unknown) => fn }));

import type { ItemParaAgregar } from "../../src/core/features/cuentas/cuenta-pedido.schema";
import { baseDeTest, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";
import { sembrarCatalogoPrecioYCarta, type CatalogoPrecioYCarta } from "../setup/siembra-precio-y-carta";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { agregarItems } from "../../src/server/actions/pos/cuenta-pedido";
import { cartaPublica, empresaCartaPublica } from "../../src/server/carta-publica/sin-sesion";
import { cargarCartaParaMantener } from "../../src/server/consultas/carta/mantenimiento";
import { actualizarProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/actualizar-producto";
import { guardComandoDatosDeProducto } from "../../src/core/features/catalogo/productos.guard";

/**
 * Fase 4 de la ola «precio y carta», C4 (ADR-035): marcar Pizzas y Milanesas como «se venden por opción» NO cambia lo que se cobra ni lo que muestra la carta, sobre el catálogo de referencia
 * de producción (el precio guardado repite la opción más barata). Y tampoco con el guardado en 0: la base no lo usa. Además, cambiar el modo con ventas previas NO toca las fotos congeladas de esas
 * ventas (`CuentaItem` y `OpcionElegidaEnLinea`).
 *
 * Se compara, para cada venta representativa de Pizzas y Milanesas (la acción real del POS, `agregarItems`), el precio unitario, el de carta y el importe de cada opción de la foto, y la carta pública
 * entera, ANTES y DESPUÉS de marcarlas base (y después de poner el guardado en 0 por SQL). Es la prueba integrada de lo que la caracterización de la Fase 0 congela (que no se mueve).
 */
describe("C4: una base cobra y se muestra igual que antes, aunque su precio guardado cambie", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let cat: CatalogoPrecioYCarta;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    cat = await sembrarCatalogoPrecioYCarta(s);
    await entrarComo(s.admin);
  });

  const actor = () => ({ usuarioId: s.admin.id, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId: s.sucursalId, ahora: new Date(), ...baseDeTest({ lectura: [s.sucursalId], escritura: [s.sucursalId] }) });
  async function marcarBase(productoId: string) {
    const p = await prisma.producto.findUniqueOrThrow({ where: { id: productoId } });
    const datos = { nombre: p.nombre, tipo: p.tipo, unidadStockId: p.unidadStockId, factorConversion: Number(p.factorConversion), modoDeVenta: "BASE_CONFIGURABLE" as const };
    const r = await actualizarProductoCasoDeUso(actor(), { productoId, datos, puerta: guardComandoDatosDeProducto({ datos }), puedeGestionarConsignacion: true, puedeEditarCamposSensibles: true });
    expect(r, p.nombre).toMatchObject({ ok: true });
  }

  const u = (clave: string) => ({ opcionId: cat.opcion[clave]!, cantidad: 1, versionDeOpcionId: cat.version[clave]! });
  const ventas = (): [string, ItemParaAgregar][] => [
    ["Pizza muzzarella", { productoId: cat.producto.pizzas!, cantidad: 1, opciones: [u("pizzaMuzzarella")] }],
    ["Pizza de verduras asadas", { productoId: cat.producto.pizzas!, cantidad: 1, opciones: [u("pizzaVerduras")] }],
    ["Pizza bomba x2", { productoId: cat.producto.pizzas!, cantidad: 2, opciones: [u("pizzaBomba")] }],
    ["Pizza muzzarella vista a 18.000", { productoId: cat.producto.pizzas!, cantidad: 1, opciones: [u("pizzaMuzzarella")], precioDeListaEsperado: 18000 }],
    ["Milanesa simple de carne", { productoId: cat.producto.milanesas!, cantidad: 1, opciones: [u("simple"), u("carne")] }],
    ["Milanesa napolitana de pollo", { productoId: cat.producto.milanesas!, cantidad: 1, opciones: [u("napolitana"), u("pollo")] }],
  ];

  /** Cada venta en su propia cuenta, de una mesa nueva (así la línea es solo de esa venta): lo que se cobró y la foto, sin ids. */
  let mesas = 100;
  async function cobrar(): Promise<string[]> {
    const out: string[] = [];
    for (const [titulo, item] of ventas()) {
      const mesa = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: mesas++ } });
      const cuenta = await sembrarCuenta(mesa.id, s.admin.id);
      const r = await agregarItems(cuenta.id, [item]);
      const lineas = await prismaAdmin.cuentaItem.findMany({
        where: { empresaId: EMPRESA_POR_DEFECTO_ID, cuentaId: cuenta.id },
        select: { cantidad: true, precioUnitario: true, precioCartaUnitario: true, opcionesElegidas: { orderBy: { orden: "asc" }, select: { nombreGrupo: true, nombreOpcion: true, modoPrecio: true, importeUnitario: true } } },
      });
      out.push(`${titulo}: ok=${r.ok} ${lineas.map((l) => `x${l.cantidad} ${l.precioUnitario.toFixed(2)} carta=${l.precioCartaUnitario?.toFixed(2) ?? "-"} [${l.opcionesElegidas.map((f) => `${f.nombreGrupo}/${f.nombreOpcion} ${f.modoPrecio ?? "-"} ${f.importeUnitario.toFixed(2)}`).join("; ")}]`).join(" | ")}`);
    }
    return out;
  }
  async function secciones() {
    const empresa = await empresaCartaPublica("principal");
    const entregada = await cartaPublica(empresa!, cat.slug, AHORA_DE_LA_CORRIDA);
    return entregada!.carta.secciones;
  }
  async function carta(): Promise<string> {
    return JSON.stringify(await secciones());
  }
  /**
   * Lo que la carta DICE y cobra (nombres, precios, opciones), sin la forma con que se lee. Desde la Fase 5 (DEC-11) una base se lee distinto a propósito (oculta, sin encabezado, en lista) y
   * `presentacion` y `tandas` son esa lectura: lo que no puede cambiar nunca al marcar base son los precios.
   */
  async function cartaSinLaForma(): Promise<string> {
    const sinForma = (await secciones()).map((sc) => ({ ...sc, tandas: undefined, items: sc.items.map((item) => ({ ...item, presentacion: undefined })) }));
    return JSON.stringify(sinForma);
  }
  const formaDe = async (nombre: string) => (await secciones()).flatMap((sc) => sc.items).find((i) => i.nombre === nombre)?.presentacion;

  it("base con su precio guardado: el cobro y la carta son idénticos a los de directo; con el guardado en 0, también", async () => {
    const cobroDirecto = await cobrar();
    const cartaDirecto = await cartaSinLaForma();
    expect(cobroDirecto.every((l) => l.includes("ok=true")), cobroDirecto.join("\n")).toBe(true);
    expect(cobroDirecto[0]).toContain("18000.00");

    await marcarBase(cat.producto.pizzas!);
    await marcarBase(cat.producto.milanesas!);
    expect(await cobrar(), "marcarlas base no cambia el cobro").toEqual(cobroDirecto);
    expect(await cartaSinLaForma(), "ni los precios ni las opciones de la carta pública").toEqual(cartaDirecto);
    // La forma sí cambia, por diseño (DEC-11): la base de un eje sale oculta (sin encabezado) y la de dos ejes pierde las columnas compartidas, con las mismas filas y los mismos precios.
    expect(await formaDe("Pizzas"), "Pizzas base: lista oculta").toMatchObject({ forma: "lista", encabezado: false });
    expect(await formaDe("Milanesas"), "Milanesas base: lista con los mismos precios").toMatchObject({ forma: "lista", encabezado: false, filas: [{ rotulo: "Simple", precio: 20000 }, { rotulo: "Napolitana", precio: 25000 }] });

    // El guardado ya no se usa: ponerlo en 0 (por SQL, como dueño; la pantalla no lo deja) no cambia nada.
    await prismaAdmin.producto.updateMany({ where: { id: { in: [cat.producto.pizzas!, cat.producto.milanesas!] } }, data: { precioVenta: 0 } });
    expect(await cobrar(), "con el guardado en 0, el cobro es el mismo").toEqual(cobroDirecto);
    expect(await cartaSinLaForma(), "y la carta también").toEqual(cartaDirecto);
  });

  it("cambiar el modo con ventas previas no toca las fotos congeladas (CuentaItem y OpcionElegidaEnLinea quedan byte a byte)", async () => {
    await cobrar();
    const fotos = async () => ({
      lineas: await prismaAdmin.cuentaItem.findMany({ where: { empresaId: EMPRESA_POR_DEFECTO_ID }, orderBy: { id: "asc" } }),
      opciones: await prismaAdmin.opcionElegidaEnLinea.findMany({ where: { empresaId: EMPRESA_POR_DEFECTO_ID }, orderBy: { id: "asc" } }),
    });
    const antes = await fotos();
    expect(antes.opciones.length).toBeGreaterThan(0);
    await marcarBase(cat.producto.pizzas!);
    await marcarBase(cat.producto.milanesas!);
    expect(await fotos()).toEqual(antes);
  });

  it("defensa (C6): una base sin línea configurada no se agrega suelta a la cuenta al precio guardado: sin admisiones, o con el grupo de precio apagado por SQL", async () => {
    const mesa = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 99 } });
    const cuenta = await sembrarCuenta(mesa.id, s.admin.id);
    const lineas = () => prismaAdmin.cuentaItem.count({ where: { empresaId: EMPRESA_POR_DEFECTO_ID, cuentaId: cuenta.id } });
    await prismaAdmin.producto.update({ where: { id: cat.producto.gaseosa! }, data: { modoDeVenta: "BASE_CONFIGURABLE" } });
    const r = await agregarItems(cuenta.id, [{ productoId: cat.producto.gaseosa!, cantidad: 1 }]);
    expect(r).toMatchObject({ ok: false, mensaje: "«Gaseosa 500 cc» se vende por opción: no tiene un precio propio que cobrar suelto. Cobralo desde las mesas/POS, eligiendo su opción." });
    expect(await lineas()).toBe(0);
    // Pizzas base con su grupo de precio apagado a mano: ni suelta ni con una opción.
    await marcarBase(cat.producto.pizzas!);
    await prismaAdmin.productoAdmiteGrupo.updateMany({ where: { productoId: cat.producto.pizzas! }, data: { activo: false } });
    expect(await agregarItems(cuenta.id, [{ productoId: cat.producto.pizzas!, cantidad: 1 }])).toMatchObject({ ok: false });
    expect(await agregarItems(cuenta.id, [{ productoId: cat.producto.pizzas!, cantidad: 1, opciones: [u("pizzaMuzzarella")] }])).toMatchObject({ ok: false });
    expect(await lineas()).toBe(0);
    // Directo, la gaseosa se agrega como siempre.
    await prismaAdmin.producto.update({ where: { id: cat.producto.gaseosa! }, data: { modoDeVenta: "DIRECTO" } });
    expect(await agregarItems(cuenta.id, [{ productoId: cat.producto.gaseosa!, cantidad: 1 }])).toMatchObject({ ok: true });
  });

  it("C7b: una base sin grupo vigente sale de la carta pública (no se muestra a su precio guardado); en Mantenimiento de la carta se lee «por opción»", async () => {
    await marcarBase(cat.producto.pizzas!);
    expect(await carta()).toContain("Pizzas");
    const mantener = async () => (await cargarCartaParaMantener(prisma, s.sucursalId)).secciones.flatMap((sc) => sc.productos).find((p) => p.id === cat.producto.pizzas!);
    expect(await mantener()).toMatchObject({ seVendePorOpcion: true });
    expect((await cargarCartaParaMantener(prisma, s.sucursalId)).secciones.flatMap((sc) => sc.productos).find((p) => p.id === cat.producto.gaseosa!)).not.toHaveProperty("seVendePorOpcion");
    await prismaAdmin.productoAdmiteGrupo.updateMany({ where: { productoId: cat.producto.pizzas! }, data: { activo: false } });
    const items = async () => (JSON.parse(await carta()) as { items: { nombre: string; precio?: number }[] }[]).flatMap((sc) => sc.items);
    expect((await items()).map((i) => i.nombre), "sin grupo, la base no sale").not.toContain("Pizzas");
    // Directo y sin grupos, sale a su precio, como siempre.
    await prismaAdmin.producto.update({ where: { id: cat.producto.pizzas! }, data: { modoDeVenta: "DIRECTO" } });
    expect((await items()).find((i) => i.nombre === "Pizzas")).toMatchObject({ precio: 18000 });
  });

  it("CARACTERIZACIÓN (la Fase 4 no lo cambia): un producto DIRECTO en $0 por error, sin grupos, HOY se agrega a la cuenta a $0", async () => {
    await prismaAdmin.producto.update({ where: { id: cat.producto.gaseosa! }, data: { precioVenta: 0 } });
    const mesa = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 98 } });
    const cuenta = await sembrarCuenta(mesa.id, s.admin.id);
    expect(await agregarItems(cuenta.id, [{ productoId: cat.producto.gaseosa!, cantidad: 1 }])).toMatchObject({ ok: true });
    const lineas = await prismaAdmin.cuentaItem.findMany({ where: { empresaId: EMPRESA_POR_DEFECTO_ID, cuentaId: cuenta.id }, select: { precioUnitario: true } });
    expect(lineas.map((l) => l.precioUnitario.toFixed(2)), "hoy: a $0 (decisión pendiente de la Fase 2 o del dueño; no es de esta fase)").toEqual(["0.00"]);
  });
});

