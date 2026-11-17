import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MODOS_DE_PARTE, TIPOS_DE_CUPO, motivoDeParteSinPlatos, planDeParte, type CupoExistenteConSeccion } from "../../src/core/carta/public";
import { guardComandoGuardarParteDePromo } from "../../src/core/features/carta/promos.guard";
import { CANTIDADES, LUGARES, MODOS, PLATOS, PREVIOS, esImposible, esperado, type Caso } from "./parte-de-promo.oraculo";

/**
 * E2a: el plan de UNA parte de promo contra su ORÁCULO (`parte-de-promo.oraculo.ts`, tabla escrita aparte), TODAS las combinaciones; la idempotencia de cada una; y el GUARDIÁN de dimensiones nuevas (un modo, un tipo de cupo o un campo del comando que
 * nadie declaró hace fallar este archivo hasta que se decida si cambia el resultado). Puro: sin base.
 *
 * Mutaciones demostradas (rojo y revertidas): no dar de baja el cupo de sección al pasar a «Solo estos platos» (rojo en la tabla); dejar activa la lista al pasar a «Toda la sección» (rojo); sacar el bloqueo de I12b (rojo); no rechazar la lista que se llama
 * como una sección que entra entera (rojo).
 */
const SECCION_ID = "sec-1";
const NOMBRE = "Entradas";
const ENTRADA = (over: Partial<CupoExistenteConSeccion>): CupoExistenteConSeccion => ({
  id: "c",
  tipo: "SECCION",
  activo: true,
  seccionCartaId: null,
  nombre: null,
  cantidadMinima: 1,
  cantidadMaxima: 2,
  orden: 0,
  nombreDeSeccion: null,
  ...over,
});
const entera = (activo: boolean) => ENTRADA({ id: "c-entera", tipo: "SECCION", seccionCartaId: SECCION_ID, nombreDeSeccion: NOMBRE, activo });
const lista = (activo: boolean, orden = 1) => ENTRADA({ id: "c-lista", tipo: "LISTA", nombre: NOMBRE, activo, orden });

/** Lo que había en la base según P (para un lugar SECCION; para una lista con nombre propio, solo las listas y los casos de choque). */
function previo(c: Caso): CupoExistenteConSeccion[] {
  switch (c.previo) {
    case "NADA":
      return [];
    case "ENTERA_ACTIVA":
      return [entera(true)];
    case "ENTERA_BAJA":
      return [entera(false)];
    case "LISTA_ACTIVA":
      return [lista(true)];
    case "LISTA_BAJA":
      return [lista(false)];
    case "AMBAS_ACTIVAS":
      return [entera(true), lista(true)];
    case "HOMONIMA_ENTERA":
      return [entera(true)];
    case "OTRO_TIPO":
      return [ENTRADA({ id: "c-otro", tipo: "DEL_DIA", nombre: NOMBRE, activo: true })];
  }
}

const cantidadDe = (c: Caso, hay: CupoExistenteConSeccion[]) => {
  const actual = hay.find((x) => x.activo)?.cantidadMaxima ?? 2;
  if (c.cantidad === "MIN_CERO") return { cantidadMinima: 0, cantidadMaxima: actual };
  return { cantidadMinima: 1, cantidadMaxima: c.cantidad === "IGUAL" ? actual : actual + 1 };
};

type PlanOk = Extract<ReturnType<typeof planDeParte>, { ok: true }>;

/** Aplica el plan a los cupos como lo haría la base (por id; los nuevos con id nuevo). */
function aplicar(hay: CupoExistenteConSeccion[], plan: PlanOk): CupoExistenteConSeccion[] {
  const salida = hay.map((x) => ({ ...x }));
  let n = 0;
  for (const o of plan.operaciones) {
    if (o.op === "BAJA") salida.find((x) => x.id === o.cupo.id)!.activo = false;
    else if (o.op === "CAMBIAR") Object.assign(salida.find((x) => x.id === o.estaba.id)!, { ...o.queda, activo: true, nombreDeSeccion: salida.find((x) => x.id === o.estaba.id)!.nombreDeSeccion });
    else salida.push({ ...o.cupo, id: `nuevo-${n++}`, activo: true, nombreDeSeccion: o.cupo.tipo === "SECCION" ? NOMBRE : null });
  }
  return salida;
}

