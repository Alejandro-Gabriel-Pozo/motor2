import { describe, expect, it } from "vitest";
import { ACCIONES, ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE, moduloDeAccion } from "../../src/core/permisos/acciones";
import { MODULOS, esModuloDelCatalogo, type ModuloDef } from "../../src/core/modulos/catalogo";

/**
 * Guardián del módulo de cada acción (ADR-011/015): toda acción declara un módulo del catálogo y las acciones de gobierno de la empresa
 * (permisos, roles, usuarios, sucursales, auditoría) pertenecen a Administración, que nunca se apaga. Si una de ellas cayera en un módulo
 * vendible, apagar ese módulo dejaría a la empresa sin poder administrarse.
 */

const ACCIONES_DE_ADMINISTRACION = [
  "gestion_usuarios", "activar_usuario_sucursal", "notas_usuario_sucursal", "apagar_cuenta_empresa", "gestion_permisos", "gestion_roles", "renombrar_rol",
  "capacidades_sucursal", "alta_sucursal", "activar_sucursal", "renombrar_sucursal", "ver_auditoria", "ver_auditoria_empresa", "traspasar_gerencia",
] as const;

describe("toda acción declara su módulo", () => {
  it("el módulo de cada acción existe en el catálogo", () => {
    const sinModulo = ACCIONES.filter((a) => !esModuloDelCatalogo(a.modulo)).map((a) => a.clave);
    expect(sinModulo).toEqual([]);
  });

  it("ninguna acción pertenece a un módulo en desarrollo", () => {
    const enDesarrollo = new Set((MODULOS as readonly ModuloDef[]).filter((m) => m.estado === "en_desarrollo").map((m) => m.id));
    expect(ACCIONES.filter((a) => enDesarrollo.has(a.modulo)).map((a) => a.clave)).toEqual([]);
  });

  it("todo módulo disponible tiene al menos una acción, y Administración existe y es el fijo", () => {
    for (const m of (MODULOS as readonly ModuloDef[]).filter((x) => x.estado === "disponible")) {
      expect(
        ACCIONES.some((a) => a.modulo === m.id),
        `el módulo «${m.id}» no tiene ninguna acción`
      ).toBe(true);
    }
    expect(MODULOS.filter((m) => m.tipo === "fijo").map((m) => m.id)).toEqual(["administracion"]);
  });

  it("`moduloDeAccion` lee lo mismo que el catálogo", () => {
    for (const a of ACCIONES) expect(moduloDeAccion(a.clave)).toBe(a.modulo);
  });
});

describe("las acciones de gobierno de la empresa son de Administración", () => {
  it("las que exigen admin siempre y las de piso gerente están en Administración", () => {
    const deGerente = ACCIONES.filter((a) => a.nivelMinimo === "gerente").map((a) => a.clave);
    for (const clave of [...ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE, ...deGerente, "capacidades_sucursal" as const]) {
      expect(moduloDeAccion(clave), clave).toBe("administracion");
    }
  });

  it("Administración tiene exactamente las acciones esperadas (una nueva se agrega acá a propósito)", () => {
    const enAdministracion = ACCIONES.filter((a) => a.modulo === "administracion").map((a) => a.clave);
    expect([...enAdministracion].sort()).toEqual([...ACCIONES_DE_ADMINISTRACION].sort());
  });
});
