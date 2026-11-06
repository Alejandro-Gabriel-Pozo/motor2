import { describe, expect, it } from "vitest";
import { armarMenuCarta, nombreDeCarta, type EntradaArmarMenu, type ItemAgrupadoEntrada } from "@/core/carta/armar-menu";
import { vistaPreviaDeLaForma } from "@/core/carta/public";
import { guardComandoGuardarContenidoCartaProducto, LARGO_MAXIMO_DEL_NOMBRE_EN_CARTA } from "@/core/features/carta/contenido-producto.guard";
import { CANAL, FORMA, NOMBRE, NOMBRE_DE_CARTA, NOMBRE_INTERNO, TAMANO_DEL_PRODUCTO, nombreEsperado, type Combinacion } from "./nombre-en-carta.oraculo";

/**
 * «Nombre en la carta» (2026-11-04): la regla de resolución (`nombreEnCarta ?? nombre`), el guard del comando y el recorrido de TODAS las combinaciones contra el oráculo escrito a mano (aparte).
 */
const valorDe = (nombre: Combinacion["nombre"]): string | null => (nombre === "sin-nombre" ? null : nombre === "con-nombre" ? NOMBRE_DE_CARTA : "   ");

const contenido = (nombreEnCarta: string | null) => ({ descripcion: null, tags: [], especial: false, orden: 0, nombreEnCarta });

function entrada(c: Combinacion): EntradaArmarMenu {
  const agrupado: ItemAgrupadoEntrada[] =
    c.forma === "agrupado"
      ? [{ id: "ag1", nombre: "Platos del día", seccionCartaId: "sP", contenido: contenido(null), opciones: [{ productoId: "p1", nombre: NOMBRE_INTERNO, precioVenta: 1000, orden: 0 }] }]
      : [];
  return {
    sucursal: { id: "suc1", nombre: "Central" },
    generadoEn: new Date("2026-11-04T12:00:00.000Z"),
    secciones: [{ id: "sP", nombre: "Platos", titulo: null, descripcion: null, imagenUrl: null, orden: 1 }],
    productos: c.forma === "agrupado" ? [] : [{ id: "p1", nombre: NOMBRE_INTERNO, precioVenta: 1000, categoriaNombre: "Platos", seccionCartaId: "sP", contenido: contenido(valorDe(c.nombre)) }],
    agrupados: agrupado,
    preciosLocales: [],
    promos: [],
  };
}

/** Lo que muestra cada canal, con el código real. */
function nombreMostrado(c: Combinacion): string {
  // «Va a mostrar» describe un producto que todavía no está en la carta (sin contenido): la línea nombra al producto por su nombre interno.
  if (c.canal === "va-a-mostrar") return vistaPreviaDeLaForma(NOMBRE_INTERNO, { forma: "simple", aclaraciones: [] }).includes(`«${NOMBRE_INTERNO}»`) ? NOMBRE_INTERNO : NOMBRE_DE_CARTA;
  if (c.canal === "vista-previa") return c.forma === "agrupado" ? NOMBRE_INTERNO : nombreDeCarta({ nombre: NOMBRE_INTERNO }, { nombreEnCarta: valorDe(c.nombre) });
  // La carta pública y la impresa leen la MISMA carta armada.
  const items = armarMenuCarta(entrada(c)).carta.secciones.flatMap((s) => s.items);
  const item = items[0]!;
  return item.opciones ? item.opciones[0]!.nombre : item.nombre;
}

describe("nombreDeCarta: la regla de resolución", () => {
  it("usa el de la carta si hay uno con texto; si no, el del producto", () => {
    expect(nombreDeCarta({ nombre: "Milanesa" }, { nombreEnCarta: "La Napo" })).toBe("La Napo");
    expect(nombreDeCarta({ nombre: "Milanesa" }, { nombreEnCarta: null })).toBe("Milanesa");
    expect(nombreDeCarta({ nombre: "Milanesa" }, { nombreEnCarta: "  " })).toBe("Milanesa");
    expect(nombreDeCarta({ nombre: "Milanesa" }, {})).toBe("Milanesa");
    expect(nombreDeCarta({ nombre: "Milanesa" }, null)).toBe("Milanesa");
    expect(nombreDeCarta({ nombre: "Milanesa" }, undefined)).toBe("Milanesa");
  });
});

describe("oráculo: todas las combinaciones (nombre × canal × forma)", () => {
  const todas: Combinacion[] = NOMBRE.flatMap((nombre) => CANAL.flatMap((canal) => FORMA.map((forma) => ({ nombre, canal, forma }))));

  it("recorre el producto completo de las dimensiones", () => {
    expect(todas).toHaveLength(TAMANO_DEL_PRODUCTO);
  });

  it.each(todas.map((c) => [`${c.nombre} / ${c.canal} / ${c.forma}`, c] as const))("%s", (_nombre, c) => {
    expect(nombreMostrado(c)).toBe(nombreEsperado(c));
  });
});

describe("guard: «Nombre en la carta» del contenido", () => {
  const base = { visibleEnCarta: true, seccionCartaId: "s1", descripcion: null };
  const validar = (nombreEnCarta?: unknown) => guardComandoGuardarContenidoCartaProducto({ datos: { ...base, ...(nombreEnCarta === undefined ? {} : { nombreEnCarta }) } });

  it("sin la clave: no viaja (no se toca); null o en blanco: se borra; con texto: se guarda tal cual", () => {
    const sin = validar();
    expect(sin.ok && "nombreEnCarta" in sin.valor).toBe(false);
    for (const vacio of [null, "", "   "]) expect(validar(vacio), JSON.stringify(vacio)).toMatchObject({ ok: true, valor: { nombreEnCarta: null } });
    expect(validar("La Napo")).toMatchObject({ ok: true, valor: { nombreEnCarta: "La Napo" } });
  });

  it("rechaza lo que no es texto, los bordes con espacios, los saltos de línea y más de 80 caracteres; acepta 80", () => {
    for (const malo of [1, true, {}, [], " La Napo", "La Napo ", "La\nNapo", "La\rNapo"]) expect(validar(malo), JSON.stringify(malo)).toMatchObject({ ok: false });
    expect(validar("x".repeat(LARGO_MAXIMO_DEL_NOMBRE_EN_CARTA + 1))).toMatchObject({ ok: false });
    expect(validar("x".repeat(LARGO_MAXIMO_DEL_NOMBRE_EN_CARTA))).toMatchObject({ ok: true });
  });
});
