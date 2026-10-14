import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { lugaresParaPoner, ponerEnElLugar } from "../../src/core/carta/mantenimiento";
import { guardComandoOrdenarSeccionesCarta } from "../../src/core/features/carta/secciones.guard";

/**
 * CARTA-MANT F3 (fila O.486 de docs/pureza-integracion.md): «Ordenar» tocando (prototipo aprobado): se toca la sección que se quiere mover y después el hueco donde va. Las dos reglas puras que usa la
 * pantalla, y el guard del pedido que llega a la Server Action.
 */
describe("lugaresParaPoner", () => {
  it("todos los huecos (antes del primero, entre dos, al final) menos los dos que la dejarían donde está; sin nada elegido, ninguno", () => {
    expect(lugaresParaPoner(4, null)).toEqual([]);
    expect(lugaresParaPoner(4, 0)).toEqual([2, 3, 4]);
    expect(lugaresParaPoner(4, 2)).toEqual([0, 1, 4]);
    expect(lugaresParaPoner(4, 3)).toEqual([0, 1, 2]);
    expect(lugaresParaPoner(1, 0)).toEqual([]);
    expect(lugaresParaPoner(4, 7)).toEqual([]);
  });
});

describe("ponerEnElLugar", () => {
  const secciones = ["Entradas", "Platos principales", "Bebidas", "Postres"];
  it("como en el prototipo: «Postres» antes de «Bebidas», «Entradas» al final o antes de «Bebidas» (hacia abajo, el hueco cuenta sin ella), y fuera de rango no cambia nada", () => {
    expect(ponerEnElLugar(secciones, 0, 2)).toEqual(["Platos principales", "Entradas", "Bebidas", "Postres"]);
    expect(ponerEnElLugar(secciones, 3, 2)).toEqual(["Entradas", "Platos principales", "Postres", "Bebidas"]);
    expect(ponerEnElLugar(secciones, 0, 4)).toEqual(["Platos principales", "Bebidas", "Postres", "Entradas"]);
    expect(ponerEnElLugar(secciones, 1, 0)).toEqual(["Platos principales", "Entradas", "Bebidas", "Postres"]);
    expect(ponerEnElLugar(secciones, 5, 0)).toEqual(secciones);
    expect(ponerEnElLugar(secciones, 0, 9)).toEqual(secciones);
  });

  it("propiedad: siempre es una permutación (no pierde ni duplica); lo elegido queda justo antes de lo que estaba en el hueco (o al final) y el resto conserva su orden", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string(), { minLength: 1, maxLength: 12 }).chain((lista) => fc.tuple(fc.constant(lista), fc.nat(lista.length - 1), fc.nat(lista.length))),
        ([lista, elegido, destino]) => {
          const nueva = ponerEnElLugar(lista, elegido, destino);
          expect([...nueva].sort()).toEqual([...lista].sort());
          const movido = lista[elegido]!;
          const sinMovido = (l: string[]) => l.filter((x) => x !== movido);
          expect(sinMovido(nueva)).toEqual(sinMovido(lista));
          const siguiente = lista[destino];
          if (destino === lista.length) expect(nueva[nueva.length - 1]).toBe(movido);
          else if (destino !== elegido) expect(nueva[nueva.indexOf(movido) + 1]).toBe(siguiente);
          // Un hueco que NO ofrece `lugaresParaPoner` es justamente uno que deja la lista igual.
          if (!lugaresParaPoner(lista.length, elegido).includes(destino)) expect(nueva).toEqual(lista);
        }
      )
    );
  });
});

describe("guardComandoOrdenarSeccionesCarta", () => {
  it("la lista entera (de 1 al tope, sin repetidas), cada una con su id y su orden visto como número entero", () => {
    expect(guardComandoOrdenarSeccionesCarta({ secciones: [{ seccionCartaId: "a", ordenVisto: 1 }, { seccionCartaId: "b", ordenVisto: 0 }] })).toEqual({
      ok: true,
      valor: { secciones: [{ seccionCartaId: "a", ordenVisto: 1 }, { seccionCartaId: "b", ordenVisto: 0 }] },
    });
    for (const malo of [undefined, [], "a", [{ seccionCartaId: "a" }], [{ seccionCartaId: "a", ordenVisto: "1" }], [{ seccionCartaId: "a", ordenVisto: 1.5 }], [{ seccionCartaId: 3, ordenVisto: 1 }], [{ seccionCartaId: "", ordenVisto: 1 }]]) {
      expect(guardComandoOrdenarSeccionesCarta({ secciones: malo }).ok, JSON.stringify(malo)).toBe(false);
    }
    expect(guardComandoOrdenarSeccionesCarta({ secciones: [{ seccionCartaId: "a", ordenVisto: 0 }, { seccionCartaId: "a", ordenVisto: 1 }] })).toMatchObject({ ok: false, mensaje: "El orden repite una sección: recargá la pantalla." });
    expect(guardComandoOrdenarSeccionesCarta({ secciones: Array.from({ length: 201 }, (_, i) => ({ seccionCartaId: `s${i}`, ordenVisto: i })) }).ok).toBe(false);
  });
});
