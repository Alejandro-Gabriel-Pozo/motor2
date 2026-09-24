# Plan FINAL: pantalla «Mapa de Mesas» (módulo `pos`) con datos reales

Entregado por un agente de planificación (Opus) el 2026-09-24, sobre la
base `9cae4fc` de `claude/merge-menu-inventory-repos-5ot8uc`. Incorpora
dos resoluciones del dueño:
1. Contraste aprobado. Cambian solo los colores de texto; la barra
   lateral y los puntos de color quedan exactamente igual.
2. `Comanda`/`ComandaItem` pasan a llamarse **`Cuenta`/`CuentaItem`**
   (`docs/grounding-pos-mesas-comandas-2026-09-24.md` §6).

Contexto completo: §7 de `docs/grounding-unificacion-carta-stock-2026-09-23.md`,
`docs/arquitectura-modularidad-server-actions-2026-09-17.md`,
`docs/grounding-pos-mesas-comandas-2026-09-24.md`. Insumos de diseño:
`/root/.claude/uploads/a0f4c784-cccb-521a-94cd-9ee7a5b6e4cc/e971ed44-mesa-card.tsx`,
`.../b56e730f-mesas-tokens.css`,
`.../fec914ec-Mapa_de_Mesas___propuesta_motor2.html`.

---

## A. Lo encontrado en el código (condiciona el diseño)

**1. Tailwind y fuentes.** motor2 usa Tailwind v4 con configuración en CSS (`@tailwindcss/postcss`, sin `tailwind.config.*`, `@import "tailwindcss"` + `@theme inline` en `src/app/globals.css`). Geist/Geist Mono ya cargan con `next/font` en `src/app/layout.tsx`. El CDN de Tailwind y las Google Fonts del mockup **no se copian**.

**2. Tokens CSS.** `--border`, `--ink-soft`, `--ink-faint` no existen hoy en `globals.css` (solo `--background`/`--foreground`/`@theme`). El riesgo real: `:root` tiene `color-scheme: light dark` con fondo `#0a0a0a`/texto `#ededed` en modo oscuro; `MesaCard` tiene `bg-white` fijo y el número/total heredarían ese texto casi blanco → falla en modo oscuro y ensucia el namespace de toda la administración. **Resolución:** los tokens van en `.pos-shell { color-scheme: light; background: var(--paper); color: var(--ink); … }`, aplicado por `PosShell`, nunca en `:root`. Se agregan los tokens del mockup que el `.css` no trae: `--paper` #FAFAF8, `--ink` #1C1B19, `--brand` #A8431F, `--brand-hover` #8A3618.

**3. Contraste: ajuste APROBADO por el dueño.**

| Token | Antes | Después | Contraste resultante | Dónde se usa |
|---|---|---|---|---|
| `--ink-faint` | #A8A49C (2,48:1 / 2,38:1) | **#76726A** | 4,79:1 blanco / 4,58:1 papel | «MESA», rótulos de métricas, nota al pie |
| Texto de «Continuar pedido» | blanco sobre `--mesa-draft` (3,25:1) | **`var(--ink)`** sobre el mismo fondo | 5,29:1 | botón de la tarjeta en pedido |
| `--mesa-draft-ink` (nuevo) | — (antes 2,94:1) | **#7A5A07** | 5,76:1 sobre `--mesa-draft-tint` | etiqueta «En pedido» |
| `--mesa-libre-ink` (nuevo) | — (antes 4,48:1) | **#356A4F** | 5,59:1 sobre `--mesa-libre-tint` | etiqueta «Libre» |

- Quedan exactamente igual: `--mesa-libre`/`--mesa-draft`/`--mesa-ocupada` y sus tints (barra lateral, puntos, fondo de etiqueta y del botón «Continuar pedido»), `--border`, `--ink-soft`, y los botones con texto blanco que ya pasan («Tomar pedido» 5,06:1, «Facturar» 6,26:1, «Nueva mesa» 6,02:1).
- Axe ignora botones `disabled` — «Continuar pedido» hoy va deshabilitado y pasaría igual, pero se corrige ahora para que no rompa cuando se habilite.

