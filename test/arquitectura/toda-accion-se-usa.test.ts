import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCIONES } from "../../src/core/permisos/acciones";
import { clavesUsadas, inventariarDirectorio } from "./guardas/inventario";

/**
 * Guardián de catálogo (inspirado en las "cercas" RBAC de otro proyecto propio, un backend de reservas: un documento/catálogo
 * vivo se desincroniza en silencio del código real si nada lo compara). El riesgo acá NO es "una guarda usa una clave que no
 * existe" — eso ya lo impide `AccionClave` (unión de literales derivada de `ACCIONES`, `src/core/permisos/acciones.ts`):
 * `tsc` rechaza cualquier literal que no esté en el catálogo. El riesgo que NINGÚN tipo cubre es el inverso: una acción
 * declarada en `ACCIONES` (aparece en la matriz de permisos, alguien le puede tocar Ver/Editar) que NINGÚN lugar del código usa
 * de verdad como guarda — una acción "fantasma": o quedó huérfana (se borró la pantalla/acción que protegía y no se limpió el
 * catálogo), o se declaró para una función que nunca se llegó a proteger.
 *
 * Cómo se controla: el inventario AST (`guardas/inventario.ts`) junta las claves que son argumento de cada función de guarda
 * (`conPermiso`, `requierePermiso*`, `requerirVer*`, `obtenerMiNivelPermiso`, …, con o sin genéricos) en TODO `src/`, MÁS los valores
 * de `ACCION_POR_PROCESO` (la indirección real: `/movimientos/[proceso]` resuelve la acción desde una variable), y exige que cada
 * `clave` de `ACCIONES` aparezca. Las pocas reservadas a propósito para algo que todavía no se construyó van en
 * `RESERVADAS_SIN_USO_TODAVIA`, cada una con su motivo — verificado en las DOS direcciones (si una deja de estar reservada
 * porque ya se usa, la excepción sobra y hay que sacarla; mismo criterio que los allowlists de ese otro proyecto).
 *
 * Una guarda cuya clave NO es un literal (una variable) el inventario no la puede leer: cada una tiene que estar en
 * `GUARDAS_CON_CLAVE_DINAMICA`, con el motivo y de dónde sale la clave. Una nueva sin declarar falla, así que no se cuela una clave
 * que ningún guardián ve.
 *
 * A propósito NO se agrega un documento markdown paralelo tipo "matriz de permisos": la matriz real ya vive en
 * `/administracion/permisos`, leída en vivo de la base — un doc estático sería una tercera fuente que se puede desincronizar
 * de las otras dos, exactamente el problema que esta clase de guardián existe para evitar.
 */
const SRC = join(__dirname, "../../src");

/**
 * Reservadas sin uso todavía (verificado el `grep` de cada una al escribir este test, 2026-09-25): declaradas para algo que
 * depende de una decisión o dependencia externa pendiente, no de una pantalla que se borró. Cada motivo cita dónde ya está
 * documentado — no es un hallazgo nuevo, es una decisión ya tomada.
 */
const RESERVADAS_SIN_USO_TODAVIA: Readonly<Record<string, string>> = {
  notificar_alertas: "Alertas de stock por mail: falta un proveedor de mail configurado (Resend/SendGrid). docs/plan-migracion.md:1099, docs/grounding-decisiones-abiertas-erpnext-dolibarr-2026-09-21.md:134.",
};

/**
 * Guardas cuya clave llega por una variable (el inventario no la puede leer como literal). `archivo|texto del argumento` → de dónde sale
 * la clave. Las que llegan por parámetro de un envoltorio se leen en cada llamada al envoltorio; las otras tienen su propio guardián.
 */
