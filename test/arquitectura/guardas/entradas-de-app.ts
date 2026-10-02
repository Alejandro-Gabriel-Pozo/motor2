import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Raíz de las rutas de Next. */
const RAIZ_APP = join(__dirname, "../../../src/app");

/** Rutas relativas a `src/app`, con `/`, de TODOS los archivos (recursivo). */
export function listarArchivosDeApp(): string[] {
  const salida: string[] = [];
  const recorrer = (dir: string, prefijo: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefijo ? `${prefijo}/${e.name}` : e.name;
      if (e.isDirectory()) recorrer(join(dir, e.name), rel);
      else salida.push(rel);
    }
  };
  recorrer(RAIZ_APP, "");
  return salida.sort();
}

export function leerDeApp(ruta: string): string {
  return readFileSync(join(RAIZ_APP, ruta), "utf8").replace(/\r\n/g, "\n");
}

/** Grupos de rutas cuyo layout redirige al login: lo que cuelga de ellos exige sesión (y cada página, además, su permiso). */
export const GRUPOS_PROTEGIDOS = ["(app)", "(pos)"];

export const esDeGrupoProtegido = (ruta: string) => GRUPOS_PROTEGIDOS.some((g) => ruta.startsWith(`${g}/`));

/** Es un archivo de ruta (página o route handler), con cualquier extensión de código. */
export const esPagina = (ruta: string) => /(^|\/)page\.(tsx|ts|jsx|js|mdx)$/.test(ruta);
export const esRouteHandler = (ruta: string) => /(^|\/)route\.(tsx|ts|jsx|js)$/.test(ruta);

/**
 * Nombres de archivo que Next interpreta como entrada o política propia. Los que no están en `CON_POLITICA` no tienen todavía una regla acá:
 * aparecer uno obliga a decidir cómo se protege (ver `rutas-publicas-inventariadas.test.ts`).
 */
const RESERVADOS = ["page", "route", "layout", "template", "default", "loading", "error", "not-found", "global-error", "middleware", "proxy", "sitemap", "robots", "manifest", "opengraph-image", "twitter-image", "icon", "apple-icon"];

export function nombreReservadoDe(ruta: string): string | undefined {
  const archivo = ruta.split("/").pop() ?? "";
  const m = /^([a-z-]+)\.(tsx|ts|jsx|js|mjs|mdx)$/.exec(archivo);
  return m && RESERVADOS.includes(m[1]) ? m[1] : undefined;
}
