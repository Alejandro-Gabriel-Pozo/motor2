import { describe, expect, it } from "vitest";
import {
  decidirSobreProducto,
  marcasDeOcultar,
  MOTIVOS_DE_RECHAZO,
  OPERACIONES_DE_ADMINISTRACION,
  OPERACIONES_DE_PRODUCTO,
  ocultoPor,
  type AlcanceDeOcultar,
  type EntradaDeDecision,
  type EstadoDesactivar,
  type HechosDelProducto,
  type MarcasDeOcultar,
  type Quien,
  type Saldo,
} from "@/core/catalogo/ocultar-producto";
import { ORACULO } from "./ocultar-producto-oraculo";

/** Docs: docs/diseno-ocultar-como-pedernal-2026-11-15.md §10.2 (E2). Núcleo puro sin base: el recorrido es exhaustivo. */
const D1: EstadoDesactivar[] = ["activo", "desactivado"];
const D2: MarcasDeOcultar[] = [
  { empresa: false, local: false },
  { empresa: false, local: true },
  { empresa: true, local: false },
  { empresa: true, local: true },
];
const D3: Saldo[] = ["cero", "positivo", "negativo"];
const BOOL = [false, true];
const D7: Quien[] = ["operador_de_este_local", "operador_de_otro_local", "admin_alcance_total", "sin_permiso"];
const ALCANCES: AlcanceDeOcultar[] = ["local", "empresa"];

function* todasLasHechos(): Generator<HechosDelProducto> {
  for (const desactivar of D1) for (const ocultar of D2) for (const saldo of D3) for (const conteoSinResolver of BOOL) for (const enRecetaVigente of BOOL) yield { desactivar, ocultar, saldo, conteoSinResolver, enRecetaVigente };
}

function* todasLasEntradas(): Generator<EntradaDeDecision> {
  for (const hechos of todasLasHechos()) {
    for (const operacion of OPERACIONES_DE_PRODUCTO) yield { hechos, operacion };
    for (const operacion of OPERACIONES_DE_ADMINISTRACION) for (const quien of D7) for (const alcance of ALCANCES) yield { hechos, operacion, quien, alcance };
  }
}