const GUARDAS_CON_CLAVE_DINAMICA: Readonly<Record<string, string>> = {
  "core/permisos/gate.ts|accionClave": "Implementación de `sucursalesDondeElUsuarioPuedeVer`: reenvía a `obtenerMiNivelPermiso` la clave que recibió; cada llamada a la primera se inventaría.",
  "core/permisos/gate.ts|deSucursal": "Implementación de `accionesDelMenuQueElUsuarioPuedeVer`: reenvía a `accionesQueElUsuarioPuedeVer` las claves de sucursal que recibió; cada llamada al helper se inventaría.",
  "server/actions/con-permiso.ts|accionClave": "Implementación de `conPermiso`: reenvía la clave que recibió; cada llamada a `conPermiso` se inventaría.",
  "server/actions/con-sesion.ts|accion": "Implementación de `requerirVer*`: reenvía la clave que recibió; cada llamada a `requerirVer*` se inventaría.",
  "app/(app)/movimientos/[proceso]/page.tsx|accionClave": "La acción se resuelve del proceso de la URL con `ACCION_POR_PROCESO`; sus valores se inventarían como mapa.",
  "server/actions/movimientos/movimientos.ts|accionClave": "La acción se resuelve del proceso con `ACCION_POR_PROCESO`; sus valores se inventarían como mapa.",
  "components/app-shell.tsx|accionesDeNavegacion()": "Las acciones del menú: cada ítem declara la suya y `menu-con-permiso.test.ts` comprueba que el menú use la misma clave que la página.",
  "core/navegacion/inicio.ts|accionesDelMenu()": "Las acciones del menú (mismo origen que el de `app-shell`).",
};

function clavesDelCodigo() {
  const inventario = inventariarDirectorio(SRC);
  return { inventario, usadas: clavesUsadas(inventario) };
}

describe("catálogo de permisos: toda acción declarada se usa como guarda en algún lado", () => {
  it("hay acciones en el catálogo", () => {
    expect(ACCIONES.length).toBeGreaterThan(30);
  });

  it("ninguna acción del catálogo queda sin ningún uso real (salvo las reservadas a propósito)", () => {
    const { usadas } = clavesDelCodigo();
    const huerfanas = ACCIONES.map((a) => a.clave).filter((clave) => !usadas.has(clave) && !(clave in RESERVADAS_SIN_USO_TODAVIA));
    expect(
      huerfanas,
      `Estas acciones están en ACCIONES (src/core/permisos/acciones.ts) pero ninguna guarda ni ACCION_POR_PROCESO las usa en src/, y no están en RESERVADAS_SIN_USO_TODAVIA:\n${huerfanas.join("\n")}\n` +
        `¿Se borró la pantalla/acción que protegían sin limpiar el catálogo, se declararon para algo que nunca se llegó a proteger, o falta agregarlas a RESERVADAS_SIN_USO_TODAVIA con su motivo?`
    ).toEqual([]);
  });

  it("ninguna reservada dejó de estar sin uso (si ya se usa, sáquenla de RESERVADAS_SIN_USO_TODAVIA)", () => {
    const { usadas } = clavesDelCodigo();
    const yaNoReservadas = Object.keys(RESERVADAS_SIN_USO_TODAVIA).filter((clave) => usadas.has(clave));
    expect(yaNoReservadas, `Estas ya tienen un uso real: sacalas de RESERVADAS_SIN_USO_TODAVIA:\n${yaNoReservadas.join("\n")}`).toEqual([]);
  });

  it("toda clave de RESERVADAS_SIN_USO_TODAVIA sigue existiendo en ACCIONES", () => {
    const claves = new Set<string>(ACCIONES.map((a) => a.clave));
    const obsoletas = Object.keys(RESERVADAS_SIN_USO_TODAVIA).filter((clave) => !claves.has(clave));
    expect(obsoletas, `Estas ya no están en ACCIONES: sacalas de RESERVADAS_SIN_USO_TODAVIA:\n${obsoletas.join("\n")}`).toEqual([]);
  });

  it("toda guarda con clave no literal está declarada en GUARDAS_CON_CLAVE_DINAMICA, y ninguna declarada sobra", () => {
    const { inventario } = clavesDelCodigo();
    const encontradas = new Set(inventario.dinamicos.map((d) => `${d.archivo}|${d.texto}`));
    const sinDeclarar = [...encontradas].filter((k) => !(k in GUARDAS_CON_CLAVE_DINAMICA));
    expect(
      sinDeclarar,
      `Guardas cuya clave no es un literal y que ningún guardián lee (declaralas en GUARDAS_CON_CLAVE_DINAMICA con el motivo, o pasá un literal):\n${sinDeclarar.join("\n")}`
    ).toEqual([]);
    const sobrantes = Object.keys(GUARDAS_CON_CLAVE_DINAMICA).filter((k) => !encontradas.has(k));
    expect(sobrantes, `Estas ya no existen en el código: sacalas de GUARDAS_CON_CLAVE_DINAMICA:\n${sobrantes.join("\n")}`).toEqual([]);
  });
});
