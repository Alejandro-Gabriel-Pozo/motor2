import { describe, expect, it } from "vitest";
import { planteoEstatico, type Escenario } from "./denegacion/argumentos";
import { escenariosDe, TODOS_LOS_ESCENARIOS } from "./denegacion/escenarios";
import { CONTEXTO_DECLARADO, EN_LA_SUCURSAL_VACIA, ESCENARIOS_QUE_NO_APLICAN, OK_SIN_EFECTO_POR_DISENO, PENDIENTES_DE_SUCURSAL, RECHAZOS_CRUDOS_DE_LA_BASE, SIN_MARCA_PROPIA } from "./denegacion/excepciones";
import { FAMILIAS } from "./denegacion/familias";
import { GENERADORES, SIN_GENERADOR } from "./denegacion/generadores";
import { inventariarPuertas } from "./denegacion/inventario-de-puertas";
import { PUERTAS_SIN_PERMISO } from "../arquitectura/guardas/puertas-sin-permiso";

/**
 * GT-3b (T15 del plan de endurecimiento de seguridad; fila O.88 de `docs/pureza-integracion.md`), la mitad ESTÁTICA: la MATRIZ DE DENEGACIÓN POR DEFECTO no deja ninguna puerta sin ejercer. Sin base de datos.
 *
 * La matriz son los siete archivos `denegacion-por-defecto-<familia>.test.ts`: invocan cada puerta de datos del servidor —cada export de un `"use server"` de `src/server/actions`, cada consulta de
 * `src/server/consultas` y cada lectura de `src/server/lecturas`— como (a) un anónimo, (b) un usuario con sesión pero sin empresa, (c) un usuario de la empresa E1 con ids de OTRA empresa y (d) ese mismo
 * usuario con ids de OTRA sucursal de E1 donde no es miembro, y exigen que no devuelva una sola fila ajena, que no escriba nada (la huella de TODA la base) y que una mutación no termine en `ok: true`.
 * Más (e) un control positivo de las lecturas: con ids propios devuelven algo propio (si no, «no filtró nada» no probaría nada).
 *
 * Una puerta nueva falla CERRADO acá: o sus parámetros se derivan por nombre (`denegacion/argumentos.ts`: entonces entra sola a la matriz) o necesita un generador a medida (`generadores.ts`), o se declara en
 * `SIN_GENERADOR` con motivo. Una carpeta nueva que no cae en ninguna familia también falla. Las listas de excepciones (`excepciones.ts`) son cerradas, con motivo, y solo se achican.
 * Mutaciones: ver la fila O.88.
 */
const puertas = inventariarPuertas();
const claves = new Set(puertas.map((p) => p.clave));

/** Los techos de las listas cerradas: solo bajan (quitar una excepción y bajar el techo en el mismo commit). */
const MAXIMOS = {
  SIN_GENERADOR: 17,
  ESCENARIOS_QUE_NO_APLICAN: 2,
  PENDIENTES_DE_SUCURSAL: 0,
  RECHAZOS_CRUDOS_DE_LA_BASE: 4,
  CONTEXTO_DECLARADO: 1,
  SIN_MARCA_PROPIA: 27,
  OK_SIN_EFECTO_POR_DISENO: 2,
  EN_LA_SUCURSAL_VACIA: 1,
} as const;