describe("decidirSobreProducto contra el oráculo (recorrido exhaustivo)", () => {
  it("las combinaciones de D1 a D6 son 1.440 (2×4×3×2×2×15 con las 11+4 operaciones)", () => {
    expect([...todasLasHechos()].length * (OPERACIONES_DE_PRODUCTO.length + OPERACIONES_DE_ADMINISTRACION.length)).toBe(1440);
  });

  it("cada combinación cae en EXACTAMENTE una regla del oráculo (sin huecos ni solapes) y el código da lo que la regla dice", () => {
    let recorridas = 0;
    const reglasUsadas = new Set<string>();
    for (const entrada of todasLasEntradas()) {
      recorridas++;
      const aplican = ORACULO.filter((r) => r.cuando(entrada));
      expect(aplican.map((r) => r.id), `sin regla única para ${JSON.stringify(entrada)}`).toHaveLength(1);
      const regla = aplican[0]!;
      reglasUsadas.add(regla.id);
      const esperado = regla.esperado(entrada);
      const real = decidirSobreProducto(entrada);
      const obtenido = real.ok ? "permitido" : real.motivo;
      expect(obtenido, `${regla.id} (${regla.texto}) para ${JSON.stringify(entrada)}`).toBe(esperado);
    }
    expect(recorridas).toBeGreaterThan(1440);
    // Ninguna regla del oráculo queda sin usar: una regla que nunca aplica es una regla que no dice nada.
    expect([...reglasUsadas].sort()).toEqual(ORACULO.map((r) => r.id).sort());
  });

  it("R-18, independencia: ocultar/mostrar no miran Desactivar, y desactivar/activar no miran Ocultar", () => {
    for (const hechos of todasLasHechos()) {
      for (const operacion of ["ocultar", "mostrar"] as const) {
        for (const quien of D7) for (const alcance of ALCANCES) {
          const otro: HechosDelProducto = { ...hechos, desactivar: hechos.desactivar === "activo" ? "desactivado" : "activo" };
          expect(decidirSobreProducto({ hechos: otro, operacion, quien, alcance })).toEqual(decidirSobreProducto({ hechos, operacion, quien, alcance }));
        }
      }
      for (const operacion of ["desactivar", "activar"] as const) {
        for (const quien of D7) {
          const otro: HechosDelProducto = { ...hechos, ocultar: { empresa: !hechos.ocultar.empresa, local: !hechos.ocultar.local } };
          expect(decidirSobreProducto({ hechos: otro, operacion, quien, alcance: "local" })).toEqual(decidirSobreProducto({ hechos, operacion, quien, alcance: "local" }));
        }
      }
    }
  });

  it("D4 (conteo sin resolver) no cambia ninguna decisión todavía (diseño §4.6 y decisión técnica 9)", () => {
    for (const entrada of todasLasEntradas()) {
      const otra = { ...entrada, hechos: { ...entrada.hechos, conteoSinResolver: !entrada.hechos.conteoSinResolver } } as EntradaDeDecision;
      expect(decidirSobreProducto(otra)).toEqual(decidirSobreProducto(entrada));
    }
  });

  it("falla cerrado: una operación desconocida, o de administración sin «quién», se rechaza", () => {
    const hechos: HechosDelProducto = { desactivar: "activo", ocultar: { empresa: false, local: false }, saldo: "cero", conteoSinResolver: false, enRecetaVigente: false };
    expect(decidirSobreProducto({ hechos, operacion: "inventada" } as unknown as EntradaDeDecision).ok).toBe(false);
    expect(decidirSobreProducto({ hechos, operacion: "ocultar" } as unknown as EntradaDeDecision)).toEqual({ ok: false, motivo: "SIN_PERMISO" });
  });

  it("los motivos son un conjunto cerrado y todos aparecen en el oráculo", () => {
    const usados = new Set<string>();
    for (const entrada of todasLasEntradas()) {
      const d = decidirSobreProducto(entrada);
      if (!d.ok) usados.add(d.motivo);
    }
    expect([...usados].sort()).toEqual([...MOTIVOS_DE_RECHAZO].sort());
  });

  it("es repetible: la misma entrada da siempre la misma decisión (idempotencia de una función pura)", () => {
    for (const entrada of todasLasEntradas()) expect(decidirSobreProducto(entrada)).toEqual(decidirSobreProducto(entrada));
  });
});

describe("ocultoPor y marcasDeOcultar (I-3, I-2)", () => {
  const filas = [
    { sucursalId: null, oculto: false },
    { sucursalId: "s1", oculto: true },
    { sucursalId: "s2", oculto: true },
  ];
  it("sin filas = visible", () => {
    expect(ocultoPor([], "s1")).toBeNull();
    expect(marcasDeOcultar([], "s1")).toEqual({ empresa: false, local: false });
  });
  it("una fila de OTRO local no cuenta aunque llegue", () => {
    expect(ocultoPor([{ sucursalId: "s2", oculto: true }], "s1")).toBeNull();
  });
  it("una fila con oculto = false (se volvió a mostrar) no oculta", () => {
    expect(ocultoPor(filas.slice(0, 1), "s1")).toBeNull();
  });
  it("oculto por el local", () => {
    expect(ocultoPor(filas, "s1")).toBe("SUCURSAL");
    expect(marcasDeOcultar(filas, "s1")).toEqual({ empresa: false, local: true });
  });
  it("la empresa gana sobre el local, y un local nuevo hereda lo que la empresa oculta", () => {
    const conEmpresa = [...filas, { sucursalId: null, oculto: true }];
    expect(ocultoPor(conEmpresa, "s1")).toBe("EMPRESA");
    expect(ocultoPor(conEmpresa, "sucursal-creada-despues")).toBe("EMPRESA");
  });
});
