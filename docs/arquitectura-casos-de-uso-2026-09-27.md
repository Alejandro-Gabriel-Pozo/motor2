# Casos de uso para mutaciones (Task #41, Fase M) — 2026-09-27

Capa nueva para las **mutaciones relevantes**, incorporada por decisión del
dueño del proyecto después de revisar dos documentos externos sobre
convenciones de flujo de datos. Este documento fija cómo se traducen las
ideas de esos documentos a las convenciones que motor2 YA tiene, para no
duplicar nombres ni capas.

Piloto: `anularCompra` (M1-M4) y `corregirCompra` (M6), en
`src/server/actions/movimientos/compras.ts`. Las dos Server Actions tenían
toda la cadena (permiso, idempotencia I3, transacción, guardas de negocio,
auditoría, reversión) escrita en línea; se extrajo a capas separadas SIN
cambiar el comportamiento observable (mismos mensajes, mismo hash I3, mismo
orden de escrituras, mismos tests de Vitest y de Playwright sin tocar).

## Documento 1: equivalencias con motor2

Rutas verificadas contra el repo el 2026-09-27 (base `91f37d3`).

| Documento 1 (propuesta externa) | Convención real en motor2 |
|---|---|
| `public.ts` | El de la Fase C: `public.ts` + `public-servidor.ts` por dominio de `core/` (la regla `sin-internals-de-otro-dominio` de `.dependency-cruiser.cjs`; desde la Fase 2 de la pureza, 2026-10-06, TODO dominio de negocio tiene su fachada y la lista se invirtió a `DOMINIOS_SIN_PUBLIC_TODAVIA`, hoy vacía) |
| `contratos.ts`, `proyecciones/` | Tipos en `core/features/<f>/<f>.schema.ts` (hoy: `compras/compra.schema.ts`, `traspasos/traspaso.schema.ts`) |
| `comandos/`, `guards/` | `<f>.schema.ts` + `<f>.guard.ts` (convención ya usada desde el 2026-09-25) más los módulos de reglas puras de `core/<dominio>/` (ej. `core/compras/anulacion.ts`, `core/compras/correccion.ts`) |
| `consultas/` | `server/consultas/` (Fase D, piloto `server/consultas/catalogo/productos.ts`) para lecturas de UI; para cargas DENTRO de una mutación, `server/persistencia/<dominio>/cargar-*.ts` |
| `casos-de-uso/` | `server/actions/<dominio>/casos-de-uso/<verbo>.ts` |
| `persistencia/` | `server/persistencia/` — NUNCA en `core/` |
| Evento/outbox | No se adopta ningún bus. `Operacion`, `anuladaEn`, la auditoría (`RegistroAuditoria`) y la clave I3 (`claveIdempotencia`/`payloadHash`/`resultadoMensaje`) cumplen ese papel |

## Documento 2: ideas que NO se adoptan ahora

| Idea | Decisión |
|---|---|
| Fábrica de conexión Prisma con nombres explícitos tipo `tenantDb` | No aplicaba al escribirse (una base, varias sucursales con `sucursalId`) y "tenant" ya significa otra cosa en este repo — el registro del portal de la carta (`docs/plan-registro-tenants-2026-09-24.md`, `SucursalPublica`). Desde ADR-007 (A5/A6) el equivalente es `dbDeEmpresa`/`transaccionDeEmpresa` (`src/core/auth/base.ts`), con RLS por empresa; el singleton de `src/lib/db.ts` solo lo importan `core/auth`, `lib/auth.ts`, la carta pública y los crons; la persistencia de escritura recibe el `tx` de quien la llama. |
| `puertos.ts` separado de `public-servidor.ts` | Redundante: `public-servidor.ts` (Fase C) ya es la fachada de lo que un dominio expone solo del lado del servidor. No se crea. |
| `Prisma TypedSQL` para reportes | No prioritario. Hoy el único candidato real es `core/reportes/costo-historico.ts` (el único `$queryRaw` de `src/`). Se reevalúa si aparecen más de 3 consultas crudas. |

## Qué es una "mutación relevante" (alcance de esta fase)

Operaciones que **mueven stock o dinero**, o **cierran un ciclo**
(anular/revertir), más los **campos auditados de precio**. El CRUD simple de
catálogo/carta/permisos NO entra en esta fase: sigue como Server Action
directa con `conPermiso`.

## Las capas del piloto

```
Pantalla ─► Server Action ("use server", adaptador fino)
              conPermiso(clave) → guard del comando → caso de uso → aResultadoAccion
                                     │                    │
                     core/features/compras/          server/actions/movimientos/casos-de-uso/
                     compra.guard.ts / .schema.ts    anular-compra.ts, corregir-compra.ts
                                                       ("server-only", sin "use server")
                                                         │ conTransaccionSerializable(tx => …)
                                                         ├─ idempotencia I3 (core/movimientos/idempotencia.ts)
                                                         ├─ cargar-*   (server/persistencia/compras/, tx obligatorio)
                                                         ├─ reglas puras (core/compras/anulacion.ts, correccion.ts)
                                                         ├─ escribir-* (server/persistencia/compras/, tx obligatorio)
                                                         ├─ auditoría (core/permisos/auditoria.ts)
                                                         └─ ResultadoCaso (core/resultado-caso.ts)
```

- **`core/resultado-caso.ts`**: `ResultadoCaso<T, C>` = `{ ok: true, mensaje, datos }`
  o `{ ok: false, codigo, mensaje, erroresPorCampo? }`, con `exito()`,
  `fracaso()` y `aResultadoAccion()`. La traducción a `ResultadoAccion`
  (`src/server/actions/tipos.ts`, que NO se reemplaza) descarta a propósito
  `datos`, `codigo` y `erroresPorCampo`: la pantalla sigue recibiendo
  exactamente `{ ok, mensaje }`.
- **Comando + guard** (`core/features/compras/`): `ComandoAnularCompra`,
  `ComandoCorregirCompra`, sus `Resultado*` y `guardComando*` (forma
  `ResultadoDato` de `core/datos/resultado.ts`). Un `operacionId` que no es
  string da el mismo mensaje que «no encontrada» (antes: error crudo de
  Prisma). `esClaveIdempotenciaValida` se movió a
  `core/datos/clave-idempotencia.ts` (puro, sin `node:crypto`);
  `core/movimientos/idempotencia.ts` la reexporta.
- **Persistencia de escritura** (`server/persistencia/<dominio>/`): `tx:
  Prisma.TransactionClient` obligatorio como primer parámetro (nunca `db =
  prisma`: a diferencia de `server/consultas/`, siempre corre dentro de la
  transacción del caso de uso), devuelve tipos de dominio (los `Decimal` se
  convierten a `number` en el borde), sin reglas de negocio.
- **Caso de uso** (`server/actions/<dominio>/casos-de-uso/<verbo>.ts`):
  `import "server-only"` y sin `"use server"` (no es un endpoint), sin
  chequeo de permiso (lo hizo `conPermiso`), recibe `actor` (`usuarioId` +
  `sucursalId` del `ContextoUsuario`) y el comando ya validado. Orquesta
  dentro de UNA transacción serializable en el orden de siempre.

