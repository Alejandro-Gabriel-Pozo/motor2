# PENDIENTE PARA LA UNIÓN (PR #97 → rama del #96)

De lo general a lo específico. Este archivo es el contexto para quien audita y une el #97 al #96: **qué se tocó y por qué**, **qué debería tocarse y no se tocó (y por qué no)**, **qué archivos congelados o prohibidos quedaron intactos**, y **qué no se midió**. Sin secretos.

## 1. En una línea

El #97 trae dos cosas separadas: (a) los **controles de seguridad del pipeline** (workflows, pruebas de SQL injection/XSS, documentación) y (b) una **primera capa `src/ui/` aditiva** (botón, campo, diálogo, tabla adaptable y selectores de fecha) con `Modal` reapuntado al diálogo. **Fusión: no es tarea de esta rama.** Quien trabaja el #96 es quien fusiona el #96 y el #97. **Aviso de proceso:** por error, esta rama trae un merge del #96 hasta `846fb4e` (M.2-A4), el commit `2f40b68`, hecho para comprobar que no hay conflictos (no los hubo). No hace falta para unir; si molesta al auditar, se puede descartar ese commit y quedan solo los commits propios del #97 sobre la base original. **Referencias** (repo privado `motor2-docs`, rama `ccr-30379a24-ebge91`, carpeta `_planes/`): `informe-de-la-tanda-2026-10-10.md` (empezar acá), `auditoria-de-abstracciones-motor2-2026-10-10.md`, `informe-ux-ui-abstraccion-motor2-2026-10-10.md`, `contraste-con-el-pdf-estructura-capas-responsive-2026-10-10.md`. Todo lo demás que las auditorías recomiendan queda **escrito acá, no hecho**, para que quien une vea el panorama completo y no choque con la Fase 6 ni con las pantallas de producto en revisión.

## 2. Qué se tocó y por qué

| Cambio | Archivos | Por qué (hallazgo de las auditorías) |
|---|---|---|
| **Capa nueva `src/ui/`** (solo archivos nuevos) | `src/ui/primitivas/boton.tsx`, `src/ui/primitivas/campo.tsx`, `src/ui/componentes/superposiciones/dialogo.tsx` | No había primitivas: el estilo de botón primario se copia 74 veces en 59 archivos y no existía un diálogo accesible (marco del PDF, §8 pasos 2 y 3). Son aditivos: nadie los importa salvo `Modal` y los tests, así que no pueden chocar con el #96. |
| **`Modal` reapuntado al `Dialogo`** | `src/components/modal.tsx` (misma API: `triggerLabel`, `title`, `deshabilitado`, `children(cerrar)`) | El `Modal` no tenía rol de diálogo, Escape, foco atrapado ni versión de celular. 5 pantallas lo usan, así que mejoran de una vez sin tocarlas. |
| **Contraste de un texto** | `src/app/(app)/catalogo/recetas/nueva-receta.tsx` (`text-neutral-500` → `text-neutral-600 dark:text-neutral-400`) | Axe en modo oscuro lo marcó (3,78:1, pide 4,5:1). El defecto ya existía con el modal viejo; apareció al auditar el diálogo abierto. |
| **Tabla adaptable y selectores de fecha** (solo archivos nuevos, nadie los usa todavía salvo las pruebas) | `src/ui/componentes/datos/tabla-de-datos.tsx` (`TablaDeDatos`), `src/ui/componentes/selectores/campo-fecha.tsx` (`CampoFecha`, `RangoDeFechas`), `scripts/renderizar-ui-para-e2e.ts` (solo lo usa el spec de Playwright) | Pasos 4 y 5 del orden del PDF (§8): ~10 `<input type="date">` sueltos y tablas que solo scrollean en celular. `TablaDeDatos` es **un** componente con dos presentaciones desde las mismas columnas (tabla desde `sm:`, tarjetas en celular, estado vacío obligatorio). Las fechas son el `<input type="date">` nativo, **sin JavaScript** (respeta la restricción de `selector-rango.tsx`), con texto `AAAA-MM-DD` y sin `Date`. Ninguno reemplaza todavía a `TablaReporte` ni a `SelectorRango` (ver §3.6). |
| **Dos specs: selector del modal** | `test/e2e/catalogo-alta-producto.spec.ts`, `test/e2e/movimientos-compra-wizard.spec.ts` | Buscaban el modal por sus clases CSS (`.fixed.inset-0`), un detalle de implementación. Ahora usan `getByRole("dialog")`. Misma intención, mismo resultado. |
| **Pruebas nuevas** | `test/ui/primitivas-y-dialogo.test.tsx`, `test/ui/tabla-y-fechas.test.tsx`, `test/arquitectura/ui-sin-negocio.test.ts`, `test/e2e/ui-dialogo.spec.ts`, `test/e2e/ui-datos-y-fechas.spec.ts` | Contrato de las piezas, frontera «ui/ no conoce el negocio» (sobre el AST) y comportamiento real en navegador con axe (claro y oscuro), teclado, celular (375 px) y PC (1024 px). Mutaciones hechas, con rojo y vuelta a verde: sacar la guarda `cargando` del botón; agregar un import de `@/core/moneda` en `src/ui`; quitar `sm:hidden` de las tarjetas (lo detectan Vitest y el navegador). |
| **Seguridad del pipeline** | `.github/workflows/{seguridad,codeql,gitleaks}.yml`, `.gitleaks.toml`, `.zap/*.tsv`, `scripts/seguridad-sembrar-para-zap.ts`, `test/seguridad/inyeccion-sql-y-xss.test.ts`, `test/e2e/seguridad-xss-y-sqli.spec.ts`, `docs/seguridad-pipeline.md`, `README.md` (4 líneas) | Pedido expreso de la tarea de seguridad. Ver `docs/seguridad-pipeline.md`. |