**4. `mesa-card.tsx` compila tal cual (por lectura, sin `node_modules` para correr `tsc`).** Usa `import type { ReactNode }`, SVG en camelCase, `aria-hidden` booleano, valores arbitrarios válidos en v4. Sin `"use client"` — sirve como Server Component mientras no se le pasen callbacks (acá no se pasan). Tres ajustes necesarios:
- (a) Con `onClick` en `undefined`, `ActionButton` dibuja un botón habilitado que no hace nada → falta `disabled={!onClick}`.
- (b) Los colores de texto del punto 3.
- (c) Muestra `numero` crudo; el mockup muestra «01» → lo resuelve quien lo llama (`String(n).padStart(2,"0")`).
- Diferencia con el mockup: el mockup pinta «Tomar pedido» con `--brand`, `MesaCard` con `--mesa-libre` — se respeta `MesaCard`.
- Ubicación: `src/components/` es plano salvo `catalogo/` — `mesas/` sigue esa misma excepción.

**5. Permisos.** Los roles son datos (`crearRol`, `/administracion/roles`). `rolesEditarSemilla` está tipado solo `"admin" | "operador"` — **no se agrega rol "mozo" en código**, se crea desde la UI. Sí hace falta una `Accion` nueva `pos_mesas` (ninguna existente sirve; reusar `proceso_venta` daría de más). Capacidad sin fila = habilitada (`resolverCapacidad`). Molde: `prisma/migrations/20260921232000_permiso_corregir_compra/migration.sql`.

**6. Guardas estáticas que hoy solo miran `(app)`:** `test/arquitectura/pantalla-de-error.test.ts` (lista fija), `menu-con-permiso.test.ts` (busca `page.tsx` en `(app)`), `enlaces-con-permiso.test.ts`/`test/permisos/lecturas-con-permiso-de-ver.test.ts` (raíz fija en `(app)`, no aplican mientras `(pos)` no tenga enlaces cruzados ni lecturas expuestas). `acciones-con-guarda.test.ts` sí recorre todo `src/server/actions/**`, cubre `pos/` sola.

**7. Alcanzabilidad.** Sin un ítem en `GRUPOS_NAV`, un mozo cae en `/inicio` sin pantallas. `src/proxy.ts` ya cubre `/mesas` en su matcher.

**8. Limpieza de tests.** `limpiarBaseDeTest` borra en orden de FKs — las tablas nuevas van primero. El reset E2E (`TRUNCATE...CASCADE`) no necesita cambios.

**9. Build y E2E.** `npm run build` aplica migraciones sobre `DIRECT_URL`. `build:e2e` NO migra — la base e2e se migra a mano.

---

## B. Decisiones de diseño

- **URL:** `src/app/(pos)/mesas/page.tsx` → `/mesas`.
- **Tres entidades:** `Mesa`, `Cuenta` (la cuenta abierta), `CuentaItem`. La comanda/KOT real (ticket a cocina, con anulación/motivo/permiso elevado) **no se modela ahora** — `CuentaItem.numeroEnvio: Int?` queda como marcador liviano hasta el pendiente "tomar pedido".
- **El estado de la mesa NO se persiste.** `libre`/`en_pedido`/`ocupada` se derivan de la `Cuenta` abierta (mismo criterio de no materializar lo derivable que ya usa el repo). `EstadoMesa` es un tipo TS, no un enum Prisma.
- **Regla de derivación** (aceptada): sin `Cuenta` abierta → `libre`; abierta y (algún ítem sin enviar o ninguno enviado) → `en_pedido`; abierta con ≥1 enviado y 0 sin enviar → `ocupada`. Una segunda ronda en mesa ocupada vuelve a `en_pedido`.
- **Sin vencimiento automático** (grounding, unanimidad 5/5 repos de referencia). "Hace N min" es solo informativo.
- **Sin Server Actions de lectura.** La página (Server Component) llama directo a `src/core/pos/mesas.ts` tras `requierePermisoVer`, mismo patrón que `stock/conteo-frecuencia/page.tsx`.
- **Filtros/búsqueda por URL** (`?estado=…&q=…`). Única pieza de cliente: «Nueva mesa».
- **Botones fuera de alcance: deshabilitados, sin rutas placeholder.**
- **"Facturar" separado del estado de la mesa** (confirmado por grounding: cobrar y liberar mesa son operaciones separadas en los sistemas más maduros).

---

## C. Pasos (un commit por paso, en este orden)

### Paso 0 — Línea de base
Ver sección D. No se commitea nada.

### Paso 1 — Modelo Prisma + migración — **REQUIERE AUTORIZACIÓN EXPRESA (ya autorizada por el dueño el 2026-09-24 tras revisar el diseño completo — aplicar solo contra las bases locales de este worktree, nunca Neon/producción).**

