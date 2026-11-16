import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  MAXIMO_DE_NIVELES_DE_CLASIFICACION,
  caminoDeNodo,
  puedeCrearBajo,
  puedeDesactivar,
  puedeMover,
  puedeReactivar,
  type ArbolDeClasificacion,
} from "@/core/catalogo/clasificacion-comercial";

/**
 * Propiedad: aplicando SOLO lo que las reglas permiten, en cualquier orden, el árbol nunca deja de cumplir sus invariantes (sin ciclos, nunca
 * más de 4 niveles, un nodo activo siempre cuelga de uno activo, un nombre por hermano). Es lo que las reglas existen para garantizar: la
 * etapa con base repite lo mismo con disparadores, y una prueba de integración los compara.
 */
type Paso = { op: "crear" | "mover" | "desactivar" | "reactivar"; a: number; b: number; nombre: number };
const pasos = fc.array(
  fc.record({ op: fc.constantFrom("crear", "mover", "desactivar", "reactivar"), a: fc.nat(40), b: fc.nat(40), nombre: fc.nat(3) }),
  { maxLength: 80 },
);

function aplicar(inicial: ArbolDeClasificacion, secuencia: readonly Paso[]): ArbolDeClasificacion {
  let arbol = inicial;
  let contador = 0;
  for (const p of secuencia) {
    const ids = [...arbol.keys()];
    const objetivo = ids[p.a % ids.length] ?? null;
    const sig = new Map(arbol);
    if (p.op === "crear") {
      const padre = p.b % 5 === 0 ? null : objetivo;
      const clave = `n${p.nombre}`;
      if (puedeCrearBajo(arbol, padre, clave).ok) {
        const id = `z${contador++}`;
        sig.set(id, { id, padreId: padre, activo: true, nombreClave: clave });
      }
    } else if (objetivo !== null) {
      const n = arbol.get(objetivo)!;
      if (p.op === "mover") {
        const destino = ids[p.b % ids.length]!;
        if (puedeMover(arbol, objetivo, destino).ok) sig.set(objetivo, { ...n, padreId: destino });
      } else if (p.op === "desactivar") {
        if (puedeDesactivar(arbol, objetivo).ok) sig.set(objetivo, { ...n, activo: false });
      } else if (puedeReactivar(arbol, objetivo).ok) sig.set(objetivo, { ...n, activo: true });
    }
    arbol = sig;
  }
  return arbol;
}

function invariantes(arbol: ArbolDeClasificacion): void {
  const vistas = new Set<string>();
  for (const n of arbol.values()) {
    const camino = caminoDeNodo(arbol, n.id);
    expect(camino.ok, `${n.id} tiene que tener un camino sano`).toBe(true);
    if (camino.ok) expect(camino.valor.length).toBeLessThanOrEqual(MAXIMO_DE_NIVELES_DE_CLASIFICACION);
    if (n.activo && n.padreId !== null) expect(arbol.get(n.padreId)?.activo, `${n.id} activo bajo un desactivado`).toBe(true);
    const unico = `${n.padreId ?? "∅"}|${n.nombreClave}`;
    expect(vistas.has(unico), `nombre repetido entre hermanos: ${unico}`).toBe(false);
    vistas.add(unico);
  }
}

describe("clasificación comercial: propiedades", () => {
  it("lo que las reglas permiten, en cualquier orden, deja siempre un árbol que cumple sus invariantes", () => {
    const base: ArbolDeClasificacion = new Map([
      ["d1", { id: "d1", padreId: null, activo: true, nombreClave: "d1" }],
      ["d2", { id: "d2", padreId: null, activo: true, nombreClave: "d2" }],
    ]);
    fc.assert(
      fc.property(pasos, (secuencia) => {
        invariantes(aplicar(base, secuencia));
      }),
      { numRuns: 300 },
    );
  });
});
