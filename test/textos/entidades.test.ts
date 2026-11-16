import { describe, expect, it, vi } from "vitest";
import { ENTIDADES } from "@/core/textos/entidades";
import { MENSAJE_GENERICO, textoDe } from "@/core/textos/texto-de";
import { ORACULO_DE_ENTIDADES } from "./oraculo-de-entidades";

/** El molde «No se encontró {entidad}.» (lote C1, DEC-0020): recorre TODAS las entidades contra el oráculo y falla si aparece una entidad sin declarar. */
describe("textoDe con entidad: el género de la cosa", () => {
  it("cada entidad dice lo que el oráculo espera (recorrido exhaustivo) y tiene el género declarado", () => {
    for (const [clave, entidad] of Object.entries(ENTIDADES)) {
      const esperado = ORACULO_DE_ENTIDADES[clave];
      expect(esperado, `falta la fila de «${clave}» en el oráculo`).toBeDefined();
      expect(entidad.genero, clave).toBe(esperado!.genero);
      expect(textoDe("rechazo.NO_ENCONTRADO", { entidad }), clave).toBe(esperado!.noSeEncontro);
      if (esperado!.yaExiste !== undefined) expect(textoDe("rechazo.NOMBRE_REPETIDO", { entidad, nombre: "Fulano" }), clave).toBe(esperado!.yaExiste);
    }
  });

  it("el artículo indefinido concuerda con el género (hoy solo el cliente se repite por nombre: «llamado» queda fijo, como lo eligió el dueño)", () => {
    expect(textoDe("rechazo.NOMBRE_REPETIDO", { entidad: ENTIDADES.cliente, nombre: "A" })).toBe("Ya existe un cliente llamado «A». Elegí otro nombre.");
  });

  it("guardián de dimensiones: el oráculo no tiene entidades que ya no existen y los géneros son m o f", () => {
    expect(Object.keys(ORACULO_DE_ENTIDADES).sort()).toEqual(Object.keys(ENTIDADES).sort());
    for (const e of Object.values(ENTIDADES)) expect(["m", "f"]).toContain(e.genero);
  });

  it("cerrado: una entidad que no está en la tabla no compila; en ejecución (un `any`) cae al mensaje genérico y no rompe", () => {
    // @ts-expect-error una entidad suelta, que no está en ENTIDADES
    void (() => textoDe("rechazo.NO_ENCONTRADO", { entidad: { nombre: "mesa", genero: "f" } }));
    // @ts-expect-error falta la entidad
    void (() => textoDe("rechazo.NO_ENCONTRADO", {}));
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    const leer = textoDe as unknown as (clave: string, valores?: Record<string, unknown>) => string;
    expect(leer("rechazo.NO_ENCONTRADO", { entidad: { nombre: "mesa", genero: "x" } })).toBe(MENSAJE_GENERICO);
    expect(leer("rechazo.NO_ENCONTRADO", { entidad: { nombre: " ", genero: "m" } })).toBe(MENSAJE_GENERICO);
    expect(leer("rechazo.NO_ENCONTRADO", { entidad: "sucursal" })).toBe(MENSAJE_GENERICO);
    expect(leer("rechazo.NO_ENCONTRADO", { entidad: null })).toBe(MENSAJE_GENERICO);
    expect(leer("rechazo.NO_ENCONTRADO", {})).toBe(MENSAJE_GENERICO);
    espia.mockRestore();
  });
});