**Qué ve el usuario con el diálogo nuevo (cambios visibles de `Modal`):** en celular es una hoja pegada abajo (en PC sigue centrado); Escape y clic en el fondo lo cierran; al cerrar, el foco vuelve al botón que lo abrió; el botón ✕ tiene nombre accesible («Cerrar») y 44 px en celular; el título pasa de `h3` a `h2`.

**Riesgos de ese cambio, dichos de frente:**
1. El título cambia de nivel de encabezado (`h3` → `h2`). Si una pantalla dependía del nivel, axe lo habría marcado; no lo marcó en las pantallas probadas.
2. `<dialog>` nativo exige navegadores de 2022 en adelante (Safari 15.4+). Probado solo en **Chromium**; Firefox y Safari reales **no medidos**.
3. El foco no queda «encerrado» en un ciclo: el fondo queda inerte y, con Tab, el foco puede salir a la barra del navegador (comportamiento nativo del diálogo). Se probó que **nunca llega a un elemento del fondo**.
4. Los hijos del diálogo se montan solo mientras está abierto (igual que antes): al cerrar se pierde su estado.

## 3. Qué debería tocarse y NO se toca (y por qué)

Cada punto: **qué**, **dónde**, **por qué no se hizo acá** y **propuesta**.

### 3.1 Reglas de arquitectura para `src/ui` en dependency-cruiser
- **Dónde:** `.dependency-cruiser.cjs` (límite: no se toca sin orden).
- **Hoy:** lo cubre `test/arquitectura/ui-sin-negocio.test.ts` (mismo contenido, sobre el AST).
- **Propuesta:** tres reglas, `ui-no-importa-negocio` (de `^src/ui/` a `^src/(core|server|lib|components|app)/`), `primitivas-no-importan-componentes` y, si no existe, `sin-ciclos`. Cuando entren, el test puede quedar como segundo cinturón o borrarse.

