import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PRUEBA DE AUSENCIA de las rutas de transición retiradas por decisión del dueño (2026-10-28): una poda queda escrita y no vuelve sin que se note. Cada entrada dice qué se retiró, cuándo y por qué, y
 * cómo se comprueba que ya no está: la página no existe (Next responde 404), la pantalla ya no lee el parámetro viejo (se ignora, sin redirigir) o la redirección ya no está en `next.config.ts`. Además,
 * ningún archivo de `src/` (ni la consola de plataforma) nombra esas rutas: no queda un enlace interno que lleve a «no existe».
 *
 * Para retirar otra ruta, se suma una entrada a `RETIRADAS` (con su fecha y su motivo); para volver a poner una, primero se saca de la lista con la decisión que lo autoriza.
 */
const RAIZ = join(__dirname, "../..");

type Retirada = { fecha: string; motivo: string; enlace: RegExp } & (
  | { tipo: "pagina"; archivo: string }
  | { tipo: "parametro"; pagina: string; parametro: string }
  | { tipo: "redireccion"; fuente: string }
);

const MOTIVO = "Transición de rutas viejas («para que enlaces y favoritos viejos sigan funcionando»): el dueño pide podar lo que no resuelve una necesidad y dejar una sola entrada por pantalla.";

const RETIRADAS: readonly Retirada[] = [
  // El editor es el paso 1 del espacio del producto, `/catalogo/productos/[id]/datos`.
  { tipo: "pagina", archivo: "src/app/(app)/catalogo/productos/[id]/editar/page.tsx", fecha: "2026-10-28", motivo: MOTIVO, enlace: /\/catalogo\/productos\/[^"'`\s)]*\/editar\b/ },
  { tipo: "parametro", pagina: "src/app/(app)/catalogo/productos/page.tsx", parametro: "id", fecha: "2026-10-28", motivo: MOTIVO, enlace: /\/catalogo\/productos\?id=/ },
  { tipo: "parametro", pagina: "src/app/(app)/catalogo/proveedores/page.tsx", parametro: "editar", fecha: "2026-10-28", motivo: MOTIVO, enlace: /\/catalogo\/proveedores\?editar=/ },
  // La carta es un módulo propio desde ADR-006 (`/carta`).
  { tipo: "redireccion", fuente: "/catalogo/carta/:path*", fecha: "2026-10-28", motivo: MOTIVO, enlace: /\/catalogo\/carta\b/ },
];

/** Los archivos de código de la aplicación y de la consola (lo que puede llevar un enlace interno). */
function archivosDeCodigo(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (nombre === "node_modules" || nombre === ".next") return [];
    return statSync(ruta).isDirectory() ? archivosDeCodigo(ruta) : /\.(ts|tsx|js|mjs)$/.test(nombre) ? [ruta] : [];
  });
}

/** Si la página lee ese parámetro de la URL: lo declara en su `ParametrosDeUrl<…>` (la forma en que todas las páginas lo leen). */
function leeElParametro(fuente: string, parametro: string): boolean {
  return [...fuente.matchAll(/ParametrosDeUrl<([^>]*)>/g)].some((m) => new RegExp(`"${parametro}"`).test(m[1]));
}

describe("rutas retiradas por decisión del dueño: siguen retiradas", () => {
  it("cada entrada tiene fecha y motivo", () => {
    for (const r of RETIRADAS) {
      expect(r.fecha, JSON.stringify(r)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.motivo.length, JSON.stringify(r)).toBeGreaterThan(20);
    }
  });

  it.each(RETIRADAS.filter((r) => r.tipo === "pagina"))("la página $archivo no existe (Next responde 404)", (r) => {
    expect(existsSync(join(RAIZ, r.archivo)), `${r.archivo} volvió: está retirada desde ${r.fecha}`).toBe(false);
  });

  it.each(RETIRADAS.filter((r) => r.tipo === "parametro"))("$pagina ya no lee «?$parametro=» (se ignora, sin redirigir)", (r) => {
    const fuente = readFileSync(join(RAIZ, r.pagina), "utf8");
    expect(leeElParametro(fuente, r.parametro), `${r.pagina} volvió a leer «?${r.parametro}=»: está retirado desde ${r.fecha}`).toBe(false);
  });

  it.each(RETIRADAS.filter((r) => r.tipo === "redireccion"))("next.config.ts ya no redirige $fuente", (r) => {
    expect(readFileSync(join(RAIZ, "next.config.ts"), "utf8"), `la redirección ${r.fuente} volvió: está retirada desde ${r.fecha}`).not.toContain(r.fuente.replace(/\/:path\*$/, ""));
  });

  it("ningún archivo de la aplicación ni de la consola nombra una ruta retirada (no queda un enlace a «no existe»)", () => {
    const archivos = [...archivosDeCodigo(join(RAIZ, "src")), ...archivosDeCodigo(join(RAIZ, "plataforma")), join(RAIZ, "next.config.ts")];
    expect(archivos.length).toBeGreaterThan(500);
    const hallazgos = archivos.flatMap((archivo) => {
      const fuente = readFileSync(archivo, "utf8");
      return RETIRADAS.filter((r) => r.enlace.test(fuente)).map((r) => `${relative(RAIZ, archivo).split(sep).join("/")}: ${r.enlace}`);
    });
    expect(hallazgos).toEqual([]);
  });

  it("el detector de parámetros ve la forma en que las páginas leen la URL", () => {
    expect(leeElParametro('searchParams: Promise<ParametrosDeUrl<"id" | "q">>', "id")).toBe(true);
    expect(leeElParametro('searchParams: Promise<ParametrosDeUrl<"q" | "cursor">>', "id")).toBe(false);
    expect(leeElParametro("export default async function P() {}", "editar")).toBe(false);
  });
});