En `prisma/schema.prisma`, sección nueva `// POS`:

```prisma
/// Mesa física del salón. El estado (libre/en_pedido/ocupada) NO se persiste: se deriva de su Cuenta abierta (src/core/pos/mesas.ts).
model Mesa {
  id         String   @id @default(cuid())
  sucursalId String
  sucursal   Sucursal @relation(fields: [sucursalId], references: [id])
  numero     Int
  creadoEn   DateTime @default(now())
  cuentas    Cuenta[]
  @@unique([sucursalId, numero])
}

/// La CUENTA abierta de una mesa (no la comanda/KOT: ver docs/grounding-pos-mesas-comandas-2026-09-24.md §1/§6).
/// cerradaEn null = abierta. A lo sumo UNA abierta por mesa (índice único parcial manual). Sin vencimiento automático (§2).
model Cuenta {
  id           String    @id @default(cuid())
  mesaId       String
  mesa         Mesa      @relation(fields: [mesaId], references: [id])
  abiertaPorId String
  abiertaPor   User      @relation("CuentaAbiertaPor", fields: [abiertaPorId], references: [id])
  abiertaEn    DateTime  @default(now())
  cerradaEn    DateTime?
  items        CuentaItem[]
  @@index([mesaId])
}

model CuentaItem {
  id             String   @id @default(cuid())
  cuentaId       String
  cuenta         Cuenta   @relation(fields: [cuentaId], references: [id])
  productoId     String
  producto       Producto @relation(fields: [productoId], references: [id])
  cantidad       Decimal  @db.Decimal(14, 4)  // mismo tipo que MovimientoStock.cantidad (desemboca en registrarVenta)
  precioUnitario Decimal  @db.Decimal(14, 2)  // precio al agregar el ítem (lo resuelve «tomar pedido»)
  /// null = sin enviar a cocina; 1..n = en qué envío salió. Marcador liviano hasta la entidad comanda/KOT real (pendiente «tomar pedido»).
  numeroEnvio    Int?
  creadoEn       DateTime @default(now())
  @@index([cuentaId])
}
```

- **Relaciones inversas obligatorias** (una línea declarativa cada una): `Sucursal.mesas Mesa[]`; `User.cuentasAbiertas Cuenta[] @relation("CuentaAbiertaPor")`; `Producto.cuentaItems CuentaItem[]`.
- **De dónde sale cada dato de las 3 tarjetas:**

| Dato de la tarjeta | Origen |
|---|---|
| número | `Mesa.numero` |
| productos sin enviar | Σ `cantidad` de ítems con `numeroEnvio IS NULL` |
| total | Σ `cantidad × precioUnitario` |
| mesero | `abiertaPor.name`, si no la parte local del email |
| tiempo abierta | `abiertaEn` |
| pedidos enviados | cantidad de `numeroEnvio` distintos no nulos |

- **Queda afuera a propósito** (columnas/entidades aditivas del pendiente "tomar pedido"): notas/modificadores de ítem, elección dentro de combo, `operacionId`, `impresaEn`, la entidad comanda/KOT con anulación, cubiertos, zona/capacidad/posición de mesa, `activa`/baja de mesa (decisión abierta). Tampoco se agrega `sucursalId` a `Cuenta` (se llega por `mesa`).
- **Migración:** `npx prisma migrate dev --create-only --name pos_mesas_cuentas` contra la base local. A mano en el mismo `migration.sql`: `CREATE UNIQUE INDEX "Cuenta_una_abierta_por_mesa_key" ON "Cuenta"("mesaId") WHERE "cerradaEn" IS NULL;` (precedentes: `20260915034450_indices_manuales`, `20260921230000_factura_unica_vigente`; sin `CONCURRENTLY`, tabla nueva y vacía).
- **Mismo commit:** `test/setup/test-db.ts` → `limpiarBaseDeTest` borra `cuentaItem`, `cuenta`, `mesa` **al principio**. Test nuevo `test/pos/cuenta-una-abierta-por-mesa.test.ts` (segunda cuenta abierta en la misma mesa → P2002; cerrada la primera, se puede abrir otra; mismo número en otra sucursal permitido).

### Paso 1b — Acción de permiso `pos_mesas` — **REQUIERE AUTORIZACIÓN EXPRESA (ya autorizada, toca el catálogo de permisos — solo contra bases locales).**

