import { describe, expect, it } from "vitest";
import { guardComandoReemplazarCartaDeSucursal } from "../../src/core/features/carta/copiar-carta.guard";
import { cartaCopiadaPara, cartaTieneAlgo, cuentaDeCarta, decidirCopiaDeCarta, firmaDeCarta, fotoDeCartaEliminada, type CartaDeSucursal, type ContenidoDeCarta } from "../../src/core/features/carta/reemplazar-carta";
import { PRESENCIAS, esperadoDeCopiar, esperadoDeReemplazar, nombreDe, tieneCarta } from "../carta/reemplazar-carta.oraculo";

const contenido = (productoId: string, extra: Partial<ContenidoDeCarta> = {}): ContenidoDeCarta => ({
  productoId,
  visibleEnCarta: true,
  seccionCartaId: "s1",
  descripcion: null,
  tags: [],
  especial: false,
  orden: 0,
  generoCartaId: null,
  mostrarNombreArriba: false,
  nombreEnCarta: null,
  ...extra,
});

const carta = (c: Partial<CartaDeSucursal> = {}): CartaDeSucursal => ({ generos: [], items: [], contenidos: [], ...c });

describe("decidirCopiaDeCarta contra el oráculo (todas las combinaciones de presencia)", () => {
  for (const destino of PRESENCIAS) {
    for (const origen of PRESENCIAS) {
      it(`destino ${nombreDe(destino)} × origen ${nombreDe(origen)}`, () => {
        const base = { destinoTieneCarta: tieneCarta(destino), origenTieneCarta: tieneCarta(origen), sonIguales: false };
        const copiar = esperadoDeCopiar(destino, origen);
        expect(decidirCopiaDeCarta({ modo: "COPIAR", ...base })).toBe(copiar.ok ? "APLICAR" : copiar.codigo);
        const reemplazar = esperadoDeReemplazar(destino, origen);
        expect(decidirCopiaDeCarta({ modo: "REEMPLAZAR", ...base })).toBe(reemplazar.ok ? "APLICAR" : reemplazar.codigo);
      });
    }
  }

  it("un destino ya igual no cambia (solo en REEMPLAZAR y solo si tiene carta); en COPIAR «igual» no importa", () => {
    expect(decidirCopiaDeCarta({ modo: "REEMPLAZAR", destinoTieneCarta: true, origenTieneCarta: true, sonIguales: true })).toBe("SIN_CAMBIO");
    expect(decidirCopiaDeCarta({ modo: "REEMPLAZAR", destinoTieneCarta: false, origenTieneCarta: true, sonIguales: true })).toBe("APLICAR");
    expect(decidirCopiaDeCarta({ modo: "COPIAR", destinoTieneCarta: true, origenTieneCarta: true, sonIguales: true })).toBe("CARTA_PROPIA_EXISTENTE");
  });
});

describe("firmaDeCarta: compara por contenido, no por ids ni por orden de lectura", () => {
  it("dos cartas iguales con otros ids y otro orden tienen la misma firma", () => {
    const a = carta({
      generos: [{ id: "g1", nombre: "Cervezas", orden: 1, activo: true }, { id: "g2", nombre: "Vinos", orden: 2, activo: true }],
      items: [{ nombre: "Gaseosas", seccionCartaId: "s1", descripcion: null, tags: [], especial: false, orden: 0, activo: true, generoCartaId: "g1", opciones: [{ productoId: "p2", orden: 1 }, { productoId: "p1", orden: 0 }] }],
      contenidos: [contenido("p3", { generoCartaId: "g2" }), contenido("p4")],
    });
    const b = carta({
      generos: [{ id: "x9", nombre: "Vinos", orden: 2, activo: true }, { id: "x8", nombre: "Cervezas", orden: 1, activo: true }],
      items: [{ nombre: "Gaseosas", seccionCartaId: "s1", descripcion: null, tags: [], especial: false, orden: 0, activo: true, generoCartaId: "x8", opciones: [{ productoId: "p1", orden: 0 }, { productoId: "p2", orden: 1 }] }],
      contenidos: [contenido("p4"), contenido("p3", { generoCartaId: "x9" })],
    });
    expect(firmaDeCarta(a)).toBe(firmaDeCarta(b));
  });

  it("cada campo copiable cambia la firma", () => {
    const base = carta({ generos: [{ id: "g", nombre: "G", orden: 0, activo: true }], contenidos: [contenido("p1", { generoCartaId: "g" })] });
    const variantes: CartaDeSucursal[] = [
      carta({ ...base, generos: [{ id: "g", nombre: "G", orden: 1, activo: true }] }),
      carta({ ...base, generos: [{ id: "g", nombre: "G", orden: 0, activo: false }] }),
      carta({ ...base, contenidos: [contenido("p1")] }),
      carta({ ...base, contenidos: [contenido("p1", { generoCartaId: "g", visibleEnCarta: false })] }),
      carta({ ...base, contenidos: [contenido("p1", { generoCartaId: "g", nombreEnCarta: "Otro" })] }),
      carta({ ...base, contenidos: [contenido("p1", { generoCartaId: "g", mostrarNombreArriba: true })] }),
      carta({ ...base, contenidos: [contenido("p1", { generoCartaId: "g", tags: ["x"] })] }),
      carta({ ...base, contenidos: [contenido("p2", { generoCartaId: "g" })] }),
    ];
    for (const v of variantes) expect(firmaDeCarta(v)).not.toBe(firmaDeCarta(base));
  });
});

