import { describe, expect, it } from "vitest";
import { validarNombreGeneroCarta, validarNombreItemAgrupadoCarta } from "@/core/carta/validaciones";
import { validarNombreEnCarta } from "@/core/features/carta/contenido-producto.guard";
import { guardComandoCrearUnidad } from "@/core/features/catalogo/unidades.guard";
import { guardComandoCrearOActualizarGrupo } from "@/core/features/catalogo/insumos.guard";
import { guardComandoCrearGrupoDeOpciones, guardComandoEditarOpcionDeGrupo } from "@/core/features/catalogo/opciones-de-venta.guard";
import { guardComandoCrearSeccion } from "@/core/features/movimientos/secciones.guard";
import { guardComandoCrearMotivoMerma } from "@/core/features/movimientos/motivos.guard";
import { LARGO_MAXIMO_DE_LA_DESCRIPCION_EN_CARTA } from "@/core/opciones/public";

/**
 * E-1c (frente 3): lo visible en la carta y los nombres del catálogo que no son producto, insumo, categoría ni proveedor usan la ficha ELECCION de Pedernal (lista de permitidos CON `¿ ¡ ? ! % $`,
 * hasta 80, sin exigir letra). Dueño, 2026-11-16: «Sí, así (Recomendada)» y, para la descripción de una opción, «Bajar a 80» (`motor2-docs`, «Datos E-1c»). Cada punto de entrada tiene su violación
 * inyectada; el rechazo es el genérico de las fichas y el de «vacío» no cambia. Esta prueba es pura (sin base).
 */
const RECHAZO = "Esta acción no está permitida";
type Salida = { ok: true; valor: unknown } | { ok: false; mensaje: string };
const mensaje = (r: Salida): string | null => (r.ok ? null : r.mensaje);
const valorOk = (r: Salida): unknown => (r.ok ? r.valor : undefined);

const GRUPO = { tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1 };
const EDITAR = { opcionId: "o1", versionEsperada: 1, nombre: "Ensalada" };

/** Los puntos que validan un NOMBRE con ELECCION (80, obligatorio). */
const NOMBRES: ReadonlyArray<readonly [string, (t: string) => Salida, string]> = [
  ["ítem agrupado", (t) => validarNombreItemAgrupadoCarta(t), "El nombre del ítem agrupado no puede estar vacío."],
  ["género", (t) => validarNombreGeneroCarta(t), "El nombre del género no puede estar vacío."],
  ["unidad", (t) => guardComandoCrearUnidad({ nombre: t, magnitud: "CANTIDAD" }), "El nombre de la unidad no puede estar vacío."],
  ["grupo de insumos", (t) => guardComandoCrearOActualizarGrupo({ nombre: t, grupoPadreId: null }), "El nombre del grupo no puede estar vacío."],
  ["sección de depósito", (t) => guardComandoCrearSeccion({ nombre: t }), "El nombre del depósito no puede estar vacío."],
  ["motivo de merma", (t) => guardComandoCrearMotivoMerma({ nombre: t, descripcion: "" }), "El nombre del motivo no puede estar vacío."],
  ["nombre del grupo de opciones", (t) => guardComandoCrearGrupoDeOpciones({ ...GRUPO, nombre: t }), "El nombre del grupo no puede estar vacío."],
];

const MALOS: ReadonlyArray<readonly [string, string]> = [
  ["cirílico", "Центр"],
  ["ideogramas", "小林商事"],
  ["guion bajo", "Frutas_secas"],
  ["emoji", "Pizza 🍕"],
  ["menor y mayor", "<b>hola</b>"],
  ["invisible de ancho cero", "Piz​za"],
  ["empieza con guion", "-Pizza"],
  ["empieza con más", "+Pizza"],
  ["arroba", "a@b"],
  ["igual (fórmula de planilla)", "=1+1"],
];