const casos: Caso[] = LUGARES.flatMap((lugar) => MODOS.flatMap((modo) => PREVIOS.flatMap((previo) => PLATOS.flatMap((platos) => CANTIDADES.map((cantidad) => ({ lugar, modo, previo, platos, cantidad }))))))
  .filter((c) => !esImposible(c));

function correr(c: Caso) {
  const hay = previo(c);
  const cant = cantidadDe(c, hay);
  const parte = {
    lugar: c.lugar === "SECCION" ? ({ tipo: "SECCION", seccionCartaId: SECCION_ID, nombreDeSeccion: NOMBRE } as const) : ({ tipo: "LISTA", nombre: NOMBRE } as const),
    modo: c.modo,
    ...cant,
  };
  const bloqueo = motivoDeParteSinPlatos(c.modo, cant.cantidadMinima, c.platos === "ALGUNO" ? 1 : 0);
  return { hay, parte, bloqueo, plan: bloqueo ? null : planDeParte(hay, parte) };
}

describe("parte de promo: el oráculo contra TODAS las combinaciones", () => {
  it("hay un número cerrado de combinaciones posibles y ninguna queda sin regla", () => {
    expect(casos.length).toBeGreaterThan(100);
    for (const c of casos) expect(() => esperado(c)).not.toThrow();
  });

  it("el plan acepta o rechaza EXACTAMENTE lo que dice la tabla, y deja activos los cupos que la tabla dice", () => {
    for (const c of casos) {
      const e = esperado(c);
      const { hay, plan, bloqueo } = correr(c);
      const etiqueta = JSON.stringify(c);
      if (e.rechazo === "BLOQUEADA") {
        expect(bloqueo, etiqueta).not.toBeNull();
        continue;
      }
      expect(bloqueo, etiqueta).toBeNull();
      if (e.rechazo === "RECHAZADA") {
        expect(plan!.ok, etiqueta).toBe(false);
        continue;
      }
      expect(plan!.ok, etiqueta).toBe(true);
      const despues = aplicar(hay, plan as PlanOk);
      const activos = (tipo: string) => despues.filter((x) => x.activo && x.tipo === tipo && (tipo !== "LISTA" || (x.nombre ?? "").toLowerCase() === NOMBRE.toLowerCase())).length;
      expect(activos("SECCION") > 0, etiqueta).toBe(e.seccionActiva);
      expect(activos("LISTA") > 0, etiqueta).toBe(e.listaActiva);
      // I10: nunca los dos a la vez; y nunca dos activos del mismo clave.
      if (c.lugar === "SECCION") expect(activos("SECCION") + activos("LISTA") <= 1, etiqueta).toBe(true);
    }
  });

  it("R8: pedir lo mismo otra vez no deja ninguna operación (por estado)", () => {
    for (const c of casos) {
      const e = esperado(c);
      if (e.rechazo !== null) continue;
      const { hay, parte, plan } = correr(c);
      const despues = aplicar(hay, plan as PlanOk);
      const otra = planDeParte(despues, parte);
      expect(otra.ok, JSON.stringify(c)).toBe(true);
      expect((otra as PlanOk).operaciones, JSON.stringify(c)).toEqual([]);
    }
  });

  it("el estado final de los cupos activos alimenta el piso: cuenta TODAS las partes (las activas que no se tocaron y las nuevas)", () => {
    const otra = ENTRADA({ id: "c-otra", tipo: "SECCION", seccionCartaId: "sec-otra", nombreDeSeccion: "Postres", cantidadMinima: 0, cantidadMaxima: 3 });
    const r = planDeParte([otra], { lugar: { tipo: "SECCION", seccionCartaId: SECCION_ID, nombreDeSeccion: NOMBRE }, modo: "TODA", cantidadMinima: 1, cantidadMaxima: 2 });
    expect(r.ok && r.cuposFinales.map((c) => c.cantidadMaxima).sort()).toEqual([2, 3]);
  });
});

