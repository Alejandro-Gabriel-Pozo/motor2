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
    ruta: "src/server/sesion/acceso.ts",
    motivo: "Resolución de acceso del usuario de sesión (login/jerarquía de roles): corre antes del contexto, así que lee `user`/`session` con el `prisma` global (la sesión abierta de otra cuenta) y el resto con `dbDeEmpresa`/`dbDeUsuario`.",
  },
  {
    ruta: "src/lib/auth.ts",
    motivo: "Auth.js: `PrismaAdapter(prisma)` — el adaptador de sesiones necesita el cliente global; no hay contexto de usuario durante el login.",
  },
  {
    ruta: "src/server/carta-publica/sin-sesion.ts",
    motivo: "Resolución PÚBLICA de la carta (empresa, portal, carta de una sucursal): sin sesión no hay contexto que dé la base. Único punto de entrada de las páginas públicas.",
  },
];

/**
 * `base-solo-desde-lista`: el ÚNICO grupo de archivos de `src/` que puede importar `src/core/auth/base.ts` (las funciones que fijan la empresa/el usuario
 * de la base: `dbDeEmpresa`, `dbDeUsuario`, `baseDeEmpresa`, `baseDelContexto`). Es la frontera que `db-solo-desde-auth-y-carta-publica` deja abierta: sin ella,
 * cualquier archivo podría pedir una base «de otra empresa» sin pasar por el contexto del usuario. Una importación nueva obliga a decidir y a explicar por qué.
 */
const IMPORTADORES_DE_BASE = [
  { ruta: "src/core/auth/contexto.ts", motivo: "Arma el `ContextoUsuario` de cada pedido: es quien le da `ctx.db` al resto." },
  { ruta: "src/server/sesion/acceso.ts", motivo: "Resolución de acceso previa al contexto (login, jerarquía de roles): lee con la empresa/el usuario fijados." },
  { ruta: "src/server/sesion/invitacion.ts", motivo: "Lectura de la invitación por el hash de su token (`dbDeInvitacion`) y de sus sucursales bajo su empresa: ocurre antes de que el invitado tenga empresa ni sesión (Hito 3, B3-3: antes en core/auth/invitacion.ts)." },
  { ruta: "src/server/carta-publica/sin-sesion.ts", motivo: "Carta pública: sin sesión no hay contexto; fija la empresa de la URL con `dbDeEmpresa`." },
  { ruta: "src/server/actions/auth/empresa-activa.ts", motivo: "Cambio de empresa activa: valida las pertenencias del usuario con `baseDeEmpresa` antes de escribir la cookie." },
  { ruta: "src/app/api/cron/sincronizar-dolar/route.ts", motivo: "Cron sin sesión (autorizado por CRON_SECRET): pide la base con `baseDelContexto()`." },
  { ruta: "src/app/api/cron/sincronizar-ipc/route.ts", motivo: "Cron sin sesión (autorizado por CRON_SECRET): pide la base con `baseDelContexto()`." },
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
 * conjunto de ciclos reales sea exactamente el de esta lista). VACÍA desde el Hito 4 (O.28): el único ciclo, de solo tipos,
 * era `core/pos/comanda.ts ↔ core/pos/impresion.ts`; se cortó mudando `documentoDeReimpresion` (la única razón por la que
 * `comanda.ts` importaba de `impresion.ts`) a `impresion.ts`. Un módulo de solo tipos no alcanzaba: `DocumentoImprimible`
 * necesita `ComandaDeEnvio`.
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
const CICLOS_CONOCIDOS = [];

/**
 * `ui-sin-internals-de-dominio` (Pureza Fase 2, paso 2.3): app/ y components/ importan de un dominio de negocio SOLO por su fachada
 * (`core/<dominio>/public.ts` o `public-servidor.ts`). Estas son las que todavía importan un archivo interno. La lista solo se achica.
 */
const UI_CON_INTERNALS_DE_DOMINIO = [
];

