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
 * `db-solo-desde-auth-y-carta-publica` (ADR-007, paso N2): el ÚNICO grupo de archivos de `src/` que puede importar `src/lib/db.ts`
 * (el cliente Prisma global). Todo el resto recibe la base del contexto (`ctx.db` / `ctx.transaccion` de `ContextoUsuario`, o `db: Db`
 * por parámetro), de modo que elegir la base de un pedido (hoy `prisma`; con RLS, una transacción con la empresa fijada) es un
 * único punto: `core/auth/base.ts`. Los crons (`api/cron/`) la piden con `baseDelContexto()`; los seeds, scripts y tests viven fuera
 * de `src/` y la regla no los alcanza.
 */
const IMPORTADORES_DE_DB = [
  {
    ruta: "src/core/auth/base.ts",
    motivo: "`baseDelContexto()`: el único lugar donde un pedido elige su cliente de base (hoy `prisma` + `$transaction`).",
  },
  {
    ruta: "src/core/auth/acceso.ts",
    motivo: "Resolución de acceso del usuario de sesión (login/jerarquía de roles): corre antes del contexto; `db` es parámetro con default solo aquí.",
  },
  {
    ruta: "src/core/auth/bootstrap.ts",
    motivo: "Alta del primer admin al primer login: corre antes de que el usuario tenga contexto.",
  },
  {
    ruta: "src/lib/auth.ts",
    motivo: "Auth.js: `PrismaAdapter(prisma)` — el adaptador de sesiones necesita el cliente global; no hay contexto de usuario durante el login.",
  },
  {
    ruta: "src/core/carta/publica-sin-sesion.ts",
    motivo: "Resolución PÚBLICA de la carta (empresa, portal, carta de una sucursal): sin sesión no hay contexto que dé la base. Único punto de entrada de las páginas públicas.",
  },
];

/**
 * `ui-sin-prisma`: páginas que todavía leen la base directo (`import { prisma } from "@/lib/db"`). Se migran en tareas
 * FUTURAS (Fase D) a una capa `src/server/consultas/`; cada migración saca su página de esta lista en el mismo commit
 * (el complemento de Vitest falla si una página listada deja de importar `@/lib/db`). Verificado el 2026-09-27: las 11
 * existían y las 11 hacían `import { prisma } from "@/lib/db"` (no de solo tipo). Migradas (fuera de la lista):
 *  - D1 (piloto): catalogo/productos/[id] y catalogo/productos/[id]/editar → src/server/consultas/catalogo/productos.ts.
 *  - D2: catalogo/proveedores/[id] y catalogo/proveedores/[id]/editar → src/server/consultas/catalogo/proveedores.ts.
 *  - D3: catalogo/recetas (listado) → src/server/consultas/catalogo/recetas.ts; catalogo/recetas/[productoId]/historial →
 *    reusa obtenerProductoPorId de src/server/consultas/catalogo/productos.ts.
 *  - D5: administracion/usuarios → src/server/consultas/permisos/roles.ts.
 *  - D6: movimientos/[proceso] (deep-link ?productoId=) → obtenerProductoOpcion de src/server/consultas/catalogo/productos.ts.
 *  - D7: reportes/rendimiento-recetas/por-sucursal → src/server/consultas/reportes/rendimiento-por-sucursal.ts.
 *  - D8: (pos)/mesas → src/server/consultas/pos/mesas.ts.
 *  - D4: catalogo/recetas/[productoId] (editor) → listarMpDisponiblesEnAlguna, listarOpcionesDeSustituto y
 *    listarCalibracionesDeIngredientes de src/server/consultas/catalogo/recetas.ts; el producto reusa obtenerProductoPorId
 *    de src/server/consultas/catalogo/productos.ts (D1). Fase D completa: las 9 páginas ya están migradas.
 */
const MOTIVO_PENDIENTE = "Lee la base directo desde la página; pendiente de migrar a src/server/consultas/ (Task #41, Fase D).";
const PENDIENTES_DE_MIGRAR = [].map((ruta) => ({ ruta, motivo: MOTIVO_PENDIENTE }));