describe.each(NOMBRES)("nombre de %s con la ficha ELECCION", (_punto, validar, vacio) => {
  it.each(MALOS)("rechaza %s con el mensaje genérico", (_motivo, texto) => {
    expect(mensaje(validar(texto))).toBe(RECHAZO);
  });

  it.each(["¿Querés papas?", "Combo 2x1 50% $500", "¡Oferta!", "Pérez & Hijos (SRL)", "Ñandú 5ta."])("acepta «%s» (con los signos de catálogo)", (texto) => {
    expect(validar(texto).ok).toBe(true);
  });

  it("vacío o solo espacios: el mensaje de siempre", () => {
    expect(mensaje(validar(""))).toBe(vacio);
    expect(mensaje(validar("   "))).toBe(vacio);
  });

  it("80 entra y 81 no; devuelve el nombre canónico (recortado, NFC, espacios juntos)", () => {
    expect(validar("A".repeat(80)).ok).toBe(true);
    expect(mensaje(validar("A".repeat(81)))).toBe(RECHAZO);
    expect(valorOk(validar("  Café   con   leche "))).toSatisfy((v: unknown) => JSON.stringify(v).includes("Café con leche"));
  });
});

describe("«Nombre en la carta» del producto", () => {
  it.each(MALOS)("rechaza %s", (_motivo, texto) => {
    expect(validarNombreEnCarta(texto)).toMatchObject({ ok: false, mensaje: RECHAZO });
  });

  it("ausente queda ausente; null, vacío o solo espacios es «sin nombre en la carta»; espacios a los costados se avisan (sin cambios)", () => {
    expect(validarNombreEnCarta(undefined)).toEqual({ ok: true, valor: undefined });
    for (const v of [null, "", "   "]) expect(validarNombreEnCarta(v)).toEqual({ ok: true, valor: null });
    expect(validarNombreEnCarta(" Pizza")).toMatchObject({ ok: false, codigo: "formato" });
  });

  it("acepta los signos de catálogo, 80 entra y 81 no", () => {
    expect(validarNombreEnCarta("¿Querés papas? 50%")).toEqual({ ok: true, valor: "¿Querés papas? 50%" });
    expect(validarNombreEnCarta("A".repeat(80)).ok).toBe(true);
    expect(validarNombreEnCarta("A".repeat(81)).ok).toBe(false);
  });
});

describe("«Se lee en la carta como» (prefijo de un grupo) y descripción de una opción", () => {
  const prefijo = (t: unknown) => guardComandoCrearGrupoDeOpciones({ ...GRUPO, nombre: "Tamaño", prefijoEnCarta: t });
  const descripcion = (t: unknown) => guardComandoEditarOpcionDeGrupo({ ...EDITAR, descripcionEnCarta: t });

  it.each(MALOS.filter(([, t]) => [...t].length <= 20))("el prefijo rechaza %s", (_motivo, texto) => {
    expect(mensaje(prefijo(texto))).toBe(RECHAZO);
  });

  it.each(MALOS)("la descripción rechaza %s", (_motivo, texto) => {
    expect(mensaje(descripcion(texto))).toBe(RECHAZO);
  });

  it("el prefijo sigue en 20 y acepta los signos de catálogo", () => {
    expect(prefijo("A".repeat(20)).ok).toBe(true);
    expect(mensaje(prefijo("A".repeat(21)))).toMatch(/hasta 20 caracteres/);
    expect(prefijo("¿Con?").ok).toBe(true);
  });

  it("la descripción BAJA de 120 a 80: 80 entra, 81 y 120 se rechazan con el aviso de largo", () => {
    expect(LARGO_MAXIMO_DE_LA_DESCRIPCION_EN_CARTA).toBe(80);
    expect(descripcion("x".repeat(80)).ok).toBe(true);
    for (const largo of [81, 100, 120]) expect(mensaje(descripcion("x".repeat(largo)))).toBe("La descripción tiene hasta 80 caracteres: acortala.");
  });

  it("la descripción acepta tildes, comas, paréntesis y signos de catálogo", () => {
    for (const bueno of ["lechuga, tomate, cebolla", "Ñandú (a la parrilla) y más", "tomate 100% natural", "¿con huevo?"]) expect(descripcion(bueno).ok, bueno).toBe(true);
  });

  it("espacios a los costados, saltos de línea y no-texto se rechazan como antes", () => {
    for (const malo of [" lechuga", "lechuga ", "lechuga\ntomate", 5, {}]) expect(descripcion(malo as unknown).ok, JSON.stringify(malo)).toBe(false);
  });
});
