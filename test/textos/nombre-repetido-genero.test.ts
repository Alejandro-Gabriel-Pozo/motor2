import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENTIDADES } from "@/core/textos/entidades";

/**
 * «Ya existe {un/una} {entidad} llamado «X»…» (`rechazo.NOMBRE_REPETIDO`, lote D, DEC-0022): «llamado» queda FIJO, como lo escribió el dueño, así que con una entidad femenina saldría «una sección llamado». Hasta que el dueño
 * decida cómo se dice en femenino, solo se puede usar con entidades masculinas. Este guardián mira cada llamada del código (`src/`) y falla si la entidad es femenina (o no es una de `ENTIDADES`).
 * Lee el objeto de valores de cada `textoDe("rechazo.NOMBRE_REPETIDO", { … })` (con llaves balanceadas) y busca `entidad: ENTIDADES.<x>` en cualquier posición: `{ entidad: …, nombre: … }` y `{ nombre: …, entidad: … }` se ven igual.
 * LÍMITES: una entidad que llega por una variable (`entidad: miEntidad`) o por un objeto armado aparte no se ve; el valor que `textoDe` recibe con un cast tampoco. En ejecución, `textoDe` solo escribe entidades de la tabla (falla cerrado).
 */
const LLAMADA = /textoDe\(\s*["']rechazo\.NOMBRE_REPETIDO["']\s*,\s*\{/g;

/** Las entidades (`ENTIDADES.<x>`) de cada llamada a `rechazo.NOMBRE_REPETIDO` en un texto de código, en cualquier orden de propiedades. */
function entidadesDeNombreRepetido(texto: string): string[] {
  const salida: string[] = [];
  for (const m of texto.matchAll(LLAMADA)) {
    let profundidad = 1;
    let i = m.index! + m[0].length;
    const inicio = i;
    while (i < texto.length && profundidad > 0) {
      if (texto[i] === "{") profundidad++;
      else if (texto[i] === "}") profundidad--;
      i++;
    }
    const objeto = texto.slice(inicio, i - 1);
    for (const e of objeto.matchAll(/\bentidad\s*:\s*ENTIDADES\.(\w+)/g)) salida.push(e[1]!);
    if (!/\bentidad\s*:/.test(objeto)) salida.push("(sin entidad)");
  }
  return salida;
}

const RAIZ = join(__dirname, "../..");
function archivos(dir: string, salida: string[] = []): string[] {
  for (const e of readdirSync(join(RAIZ, dir), { withFileTypes: true })) {
    const ruta = `${dir}/${e.name}`;
    if (e.isDirectory()) archivos(ruta, salida);
    else if (/\.tsx?$/.test(e.name)) salida.push(ruta);
  }
  return salida;
}

describe("NOMBRE_REPETIDO solo con entidades masculinas: el detector (una violación inyectada por forma)", () => {
  it("ve la entidad con `entidad` antes o después del nombre, en una línea o en varias", () => {
    expect(entidadesDeNombreRepetido('textoDe("rechazo.NOMBRE_REPETIDO", { entidad: ENTIDADES.cliente, nombre: n })')).toEqual(["cliente"]);
    expect(entidadesDeNombreRepetido('textoDe("rechazo.NOMBRE_REPETIDO", { nombre: n, entidad: ENTIDADES.sucursal })')).toEqual(["sucursal"]);
    expect(entidadesDeNombreRepetido('textoDe(\n  "rechazo.NOMBRE_REPETIDO",\n  {\n    nombre: dup.nombre,\n    entidad: ENTIDADES.membresia,\n  },\n)')).toEqual(["membresia"]);
    expect(entidadesDeNombreRepetido('textoDe("rechazo.NOMBRE_REPETIDO", { nombre: f({ a: 1 }), entidad: ENTIDADES.cliente })')).toEqual(["cliente"]);
  });
  it("marca la llamada sin una entidad de la tabla (variable o ausente) y no mira otras claves", () => {
    expect(entidadesDeNombreRepetido('textoDe("rechazo.NOMBRE_REPETIDO", { nombre: n, entidad: miEntidad })')).toEqual([]);
    expect(entidadesDeNombreRepetido('textoDe("rechazo.NOMBRE_REPETIDO", { nombre: n })')).toEqual(["(sin entidad)"]);
    expect(entidadesDeNombreRepetido('textoDe("rechazo.NO_ENCONTRADO", { entidad: ENTIDADES.sucursal })')).toEqual([]);
  });
});

describe("NOMBRE_REPETIDO solo con entidades masculinas (hasta que el dueño decida el femenino)", () => {
  it("ninguna llamada usa una entidad femenina ni desconocida", () => {
    const usos: { archivo: string; entidad: string }[] = [];
    for (const archivo of archivos("src")) {
      if (archivo.startsWith("src/core/textos/")) continue;
      for (const entidad of entidadesDeNombreRepetido(readFileSync(join(RAIZ, archivo), "utf8"))) usos.push({ archivo, entidad });
    }
    expect(usos.length, "no pasa en vacío: hoy el alta y la edición de clientes lo usan").toBeGreaterThan(0);
    const malos = usos.filter((u) => (ENTIDADES as Record<string, { genero: string }>)[u.entidad]?.genero !== "m");
    expect(malos, `NOMBRE_REPETIDO con entidad femenina, desconocida o ausente (decisión del dueño pendiente): ${JSON.stringify(malos)}`).toEqual([]);
  });
});
