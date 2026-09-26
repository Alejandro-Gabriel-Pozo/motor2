import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCIONES } from "../../src/core/permisos/acciones";

/**
 * Guardián de catálogo (inspirado en las "cercas" RBAC de otro proyecto propio, un backend de reservas: un documento/catálogo
 * vivo se desincroniza en silencio del código real si nada lo compara). El riesgo acá NO es "una guarda usa una clave que no
 * existe" — eso ya lo impide `AccionClave` (unión de literales derivada de `ACCIONES`, `src/core/permisos/acciones.ts`):
 * `tsc` rechaza cualquier literal que no esté en el catálogo. El riesgo que NINGÚN tipo cubre es el inverso: una acción
 * declarada en `ACCIONES` (aparece en la matriz de permisos, alguien le puede tocar Ver/Editar) que NINGÚN lugar del código usa
 * de verdad como guarda — una acción "fantasma": o quedó huérfana (se borró la pantalla/acción que protegía y no se limpió el
 * catálogo), o se declaró para una función que nunca se llegó a proteger.
 *
 * Cómo se controla: junta los literales que aparecen como argumento de las funciones que reciben una `AccionClave`
 * (`conPermiso`, `requierePermiso`, `requierePermisoVer`, `requerirVer`, `requerirVerEnSucursal`, `obtenerMiNivelPermiso`) en
 * TODO `src/`, MÁS los valores de `ACCION_POR_PROCESO` (la única indirección real hoy: `/movimientos/[proceso]` resuelve la
 * acción desde una variable, no un literal en el sitio de la guarda — ver `menu-con-permiso.test.ts`), y exige que cada `clave`
 * de `ACCIONES` aparezca en la unión. Las pocas reservadas a propósito para algo que todavía no se construyó van en
 * `RESERVADAS_SIN_USO_TODAVIA`, cada una con su motivo — verificado en las DOS direcciones (si una deja de estar reservada
 * porque ya se usa, la excepción sobra y hay que sacarla; mismo criterio que los allowlists de ese otro proyecto).
 *
 * Es una cerca eléctrica, no un parser real: un literal armado dinámicamente (`` `${x}` ``) que no sea uno de los dos casos de
 * arriba no se vería.
 *
 * A propósito NO se agrega un documento markdown paralelo tipo "matriz de permisos": la matriz real ya vive en
 * `/administracion/permisos`, leída en vivo de la base — un doc estático sería una tercera fuente que se puede desincronizar
 * de las otras dos, exactamente el problema que esta clase de guardián existe para evitar.
 */
const SRC = join(__dirname, "../../src");
const FUNCIONES_CON_ACCION = ["conPermiso", "requierePermiso", "requierePermisoVer", "requerirVer", "requerirVerEnSucursal", "obtenerMiNivelPermiso"];
// `\b` antes del grupo: sin esto, "otraFuncionConPermiso(" matchearía por contener "conPermiso(" como substring.
const RE_USO = new RegExp(`\\b(?:${FUNCIONES_CON_ACCION.join("|")})\\([^)]*?"(\\w+)"`, "g");
/** La segunda indirección real (arriba): valores del objeto `ACCION_POR_PROCESO` de transiciones.ts. */
const RE_ACCION_POR_PROCESO = /ACCION_POR_PROCESO\s*(?::[^=]+)?=\s*\{([^}]*)\}/;
const RE_VALOR_DEL_MAPA = /"(\w+)"/g;

/**
 * Reservadas sin uso todavía (verificado el `grep` de cada una al escribir este test, 2026-09-25): declaradas para algo que
 * depende de una decisión o dependencia externa pendiente, no de una pantalla que se borró. Cada motivo cita dónde ya está
 * documentado — no es un hallazgo nuevo, es una decisión ya tomada.
 */
const RESERVADAS_SIN_USO_TODAVIA: Readonly<Record<string, string>> = {
  notificar_alertas: "Alertas de stock por mail: falta un proveedor de mail configurado (Resend/SendGrid). docs/plan-migracion.md:1097, docs/grounding-decisiones-abiertas-erpnext-dolibarr-2026-09-21.md:134.",
  sincronizar_proveedores: "Reservada sin Server Action propia a propósito, tras sacar el parche que reemplazó la FK real. docs/plan-migracion.md:535,778.",
  ejecutar_tests: "Reservada para una futura pantalla de administración que corra la suite; no existe todavía.",
};

function archivosFuente(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivosFuente(ruta) : /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

function esComentario(linea: string): boolean {
  const t = linea.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
}

/** Saca las líneas que son COMPLETAMENTE un comentario (mismo criterio que carta-solo-lectura.test.ts): un uso "de ejemplo" en
 * un comentario de línea propia no cuenta (hallazgo real del proyecto del que se copió la idea: un `authorize(Roles.X)`
 * mencionado así dio un falso positivo). Una llamada real de varias líneas sigue matcheando: solo se sacan líneas enteras. */
function sinLineasDeComentario(fuente: string): string {
  return fuente
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => !esComentario(l))
    .join("\n");
}