/**
 * `sin-ciclos`: ciclos que ya existían al activar la regla (corrida en modo informe el 2026-09-27: 1 ciclo en todo `src/`).
 * NO se arreglan en esta fase; cada entrada lista los archivos EXACTOS del ciclo (el complemento de Vitest exige que el
 * conjunto de ciclos reales sea exactamente el de esta lista).
 */
/*
 * Ciclo entre DOMINIOS de `core/` (no de archivos), documentado acá aunque no lleve entrada — Task #41, Fase C2/C3:
 * `core/movimientos/registrar-venta.ts` → `core/reportes/public-servidor.ts` (`calcularCostosYMargenes`) mientras
 * `core/reportes/periodo.ts` importa `core/movimientos/public.ts` (`esSignoFijo`). Es LEGÍTIMO (la venta congela su costo
 * dentro de la misma transacción) y es el ÚNICO ciclo real entre dominios de `core/`. No es un ciclo de ARCHIVOS
 * (`public-servidor.ts` no alcanza nada de `core/movimientos/`), así que `sin-ciclos` no lo ve y no va en CICLOS_CONOCIDOS:
 * el complemento de Vitest exige que esa lista sea exactamente la de los ciclos de archivos reales. Resuelto en C3: ambos
 * lados ya pasan por la fachada del otro dominio (`sin-internals-de-otro-dominio` no lo marca porque ninguna arista toca
 * un archivo interno).
 */
const CICLOS_CONOCIDOS = [
  {
    ciclo: ["src/core/pos/comanda.ts", "src/core/pos/impresion.ts"],
    motivo:
      "Ciclo de SOLO TIPOS (import type en las dos direcciones, sin efecto en runtime): comanda.ts usa DocumentoImprimible de impresion.ts, e impresion.ts usa ComandaDeEnvio/AnulacionDeComanda de comanda.ts. Se corta moviendo los tipos compartidos a un módulo propio (fase futura).",
  },
];

/**
 * `accion-migrada-sin-orquestacion` (Task #41, Fase M; docs/arquitectura-casos-de-uso-2026-09-27.md): NO es una lista de
 * excepciones sino la de las Server Actions YA MIGRADAS a casos de uso — la regla se aplica SOLO a estos archivos. Cada uno quedó
 * como adaptador fino (conPermiso → guard → caso de uso → aResultadoAccion): no puede volver a importar la base, Prisma en
 * runtime, reintento/idempotencia/auditoría ni server/persistencia/ directo. Al migrar otra acción, se suma acá en el mismo commit
 * (el complemento de Vitest exige que cada archivo exista y lleve "use server").
 */
