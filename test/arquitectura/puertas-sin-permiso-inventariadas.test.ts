import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { analizarFuente } from "./guardas/analizador";
import { esDeGrupoProtegido, esPagina, esRouteHandler, listarArchivosDeApp } from "./guardas/entradas-de-app";
import { PUERTAS_SIN_PERMISO } from "./guardas/puertas-sin-permiso";

/**
 * GT-10 (T8 del endurecimiento de seguridad; S-17, S-18, S-27): TODA puerta que no abre con `conPermiso*` / `requerirVer*` está inventariada, con qué pasa con un ANÓNIMO y con un usuario con
 * sesión pero SIN EMPRESA (`test/arquitectura/guardas/puertas-sin-permiso.ts`). Une en una sola lista lo que antes miraban por separado `rutas-publicas-inventariadas` (páginas y route handlers
 * públicos), `acciones-con-guarda` (las Server Actions abiertas con una guarda «a mano»), `consola-acciones-con-sesion` (las de la consola previas a la sesión) y el gate de `signIn`.
 *
 * Método del dueño: denegar por defecto. En este sistema no existen usuarios sin empresa, así que una puerta que se deja `PERMITIDO` a un anónimo o a un sin-empresa tiene que decir por qué
 * y qué la frena en bucle. Este test es ESTÁTICO (lo que el código expone es exactamente la lista, y cada fila es coherente con su guarda); que cada puerta `NIEGA` de verdad lo prueba, con
 * base, `test/seguridad/puertas-sin-permiso-anonimo-y-sin-empresa.test.ts`.
 *
 * Mutaciones (cada una pone un caso en rojo): una Server Action nueva abierta con una guarda a mano, o una página/route público nuevo, sin fila; una fila que ya no corresponde a nada;
 * una puerta `PERMITIDO` sin motivo o sin limitador; volver al gate de login una lectura del entorno (la vía por dominio del correo) o un parámetro `hd`.
 */
const RAIZ = join(__dirname, "../..");
const ACCIONES = join(RAIZ, "src/server/actions");
const CONSOLA_LOGIN = join(RAIZ, "plataforma/src/app/login");

/** Las guardas «de envoltorio» (piden el permiso de una pantalla): las puertas abiertas con cualquier otra son las «a mano» de este inventario. */
const GUARDAS_DE_ENVOLTORIO = new Set([
  "conPermiso", "conPermisoDeEmpresa", "conEdicionDePermisos",
  "requerirVer", "requerirVerEnSucursal", "requerirVerDeEmpresa", "requerirVerAlguna", "requerirVerAlgunaEnSucursal",
]);
/** Las guardas «a mano» que prueban una SESIÓN (y por eso niegan al anónimo); `invitacionDelToken` prueba un TOKEN (previa al login). */
const GUARDAS_DE_SESION = new Set(["getUsuarioActual", "obtenerContextoUsuario", "requierePermiso", "requierePermisoVer", "requierePermisoDeEmpresa", "requierePermisoVerDeEmpresa"]);

function archivos(dir: string, salida: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) archivos(ruta, salida);
    else if (/\.tsx?$/.test(e.name)) salida.push(ruta);
  }
  return salida;
}

const aRelativa = (base: string, ruta: string) => relative(base, ruta).split(sep).join("/");

interface Descubierta {
  /** La guarda a mano con la que abre (solo las Server Actions de la app). */
  guarda?: string;
}