describe("GUARDIÁN: lo que cambia qué cupos quedan activos tiene que estar declarado", () => {
  it("los modos de la parte (`MODOS_DE_PARTE`) son exactamente los de la tabla: un modo nuevo obliga a declarar qué cambia", () => {
    expect([...MODOS_DE_PARTE].sort()).toEqual([...MODOS].sort());
  });

  it("los tipos de cupo (`TIPOS_DE_CUPO`) están declarados: SECCION y LISTA cambian lo que queda activo; DEL_DIA está retirado (la poda del 2026-11-13: no se crea ni se arma)", () => {
    expect([...TIPOS_DE_CUPO].sort()).toEqual(["DEL_DIA", "LISTA", "SECCION"]);
  });

  it("los campos del comando están declarados: cada uno cambia qué queda guardado (o es la identidad de la promo); uno nuevo obliga a decidir", () => {
    const fuente = readFileSync(join(__dirname, "../../src/core/features/carta/promos.guard.ts"), "utf8");
    const desde = fuente.indexOf("export function guardComandoGuardarParteDePromo");
    const cuerpo = fuente.slice(desde, fuente.indexOf("\n}\n", desde));
    const leidos = new Set([...cuerpo.matchAll(/\be\.(\w+)/g)].map((m) => m[1]));
    const DECLARADOS = ["promoCartaId", "lugar", "modo", "cantidadMinima", "cantidadMaxima", "entradas"];
    expect([...leidos].sort()).toEqual([...DECLARADOS].sort());
    // El lugar lleva exactamente estas claves (L del oráculo).
    const lugar = new Set([...cuerpo.matchAll(/\bl\.(\w+)/g)].map((m) => m[1]));
    expect([...lugar].sort()).toEqual(["nombre", "seccionCartaId", "tipo"]);
  });

  it("el guard rechaza lo que no está permitido: «Toda la sección» sin sección, una parte que no entra con cantidades o platos, un modo desconocido", () => {
    const base = { promoCartaId: "p1" };
    const seccion = { tipo: "SECCION", seccionCartaId: "s1" };
    expect(guardComandoGuardarParteDePromo({ ...base, lugar: { tipo: "LISTA", nombre: "X" }, modo: "TODA", cantidadMinima: 1, cantidadMaxima: 1 }).ok).toBe(false);
    expect(guardComandoGuardarParteDePromo({ ...base, lugar: seccion, modo: "NO_ENTRA", cantidadMaxima: 1 }).ok).toBe(false);
    expect(guardComandoGuardarParteDePromo({ ...base, lugar: seccion, modo: "NO_ENTRA" }).ok).toBe(true);
    expect(guardComandoGuardarParteDePromo({ ...base, lugar: seccion, modo: "TODOS", cantidadMinima: 1, cantidadMaxima: 1 }).ok).toBe(false);
    expect(guardComandoGuardarParteDePromo({ ...base, lugar: seccion, modo: "TODA", cantidadMinima: 1, cantidadMaxima: 1, entradas: [{ productoId: "x" }] }).ok).toBe(false);
    expect(guardComandoGuardarParteDePromo({ ...base, lugar: seccion, modo: "SOLO_ESTOS", cantidadMinima: 2, cantidadMaxima: 1 }).ok).toBe(false);
    expect(guardComandoGuardarParteDePromo({ ...base, lugar: seccion, modo: "SOLO_ESTOS", cantidadMinima: 1, cantidadMaxima: 1, entradas: [{ productoId: "x" }, { productoId: "y", opciones: "no" }] }).ok).toBe(false);
    const bien = guardComandoGuardarParteDePromo({ ...base, lugar: seccion, modo: "SOLO_ESTOS", cantidadMinima: "1", cantidadMaxima: "1", entradas: [{ productoId: "x" }] });
    expect(bien.ok && bien.valor.entradas).toEqual([{ productoId: "x", modoDeOpciones: "FIJAS", opciones: [] }]);
  });
});