- `src/core/permisos/acciones.ts`: `{ clave: "pos_mesas", descripcion: "Ver el mapa de mesas del salón y dar de alta mesas (POS)", rolesEditarSemilla: ["admin"] }`. Operador queda sin asignar (igual que `anular_compra`).
- Migración de datos aparte, calcada de `permiso_corregir_compra`: `INSERT ... ON CONFLICT DO NOTHING` en `Accion`/`PermisoRol`, solo admin.
- Test `test/permisos/migracion-permiso-pos-mesas.test.ts`, clon del de `corregir_compra`.
- Rol "mozo": se crea desde `/administracion/roles`, no en código.

### Paso 2 — `src/core/pos/mesas.ts`

- **Puras:** `export type EstadoMesa = "libre" | "en_pedido" | "ocupada"`; `resolverEstadoMesa(cuentaAbierta)`; `calcularMetricas(mesas)`; `tiempoDesde(abiertaEn, ahora)`; `filtrarMesas(mesas, {estado?, q?})`.
- **Con base:** `obtenerMapaDeMesas(sucursalId, db = prisma, ahora = new Date())` — una sola consulta:
```ts
mesa.findMany({
  where: { sucursalId },
  orderBy: { numero: "asc" },
  include: {
    cuentas: {
      where: { cerradaEn: null },
      include: {
        items: { select: { cantidad, precioUnitario, numeroEnvio } },
        abiertaPor: { select: { name, email } },
      },
    },
  },
})
```
  Mapea a `MesaEnMapa { id, numero, estado, productosSinEnviar, total: number, mesero, tiempoAbierta, pedidosEnviados }` (`Number(decimal)` como `venta.ts`). Devuelve `{ mesas, metricas, siguienteNumero }` (`max(numero)+1`, o 1 si no hay mesas).
- Test `test/pos/mesas.test.ts`: puras (3 estados, cuenta sin ítems → en_pedido, segunda ronda → en_pedido, métricas, tiempos); consulta (aislamiento por sucursal, orden, cuenta cerrada no cuenta, total, pedidosEnviados con envíos 1 y 2, mozo sin name → email).

### Paso 3 — `src/server/actions/pos/mesas.ts`

- `"use server"`, una sola función: `crearMesa(numero: number): Promise<ResultadoAccion>` dentro de `conPermiso("pos_mesas", async (ctx) => …)`. Valida `Number.isInteger`/`esNumeroFinito`, rango 1..9999. `prisma.mesa.create(...)`. P2002 → `error("Ya existe la mesa N en esta sucursal.")` (patrón `generar-codigo.ts:31`). No llama `refrescarVistaSiHaceFalta` — el cliente hace `router.refresh()`.
- Nada más indispensable: sin baja/renumeración, sin abrir/cerrar cuentas, sin auditoría (no es precio ni permiso).
- Test `test/pos/crear-mesa-action.test.ts` (molde `frecuencia-conteo-action.test.ts`): admin crea; número repetido → mensaje de negocio; 0/-1/1.5/NaN rechazados; mismo número en otra sucursal permitido; sin `pos_mesas` → "No tenés permiso"; con Ver sin Editar → rechazado; `CapacidadSucursal` deshabilitada → rechazado.

### Paso 4 — `PosShell`, página, `MesaCard` y tokens

