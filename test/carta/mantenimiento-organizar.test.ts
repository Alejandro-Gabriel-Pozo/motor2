import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { coincideConLaBusqueda, ordenAlFinalDeLaSeccion, organizarCartaParaMantener, vistaPreviaDeOpciones, type ProductoParaMantener, type SeccionParaMantener } from "../../src/core/carta/mantenimiento";
import { guardComandoFijarDisponibilidadDeHoy, guardComandoQuitarProductoDeLaCarta } from "../../src/core/features/carta/mantenimiento.guard";
import { MENSAJE_SUCURSAL_CAMBIADA } from "../../src/core/features/catalogo/opciones-por-sucursal.guard";

/**
 * CARTA-MANT F1 (fila O.480 de docs/pureza-integracion.md): en qué lista de la pantalla de la carta cae cada producto de venta. La regla del dueño: sin contenido de carta y disponible acá es
 * «Fuera de carta (POS y menú del día)», NO un faltante; el ancla de un adicional no figura en ninguna lista.
 */
const SECCIONES: SeccionParaMantener[] = [
  { id: "s-ent", nombre: "Entradas", orden: 1, activa: true },
  { id: "s-pla", nombre: "Platos", orden: 2, activa: true },
  { id: "s-apa", nombre: "Apagada", orden: 3, activa: false },
];

const producto = (id: string, cambios: Partial<ProductoParaMantener> = {}): ProductoParaMantener => ({
  id,
  nombre: id,
  precioAca: 1000,
  precioDeLista: 1000,
  conPrecioLocal: false,
  disponibleAca: true,
  esAnclaDeAdicional: false,
  agrupadoEn: null,
  contenido: null,
  ...cambios,
});
const enSeccion = (seccionCartaId: string | null, orden = 0, visibleEnCarta = true) => ({ contenido: { visibleEnCarta, seccionCartaId, orden } });