/** Las claves que aparecen como argumento de alguna de `FUNCIONES_CON_ACCION`, o como valor de `ACCION_POR_PROCESO`, en todo `src/`. */
function clavesUsadas(): Set<string> {
  const usadas = new Set<string>();
  for (const ruta of archivosFuente(SRC)) {
    const fuente = sinLineasDeComentario(readFileSync(ruta, "utf8"));
    for (const m of fuente.matchAll(RE_USO)) usadas.add(m[1]);
    const mapa = RE_ACCION_POR_PROCESO.exec(fuente)?.[1];
    if (mapa) for (const v of mapa.matchAll(RE_VALOR_DEL_MAPA)) usadas.add(v[1]);
  }
  return usadas;
}

describe("catálogo de permisos: toda acción declarada se usa como guarda en algún lado", () => {
  it("hay acciones en el catálogo", () => {
    expect(ACCIONES.length).toBeGreaterThan(30);
  });

  it("ninguna acción del catálogo queda sin ningún uso real (salvo las reservadas a propósito)", () => {
    const usadas = clavesUsadas();
    const huerfanas = ACCIONES.map((a) => a.clave).filter((clave) => !usadas.has(clave) && !(clave in RESERVADAS_SIN_USO_TODAVIA));
    expect(
      huerfanas,
      `Estas acciones están en ACCIONES (src/core/permisos/acciones.ts) pero ningún conPermiso/requierePermiso*/obtenerMiNivelPermiso ni ACCION_POR_PROCESO las usa en src/, y no están en RESERVADAS_SIN_USO_TODAVIA:\n${huerfanas.join("\n")}\n` +
        `¿Se borró la pantalla/acción que protegían sin limpiar el catálogo, se declararon para algo que nunca se llegó a proteger, o falta agregarlas a RESERVADAS_SIN_USO_TODAVIA con su motivo?`
    ).toEqual([]);
  });

  it("ninguna reservada dejó de estar sin uso (si ya se usa, sáquenla de RESERVADAS_SIN_USO_TODAVIA)", () => {
    const usadas = clavesUsadas();
    const yaNoReservadas = Object.keys(RESERVADAS_SIN_USO_TODAVIA).filter((clave) => usadas.has(clave));
    expect(yaNoReservadas, `Estas ya tienen un uso real: sacalas de RESERVADAS_SIN_USO_TODAVIA:\n${yaNoReservadas.join("\n")}`).toEqual([]);
  });

  it("toda clave de RESERVADAS_SIN_USO_TODAVIA sigue existiendo en ACCIONES", () => {
    const claves = new Set(ACCIONES.map((a) => a.clave));
    const obsoletas = Object.keys(RESERVADAS_SIN_USO_TODAVIA).filter((clave) => !claves.has(clave));
    expect(obsoletas, `Estas ya no están en ACCIONES: sacalas de RESERVADAS_SIN_USO_TODAVIA:\n${obsoletas.join("\n")}`).toEqual([]);
  });

  describe("el detector (con fuentes sintéticas)", () => {
    it("encuentra la clave en cada una de las funciones, con distintos argumentos delante", () => {
      const fuente = [
        'return conPermiso("alta_producto", async () => {});',
        'await requierePermiso(usuarioId, sucursalId, "editar_producto");',
        'const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "carta");',
        'await requerirVer("reportes");',
        'await requerirVerEnSucursal(sucursalId, "precio_local");',
        'const { editar } = await obtenerMiNivelPermiso(usuarioId, sucursalId, "pos_mesas");',
      ].join("\n");
      const encontradas = new Set([...fuente.matchAll(RE_USO)].map((m) => m[1]));
      expect(encontradas).toEqual(new Set(["alta_producto", "editar_producto", "carta", "reportes", "precio_local", "pos_mesas"]));
    });

    it("encuentra los valores del mapa ACCION_POR_PROCESO", () => {
      const fuente = 'export const ACCION_POR_PROCESO: Record<Proceso, AccionClave> = {\n  PRODUCCION: "proceso_produccion",\n  CONSUMO: "proceso_consumo",\n};\n';
      const mapa = RE_ACCION_POR_PROCESO.exec(fuente)?.[1] ?? "";
      expect(new Set([...mapa.matchAll(RE_VALOR_DEL_MAPA)].map((m) => m[1]))).toEqual(new Set(["proceso_produccion", "proceso_consumo"]));
    });

    it("no encuentra nada en un comentario ni en un nombre de función parecido", () => {
      const fuente = sinLineasDeComentario(['// conPermiso("alta_producto", fn) es un ejemplo', 'otraFuncionConPermiso("x");'].join("\n"));
      expect([...fuente.matchAll(RE_USO)]).toEqual([]);
    });
  });
});
