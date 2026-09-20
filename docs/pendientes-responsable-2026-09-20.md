# Pendientes de motor2: quién hace qué (2026-09-20)

**Motivo**: tras confirmar que `origin/main` ya tiene todo lo de `docs/grounding-pendientes-2026-09-18.md` (verificado commit por commit, no solo por lo que dicen los documentos — ver §1 de ese archivo para el detalle de qué se chequeó contra el código), esta es la lista de pendientes reales que quedan, separada entre lo que se puede resolver con código directo y lo que necesita una decisión, una cuenta externa o un acceso que hoy no están disponibles desde una sesión de Claude Code.

## 1. Se puede resolver con código, sin depender de nada más

- **5c** Antigüedad máxima explícita del IPC (`stale_days`), en lugar de que el mes en curso caiga en silencio en `ingresoSinIPC`.
- **Flake de reintentos** (`src/core/movimientos/con-reintento.ts`): agregar backoff/jitter en vez de reintentar sin espera.
- **Matriz de permisos**: pasar `guardarPermisos` (`src/server/actions/permisos/permisos.ts`) a `conTransaccionSerializable` + test de concurrencia real (hoy corre en READ COMMITTED).
- **F3 de Productos**: mostrar "Editar" solo con el permiso `editar_producto` (hoy lo ve cualquiera con Ver de `alta_producto`) y agregar "Desactivar".
- **Paso 7**: selector de pivot (dimensión + período) para el contador.
- **E3/E4/E5**: sugerencia de Insumo/Familia al tipear un producto nuevo, memoria por usuario de los últimos valores del alta, búsqueda en Conteo Físico que resuelva la MP a contar vía receta.
- **E2E sin limpieza de datos entre specs** (`test/e2e/`, `playwright.config.ts`): no hay `globalSetup`/`globalTeardown` ni ningún `deleteMany`/reset entre corridas — la única estrategia de aislamiento es que 14 de los 19 specs generan nombres únicos con `Date.now()` (ej. `` `E2E Producto ${Date.now()}` ``). Los datos que cada corrida crea quedan para siempre en la base contra la que corre `next dev`; no es solo teórico, el relevamiento de pantallas de la demo ya encontró 25 conteos de prueba residuales acumulados. Verificado el 2026-09-20 (confirmado también: `webServer.command` es `npm run dev`, no `next build && next start` — sin justificar esa elección específica en el repo más allá de la razón de "navegador real vs. Vitest", que es un argumento distinto).

Una vez resueltas las decisiones de la sección 2, el código de K1b/K1c, 6b, D2, 5b, E1, C1–C4 y G1/G2 también se puede escribir directamente.

## 2. Necesitan una decisión de producto (sin esto, cualquier implementación es una apuesta)

- **K1b/K1c** (Compras: corregir y anular una compra confirmada): elegir entre las opciones del diseño de 4 fases en `grounding-compras-correccion-y-notas-de-credito-2026-09-19.md` (7 decisiones abiertas ahí).
- **6b**: ¿se muestra el food cost por consumo (`costoUnitarioVenta`) junto al ratio de Compras/Ventas, o no?
- **D2 / Método 2 USD** (doble moneda en los registros): ¿lo necesita el negocio o se deja como está?
- **E1** (alertas de stock): ¿mail por ítem o digest diario? ¿a quién le llega — todos con `notificar_alertas`, o solo el responsable de cada sucursal?
- **Comprobantes y Drive** (§9 de `grounding-pendientes-2026-09-18.md`): ¿hay Google Workspace y Unidades compartidas? ¿quién debe poder ver los comprobantes? ¿qué mails mandaría Resend y con qué dominio remitente?
- **G1/G2**: ¿exportar reportes a una carpeta de Drive del negocio, importar catálogo desde una hoja de Google, ambas o ninguna?

## 3. Necesitan autorización expresa (migración de base de datos)

- **5b**: agregar columna de serie a `IndicePrecio` (prerrequisito de la serie IPC "Alimentos y bebidas" y del Método 2 USD).
- **C3**: tabla nueva `Comprobante` (solo la referencia a Drive).

## 4. Necesitan una cuenta o credencial externa que no se puede crear desde acá

- **Resend**: cuenta, dominio verificado, API key.
- **Google**: consentimiento OAuth con scope `drive.file` (lo autoriza cada usuario, no una sesión de Claude Code).
- **Serie de IPC "Alimentos y bebidas"**: conseguir el id real en `apis.datos.gob.ar` (sesiones anteriores no tuvieron salida de red hacia ese sitio).