const ACCIONES_CON_CASO_DE_USO = [
  {
    ruta: "src/server/actions/movimientos/compras.ts",
    motivo:
      "Piloto de la Fase M: anularCompra → casos-de-uso/anular-compra.ts y corregirCompra → casos-de-uso/corregir-compra.ts (transacción, I3, persistencia y auditoría viven en el caso de uso).",
  },
  {
    ruta: "src/server/actions/movimientos/venta.ts",
    motivo:
      "M8: anularVenta → casos-de-uso/anular-venta.ts (transacción, hermanas de promo, persistencia y auditoría). Como la regla vale para todo el archivo, registrarVenta pasó su bloque transaccional (I3 + registrarVentaEnTx) a casos-de-uso/registrar-venta.ts; sus validaciones de entrada siguen en la acción.",
  },
  {
    ruta: "src/server/actions/pos/cuenta-cierre.ts",
    motivo:
      "M12a + M12b: cerrarCuenta → pos/casos-de-uso/cerrar-cuenta.ts y emitirBoletaCorregida → pos/casos-de-uso/emitir-boleta-corregida.ts (transacción, carga, numeración/ejemplar de la boleta, persistencia y auditoría viven en el caso de uso). El archivo no tiene ninguna otra función.",
  },
  {
    ruta: "src/server/actions/pos/cuenta-anulacion.ts",
    motivo:
      "M12c + M12d: anularItemEnviado → pos/casos-de-uso/anular-item-enviado.ts y anularPromoEnviada → pos/casos-de-uso/anular-promo-enviada.ts (transacción, carga, guardas de estado, fila espejo y auditoría viven en el caso de uso). El archivo no tiene ninguna otra función.",
  },
  {
    ruta: "src/server/actions/traspasos/traspasos.ts",
    motivo:
      "M11a + M11b + M11c: sus ocho escrituras → traspasos/casos-de-uso/ (aprobar-y-enviar, cancelar-solicitud, rechazar-solicitud, aceptar, rechazar-envio, confirmar-reingreso, crear-solicitud, crear-envio-directo; transacción, I3 de aceptar/reingreso, persistencia y guard de transición viven en el caso de uso). Sus lecturas (obtenerBandejaTransferencias, listarSucursalesParaSolicitar, listarSucursalesParaEnviar) se mudaron tal cual a traspasos/lecturas.ts, fuera de esta lista.",
  },
  {
    ruta: "src/server/actions/movimientos/movimientos.ts",
    motivo:
      "M13a-c: registrarMovimiento (los 9 procesos del motor genérico: Compra, Producción, Consumo, Ajuste, Transferencia, Merma, Devolución×3) → casos-de-uso/registrar-movimiento.ts (sección propia, motivo/destino, factura, I3, transacción, persistencia en server/persistencia/movimientos/ y el paso 6 registrarProveedoresDeLaCompra). El archivo no tiene ninguna otra función.",
  },
  {
    ruta: "src/server/actions/stock/reclasificacion.ts",
    motivo:
      "M13d: reclasificarStock (caso de uso PROPIO, no el motor genérico de M13a-c: un producto, un origen, N destinos, la regla \"la suma de destinos es exactamente el saldo\") → casos-de-uso/reclasificar-stock.ts (secciones propias, \"único destino idéntico al origen\", I3, transacción; reutiliza escribirOperacionDeStock/escribirLineasDeMovimientoStock de M13b y registrarResultadoIdempotente). obtenerSaldoDisponibleParaReclasificar (solo lectura) se mudó tal cual a lecturas-reclasificacion.ts. El archivo no tiene ninguna otra función.",
  },
  {
    ruta: "src/server/actions/movimientos/conteo-fisico.ts",
    motivo:
      "M13e1 + M13e2, cierra la cadena M13a-e: registrarConteoFisico/registrarConteosFisicos (M13e1) → casos-de-uso/registrar-conteo-fisico.ts; resolverConteoPendiente (M13e2) → casos-de-uso/resolver-conteo-pendiente.ts; cancelarConteoFisico (M13e2) → casos-de-uso/cancelar-conteo-fisico.ts (persistencia compartida: cargar-conteo-fisico.ts, escribir-conteo-fisico.ts, y de M13b/M13d cargar-producto-con-unidad-de-stock.ts/escribir-movimiento-de-stock.ts). obtenerHistorialConteosFisicos (solo lectura) se mudó tal cual a lecturas-conteo-fisico.ts. El archivo no tiene ninguna otra función.",
  },
  {
    ruta: "src/server/actions/reportes/consignacion.ts",
    motivo:
      "M14: registrarPagoConsignante (antes sin transacción, sin I3, sin auditoría — un doble clic real registraba el pago dos veces) → casos-de-uso/registrar-pago-consignante.ts (idempotencia I3 con prisma.$transaction SIMPLE — sin invariante de agregado que proteger, solo un insert con clave única —, persistencia en server/persistencia/reportes/pago-consignante.ts, auditoría). El archivo no tiene ninguna otra función.",
  },
];

module.exports = {
  "core-sin-react-next": CORE_CON_REACT_NEXT,
  "ui-sin-prisma": PENDIENTES_DE_MIGRAR,
  "db-solo-desde-auth-y-carta-publica": IMPORTADORES_DE_DB,
  "sin-ciclos": CICLOS_CONOCIDOS,
  PENDIENTES_DE_MIGRAR,
  ACCIONES_CON_CASO_DE_USO,
};
