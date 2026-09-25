# Plan: «tomar pedido» en el salón (módulo POS) — 2026-09-25

Pendiente del módulo POS de mesas que sigue al mapa de mesas (`docs/plan-mapa-de-mesas-2026-09-24.md`). Insumo:
`docs/grounding-pos-mesas-comandas-2026-09-24.md` (grounding contra 5 POS de referencia). Plan diseñado por un agente de
planificación contra el código real e implementado en la rama `feat/pos-tomar-pedido`, un commit por paso.

## A. Punto de partida (verificado en el código)

`Mesa`/`Cuenta`/`CuentaItem` ya existían (migración `20260924150903_pos_mesas_cuentas`), pero ningún código de la app escribía
cuentas: solo existía `crearMesa`. El KOT y las correcciones «vía ejemplares» eran solo la investigación del grounding, no una
implementación previa.

## B. Decisiones de diseño

- **B1. KOT derivado de `numeroEnvio`, sin tabla propia.** «Enviar a cocina» = en una transacción serializable,
  `n = max(numeroEnvio) + 1` de la cuenta, y a los ítems elegidos que seguían sin enviar se les pone `numeroEnvio = n`. El «ticket»
  del envío *n* son los ítems con ese número. Sin impresión, pantalla de cocina ni ruteo por estación todavía; no cierra la puerta a
  una tabla `EnvioCocina` futura.
- **B2. Anular un ítem ya enviado = fila espejo negativa + auditoría.** Un `CuentaItem` nuevo con cantidad NEGATIVA, el mismo
  producto/precio/`numeroEnvio` del original, `anulaAItemId` al original, `motivoAnulacion` y `creadoPorId`, más una fila en
  `RegistroAuditoria` (entidad `CuentaItem`, campo `cantidadVigente`). El original nunca se toca: `restante = cantidad + Σ espejos`.
  Mismo patrón append-only que `anularVenta`/`anularCompra`; permite anulación parcial y no rompe los totales existentes (el mapa
  no se tocó: ya trata bien los espejos).
- **B3. «En preparación» = `numeroEnvio IS NOT NULL`.** Sin enviar: se quita sin motivo ni permiso elevado, con DELETE físico
  (es un borrador). Enviado: motivo obligatorio y permiso propio, en una acción aparte. Sin PIN de supervisor (motor2 no tiene
  ese mecanismo): «elevado» es el permiso del rol de quien anula.
- **B4. Permisos: 3 claves nuevas, todas solo admin en la semilla** (`src/core/permisos/acciones.ts`), cada una con su
  migración de datos (calcada de `20260924151000_permiso_pos_mesas`) y su test:
  - `pos_tomar_pedido`: abrir la cuenta, agregar y quitar ítems sin enviar, enviarlos a cocina y liberar una mesa sin consumo.
  - `pos_anular_item`: anular, con motivo, un ítem que ya salió a cocina.
  - `pos_cerrar_cuenta`: cerrar la cuenta (registra la venta y libera la mesa).
  - `pos_mesas` no cambia (Ver = mapa y detalle de mesa; Editar = alta de mesas). El rol «mozo» se arma desde la matriz:
    `pos_mesas` Ver + `pos_tomar_pedido` Editar.
- **B5. Pagar y cerrar son UNA sola acción atómica** (motor2 no tiene entidad de caja/pago): `cerrarCuenta` = registrar la venta +
  `cerradaEn`/`cerradaPorId`, en una transacción serializable.
- **B6. Refactor `registrarVentaEnTx`** (`src/core/movimientos/registrar-venta.ts`): el cuerpo de `registrarVenta` pasó a un
  núcleo sin permisos ni transacción propia, que devuelve `operacionIds` (en orden de línea) y `avisosStockNegativo`. Admite un
  `precioUnitario` por línea (override interno, para cobrar el precio congelado del pedido). `registrarVenta` quedó igual por
  fuera (permiso + validaciones + idempotencia + transacción) y mapea cada línea a mano a `{ productoId, cantidadVendida }`: un
  POST crudo con `precioUnitario` no puede fijar el precio (test). Los tests existentes de venta, idempotencia y concurrencia
  siguen en verde sin tocarlos.
