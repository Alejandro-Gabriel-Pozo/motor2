import { describe, expect, it } from "vitest";
import { textoDeDenegacion } from "../../src/core/permisos/motivos";
import { denegado } from "../../src/core/permisos/gate";

/**
 * Los textos de SIN_CAPACIDAD y SIN_PERMISO son los de siempre, palabra por palabra: unas 75 pantallas muestran `gate.mensaje` tal cual y
 * varios e2e lo buscan. Escritos a mano acá a propósito: cambiar una frase en `motivos.ts` tiene que dejar este archivo en rojo.
 */
describe("textos de denegación (idénticos a los de antes del guard por módulo)", () => {
  it("capacidad de la sucursal", () => {
    expect(textoDeDenegacion({ motivo: "SIN_CAPACIDAD", accion: "ver_stock", alcance: "sucursal" })).toBe('La Central no habilitó "ver_stock" para esta sucursal.');
    expect(textoDeDenegacion({ motivo: "SIN_CAPACIDAD", accion: "unidades", alcance: "sucursales_del_usuario" })).toBe('La Central no habilitó "unidades" para tus sucursales.');
  });

  it("sin acceso a la sucursal o a la empresa, y política de plataforma", () => {
    expect(textoDeDenegacion({ motivo: "SIN_PERMISO", caso: "SIN_ACCESO_A_SUCURSAL" })).toBe("No tenés acceso a esta sucursal, o tu usuario está inactivo.");
    expect(textoDeDenegacion({ motivo: "SIN_PERMISO", caso: "SIN_ACCESO_A_EMPRESA" })).toBe("No tenés acceso a esta empresa, o tu usuario está inactivo.");
    expect(textoDeDenegacion({ motivo: "SIN_PERMISO", caso: "POLITICA_DE_PLATAFORMA" })).toBe("Los permisos de tu empresa los administra la plataforma; no se pueden editar desde acá.");
  });

  it("rol sin la acción: editar y ver", () => {
    const base = { motivo: "SIN_PERMISO", caso: "ROL_SIN_LA_ACCION", accion: "proceso_compra", rol: "operador" } as const;
    expect(textoDeDenegacion({ ...base, para: "editar" })).toBe(
      'No tenés permiso para esta acción. Tu rol ("operador") no tiene "proceso_compra" habilitado. Pedile a un admin que te lo habilite.'
    );
    expect(textoDeDenegacion({ ...base, para: "ver" })).toBe('No tenés permiso para ver esta sección. Tu rol ("operador") no tiene "proceso_compra" habilitado.');
  });

  it("varios roles sin la acción: editar y ver", () => {
    const base = { motivo: "SIN_PERMISO", caso: "ROLES_SIN_LA_ACCION", accion: "unidades", roles: ["admin", "mozo"] } as const;
    expect(textoDeDenegacion({ ...base, para: "editar" })).toBe(
      'No tenés permiso para esta acción. Ninguno de tus roles ("admin", "mozo") tiene "unidades" habilitado. Pedile a un admin que te lo habilite.'
    );
    expect(textoDeDenegacion({ ...base, para: "ver" })).toBe('No tenés permiso para ver esta sección. Ninguno de tus roles ("admin", "mozo") tiene "unidades" habilitado.');
  });

  it("solo el gerente: editar y ver", () => {
    expect(textoDeDenegacion({ motivo: "SIN_PERMISO", caso: "SOLO_GERENTE", para: "editar" })).toBe("No tenés permiso para esta acción: solo la hace el gerente de la empresa.");
    expect(textoDeDenegacion({ motivo: "SIN_PERMISO", caso: "SOLO_GERENTE", para: "ver" })).toBe("No tenés permiso para ver esta sección: solo la ve el gerente de la empresa.");
  });

  it("motivos de módulo (todavía no los emite el guard): nombran el módulo del catálogo", () => {
    expect(textoDeDenegacion({ motivo: "MODULO_NO_ACTIVO", modulo: "salon" })).toBe('Tu empresa no tiene activado el módulo "Salón".');
    expect(textoDeDenegacion({ motivo: "MODULO_EN_DESARROLLO", modulo: "produccion" })).toBe('El módulo "Producción" todavía está en desarrollo.');
  });
});

describe("denegado: el resultado lleva motivo tipado y mensaje", () => {
  it("copia el motivo, el caso y arma el mensaje", () => {
    const r = denegado({ motivo: "SIN_PERMISO", caso: "SOLO_GERENTE", para: "ver" });
    expect(r).toEqual({ ok: false, mensaje: "No tenés permiso para ver esta sección: solo la ve el gerente de la empresa.", motivo: "SIN_PERMISO", caso: "SOLO_GERENTE", para: "ver" });
  });
});
