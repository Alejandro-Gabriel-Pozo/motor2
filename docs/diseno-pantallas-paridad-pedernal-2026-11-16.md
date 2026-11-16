# Diseño — Frente 6: PANTALLAS adecuadas a Pedernal — 2026-11-16

Estado: **Fase 1, solo documento.** Sin código, sin migración, sin DEC, sin tocar ninguna base. Orquestador del frente 6 (sesión `session_01FWp2kk5PrAyuuNP3Ufwf9V`), contrato: `motor2-docs/_coordinacion/mapa-de-carriles-2026-11-16.md`.
Estados de decisión: **CONFIRMADA** (dueño, cita literal y fecha) · **PROPUESTA** · **PENDIENTE** · **NO VERIFICADA**.
Marcas de evidencia: **(V)** leído en el código real de `main` de Motor2 (`903c0f6d`) o de Pedernal (`ZuluHub-ERP` `ad4a9a4`, 2026-11-16 11:36 -0300) · **(DOC)** solo documento/maqueta de `ZuluHub-docs` · **(NV)** no verificado.

## 0. Límites honestos de esta auditoría (leer primero)

- Dos agentes de lectura (uno por sistema) entregaron un inventario al final; su contenido está en los anexos A y B y es **punto de partida**: lo que no contrasté yo con el código va marcado **(agente)**. Lo que leí yo directamente va **(V)**. Donde el agente corrige mi primera lectura, se corrigió el cuerpo del documento.
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
- **Veredicto: DIFIERE-FORMA** (estructura del menú). **Solo interfaz** más una tabla; usa permisos existentes. Estado de aprobación (agente, DOC): el archivo de la maqueta dice «pendiente de aprobación», pero `decisiones-del-dueno-2026-11.md` líneas 82, 83 y 110 la aprueban (12/11 opción B por módulo; «aprobado con cambios»; rótulos 13/11): **no está claro cuál manda (NV)** → Q2. Pedernal solo muestra filas de módulos `disponible`; `catalogo`, `caja`, `ventas`, `salon`… siguen `en_desarrollo`, así que su menú real tiene hoy pocas filas. El selector de departamento depende de clasificación (frente 2).

