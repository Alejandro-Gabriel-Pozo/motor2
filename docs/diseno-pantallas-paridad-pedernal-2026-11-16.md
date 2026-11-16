# Diseño — Frente 6: PANTALLAS adecuadas a Pedernal — 2026-11-16

Estado: **Fase 1, solo documento.** Sin código, sin migración, sin DEC, sin tocar ninguna base. Orquestador del frente 6 (sesión `session_01FWp2kk5PrAyuuNP3Ufwf9V`), contrato: `motor2-docs/_coordinacion/mapa-de-carriles-2026-11-16.md`.
Estados de decisión: **CONFIRMADA** (dueño, cita literal y fecha) · **PROPUESTA** · **PENDIENTE** · **NO VERIFICADA**.
Marcas de evidencia: **(V)** leído en el código real de `main` de Motor2 (`903c0f6d`) o de Pedernal (`ZuluHub-ERP` `ad4a9a4`, 2026-11-16 11:36 -0300) · **(DOC)** solo documento/maqueta de `ZuluHub-docs` · **(NV)** no verificado.

## 0. Límites honestos de esta auditoría (leer primero)

- Lancé dos agentes de lectura (uno por sistema) para un inventario exhaustivo; **no entregaron a tiempo** (más de 2 h, sin informe). Este documento se apoya **solo en lo que leí yo** con grep y lectura directa. Todo lo demás va como NV. Cuando entreguen, su inventario se tratará como punto de partida y se verificará antes de usarlo.
- **No corrí la app de Motor2 ni capturé pantallas.** La regla del 2026-11-05 (maqueta = pantalla real con datos reales de la empresa del dueño, a 375 px y escritorio) se cumple recién en la etapa mínima (§6), no en esta fase.
- Las maquetas de Pedernal se leyeron como texto (HTML sin estilos); **no vi su aspecto**.
- No leí `motor2-docs/memoria-claude/` ni `seguimiento-de-pedernal/` salvo el contrato y la sección de paridad. Puede haber decisiones del dueño sobre pantallas que no vi (NV).

## 1. Pedido (nivel 1) y actores (nivel 2)

**Pedido (CONFIRMADA):** «Y también las pantallas no están adecuadas. La última vez que yo vi lo de promociones no se podía elegir el plato con opción. Hoy esto cambió gracias a Pedernal» — dueño, 2026-11-16, `motor2-docs/seguimiento-de-pedernal/decisiones-del-dueno-2026-11-14-mesa-resend-contador.md`, sección «Paridad con Pedernal: qué falta y cómo se trabaja».
**Regla vigente (CONFIRMADA, 2026-11-13):** «Necesitamos ser iguales [a Pedernal] en todo… el resultado tiene que ser el mismo y sobre todo de las mismas formas, salvo porque nosotros usamos Prisma» (`AGENTS.md`, «Paridad con Pedernal»).

**Qué NO está dicho (ambigüedad abierta, ver Q1):** qué pantallas concretas «no están adecuadas». La frase del dueño no las enumera; el único ejemplo (promociones con plato con opciones) **ya funciona en Motor2** según el código (§3.1). Por la regla del 2026-10-28 no se asume el alcance: este documento audita y propone, y el alcance lo fija el dueño.

**Actores (PROPUESTA):** quien administra/gerencia el catálogo y la carta (pantallas de administración); mozo/cajero (mostrador y salón); operador de compras. Permisos: los existentes (`src/core/permisos/acciones.ts`); este frente no crea permisos.

## 2. Qué es «pantalla» en cada sistema (contexto de la comparación)

| | Motor2 (V) | Pedernal (V) |
|---|---|---|
| Alcance construido | ~100 `page.tsx` en `src/app`: administración, carta, catálogo, movimientos, stock, traspasos, reportes (≈35), mesas (salón y mostrador) | ~40 `page.tsx` en `apps/web` (+9 en `apps/plataforma`): ingreso/empresa/invitación, caja (solo **configuración**: medios de pago, cuentas de cobro, cajas), catálogo (productos, secciones), configuración fiscal, facturación, cuenta/sucursal, carta pública |
| Construcción | Next App Router, formularios con server actions, componentes en `src/components` | Plantillas (`apps/web/ui/plantillas/*`) y caminos declarados; ficha de pantalla **diseñada, no construida** (`ficha-de-pantalla-diseno.md`, 2026-11-15) |
| Menú | Dos paneles «Empresa / Sucursal» con grupos (`src/components/sidebar-nav.tsx`) (V) | **Áreas** `ventas`, `catalogo`, `cuenta` y grupos; tabla declarativa `apps/web/ui/navegacion/menu.ts` (V); la maqueta v8 del menú (15/11) figura «pendiente de aprobación» (DOC) |

