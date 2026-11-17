import { describe, expect, it } from "vitest";
import { guardComandoFijarModoDeOrdenDeSeccion, guardComandoReordenarRenglonesDeSeccion } from "@/core/features/carta/orden-de-renglones.guard";
import { MAXIMO_DE_RENGLONES_AL_ORDENAR } from "@/core/features/carta/orden-de-renglones.schema";

/**
 * Etapa O1: el formato de los pedidos, por LISTA DE PERMITIDOS (modo de una lista cerrada, ids con forma de id, versión entera acotada, tope de renglones). Todo lo demás se rechaza antes de tocar la base.
 */
const renglon = (id: string, ordenVisto = 0, tipo: unknown = "PRODUCTO") => ({ tipo, id, ordenVisto });

describe("guard de «fijar el modo de orden de una sección»", () => {
  it("acepta exactamente lo permitido", () => {
    expect(guardComandoFijarModoDeOrdenDeSeccion({ seccionCartaId: "cm0abc123", modo: "ALFABETICO", versionVista: 0 })).toEqual({ ok: true, valor: { seccionCartaId: "cm0abc123", modo: "ALFABETICO", versionVista: 0 } });
    expect(guardComandoFijarModoDeOrdenDeSeccion({ seccionCartaId: "a-b_C9", modo: "A_MANO", versionVista: 12 }).ok).toBe(true);
  });

  it("rechaza lo que no es exactamente un modo de la lista cerrada, un id con forma de id o una versión entera acotada", () => {
    const base = { seccionCartaId: "s1", modo: "A_MANO", versionVista: 1 };
    for (const modo of [undefined, null, "", "alfabetico", "ALFABETICO ", "AL_AZAR", 1, {}]) expect(guardComandoFijarModoDeOrdenDeSeccion({ ...base, modo }).ok, `modo ${String(modo)}`).toBe(false);
    for (const id of [undefined, null, "", "a b", "a/b", "../x", "a".repeat(65), 7, "' OR 1=1 --"]) expect(guardComandoFijarModoDeOrdenDeSeccion({ ...base, seccionCartaId: id }).ok, `id ${String(id)}`).toBe(false);
    for (const v of [undefined, null, "1", -1, 1.5, NaN, Infinity, 1_000_001]) expect(guardComandoFijarModoDeOrdenDeSeccion({ ...base, versionVista: v }).ok, `versión ${String(v)}`).toBe(false);
  });
});

describe("guard de «reordenar los renglones de una sección»", () => {
  it("acepta una lista de 1 al tope, sin repetidos, con tipo permitido, id con forma de id y ordenVisto entero", () => {
    const r = guardComandoReordenarRenglonesDeSeccion({ seccionCartaId: "s1", renglones: [renglon("p1", 0), renglon("a1", 1, "ITEM_AGRUPADO"), renglon("p2", -3)] });
    expect(r).toEqual({ ok: true, valor: { seccionCartaId: "s1", renglones: [renglon("p1", 0), renglon("a1", 1, "ITEM_AGRUPADO"), renglon("p2", -3)] } });
    // El mismo id con distinto tipo son dos renglones distintos.
    expect(guardComandoReordenarRenglonesDeSeccion({ seccionCartaId: "s1", renglones: [renglon("x", 0, "PRODUCTO"), renglon("x", 1, "ITEM_AGRUPADO")] }).ok).toBe(true);
  });

  it("rechaza lista vacía, que no sea lista, repetidos, tipos fuera de la lista cerrada, ids sin forma, ordenVisto que no es un entero (ni como texto) y más del tope", () => {
    const ok = [renglon("p1")];
    for (const renglones of [undefined, null, [], "p1", {}, 0]) expect(guardComandoReordenarRenglonesDeSeccion({ seccionCartaId: "s1", renglones }).ok, `lista ${String(renglones)}`).toBe(false);
    expect(guardComandoReordenarRenglonesDeSeccion({ seccionCartaId: "", renglones: ok }).ok).toBe(false);
    expect(guardComandoReordenarRenglonesDeSeccion({ seccionCartaId: "s1", renglones: [renglon("p1"), renglon("p1", 1)] }).ok).toBe(false);
    for (const tipo of [null, "", "producto", "PROMO", 1]) expect(guardComandoReordenarRenglonesDeSeccion({ seccionCartaId: "s1", renglones: [renglon("p1", 0, tipo)] }).ok, `tipo ${String(tipo)}`).toBe(false);
    for (const id of [undefined, "", "p 1", "p;1", "a".repeat(65), 4]) expect(guardComandoReordenarRenglonesDeSeccion({ seccionCartaId: "s1", renglones: [{ tipo: "PRODUCTO", id, ordenVisto: 0 }] }).ok, `id ${String(id)}`).toBe(false);
    for (const ordenVisto of [undefined, "0", 1.5, NaN, 100_001, null]) expect(guardComandoReordenarRenglonesDeSeccion({ seccionCartaId: "s1", renglones: [{ tipo: "PRODUCTO", id: "p1", ordenVisto }] }).ok, `orden ${String(ordenVisto)}`).toBe(false);
    expect(guardComandoReordenarRenglonesDeSeccion({ seccionCartaId: "s1", renglones: [null] }).ok).toBe(false);
    const demasiados = Array.from({ length: MAXIMO_DE_RENGLONES_AL_ORDENAR + 1 }, (_, i) => renglon(`p${i}`, i));
    expect(guardComandoReordenarRenglonesDeSeccion({ seccionCartaId: "s1", renglones: demasiados })).toMatchObject({ ok: false, codigo: "rango" });
    expect(guardComandoReordenarRenglonesDeSeccion({ seccionCartaId: "s1", renglones: demasiados.slice(0, MAXIMO_DE_RENGLONES_AL_ORDENAR) }).ok).toBe(true);
  });
});
