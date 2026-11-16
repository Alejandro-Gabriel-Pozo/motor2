import { describe, expect, it } from "vitest";
import {
  MAXIMO_DE_NIVELES_DE_CLASIFICACION,
  MOTIVOS_DE_RECHAZO_DE_CLASIFICACION,
  caminoDeNodo,
  destinosParaMover,
  nivelDeNodo,
  nombreDeNodoDesdeTexto,
  puedeCrearBajo,
  puedeDesactivar,
  puedeMover,
  puedeReactivar,
  puedeRenombrar,
  type ArbolDeClasificacion,
  type NodoDeClasificacion,
} from "@/core/catalogo/clasificacion-comercial";
import {
  REGLAS,
  esperadoCamino,
  esperadoCrear,
  esperadoDesactivar,
  esperadoDestinos,
  esperadoMover,
  esperadoReactivar,
  esperadoRenombrar,
  type Decision,
} from "./clasificacion-comercial-oraculo";

/**
 * Núcleo puro de la clasificación comercial contra su oráculo (test/catalogo/clasificacion-comercial-oraculo.ts), con recorrido EXHAUSTIVO sobre
 * árboles chicos: todas las formas de hasta 6 nodos (con todas las combinaciones activo/desactivado, incluidos los árboles que pasan el tope),
 * todos los árboles rotos de 4 nodos (ciclos, un nodo bajo sí mismo, un padre que no existe) y todas las combinaciones de nombres de hasta 4
 * nodos. Más un árbol lleno de 4 niveles con 3 hijos por nodo. Cada regla del oráculo tiene que ejercerse al menos una vez.
 */
const nodo = (id: string, padreId: string | null, activo = true, nombreClave = `nombre-${id}`): NodoDeClasificacion => ({ id, padreId, activo, nombreClave });
const arbolDe = (nodos: readonly NodoDeClasificacion[]): ArbolDeClasificacion => new Map(nodos.map((n) => [n.id, n]));
const claveDe = (r: { ok: boolean; error?: string }): string => (r.ok ? "permitido" : (r.error ?? "?"));

/** Los recorridos exhaustivos tardan unos segundos (cientos de miles de preguntas): el tope por defecto de Vitest (5 s) no alcanza. */
const TOPE_DEL_RECORRIDO = 180_000;

const reglasEjercidas = new Set<string>();
function comparar(etiqueta: string, real: string, esperado: Decision): void {
  reglasEjercidas.add(esperado.regla);
  if (real !== esperado.esperado) throw new Error(`${etiqueta}: el código dijo ${real} y la regla ${esperado.regla} espera ${esperado.esperado}`);
}

/** Todas las operaciones sobre un árbol, contra el oráculo. `claves` son los nombres candidatos para crear y renombrar. */
function recorrer(arbol: ArbolDeClasificacion, etiqueta: string, claves: readonly string[]): void {
  const ids = [...arbol.keys(), "no-existe"];
  for (const id of ids) {
    const camino = caminoDeNodo(arbol, id);
    const nivel = nivelDeNodo(arbol, id);
    const ec = esperadoCamino(arbol, id);
    comparar(`${etiqueta} camino(${id})`, claveDe(camino), ec);
    comparar(`${etiqueta} nivel(${id})`, claveDe(nivel), ec);
    if (camino.ok) {
      expect(camino.valor, `${etiqueta} camino(${id})`).toEqual(ec.camino);
      expect(nivel.ok && nivel.valor).toBe(camino.valor.length);
    }
    comparar(`${etiqueta} desactivar(${id})`, claveDe(puedeDesactivar(arbol, id)), esperadoDesactivar(arbol, id));
    comparar(`${etiqueta} reactivar(${id})`, claveDe(puedeReactivar(arbol, id)), esperadoReactivar(arbol, id));
    for (const clave of claves) comparar(`${etiqueta} renombrar(${id},${clave})`, claveDe(puedeRenombrar(arbol, id, clave)), esperadoRenombrar(arbol, id, clave));
    for (const destino of ids) comparar(`${etiqueta} mover(${id}→${destino})`, claveDe(puedeMover(arbol, id, destino)), esperadoMover(arbol, id, destino));
    expect(destinosParaMover(arbol, id), `${etiqueta} destinos(${id})`).toEqual(esperadoDestinos(arbol, id));
  }
  for (const padre of [null, ...ids]) {
    for (const clave of claves) comparar(`${etiqueta} crear(${padre},${clave})`, claveDe(puedeCrearBajo(arbol, padre, clave)), esperadoCrear(arbol, padre, clave));
  }
}