- **`src/app/globals.css`:** bloque `.pos-shell` con `color-scheme: light`, `background: var(--paper)`, `color: var(--ink)`, y tokens: `--paper` #FAFAF8, `--ink` #1C1B19, `--brand` #A8431F, `--brand-hover` #8A3618, `--border` #E8E5DF, `--ink-soft` #6B6862, `--ink-faint` #76726A, `--mesa-libre` #3F7A5C/`-tint` #EBF3EE, `--mesa-draft` #B8860B/`-tint` #FBF3DE, `--mesa-ocupada` #A63D3D/`-tint` #FAEBEB, `--mesa-libre-ink` #356A4F, `--mesa-draft-ink` #7A5A07. Comentario explicando por qué no va en `:root`.
- **`src/components/pos-shell.tsx`** (Server Component, hermano de `app-shell.tsx`): encabezado angosto con nombre de sucursal, `SelectorSucursal` (si aplica), `email · rol`, `signOut` (igual que AppShell), enlace "Administración" solo si `pantallaDeInicio(ctx) !== "/mesas"`. `<main className="flex-1 mx-auto w-full max-w-[1180px] px-5 py-8 md:px-8 md:py-10">`. Sin sidebar, dólar, `after()` ni `AccionesVisiblesProvider`.
- **`src/app/(pos)/layout.tsx`:** clon de `(app)/layout.tsx` (`obtenerContextoUsuario()` → `irAlLogin()` → `<PosShell ctx>`), tipado `{ children: React.ReactNode }` (no `LayoutProps`), `metadata = { title: "Salón · Motor2" }`.
- **`src/app/(pos)/error.tsx`:** clon de `(app)/error.tsx`.
- **`src/components/mesas/mesa-card.tsx`:** copia del provisto con: `disabled={!onClick}` + estilos disabled en `ActionButton`/"Ver pedidos"/tres puntos; `ESTADO_CONFIG` suma `varTexto` (libre→`--mesa-libre-ink`, en_pedido→`--mesa-draft-ink`) y `varTextoBoton` (en_pedido→`var(--ink)`, resto→`#fff`); `EstadoMesa` importado de `@/core/pos/mesas`; docstring del corte de alcance.
- **`src/app/(pos)/mesas/page.tsx`** (Server Component): `ctx` (si no hay, `return null`); `requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "pos_mesas")` con el literal; `obtenerMiNivelPermiso` para habilitar "Nueva mesa"; `searchParams` → `obtenerMapaDeMesas`; encabezado con hora en `timeZone: "America/Argentina/Buenos_Aires"`; 4 tarjetas de métricas; filtros por `<nav aria-label="Filtrar por estado">`; búsqueda por `<form method="get">` con `<label className="sr-only">`; grilla de `MesaCard` con `numero={String(n).padStart(2,"0")}` y ningún callback; estados vacíos.
- **`src/app/(pos)/mesas/nueva-mesa.tsx`** (`"use client"`): botón `--brand` deshabilitado sin permiso Editar; diálogo con número precargado (`siguienteNumero`); `useTransition` → `crearMesa` → mensaje → `router.refresh()`. Para el disparador, agregar prop opcional `triggerClassName` a `src/components/modal.tsx` (aditivo) o un diálogo propio en el archivo.

### Paso 4b — Pantalla alcanzable (recomendado, commit aparte)

- `src/core/navegacion/estructura.ts`: grupo `{ id: "pos", label: "Salón", items: [{ href: "/mesas", label: "Mapa de mesas", accion: "pos_mesas" }] }` **al final** de `GRUPOS_NAV`.
- `test/arquitectura/menu-con-permiso.test.ts`: `accionDeLaPagina` busca `page.tsx` en `(app)` **o** `(pos)`.
- `test/permisos/menu-por-permiso.test.ts`: caso nuevo "solo `pos_mesas` → `/mesas`".
- `test/arquitectura/pantalla-de-error.test.ts`: se suma `"(pos)/error.tsx"`.

### Paso 5 — Corte de alcance explícito

- Botones sin callback quedan `disabled` (afecta "Tomar pedido"/"Continuar pedido"/"Ver pedidos"/"Facturar"/"Opciones de mesa").
- Nota visible bajo la grilla, color `--ink-faint`: "Tomar pedido, ver pedidos y facturar todavía no están habilitados en esta versión."
- Docstrings: los callbacks son el punto de enganche del pendiente futuro "tomar pedido / comanda-KOT / facturar" (insumos ya en `docs/grounding-pos-mesas-comandas-2026-09-24.md` §3/§4). Sin rutas placeholder ni Server Actions de cuenta/comanda.
- **Hasta ese pendiente, todas las mesas se ven "libre"** en producción — esperado, nadie escribe `Cuenta` todavía. `en_pedido`/`ocupada` se prueban con filas sembradas.
- Sin actualización en vivo (ni polling ni realtime).

### Paso 6 — E2E nuevos

- **`test/e2e/pos-mapa-de-mesas.spec.ts`:** siembra 3 mesas en "Central" (libre; cuenta abierta con 1 ítem sin enviar; ítems con `numeroEnvio` 1 y 2), limpieza en `finally`. Afirma: título, métricas, textos de tarjeta, filtro `?estado=ocupada`, "Nueva mesa" crea sin recargar (patrón `refresco-sin-recargar.spec.ts`) y número repetido muestra error, botones fuera de alcance `disabled`, sin menú de administración visible, permisos (Ver sin Editar, sin permiso), sin sesión → `/login?volver=%2Fmesas`, `.pos-shell` sigue claro en `emulateMedia({colorScheme:"dark"})`.
- **`test/e2e/accesibilidad.spec.ts`:** nuevo `testAutenticado(...)` para pos/mesas, escaneo axe completo en reposo + diálogo abierto + modo oscuro emulado — confirma los contrastes aprobados.
- **`test/e2e/rutas-sin-parametros.ts`:** se suma `"/mesas"` (afecta también a `test/e2e-demo/todas-las-pantallas.spec.ts` — migrar la base `_demo` antes de esa corrida si existe).