### 3.2 Los 7 diálogos del POS
- **Dónde:** `src/app/(pos)/mesas/nueva-mesa.tsx` y `src/app/(pos)/mesas/[mesaId]/{anular-item,anular-promo,abrir-cuenta,cerrar-cuenta,emitir-ticket-corregido,armar-promo}.tsx`.
- **Qué:** son copias casi idénticas del mismo patrón (`fixed inset-0 z-50 … role="dialog"`), sin foco atrapado ni retorno de foco; solo `armar-promo` tiene tope de alto.
- **Por qué no:** son 7 archivos del salón con su suite E2E (`pos-*`), y el cambio de `armar-promo` toca justo la pieza que el diseño del café (GO-0) va a reemplazar o extender. Conviene una tanda aparte, auditada, **después** de GO-0, no en medio.
- **Propuesta:** migrarlos a `Dialogo` de a uno, con su prueba de axe y de 390 px (hoy no hay axe sobre «Armar promo»).

### 3.3 Migrar los botones y campos copiados a `Boton` y `Campo`
- **Dónde:** ~59 archivos (`rounded bg-neutral-900 …` 74 veces; `rounded border px-…` 167 veces; constantes locales `CLASE_INPUT` en 6 archivos de carta y `BOTON`/`CAMPO` en `invitacion/*`).
- **Por qué no:** es un cambio masivo de archivos e importaciones, justo lo que choca con la Fase 6 y con las pantallas en revisión.
- **Propuesta:** por tandas chicas y mecánicas, empezando por las constantes locales de carta e invitación; con un guardián que impida **nuevas** copias del patrón.

### 3.4 Pantallas de producto en revisión
- **Dónde:** `producto-form.tsx`, `gestion-presentaciones.tsx`, `opciones-formulario.ts`, `campos-sensibles-solo-lectura.tsx`.
- **Qué:** usan botones, campos y `<select>` con las clases copiadas; son los primeros candidatos a `Boton`/`Campo` y a una zona táctil de 44 px.
- **Por qué no:** límite expreso (siguen en revisión). **No se tocaron.**

### 3.5 Navegación responsive (menú lateral → compacta o inferior)
- **Dónde:** `src/components/app-shell.tsx`, `sidebar-colapsable.tsx`, `sidebar-nav.tsx`.
- **Qué:** el menú lateral es fijo de `w-56` (224 px), arranca expandido, sin drawer ni barra inferior; header y main con `px-6`/`p-6` fijos. `AppShell` además es un Server Component que importa `@/server/...` (mezcla layout con negocio).
- **Por qué no:** cambia el layout de **todas** las pantallas de gestión y rompe los E2E de maquetación (`maquetacion-general`, `menu-*`); y mover el shell a `layouts/` es mover archivos.
- **Propuesta:** primero medir a 360/390 px (hoy solo hay evidencia a 1024/1280 en gestión), después un `ShellDeAplicacion` adaptable: menú como drawer en celular, el contenido entra por props, sin importar `server/`.

### 3.6 Tabla con modo tarjetas en celular
- **Dónde:** `src/components/tabla-reporte.tsx` (25 consumidores) y 40 archivos con `<table>` crudo.
- **Hecho en este PR:** el componente nuevo `TablaDeDatos` (ver §2), **sin migrar ningún consumidor**.
- **Por qué no se migra:** reemplazar `TablaReporte` cambia el render de todos los reportes (25 pantallas) y puede tocar los archivos de comparación (ver §4); además `TablaReporte` trae orden y exportación a Excel que `TablaDeDatos` no tiene a propósito (es de servidor, sin JavaScript).
- **Propuesta:** migrar de a un reporte, empezando por 2; agregar a `TablaDeDatos` el orden y la exportación como capa opcional de cliente solo si hace falta; criterio de hecho: sin scroll horizontal a 375 px. Lo mismo para `selector-rango.tsx` → `RangoDeFechas` (mantiene el envío sin JavaScript).

### 3.7 Tokens y modo oscuro
- **Dónde:** `src/app/globals.css` (solo `--background`/`--foreground`) y `.pos-shell` (tokens `--paper`/`--ink` propios, sin modo oscuro).
- **Por qué no:** hay una **decisión previa del dueño**: unificar el modo oscuro del salón o excluirlo explícitamente (riesgo n.º 3 del marco del PDF). Sin esa decisión, definir tokens fija una u otra cosa.