describe("clasificación comercial: el código contra el oráculo", () => {
  it("todas las formas de hasta 6 nodos, con todas las combinaciones activo/desactivado (incluye árboles que pasan el tope)", () => {
    let casos = 0;
    for (let n = 1; n <= 6; n++) {
      // El padre del nodo i es null (departamento) o uno anterior: toda forma posible de un bosque de n nodos.
      const padres: (number | null)[] = new Array<number | null>(n).fill(null);
      const generar = (i: number): void => {
        if (i === n) {
          for (let mascara = 0; mascara < 1 << n; mascara++) {
            const nodos = padres.map((p, k) => nodo(`n${k}`, p === null ? null : `n${p}`, (mascara & (1 << k)) === 0));
            recorrer(arbolDe(nodos), `n=${n} padres=${padres.join(",")} mascara=${mascara}`, ["x"]);
            casos++;
          }
          return;
        }
        padres[i] = null;
        generar(i + 1);
        for (let p = 0; p < i; p++) {
          padres[i] = p;
          generar(i + 1);
        }
      };
      generar(0);
    }
    expect(casos).toBe(1 * 2 + 2 * 4 + 6 * 8 + 24 * 16 + 120 * 32 + 720 * 64);
  }, TOPE_DEL_RECORRIDO);

  it("todos los árboles rotos de 4 nodos: ciclos, un nodo bajo sí mismo y un padre que no existe: nunca se interpretan", () => {
    const opciones = (k: number): (string | null)[] => [null, "n0", "n1", "n2", "n3", "fantasma"].filter((_, i) => i !== 5 || k >= 0);
    let casos = 0;
    for (const p0 of opciones(0)) for (const p1 of opciones(1)) for (const p2 of opciones(2)) for (const p3 of opciones(3)) {
      for (let mascara = 0; mascara < 16; mascara++) {
        const nodos = [p0, p1, p2, p3].map((p, k) => nodo(`n${k}`, p, (mascara & (1 << k)) === 0));
        recorrer(arbolDe(nodos), `roto ${[p0, p1, p2, p3].join(",")} mascara=${mascara}`, ["x"]);
        casos++;
      }
    }
    expect(casos).toBe(6 ** 4 * 16);
  }, TOPE_DEL_RECORRIDO);

  it("todas las combinaciones de nombres (a, b) en árboles de hasta 4 nodos, con crear y renombrar a a, b y c", () => {
    for (let n = 1; n <= 4; n++) {
      const padres: (number | null)[] = new Array<number | null>(n).fill(null);
      const generar = (i: number): void => {
        if (i === n) {
          for (let claves = 0; claves < 1 << n; claves++) {
            for (let mascara = 0; mascara < 1 << n; mascara++) {
              const nodos = padres.map((p, k) => nodo(`n${k}`, p === null ? null : `n${p}`, (mascara & (1 << k)) === 0, (claves & (1 << k)) === 0 ? "a" : "b"));
              recorrer(arbolDe(nodos), `n=${n} padres=${padres.join(",")} claves=${claves} mascara=${mascara}`, ["a", "b", "c"]);
            }
          }
          return;
        }
        padres[i] = null;
        generar(i + 1);
        for (let p = 0; p < i; p++) {
          padres[i] = p;
          generar(i + 1);
        }
      };
      generar(0);
    }
  }, TOPE_DEL_RECORRIDO);

  it("un árbol lleno: 3 departamentos de 4 niveles con 3 hijos por nodo (120 nodos), todo activo y con cada 7.º nodo desactivado", () => {
    for (const cadaCuantos of [0, 7]) {
      const nodos: NodoDeClasificacion[] = [];
      let contador = 0;
      const llenar = (padre: string | null, nivel: number): void => {
        const cuantos = padre === null ? 3 : 3;
        for (let h = 0; h < cuantos; h++) {
          const id = `x${contador++}`;
          nodos.push(nodo(id, padre, cadaCuantos === 0 ? true : contador % cadaCuantos !== 0));
          if (nivel < MAXIMO_DE_NIVELES_DE_CLASIFICACION) llenar(id, nivel + 1);
        }
      };
      llenar(null, 1);
      expect(nodos).toHaveLength(3 * (1 + 3 + 9 + 27));
      const arbol = arbolDe(nodos);
      // Ningún nodo del último nivel admite hijos; ninguno de los demás pasa el tope al crear (si está activo).
      for (const n of nodos) {
        const nivel = nivelDeNodo(arbol, n.id);
        expect(nivel.ok).toBe(true);
        if (nivel.ok && nivel.valor === MAXIMO_DE_NIVELES_DE_CLASIFICACION && n.activo) {
          expect(claveDe(puedeCrearBajo(arbol, n.id, "nuevo"))).toBe("TOPE_DE_NIVELES");
        }
      }
      recorrerMuestra(arbol, nodos);
    }
  }, TOPE_DEL_RECORRIDO);

  it("cada regla del oráculo se ejerció al menos una vez, y todo motivo de rechazo del código aparece en alguna regla", () => {
    const sinEjercer = Object.keys(REGLAS).filter((r) => !reglasEjercidas.has(r));
    expect(sinEjercer, `reglas del oráculo que ningún caso ejerció: ${sinEjercer.join(", ")}`).toEqual([]);
    const desconocidas = [...reglasEjercidas].filter((r) => !(r in REGLAS));
    expect(desconocidas, "reglas usadas que no están en la tabla").toEqual([]);
    for (const motivo of MOTIVOS_DE_RECHAZO_DE_CLASIFICACION) {
      expect(Object.values(REGLAS).some((texto) => texto.includes(motivo)), `el motivo ${motivo} no figura en ninguna regla`).toBe(true);
    }
  });
});