- **B6bis (decisión del dueño, reemplaza «stock insuficiente bloquea el cierre»).** `cerrarCuenta` NO se bloquea por stock
  insuficiente: la mesa ya comió.
  - `registrarVentaEnTx` acepta `opciones.permitirStockNegativo`. Con `true`, un insumo sin stock suficiente no aborta: el
    `MovimientoStock` se escribe igual (el Kardex es un ledger por suma; el saldo queda negativo, sin cambio de esquema) y el
    insumo sale en `avisosStockNegativo` (`{ productoId, nombre, actual, requerido, resultante }`). Ausente o `false` (la venta de
    mostrador): bloquea igual que siempre.
  - `cerrarCuenta` lo usa con `true`. Si hubo avisos, el mensaje de éxito los nombra (p. ej. `Cuenta de la mesa 4 cerrada: se
    registró la venta por $ 72.000. ⚠ Quedó stock negativo: "Muzzarella" (tenía 0,5, se consumió 1,5, quedó en -1). Corregilo con
    un Conteo Físico o un Ajuste.`), la pantalla lo muestra en ámbar, y cada insumo deja una fila de auditoría (entidad `Operacion`
    — la venta que lo consumió —, campo `saldoStock`, antes/después) con la mesa, el insumo, la sección, lo que faltó y quién cerró.
  - Corregirlo NO es una acción nueva: `proceso_control` (Conteo Físico) y `proceso_ajuste` (Ajuste) ya lo resuelven. Verificado
    con tests reales (`test/pos/cerrar-cuenta-action.test.ts`): el insumo en negativo aparece como CRÍTICO en
    `calcularAlertasStock`/`obtenerResumenAlertasStock` y como NEGATIVO en el consolidado, y un Conteo Físico o un Ajuste normales
    lo corrigen sin ningún caso especial. `src/core/stock/alertas.ts` ya manejaba saldos negativos: no hubo bug que arreglar.

## C. Pasos (un commit por paso)

0. Línea de base: `tsc` limpio, `lint` limpio, `npm test` 162 archivos / 1800 tests, `npm run build` limpio, E2E 279 tests en 50
   archivos (`playwright test --list`).
1. **Esquema** (migración `20260925152432_pos_tomar_pedido`, aditiva y nullable): `CuentaItem.creadoPorId`, `anulaAItemId`
   (self, RESTRICT), `motivoAnulacion`, `operacionId` (→ `Operacion`, RESTRICT); `Cuenta.cerradaPorId`. `limpiarBaseDeTest` borra
   primero los espejos. Test `test/pos/cuenta-item-esquema.test.ts`.
2. **Núcleo** `src/core/pos/cuenta.ts`: `restanteDe`, `lineasDeVenta`, `agruparPorEnvio`, `validarCantidadPedido`,
   `validarMotivoAnulacion` (`LARGO_MAXIMO_MOTIVO_ANULACION = 200`), `obtenerDetalleDeMesa`. Tests `test/pos/cuenta.test.ts` y
   regresión del mapa con espejos en `test/pos/mesas.test.ts`.
3. **Refactor** `registrarVentaEnTx` (B6/B6bis). Test `test/movimientos/venta-en-tx.test.ts`.
4. **`pos_tomar_pedido`** + `abrirCuenta`, `agregarItems`, `quitarItemSinEnviar`, `enviarACocina`, `liberarMesa`
   (`src/server/actions/pos/cuenta.ts`). Test `test/pos/cuenta-action.test.ts`.
5. **`pos_anular_item`** + `anularItemEnviado`; `"CuentaItem"` entra en las entidades auditables y en el filtro de
   `/administracion/auditoria`. Test `test/pos/anular-item-action.test.ts`.
6. **`pos_cerrar_cuenta`** + `cerrarCuenta` (B5/B6bis). Tests `test/pos/cerrar-cuenta-action.test.ts` y
   `test/pos/cuenta-concurrencia.test.ts`.
