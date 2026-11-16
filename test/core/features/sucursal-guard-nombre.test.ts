import { describe, expect, it } from "vitest";
import { guardComandoCrearSucursal, guardComandoRenombrarSucursal } from "@/core/features/sucursales/sucursal.guard";

/**
 * El nombre de la sucursal con la ficha NOMBRE_DE_SUCURSAL (frente 3, E-1; dueño, 2026-11-16, «Sí, así (Recomendada)»): lista de permitidos de Pedernal SIN `¿ ¡ ? ! % $`, hasta 80, con
 * una letra, en el alta y en el renombrar. Cada rechazo tiene su violación inyectada; los mensajes de «vacío» son los de antes y el rechazo es el genérico de las fichas («Esta acción no está permitida»).
 */
const RECHAZO = "Esta acción no está permitida";
const EMAIL = "admin@ejemplo.com";

const alta = (nombre: string) => guardComandoCrearSucursal({ nombre, emailPrimerAdmin: EMAIL });
const renombrar = (nombre: string) => guardComandoRenombrarSucursal(nombre);

describe.each([
  ["alta", alta, "El nombre de la sucursal no puede estar vacío."],
  ["renombrar", renombrar, "El nombre no puede estar vacío."],
] as const)("nombre de sucursal (%s)", (_modo, guard, mensajeVacio) => {
  it.each(["Sucursal Centro", "Ñandú Sur", "La 5ta. SRL", "Local (norte) 2/3", "Pérez & Hijos"])("acepta «%s»", (nombre) => {
    expect(guard(nombre)).toMatchObject({ ok: true });
  });

  it("devuelve el nombre canónico: recortado, NFC y con los espacios repetidos colapsados", () => {
    const r = guard("  Café   Centro  ");
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect("nombre" in r.valor ? r.valor.nombre : "").toBe("Café Centro");
  });

  it("vacío o solo espacios: el mensaje de siempre y código «vacio»", () => {
    expect(guard("")).toEqual({ ok: false, codigo: "vacio", mensaje: mensajeVacio });
    expect(guard("   ")).toEqual({ ok: false, codigo: "vacio", mensaje: mensajeVacio });
  });

  it.each([
    ["alfabeto no latino (cirílico)", "Центр"],
    ["ideogramas", "小林商事"],
    ["guion bajo", "Sucursal_1"],
    ["emoji", "Centro 🍕"],
    ["signo solo de catálogo ¿", "¿Centro?"],
    ["signo solo de catálogo %", "Centro 50%"],
    ["signo solo de catálogo $", "Centro $"],
    ["menor y mayor", "<Centro>"],
    ["salto de línea adentro", "Cen\ntro"],
    ["carácter invisible de ancho cero", "Cen​tro"],
    ["empieza con guion", "-Centro"],
    ["empieza con más", "+Centro"],
    ["sin ninguna letra", "123"],
    ["81 caracteres", "A".repeat(81)],
  ])("rechaza %s", (_motivo, nombre) => {
    expect(guard(nombre)).toEqual({ ok: false, codigo: "formato", mensaje: RECHAZO });
  });

  it("acepta justo 80 caracteres", () => {
    expect(guard("A".repeat(80))).toMatchObject({ ok: true });
  });
});

describe("alta: el email del primer admin no cambia", () => {
  it("lo recorta y lo pasa a minúsculas; vacío se rechaza con su mensaje", () => {
    expect(guardComandoCrearSucursal({ nombre: "Centro", emailPrimerAdmin: "  ADMIN@Ejemplo.COM " })).toEqual({ ok: true, valor: { nombre: "Centro", email: "admin@ejemplo.com" } });
    expect(guardComandoCrearSucursal({ nombre: "Centro", emailPrimerAdmin: " " })).toEqual({ ok: false, codigo: "vacio", mensaje: "El email del primer admin de la sucursal es obligatorio." });
  });

  it("un nombre inválido se informa antes que el email (mismo orden que antes)", () => {
    expect(guardComandoCrearSucursal({ nombre: "Centro_1", emailPrimerAdmin: "" })).toMatchObject({ ok: false, codigo: "formato" });
  });
});