describe("organizarCartaParaMantener", () => {
  it("un PV disponible sin contenido es «Fuera de carta»; el ancla de un adicional no aparece en NINGUNA lista", () => {
    const r = organizarCartaParaMantener(SECCIONES, [
      producto("Milanesa del día"),
      producto("Adicional - papas fritas y huevo frito", { esAnclaDeAdicional: true }),
      producto("Ancla con contenido", { esAnclaDeAdicional: true, ...enSeccion("s-ent") }),
      producto("Ancla agrupada", { esAnclaDeAdicional: true, agrupadoEn: "Cervezas" }),
    ]);
    expect(r.fueraDeCarta.map((p) => p.id)).toEqual(["Milanesa del día"]);
    const todos = [...r.secciones.flatMap((s) => s.productos), ...r.sinSeccion, ...r.enAgrupados, ...r.fueraDeCarta].map((p) => p.id);
    expect(todos).toEqual(["Milanesa del día"]);
  });

  it("sin contenido y NO disponible acá no figura (no se ofrece en esta sucursal); con contenido y no disponible sigue en su sección (sin stock hoy no es fuera de carta)", () => {
    const r = organizarCartaParaMantener(SECCIONES, [producto("Otra sucursal", { disponibleAca: false }), producto("Agotado", { disponibleAca: false, ...enSeccion("s-pla") })]);
    expect(r.fueraDeCarta).toEqual([]);
    expect(r.secciones.find((s) => s.id === "s-pla")!.productos.map((p) => p.id)).toEqual(["Agotado"]);
  });

  it("cada producto con contenido va a su sección (también una apagada), ordenado por orden y nombre; sin sección o con una que no existe, a «sin sección»", () => {
    const r = organizarCartaParaMantener(SECCIONES, [
      producto("Flan", enSeccion("s-pla", 2)),
      producto("Bife", enSeccion("s-pla", 1)),
      producto("Asado", enSeccion("s-pla", 1)),
      producto("Oculto sin sección", enSeccion(null, 0, false)),
      producto("Sección borrada", enSeccion("s-no-existe")),
      producto("En apagada", enSeccion("s-apa")),
    ]);
    expect(r.secciones.map((s) => [s.id, s.productos.map((p) => p.id)])).toEqual([
      ["s-ent", []],
      ["s-pla", ["Asado", "Bife", "Flan"]],
      ["s-apa", ["En apagada"]],
    ]);
    expect(r.sinSeccion.map((p) => p.id)).toEqual(["Oculto sin sección", "Sección borrada"]);
  });

  it("un producto dentro de un ítem agrupado va a «en agrupados» aunque tenga contenido propio (no se usa mientras esté agrupado)", () => {
    const r = organizarCartaParaMantener(SECCIONES, [producto("Quilmes", { agrupadoEn: "Cervezas", ...enSeccion("s-ent") }), producto("Stella", { agrupadoEn: "Cervezas" })]);
    expect(r.enAgrupados.map((p) => p.id)).toEqual(["Quilmes", "Stella"]);
    expect(r.secciones.flatMap((s) => s.productos)).toEqual([]);
    expect(r.fueraDeCarta).toEqual([]);
  });

  it("«Fuera de carta» va por nombre en castellano (acentos y mayúsculas como en un diccionario)", () => {
    const r = organizarCartaParaMantener(SECCIONES, [producto("Ñoquis"), producto("árbol"), producto("Zapallo"), producto("Milanesa")]);
    expect(r.fueraDeCarta.map((p) => p.id)).toEqual(["árbol", "Milanesa", "Ñoquis", "Zapallo"]);
  });

  it("propiedad: cada producto que no es ancla cae en a lo sumo UNA lista, y en ninguna solo si no tiene contenido, no está agrupado y no está disponible", () => {
    const arbProducto = fc.record({
      id: fc.uuid(),
      disponibleAca: fc.boolean(),
      esAnclaDeAdicional: fc.boolean(),
      agrupado: fc.boolean(),
      contenido: fc.option(fc.record({ visibleEnCarta: fc.boolean(), seccion: fc.constantFrom("s-ent", "s-pla", "s-apa", "s-no-existe", null), orden: fc.integer({ min: -5, max: 5 }) }), { nil: null }),
    });
    fc.assert(
      fc.property(fc.uniqueArray(arbProducto, { selector: (p) => p.id, maxLength: 30 }), (crudos) => {
        const productos = crudos.map((c) =>
          producto(c.id, { disponibleAca: c.disponibleAca, esAnclaDeAdicional: c.esAnclaDeAdicional, agrupadoEn: c.agrupado ? "Grupo" : null, contenido: c.contenido && { visibleEnCarta: c.contenido.visibleEnCarta, seccionCartaId: c.contenido.seccion, orden: c.contenido.orden } })
        );
        const r = organizarCartaParaMantener(SECCIONES, productos);
        const listas = [...r.secciones.map((s) => s.productos), r.sinSeccion, r.enAgrupados, r.fueraDeCarta];
        for (const p of productos) {
          const veces = listas.filter((l) => l.some((x) => x.id === p.id)).length;
          const esperado = p.esAnclaDeAdicional || (p.agrupadoEn === null && p.contenido === null && !p.disponibleAca) ? 0 : 1;
          expect(veces, p.id).toBe(esperado);
        }
        expect(r.fueraDeCarta.every((p) => p.contenido === null && p.disponibleAca && !p.esAnclaDeAdicional && p.agrupadoEn === null)).toBe(true);
      })
    );
  });
});

describe("coincideConLaBusqueda", () => {
  it("sin acentos ni mayúsculas, todas las palabras en cualquier orden; vacía coincide con todo", () => {
    expect(coincideConLaBusqueda("Milanesa NAPOLITANA", "napolitana mila")).toBe(true);
    expect(coincideConLaBusqueda("Jamón crudo", "jamon")).toBe(true);
    expect(coincideConLaBusqueda("Adicional - papas fritas", "PAPAS")).toBe(true);
    expect(coincideConLaBusqueda("Flan", "budín")).toBe(false);
    expect(coincideConLaBusqueda("Flan", "  ")).toBe(true);
  });
});

describe("ordenAlFinalDeLaSeccion", () => {
  it("uno más que el mayor (0 si está vacía), nunca negativo ni por encima del tope de validarOrdenCarta", () => {
    expect(ordenAlFinalDeLaSeccion([])).toBe(0);
    expect(ordenAlFinalDeLaSeccion([3, 1, 7])).toBe(8);
    expect(ordenAlFinalDeLaSeccion([-4, -2])).toBe(1);
    expect(ordenAlFinalDeLaSeccion([100_000])).toBe(100_000);
  });
});

