import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { esDeGrupoProtegido, esPagina, esRouteHandler, GRUPOS_PROTEGIDOS, leerDeApp, listarArchivosDeApp, nombreReservadoDe } from "./guardas/entradas-de-app";
import { analizarCron, analizarLayoutProtegido } from "./guardas/rutas";

/**
 * Una `page.tsx` o un `route.ts` NUEVO nace público: el layout de `(app)`/`(pos)` redirige al login, pero un archivo puesto en otro lado (o un
 * route handler, que no pasa por ningún layout) queda abierto sin que nada se queje. Este test lo vuelve ruidoso: cada entrada HTTP de `src/app`
 * tiene que ser (a) una página dentro de `(app)`/`(pos)` (su guarda de permiso la exige `paginas-con-guarda.test.ts`), (b) un cron que rechaza el
 * pedido sin el secreto antes de usar la base, o (c) una ruta PÚBLICA inventariada acá, con el motivo por el que lo es.
 *
 * Es un test ESTÁTICO: evita el olvido. Que el rechazo funcione de verdad lo prueban los e2e de login/sesión y `secreto-cron.test.ts`.
 */

/** Entradas públicas a propósito. Ruta relativa a `src/app`; el motivo no puede estar vacío. */
const RUTAS_PUBLICAS: Record<string, string> = {
  "page.tsx": "raíz `/`: solo redirige (al login sin sesión, a la pantalla de inicio con sesión); no muestra ni lee nada",
  "login/page.tsx": "el formulario de ingreso: tiene que poder abrirse sin sesión",
  "api/auth/[...nextauth]/route.ts": "Auth.js (login, callback, logout, sesión): su propio protocolo decide qué responde a cada pedido",
  "(carta-publica)/carta-publica/[empresa]/page.tsx": "carta pública de una empresa: lectura aislada, sin sesión (guardas propias en carta-solo-lectura/sin-boundary-http-carta)",
  "(carta-publica)/carta-publica/[empresa]/[sucursal]/page.tsx": "carta pública de una sucursal: lectura aislada, sin sesión (ídem)",
};

/** Archivos reservados de Next que ya tienen política acá: cualquier otro (default, template, sitemap, robots, middleware…) obliga a decidirla. */
const RESERVADOS_CON_POLITICA = ["page", "route", "layout", "loading", "error", "not-found", "global-error"];

const archivos = listarArchivosDeApp();
const paginas = archivos.filter(esPagina);
const routeHandlers = archivos.filter(esRouteHandler);
const esCron = (ruta: string) => /^api\/cron\/[^/]+\/route\.ts$/.test(ruta);

describe("entradas HTTP de src/app: ninguna nace pública sin que esté inventariada", () => {
  it("no hay archivos reservados de Next sin política (default, template, sitemap, robots, manifest, middleware, iconos…)", () => {
    const sinPolitica = archivos.filter((a) => {
      const n = nombreReservadoDe(a);
      return n !== undefined && !RESERVADOS_CON_POLITICA.includes(n);
    });
    expect(sinPolitica, "archivo reservado sin política: decidir si es público (agregarlo a RUTAS_PUBLICAS) o protegerlo").toEqual([]);
  });

  it("toda página es de (app)/(pos) o está en RUTAS_PUBLICAS", () => {
    const huerfanas = paginas.filter((p) => !esDeGrupoProtegido(p) && !(p in RUTAS_PUBLICAS));
    expect(huerfanas, "página fuera de (app)/(pos) y sin inventariar como pública").toEqual([]);
  });

  it("todo route handler es un cron (api/cron/<nombre>/route.ts) o está en RUTAS_PUBLICAS; ninguno vive en (app)/(pos), donde el layout no lo protege", () => {
    const enGrupoProtegido = routeHandlers.filter(esDeGrupoProtegido);
    expect(enGrupoProtegido, "un route handler no pasa por el layout: dentro de (app)/(pos) parece protegido y no lo está").toEqual([]);
    const huerfanos = routeHandlers.filter((r) => !esCron(r) && !(r in RUTAS_PUBLICAS));
    expect(huerfanos, "route handler que no es un cron y no está inventariado como público").toEqual([]);
  });

  it("todo cron rechaza el pedido sin el secreto, antes de usar la base, en cada método HTTP", () => {
    const crons = routeHandlers.filter(esCron);
    expect(crons.length).toBeGreaterThan(0);
    for (const c of crons) {
      const r = analizarCron(c, leerDeApp(c));
      expect(r.estado, `${c}: ${JSON.stringify(r.metodos)}`).toBe("ok");
    }
  });

  it("RUTAS_PUBLICAS no tiene entradas viejas ni sin motivo (se revisa en las dos direcciones)", () => {
    for (const [ruta, motivo] of Object.entries(RUTAS_PUBLICAS)) {
      expect(archivos, `RUTAS_PUBLICAS lista "${ruta}", que ya no existe`).toContain(ruta);
      expect(esPagina(ruta) || esRouteHandler(ruta), `"${ruta}" no es una página ni un route handler`).toBe(true);
      expect(esDeGrupoProtegido(ruta), `"${ruta}" está dentro de un grupo protegido: o es pública o no, no las dos`).toBe(false);
      expect(esCron(ruta), `"${ruta}" es un cron: se controla por su secreto, no se lista como pública`).toBe(false);
      expect(motivo.trim().length, `"${ruta}" sin motivo`).toBeGreaterThan(10);
    }
  });

  it("los layouts de (app) y (pos) siguen pidiendo el contexto y redirigiendo al login sin sesión", () => {
    for (const grupo of GRUPOS_PROTEGIDOS) {
      const ruta = `${grupo}/layout.tsx`;
      expect(archivos, `falta ${ruta}`).toContain(ruta);
      expect(analizarLayoutProtegido(ruta, leerDeApp(ruta)), ruta).toBe("ok");
    }
  });

  it("los crons de vercel.json son exactamente las carpetas api/cron/*", () => {
    const config = JSON.parse(readFileSync(join(__dirname, "../../vercel.json"), "utf8")) as { crons?: { path: string }[] };
    const programados = (config.crons ?? []).map((c) => c.path.replace(/^\/api\/cron\//, "")).sort();
    const enCodigo = routeHandlers.filter(esCron).map((r) => r.split("/")[2]).sort();
    expect(programados).toEqual(enCodigo);
  });

  it("sigue habiendo páginas protegidas que revisar (que una reorganización de carpetas no vacíe en silencio el guardián)", () => {
    expect(paginas.filter(esDeGrupoProtegido).length).toBeGreaterThan(70);
  });
});