---

## D. Verificación de punta a punta (obligatoria)

**Preparación** (este worktree, bases `motor2_mesas`/`motor2_mesas_e2e` locales, nunca Neon/producción):
- `node_modules` ya enlazado. `.env` con `DATABASE_URL`/`DIRECT_URL="postgresql://motor2:motor2@localhost:5432/motor2_mesas"`, `MOTOR2_E2E_DATABASE_URL="postgresql://motor2:motor2@localhost:5432/motor2_mesas_e2e"`.
- Migrar ambas bases con `prisma migrate deploy` contra `DIRECT_URL` (la de e2e a mano, porque `build:e2e` no migra).
- `MOTOR2_E2E_SERVIDOR` vacío (modo build).

**Línea de base:** anotar `npx tsc --noEmit` (ruido esperado: `LayoutProps`), `npm run lint`, `npm test` (Tests N passed / M files), `npm run build`, `npx playwright test --list | tail -1` y `npm run test:e2e`.

**Criterio de cierre.** Todo en la misma corrida, mismo commit final, bases recién migradas:
- `npx tsc --noEmit` → vacío salvo el mismo ruido de la base.
- `npm run lint` → 0/0 nuevos.
- `npm test` → suite entera verde, conteo ≥ base + `pos/mesas`, `pos/crear-mesa-action`, `pos/cuenta-una-abierta-por-mesa`, `permisos/migracion-permiso-pos-mesas`, caso nuevo de `menu-por-permiso`, casos extra de `menu-con-permiso`/`pantalla-de-error`.
- `npm run build` → limpio, aplicando las 2 migraciones nuevas.
- `npm run test:e2e` → suite entera verde, conteo ≥ base + `pos-mapa-de-mesas.spec.ts` + axe nuevo + 2 casos de `maquetacion-general` para `/mesas`.
- Si algo falla: corregir y volver a correr TODO.

**Áreas a mirar con atención especial:** `migracion-permiso-pos-mesas.test.ts`, `guardar-permisos-concurrencia.test.ts` (ahora incluye `pos_mesas`), `permisos-matriz-guardar.spec.ts`, `menu-por-permiso.test.ts` (inicio de admin/operador sin cambios), `menu-con-permiso`/`pantalla-de-error` (extendidos en 4/4b), `maquetacion-general.spec.ts` (`main h1`, sin scroll horizontal a 1024px), `accesibilidad.spec.ts` › modo oscuro (solo mira `/catalogo/unidades`, no debe cambiar), `compras-registradas.spec.ts`/`reportes-permisos.spec.ts` (cuentan enlaces del menú), `volver-tras-login.spec.ts`/`lecturas-sesion-vencida.spec.ts` (reusan `irAlLogin`). Limpieza: `cuentaItem`/`cuenta`/`mesa` primero en `limpiarBaseDeTest`.

### Critical Files for Implementation
- prisma/schema.prisma
- src/core/permisos/acciones.ts
- src/app/globals.css
- src/core/navegacion/estructura.ts
- test/setup/test-db.ts
- src/app/(app)/layout.tsx (molde) y src/components/app-shell.tsx (lo que PosShell no copia)
- src/server/actions/con-permiso.ts
- test/e2e/accesibilidad.spec.ts y test/e2e/rutas-sin-parametros.ts
- test/arquitectura/menu-con-permiso.test.ts y test/arquitectura/pantalla-de-error.test.ts
- prisma/migrations/20260921232000_permiso_corregir_compra/migration.sql (molde)
- docs/grounding-pos-mesas-comandas-2026-09-24.md
- Insumos: /root/.claude/uploads/a0f4c784-cccb-521a-94cd-9ee7a5b6e4cc/{e971ed44-mesa-card.tsx,b56e730f-mesas-tokens.css,fec914ec-Mapa_de_Mesas___propuesta_motor2.html}