describe("GT-3b: la matriz de denegación por defecto cubre todo el inventario", () => {
  it("el inventario ve las puertas de siempre (el lector por AST no se rompió)", () => {
    for (const ancla of [
      "accion|actions/movimientos/compras.ts|anularCompra",
      "accion|actions/pos/cuenta-cierre.ts|cerrarCuenta",
      "accion|actions/carta/copiar-carta.ts|copiarCartaDeSucursal",
      "consulta|consultas/pos/detalle-de-mesa.ts|obtenerDetalleDeMesa",
      "consulta|consultas/reportes/trazabilidad.ts|obtenerOperacionPorId",
      "lectura|lecturas/movimientos/saldos.ts|calcularSaldoTotal",
    ]) {
      expect(claves.has(ancla), ancla).toBe(true);
    }
    expect(puertas.filter((p) => p.tipo === "accion").length).toBeGreaterThan(150);
    expect(puertas.filter((p) => p.tipo === "consulta").length).toBeGreaterThan(70);
    expect(puertas.filter((p) => p.tipo === "lectura").length).toBeGreaterThan(60);
  });

  it("toda puerta cae en EXACTAMENTE una familia (cada familia es un archivo de la matriz)", () => {
    const problemas: string[] = [];
    for (const p of puertas) {
      const familias = Object.entries(FAMILIAS).filter(([, f]) => f.filtro(p));
      if (familias.length !== 1) problemas.push(`${p.clave}: cae en ${familias.length} familias (${familias.map(([n]) => n).join(", ") || "ninguna"})`);
    }
    expect(problemas, `Una puerta sin familia no se ejerce: sumala en denegacion/familias.ts.\n${problemas.join("\n")}`).toEqual([]);
  });

  it("toda puerta se invoca como anónimo y sin empresa: sus argumentos se derivan o está en SIN_GENERADOR, o GT-10 la deja PERMITIDA a propósito", () => {
    const problemas: string[] = [];
    for (const p of puertas) {
      if (Object.hasOwn(SIN_GENERADOR, p.clave)) continue;
      const escenarios = escenariosDe(p);
      for (const quien of ["anonimo", "sinEmpresa"] as const) {
        if (escenarios.includes(quien)) continue;
        const gt10 = p.tipo === "accion" ? PUERTAS_SIN_PERMISO[`accion|${p.archivo.replace(/^actions\//, "")}|${p.nombre}`] : undefined;
        const permitida = gt10 && gt10[quien] === "PERMITIDO";
        const declarada = Object.hasOwn(ESCENARIOS_QUE_NO_APLICAN, `${p.clave}|${quien}`);
        if (!permitida && !declarada) {
          const plan = planteoEstatico(p, quien, GENERADORES);
          problemas.push(`${p.clave}: no se ejerce como «${quien}» (faltan argumentos: ${plan.faltan.join("; ") || "ninguno"}); escribile un generador en denegacion/generadores.ts o declarala en SIN_GENERADOR con motivo`);
        }
      }
    }
    expect(problemas, problemas.join("\n")).toEqual([]);
  });

  it("SIN_GENERADOR: solo puertas que existen y que de verdad no se pueden derivar (si se deriva, sacala); no crece", () => {
    const problemas: string[] = [];
    for (const [clave, motivo] of Object.entries(SIN_GENERADOR)) {
      if (!claves.has(clave)) problemas.push(`${clave}: ya no existe`);
      else {
        const p = puertas.find((x) => x.clave === clave)!;
        if (planteoEstatico(p, "anonimo", GENERADORES).argumentos) problemas.push(`${clave}: sus argumentos ya se derivan: sacala de SIN_GENERADOR`);
      }
      if (motivo.trim().length < 20) problemas.push(`${clave}: el motivo es demasiado corto`);
    }
    expect(problemas, problemas.join("\n")).toEqual([]);
    expect(Object.keys(SIN_GENERADOR).length, "SIN_GENERADOR solo se achica").toBeLessThanOrEqual(MAXIMOS.SIN_GENERADOR);
  });

  it("las excepciones apuntan a puertas y escenarios que existen, con motivo, y no crecen", () => {
    const problemas: string[] = [];
    const conEscenario = (lista: Readonly<Record<string, unknown>>, nombre: string) => {
      for (const clave of Object.keys(lista)) {
        const corte = clave.lastIndexOf("|");
        const puerta = clave.slice(0, corte);
        const escenario = clave.slice(corte + 1) as Escenario;
        if (!claves.has(puerta)) problemas.push(`${nombre}: ${puerta} ya no existe`);
        if (!TODOS_LOS_ESCENARIOS.includes(escenario)) problemas.push(`${nombre}: ${clave} no termina en un escenario válido`);
      }
    };
    conEscenario(ESCENARIOS_QUE_NO_APLICAN, "ESCENARIOS_QUE_NO_APLICAN");
    conEscenario(PENDIENTES_DE_SUCURSAL, "PENDIENTES_DE_SUCURSAL");
    conEscenario(RECHAZOS_CRUDOS_DE_LA_BASE, "RECHAZOS_CRUDOS_DE_LA_BASE");
    conEscenario(OK_SIN_EFECTO_POR_DISENO, "OK_SIN_EFECTO_POR_DISENO");
    for (const clave of [...Object.keys(SIN_MARCA_PROPIA), ...Object.keys(CONTEXTO_DECLARADO), ...Object.keys(EN_LA_SUCURSAL_VACIA)]) if (!claves.has(clave)) problemas.push(`${clave}: ya no existe`);
    for (const [clave, motivo] of Object.entries(SIN_MARCA_PROPIA)) {
      const p = puertas.find((x) => x.clave === clave);
      if (p && (p.mutacion || (p.tipo === "accion" && !p.guarda.startsWith("requerirVer")))) problemas.push(`SIN_MARCA_PROPIA: ${clave} no es una lectura`);
      if (p?.tipo === "lectura") problemas.push(`SIN_MARCA_PROPIA: ${clave} es una lectura de server/lecturas: su control positivo ya no pide marcador propio, sacala`);
      if (motivo.trim().length < 20) problemas.push(`SIN_MARCA_PROPIA: ${clave}: el motivo es demasiado corto`);
    }
    for (const [clave, { motivo }] of Object.entries(PENDIENTES_DE_SUCURSAL)) if (motivo.trim().length < 20) problemas.push(`PENDIENTES_DE_SUCURSAL: ${clave}: el motivo es demasiado corto`);
    expect(problemas, problemas.join("\n")).toEqual([]);
    expect(Object.keys(ESCENARIOS_QUE_NO_APLICAN).length).toBeLessThanOrEqual(MAXIMOS.ESCENARIOS_QUE_NO_APLICAN);
    expect(Object.keys(PENDIENTES_DE_SUCURSAL).length).toBeLessThanOrEqual(MAXIMOS.PENDIENTES_DE_SUCURSAL);
    expect(Object.keys(RECHAZOS_CRUDOS_DE_LA_BASE).length).toBeLessThanOrEqual(MAXIMOS.RECHAZOS_CRUDOS_DE_LA_BASE);
    expect(Object.keys(CONTEXTO_DECLARADO).length).toBeLessThanOrEqual(MAXIMOS.CONTEXTO_DECLARADO);
    expect(Object.keys(SIN_MARCA_PROPIA).length).toBeLessThanOrEqual(MAXIMOS.SIN_MARCA_PROPIA);
    expect(Object.keys(OK_SIN_EFECTO_POR_DISENO).length).toBeLessThanOrEqual(MAXIMOS.OK_SIN_EFECTO_POR_DISENO);
    expect(Object.keys(EN_LA_SUCURSAL_VACIA).length).toBeLessThanOrEqual(MAXIMOS.EN_LA_SUCURSAL_VACIA);
  });

  it("toda mutación con un id del cliente se ejerce con ids ajenos de OTRA EMPRESA (no queda ninguna que solo se pruebe sin sesión)", () => {
    const sinC: string[] = [];
    for (const p of puertas) {
      if (!p.mutacion || Object.hasOwn(SIN_GENERADOR, p.clave)) continue;
      const tieneIdDelCliente = p.parametros.some((q) => /(^id$|Id$|Ids$)/.test(q.nombre));
      if (tieneIdDelCliente && !escenariosDe(p).includes("ajenaEmpresa")) sinC.push(p.clave);
    }
    // Las que reciben un id pero lo usan para otra cosa (la sucursal activa, un tope, el id de un traspaso a crear) o ninguno ajeno aplica: lista cerrada, con motivo.
    expect(sinC.sort(), `Mutaciones con un id del cliente que NO se prueban con ids de otra empresa:\n${sinC.join("\n")}`).toEqual([]);
  });

  it("cobertura: cuántas puertas hay y en cuántos escenarios se ejercen (informativo, con piso)", () => {
    const porEscenario: Record<string, number> = { anonimo: 0, sinEmpresa: 0, ajenaEmpresa: 0, ajenaSucursal: 0, propia: 0 };
    let ejercidas = 0;
    for (const p of puertas) {
      const e = escenariosDe(p);
      if (e.length) ejercidas++;
      for (const x of e) porEscenario[x]++;
    }
    expect(puertas.length - ejercidas, "puertas sin ejercer = exactamente las de SIN_GENERADOR").toBe(Object.keys(SIN_GENERADOR).length);
    expect(porEscenario.anonimo).toBeGreaterThan(300);
    expect(porEscenario.sinEmpresa).toBeGreaterThan(300);
    expect(porEscenario.ajenaEmpresa).toBeGreaterThan(250);
    expect(porEscenario.ajenaSucursal).toBeGreaterThan(150);
  });
});