/** Compara todos los pares del árbol lleno contra el oráculo (120 × 121 movimientos, sin repetir el recorrido completo de los chicos). */
function recorrerMuestra(arbol: ArbolDeClasificacion, nodos: readonly NodoDeClasificacion[]): void {
  for (const a of nodos) {
    for (const b of nodos) comparar(`lleno mover(${a.id}→${b.id})`, claveDe(puedeMover(arbol, a.id, b.id)), esperadoMover(arbol, a.id, b.id));
    comparar(`lleno desactivar(${a.id})`, claveDe(puedeDesactivar(arbol, a.id)), esperadoDesactivar(arbol, a.id));
    comparar(`lleno reactivar(${a.id})`, claveDe(puedeReactivar(arbol, a.id)), esperadoReactivar(arbol, a.id));
    comparar(`lleno crear(${a.id})`, claveDe(puedeCrearBajo(arbol, a.id, "nuevo")), esperadoCrear(arbol, a.id, "nuevo"));
  }
}

describe("clasificación comercial: casos con nombre propio", () => {
  const arbol = arbolDe([nodo("d", null), nodo("c1", "d"), nodo("c2", "c1"), nodo("c3", "c2"), nodo("otro", null)]);

  it("el tope es 4 y un departamento no se mueve", () => {
    expect(MAXIMO_DE_NIVELES_DE_CLASIFICACION).toBe(4);
    expect(claveDe(puedeMover(arbol, "d", "otro"))).toBe("DEPARTAMENTO_NO_SE_MUEVE");
    expect(claveDe(puedeCrearBajo(arbol, "c3", "nuevo"))).toBe("TOPE_DE_NIVELES");
    expect(caminoDeNodo(arbol, "c3")).toEqual({ ok: true, valor: ["d", "c1", "c2", "c3"] });
  });

  it("mover un subárbol bajo un departamento que lo haría pasar el tope se rechaza; bajo uno vacío entra", () => {
    // c1 (altura 3) bajo `otro` (nivel 1): 1 + 3 = 4, entra. Bajo c3 sería un ciclo; el departamento ni se mueve.
    expect(claveDe(puedeMover(arbol, "c1", "otro"))).toBe("permitido");
    const conOtraRama = arbolDe([...arbol.values(), nodo("o2", "otro"), nodo("o3", "o2")]);
    expect(claveDe(puedeMover(conOtraRama, "c1", "o2"))).toBe("TOPE_DE_NIVELES");
    expect(claveDe(puedeMover(conOtraRama, "c1", "c3"))).toBe("CICLO");
    expect(claveDe(puedeMover(conOtraRama, "c1", "c1"))).toBe("CICLO");
  });

  it("un árbol roto no se interpreta: ciclo, padre que falta y exceso de niveles", () => {
    const ciclo = arbolDe([nodo("a", "b"), nodo("b", "a")]);
    expect(caminoDeNodo(ciclo, "a")).toEqual({ ok: false, error: "ARBOL_INCONSISTENTE" });
    const huerfano = arbolDe([nodo("a", "fantasma")]);
    expect(nivelDeNodo(huerfano, "a")).toEqual({ ok: false, error: "ARBOL_INCONSISTENTE" });
    const cadena5 = arbolDe([nodo("1", null), nodo("2", "1"), nodo("3", "2"), nodo("4", "3"), nodo("5", "4")]);
    expect(caminoDeNodo(cadena5, "5")).toEqual({ ok: false, error: "ARBOL_INCONSISTENTE" });
    expect(claveDe(puedeCrearBajo(cadena5, "5", "x"))).toBe("ARBOL_INCONSISTENTE");
  });

  it("desactivar y reactivar: no con hijos activos, no bajo un desactivado", () => {
    expect(claveDe(puedeDesactivar(arbol, "d"))).toBe("TIENE_HIJOS_ACTIVOS");
    const apagado = arbolDe([nodo("d", null, false), nodo("c", "d", false)]);
    expect(claveDe(puedeDesactivar(apagado, "d"))).toBe("permitido");
    expect(claveDe(puedeReactivar(apagado, "c"))).toBe("PADRE_DESACTIVADO");
    expect(claveDe(puedeReactivar(apagado, "d"))).toBe("permitido");
  });

  it("el nombre es único entre hermanos aun desactivados, pero se repite entre ramas distintas", () => {
    const a = arbolDe([nodo("d1", null, true, "bebidas"), nodo("d2", null, true, "comidas"), nodo("h", "d1", false, "gaseosas")]);
    expect(claveDe(puedeCrearBajo(a, null, "bebidas"))).toBe("NOMBRE_REPETIDO_ENTRE_HERMANOS");
    expect(claveDe(puedeCrearBajo(a, "d1", "gaseosas"))).toBe("NOMBRE_REPETIDO_ENTRE_HERMANOS");
    expect(claveDe(puedeCrearBajo(a, "d2", "gaseosas"))).toBe("permitido");
    expect(claveDe(puedeRenombrar(a, "d2", "bebidas"))).toBe("NOMBRE_REPETIDO_ENTRE_HERMANOS");
    expect(claveDe(puedeRenombrar(a, "d2", "comidas"))).toBe("permitido");
    expect(claveDe(puedeMover(arbolDe([...a.values(), nodo("g2", "d2", true, "gaseosas")]), "g2", "d1"))).toBe("NOMBRE_REPETIDO_ENTRE_HERMANOS");
  });

  it("es pura: repetir la pregunta da lo mismo y la foto no cambia", () => {
    const antes = JSON.stringify([...arbol.entries()]);
    for (let i = 0; i < 3; i++) {
      expect(claveDe(puedeMover(arbol, "c1", "otro"))).toBe("permitido");
      expect(destinosParaMover(arbol, "c1")).toEqual(destinosParaMover(arbol, "c1"));
    }
    expect(JSON.stringify([...arbol.entries()])).toBe(antes);
  });

  it("el nombre del nodo es el de una sección de la carta: 1 a 80, sin exigir letra, y lo que no es texto se rechaza", () => {
    expect(nombreDeNodoDesdeTexto("2x1")).toEqual({ ok: true, valor: "2x1" });
    expect(nombreDeNodoDesdeTexto("")).toEqual({ ok: false, error: "VACIO" });
    expect(nombreDeNodoDesdeTexto("a".repeat(81)).ok).toBe(false);
    expect(nombreDeNodoDesdeTexto(42)).toEqual({ ok: false, error: "VACIO" });
  });
});
