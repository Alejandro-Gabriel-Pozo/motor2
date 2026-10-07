import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ACCIONES, contextoDeAccion, moduloDeAccion, nivelMinimoDeAccion, type AccionClave, type AccionDeEmpresa, type AccionDeSucursal } from "../../src/core/permisos/acciones";
import {
  accesoDeSucursal,
  accionesVisiblesEnSucursal,
  decidirEnEmpresa,
  decidirEnSucursal,
  nivelEnSucursal,
  nivelesEnLaEmpresa,
  type MembresiaParaEmpresa,
  type PermisoLeido,
  type RolLeido,
} from "../../src/core/permisos/decision-de-acceso";
import { denegacionDeModulo } from "../../src/core/permisos/modulo-de-la-accion";
import { rolAlcanzaLaAccion } from "../../src/core/permisos/jerarquia";
import { ROL_EMPRESA_GERENTE } from "../../src/core/permisos/rol-empresa";

/**
 * PROPIEDADES (fast-check) de la decisión de acceso (`core/permisos/decision-de-acceso.ts`; Pureza Fase 3, tramo B; auditoría de la Fase 3, hallazgo 13: «propiedades del guard de acceso: no existen»).
 * Complementan la matriz de `test/permisos/caracterizacion-del-acceso.test.ts` (puntos concretos contra Postgres) con invariantes que tienen que valer para CUALQUIER combinación de hechos:
 * el acceso FALLA CERRADO y su ORDEN de evaluación no cambia (membresía → módulo → capacidad → permiso del rol), el PISO de la acción manda sobre la matriz, y la acción de piso gerente la
 * tiene solo el gerente de la empresa. Son funciones puras: sin Postgres, corren en milisegundos.
 */

const RUNS = { numRuns: 500 };

const DE_SUCURSAL = ACCIONES.filter((a) => contextoDeAccion(a.clave) === "sucursal").map((a) => a.clave as AccionDeSucursal);
const DE_EMPRESA = ACCIONES.filter((a) => contextoDeAccion(a.clave) === "empresa").map((a) => a.clave as AccionDeEmpresa);
const MODULOS = [...new Set(ACCIONES.map((a) => moduloDeAccion(a.clave)))];

const accionDeSucursal = fc.constantFrom(...DE_SUCURSAL);
const accionDeEmpresa = fc.constantFrom(...DE_EMPRESA);
const claveDeRol = fc.constantFrom<string | null>("admin", "operador", null, "encargado", "otro");
const fila = fc.record({ puedeVer: fc.boolean(), puedeEditar: fc.boolean() });
const filaODenada = fc.option(fila, { nil: null });
const modulosEfectivos = fc.subarray(MODULOS).map((m) => new Set<string>(m));
const rolNombre = fc.constantFrom("Administrador", "Operador", "Mozo");

const membresiaDe = (clave: string | null) => ({ rol: { clave, nombre: "Rol", activo: true } });

