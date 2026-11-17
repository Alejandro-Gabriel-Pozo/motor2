import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENTIDADES } from "@/core/textos/entidades";

/**
 * «Ya existe {un/una} {entidad} llamado «X»…» (`rechazo.NOMBRE_REPETIDO`, lote D, DEC-0022): «llamado» queda FIJO, como lo escribió el dueño, así que con una entidad femenina saldría «una sección llamado». Hasta que el dueño
 * decida cómo se dice en femenino, solo se puede usar con entidades masculinas. Este guardián mira cada llamada del código (`src/`) y falla si la entidad es femenina (o no es una de `ENTIDADES`).
 * LÍMITE: lee el texto de las llamadas `textoDe("rechazo.NOMBRE_REPETIDO", { entidad: ENTIDADES.<x>, … })`; una entidad que llega por una variable no se ve.
 */
const RAIZ = join(__dirname, "../..");
function archivos(dir: string, salida: string[] = []): string[] {
  for (const e of readdirSync(join(RAIZ, dir), { withFileTypes: true })) {
    const ruta = `${dir}/${e.name}`;
    if (e.isDirectory()) archivos(ruta, salida);
    else if (/\.tsx?$/.test(e.name)) salida.push(ruta);
  }
  return salida;
}

describe("NOMBRE_REPETIDO solo con entidades masculinas (hasta que el dueño decida el femenino)", () => {
  it("ninguna llamada usa una entidad femenina ni desconocida", () => {
    const usos: { archivo: string; entidad: string }[] = [];
    for (const archivo of archivos("src")) {
      if (archivo.startsWith("src/core/textos/")) continue;
      const texto = readFileSync(join(RAIZ, archivo), "utf8");
      for (const m of texto.matchAll(/textoDe\("rechazo\.NOMBRE_REPETIDO",\s*\{\s*entidad:\s*ENTIDADES\.(\w+)/g)) usos.push({ archivo, entidad: m[1]! });
    }
    expect(usos.length, "no pasa en vacío: hoy el alta y la edición de clientes lo usan").toBeGreaterThan(0);
    const malos = usos.filter((u) => (ENTIDADES as Record<string, { genero: string }>)[u.entidad]?.genero !== "m");
    expect(malos, `NOMBRE_REPETIDO con entidad femenina o desconocida (decisión del dueño pendiente): ${JSON.stringify(malos)}`).toEqual([]);
  });
});