### 3.8 Moneda y zona horaria fijas
- **Dónde:** `"ARS"` / `es-AR` en `src/core/pos/formato.ts:6`, `src/server/actions/pos/cuenta-comun.ts:26` y `src/components/mesas/mesa-card.tsx:49`; `Empresa.moneda` existe y no se lee. `ZONA_ARGENTINA` por defecto en `src/core/datos/fecha-operacion.ts`.
- **Por qué no:** `src/core` y `src/server` (límite: dinero y reglas).
- **Propuesta:** leer la moneda del contexto de la empresa en un solo formateador; hace falta antes del primer rubro fuera de Argentina.

### 3.9 Hallazgos de seguridad que requieren `src/core`, `src/server` o `src/proxy.ts`
- **NUL (`\u0000`) o sustituto UTF-16 suelto en una búsqueda → 500.** Parche propuesto: que `texto()` (`src/core/texto.ts`) los quite y que `src/server/consultas/reportes/historial-producto.ts:19` use `texto()` en vez de `.trim()`.
- **`/carta-publica/<empresa>/%25` → 500** («failed to decode param», Next en ruta ISR). Parche propuesto: en `src/proxy.ts`, 404 si el segmento tiene un `%` que no es un escape válido.
- **Cómo se enteran:** los dos tienen un test que hoy pasa como **brecha conocida** (`it.fails` en `test/seguridad/inyeccion-sql-y-xss.test.ts`, `test.fail()` en `test/e2e/seguridad-xss-y-sqli.spec.ts`) y se pone **rojo** cuando alguien los arregla; ahí se quita la anotación.

### 3.10 El «elemento configurable» (café) — GO-0, GO-1, GO-2
- **No se hace ni se diseña acá.** Necesita `prisma/` y migraciones (GO-1), probablemente permisos nuevos (`acciones.ts`) y casos de uso en `src/server`.
- **Lo que este PR deja listo, sin acoplarlo:** `Dialogo` (con hoja inferior), `Boton` y `Campo` como piezas para el diálogo de opciones del operador. No se creó ningún componente de «opciones» a propósito: no hay modelo ni decisiones del dueño cerradas (modo de precio por tamaño, importes, sentido del prefijo «Z9 -»).
- **Antes de GO-0:** `CuentaItem` sin línea padre (M2) y el tipo de ítem vendible (ADR-011 §8).

### 3.11 Documentación de seguimiento
- **Dónde:** `docs/pureza-integracion.md` (límite: no se toca).
- **Propuesta de filas para quien la mantenga:** «UI-1: capa `src/ui/` (botón, campo, diálogo) — #97 — evidencia: `test/ui/`, `test/e2e/ui-dialogo.spec.ts`»; «UI-2: reglas de dependency-cruiser para `src/ui` — pendiente §3.1»; «SEG-1: pipeline de seguridad — #97»; «SEG-2/3: brechas NUL y `%25` — pendientes §3.9».

## 4. Archivos prohibidos o congelados: estado

