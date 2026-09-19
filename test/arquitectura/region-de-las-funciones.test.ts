import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Las funciones de Vercel tienen que correr en la misma región de la nube que la base de datos. La base (Neon, proyecto
 * inventario-api) está en aws-us-west-2 (Oregón); por defecto Vercel corre las funciones en iad1 (Virginia), y cada consulta
 * cruzaba el país (~65 ms de ida y vuelta): una pantalla hace varias seguidas y una fila del Conteo Físico hace 6 a 8. `pdx1`
 * (Portland) es la región de Vercel que está en el mismo lugar que aws-us-west-2.
 *
 * Si la base se mueve a otra región de Neon, hay que mover esta también: cambiá el valor de `regions` en vercel.json y este test.
 */
const vercel = JSON.parse(readFileSync(join(__dirname, "../../vercel.json"), "utf8")) as { regions?: string[]; crons?: unknown[] };

describe("vercel.json", () => {
  it("fija la región de las funciones en pdx1, la de la base de datos (aws-us-west-2); el plan Hobby admite una sola región", () => {
    expect(vercel.regions).toEqual(["pdx1"]);
  });

  it("sincroniza el IPC y el dólar todos los días: el INDEC publica el IPC a mitad de mes en una fecha variable, y las dos cargas son seguras de repetir", () => {
    expect(vercel.crons).toEqual([
      { path: "/api/cron/sincronizar-ipc", schedule: "0 12 * * *" },
      { path: "/api/cron/sincronizar-dolar", schedule: "30 21 * * *" },
    ]);
  });
});