describe("vistaPreviaDeOpciones («Va a mostrar: …» de «Agregar a la carta»)", () => {
  it("sin grupos, «Sin opciones.»; sin poder pedirse hoy, el aviso (no bloquea); si no, tamaños con precio, recargos con signo y las opciones sin costo", () => {
    expect(vistaPreviaDeOpciones(false, null)).toBe("Sin opciones.");
    expect(vistaPreviaDeOpciones(true, null)).toMatch(/^Ojo: hoy no se puede pedir/);
    expect(
      vistaPreviaDeOpciones(true, {
        grupos: [
          { nombre: "Tamaño", opciones: [{ nombre: "Chica", precio: 9000 }, { nombre: "Grande", precio: 10500 }] },
          { nombre: "Extras", opciones: [{ nombre: "Huevo", recargo: 800 }, { nombre: "Sin pan", recargo: -300 }] },
        ],
        sinCosto: [{ grupo: "Guarnición", opciones: ["Papas fritas", "Puré"] }],
      })
    ).toBe("Va a mostrar: Tamaño: Chica $9.000, Grande $10.500 · Extras: Huevo +$800, Sin pan −$300 · Guarnición: Papas fritas, Puré.");
    expect(vistaPreviaDeOpciones(true, { grupos: [], sinCosto: [] })).toBe("Sin opciones para elegir (las que tiene no cambian nada en la carta).");
  });
});

describe("guards de «Hoy» y «Quitar de la carta»", () => {
  const activa = "s1";
  it("Hoy: primero el eco; después la lista (de 1 a 200, sin repetidos) y cada cambio (id y booleano)", () => {
    expect(guardComandoFijarDisponibilidadDeHoy({ sucursalId: "otra", sucursalActivaId: activa, cambios: [{ productoId: "p", disponible: true }] })).toMatchObject({ ok: false, mensaje: MENSAJE_SUCURSAL_CAMBIADA });
    expect(guardComandoFijarDisponibilidadDeHoy({ sucursalId: activa, sucursalActivaId: activa, cambios: [] }).ok).toBe(false);
    expect(guardComandoFijarDisponibilidadDeHoy({ sucursalId: activa, sucursalActivaId: activa, cambios: "x" }).ok).toBe(false);
    expect(guardComandoFijarDisponibilidadDeHoy({ sucursalId: activa, sucursalActivaId: activa, cambios: Array.from({ length: 201 }, (_, i) => ({ productoId: `p${i}`, disponible: true })) }).ok).toBe(false);
    expect(guardComandoFijarDisponibilidadDeHoy({ sucursalId: activa, sucursalActivaId: activa, cambios: [{ productoId: "p", disponible: 1 }] }).ok).toBe(false);
    expect(guardComandoFijarDisponibilidadDeHoy({ sucursalId: activa, sucursalActivaId: activa, cambios: [{ productoId: "p", disponible: true }, { productoId: "p", disponible: false }] }).ok).toBe(false);
    expect(guardComandoFijarDisponibilidadDeHoy({ sucursalId: activa, sucursalActivaId: activa, cambios: [null] }).ok).toBe(false);
    expect(guardComandoFijarDisponibilidadDeHoy({ sucursalId: activa, sucursalActivaId: activa, cambios: [{ productoId: "p", disponible: false }, { productoId: "q", disponible: true }] })).toEqual({
      ok: true,
      valor: { cambios: [{ productoId: "p", disponible: false }, { productoId: "q", disponible: true }] },
    });
  });

  it("Quitar: el eco, el producto y `confirmado` solo si es exactamente `true`", () => {
    expect(guardComandoQuitarProductoDeLaCarta({ sucursalId: "otra", sucursalActivaId: activa, productoId: "p" }).ok).toBe(false);
    expect(guardComandoQuitarProductoDeLaCarta({ sucursalId: activa, sucursalActivaId: activa, productoId: 3 }).ok).toBe(false);
    expect(guardComandoQuitarProductoDeLaCarta({ sucursalId: activa, sucursalActivaId: activa, productoId: "p", confirmado: "true" })).toEqual({ ok: true, valor: { productoId: "p", confirmado: false } });
    expect(guardComandoQuitarProductoDeLaCarta({ sucursalId: activa, sucursalActivaId: activa, productoId: "p", confirmado: true })).toEqual({ ok: true, valor: { productoId: "p", confirmado: true } });
  });
});