/**
 * `paginas-solo-consultas` (Pureza, auditoría de las Fases 2 y 3; trabajo 1.12 de la rama `pureza-integracion`): una página (`page.tsx`/`layout.tsx`) obtiene sus datos de `server/consultas` y
 * no de `server/lecturas` ni de `server/persistencia`. ADR-026 fijó que las lecturas compartidas entre pantalla y escritura las importan consultas, persistencia y acciones, «nunca la UI»; hoy 5
 * páginas la atraviesan. La lista solo se achica: una página nueva que importe esas capas falla.
 */
const PAGINAS_CON_LECTURAS_O_PERSISTENCIA = [];

/**
 * `accion-migrada-sin-orquestacion` (Task #41, Fase M; docs/arquitectura-casos-de-uso-2026-09-27.md): NO es una lista de
 * excepciones sino la de las Server Actions YA MIGRADAS a casos de uso — la regla se aplica SOLO a estos archivos. Cada uno quedó
 * como adaptador fino (conPermiso → guard → caso de uso → aResultadoAccion): no puede volver a importar la base, Prisma en
 * runtime, reintento/idempotencia/auditoría ni server/persistencia/ directo. Al migrar otra acción, se suma acá en el mismo commit
 * (el complemento de Vitest exige que cada archivo exista y lleve "use server").
 */