## 5. Necesitan acceso a infraestructura de producción

- Correr `npm run db:seed` en el ambiente de destino (para que exista `ver_auditoria` y se pueda ver `/administracion/auditoria`).
- Verificar la Prueba 5 de I3 (concurrencia real contra Neon): nunca se corrió.

## 6. Limpieza de git pendiente

- Borrar `origin/fix/csv-export-formulas` y `origin/fix/editar-producto-key`: confirmadas obsoletas (la primera ya está 100% contenida en `main`; la segunda es anterior a casi todo el trabajo actual y su merge haría retroceder `main`). El intento de borrado con `git push origin --delete` fue bloqueado por el clasificador de modo automático de Claude Code (regla "Git Destructive"); hace falta aprobar ese permiso o borrarlas a mano en GitHub.

## 7. Hallazgos nuevos de implementar Plan 3 (reordenar receta + tope de factura), 2026-09-20

- **[IMPORTANTE, probablemente sistémico] Un Server Action que no redirige no refresca la pantalla en un navegador real.** En esta versión de Next, llamar una Server Action ya NO revalida sola la ruta actual — hay que pedirlo explícito con `refresh()`/`revalidatePath()`/`updateTag()` (`node_modules/next/dist/docs/01-app/02-guides/server-actions.md`: *"An action that does none of the above ... the current route is not re-rendered"*). `grep` confirmó **cero usos** de esas tres funciones en todo `src/` antes de este cambio. Se detectó recién ahora porque ningún spec de Playwright anterior clickeaba un botón de `FormConResultado` y verificaba que la lista se actualizara sin recargar — todo lo que sí funcionaba lo hacía porque el propio closure llama `redirect(...)` después (una navegación real sí refresca). **Se corrigió solo para `guardarReceta`** (y por lo tanto para toda mutación de recetas que no redirige: agregar/quitar/editar ingrediente, agregar/editar/quitar/reordenar/insertar paso, cabecera) con un helper nuevo `src/server/actions/refrescar.ts` (`refrescarVistaSiHaceFalta`, traga específicamente el error "E870" que tira `refresh()` fuera de un Server Action real — necesario porque Vitest llama estas funciones directo desde Node, sin el contexto real de Next, y sin ese catch los 790+ tests existentes explotarían). **Falta revisar el resto de la app**: cualquier otro `FormConResultado` que no redirija después de un `ok` (candidatos, sin verificar todavía: activar/desactivar fila, quick-crear, formularios de catálogo con acciones puntuales tipo "Quitar" en otras pantallas) probablemente tiene el mismo problema. Antes de replicar el fix en cada archivo, valdría la pena decidir si el helper va a un lugar más central (¿`con-permiso.ts`?) para no repetirlo veinte veces.
- **Contraste insuficiente de `text-amber-600`** (WCAG AA): axe-core lo marcó en `/reportes/costos` con un producto de costo incompleto — contraste 3.19 contra el mínimo 4.5:1 sobre fondo blanco. `grep` encontró **~20 usos** en `src/app/(app)/reportes/` y `src/components/catalogo/` (marca "incompleto", "sin precio", "sin proveedor", "revisar", etc. en Costos, Compras, Pérdidas, Diferencias, Promociones, Rendimiento de recetas, Insumos sin receta, Categorías). El spec de accesibilidad de `/reportes/costos` tiene la regla `color-contrast` deshabilitada a propósito con un comentario que apunta acá — no está arreglado, solo no bloquea ese chequeo puntual. **`text-amber-700` ya se confirmó con axe (2026-09-20, Plan 1)** que pasa AA en este Tailwind v4/oklch — usado para el "· parcial" nuevo de Promociones (`test/e2e/accesibilidad.spec.ts`, chequeo acotado con `.include(".text-amber-700")`), con `tsc`/`eslint` limpios. Falta el trabajo mecánico de reemplazar los ~20 usos de `amber-600` y confirmar visualmente que se sigue distinguiendo de `text-red-600`.
- **Checkbox sin label** en `src/app/(app)/reportes/promociones/promocion-form.tsx:64` ("marcar como Promoción/Combo"): axe lo marcó como `critical` al auditar `/reportes/promociones` (Plan 1, 2026-09-20) — sin `<label>`, `aria-label` ni `aria-labelledby`. Ajeno a lo que tocó ese plan (columna "Margen Real"); no se arregló para no expandir su alcance.