describe("decisión de acceso en sucursal (propiedades)", () => {
  it("sin membresía vigente SIEMPRE se deniega, sea lo que sea lo demás (fallo cerrado)", () => {
    fc.assert(
      fc.property(accionDeSucursal, filaODenada, fc.boolean(), fc.constantFrom<"editar" | "ver">("editar", "ver"), (accion, filaDelRol, tieneCapacidad, para) => {
        const acceso = accesoDeSucursal<{ rol: RolLeido }>({ membresia: null, filaDelRol, sinModulo: null, tieneCapacidad }, accion);
        const r = decidirEnSucursal(acceso, accion, para);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r).toMatchObject({ motivo: "SIN_PERMISO", caso: "SIN_ACCESO_A_SUCURSAL" });
        expect(nivelEnSucursal(acceso)).toEqual({ ver: false, editar: false });
      }),
      RUNS,
    );
  });

  it("el ORDEN de evaluación es membresía → módulo → capacidad → permiso: cada causa tapa a las que siguen", () => {
    fc.assert(
      fc.property(accionDeSucursal, claveDeRol, filaODenada, modulosEfectivos, fc.boolean(), (accion, clave, filaDelRol, efectivos, tieneCapacidad) => {
        const sinModulo = denegacionDeModulo(moduloDeAccion(accion), efectivos);
        const acceso = accesoDeSucursal({ membresia: membresiaDe(clave), filaDelRol, sinModulo, tieneCapacidad }, accion);
        const r = decidirEnSucursal(acceso, accion, "ver");
        if (sinModulo) {
          expect(r).toMatchObject({ ok: false, motivo: sinModulo.motivo });
        } else if (!tieneCapacidad) {
          expect(r).toMatchObject({ ok: false, motivo: "SIN_CAPACIDAD", accion, alcance: "sucursal" });
        } else if (!r.ok) {
          expect(r).toMatchObject({ motivo: "SIN_PERMISO", caso: "ROL_SIN_LA_ACCION" });
        }
      }),
      RUNS,
    );
  });

  it("el PISO manda sobre la matriz: si el rol no alcanza la acción, ninguna fila (ni con Ver y Editar) da acceso", () => {
    fc.assert(
      fc.property(accionDeSucursal, claveDeRol, (accion, clave) => {
        fc.pre(!rolAlcanzaLaAccion({ clave }, accion));
        const todoPermitido: PermisoLeido = { puedeVer: true, puedeEditar: true };
        const acceso = accesoDeSucursal({ membresia: membresiaDe(clave), filaDelRol: todoPermitido, sinModulo: null, tieneCapacidad: true }, accion);
        expect(decidirEnSucursal(acceso, accion, "ver").ok).toBe(false);
        expect(decidirEnSucursal(acceso, accion, "editar").ok).toBe(false);
        expect(nivelEnSucursal(acceso)).toEqual({ ver: false, editar: false });
      }),
      RUNS,
    );
  });

  it("sin piso de por medio, editar/ver se permiten SOLO si la fila los da; y la decisión coincide con el nivel", () => {
    fc.assert(
      fc.property(accionDeSucursal, claveDeRol, filaODenada, (accion, clave, filaDelRol) => {
        const acceso = accesoDeSucursal({ membresia: membresiaDe(clave), filaDelRol, sinModulo: null, tieneCapacidad: true }, accion);
        const alcanza = rolAlcanzaLaAccion({ clave }, accion);
        const nivel = nivelEnSucursal(acceso);
        expect(decidirEnSucursal(acceso, accion, "editar").ok).toBe(alcanza && filaDelRol?.puedeEditar === true);
        expect(decidirEnSucursal(acceso, accion, "ver").ok).toBe(alcanza && filaDelRol?.puedeVer === true);
        expect(nivel.editar).toBe(alcanza && filaDelRol?.puedeEditar === true);
        expect(nivel.ver).toBe(alcanza && filaDelRol?.puedeVer === true);
      }),
      RUNS,
    );
  });

  it("quitar un permiso nunca agrega acceso (monotonía): con una fila más pobre, lo permitido es un subconjunto", () => {
    fc.assert(
      fc.property(accionDeSucursal, claveDeRol, fila, fila, (accion, clave, a, b) => {
        const mas: PermisoLeido = { puedeVer: a.puedeVer || b.puedeVer, puedeEditar: a.puedeEditar || b.puedeEditar };
        const decide = (f: PermisoLeido, para: "editar" | "ver") =>
          decidirEnSucursal(accesoDeSucursal({ membresia: membresiaDe(clave), filaDelRol: f, sinModulo: null, tieneCapacidad: true }, accion), accion, para).ok;
        for (const para of ["editar", "ver"] as const) if (decide(a, para)) expect(decide(mas, para)).toBe(true);
      }),
      RUNS,
    );
  });

  it("accionesVisiblesEnSucursal es siempre un subconjunto de lo que el rol tiene en Ver Y la sucursal tiene habilitado, y respeta el piso y el módulo", () => {
    fc.assert(
      fc.property(claveDeRol, fc.subarray(DE_SUCURSAL), fc.subarray(DE_SUCURSAL), fc.option(modulosEfectivos, { nil: null }), (clave, conVer, habilitadas, efectivos) => {
        const visibles = accionesVisiblesEnSucursal({ rol: { clave }, clavesConVerEnElRol: conVer, habilitadas: new Set(habilitadas), efectivos });
        for (const accion of visibles) {
          expect(conVer).toContain(accion);
          expect(habilitadas).toContain(accion);
          expect(rolAlcanzaLaAccion({ clave }, accion)).toBe(true);
          if (efectivos) expect(efectivos.has(moduloDeAccion(accion))).toBe(true);
        }
      }),
      RUNS,
    );
  });
});