/** Lo que el código expone hoy: clave → datos de la puerta. */
function descubrirPuertas(): Map<string, Descubierta> {
  const puertas = new Map<string, Descubierta>();

  // 1. Server Actions de la app abiertas con una guarda que no es de envoltorio.
  for (const ruta of archivos(ACCIONES)) {
    const fuente = readFileSync(ruta, "utf8").replace(/\r\n/g, "\n");
    const analisis = analizarFuente(ruta, fuente);
    if (!analisis.esArchivoDeAcciones) continue;
    for (const f of analisis.funciones) {
      if (f.estado === "ok" && f.guarda && !GUARDAS_DE_ENVOLTORIO.has(f.guarda)) puertas.set(`accion|${aRelativa(ACCIONES, ruta)}|${f.nombre}`, { guarda: f.guarda });
    }
  }

  // 2. Páginas y route handlers públicos (fuera de (app)/(pos)); los crons se agrupan.
  for (const a of listarArchivosDeApp()) {
    if (!(esPagina(a) || esRouteHandler(a)) || esDeGrupoProtegido(a)) continue;
    puertas.set(/^api\/cron\/[^/]+\/route\.ts$/.test(a) ? "ruta|api/cron/*" : `ruta|${a}`, {});
  }

  // 3. Server Actions de la consola previas a la sesión del administrador (carpeta login/).
  for (const ruta of archivos(CONSOLA_LOGIN)) {
    const sf = ts.createSourceFile(ruta, readFileSync(ruta, "utf8"), ts.ScriptTarget.Latest, true);
    const primera = sf.statements[0];
    if (!primera || !ts.isExpressionStatement(primera) || !ts.isStringLiteral(primera.expression) || primera.expression.text !== "use server") continue;
    for (const s of sf.statements) {
      if (ts.isFunctionDeclaration(s) && s.name && (ts.getModifiers(s) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) puertas.set(`consola|${aRelativa(join(RAIZ, "plataforma/src/app"), ruta)}|${s.name.text}`, {});
    }
  }

  // 4. El gate de `signIn`: el callback de Auth.js (`src/lib/auth.ts`) que decide quién abre sesión.
  if (/\bsignIn\s*\(\s*\{[^}]*\}\s*\)\s*\{/.test(readFileSync(join(RAIZ, "src/lib/auth.ts"), "utf8"))) puertas.set("sesion|lib/auth.ts|signIn", {});

  return puertas;
}

describe("GT-10: toda puerta sin conPermiso está inventariada con su postura ante un anónimo y un sin-empresa", () => {
  const reales = descubrirPuertas();

  it("sanidad: el descubrimiento ve las cuatro clases de puertas (no pasa en vacío)", () => {
    const claves = [...reales.keys()];
    for (const clase of ["accion|", "ruta|", "consola|", "sesion|"]) expect(claves.some((c) => c.startsWith(clase)), `ninguna puerta de la clase ${clase}`).toBe(true);
    expect(reales.has("accion|auth/invitacion.ts|abrirInvitacion")).toBe(true);
    expect(reales.has("ruta|api/cron/*")).toBe(true);
  });

  it("las puertas que el código expone son EXACTAMENTE las del inventario (ni una más, ni una menos)", () => {
    const sinFila = [...reales.keys()].filter((k) => !(k in PUERTAS_SIN_PERMISO));
    const sinPuerta = Object.keys(PUERTAS_SIN_PERMISO).filter((k) => !reales.has(k));
    expect(sinFila, `Puertas NUEVAS sin inventariar (declará su postura ante un anónimo y un sin-empresa en test/arquitectura/guardas/puertas-sin-permiso.ts, o abrilas con conPermiso*/requerirVer*):\n${sinFila.join("\n")}`).toEqual([]);
    expect(sinPuerta, `Filas del inventario que ya no corresponden a ninguna puerta:\n${sinPuerta.join("\n")}`).toEqual([]);
  });

  it("cada fila tiene posturas válidas y motivo; una puerta PERMITIDO a un anónimo o a un sin-empresa dice además qué la frena en bucle", () => {
    for (const [clave, p] of Object.entries(PUERTAS_SIN_PERMISO)) {
      expect(["NIEGA", "PERMITIDO"], `${clave}: postura de anónimo`).toContain(p.anonimo);
      expect(["NIEGA", "PERMITIDO"], `${clave}: postura de sin-empresa`).toContain(p.sinEmpresa);
      expect(p.motivo.trim().length, `${clave}: sin motivo`).toBeGreaterThan(30);
      if (p.anonimo === "PERMITIDO" || p.sinEmpresa === "PERMITIDO") expect((p.limitador ?? "").trim().length, `${clave}: PERMITIDO sin limitador`).toBeGreaterThan(10);
    }
  });

  it("una Server Action abierta con una guarda de SESIÓN niega al anónimo; la que abre con un TOKEN (previa al login) lo declara PERMITIDO con su limitador", () => {
    for (const [clave, d] of reales) {
      if (!clave.startsWith("accion|")) continue;
      const fila = PUERTAS_SIN_PERMISO[clave];
      if (!fila) continue; // ya lo reporta el test de arriba
      if (d.guarda && GUARDAS_DE_SESION.has(d.guarda)) expect(fila.anonimo, `${clave} abre con ${d.guarda} (prueba una sesión): el anónimo no puede pasar`).toBe("NIEGA");
      else expect(fila.anonimo, `${clave} abre con ${d.guarda} (no es una sesión): es previa al login, tiene que declararlo`).toBe("PERMITIDO");
    }
  });

  it("el gate de signIn (D5, S-17): decide por membresía o invitación, sin leer el entorno ni el dominio del correo (la vía por `ALLOWED_EMAIL_DOMAINS`/`hd` no vuelve)", () => {
    const acceso = readFileSync(join(RAIZ, "src/server/sesion/acceso.ts"), "utf8");
    const sinComentarios = acceso.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(sinComentarios, "el gate de login no lee el entorno").not.toMatch(/process\.env/);
    expect(sinComentarios, "el gate de login no recibe el claim hd").not.toMatch(/\bhd\b/);
    const auth = readFileSync(join(RAIZ, "src/lib/auth.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(auth, "el callback signIn devuelve la decisión del gate").toMatch(/return\s+decidirInicioDeSesion\(/);
    expect(auth, "el callback signIn no mira el claim hd").not.toMatch(/\bhd\b/);
  });
});
