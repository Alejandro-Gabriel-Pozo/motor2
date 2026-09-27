/**
 * Excepciones de las reglas de `.dependency-cruiser.cjs` (Task #41, Fase A3). Una lista por regla; CADA entrada lleva su
 * `motivo`. Si una regla no tiene excepciones, no aparece acá.
 *
 * A propósito NO se usa el baseline propio de dependency-cruiser (`--ignore-known` / `knownViolations`): no lleva motivo y
 * no falla cuando una excepción ya no hace falta. Acá sí: `test/arquitectura/dependencias.test.ts` (parte de `npm test`)
 * revisa cada lista en las DOS direcciones — todo lo que debería estar en la lista está, y todo lo que está en la lista
 * sigue haciendo falta. Al resolver una excepción (migrar una página, mover un archivo, cortar un ciclo), se la saca de acá
 * en el mismo commit; si no, ese test queda en rojo pidiéndolo.
 *
 * Rutas: relativas a la raíz del repo, tal cual las reporta dependency-cruiser (con `/`, sin escapar). La config las
 * convierte en expresiones regulares ancladas (`^...$`) escapando los caracteres especiales (`(app)`, `[id]`, `.`).
 */

/**
 * `core-sin-react-next`: el adaptador de sesión del pedido. Los tres viven en `core/auth/` desde antes de esta regla y
 * moverlos queda fuera de la Fase A: `contexto.ts` y `session.ts` los referencian 88 y 123 archivos de src/ + test/
 * respectivamente (contado el 2026-09-27, incluidos los `vi.mock`), y sus rutas están fijas en `GUARDAS_POR_MODULO` del
 * analizador de guardas (`test/arquitectura/guardas/analizador.ts`).
 */
const CORE_CON_REACT_NEXT = [
  {
    ruta: "src/core/auth/contexto.ts",
    motivo:
      "Adaptador de sesión del pedido: `cache` de react (memoiza obtenerContextoUsuario por request) + `cookies` de next/headers (sucursal activa). Ruta fija en GUARDAS_POR_MODULO; 88 archivos lo referencian.",
  },
  {
    ruta: "src/core/auth/session.ts",
    motivo:
      "Adaptador de sesión del pedido: `cache` de react (memoiza getUsuarioActual por request). Ruta fija en GUARDAS_POR_MODULO; 123 archivos lo referencian (casi todos vi.mock de test/).",
  },
  {
    ruta: "src/core/auth/ir-al-login.ts",
    motivo:
      "Adaptador de sesión del pedido: `headers` de next/headers (ruta pedida) + `redirect` de next/navigation (manda al login recordando la pantalla). Lo usan con-permiso.ts y las páginas.",
  },
];

/**
 * `ui-sin-prisma`: páginas que todavía leen la base directo (`import { prisma } from "@/lib/db"`). Se migran en tareas
 * FUTURAS (Fase D) a una capa `src/server/consultas/`; cada migración saca su página de esta lista en el mismo commit
 * (el complemento de Vitest falla si una página listada deja de importar `@/lib/db`). Verificado el 2026-09-27: las 11
 * existían y las 11 hacían `import { prisma } from "@/lib/db"` (no de solo tipo). Migradas (fuera de la lista):
 *  - D1 (piloto): catalogo/productos/[id] y catalogo/productos/[id]/editar → src/server/consultas/catalogo/productos.ts.
 *  - D7: reportes/rendimiento-recetas/por-sucursal → src/server/consultas/reportes/rendimiento-por-sucursal.ts.
 */
const MOTIVO_PENDIENTE = "Lee la base directo desde la página; pendiente de migrar a src/server/consultas/ (Task #41, Fase D).";
const PENDIENTES_DE_MIGRAR = [
  "src/app/(app)/catalogo/proveedores/[id]/page.tsx",
  "src/app/(app)/catalogo/proveedores/[id]/editar/page.tsx",
  "src/app/(app)/catalogo/recetas/page.tsx",
  "src/app/(app)/catalogo/recetas/[productoId]/historial/page.tsx",
  "src/app/(app)/catalogo/recetas/[productoId]/page.tsx",
  "src/app/(app)/administracion/usuarios/page.tsx",
  "src/app/(app)/movimientos/[proceso]/page.tsx",
  "src/app/(pos)/mesas/page.tsx",
].map((ruta) => ({ ruta, motivo: MOTIVO_PENDIENTE }));

/**
 * `sin-ciclos`: ciclos que ya existían al activar la regla (corrida en modo informe el 2026-09-27: 1 ciclo en todo `src/`).
 * NO se arreglan en esta fase; cada entrada lista los archivos EXACTOS del ciclo (el complemento de Vitest exige que el
 * conjunto de ciclos reales sea exactamente el de esta lista).
 */
const CICLOS_CONOCIDOS = [
  {
    ciclo: ["src/core/pos/comanda.ts", "src/core/pos/impresion.ts"],
    motivo:
      "Ciclo de SOLO TIPOS (import type en las dos direcciones, sin efecto en runtime): comanda.ts usa DocumentoImprimible de impresion.ts, e impresion.ts usa ComandaDeEnvio/AnulacionDeComanda de comanda.ts. Se corta moviendo los tipos compartidos a un módulo propio (fase futura).",
  },
];

module.exports = {
  "core-sin-react-next": CORE_CON_REACT_NEXT,
  "ui-sin-prisma": PENDIENTES_DE_MIGRAR,
  "sin-ciclos": CICLOS_CONOCIDOS,
  PENDIENTES_DE_MIGRAR,
};