| Límite | Estado en este PR |
|---|---|
| `prisma/` y migraciones | **No tocado** |
| Permisos y `acciones.ts` | **No tocado** (las piezas de `src/ui` no necesitan ninguna acción nueva) |
| `src/server/**` y `src/core/**` | **No tocado** (los hallazgos van en §3.8 y §3.9) |
| `producto-form.tsx`, `gestion-presentaciones.tsx`, `opciones-formulario.ts`, `campos-sensibles-solo-lectura.tsx` | **No tocados** |
| Mover archivos o cambiar importaciones masivamente | **No se movió nada.** Cambios de import: solo `modal.tsx` (+1 línea hacia `@/ui/…`) |
| `docs/pureza-integracion.md`, `vercel.json`, Neon, Vercel | **No tocados** |
| `package.json` y `package-lock.json` | **No tocados.** (Mi commit del lock quedó vacío al rehacer la rama sobre el #96, que ya traía el parche de `sharp` y `source-map-js`.) |
| `.github/` | **Tocado, por la tarea de seguridad** (tres workflows nuevos; ver §5). Esto choca con la lista de límites: **decidís vos** al unir. |
| Archivos congelados (matriz de acceso, huella de gobierno, caracterizaciones) | **No regenerados y no cambiaron.** Este PR **no agrega ninguna ruta ni pantalla**. Verificado: los 141 archivos de `test/arquitectura` y `test/ui` (1.461 pruebas) pasan sin tocar ningún golden. |

## 5. Sobre el pipeline de seguridad dentro de este PR (qué revisar al unir)

1. `.github/dependabot.yml`: en la rehecha de la rama hubo un conflicto con el #96 (que ya agregaba `github-actions`); **se tomó la versión del #96**. Este PR ya no lo modifica.
2. `.github/workflows/*.yml`: `checkout`, `setup-node` y `upload-artifact` fijados por **SHA** (los mismos de `ci.yml`). **RESUELTO al unir (2026-10-10, commit `3eddc4a` del #96):** `actions/setup-go` (v5.6.0) y `github/codeql-action` (v4.38.3) quedaron fijados por SHA, leídos de los repositorios oficiales con `git ls-remote`. **Unión hecha:** el #97 se mezcló en la rama del #96 (`ec3d31f`, con autorización del dueño para los 3 workflows de `.github/`) y sus últimos commits en `642bf10`; comprobado después con instalación limpia y bases propias: Vitest de seguridad, interfaz, capas y cadena de suministro (12 archivos, 176 pruebas y 5 fallos esperados de las brechas conocidas), lint de `src/ui`, `test/ui` y `test/seguridad` limpio y 37 E2E de interfaz, seguridad y pantallas que usan `Modal` en verde. El gate de 8 comandos se corre una sola vez, al final del major update.
3. **No marcar como obligatorios `OWASP ZAP` ni CodeQL** hasta ver una corrida verde: ZAP no se pudo correr (sin Docker) y CodeQL corre en GitHub.
4. El workflow de ZAP usa `scripts/seguridad-sembrar-para-zap.ts`, que reutiliza las guardas de los E2E (solo base local cuyo nombre termina en `_e2e`).
5. Detalle completo, comandos locales, falsos positivos revisados y hallazgos: `docs/seguridad-pipeline.md`.

## 6. Qué no se midió

- **ZAP** (no hay Docker en la sesión) y **CodeQL** (corre en GitHub).
- **Firefox y Safari reales** para el diálogo nativo; solo Chromium.
- **`npm test` completo, `build`, `plataforma:build` y `test:e2e` completo** sobre esta base: el gate de 8 comandos lo corre quien une. Lo corrido sobre esta base: `tsc`, `lint`, `arquitectura`, `knip`, `auditar:dependencias`, los 141 archivos de `test/arquitectura` + `test/ui`, y los E2E de los diálogos y de las 5 pantallas que usan `Modal` (axe, catálogo, compra, ficha de producto y de proveedor, permisos de producto: 82 pasan, y los 2 que fallaban eran solo selectores, ya corregidos y vueltos a pasar).
- **Responsive real** de las pantallas existentes a 360/390 px: sin medir (hipótesis).

## 7. Cómo probarlo sin leer código

1. Abrí `/catalogo/recetas` y tocá «+ Nueva receta» (o «Crear la primera →» si no hay recetas): **en el celular** (o con la ventana angosta) debe salir como una hoja pegada abajo; **en PC**, centrado.
2. Con el diálogo abierto apretá **Escape**: se cierra y el cursor vuelve al botón que lo abrió.
3. Abrilo de nuevo y hacé **clic fuera**: se cierra. Un clic adentro, no.
4. Con el teclado, apretá **Tab** varias veces: no debe aparecer el foco sobre nada de la página de atrás.