describe("decisión de acceso en la empresa (propiedades)", () => {
  const membresiaConPermisos = (clave: string | null, nombre: string, permisos: { accionClave: string; puedeVer: boolean; puedeEditar: boolean }[]): MembresiaParaEmpresa => ({
    rol: { nombre, clave, permisos },
  });

  const unaMembresia = fc.record({ clave: claveDeRol, nombre: rolNombre, permisos: fc.array(fc.record({ accionClave: accionDeEmpresa, puedeVer: fc.boolean(), puedeEditar: fc.boolean() }), { maxLength: 6 }), habilitada: fc.boolean() });

  const armar = (ms: { clave: string | null; nombre: string; permisos: { accionClave: string; puedeVer: boolean; puedeEditar: boolean }[]; habilitada: boolean }[], accion: AccionDeEmpresa) =>
    ({ membresias: ms.map((m) => membresiaConPermisos(m.clave, m.nombre, m.permisos)), habilitadas: ms.map((m) => (m.habilitada ? new Set<string>([accion]) : new Set<string>())) });

  it("sin ninguna membresía activa se deniega SIEMPRE, también al gerente de empresa (la autoridad de empresa no se aplica sin membresía)", () => {
    fc.assert(
      fc.property(accionDeEmpresa, fc.constantFrom<string | null>(ROL_EMPRESA_GERENTE, null), modulosEfectivos, fc.constantFrom<"editar" | "ver">("editar", "ver"), (accion, rolEmpresa, efectivos, para) => {
        const resultado = nivelesEnLaEmpresa({ membresias: [], habilitadas: [], efectivos, rolEmpresa, claves: [accion] });
        const r = decidirEnEmpresa(resultado, accion, para);
        expect(r).toMatchObject({ ok: false, motivo: "SIN_PERMISO", caso: "SIN_ACCESO_A_EMPRESA" });
      }),
      RUNS,
    );
  });

  it("si la empresa no tiene el módulo de la acción, ni ver ni editar: manda sobre el rol, la capacidad y hasta el gerente", () => {
    fc.assert(
      fc.property(accionDeEmpresa, fc.array(unaMembresia, { minLength: 1, maxLength: 3 }), fc.constantFrom<string | null>(ROL_EMPRESA_GERENTE, null), (accion, ms, rolEmpresa) => {
        const sinElModulo = new Set<string>(MODULOS.filter((m) => m !== moduloDeAccion(accion)));
        const { membresias, habilitadas } = armar(ms, accion);
        const resultado = nivelesEnLaEmpresa({ membresias, habilitadas, efectivos: sinElModulo, rolEmpresa, claves: [accion] });
        const nivel = resultado.niveles.get(accion)!;
        expect(nivel).toMatchObject({ ver: false, editar: false });
        expect(nivel.sinModulo).not.toBeNull();
        for (const para of ["editar", "ver"] as const) expect(decidirEnEmpresa(resultado, accion, para).ok).toBe(false);
      }),
      RUNS,
    );
  });

  it("una acción de piso gerente la tiene SOLO el gerente de empresa, sin importar la matriz ni la capacidad", () => {
    const deGerente = DE_EMPRESA.filter((a) => nivelMinimoDeAccion(a) === "gerente");
    expect(deGerente.length, "tiene que haber acciones de piso gerente en el catálogo").toBeGreaterThan(0);
    fc.assert(
      fc.property(fc.constantFrom(...deGerente), fc.array(unaMembresia, { minLength: 1, maxLength: 3 }), fc.constantFrom<string | null>(ROL_EMPRESA_GERENTE, null, "otro"), (accion, ms, rolEmpresa) => {
        const { membresias, habilitadas } = armar(
          ms.map((m) => ({ ...m, permisos: [{ accionClave: accion, puedeVer: true, puedeEditar: true }] })),
          accion,
        );
        const resultado = nivelesEnLaEmpresa({ membresias, habilitadas, efectivos: null, rolEmpresa, claves: [accion] });
        const esGerente = rolEmpresa === ROL_EMPRESA_GERENTE;
        expect(decidirEnEmpresa(resultado, accion, "ver").ok).toBe(esGerente);
        expect(decidirEnEmpresa(resultado, accion, "editar").ok).toBe(esGerente);
      }),
      RUNS,
    );
  });

  it("para una acción común, ver/editar se dan si ALGUNA membresía alcanza el piso, tiene la fila y la Central no la apagó (y solo entonces)", () => {
    const comunes = DE_EMPRESA.filter((a) => nivelMinimoDeAccion(a) !== "gerente");
    fc.assert(
      fc.property(fc.constantFrom(...comunes), fc.array(unaMembresia, { minLength: 1, maxLength: 4 }), (accion, ms) => {
        const { membresias, habilitadas } = armar(ms, accion);
        const resultado = nivelesEnLaEmpresa({ membresias, habilitadas, efectivos: null, rolEmpresa: null, claves: [accion] });
        const aplican = ms.filter((m) => rolAlcanzaLaAccion({ clave: m.clave }, accion));
        const conFila = aplican.map((m) => ({ ...m, fila: m.permisos.find((p) => p.accionClave === accion) })).filter((m) => m.fila?.puedeVer);
        const verEsperado = conFila.some((m) => m.habilitada);
        const editarEsperado = conFila.some((m) => m.habilitada && m.fila?.puedeEditar);
        expect(decidirEnEmpresa(resultado, accion, "ver").ok).toBe(verEsperado);
        expect(decidirEnEmpresa(resultado, accion, "editar").ok).toBe(editarEsperado);
        // Fallo cerrado: nada se permite si ninguna membresía tiene la fila con Ver.
        if (conFila.length === 0) expect(resultado.niveles.get(accion)).toMatchObject({ ver: false, editar: false });
      }),
      RUNS,
    );
  });

  it("agregar una membresía nunca le quita acceso al usuario (monotonía)", () => {
    const comunes = DE_EMPRESA.filter((a) => nivelMinimoDeAccion(a) !== "gerente");
    fc.assert(
      fc.property(fc.constantFrom(...comunes), fc.array(unaMembresia, { minLength: 1, maxLength: 3 }), unaMembresia, (accion, ms, extra) => {
        const antes = armar(ms, accion);
        const despues = armar([...ms, extra], accion);
        const rA = nivelesEnLaEmpresa({ ...antes, efectivos: null, rolEmpresa: null, claves: [accion] });
        const rD = nivelesEnLaEmpresa({ ...despues, efectivos: null, rolEmpresa: null, claves: [accion] });
        for (const para of ["editar", "ver"] as const) if (decidirEnEmpresa(rA, accion, para).ok) expect(decidirEnEmpresa(rD, accion, para).ok).toBe(true);
      }),
      RUNS,
    );
  });
});

describe("los hechos del catálogo que las propiedades suponen", () => {
  it("toda acción tiene contexto, módulo y piso definidos, y las de piso gerente son de contexto empresa (ningún rol de sucursal las alcanza)", () => {
    for (const a of ACCIONES) {
      const clave = a.clave as AccionClave;
      expect(["empresa", "sucursal"]).toContain(contextoDeAccion(clave));
      expect(["operario", "administrador", "gerente"]).toContain(nivelMinimoDeAccion(clave));
      if (nivelMinimoDeAccion(clave) === "gerente") expect(contextoDeAccion(clave), clave).toBe("empresa");
    }
  });
});