const ACCIONES_CON_CASO_DE_USO = [
  {
    ruta: "src/server/actions/auth/invitacion.ts",
    motivo:
      "Hito 3, B3-5 + B3-7: aceptarMiInvitacion → auth/casos-de-uso/aceptar-invitacion-de-gerente.ts y aceptarMiInvitacionDeUsuario → auth/casos-de-uso/aceptar-invitacion-de-usuario.ts (transacción serializable, revalidación, persistencia y auditoría viven en el caso de uso). abrirInvitacion solo lee la invitación y escribe la cookie: no escribe la base.",
  },
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
      "M12a + M12b: cerrarCuenta → pos/casos-de-uso/cerrar-cuenta.ts y emitirTicketCorregido → pos/casos-de-uso/emitir-ticket-corregido.ts (transacción, carga, numeración/ejemplar del ticket, persistencia y auditoría viven en el caso de uso). El archivo no tiene ninguna otra función.",
  },
  {
    ruta: "src/server/actions/pos/cuenta-apertura.ts",
    motivo:
      "Hito 4, bloque 4.1 (pasos 5 a 8): liberarMesa → pos/casos-de-uso/liberar-mesa.ts, corregirComensales → corregir-comensales.ts, asignarClienteACuenta → asignar-cliente-a-cuenta.ts y abrirCuenta → abrir-cuenta.ts (transacción serializable, la cuenta o la mesa, la idempotencia y el límite de mesas, la persistencia en server/persistencia/pos/{cuenta,cerrar-cuenta}.ts y la auditoría del cliente viven en el caso de uso); el formato del id lo validan sus guardComando* (core/features/cuentas/cuenta-apertura.guard.ts) dentro de conPermiso. El archivo no tiene ninguna otra función.",
  },
  {
    ruta: "src/server/actions/pos/cuenta-pedido.ts",
    motivo:
      "Hito 4, bloque 4.1 (pasos 9 a 12): quitarItemSinEnviar → pos/casos-de-uso/quitar-item-sin-enviar.ts, quitarPromoSinEnviar → quitar-promo-sin-enviar.ts, enviarACocina → enviar-a-cocina.ts y agregarItems → agregar-items.ts (transacción serializable, la cuenta abierta, la validación de cada ítem y promo, los hermanos de promo y las escrituras en server/persistencia/pos/pedido.ts viven en el caso de uso); el formato lo validan sus guardComando* (core/features/cuentas/cuenta-pedido.guard.ts) dentro de conPermiso. El archivo no tiene ninguna otra función.",
  },
  {
    ruta: "src/server/actions/pos/mesas.ts",
    motivo:
      "Hito 4, bloque 4.1 (pasos 3 y 4): crearMesa → pos/casos-de-uso/crear-mesa.ts y actualizarMaxMesasAbiertas → pos/casos-de-uso/actualizar-max-mesas-abiertas.ts (la escritura en server/persistencia/pos/mesas.ts, la traducción del número repetido y la auditoría del límite viven en el caso de uso); el formato lo validan guardComandoCrearMesa y guardComandoActualizarMaxMesasAbiertas dentro de conPermiso. El archivo no tiene ninguna otra función.",
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
  {
    ruta: "src/server/actions/permisos/capacidades-sucursal.ts",
    motivo:
      "Hito 3, Fase I, I.1: actualizarCapacidad → permisos/casos-de-uso/actualizar-capacidad.ts (la sucursal existe, escritura en server/persistencia/permisos/capacidades.ts y auditoría en una transacción); el formato lo valida guardComandoActualizarCapacidad dentro de conPermisoDeEmpresa. listarCapacidades es una lectura (H8).",
  },
  {
    ruta: "src/server/actions/permisos/roles.ts",
    motivo:
      "Hito 3, Fase I, I.2: crearRol → permisos/casos-de-uso/crear-rol.ts (con guardComandoCrearRol dentro de conEdicionDePermisos), renombrarRol → casos-de-uso/renombrar-rol.ts y actualizarActivoRol → casos-de-uso/actualizar-activo-rol.ts (transacción de gobierno, salvaguardas G2, escritura en server/persistencia/permisos/roles.ts y auditoría en el caso de uso). listarRoles es una lectura (H8).",
  },
  {
    ruta: "src/server/actions/permisos/permisos.ts",
    motivo:
      "Hito 3, Fase I, I.3: guardarPermisos → permisos/casos-de-uso/guardar-permisos.ts (roles y acciones leídos dentro de la transacción desde O.35, chequeo optimista, SERIALIZABLE con reintento y el conflicto de escritura como fracaso de negocio, escritura en server/persistencia/permisos/matriz.ts y auditoría); el formato lo valida guardComandoGuardarPermisos dentro de conEdicionDePermisos. listarMatrizPermisos es una lectura (H8).",
  },
  {
    ruta: "src/server/actions/auth/sucursales.ts",
    motivo:
      "Hito 3, Fase I, I.4: crearSucursalConAdmin → auth/casos-de-uso/crear-sucursal-con-admin.ts, actualizarActivoSucursal → casos-de-uso/actualizar-activo-sucursal.ts y renombrarSucursal → casos-de-uso/renombrar-sucursal.ts (transacción de gobierno e invariantes donde las había, persistencia en server/persistencia/auth/sucursales.ts y permisos/membresias.ts, auditoría en el caso de uso); el formato del alta y del renombre lo validan sus guardComando* dentro de conPermisoDeEmpresa. listarSucursales es una lectura (H8).",
  },
  {
    ruta: "src/server/actions/auth/usuarios.ts",
    motivo:
      "Hito 3, Fase I, I.5: las 8 mutaciones pasan a auth/casos-de-uso/ (agregar-o-actualizar-usuario, actualizar-notas-membresia, actualizar-activo-membresia, actualizar-activo-usuario-en-empresa, transferir-gerencia, revocar-invitacion, reenviar-invitacion, invitar-a-vincular), con la transacción de gobierno, las invariantes, la persistencia (server/persistencia/{permisos/membresias,auth/gerencia,auth/invitaciones-de-usuario}.ts) y la auditoría en el caso de uso o sus pasos compartidos. La acción conserva el envoltorio y la clave, el guard del alta, el requierePermiso extra sobre la sucursal pedida y el mail DESPUÉS de confirmar (enviarInvitacionYAnotar). listarUsuariosDeSucursal y listarInvitacionesPendientes son lecturas (H8).",
  },
  {
    ruta: "src/server/actions/carta/descuento-producto.ts",
    motivo:
      "Hito 4, bloque 4.2, H4C-1: guardarDescuentoProducto → carta/casos-de-uso/guardar-descuento-producto.ts (el producto, la fila actual, el ítem agrupado, la escritura en server/persistencia/carta/descuento-producto.ts y su auditoría en la misma transacción); el formato del % lo valida guardComandoGuardarDescuentoProducto (core/features/carta) dentro de conPermiso, y la acción revalida la carta pública solo si el caso de uso escribió (datos.huboCambio). El archivo no tiene ninguna otra función.",
  },
  {
    ruta: "src/server/actions/carta/promos.ts",
    motivo:
      "Hito 4, bloque 4.2, H4C-2 y H4C-3: guardarPromoCarta → carta/casos-de-uso/guardar-promo-carta.ts (con guardComandoGuardarPromoCarta), guardarPrecioLocalPromoCarta → guardar-precio-local-promo-carta.ts, actualizarActivaPromoCarta → actualizar-activa-promo-carta.ts, actualizarActivaPromoCartaEnSucursal → actualizar-activa-promo-carta-en-sucursal.ts y guardarCuposPromoCarta → guardar-cupos-promo-carta.ts (las lecturas, la validación que va después de leer la promo, el piso de core/carta/piso-de-promo.ts, las escrituras en server/persistencia/carta/promos.ts y la auditoría del precio viven en el caso de uso). La acción revalida la carta pública si sale bien, salvo la de los cupos (como antes). El archivo no tiene ninguna otra función.",
  },
  {
    ruta: "src/server/actions/movimientos/precio-local.ts",
    motivo:
      "Hito 4, bloque 4.2, H4C-4: setPrecioLocalProducto → movimientos/casos-de-uso/set-precio-local-producto.ts y sincronizarPrecioLocalGrupoCarta → sincronizar-precio-local-grupo-carta.ts, con el paso compartido guardar-precio-local-en-tx.ts (escritura en server/persistencia/movimientos/precio-local.ts y sus dos filas de auditoría en la misma transacción); el formato lo validan sus guardComando* (core/features/movimientos/precio-local.guard.ts) dentro de conPermiso. La acción revalida la carta pública y, después, calcula el sincronizable con el ítem agrupado (como antes). obtenerPrecioLocalProducto y listarPreciosLocales son lecturas.",
  },
  {
    ruta: "src/server/actions/catalogo/rendimiento-local.ts",
    motivo:
      "Hito 4, bloque 4.2, H4C-5: fijarRendimientoLocal → catalogo/casos-de-uso/fijar-rendimiento-local.ts (con guardComandoFijarRendimientoLocal, core/features/catalogo) y volverAlRendimientoCentral → volver-al-rendimiento-central.ts (transacción SERIALIZABLE con reintento, la línea vigente, la escritura en server/persistencia/catalogo/rendimiento-local.ts, la auditoría y el .catch del conflicto agotado viven en el caso de uso); la acción refresca la vista si salió bien (volver, solo si hubo cambio). El archivo no tiene ninguna otra función.",
  },
  {
    ruta: "src/server/actions/catalogo/receta-sucursal.ts",
    motivo:
      "Hito 4, bloque 4.2, H4C-6: volverALaRecetaCentral → catalogo/casos-de-uso/volver-a-la-receta-central.ts (transacción SERIALIZABLE con reintento, la propia habilitada, la escritura en server/persistencia/catalogo/receta-sucursal.ts, la auditoría y el .catch del conflicto agotado; la confirmación la exige guardComandoVolverALaRecetaCentral dentro de conPermiso). Las otras cinco (crear, agregar, editar, quitar, copiar la receta propia) ya escribían por casos-de-uso/guardar-version-de-receta.ts; acá solo leen el estado de la propia y la central para armar la versión nueva.",
  },
  {
    ruta: "src/server/actions/catalogo/categorias-producto.ts",
    motivo:
      "Hito 4, bloque 4.3, H4C-7: crearCategoriaProducto → catalogo/casos-de-uso/crear-categoria-producto.ts (con guardComandoCrearCategoriaProducto: buscar por nombre, reusar o crear en server/persistencia/catalogo/categorias-producto.ts; la acción arma el ResultadoConId con el id y el nombre que devuelve) y actualizarActivaCategoriaProducto → actualizar-activa-categoria-producto.ts (la acción refresca la vista, como antes). La lectura listarCategoriasProducto (H8) sigue en la acción.",
  },
  {
    ruta: "src/server/actions/catalogo/unidades.ts",
    motivo:
      "Hito 4, bloque 4.3, H4C-8: crearUnidad → catalogo/casos-de-uso/crear-unidad.ts (con guardComandoCrearUnidad; la acción arma el ResultadoConId), actualizarActivaUnidad → actualizar-activa-unidad.ts y actualizarDecimalesUnidad → actualizar-decimales-unidad.ts (con guardComandoActualizarDecimalesUnidad; los productos «Se produce», la unidad y el cambio con su auditoría en UNA transacción); escrituras en server/persistencia/catalogo/unidades.ts. La acción refresca la vista en los mismos caminos que antes. Las lecturas (H8 y detectarInsumosConUnidadMezclada, con su gate inline) siguen en la acción.",
  },
  {
    ruta: "src/server/actions/catalogo/insumos.ts",
    motivo:
      "Hito 4, bloque 4.3, H4C-9: crearInsumo → catalogo/casos-de-uso/crear-insumo.ts (con guardComandoCrearInsumo; la acción arma el ResultadoConId), actualizarActivoInsumo → actualizar-activo-insumo.ts, actualizarGrupoDeInsumo → actualizar-grupo-de-insumo.ts, renombrarOFusionarInsumo → renombrar-o-fusionar-insumo.ts (con guardComandoRenombrarOFusionarInsumo; la fusión en UNA transacción con reapuntarSustitutosDeInsumoFusionado, mudada tal cual a la persistencia; desde H4C-10, D-9, la fusión y el renombre se auditan en su transacción), crearOActualizarGrupo → crear-o-actualizar-grupo.ts (con guardComandoCrearOActualizarGrupo) y actualizarActivoGrupo → actualizar-activo-grupo.ts; escrituras en server/persistencia/catalogo/{insumos,grupos}.ts. La acción refresca la vista en los mismos caminos que antes. Las lecturas (H8 y previsualizarFusionInsumo) siguen en la acción.",
  },
  {
    ruta: "src/server/actions/catalogo/productos.ts",
    motivo:
      "Hito 4, bloque 4.3, H4C-11 a H4C-13: asignarInsumoAProducto, agregarPresentacionAlternativa, actualizarActivaPresentacion y actualizarDisponibilidadProducto (H4C-11, tal cual: la disponibilidad escribe y audita sin transacción), darDeAltaProductoRapido (con guardComandoDarDeAltaProductoRapido) y darDeAltaProducto (H4C-12: sin transacción a propósito por el reintento del código; la acción pasa azarDelProceso y arma el ResultadoConId), actualizarProducto y sincronizarPrecioGrupoCarta (H4C-13, con guardComandoSincronizarPrecioGrupoCarta; la auditoría en la transacción del caso de uso) → catalogo/casos-de-uso/; escrituras en server/persistencia/catalogo/productos.ts; validarDatosDeProducto en server/lecturas/catalogo/datos-de-producto.ts. La acción revalida la carta pública en los mismos caminos que antes y calcula el sincronizable de la edición DESPUÉS de revalidar. Las lecturas (H8) siguen en la acción.",
  },
  {
    ruta: "src/server/actions/catalogo/proveedores.ts",
    motivo:
      "Hito 4, bloque C, H4C-14: altaProveedor → catalogo/casos-de-uso/alta-proveedor.ts (con guardComandoAltaProveedor; sin transacción a propósito por el reintento del código; la acción pasa azarDelProceso y arma el ResultadoConId), actualizarActivaProveedor → actualizar-activa-proveedor.ts (la acción refresca la vista, como antes) y actualizarProveedor → actualizar-proveedor.ts (lee, valida y escribe en el mismo orden); escrituras en server/persistencia/catalogo/proveedores.ts y la lectura del CUIT repetido en server/lecturas/catalogo/proveedor-con-cuit.ts. Las lecturas (H8) siguen en la acción.",
  },
  {
    ruta: "src/server/actions/clientes/cliente.ts",
    motivo:
      "Hito 4, bloque C, H4C-15: altaCliente → clientes/casos-de-uso/alta-cliente.ts (con guardComandoAltaCliente; la acción arma el ResultadoConId), actualizarCliente → actualizar-cliente.ts y actualizarActivoCliente → actualizar-activo-cliente.ts (la acción refresca la vista solo si salió bien, como antes); cada uno con su escritura (server/persistencia/clientes/clientes.ts) y sus filas de auditoría (cambioDeCliente, core/features/clientes/auditoria-de-cliente.ts) en UNA transacción. Las lecturas (H8) siguen en la acción.",
  },
  {
    ruta: "src/server/actions/reportes/margen-objetivo.ts",
    motivo:
      "Hito 4, bloque C, H4C-16: guardarMargenObjetivo → reportes/casos-de-uso/guardar-margen-objetivo.ts (con guardComandoGuardarMargenObjetivo: la categoría y el porcentaje; crear, cambiar o borrar en server/persistencia/reportes/margen-objetivo.ts con su auditoría en UNA transacción; con el mismo valor no escribe). La acción refresca la vista solo si hubo cambio (datos.huboCambio), como antes.",
  },
  {
    ruta: "src/server/actions/movimientos/motivos.ts",
    motivo:
      "Hito 4, bloque C, H4C-17: crearMotivoMerma y crearDestinoConsumo → movimientos/casos-de-uso/crear-{motivo-merma,destino-consumo}.ts (con guardComandoCrearMotivoMerma / guardComandoCrearDestinoConsumo; la acción arma el ResultadoConId) y las dos de activar → actualizar-activo-{motivo-merma,destino-consumo}.ts; escrituras en server/persistencia/movimientos/motivos.ts, sin transacción ni auditoría (como antes). La acción refresca la vista solo si salió bien, como antes. Las lecturas (H8) siguen en la acción.",
  },
  {
    ruta: "src/server/actions/movimientos/secciones.ts",
    motivo:
      "Hito 4, bloque C, H4C-18: crearSeccion (con guardComandoCrearSeccion; la acción arma el ResultadoConId), renombrarSeccion (con guardComandoRenombrarSeccion: el nombre, antes de leer), actualizarActivaSeccion y actualizarRespaldoSeccion (con guardComandoActualizarRespaldoSeccion: el booleano y que el id sea un texto) → movimientos/casos-de-uso/{crear-seccion,renombrar-seccion,actualizar-activa-seccion,actualizar-respaldo-seccion}.ts; escrituras en server/persistencia/movimientos/secciones.ts, sin transacción ni auditoría (como antes). La acción refresca la vista solo si salió bien, como antes. Las lecturas (H8) siguen en la acción.",
  },
];

module.exports = {
  "core-sin-react-next": CORE_CON_REACT_NEXT,
  "ui-sin-prisma": PENDIENTES_DE_MIGRAR,
  "db-solo-desde-auth-y-carta-publica": IMPORTADORES_DE_DB,
  "base-solo-desde-lista": IMPORTADORES_DE_BASE,
  "sin-ciclos": CICLOS_CONOCIDOS,
  "ui-sin-internals-de-dominio": UI_CON_INTERNALS_DE_DOMINIO,
  "paginas-solo-consultas": PAGINAS_CON_LECTURAS_O_PERSISTENCIA,
  PENDIENTES_DE_MIGRAR,
  ACCIONES_CON_CASO_DE_USO,
};
