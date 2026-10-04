import { describe, expect, it } from "vitest";
import {
  accionesDeCicloDeVida,
  confirmarAltaSchema,
  corregirCuitSchema,
  cuitsRepetidos,
  mensajeDeEmpresaActiva,
  motivoSchema,
  tieneCuitPendiente,
  type EmpresaParaElCiclo,
} from "../../src/core/features/empresa/ciclo-de-vida";
import { FUENTES_DE_FACTURAS_AUTORIZADAS, empresaTieneFacturaAutorizada, hayFacturaEnAlgunaFuente } from "../../src/core/fiscal/factura-autorizada";

const aceptada = { estado: "ACEPTADA" as const, cuitDeclarado: "30712345671" };
const sinFactura = { tieneFacturaAutorizada: false };

function empresa(parcial: Partial<EmpresaParaElCiclo>): EmpresaParaElCiclo {
  return { estado: "PROVISIONING", cuit: null, invitacion: null, ...parcial };
}

describe("tieneCuitPendiente", () => {
  it("solo una empresa EN ALTA con la invitación ACEPTADA y un CUIT declarado", () => {
    expect(tieneCuitPendiente(empresa({ invitacion: aceptada }))).toBe(true);
    expect(tieneCuitPendiente(empresa({ invitacion: { estado: "PENDIENTE", cuitDeclarado: null } }))).toBe(false);
    expect(tieneCuitPendiente(empresa({ invitacion: { estado: "ACEPTADA", cuitDeclarado: null } }))).toBe(false);
    expect(tieneCuitPendiente(empresa({ estado: "ACTIVE", invitacion: aceptada }))).toBe(false);
    expect(tieneCuitPendiente(empresa({}))).toBe(false);
  });
});

describe("accionesDeCicloDeVida: qué se ofrece en cada estado", () => {
  it("en alta con CUIT pendiente: solo confirmar; no se suspende ni se corrige (se corrige al confirmar)", () => {
    expect(accionesDeCicloDeVida(empresa({ invitacion: aceptada }), sinFactura)).toEqual({
      confirmar: true,
      corregirCuit: false,
      vaciarCuit: false,
      suspender: false,
      reactivar: false,
      reenviarAviso: false,
    });
  });

  it("en alta sin aceptar: nada de ciclo de vida (la invitación se maneja aparte)", () => {
    const a = accionesDeCicloDeVida(empresa({ invitacion: { estado: "PENDIENTE", cuitDeclarado: null } }), sinFactura);
    expect(Object.values(a)).toEqual([false, false, false, false, false, false]);
  });

  it("activa: corregir el CUIT, suspender y reenviar el aviso; no vaciar el CUIT ni reactivar", () => {
    expect(accionesDeCicloDeVida(empresa({ estado: "ACTIVE", cuit: "30712345671" }), sinFactura)).toEqual({
      confirmar: false,
      corregirCuit: true,
      vaciarCuit: false,
      suspender: true,
      reactivar: false,
      reenviarAviso: true,
    });
  });

  it("suspendida: reactivar, corregir y, si tiene CUIT, vaciarlo", () => {
    expect(accionesDeCicloDeVida(empresa({ estado: "SUSPENDED", cuit: "30712345671" }), sinFactura)).toMatchObject({ reactivar: true, corregirCuit: true, vaciarCuit: true, suspender: false });
    expect(accionesDeCicloDeVida(empresa({ estado: "SUSPENDED", cuit: null }), sinFactura)).toMatchObject({ vaciarCuit: false, corregirCuit: true });
  });

  it("con una factura autorizada el CUIT es inmutable en cualquier estado, pero se puede seguir suspendiendo y reactivando", () => {
    const con = { tieneFacturaAutorizada: true };
    expect(accionesDeCicloDeVida(empresa({ estado: "ACTIVE", cuit: "30712345671" }), con)).toMatchObject({ corregirCuit: false, vaciarCuit: false, suspender: true });
    expect(accionesDeCicloDeVida(empresa({ estado: "SUSPENDED", cuit: "30712345671" }), con)).toMatchObject({ corregirCuit: false, vaciarCuit: false, reactivar: true });
  });

  it("una empresa en baja no ofrece nada", () => {
    expect(Object.values(accionesDeCicloDeVida(empresa({ estado: "DELETING", cuit: "30712345671" }), sinFactura))).toEqual([false, false, false, false, false, false]);
  });
});

describe("cuitsRepetidos", () => {
  it("devuelve solo los CUIT con más de una empresa y no cuenta los vacíos", () => {
    const r = cuitsRepetidos([
      { id: "a", cuit: "30712345671" },
      { id: "b", cuit: "30712345671" },
      { id: "c", cuit: "20123456786" },
      { id: "d", cuit: null },
      { id: "e", cuit: null },
    ]);
    expect([...r.entries()]).toEqual([["30712345671", ["a", "b"]]]);
  });
});

describe("esquemas de entrada", () => {
  it("el motivo es obligatorio, se recorta y tiene tope", () => {
    expect(motivoSchema.safeParse("  Pidió la baja  ").data).toBe("Pidió la baja");
    for (const malo of ["", "  ", "ab", "x".repeat(201)]) expect(motivoSchema.safeParse(malo).success, malo).toBe(false);
  });

  it("confirmar exige tildar que se revisó el CUIT; aceptoCuitDistinto es falso por defecto", () => {
    expect(confirmarAltaSchema.safeParse({ cuit: "30-71234567-1", revisado: false }).success).toBe(false);
    expect(confirmarAltaSchema.safeParse({ cuit: "", revisado: true }).success).toBe(false);
    expect(confirmarAltaSchema.parse({ cuit: "30-71234567-1", revisado: true })).toMatchObject({ aceptoCuitDistinto: false });
  });

  it("corregir exige motivo; el CUIT vacío se acepta acá (vaciar se decide por estado en el servidor)", () => {
    expect(corregirCuitSchema.safeParse({ cuit: "", motivo: "Era de otra empresa" }).success).toBe(true);
    expect(corregirCuitSchema.safeParse({ cuit: "30-71234567-1", motivo: "" }).success).toBe(false);
  });
});

describe("mensajeDeEmpresaActiva", () => {
  it("dice el nombre, el CUIT con guiones y el enlace al login, y va al gerente", () => {
    const m = mensajeDeEmpresaActiva({ email: "g@ejemplo.com", nombreEmpresa: "Hostería Sur", cuit: "30712345671", urlApp: "https://app.ejemplo.com/" });
    expect(m.para).toEqual(["g@ejemplo.com"]);
    expect(m.asunto).toContain("Hostería Sur");
    expect(m.texto).toContain("30-71234567-1");
    expect(m.texto).toContain("https://app.ejemplo.com/login");
  });
});

describe("empresaTieneFacturaAutorizada (solo cuenta un CAE de PRODUCCIÓN)", () => {
  it("hoy no hay circuito fiscal: la lista de fuentes está vacía y da siempre falso", async () => {
    expect(FUENTES_DE_FACTURAS_AUTORIZADAS).toHaveLength(0);
    expect(await empresaTieneFacturaAutorizada({} as never, "cualquiera")).toBe(false);
  });

  it("con una fuente que cuenta al menos una, es verdadero; con ceros, falso", async () => {
    expect(await hayFacturaEnAlgunaFuente([async () => 0, async () => 2], {} as never, "e")).toBe(true);
    expect(await hayFacturaEnAlgunaFuente([async () => 0], {} as never, "e")).toBe(false);
    expect(await hayFacturaEnAlgunaFuente([], {} as never, "e")).toBe(false);
  });
});
