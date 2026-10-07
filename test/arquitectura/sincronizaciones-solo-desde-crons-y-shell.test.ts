import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura (Pureza Fase 4, tramo C): las sincronizaciones SIN USUARIO (el dólar y el IPC) solo las dispara quien corresponde.
 *
 * `src/server/actions/reportes/sincronizaciones.ts` envuelve los casos de uso `sincronizar-dolar` y `sincronizar-ipc`, cuyo permiso es `SISTEMA`: no hay usuario ni `conPermiso`,
 * porque el dato es de una fuente externa y global. Eso solo es seguro si nadie más puede llamarlo: no es una Server Action (sin `"use server"`, la ficha lo comprueba: un
 * envoltorio con `"use server"` y sin permiso daría `POR_PROCESO`, no `SISTEMA`) y este test fija QUIÉN lo importa: los dos crons (`src/app/api/cron/**` /route.ts, que verifican su secreto)
 * y el encabezado de la aplicación (`components/app-shell.tsx`, que solo se pone al día si falta la cotización de hoy). Ningún otro archivo de `src/`, ni siquiera un caso de uso
 * o una pantalla.
 */
const SRC = join(__dirname, "../../src");
const PERMITIDOS = [/^app\/api\/cron\/[^/]+\/route\.ts$/, /^components\/app-shell\.tsx$/];
const DESTINO = /["'](?:@\/server\/actions\/reportes\/sincronizaciones|\.{1,2}\/(?:\.\.\/)*sincronizaciones)["']|casos-de-uso\/sincronizar-(?:dolar|ipc)["']/;

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

/** Los archivos (relativos a `src/`) cuyo texto importa una sincronización. `sincronizaciones.ts` y los casos de uso hermanos se excluyen (son el destino). */
function importadores(lista: { nombre: string; fuente: string }[]): string[] {
  return lista
    .filter((a) => !/^server\/actions\/reportes\/(sincronizaciones\.ts|casos-de-uso\/sincronizar-(dolar|ipc)\.ts)$/.test(a.nombre))
    .filter((a) => DESTINO.test(a.fuente))
    .map((a) => a.nombre)
    .sort();
}

describe("sincronizaciones sin usuario: quién las importa", () => {
  it("el detector ve un import por alias, por ruta relativa y de un caso de uso", () => {
    const f = (fuente: string) => importadores([{ nombre: "app/x/page.tsx", fuente }]);
    expect(f('import { sincronizarDolar } from "@/server/actions/reportes/sincronizaciones";')).toEqual(["app/x/page.tsx"]);
    expect(f('import { x } from "../sincronizaciones";')).toEqual(["app/x/page.tsx"]);
    expect(f('import { sincronizarIPCCasoDeUso } from "@/server/actions/reportes/casos-de-uso/sincronizar-ipc";')).toEqual(["app/x/page.tsx"]);
    expect(f('import { otra } from "@/server/actions/reportes/consignacion";')).toEqual([]);
  });

  it("solo los crons y el encabezado de la aplicación las importan", () => {
    const todos = archivos(SRC).map((ruta) => ({ nombre: relative(SRC, ruta).split(sep).join("/"), fuente: readFileSync(ruta, "utf8") }));
    expect(todos.length).toBeGreaterThan(300);
    const fuera = importadores(todos).filter((n) => !PERMITIDOS.some((p) => p.test(n)));
    expect(fuera, `Las sincronizaciones SISTEMA (sin usuario) solo las importan los crons y app-shell; estos archivos no deberían:\n${fuera.join("\n")}`).toEqual([]);
  });

  it("los importadores permitidos existen (la regla no quedó vacía)", () => {
    const todos = archivos(SRC).map((ruta) => ({ nombre: relative(SRC, ruta).split(sep).join("/"), fuente: readFileSync(ruta, "utf8") }));
    const reales = importadores(todos);
    expect(reales).toContain("components/app-shell.tsx");
    expect(reales.filter((n) => n.startsWith("app/api/cron/"))).toEqual(["app/api/cron/sincronizar-dolar/route.ts", "app/api/cron/sincronizar-ipc/route.ts"]);
  });
});
