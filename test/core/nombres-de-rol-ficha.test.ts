import { describe, expect, it } from "vitest";
import { mensajeSiNombreDeRolNoPermitido, normalizarNombreDeRol } from "@/core/permisos/nombres-de-rol";

/**
 * El nombre de un rol con la ficha NOMBRE_DE_ROL (frente 3, E-1; dueño, 2026-11-16, «Sí, así (Recomendada)»): lista de permitidos de Pedernal SIN `¿ ¡ ? ! % $`, hasta 80, con una letra.
 * Una violación inyectada por cada rechazo; los nombres reservados y el mensaje de «vacío» siguen como antes. El nombre llega NORMALIZADO (minúscula, espacios juntos): así lo llaman los casos de uso.
 */
const RECHAZO = "Esta acción no está permitida";
const validar = (nombre: string, clave: string | null = null) => mensajeSiNombreDeRolNoPermitido(normalizarNombreDeRol(nombre), clave);

describe("nombre de rol con la ficha de Pedernal", () => {
  it.each(["jefe de sala", "encargado", "Ñandú", "caja (turno 2)", "  Jefe   de  Sala "])("acepta «%s»", (nombre) => {
    expect(validar(nombre)).toBeNull();
  });

  it("vacío: el mensaje de siempre", () => {
    expect(validar("")).toBe("El nombre del rol no puede estar vacío.");
    expect(validar("   ")).toBe("El nombre del rol no puede estar vacío.");
  });

  it.each([
    ["cirílico", "центр"],
    ["ideogramas", "小林商事"],
    ["guion bajo", "jefe_de_sala"],
    ["emoji", "jefe 🍕"],
    ["signo solo de catálogo ¿", "¿jefe?"],
    ["signo solo de catálogo %", "jefe 50%"],
    ["signo solo de catálogo $", "jefe $"],
    ["menor y mayor", "<jefe>"],
    ["invisible de ancho cero", "jefe​sala"],
    ["empieza con guion", "-jefe"],
    ["empieza con más", "+jefe"],
    ["sin ninguna letra", "123"],
    ["81 caracteres", "a".repeat(81)],
  ])("rechaza %s con el mensaje genérico", (_motivo, nombre) => {
    expect(validar(nombre)).toBe(RECHAZO);
  });

  it("rechaza un salto de línea adentro cuando llega sin normalizar (la normalización lo junta como espacio)", () => {
    expect(mensajeSiNombreDeRolNoPermitido("jefe\nsala", null)).toBe(RECHAZO);
    expect(validar("jefe\nsala")).toBeNull();
  });

  it("acepta justo 80 caracteres", () => {
    expect(validar("a".repeat(80))).toBeNull();
  });

  it("los nombres reservados siguen reservados (sin cambios)", () => {
    expect(validar("gerente")).toMatch(/reservado/);
    expect(validar("operador")).toMatch(/reservado/);
    expect(validar("admin", "admin")).toBeNull();
  });
});
