import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { sembrarSalon } from "../pos/salon-fixture";
import { sembrarCatalogoPrecioYCarta, type CatalogoPrecioYCarta } from "../setup/siembra-precio-y-carta";
import type { ComandoFijarAdmisionDeGrupo } from "../../src/core/features/catalogo/opciones-de-venta.schema";
import type { DiferenciaDePrecio, ModoDePrecioDeMedida } from "../../src/core/opciones/public";
import { fijarAdmisionDeGrupoEnProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/fijar-admision-de-grupo-en-producto";
import { vincularGrupoEnProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/vincular-grupo-en-producto";
import { agregarVersionDeOpcionCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/agregar-version-de-opcion";
import { cargarOpcionesDelProducto } from "../../src/server/consultas/catalogo/opciones-de-venta";

/**
 * Fase 4 de la ola «precio y carta», C5 (ADR-035): mientras un producto se vende por opción, los escritores de opciones no lo dejan sin su grupo de precio final ni le cargan porcentajes:
 *  - QUITAR su grupo de precio (`vincular-grupo-en-producto`) → `BASE_SIN_PRECIO_FINAL` (antes quitar no validaba nada y el producto se vendía suelto a su precio guardado); quitar otro grupo, sí;
 *  - en lo que admite (`fijar-admision-de-grupo-en-producto`): apagar la admisión del grupo de precio, pasarlo a DIFERENCIA o un porcentaje en una variante → `CONFIGURACION_INVALIDA` (dejar una
 *    opción ofrecida sin precio o apagarlas todas ya lo rechazaba la regla de siempre de una medida en ABSOLUTO: se fija que siga);
 *  - una versión en PORCENTAJE de una opción que la base ofrece sin su propia diferencia (`agregar-version-de-opcion`) → `CONFIGURACION_INVALIDA`;
 *  - el control de precio de lista de una base usa su precio de referencia: con el guardado en 0 una variante sin costo se admite y el producto SE VENDE (con DIRECTO y 0, hoy la admisión pasa —el
 *    control se saltea— pero el producto no se puede vender: se fija como caracterización).
 * Un producto DIRECTO sigue igual que antes en todos esos casos. Mutación: sacar el chequeo de `vincular-grupo-en-producto` → el primer caso da rojo.
 */
describe("C5: el invariante de la base en los escritores de opciones", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let cat: CatalogoPrecioYCarta;

  const actor = () => ({ usuarioId: s.admin.id, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId: s.sucursalId, ahora: new Date(), ...baseDeTest({ lectura: [s.sucursalId], escritura: [s.sucursalId] }) });
  const grupoDe = async (productoId: string, nombre: string) => (await prisma.grupoDeOpciones.findFirstOrThrow({ where: { nombre, productosQueLoAdmiten: { some: { productoId } } }, select: { id: true } })).id;
  const base = (productoId: string) => prismaAdmin.producto.update({ where: { id: productoId }, data: { modoDeVenta: "BASE_CONFIGURABLE" } });

  /** El comando que deja lo que el producto admite del grupo TAL COMO ESTÁ (con las versiones que vería la pantalla); se le cambia lo que haga falta. */
  async function comandoActual(productoId: string, grupoId: string): Promise<ComandoFijarAdmisionDeGrupo> {
    const g = await prisma.productoAdmiteGrupo.findFirstOrThrow({ where: { productoId, grupoId } });
    const filas = await prisma.productoAdmiteOpcion.findMany({ where: { productoId, opcion: { grupoId } }, orderBy: { id: "asc" } });
    const dif = (f: (typeof filas)[number]): DiferenciaDePrecio | null =>
      f.tipoDeDiferencia === "MONTO" ? { tipo: "MONTO", monto: Number(f.diferenciaPrecio) } : f.tipoDeDiferencia === "PORCENTAJE" ? { tipo: "PORCENTAJE", porcentaje: Number(f.porcentaje) } : null;
    return {
      productoId,
      grupoId,
      versionEsperada: g.version,
      orden: g.orden,
      cantidadMinima: g.cantidadMinima,
      cantidadMaxima: g.cantidadMaxima,
      modoPrecio: g.modoPrecio as ModoDePrecioDeMedida | null,
      activo: g.activo,
      opciones: filas.map((f) => ({ opcionId: f.opcionId, versionEsperada: f.version, cantidadMaxima: f.cantidadMaxima, precioAbsoluto: f.precioAbsoluto === null ? null : Number(f.precioAbsoluto), diferencia: dif(f), activo: f.activo })),
    };
  }
  const fijar = (c: ComandoFijarAdmisionDeGrupo) => fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), c);
  const quitar = (productoId: string, grupoId: string) => vincularGrupoEnProductoCasoDeUso(actor(), { productoId, grupoId, vinculado: false });
  const huella = () => prismaAdmin.$queryRaw`SELECT (SELECT json_agg(t ORDER BY id) FROM "ProductoAdmiteGrupo" t) AS g, (SELECT json_agg(t ORDER BY id) FROM "ProductoAdmiteOpcion" t) AS o, (SELECT count(*) FROM "RegistroAuditoria") AS a`;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    cat = await sembrarCatalogoPrecioYCarta(s);
  });

  it("QUITAR el grupo de precio de una base se rechaza (BASE_SIN_PRECIO_FINAL) y no escribe nada; otro grupo, o el de un producto directo, se quita como siempre", async () => {
    const tipos = await grupoDe(cat.producto.pizzas!, "Tipos de Pizza");
    await base(cat.producto.pizzas!);
    const antes = await huella();
    const r = await quitar(cat.producto.pizzas!, tipos);
    expect(r).toMatchObject({ ok: false, codigo: "BASE_SIN_PRECIO_FINAL" });
    expect(!r.ok && r.mensaje).toBe("«Tipos de Pizza» tiene el precio final de cada opción de «Pizzas», que se vende por opción: sin él se vendería a un precio que no se cobra. Cambiá primero «¿Cómo se vende?» a Directo.");
    expect(await huella()).toEqual(antes);
    // La variante de una base sí se quita.
    await base(cat.producto.milanesas!);
    expect(await quitar(cat.producto.milanesas!, await grupoDe(cat.producto.milanesas!, "Milanesas de"))).toMatchObject({ ok: true });
    // Directo: lo de siempre.
    expect(await quitar(cat.producto.cafe!, await grupoDe(cat.producto.cafe!, "Tamaño del Café"))).toMatchObject({ ok: true });
  });

  it("en lo que admite una base: apagar el grupo de precio, pasarlo a DIFERENCIA, dejar una opción ofrecida sin precio o apagarlas todas → CONFIGURACION_INVALIDA, sin escribir", async () => {
    const tipos = await grupoDe(cat.producto.pizzas!, "Tipos de Pizza");
    await base(cat.producto.pizzas!);
    const antes = await huella();
    const actual = await comandoActual(cat.producto.pizzas!, tipos);
    const casos: [string, ComandoFijarAdmisionDeGrupo, RegExp][] = [
      ["apagar el grupo de precio", { ...actual, activo: false }, /^«Pizzas» se vende por opción\. Falta el precio final de cada opción: /],
      ["pasarlo a DIFERENCIA", { ...actual, modoPrecio: "DIFERENCIA", opciones: actual.opciones.map((o) => ({ ...o, precioAbsoluto: null, diferencia: { tipo: "MONTO", monto: 0 } })) }, /Falta el precio final de cada opción/],
      // Estos dos ya los rechazaba la regla de siempre de la admisión (una medida en ABSOLUTO exige el precio de cada opción activa y su mínimo alcanzable): se fija que sigan rechazados.
      ["una opción sin precio", { ...actual, opciones: actual.opciones.map((o, i) => (i === 0 ? { ...o, precioAbsoluto: null } : o)) }, /necesita un precio propio de 0,01 o más/],
      ["apagar todas las opciones", { ...actual, opciones: actual.opciones.map((o) => ({ ...o, activo: false })) }, /no se llega|no tiene ninguna opción admitida/],
    ];
    for (const [titulo, comando, mensaje] of casos) {
      const r = await fijar(comando);
      expect(r, titulo).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
      expect(!r.ok && r.mensaje, titulo).toMatch(mensaje);
    }
    expect(await huella()).toEqual(antes);
    // Cambiar un precio final (sigue siendo de 0,01 o más) se puede.
    expect(await fijar({ ...actual, opciones: actual.opciones.map((o, i) => (i === 0 ? { ...o, precioAbsoluto: 18500 } : o)) })).toMatchObject({ ok: true });
    // Y en un producto directo, apagar su grupo de medida se puede como siempre.
    const tamano = await grupoDe(cat.producto.cafe!, "Tamaño del Café");
    expect(await fijar({ ...(await comandoActual(cat.producto.cafe!, tamano)), activo: false })).toMatchObject({ ok: true });
  });

  it("un PORCENTAJE en la variante de una base se rechaza (en la fila del producto o como versión de la opción); en un producto directo, no", async () => {
    const milanesasDe = await grupoDe(cat.producto.milanesas!, "Milanesas de");
    await base(cat.producto.milanesas!);
    const actual = await comandoActual(cat.producto.milanesas!, milanesasDe);
    const conPorcentaje = { ...actual, opciones: actual.opciones.map((o) => (o.opcionId === cat.opcion.pollo ? { ...o, diferencia: { tipo: "PORCENTAJE" as const, porcentaje: 10 } } : o)) };
    const r = await fijar(conPorcentaje);
    expect(r).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
    expect(!r.ok && r.mensaje).toMatch(/^«Milanesas» se vende por opción\. «Pollo» de «Milanesas de» tiene una diferencia en porcentaje/);
    // La versión de la opción en porcentaje: «Pollo» lo ofrece la base sin diferencia propia.
    const v = await agregarVersionDeOpcionCasoDeUso(actor(), { opcionId: cat.opcion.pollo!, numeroEsperado: 1, version: { diferencia: { tipo: "PORCENTAJE", porcentaje: 5 }, factorEscala: null, consumos: [] } });
    expect(v).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
    expect(!v.ok && v.mensaje).toMatch(/^«Pollo» la ofrece «Milanesas», que se vende por opción/);
    expect(await prisma.versionDeOpcion.count({ where: { opcionId: cat.opcion.pollo! } })).toBe(1);
    // Un monto, sí.
    expect(await agregarVersionDeOpcionCasoDeUso(actor(), { opcionId: cat.opcion.pollo!, numeroEsperado: 1, version: { diferencia: { tipo: "MONTO", monto: 500 }, factorEscala: null, consumos: [] } })).toMatchObject({ ok: true });
    // Directo otra vez: el porcentaje se acepta como siempre.
    await prismaAdmin.producto.update({ where: { id: cat.producto.milanesas! }, data: { modoDeVenta: "DIRECTO" } });
    expect(await fijar(await comandoActual(cat.producto.milanesas!, milanesasDe).then((c) => ({ ...c, opciones: c.opciones.map((o) => (o.opcionId === cat.opcion.pollo ? { ...o, diferencia: { tipo: "PORCENTAJE" as const, porcentaje: 10 } } : o)) })))).toMatchObject({ ok: true });
  });

  it("el control de precio de lista de una base usa su referencia: con el guardado en 0 la variante sin costo se admite y el producto se vende; directo en 0, hoy no (caracterización)", async () => {
    const milanesasDe = await grupoDe(cat.producto.milanesas!, "Milanesas de");
    await prismaAdmin.producto.update({ where: { id: cat.producto.milanesas! }, data: { precioVenta: 0 } });
    const vista = async () => (await cargarOpcionesDelProducto(actor().db, cat.producto.milanesas!, s.sucursalId))!.vistaPrevia;
    // HOY (directo en 0): la admisión pasa (el control se saltea con precio 0) pero el producto no se puede vender: la variante sin costo se cae.
    const actual = await comandoActual(cat.producto.milanesas!, milanesasDe);
    expect(await fijar({ ...actual, opciones: actual.opciones.map((o) => ({ ...o, cantidadMaxima: 1 })) })).toMatchObject({ ok: true });
    expect(await vista()).toMatchObject({ vendible: false, desde: null });
    // Como base: el mismo guardado en 0, se vende desde 20.000 y la admisión se controla contra 20.000.
    await base(cat.producto.milanesas!);
    expect(await vista()).toMatchObject({ vendible: true, desde: 20000 });
    expect(await fijar(await comandoActual(cat.producto.milanesas!, milanesasDe))).toMatchObject({ ok: true });
    // Una diferencia que deja la lista por debajo de 0,01 contra la referencia (20.000) se rechaza: el control sí corre.
    const c = await comandoActual(cat.producto.milanesas!, milanesasDe);
    const r = await fijar({ ...c, opciones: c.opciones.map((o) => (o.opcionId === cat.opcion.carne ? { ...o, diferencia: { tipo: "MONTO", monto: -20000 } } : o)) });
    expect(r).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
    expect(!r.ok && r.mensaje).toMatch(/^Con «Carne» este producto no se puede vender/);
  });
});
