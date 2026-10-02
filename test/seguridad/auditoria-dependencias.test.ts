import { describe, expect, it } from "vitest";
import { evaluarAuditoria, extraerAvisosAltos, validarExcepciones, type AvisoAlto, type ExcepcionDeAuditoria } from "../../src/core/seguridad/auditoria-dependencias";
import { EXCEPCIONES_DE_AUDITORIA } from "../../scripts/auditoria-dependencias-excepciones";

const aviso = (id: string, paquete = "mysql2"): AvisoAlto => ({ aviso: id, paquete, severidad: "high", titulo: "t" });
const excepcion = (id: string, venceElDia: string): ExcepcionDeAuditoria => ({ aviso: id, paquete: "mysql2", motivo: "no se ejecuta", venceElDia });

describe("extraerAvisosAltos", () => {
  it("toma los avisos altos y críticos, sin repetir el que arrastran varios paquetes, e ignora referencias y severidades menores", () => {
    const salida = {
      vulnerabilities: {
        prisma: { via: ["@prisma/config", "mysql2"] },
        mysql2: { via: [{ source: 1, name: "mysql2", title: "uno", url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc", severity: "high" }] },
        otro: { via: [{ source: 1, name: "mysql2", title: "uno", url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc", severity: "high" }] },
        grave: { via: [{ source: 2, name: "grave", title: "dos", url: "https://github.com/advisories/GHSA-dddd-eeee-ffff", severity: "critical" }] },
        leve: { via: [{ source: 3, name: "leve", title: "tres", url: "https://github.com/advisories/GHSA-gggg-hhhh-iiii", severity: "moderate" }] },
      },
    };
    expect(extraerAvisosAltos(salida).map((a) => a.aviso)).toEqual(["GHSA-aaaa-bbbb-cccc", "GHSA-dddd-eeee-ffff"]);
  });

  it("sin vulnerabilidades devuelve una lista vacía", () => {
    expect(extraerAvisosAltos({})).toEqual([]);
  });
});

describe("evaluarAuditoria", () => {
  it("un aviso con excepción vigente pasa, y el último día de la excepción todavía rige", () => {
    const r = evaluarAuditoria([aviso("GHSA-1")], [excepcion("GHSA-1", "2026-12-01")], "2026-12-01");
    expect(r.ok).toBe(true);
    expect(r.aceptadas).toHaveLength(1);
  });

  it("un aviso con la excepción vencida falla", () => {
    const r = evaluarAuditoria([aviso("GHSA-1")], [excepcion("GHSA-1", "2026-12-01")], "2026-12-02");
    expect(r.ok).toBe(false);
    expect(r.vencidas.map((v) => v.aviso)).toEqual(["GHSA-1"]);
  });

  it("un aviso que no está en la lista falla", () => {
    const r = evaluarAuditoria([aviso("GHSA-1"), aviso("GHSA-2")], [excepcion("GHSA-1", "2026-12-01")], "2026-10-02");
    expect(r.ok).toBe(false);
    expect(r.sinExcepcion.map((a) => a.aviso)).toEqual(["GHSA-2"]);
  });

  it("una excepción cuyo aviso ya no aparece queda como sobrante pero no hace fallar", () => {
    const r = evaluarAuditoria([], [excepcion("GHSA-1", "2026-12-01")], "2026-10-02");
    expect(r.ok).toBe(true);
    expect(r.sobrantes.map((e) => e.aviso)).toEqual(["GHSA-1"]);
  });
});

describe("validarExcepciones", () => {
  it("rechaza una excepción sin motivo o con una fecha que no es AAAA-MM-DD", () => {
    const errores = validarExcepciones([
      { aviso: "GHSA-1", paquete: "x", motivo: "  ", venceElDia: "2026-12-01" },
      { aviso: "GHSA-2", paquete: "x", motivo: "ok", venceElDia: "01/12/2026" },
      { aviso: "GHSA-3", paquete: "x", motivo: "ok", venceElDia: "2026-13-45" },
    ]);
    expect(errores).toHaveLength(3);
  });

  it("la lista real del repositorio es válida, y cada excepción tiene motivo", () => {
    expect(validarExcepciones(EXCEPCIONES_DE_AUDITORIA)).toEqual([]);
  });
});