## Reglas de dependency-cruiser que lo sostienen

- **`persistencia-solo-desde-casos-de-uso`** (M5): solo un archivo bajo
  `server/actions/**/casos-de-uso/` (o la propia persistencia) importa
  `server/persistencia/`. Complemento en Vitest
  (`test/arquitectura/dependencias.test.ts`): ningún caso de uso lleva
  `"use server"` y todos abren con `import "server-only"`.
- **`accion-migrada-sin-orquestacion`** (M7): las Server Actions de
  `ACCIONES_CON_CASO_DE_USO` (`.dependency-cruiser-excepciones.cjs`) no
  importan `@/lib/db` ni `@prisma/client` en runtime (`import type` sí), ni
  reintento/idempotencia/auditoría, ni `server/persistencia/`: todo eso pasa
  por su caso de uso. Complemento en Vitest: cada archivo de la lista existe
  y lleva `"use server"`.

## Acciones migradas después del piloto

- **M8 — `anularVenta`** (`src/server/actions/movimientos/venta.ts`): comando + guard en `core/features/ventas/` (`venta.schema.ts`,
  `venta.guard.ts`: un `operacionId` que no es string da «no encontrada»; antes, con `undefined`, Prisma ignoraba el filtro y cargaba la
  primera operación de la sucursal); reglas puras (`evaluarAnulacionDeVenta`, `construirReversionDeVenta`, textos de mensaje y de
  auditoría) en `core/movimientos/anulaciones.ts` — es la guarda "F3" de ventas de `plan-mutaciones-controladas-2026-09-25.md`, antes en
  línea; persistencia en `server/persistencia/movimientos/` (`cargar-venta-para-anular.ts`, con `cargarVentaParaAnular` y
  `cargarHermanasDePromo`, y `escribir-anulacion-de-venta.ts`, una llamada por Operación anulada); caso de uso
  `casos-de-uso/anular-venta.ts`. Sin I3: `anularVenta` nunca la tuvo y no se agregó. Las hermanas de promo (Task #16, D4) se cargan
  recién después de las guardas, igual que antes, y cada Operación escribe su contra-asiento y su fila de auditoría en el mismo orden.
- **Efecto colateral en `registrarVenta`** (mismo archivo): la regla `accion-migrada-sin-orquestacion` se aplica al archivo entero, así que
  su bloque transaccional (I3 + `registrarVentaEnTx`) pasó TAL CUAL a `casos-de-uso/registrar-venta.ts`. Sus validaciones de entrada
  siguen en la Server Action; pasarlas a un guard de comando queda para la migración propia de `registrarVenta`.
- **M11a — `aprobarYEnviarTransferencia`, `cancelarSolicitudTransferencia`, `rechazarSolicitudTransferencia`**
  (`src/server/actions/traspasos/traspasos.ts`): guards de comando en `core/features/traspasos/traspaso-comandos.guard.ts` (el guard de
  TRANSICIÓN, `traspaso.guard.ts`, no se tocó: lo llama el caso de uso dentro de la transacción), comandos y resultados en
  `traspaso.schema.ts`; persistencia en `server/persistencia/traspasos/` (`cargar-traspaso.ts`, `escribir-aprobacion-de-traspaso.ts`,
  `escribir-cierre-de-solicitud.ts`); casos de uso en `server/actions/traspasos/casos-de-uso/` (`aprobar-y-enviar-traspaso.ts`,
  `cancelar-solicitud-de-traspaso.ts`, `rechazar-solicitud-de-traspaso.ts`, más el paso compartido `producto-transferible.ts`). Sin I3
  (ninguna de las tres la tenía). Un `seccionOrigenId` que no es string da «Elegí de qué sección propia sale.» (antes: error crudo de
  Prisma). **Migración PARCIAL a propósito:** `traspasos.ts` NO entra todavía en `ACCIONES_CON_CASO_DE_USO` — sigue teniendo
  mutaciones sin migrar (M11b: aceptar/rechazar envío/reingreso; M11c: crear solicitud/envío directo) que tocan Prisma directo, y la
  regla vale para el archivo entero. Se suma cuando termine M11c; hasta entonces, `obtenerProductoTransferible`, `buscarTraspaso` y
  `escribirMovimientoTraspaso` siguen en el archivo para esas acciones.
- **M12a — `cerrarCuenta`** (`src/server/actions/pos/cuenta-cierre.ts`): comando + guard en `core/features/cuentas/` (`cuenta.schema.ts`,
  `cuenta.guard.ts`: un `cuentaId` que no es string da «No se encontró esa cuenta en esta sucursal.», igual que antes); persistencia en
  `server/persistencia/pos/` (`cargar-cuenta-para-cerrar.ts`: la cuenta, el último número de boleta de la sucursal y la Operacion del
  consumo para la auditoría de stock negativo; `cerrar-cuenta.ts`: ejemplar A de la boleta, enlace ítem → Operacion, cierre de la cuenta);
  caso de uso `pos/casos-de-uso/cerrar-cuenta.ts`, que llama a `registrarVentaEnTx` sin tocar ese núcleo y numera DESPUÉS de que la venta
  salió bien (un `fracaso` devuelto adentro confirma la transacción). Sin I3: sigue idempotente por estado (`YA_CERRADA`). El archivo NO
  entra todavía en `ACCIONES_CON_CASO_DE_USO`: `emitirBoletaCorregida` (mismo archivo) se migra en M12b.
- **M11b — `aceptarTransferencia`, `rechazarTransferencia`, `confirmarReingresoTransferencia`**
  (`src/server/actions/traspasos/traspasos.ts`, continuación de M11a): guards de comando sumados a
  `core/features/traspasos/traspaso-comandos.guard.ts` (`guardComandoAceptarTraspaso`, `guardComandoRechazarEnvioTraspaso`,
  `guardComandoConfirmarReingresoTraspaso`; mismo orden de chequeos que antes: id → clave I3 → sección), comandos y resultados sumados a
  `traspaso.schema.ts`; persistencia en `server/persistencia/traspasos/` (`cargar-traspaso.ts` suma `cargarSeccionDelTraspaso`; nuevos
  `escribir-entrada-de-traspaso.ts`, con `escribirAceptacionDeTraspaso` y `escribirReingresoDeTraspaso`, y `escribir-rechazo-de-envio.ts`);
  casos de uso `aceptar-traspaso.ts` (reusa el paso compartido `producto-transferible.ts` para re-chequear la disponibilidad en destino),
  `rechazar-envio-de-traspaso.ts` y `confirmar-reingreso-de-traspaso.ts`. **I3 conservada** en aceptar y reingreso: mismos tags
  (`ACEPTAR_TRASPASO`, `REINGRESO_TRASPASO`) y mismo payload del hash (la sección de destino TAL CUAL llegó), `resultadoMensaje` vía
  `registrarResultadoIdempotente`; un reenvío exacto devuelve `datos.repetida: true`. `rechazarTransferencia` sigue sin I3 (no escribe
  Operación). Una `seccionDestinoId` que no es string da «Elegí a qué sección propia entra.» (antes: error crudo de Prisma). Se borró
  `buscarTraspaso` (ya no lo usa nadie); `obtenerProductoTransferible` y `escribirMovimientoTraspaso` (este último ya sin el parámetro de
  I3) QUEDAN en el archivo porque los usan `crearSolicitudTransferencia`/`crearEnvioDirectoTransferencia` (M11c). El test de arquitectura
  `test/arquitectura/confirmacion-en-un-solo-lugar.test.ts` ahora revisa `traspasos.ts` Y sus `casos-de-uso/` (las transiciones se
  mudaron ahí). `traspasos.ts` sigue FUERA de `ACCIONES_CON_CASO_DE_USO` hasta M11c.
- **M12b — `emitirBoletaCorregida`** (`src/server/actions/pos/cuenta-cierre.ts`): comando + guard sumados a los de M12a en
  `core/features/cuentas/` (`ComandoEmitirBoletaCorregida`, `CodigoEmitirBoletaCorregida`, `DatosEmitirBoletaCorregida` en
  `cuenta.schema.ts`; `guardComandoEmitirBoletaCorregida` en `cuenta.guard.ts`: un `cuentaId` que no es string da «No se encontró esa
  cuenta en esta sucursal.», igual que antes). El guard NO valida el motivo: `validarMotivoAnulacion` sigue corriendo en el caso de uso
  DESPUÉS de las guardas de estado, así que un motivo vacío sobre una boleta vigente sigue respondiendo «ya refleja las anulaciones».
  Persistencia en `server/persistencia/pos/` (`cargar-cuenta-para-corregir-boleta.ts`: la cuenta con sus ítems + `anuladaEn` de su
  Operacion y los ejemplares del último al primero; `escribir-ejemplar-corregido.ts`: el ejemplar B/C…, archivos nuevos porque la carga
  y la escritura no se parecen a las del cierre); caso de uso `pos/casos-de-uso/emitir-boleta-corregida.ts` (transacción serializable,
  mismo número, `corrigeAId` SIEMPRE al A, auditoría `Cuenta`/`ejemplarBoleta`). Sin I3 (nunca la tuvo). La Server Action no usa
  `aResultadoAccion`: su contrato (`ResultadoBoletaCorregida`) le devuelve a la pantalla además `numero` y `ejemplar` (para imprimir el
  ejemplar confirmado), así que los copia de `datos` — los ids (`ejemplarId`, `corrigeAId`) NO se serializan. Con `cerrarCuenta` (M12a) y
  `emitirBoletaCorregida` migradas, `cuenta-cierre.ts` no tiene ninguna otra función y **entra en `ACCIONES_CON_CASO_DE_USO`**.
- **M12c — `anularItemEnviado`** (`src/server/actions/pos/cuenta-anulacion.ts`, primera de dos sub-tareas sobre ese archivo): comando +
  guard en `core/features/cuentas/`, pero en archivos APARTE de los de M12a/M12b (`cuenta-anulacion.schema.ts` con
  `ComandoAnularItemEnviado`, `CodigoAnularItemEnviado`, `DatosAnularItemEnviado`; `cuenta-anulacion.guard.ts` con
  `guardComandoAnularItemEnviado`): mismo corte que ya tienen las Server Actions (`cuenta-cierre.ts` vs `cuenta-anulacion.ts`) — acá el
  sujeto es un ítem o una promo de la cuenta, no la cuenta —, y ahí se suma `anularPromoEnviada` en M12d. El guard solo valida el
  `cuentaItemId` (no-string → «No se encontró ese ítem en esta sucursal.», igual que antes); `cantidad`, `motivo` y `restanteVisto` viajan
  crudos y el caso de uso los valida en el MISMO orden de siempre: guardas de estado (ya es anulación → cuenta cerrada → sin enviar →
  componente de promo) → motivo → guarda optimista (`restanteVisto` contra `restanteDe`) → cantidad (`validarCantidadPedido`, con la
  unidad y el paso de venta del producto) → no más de lo que queda. Persistencia en `server/persistencia/pos/`
  (`cargar-item-para-anular.ts`: el ítem con su producto, la mesa, el estado de la cuenta, sus anulaciones y su promo;
  `escribir-espejo-de-item.ts`: la fila ESPEJO con la cantidad en negativo, mismo producto/precio/envío, `anulaAItemId` al original —
  el original nunca se edita ni se borra); caso de uso `pos/casos-de-uso/anular-item-enviado.ts` (transacción serializable, auditoría
  `CuentaItem`/`cantidadVigente`, `datos` con el id del espejo y el restante antes/después, que la Server Action no serializa). Sin I3
  (nunca la tuvo: el doble clic lo frena la guarda optimista). Permiso `pos_anular_item` sin cambios. **Migración PARCIAL a propósito:**
  `cuenta-anulacion.ts` NO entra todavía en `ACCIONES_CON_CASO_DE_USO` — `anularPromoEnviada` (M12d) sigue con Prisma, reintento y
  auditoría en línea, y la regla vale para el archivo entero. Se suma cuando termine M12d.
- **M11c — `crearSolicitudTransferencia`, `crearEnvioDirectoTransferencia`** (`src/server/actions/traspasos/traspasos.ts`, cierre de
  M11a/M11b): guards de comando sumados a `core/features/traspasos/traspaso-comandos.guard.ts` (`guardComandoCrearSolicitudTraspaso`,
  `guardComandoCrearEnvioDirectoTraspaso`: la sucursal de la otra punta con `texto()` —vacía da el texto de antes—, y una sección o un
  producto que no son string dan «Elegí a qué sección propia…»/«El producto no existe.», antes un error crudo de Prisma; único cambio de
  orden, solo con entradas malformadas que la pantalla nunca manda: esos chequeos de formato corren antes que «a vos mismo»), comandos y
  resultados sumados a `traspaso.schema.ts` (`CodigoCrearTraspaso`, `DatosCreacionDeTraspaso`, `DatosEnvioDirectoDeTraspaso`). La
  cantidad viaja TAL CUAL en el comando y se valida en el caso de uso contra los decimales de la unidad del producto, igual que antes.
  Persistencia: `cargar-traspaso.ts` suma `cargarSucursalParaTraspaso` y `ProductoParaTraspaso` suma `unidadStock`; nuevo
  `escribir-creacion-de-traspaso.ts` (`escribirSolicitudDeTraspaso`, `escribirEnvioDirectoDeTraspaso`); la SALIDA (Operación + línea de
  Kardex) se extrajo a `escribirSalidaDeTraspaso` en `escribir-aprobacion-de-traspaso.ts`, compartida por la aprobación y el envío
  directo. Casos de uso `crear-solicitud-de-traspaso.ts` y `crear-envio-directo-de-traspaso.ts`, los dos sobre el paso compartido
  `producto-transferible.ts` y dentro de UNA transacción serializable: la solicitud antes no tenía transacción (lecturas sueltas + un
  `create`), y el envío directo validaba (y chequeaba el stock una primera vez) FUERA de la transacción para volver a leer el stock
  adentro — ahora todo se lee adentro una sola vez, mismos textos. La Server Action no usa `aResultadoAccion`: su contrato
  (`ResultadoConId`) devuelve además `id`/`nombre`, que copia de `datos` (`okConId`). Se borraron de `traspasos.ts` los dos helpers que
  quedaban (`obtenerProductoTransferible`, ya duplicado por `producto-transferible.ts`, y `escribirMovimientoTraspaso`, ahora
  `escribirSalidaDeTraspaso`). **Sin I3, a propósito:** la solicitud no toca stock (un duplicado se cancela desde la Bandeja sin efecto
  en el Kardex); el envío directo sí descuenta stock, pero (1) quedó fuera del alcance de la política I3
  (`auditoria-motor2-plan-i3-idempotencia-2026-09-17.md`), (2) su contrato devuelve `id`/`nombre` y `resultadoMensaje` no alcanza para
  reconstruirlos en un reenvío, (3) el formulario deshabilita el botón mientras la acción corre, y (4) un duplicado nunca deja el stock
  inconsistente (la SALIDA y el traspaso ENVIADO se escriben juntos; se deshace con rechazo + reingreso). **Pendiente** (fuera de esta
  fase, porque cambia el contrato y la pantalla): I3 para el envío directo ante un reintento de red, con un tag propio y el `id` del
  traspaso recuperable desde la Operación. **Las lecturas** (`obtenerBandejaTransferencias`, `listarSucursalesDisponibles`) se mudaron
  TAL CUAL a `src/server/actions/traspasos/lecturas.ts` (siguen siendo Server Actions con `requerirVerEnSucursal`): la regla
  `accion-migrada-sin-orquestacion` vale para el archivo ENTERO y no admite `@/lib/db`, y una Server Action no puede importar
  `server/consultas/` (`acciones-sin-ui`); se actualizaron solo las rutas de import de sus tres páginas y de tres tests
  (`test/permisos/lecturas-con-permiso-de-ver.test.ts`, `lecturas-con-sesion.test.ts`, `test/traspasos/traspasos.test.ts`), sin tocar
  lo que verifican. Con las ocho escrituras migradas, **`traspasos.ts` entra en `ACCIONES_CON_CASO_DE_USO`**.
- **M12d — `anularPromoEnviada`** (`src/server/actions/pos/cuenta-anulacion.ts`, cierre de M12c): comando + guard sumados a los de M12c
  en `cuenta-anulacion.schema.ts` (`ComandoAnularPromoEnviada`, `CodigoAnularPromoEnviada`, `DatosAnularPromoEnviada`) y
  `cuenta-anulacion.guard.ts` (`guardComandoAnularPromoEnviada`): el guard solo valida el `promoCuentaId` (no-string → «No se encontró
  esa promo en esta sucursal.», igual que antes); el `motivo` viaja crudo y el caso de uso lo valida en el MISMO orden de siempre:
  guardas de estado (cuenta cerrada → sin componentes → algún componente sin enviar) → motivo → «ya está anulada entera» (a ningún
  componente le queda resto). Persistencia en `server/persistencia/pos/`: `cargar-promo-para-anular.ts` es NUEVO (el sujeto es la promo
  con TODOS sus ítems —originales y espejos, con sus anulaciones y el precio de carta—, no un ítem: no se parece a
  `cargar-item-para-anular.ts`); la escritura REUTILIZA `escribirEspejoDeItem` de M12c, que suma un argumento opcional `promo`
  (`promoCuentaId` + `precioCartaUnitario` del componente, lo único que el `create` en línea de `anularPromoEnviada` escribía de más; sin
  `promo`, esos campos no se escriben, igual que antes para un ítem suelto). Caso de uso `pos/casos-de-uso/anular-promo-enviada.ts`: UNA
  transacción serializable, todo o nada (Task #16, D4: la promo se anula ENTERA), una fila espejo por el resto íntegro de cada componente
  con el MISMO `promoCuentaId` y una fila de auditoría por componente (`CuentaItem`/`cantidadVigente`, resto → 0); `datos` con el
  componente, su espejo y la cantidad anulada, que la Server Action no serializa. Sin I3 (nunca la tuvo: el doble clic lo frena «ya está
  anulada entera»). Permiso `pos_anular_item` sin cambios. Con `anularItemEnviado` (M12c) y `anularPromoEnviada` migradas,
  `cuenta-anulacion.ts` no tiene ninguna otra función y **entra en `ACCIONES_CON_CASO_DE_USO`**. `abrirCuenta` (mencionada como
  opcional) quedó FUERA a propósito: vive en otro archivo (`pos/cuenta-apertura.ts`, junto con comensales, cliente y liberar mesa) y no
  mueve stock ni dinero ni cierra un ciclo, así que no es una "mutación relevante" de esta fase.
- **P1 — `guardarReceta`** (`src/server/actions/catalogo/recetas.ts`, primera aplicación del patrón fuera de movimientos/POS): comando
  + guard en `core/features/catalogo/` (`receta-version.schema.ts` con `ComandoGuardarVersionDeReceta`, `CodigoGuardarVersionDeReceta`,
  `DatosGuardarVersionDeReceta`; `receta-version.guard.ts` con `guardComandoGuardarVersionDeReceta`: un `productoId` que no es string da
  «No se encontró el producto.», antes un error crudo de Prisma). `items`/`pasos`/`cabecera` viajan crudos y el caso de uso los valida
  con `validarIngredientes` → `validarPasos` → `validarCabecera` (core/catalogo), en el MISMO orden de siempre, después de cargar el
  producto y chequear que sea elegible. Persistencia en `server/persistencia/catalogo/guardar-version-de-receta.ts`
  (`cargarProductoParaReceta`, `cargarUltimaVersionDeReceta`, `escribirVersionDeReceta` —versión + tabla puente paso↔ingrediente—,
  `cargarNombresDeSucursales`, `copiarCalibracionesLocales`). **Excepción al contrato de la persistencia:** las dos cargas corrían FUERA
  de la transacción (la versión se calcula de forma optimista, MAX+1, antes de abrir la SERIALIZABLE; el `@@unique([productoId,
  version])` es el árbitro y `conReintento` relee ante un choque) y así siguen: el caso de uso les pasa el cliente global (primer
  parámetro igual de obligatorio). `test/catalogo/recetas-concurrencia.test.ts` cuenta esas lecturas sobre `prisma.recetaVersion`. Los
  `Decimal` de las calibraciones locales no se convierten a `number` (se copian tal cual a la versión nueva). Caso de uso
  `catalogo/casos-de-uso/guardar-version-de-receta.ts`: el arrastre D3 (copiar si sigue con la misma unidad; si no, descartar y auditar
  cantidad y merma) y la auditoría `RecetaVersion`/`version` quedaron idénticos. Sin I3 (nunca la tuvo: cada guardado es una versión
  nueva a propósito). `refrescarVistaSiHaceFalta` sigue en la Server Action, solo ante un éxito (igual que antes). **Migración PARCIAL a
  propósito:** `recetas.ts` NO entra en `ACCIONES_CON_CASO_DE_USO` — las lecturas (`obtenerRecetaVigente`, `listarVersionesDeReceta`)
  siguen con `prisma`, y las ediciones puntuales (agregar/editar/quitar ingrediente o paso, cabecera) siguen delegando en `guardarReceta`.
- **M13a-c — `registrarMovimiento`** (`src/server/actions/movimientos/movimientos.ts`): el motor genérico de los 9 procesos que no
  tienen su propia acción (Compra, Producción, Consumo, Ajuste, Transferencia, Merma, Devolución×3 — `ProcesoGenerico`,
  `core/features/movimientos/movimiento.schema.ts`; Venta y Control/Conteo Físico quedan fuera, tienen la suya). Cierra la migración de
  `movimientos.ts` (`reclasificarStock` y `registrarConteoFisico` son archivos propios, fuera de esta fase — M13d/M13e).
  - **M13a** (comando + tipos): `DatosMovimientoInput`/`ItemMovimientoInput`/`ResultadoRegistrarMovimiento`/`CodigoRegistrarMovimiento`
    mudados TAL CUAL a `core/features/movimientos/movimiento.schema.ts` (la Server Action los reexporta con el mismo nombre, para no
    romper a nadie que ya los importaba de ahí). Persistencia de las tres lecturas que corren FUERA de la transacción en
    `server/persistencia/movimientos/cargar-validaciones-de-movimiento.ts` (`cargarMotivoMerma`, `cargarDestinoConsumo`,
    `existeCompraVigenteConFactura` — mismo criterio "cliente global a propósito" que `guardar-version-de-receta.ts` de P1: el árbitro
    real de la factura duplicada es el índice único parcial, no esta lectura). El caso de uso `casos-de-uso/registrar-movimiento.ts`
    nace con TODA la orquestación (sección propia, motivo/destino, `guardNroFacturaCompra`, factura duplicada, la transacción entera y
    el hookup de proveedor), en el MISMO orden que antes; `movimientos.ts` todavía NO entra en `ACCIONES_CON_CASO_DE_USO` (le faltaban
    el guard de comando y M13b).
  - **M13b** (persistencia de las escrituras): los dos `tx.operacion.create`/`tx.movimientoStock.createMany` de dentro de la transacción
    → `server/persistencia/movimientos/escribir-movimiento-de-stock.ts` (`escribirOperacionDeStock`, `escribirLineasDeMovimientoStock`
    — DOS funciones separadas a propósito: el caso de uso necesita el `id` de la Operacion antes de armar las filas de Producción, que
    leen `obtenerProducto` de cada insumo consumido DESPUÉS del INSERT). El armado de las filas (SÍ es lógica de negocio: signo por
    proceso, redondeo por unidad, la fila LIQUIDACION_CONSIGNACION) se queda en el caso de uso.
  - **M13c** (guard + hookup nombrado + cierre): comando + guard en `core/features/movimientos/` (`movimiento.guard.ts`,
    `guardComandoRegistrarMovimiento`), con las MISMAS 4 validaciones que antes corrían en línea dentro de `conPermiso` (items vacío,
    sección en blanco, formato de la clave I3, Transferencia con destino vacío/igual al origen) MÁS una 5ª, primera en el orden:
    `proceso` tiene que ser uno de los 9 `ProcesoGenerico` (`Record<ProcesoGenerico, true>`, para que `tsc` fuerce actualizarlo si el
    enum de Prisma cambia). Es un endurecimiento de un hueco real: `ACCION_POR_PROCESO[datos.proceso]` (que sigue, SIN CAMBIOS, ANTES de
    `conPermiso`, eligiendo qué permiso pedir) también tiene entradas para procesos que NO pasan por este motor (VENTA → `proceso_venta`,
    CONTROL → `proceso_control`); antes de este guard, un payload armado a mano con `proceso: "VENTA"` de alguien que YA tenía
    `proceso_venta` pasaba `conPermiso` sin que nada, DENTRO de la acción, lo frenara después. El guard es la segunda barrera, mismo
    texto (`Proceso "${proceso}" no se registra con esta acción.`) que ya usa `movimientos.ts` para el proceso sin acción asociada.
    `guardNroFacturaCompra` se queda en el caso de uso a propósito (corre DESPUÉS de sección/motivo/destino: moverlo cambiaría qué
    mensaje sale primero). El guard devuelve `aceptar(entrada)` sin transformar nada (el hash I3 depende del payload tal cual llegó).
    El hookup de proveedor (Compra, fuera de la transacción, best-effort) se extrajo a una función nombrada,
    `registrarProveedoresDeLaCompra` (interna, no exportada, en `casos-de-uso/registrar-movimiento.ts`), con el MISMO try/catch por
    línea y el MISMO `console.error` — el docstring del caso de uso ya numeraba este paso como "6."; ahora ese paso tiene nombre.
    `movimientos.ts` queda como adaptador fino (`ACCION_POR_PROCESO` para elegir el permiso → `conPermiso` → `guardComandoRegistrarMovimiento`
    → caso de uso → `aResultadoAccion`) y, sin ninguna otra función en el archivo, **entra en `ACCIONES_CON_CASO_DE_USO`**.
    Test nuevo (`test/movimientos/registrar-movimiento.test.ts`): un payload con `proceso: "VENTA"` (y otro con `"CONTROL"`) da el
    mensaje de rechazo y no escribe ninguna Operacion.
- **M13d — `reclasificarStock`** (`src/server/actions/stock/reclasificacion.ts`): comando + guard en `core/features/movimientos/`
  (mismo dominio que M13a-c: RECLASIFICACION es un proceso más del enum `Proceso`), pero en archivos APARTE
  (`reclasificacion.schema.ts`, `reclasificacion.guard.ts`) y **caso de uso PROPIO, no el motor genérico de M13a-c**: entrada (un
  producto, un origen, N destinos, no una lista de ítems), permiso (`proceso_control`, mismo que Conteo Físico — no pasa por
  `ACCION_POR_PROCESO` ni tiene su propia `Accion`), validación (la regla "la suma de destinos es exactamente el saldo disponible en
  origen", sin equivalente en `registrarMovimiento`) y escritura (un origen negativo + N destinos positivos en una sola Operación) son
  todos distintos; RECLASIFICACION está excluida de `ProcesoGenerico` a propósito (`movimiento.schema.ts`, ya desde M13a). El guard
  (`guardComandoReclasificarStock`) tiene las MISMAS 5 validaciones que antes corrían en línea (producto, sección de origen, destinos
  vacío, clave I3, sección de cada destino en blanco), en el MISMO orden y con los MISMOS textos; el chequeo "único destino idéntico al
  origen" (misma sección + mismo lote que el origen, con un solo destino) NO va en el guard —necesita comparar contra la sección de
  origen ya confirmada como propia de la sucursal (dato de base)— y se queda en el caso de uso, DESPUÉS de resolver las secciones
  propias, mismo criterio que M13c con `guardNroFacturaCompra` (por el orden de mensajes). Persistencia NUEVA y compartida:
  `server/persistencia/movimientos/cargar-producto-con-unidad-de-stock.ts` (`cargarProductoConUnidadDeStock`, el mismo
  `findUnique`/`unidadStock` de siempre, tipado para que también lo reuse M13e — Conteo Físico, sin migrar todavía). Caso de uso
  `stock/casos-de-uso/reclasificar-stock.ts`, en el MISMO orden que antes (secciones propias → "único destino idéntico al origen" →
  transacción serializable: I3, carga del producto, disponibilidad en la sucursal, `validarCantidad` de cada destino —hallazgo del
  pendiente #32, se sigue rechazando el exceso de decimales—, saldo y diferencia contra la suma de destinos, escritura y mensaje). SÍ
  REUTILIZA de M13b `escribirOperacionDeStock`/`escribirLineasDeMovimientoStock` (server/persistencia/movimientos/) y
  `registrarResultadoIdempotente` para el `resultadoMensaje` de I3 — nada de Prisma a mano para esas dos escrituras. **La lectura**
  (`obtenerSaldoDisponibleParaReclasificar`) se mudó TAL CUAL a `src/server/actions/stock/lecturas-reclasificacion.ts` (mismo criterio
  que M11c: sigue siendo una Server Action con `requerirSesion()` + `obtenerSeccionPropia`, fuera de `ACCIONES_CON_CASO_DE_USO` porque
  la regla `accion-migrada-sin-orquestacion` vale para el archivo entero); se actualizaron las rutas de import de su formulario
  (`stock/reclasificar/reclasificar-form.tsx`) y de dos tests (`test/stock/reclasificacion.test.ts`,
  `test/permisos/lecturas-con-sesion.test.ts`), sin tocar lo que verifican. Con `reclasificarStock` migrado y la lectura mudada,
  `reclasificacion.ts` no tiene ninguna otra función y **entra en `ACCIONES_CON_CASO_DE_USO`**.
- **M13e1 — `registrarConteoFisico`/`registrarConteosFisicos`** (`src/server/actions/movimientos/conteo-fisico.ts`): comando + guard en
  `core/features/movimientos/conteo-fisico.schema.ts`/`conteo-fisico.guard.ts` (mismo dominio que M13a-d). El guard
  (`guardComandoConteoFisico`) tiene UNA sola validación, la única que antes corría en línea, en formato puro, antes de la transacción
  (sección en blanco) — todo lo demás que validaba `registrarConteoConContexto` (sección propia de la sucursal, producto,
  disponibilidad, "tiene stock real", formato/decimales del conteo) depende de datos de base y se queda en el caso de uso, mismo
  criterio que el chequeo "único destino idéntico al origen" de M13d. Persistencia NUEVA:
  `server/persistencia/movimientos/escribir-conteo-fisico.ts` (`escribirConteoFisico`, el mismo `tx.conteoFisico.create` de siempre, los
  11 campos de antes). REUTILIZA de M13d `cargarProductoConUnidadDeStock` (ya pensada para esta migración) y de M13b
  `escribirOperacionDeStock`/`escribirLineasDeMovimientoStock` para el ajuste de Kardex (un array de una sola fila, funcionalmente
  idéntico al `tx.movimientoStock.create` de una fila que hacía antes en línea). Caso de uso
  `movimientos/casos-de-uso/registrar-conteo-fisico.ts` (`registrarConteoFisicoCasoDeUso`), en el MISMO orden que antes: sección propia
  (fuera de la transacción) → dentro de la transacción, producto, disponibilidad, `tieneStockReal`, `validarCantidad` del conteo, saldo
  (por lote o total), diferencia, `ACCIONES_CONTEO` (mudada tal cual al caso de uso, sin exportar), escritura del `ConteoFisico` y, si
  corresponde, el ajuste de Kardex, mensaje final. `registrarConteosFisicos` (toda la grilla, un solo `conPermiso` para la tanda) llama
  al guard y al caso de uso UNA VEZ POR FILA dentro del bucle — la sesión y el permiso se comprueban una sola vez, pero cada fila sigue
  validando su propia sección, igual que antes cuando cada una pasaba por `registrarConteoConContexto`.
  **Migración PARCIAL a propósito, como P1:** `conteo-fisico.ts` NO entra en `ACCIONES_CON_CASO_DE_USO` — `resolverConteoPendiente`,
  `cancelarConteoFisico` y `obtenerHistorialConteosFisicos` (mismo archivo) siguen con su código de hoy (Prisma/`core/movimientos/
  public-servidor` directos), pendientes para M13e2.
- **M13e2 — `resolverConteoPendiente`/`cancelarConteoFisico`, y mueve `obtenerHistorialConteosFisicos`** (mismo archivo,
  `src/server/actions/movimientos/conteo-fisico.ts`): último sub-paso de la cadena M13a→e — **con este sub-paso cierra TODA la Fase M
  de esta ronda**. Sin `.guard.ts` propio para ninguna de las dos mutaciones (`core/features/movimientos/resolver-conteo.schema.ts` /
  `cancelar-conteo.schema.ts`, solo tipos): a diferencia de `ComandoConteoFisico` (M13e1), ninguna de las dos recibe un campo de
  formato libre que validar antes de la transacción — `conteoId` es un id opaco y `comoResolver` ya viene acotado por su tipo en
  tiempo de compilación; todo lo que antes se validaba (el conteo existe, es de esta sucursal, el estado correcto para la transición,
  el producto sigue en el catálogo) depende de datos de base y se queda en el caso de uso, mismo criterio que M13d/M13e1. Persistencia
  NUEVA y compartida por las dos: `server/persistencia/movimientos/cargar-conteo-fisico.ts` (`cargarConteoFisico`, el mismo
  `tx.conteoFisico.findUnique` de siempre, solo los campos que ambas leen: `id`/`sucursalId`/`estado`/`productoId`/`seccionId`/
  `loteVencimiento`/`conteoReal`/`diferencia`/`detalle`) y una función nueva en `server/persistencia/movimientos/escribir-conteo-fisico.ts`
  (`actualizarEstadoDeConteo`, el mismo `tx.conteoFisico.update({ estado, detalle })` que antes se repetía, en variantes, en las 4
  llamadas `.update` de las dos funciones). REUTILIZA de M13d `cargarProductoConUnidadDeStock` (la rama "ajustar" de
  `resolverConteoPendiente`, que antes hacía su propio `tx.producto.findUnique`) y de M13b `escribirOperacionDeStock`/
  `escribirLineasDeMovimientoStock` para el ajuste/reversión de Kardex de ambas funciones. Casos de uso
  `movimientos/casos-de-uso/resolver-conteo-pendiente.ts` (`resolverConteoPendienteCasoDeUso`) y
  `movimientos/casos-de-uso/cancelar-conteo-fisico.ts` (`cancelarConteoFisicoCasoDeUso`), en el MISMO orden que antes: cargar el conteo
  (`cargarConteoFisico`) → verificar sucursal + estado → la rama correspondiente (resolver: "resuelto"/cierre directo vs. "ajustar"/
  cargar producto, recalcular saldo de HOY, diferencia, cerrar sin ajuste si es 0 o escribir el ajuste de Kardex con
  `conteoFisicoId` antes de cerrar; cancelar: si `diferenciaOriginal !== 0` escribir la reversión con `conteoFisicoId` antes de marcar
  CANCELADO), MISMOS textos. Los dos adaptadores de `conteo-fisico.ts` quedan finos: permiso (`conPermiso("proceso_control")` /
  `conPermiso("cancelar_conteo")`) → caso de uso → `aResultadoAccion`. `obtenerHistorialConteosFisicos` (solo lectura) se mudó TAL CUAL
  a `src/server/actions/movimientos/lecturas-conteo-fisico.ts` (mismo criterio que M13d/M11c: sigue siendo una Server Action con
  `requerirVerEnSucursal`, fuera de `ACCIONES_CON_CASO_DE_USO` porque esa regla vale para el archivo entero); se actualizaron las rutas
  de import de las dos páginas que la usan (`app/(app)/reportes/conteos/page.tsx`, `app/(app)/movimientos/conteo-fisico/page.tsx`) y de
  tres tests (`test/movimientos/conteo-fisico.test.ts`, `test/permisos/lecturas-con-permiso-de-ver.test.ts` —también su columna
  `archivo`, que apunta al archivo fuente para verificar el gate en el cuerpo de la función—, `test/permisos/lecturas-con-sesion.test.ts`),
  sin tocar lo que verifican. Con las cuatro mutaciones de `conteo-fisico.ts` migradas a caso de uso (M13e1 + M13e2) y la lectura
  mudada, el archivo no tiene ninguna otra función y **entra en `ACCIONES_CON_CASO_DE_USO`**. **Con M13e2 cierra la cadena completa
  M13a→b→c→d→e1→e2 del Task #41, Fase M.**
- **M14 — `registrarPagoConsignante`** (`src/server/actions/reportes/consignacion.ts`): antes sin transacción, sin idempotencia I3 y
  sin auditoría — un doble clic real registraba el pago dos veces (hallazgo del backlog). Comando + guard en
  `core/features/reportes/pago-consignante.{schema,guard}.ts` (proveedor en blanco, `importe` con `validarImporte` — normalizado
  DESDE el guard, a diferencia de otros guards de esta fase, porque el hash I3 se calcula sobre el comando ya validado —, formato de
  la clave I3). Persistencia en `server/persistencia/reportes/pago-consignante.ts` (`cargarProveedorActivo`,
  `cargarPagoConsignantePorClave`, `crearPagoConsignante`). Caso de uso `reportes/casos-de-uso/registrar-pago-consignante.ts`: a
  diferencia de `registrarMovimiento`/`reclasificarStock` (Kardex, con un invariante de agregado real bajo concurrencia), acá NO usa
  `conTransaccionSerializable` — la única carrera es "insert duplicado bajo la misma clave", que el índice único de
  `PagoConsignante.claveIdempotencia` + un `prisma.$transaction` SIMPLE ya resuelven (un P2002 de carrera se atrapa aparte y relee el
  ganador). Opción B con un solo `create`: a diferencia de `Operacion`, el mensaje de éxito (proveedor + importe) se conoce ANTES del
  insert, así que `resultadoMensaje` se escribe en el MISMO `create`, sin un `update` posterior — el reporte de consignación
  (`core/reportes/consignacion.ts`) no necesitó ningún cambio: nunca puede existir una fila con clave pero sin mensaje. Migración de
  schema (autorización expresa del dueño, 2026-09-28): 3 columnas nullable + `@@unique` en `PagoConsignante`, mismo criterio "rollout
  gradual" que `Operacion` (`prisma/migrations/20260928040000_i3_idempotencia_pago_consignante/`). Se agregó `"PagoConsignante"` a
  `CambioAuditable["entidad"]` (`core/permisos/auditoria.ts`) y al array `ENTIDADES` de la página de auditoría. Cableado en la UI
  (`registrar-pago-consignante.tsx`, mismo patrón que `venta-form.tsx`: `crypto.randomUUID()` por intento, renovada tras un éxito) —
  el alcance de M14 incluyó la UI a propósito, para cerrar el bug real del doble clic, no solo dejarlo testeable a nivel Server
  Action. `consignacion.ts` no tiene ninguna otra función y **entra en `ACCIONES_CON_CASO_DE_USO`**.

## Cómo se migra la próxima acción

1. Comando + `Resultado*` en `<f>.schema.ts`, `guardComando*` en `<f>.guard.ts`, armadores puros de mensajes en `core/<dominio>/`.
2. `cargar-*`/`escribir-*` en `server/persistencia/<dominio>/`, copiando las consultas tal cual.
3. El caso de uso, con el mismo orden de pasos que la acción original.
4. La acción queda como adaptador fino y se suma a `ACCIONES_CON_CASO_DE_USO`.
5. Los tests existentes de la acción (Vitest y Playwright) no se tocan: `git diff` vacío sobre ellos es la prueba de que no cambió el comportamiento.

---

## E1 — cierre y verificación total del Task #41 (2026-09-28)

Última tarea de la Task #41. Con M14 mergeada se cerraron todos los sub-pendientes de la Parte 1 de
`docs/pendientes-sesion-2026-09-27.md` que no dependían de una decisión de negocio nueva (P1, P2, la cadena
M13a→b→c→d→e1→e2, M14). Esta sección deja registrado el estado final de la arquitectura que dejaron las fases A-M, para
que no haya que reconstruirlo leyendo commits sueltos.

### Las capas de `server/`, contrato completo

```
server/actions/<dominio>/<verbo>.ts        "use server" — permiso (conPermiso) → guard → [caso de uso] → aResultadoAccion
server/actions/<dominio>/casos-de-uso/     "server-only", SIN "use server" — orquestación de una mutación relevante
server/consultas/<dominio>/<lectura>.ts    lecturas para UI, fuera de una mutación (piloto: server/consultas/catalogo/productos.ts, Fase D)
server/persistencia/<dominio>/             Prisma puro, SIN reglas de negocio — cargar-*.ts / escribir-*.ts
```

Reglas de `dependency-cruiser` (`.dependency-cruiser.cjs`) que arbitran estas fronteras, en el orden en que un archivo
nuevo las cruza:

- **`acciones-sin-ui`**: `server/actions/` no importa de `app/`/`components/` ni de `server/consultas/`.
- **`consultas-capa`**: `server/consultas/` no importa de la UI, de `server/actions/` ni de `server/persistencia/`.
- **`persistencia-capa`**: `server/persistencia/` no importa de la UI, de `server/actions/` ni de `server/consultas/`.
- **`persistencia-solo-desde-casos-de-uso`**: a `server/persistencia/` solo llega un caso de uso (o la propia
  persistencia) — ni una Server Action sin migrar, ni la UI, ni `core/`, ni `server/consultas/`.
- **`accion-migrada-sin-orquestacion`** (dos entradas, misma regla): una Server Action ya en `ACCIONES_CON_CASO_DE_USO`
  (`.dependency-cruiser-excepciones.cjs`) no usa en runtime `src/lib/db.ts`, `@prisma/client`, el reintento/transacción,
  la idempotencia I3 ni la auditoría — ni siquiera vía la fachada `core/movimientos/public-servidor.ts` (si no, la regla
  se esquivaría importando por ahí) — y tampoco importa `server/persistencia/` directo, ni sus tipos. Vale para el
  ARCHIVO entero, no símbolo por símbolo (hallazgo de M11c: obligó a mudar lecturas a un archivo de `lecturas-*.ts`
  aparte cuando convivían con las mutaciones migradas).
- **`sin-internals-de-otro-dominio`** (una regla por dominio de negocio; desde la Fase 2 no hay dominios exceptuados): fuera de `core/<dominio>/`,
  `server/consultas/` y `server/persistencia/` solo se importa la fachada del dominio (`public.ts`/`public-servidor.ts`),
  nunca sus archivos internos.
- **`publico-puro`**: `core/<dominio>/public.ts` no alcanza `src/lib/db.ts`, ni directa ni transitivamente.
- **`core-sin-capas-superiores`** / **`core-sin-react-next`**: `core/` no importa de `server/`/`app/`/`components/` ni de
  React/Next (ni con `import type`, salvo la excepción documentada de `core/movimientos/registrar-venta.ts` ↔
  `core/reportes/` — ver el ciclo legítimo documentado en `.dependency-cruiser-excepciones.cjs`).
- **`ui-sin-prisma`**: `app/`/`components/` no llega a `src/lib/db.ts` ni a `@prisma/client` en runtime.
- **`sin-ciclos`**: cualquier ciclo nuevo entre archivos de `src/` es error, salvo los ya inventariados con motivo en
  `CICLOS_CONOCIDOS`.
- **`no-non-package-json`**: no se importa un paquete que no esté declarado en `package.json`.

Excepciones (`.dependency-cruiser-excepciones.cjs`, cada una con motivo): `PENDIENTES_DE_MIGRAR` (archivos temporalmente
exceptuados de `ui-sin-prisma` mientras se migran — **confirmado vacía**, no queda ningún archivo pendiente de esa
migración), `ACCIONES_CON_CASO_DE_USO` (la lista de Server Actions ya migradas a caso de uso, la que hace cumplir
`accion-migrada-sin-orquestacion`), `CICLOS_CONOCIDOS` (el único ciclo de dominios documentado arriba).

### Convención `public.ts` / `public-servidor.ts`

Por dominio de `core/` (desde la Fase 2 de la pureza, 2026-10-06, la adoptaron todos los dominios de negocio: `catalogo` (C1, piloto), `movimientos` (C2), `reportes` (C3) y, después, `pos`, `stock`, `compras`, `carta` y `fiscal`;
`DOMINIOS_CON_PUBLIC` se invirtió a `DOMINIOS_SIN_PUBLIC_TODAVIA`, hoy vacía):

- **`public.ts`** — fachada PURA: solo lo que puede llegar al bundle del cliente (sin `@/lib/db`, sin Prisma, sin
  `node:crypto` ni otro módulo de Node). La importan módulos de otros dominios y, en algunos casos, componentes.
- **`public-servidor.ts`** — fachada de SERVIDOR: lo que un dominio expone y que sí toca la base (directa o
  transitivamente) o corre sobre una transacción que le pasan (`idempotencia`, `producto-cache`). Sin `import
  "server-only"` a propósito (Vitest/Playwright/scripts `tsx` cargan `core/` fuera de la resolución de módulos de Next,
  donde ese paquete tira al importarse).
- Ambas: solo reexports explícitos (nunca `export *`, nunca lógica nueva), y solo lo que HOY se usa desde afuera del
  dominio — un reexport sin consumidor real lo marca `knip`.
- Fuera de `core/<dominio>/`, `server/consultas/` y `server/persistencia/`, importar un archivo interno del dominio
  (no la fachada) es error de `dependency-cruiser` (`sin-internals-de-otro-dominio`).

### `knip` — código y dependencias sin uso

Desde la Fase K3 (2026-09-27, noche), `npm run analizar:muerto` (`knip`, CON código de salida) es uno de los 7 comandos
obligatorios del gate — 0 hallazgos es la única corrida en verde, ya no es informativo (corrección hecha en esta misma
tarea E1: el comentario de cabecera de `knip.jsonc` seguía diciendo "informativo, no bloquea nada" desde K1, desactualizado
después de K3). Toda exclusión de `knip.jsonc` (`ignore`, `ignoreDependencies`, `ignoreExportsUsedInFile`, una `entry`
agregada a mano) lleva su motivo al lado — nunca se ignora algo que sea "muerto real" solo para que la corrida pase.
Historial de la clasificación (34→50→49→0 hallazgos entre K1 y K2) en `docs/informe-knip-2026-09-27.md`.

### Herramientas descartadas

Tabla completa, con motivo por herramienta (`eslint-plugin-boundaries`, Zod, `next-safe-action`, tRPC, TanStack Query,
Redux/Zustand, otra librería decimal), en
`docs/arquitectura-modularidad-server-actions-2026-09-17.md` ("Herramientas descartadas") — no se duplica acá. Revisada
en esta tarea (E1): sigue vigente, ningún hecho nuevo de esta sesión la contradice.

### `PENDIENTES_DE_MIGRAR` — confirmado vacía

`const PENDIENTES_DE_MIGRAR = [].map(...)` en `.dependency-cruiser-excepciones.cjs` — sin ninguna entrada. Ningún
archivo de `app/`/`components/` está exceptuado de `ui-sin-prisma` hoy.

### Fuera de alcance — pendiente aparte (no bloquea el cierre de la Task #41)

Documentado explícito, no implementado en esta sesión:

- Dividir `core/reportes/rendimiento-recetas.ts` (43,5K) y la página del editor de recetas (35,7K) — archivos grandes,
  sin urgencia funcional.
- Pasar `server/actions`, `app` y `components` a consumir `public*` donde hoy importan un archivo interno de un dominio
  que sí tiene fachada.
- `public.ts`/`public-servidor.ts` de `pos`/`stock` (candidatos C4/C5 — no se hicieron esta ronda).
- Mover el costeo a `core/costos/` para romper el ciclo documentado `movimientos` ↔ `reportes`.
- Mudar `core/auth/{contexto,session,ir-al-login}` a `server/` (hoy en `core/` por herencia histórica, tocan sesión real).
- Resolver el N+1 del editor de recetas.
- DTOs mínimos en las consultas de `server/consultas/`.
- Centralizar las ~20 copias de `type Db = PrismaClient | Prisma.TransactionClient` esparcidas por `core/`.
- Enseñarle al analizador de guardas (`test/arquitectura/acciones-con-guarda.test.ts` y similares) a seguir la
  delegación entre archivos, en vez de exigir que la guarda esté en el mismo archivo que la mutación.
- Mudar `upsertProveedorPorProducto` a `server/persistencia/catalogo/` (usa el cliente global hoy — anotado al cerrar
  M13c, no se hizo por no fijar una segunda excepción al contrato "tx obligatorio" sin necesidad).

### Cierre

Los 7 comandos del gate, en la MISMA corrida, sobre `origin/main` con TODO lo de esta sesión mergeado (`c32adea`):
`npx tsc --noEmit` (limpio), `npm run lint` (0/0), `npm run arquitectura` (508 módulos, 2036 dependencias, sin
violaciones), `npm run analizar:muerto` (0 hallazgos), `npm test` (274/274 archivos, 3289/3289 tests), `npm run build`
(limpio, con la migración de M14 aplicada), `npm run test:e2e` (369/369 specs). **Con esto se cierra la Task #41.**