describe("cartaCopiadaPara: la regla del nombre en carta (2026-11-04)", () => {
  it("el nombre que choca con el título de una promo del destino no se copia y se informa; el resto sí", () => {
    const origen = carta({ contenidos: [contenido("p1", { nombreEnCarta: "Combo Familiar" }), contenido("p2", { nombreEnCarta: "Pizza" })] });
    const { carta: copiada, sinCopiarElNombre } = cartaCopiadaPara(origen, new Set(["combo familiar"]));
    expect(sinCopiarElNombre.map((c) => c.productoId)).toEqual(["p1"]);
    expect(copiada.contenidos.map((c) => c.nombreEnCarta)).toEqual([null, "Pizza"]);
    // No toca el origen.
    expect(origen.contenidos[0].nombreEnCarta).toBe("Combo Familiar");
  });
});

describe("cuentas y foto", () => {
  it("cuentaDeCarta y cartaTieneAlgo", () => {
    expect(cartaTieneAlgo(carta())).toBe(false);
    expect(cartaTieneAlgo(carta({ contenidos: [contenido("p1")] }))).toBe(true);
    expect(cuentaDeCarta(carta({ generos: [{ id: "g", nombre: "G", orden: 0, activo: true }], contenidos: [contenido("p1"), contenido("p2")] }))).toEqual({ productos: 2, itemsAgrupados: 0, generos: 1 });
  });

  it("la foto de lo eliminado nombra los productos y es determinista", () => {
    const c = carta({ generos: [{ id: "g", nombre: "Cervezas", orden: 1, activo: true }], contenidos: [contenido("p2", { generoCartaId: "g" }), contenido("p1")] });
    const nombres = new Map([["p1", "Bife"], ["p2", "IPA"]]);
    const foto = JSON.parse(fotoDeCartaEliminada(c, nombres)) as { productos: { producto: string; genero: string | null }[]; generos: { nombre: string }[] };
    expect(foto.productos.map((p) => p.producto)).toEqual(["Bife", "IPA"]);
    expect(foto.productos[1].genero).toBe("Cervezas");
    expect(foto.generos).toEqual([{ nombre: "Cervezas", orden: 1, activo: true }]);
    expect(fotoDeCartaEliminada(c, nombres)).toBe(fotoDeCartaEliminada({ ...c, contenidos: [...c.contenidos].reverse() }, nombres));
  });
});

describe("guardComandoReemplazarCartaDeSucursal", () => {
  const base = { sucursalOrigenId: "o", sucursalActivaId: "d", sucursalActivaNombre: "Sucursal Norte" };
  it("exige escribir el nombre de la sucursal activa (sin importar mayúsculas ni espacios de los costados)", () => {
    expect(guardComandoReemplazarCartaDeSucursal({ ...base, nombreEscrito: "  sucursal NORTE " })).toMatchObject({ ok: true, valor: { sucursalOrigenId: "o" } });
    expect(guardComandoReemplazarCartaDeSucursal({ ...base, nombreEscrito: "" })).toMatchObject({ ok: false });
    expect(guardComandoReemplazarCartaDeSucursal({ ...base, nombreEscrito: "   " })).toMatchObject({ ok: false });
    expect(guardComandoReemplazarCartaDeSucursal({ ...base, nombreEscrito: "Sucursal Sur" })).toMatchObject({ ok: false, mensaje: "El nombre escrito no coincide con el de esta sucursal: no se reemplazó nada." });
  });
  it("el origen no puede ser la sucursal activa", () => {
    expect(guardComandoReemplazarCartaDeSucursal({ ...base, sucursalOrigenId: "d", nombreEscrito: "Sucursal Norte" })).toMatchObject({ ok: false, mensaje: "Elegí otra sucursal: no se puede reemplazar con la misma." });
  });
});