7. **Mapa**: las acciones de `MesaCard` pasan a enlaces (`hrefPedido`, `hrefVerPedidos`, `hrefFacturar`) a `/mesas/<id>`;
   «Opciones de mesa» sigue deshabilitado; sin la nota de corte de alcance. La etiqueta «Facturar» no cambia.
8. **Pantalla** `src/app/(pos)/mesas/[mesaId]/page.tsx` y sus componentes de cliente.
9. **E2E y accesibilidad**: `test/e2e/pos-tomar-pedido.spec.ts`, `test/e2e/fixtures/rol-pos.ts`, axe de la pantalla de la mesa.
10. Esta documentación.

## D. Decisiones tomadas al implementar (lo que el plan no fijaba exactamente)

- **Migración de esquema**: `prisma migrate dev --create-only` agregó dos sentencias ajenas (drop/add de
  `Operacion_motivoId_fkey`/`Operacion_destinoId_fkey`, por una deriva previa: RESTRICT en la base, SET NULL implícito en el
  esquema). Se sacaron a mano y quedó documentado en la migración; la deriva sigue ahí, para otro pendiente.
- **Idempotencia de `registrarVenta`**: la clave/hash de la primera Operacion y su `resultadoMensaje` se siguen escribiendo en el
  mismo orden que antes, a través de `opciones.idempotencia` del núcleo (el chequeo previo sigue en la Server Action).
- **Auditoría del stock negativo con entidad `Operacion`** (no `CuentaItem`): el criterio de B2 es auditar sobre la fila que el
  evento afecta; la anulación afecta a un ítem de la cuenta, el stock negativo al Kardex, cuyo documento es la Operacion VENTA
  que consumió el insumo (es además la entidad que ya usa `anularVenta`).
- **`quitarItemSinEnviar`** pone la condición `numeroEnvio: null` dentro del mismo DELETE (y no en una lectura previa): si otro
  mozo lo envió un instante antes, no se borra nada.
- **Aviso de la pantalla** en un provider arriba de todo: después de `router.refresh()` el botón que disparó la acción puede
  desaparecer (cerrar la cuenta), y el mensaje —incluido el aviso de stock negativo— tiene que seguir visible.
- **`SelectorProducto` con `siempreClaro`**: la lista desplegable tenía variantes `dark:` que en el salón (siempre claro) pintaban
  fondo oscuro con la tinta oscura encima.
- **E2E del mapa**: el caso «corte de alcance» se actualizó en el paso 7 (no en el 9) para no dejar la suite E2E rota entre commits.
- **Números de migración de datos**: `20260925160000_permiso_pos_tomar_pedido`, `…160100_permiso_pos_anular_item`,
  `…160200_permiso_pos_cerrar_cuenta`.

## E. Fuera de alcance (explícito)

Combos/promos, notas/modificadores de ítem, impresión y agente local, pantalla de cocina, dividir/unir cuentas, mover mesas
(«Opciones de mesa»), offline/PWA.

> **Actualización 2026-09-25 — impresión:** la impresión dejó de estar fuera de alcance: la comanda de cocina (al enviar, al
> reimprimir y al anular) y la boleta de cierre (al cerrar y desde «Cuentas cerradas») se imprimen con el diálogo nativo del
> navegador, ver `docs/plan-imprimir-comanda-y-boleta-2026-09-25.md`. El agente local sigue sin hacer falta (una sola PC que ve las
> dos impresoras). `enviarACocina` devuelve además `numeroEnvio`/`envioNuevo` (`ResultadoEnvioACocina`) para imprimir solo el
> envío que creó cada llamada.

> **Actualización 2026-09-25 — selector por sección de carta:** «Agregar al pedido» ya no es solo el buscador por texto: si la
> sucursal tiene carta, se navega por sus secciones (más «Fuera de carta» para lo que la carta no muestra) y un ítem agrupado se
> despliega para elegir la opción concreta. El buscador sigue igual, al lado, y sin ninguna sección de carta la pantalla queda como
> antes. `agregarItems` no cambió. Ver `docs/plan-selector-carta-pos-2026-09-25.md`.