**Consecuencia central (V):** Pedernal tiene **menos pantallas** que Motor2. Para casi todo el negocio gastronómico (promos/combos, mostrador, salón, compras, cierre del día, stock) Pedernal tiene **servidor y maquetas**, no pantalla construida. «Igual a Pedernal» en pantallas significa, entonces, igualar **las maquetas aprobadas y las pantallas ya construidas** de Pedernal, no copiar una pantalla que allá no existe.

## 3. Auditoría pantalla por pantalla (nivel 8/9)

Leyenda de la columna «Veredicto»: **IGUAL** (mismo resultado y forma) · **DIFIERE-RESULTADO** · **DIFIERE-FORMA** · **FALTA-M2** (Pedernal tiene, Motor2 no) · **FALTA-PED** (Motor2 tiene, Pedernal no) · **NV**. «Solo interfaz» = se resuelve en `src/app`/`src/components`; «Otro frente» = necesita servidor, datos o permisos de otro frente.

### 3.1 Promociones — el ejemplo del dueño

**Motor2 hoy (V):** `src/app/(app)/carta/parametrizacion/promociones/page.tsx` agrega entradas a un «lugar» de la promo con `agregarEntradaDeCupo({ cupoId, productoId, modoDeOpciones: "FIJAS" | "A_ELEGIR", opciones })` (`page.tsx:283-285`). El componente `src/app/(app)/carta/agregar-entrada-de-lugar.tsx` (325 líneas) muestra, para un producto con opciones, «Qué pasa con las opciones de «X»»: **«Vienen fijas»** (un desplegable por grupo) o **«El mozo elige»** (casillas por grupo; límites del grupo en solo lectura) (`:259-315`). Historia: «Promo a elegir» etapa N1 PR B (#163), «Sumar un lugar» (#226); el bloque «Sumar un lugar» está visible por el interruptor `SUMAR_LUGAR_DE_LISTA_VISIBLE` (prendido el 2026-11-11, `src/core/carta/cupos-de-promo.ts`).
**Conclusión (V):** hoy **sí se puede elegir un plato con opciones** en promociones de Motor2. Lo que vio el dueño «la última vez» era anterior (NV: no sé cuándo ni qué versión). No lo doy por falso ni por cierto en su mundo: **lo verificable es el código**.

**Pedernal (V/DOC):** **no tiene pantalla de promociones ni de combos** (`grep conjunto|combo` en `apps/web`: solo tests de facturación). Tiene el **dominio** (`src/modulos/catalogo/dominio/conjuntos.ts`, reparto al centavo, #305) y la **maqueta** `combo-elecciones.html` (DOC): al tocar un combo en la venta se abre «la misma hoja de opciones de los demás productos»; por componente a elegir se ve lo elegible de esa sección; si lo elegido tiene opciones obligatorias, se piden ahí mismo; «Agregar» se habilita al completar lo obligatorio; el combo entra como una línea con un precio. Modelo distinto: **conjunto = producto de clase CONJUNTO** (promoción = combo, DDD 97), no «lugares/cupos de promo».
**Veredicto: DIFIERE-FORMA y de modelo.** Qué elige el cliente en la venta es del frente de mostrador (no mío, ver §7); la pantalla de ADMINISTRAR promos de Motor2 no tiene equivalente en Pedernal para comparar. **NV:** si `combos.html` (maqueta de carga del combo) se parece a la pantalla de Motor2. Hallazgo para el dueño: el ejemplo ya está resuelto; falta saber qué otra cosa de promociones le molesta (Q1).

### 3.2 Secciones de la carta
- **Motor2 (V):** `carta/parametrizacion/secciones/page.tsx` (221 líneas): arriba «Secciones de la carta» con «Ordenar» y «⋯» (`OrdenarSecciones`), datos de cada sección (nombre, título, descripción, imagen, orden, prendida/apagada) y debajo la ficha de cada producto de la carta de la sucursal. Además `carta/agrupados`, `movimientos/secciones` (otra cosa: sección de stock, NV) y `catalogo/categorias`.
- **Pedernal (V):** `catalogo/secciones` (lista, nueva, una sección, renombrar) con `ListaDeSecciones`, `FormularioDeSeccionDeCarta`, `FormularioDeEstadoDeSeccion` (#331, #332). Maqueta `productos-secciones.html` aprobada 12/11 (DOC): lista simple dentro de la ficha del producto, agregar/quitar productos, ordenar con flechas, crear/desactivar; **un producto en una sola sección**; nombre ≤80 caracteres y único.
- **Veredicto: DIFIERE-FORMA.** Motor2 mezcla secciones, productos de la carta y orden en una pantalla; Pedernal separa «lista de secciones» de «una sección». Reglas (una sección por producto, nombre único) son de datos: **Otro frente (3 datos / clasificación)**. NV: si Motor2 ya impone «una sola sección».

### 3.3 Menú por áreas
- **Motor2 (V):** dos paneles Empresa/Sucursal (`sidebar-nav.tsx`, `src/core/navegacion/estructura`), selector con `localStorage`.
- **Pedernal (V/DOC):** tabla declarativa con áreas `ventas`, `catalogo`, `cuenta`; «todo nace cerrado» (módulo disponible, activo y acción permitida); maqueta v8 (15/11) «pendiente de aprobación», con barra inferior en celular y panel lateral plegable en escritorio, selector de «departamento».
- **Veredicto: DIFIERE-FORMA** (estructura del menú). **Solo interfaz** más una tabla; usa permisos existentes. **Bloqueo:** la maqueta de Pedernal **no está aprobada**: copiarla sería adelantarse (Q2). El selector de departamento depende de clasificación (frente 2).

### 3.4 Mostrador y salón
- **Motor2 (V):** `(pos)/mesas` (lista), `mesas/[mesaId]`, `mesas/mostrador`; componentes `src/components/mesas/*`.
- **Pedernal (V/DOC):** **sin pantalla** (servidor de venta rápida mergeado: #338 lista vendibles y total, #335 vuelto, #340 cobrar con datos del cobro; salón E7 con unir/dividir #262/#320/#324). Maquetas `venta-rapida-v4.html`, `salon.html`, `mesas.html`, `unir.html`, `combo-elecciones.html`; el mapa del 11/11 marca varias como «aprobada pero desactualizada» (DOC).
- **Veredicto: FALTA-PED** (pantalla) / **NV** (qué difiere de las maquetas). Comparar maqueta contra pantalla real requiere capturas (etapa mínima). Todo lo que sea cobro es **Otro frente (1 caja)**.

### 3.5 Ficha del producto
- **Motor2 (V):** `catalogo/productos/[id]` con subrutas `datos`, `precios`, `opciones`, `compra`, `en-la-carta`; ya reformada «como Pedernal» (Datos / Precios / Opciones, menos texto) por #279 y #282 (git log, V); duplicar producto (#257, #313).
- **Pedernal (V):** `catalogo/productos/[id]` y `/precios`, `FormularioDeFichaDeProducto`, alta y filtros.
- **Veredicto:** **IGUAL en lo trabajado** hasta #282; pendiente según `docs/diseno-productos-igual-a-pedernal-2026-11-13.md` (NV si se completó todo). **La tarjeta «Ocultar» NO se toca** (`session_01FWp2khnmfSfh88wNWCu66B`).

### 3.6 Compras
- **Motor2 (V):** no hay pantalla propia de compras en `src/app`: se carga desde `movimientos/[proceso]` con `panel-compra-por-pasos.tsx`, más `catalogo/productos/[id]/compra`, `catalogo/proveedores/*` y `reportes/compras`.
- **Pedernal (DOC):** maquetas `compra.html`, `compra-pago.html`, `compra-corregir-anular.html`; especificación `pantallas-de-compras-inventario.md` (316 líneas, **no la leí**); sin pantalla construida (NV: ni en `apps/web`).
- **Veredicto: FALTA-PED (pantalla), DIFIERE-FORMA (NV)**. Recepción separada, orden de compra, tres vías y nota de crédito son del **frente 5**; yo solo haría la interfaz cuando ese frente entregue el contrato.

### 3.7 Caja
- **Motor2 (V):** **no hay pantalla de caja** (ningún `page.tsx` de caja/cobro/cierre en `src/app`; el salón cobra desde la cuenta de la mesa, NV el detalle).
- **Pedernal (V):** `caja/medios-de-pago`, `caja/cuentas-de-cobro`, `caja/cajas` (alta, edición, lista; #276, #277). Maquetas `caja.html`, `cierre-del-dia.html` (sin aprobar), `medios.html`, `datos-cobro*.html`.
- **Veredicto: FALTA-M2.** Es **frente 1**: el servidor (caja, cobro, jornada) va primero; yo solo pongo la interfaz después.

### 3.8 Resumen

| Pantalla | Veredicto | ¿Solo interfaz? | Depende de |
|---|---|---|---|
| Promociones (plato con opciones) | Ya resuelto en M2 (V); lo demás NV | Sí | Q1 |
| Secciones de la carta | DIFIERE-FORMA | Parcial | Frente 3 (regla de datos) |
| Menú por áreas | DIFIERE-FORMA | Sí | Aprobación de la maqueta (Q2) |
| Mostrador/salón | FALTA-PED / NV | Sí | Frente 1 (cobro) |
| Ficha del producto | IGUAL (trabajado) | — | Ocultar (otra sesión) |
| Compras | FALTA-PED / DIFIERE-FORMA | No | Frente 5 |
| Caja | FALTA-M2 | No | Frente 1 |
| Reportes (35), stock, traspasos, administración | FALTA-PED (Pedernal no los tiene) | — | No se tocan: sin pedido |

## 4. Diseño: niveles 1 a 5

| Nivel | Decisión | Estado |
|---|---|---|
| 1 Propósito | Que las pantallas de Motor2 se vean y se usen como las **aprobadas** de Pedernal, sin sumar funciones | CONFIRMADA (2026-11-16 y 2026-11-13, citas en §1) |
| 1 Alcance | Qué pantallas entran | **PENDIENTE (Q1)** |
| 2 Actores | Los de §1 | PROPUESTA |
| 3 Casos de uso | Menú por áreas (ver/navegar); elegir plato con opciones en promo (ya existe); secciones (ver, crear, renombrar, activar, ordenar, quitar productos) | PROPUESTA (salvo promos: V) |
| 4 Ciclo de vida | Sección/promo: nace desactivada, se activa/desactiva, no se borra. Pantalla: nace cerrada (sin permiso no se ve) | PROPUESTA (alineada a «Todo nace cerrado») |
| 5 Invariantes | (a) ninguna pantalla nueva sin maqueta aprobada de Pedernal o decisión del dueño (regla 14/10 de Pedernal, DOC); (b) textos nuevos solo por catálogo T1 (`src/core/textos/`), fechas por `fechaParaMostrar` (DD/MM/AAAA); (c) toda decisión de qué ve o hace una persona se muestra como «pendiente de completar» y no se inventa; (d) la pantalla no decide permisos: el servidor valida; (e) 375 px primero | PROPUESTA |

Niveles 6 a 10: **no se diseñan** hasta que el dueño confirme 1 a 5 (compuerta). Este frente **no necesita tablas nuevas** en la etapa mínima.

### Tabla «¿qué pasa si…?» (comandos de pantalla de la etapa mínima)

| Si… | Pantalla de menú por áreas | Pantalla de lista de secciones |
|---|---|---|
| Repetición (clic doble) | Navegar no escribe | La acción de servidor ya existente (`ordenarSeccionesCarta`, etc.) debe seguir idempotente; no se toca (NV si lo es) |
| Concurrencia | n/a | Dos personas reordenan: gana el último, orden con desempate único (#332 en Pedernal; **NV** en Motor2) |
| Tiempo | n/a | n/a |
| Incertidumbre / reintento | Falla la carga: el menú cierra, no abre | Se muestra el error del servidor, sin estado a medias |
| Error parcial | n/a | Lo maneja el servidor |
| Datos faltantes | Módulo sin plan: no aparece (nace cerrado) | Sección sin productos: «pendiente de completar» |
| Cambio de permisos | El menú se recalcula en el servidor; el cliente no decide | El botón se apaga/oculta; el servidor igual rechaza |

## 5. Dependencias con otros frentes y corrientes

| Frente/corriente | Qué necesito (por mensaje, nada se asume) | Qué ofrezco |
|---|---|---|
| 1 Caja (`session_01FWp2khLytEXE6qWCg18UkK`) | Contrato de cobro/jornada antes de cualquier pantalla de caja o cobro del mostrador | Interfaz de caja y cobro |
| 2 Unidades y clasificación (`session_01FWp2kiftTcYYrgUtRy35dg`) | Qué cambia en la clasificación (departamento, secciones) que afecta menú y secciones | Pantallas de clasificación |
| 3 Datos (`session_01FWp2kfrA1HP5aCRYMqYak9`) | Reglas de forma de datos de nombres/secciones; fechas | Consumir `fechaParaMostrar` |
| 4 Planes y perillas (`session_01FWp2kimyKRo3i4pWzavWoj`) | Perillas/módulos que gobiernan qué ítem de menú existe | Menú por áreas leyendo esas perillas |
| 5 Compras (`session_01FWp2kh2bayQURHmaJULuc6`) | Casos de uso de recepción, OC, tres vías, NC | Pantallas de compras |
| Ocultar (`…khnmfSfh88wNWCu66B`) | Nada: no toco la tarjeta | No toco `catalogo/productos/[id]` |
| Roles P1 (`…kg16mmRbJwGpsiMpHA`) | Nombre visible «Empleado» (decisión «como pedernal») | Usarlo en textos por T1 |
| Textos T2 (`…kipcKtTwtYF9fwRY4H`) | Claves T1 para los rótulos nuevos | Pedir cada clave por mensaje |

## 6. Etapa mínima (regla «primero lo más barato») y etapas con nombre

- **E0 — Fotografía (sin código):** pantalla REAL de Motor2 con datos reales de la empresa del dueño (base local descartable, o lectura de producción solo lectura), a 375 px y escritorio, al lado de la maqueta de Pedernal; para **promociones, secciones y menú**. Es lo que se le muestra al dueño para que diga cuáles «no están adecuadas». Cuesta cero producto.
- **E1 (si Q1 confirma el menú):** menú por áreas en la barra lateral, reutilizando la estructura existente, solo interfaz.
- **E2 (si Q1 confirma secciones):** separar lista de secciones y una sección, como Pedernal.
- **E3+ (etapas con nombre, dependen de otros frentes):** E3 pantalla de caja/cobro (frente 1); E4 pantallas de compras (frente 5); E5 mostrador/salón contra maqueta v4 (frente 1); E6 combos (cuando Pedernal tenga pantalla).
- **Sugerencias (no implementadas):** unificar «Opciones» de promo con la hoja de opciones de la venta; recortar texto como en productos.

## 7. Carril de escritura (para Fase 2)

**Escribo SOLO en:** `src/components/sidebar-nav.tsx`, `src/components/menu-celular.tsx`, `src/components/app-shell.tsx` y `src/core/navegacion/**` (menú, si Q2 = sí); `src/app/(app)/carta/parametrizacion/secciones/**`, `src/app/(app)/carta/parametrizacion/promociones/**`, `src/app/(app)/carta/agregar-entrada-de-lugar.tsx`, `src/components/carta/**`; y, cuando los frentes 1 y 5 entreguen su contrato, `src/app/(pos)/mesas/**`, `src/components/mesas/**` y las pantallas nuevas de caja y compras que ellos me pidan. **Ningún modelo de `schema.prisma`.**
**No toco:** `prisma/`, `src/core/permisos/*`, `src/core/textos/*` (pido claves), `catalogo/productos/[id]/**` (Ocultar), `docs/registro-de-decisiones.md`, `package.json`, `.github/**`, `test/aislamiento/**`, `test/modulos/__golden__/**`.
**Superposiciones a negociar:** `src/core/navegacion/**` y `src/components/app-shell.tsx` con frente 4 (perillas); `mesas/**` con frente 1.

## 8. Preguntas al dueño (una por vez)

**Q1 (la que cambia qué se construye):** «Las pantallas no están adecuadas»: en Motor2 de hoy **sí se puede elegir un plato con opciones** al armar una promoción («Vienen fijas» o «El mozo elige»). ¿Cuál de estas pantallas querés que ajustemos primero: (A) menú de la barra lateral por áreas, como Pedernal; (B) secciones de la carta; (C) otra que me nombres? Recomendado: **mirar primero la fotografía E0 de las tres** y decidir sobre lo que ves.
**Q2 (después de Q1, no se pregunta aún):** el menú por áreas de Pedernal figura «pendiente de aprobación»; ¿se aprueba esa maqueta antes de copiarla?

## 9. Pedido y aceptación (para la plantilla de PR)

- **Qué entra al producto: nada.** Solo este documento. Cada renglón de §3 a §7 es propuesta, no producto.
- Código de este PR: ninguno. Modelo que escribió el documento: Sonnet.