### 3.4 Mostrador y salón
- **Motor2 (V):** `(pos)/mesas` (lista), `mesas/[mesaId]`, `mesas/mostrador`; componentes `src/components/mesas/*`.
- **Pedernal (V/DOC):** **sin pantalla** (servidor de venta rápida mergeado: #338 lista vendibles y total, #335 vuelto, #340 cobrar con datos del cobro; salón E7 con unir/dividir #262/#320/#324). Maquetas `venta-rapida-v4.html`, `salon.html`, `mesas.html`, `unir.html`, `combo-elecciones.html`; el mapa del 11/11 marca varias como «aprobada pero desactualizada» (DOC).
- **Veredicto: FALTA-PED** (pantalla) / **NV** (qué difiere de las maquetas). Comparar maqueta contra pantalla real requiere capturas (etapa mínima). Todo lo que sea cobro es **Otro frente (1 caja)**.

### 3.5 Ficha del producto
- **Motor2 (V):** `catalogo/productos/[id]` con subrutas `datos`, `precios`, `opciones`, `compra`, `en-la-carta`; ya reformada «como Pedernal» (Datos / Precios / Opciones, menos texto) por #279 y #282 (git log, V); duplicar producto (#257, #313).
- **Pedernal (V):** `catalogo/productos/[id]` y `/precios`, `FormularioDeFichaDeProducto`, alta y filtros.
- **Veredicto:** Motor2 **tiene más** que Pedernal: Pedernal solo construyó Datos y Precios (sin Opciones, Medidas, Consumo, Duplicar ni Clasificación; agente). Motor2 ya adoptó la forma de Pedernal en lista y ficha (#279, #282); queda lo de `docs/diseno-productos-igual-a-pedernal-2026-11-13.md` (NV si se completó). La tarjeta «Ocultar» **no existe aún** en Motor2 (agente: solo hay casillas «Se muestra en la carta» y «Ocultar menú» del sidebar); la hace otra sesión (`session_01FWp2khnmfSfh88wNWCu66B`), **no se toca**.

### 3.6 Compras
- **Motor2 (V):** no hay pantalla propia de compras en `src/app`: se carga desde `movimientos/[proceso]` con `panel-compra-por-pasos.tsx`, más `catalogo/productos/[id]/compra`, `catalogo/proveedores/*` y `reportes/compras`.
- **Pedernal (DOC):** maquetas `compra.html`, `compra-pago.html`, `compra-corregir-anular.html`; especificación `pantallas-de-compras-inventario.md` (316 líneas, **no la leí**); sin pantalla construida (NV: ni en `apps/web`).
- **Veredicto: FALTA-PED (pantalla), DIFIERE-FORMA (NV)**. Recepción separada, orden de compra, tres vías y nota de crédito son del **frente 5**; yo solo haría la interfaz cuando ese frente entregue el contrato.

### 3.7 Caja
- **Motor2 (V + agente):** **no hay pantalla ni entidad de caja/cobro**: «Cerrar cuenta» solo registra la venta y libera la mesa (`server/actions/pos/cuenta-cierre.ts:21`: «motor2 no tiene entidad de caja ni de pago»); no hay propina; el único «medio de pago» es el de facturas de proveedor.
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
**Q2 (después de Q1, no se pregunta aún):** la maqueta del menú por áreas figura «pendiente de aprobación» pero hay decisiones del 12 y 13/11 que la aprueban; confirmar cuál vale antes de copiarla.

## 8 bis. Estado tras las decisiones del dueño (2026-11-16)

| Pantalla | Estado | Cita / fuente |
|---|---|---|
| Secciones de la carta | **HECHA en etapa de pantalla** (lista simple + pantalla por sección): PR #345, `docs/diseno-secciones-lista-simple-2026-11-16.md` | «Lista simple como Pedernal (Recomendada)» (2026-11-16) |
| «Nueva sección» con solo el nombre | **PROPUESTA, sin código**: hoy conserva 5 campos (nombre, título, descripción, imagen, orden); Pedernal pide solo el nombre y el resto se completa en la pantalla de la sección. No se construye hasta que el dueño la acepte | Sugerencia del Frente 6 (el dueño no la pidió) |
| Promociones | **EN ESPERA DE PEDERNAL**: no se cambia el modelo ni se simplifica la pantalla hasta que Pedernal construya su pantalla de combos | «Esperemos a pedernal en esto ya lo lance» (2026-11-16, registrada en `motor2-docs`, «Promociones: esperar a Pedernal») |
| Menú lateral, ficha del producto, mostrador, compra | Solo medidas, sin propuesta: `motor2-docs`, `_coordinacion/densidad-otras-pantallas-2026-11-16.md` | Orden del dueño: «No dejes nada pendiente de lo que se puede trabajar en paralelo» (2026-11-16) |

Lo ya medido de promociones (para cuando se retome): Motor2 168 palabras, 43 campos, 16 casillas y 7 botones al entrar (415 palabras desplegada); Pedernal, solo maquetas de combos (lista 57 palabras; un combo 101; elegir al vender 79–87). Diferencia de fondo: en Motor2 el plato con opciones se define al armar la promo («Vienen fijas» o «El mozo elige»); en Pedernal se elige al vender. Comparación y capturas: `motor2-docs`, `_coordinacion/comparacion-pantallas-2026-11-16/`.

## 9. Anexos de verificación (informes de los agentes de lectura, resumidos; punto de partida)

### Anexo A — Motor2 (agente, código leído en `src/`)
- **Textos:** el catálogo T1 (`src/core/textos/catalogo.ts`) tiene 3 entradas (todas de Presentaciones); **todo el texto de las pantallas auditadas está hardcodeado** en el JSX o en casos de uso. Cualquier pantalla tocada en Fase 2 migra sus textos por T1 (pidiendo claves a la sesión de Textos).
- **Promociones:** permisos `carta_ver`, `carta_promo_definir` (empresa), `carta_promo_activar` y `carta_promo_precio_local` (sucursal). Elegir plato con opciones: **sí** (FIJAS: un selector por grupo de una sola elección; A_ELEGIR: casillas de opciones permitidas; adicionales no tildables). Límites del servidor: solo producto PV, precio ≥ $0,01, alícuotas de IVA iguales entre componentes, no mezclar FIJAS y A_ELEGIR para la misma clave. Solo lugares de tipo LISTA.
- **Secciones:** `/carta/parametrizacion/secciones` (ordenar con «Poner acá», menú «⋯» ocultar/mostrar, ficha de cada producto debajo; sin arrastrar a propósito por falla en celular); `/carta/agrupados` (ítems agrupados, otra cosa); `/movimientos/secciones` es **Depósitos** de stock, no secciones de carta.
- **Mostrador/salón:** `/mesas`, `/mesas/mostrador`, `/mesas/[mesaId]` (misma pantalla `pantalla-del-puesto.tsx` para mesa y mostrador); permisos `pos_*`; sin cobro.
- **Ficha del producto:** pestañas Datos, Precios, Opciones, Cómo se compra, Receta, En la carta (`core/catalogo/espacio-del-producto.ts`).
- **Compras:** carga por 5 pasos (`panel-compra-por-pasos.tsx`: Factura, Qué compraste, Dónde entra, Pago, Revisar), bandeja «Para aceptar» (recepción entre sucursales), `/reportes/compras` con corregir, anular y declarar pago, proveedores y comparativa. **No hay orden de compra** ni pantalla/acción de nota de crédito (existen modelos `NotaCreditoProveedor*` en `schema.prisma`, solo lectura). No hay pantalla de recepción propia.
- **Menú por áreas:** no existe (búsquedas: `area`, `menu por areas`, modelos `Area*`: sin resultados relevantes).
- **NV (agente):** 375 px real (no se corrió navegador; hay e2e a 375 px sin leer: `carta-mantenimiento`, `movil-pos-mesa`, `movil-compra-por-pasos`), componentes internos del salón, `/movimientos/venta`.

### Anexo B — Pedernal (agente, `ad4a9a4`; `mapa-de-pantallas-pedernal.md` del 12/11 está desactualizado)
- **Construido en `apps/web`:** productos (lista, nuevo, ficha Datos, Precios), secciones (lista con subir/bajar, nueva, una sección con productos solo lectura, renombrar; **falta la parte 2: agregar y quitar productos**), medios de pago/cuentas de cobro/cajas (lista, nuevo, editar), facturación, configuración fiscal, cuenta/sucursal, ingreso, carta pública.
- **Solo maqueta/ficha (sin pantalla):** combos y carga de promociones (`combos.html` aprobada 09/11; `e8-combos-especificacion.md`; ~5 % construido, solo dominio #305), elegir plato con opciones dentro de un combo (`combo-elecciones.html`, aceptada por delegación el 16/11: hoja de opciones común de la venta; sin adicionales con recargo; combo sin nada para elegir sale «No disponible»), clasificación comercial (ficha `EN_CONSTRUCCION`, rama `web/a14-clasificacion`), venta rápida (servidor sin ruta), salón/mesas/unir (rehechas el 14/11; aprobación de lo rehecho NV), compras, caja (abrir, arqueo, cerrar), datos del cobro en tres estados, cierre del día.
- **Cómo se construye una pantalla allá:** maqueta aprobada primero; luego ficha declarativa (`FichaDePantalla`: campos con dato, botones con permiso, modales, estados, textos), hoy **sin cablear** (`FICHAS` vacío); campos solo con `dato` registrado; permisos de botones a mano en `servidor/modulos.ts`; textos por catálogo con fuente; acciones con versión vista e idempotencia; gate propio (`npm run gate`, tests de componentes y recorrido).
- **NV (agente):** `pantallas-de-compras-inventario.md`, especificaciones de caja, cierre, salón y venta rápida, `ficha-de-pantalla-ocultar.md`, si #329 y #331 entraron.

### Cambios a lo escrito antes de los anexos
La caja de Motor2 es **inexistente** (no solo «sin pantalla»); el ejemplo de promociones **sigue siendo cierto** y verificado por dos lecturas independientes; Pedernal tiene **menos** pantallas de ficha de producto que Motor2.

## 10. Pedido y aceptación (para la plantilla de PR)

- **Qué entra al producto: nada.** Solo este documento. Cada renglón de §3 a §7 es propuesta, no producto.
- Código de este PR: ninguno. Modelo que escribió el documento: Sonnet.
