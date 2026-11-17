# Diseño: planes y perillas como Pedernal (Fase 1, solo documento, 2026-11-16)

> **No cambia código, migraciones, permisos ni textos.** Frente 4 del programa de paridad. Auditoría de base: `docs/auditoria-planes-y-perillas-vs-pedernal-2026-11-16.md`. Roles propios y «Empleado»/«Administrador» ya tienen plan: `docs/plan-roles-y-permisos-como-pedernal-2026-11-16.md` (P2 y P3, **no se rehacen acá**).
> Estados: CONFIRMADA (dicha por el dueño, con cita y fecha) · PROPUESTA · PENDIENTE · NO VERIFICADA.
> **Actualización (2026-11-16, tras la respuesta del dueño a la pregunta de §10):** «Planes con versiones desde el inicio, como Pedernal» — 2026-11-16 — `motor2-docs`, `seguimiento-de-pedernal/decisiones-del-dueno-2026-11-14-mesa-resend-contador.md:372`, sección «Fase 1 de los frentes». **CONFIRMADA:** planes con versiones inmutables y techo de módulos por plan **desde la primera etapa**. La perilla de roles propios en 0 y los nombres «Empleado»/«Administrador» ya aprobados se mantienen. Cambian §1.3, §7, D-2 y §10; el resto sigue como estaba.

## 0. Pedido del dueño (citas)

- «Las unidades de clasificación, el tema de datos, planes y perillas. Sí, eso tiene que ver con la plataforma.» — 2026-11-16 — `motor2-docs`, `seguimiento-de-pedernal/decisiones-del-dueno-2026-11-14-mesa-resend-contador.md`, sección «Paridad con Pedernal: qué falta y cómo se trabaja».
- «Necesitamos ser iguales [a Pedernal] en todo… El resultado tiene que ser el mismo y sobre todo de las mismas formas, salvo porque nosotros usamos Prisma.» — 2026-11-13 — regla «Paridad con Pedernal» de `AGENTS.md`.
- «como pedernal,» (a la perilla de roles propios nacida en 0, a Parte y a «Empleado») — 2026-11-16 — misma fuente, línea 340.
- «Sí, «Administrador» (Recomendada)» — 2026-11-16 — misma fuente, línea 347.

## 1. Resumen y recomendación

1. **Hoy Motor2 no tiene planes ni perillas tipadas**: tiene módulos por empresa (completos y auditados), dos booleanos de política (`permisosEditables`, `dosPaneles`), una columna `llevaIvaDeCompras` sin lector y un ADR-013 (planes) decidido y nunca construido. Pedernal tiene catálogo de perillas en código, planes con versiones inmutables, ajustes por empresa que solo se agregan y consola con «cambiar plan».
2. **La forma más barata de empezar a usar algo** es la que ya está planificada: **P2** (perilla `rolesPropiosMax` nacida en 0, columna en `Empresa`, la cambia la plataforma por el script existente) y **P3** (nombres visibles). No hace falta ninguna tabla nueva para eso. Esta etapa mínima se declara abajo (§7) y **no agrega nada que el dueño no pidió**.
3. **Decisión del dueño (2026-11-16, ver arriba): los planes con versiones inmutables y el techo de módulos por plan son la etapa mínima (M1).** Los ajustes por empresa, la pantalla de plan y la constancia en la empresa son etapas posteriores con nombre. Nada se migra hasta confirmar los niveles 1 a 5 (§2 a §6) y contestar la pregunta de §10.
4. **Dos hallazgos que cambian cómo se iguala**: (a) Pedernal **no tiene** `roles_propios_por_empresa` ni las perillas de compras N3/N4 en el código (solo en documentos), así que se iguala el **diseño**, no un comportamiento que exista; (b) **ADR-013 contradice a Pedernal** en la semántica del plan (genera filas vs. techo con versiones inmutables). El dueño la cerró el 2026-11-16: vale la de Pedernal (§8, D-2).

## 2. Escalera de diseño, nivel 1: propósito y alcance

| # | Decisión | Estado |
|---|---|---|
| 1.1 | Propósito: que la **plataforma** (no la empresa) decida qué puede usar cada empresa, con perillas que nacen **cerradas** («Todo nace cerrado») y se abren una por una, con motivo y rastro | PROPUESTA (deriva de «planes y perillas… tiene que ver con la plataforma», 2026-11-16, y de la regla del 2026-11-11) |
| 1.2 | La empresa **ve** lo que tiene pero no lo cambia | PROPUESTA (igual a Pedernal: el gerente elige dentro del techo, no cambia perillas; ADR-013 §4) |
| 1.3 | Precios, cobro y suscripciones: **fuera de alcance**. Pedernal tampoco los tiene (cobro manual en el piloto) | PROPUESTA; el dueño no pidió precios |
| 1.4 | Alcance de este frente en Fase 1: auditoría + diseño. Código solo en Fase 2, por etapas, tras la confirmación de los niveles 1 a 5 | CONFIRMADA (el contrato del programa y las palabras del 2026-11-16) |
| 1.5 | Necesidad que resuelve cada pieza: P2 (el dueño: «como pedernal,» 2026-11-16); P3 (ídem y «Sí, «Administrador»»); planes/versiones/ajustes: «planes y perillas» (2026-11-16) + paridad; **cada perilla concreta** (caja múltiple, N3/N4, fracciones) **solo entra con el pedido del frente que la necesita** | PROPUESTA |

## 3. Nivel 2: actores y contexto

| Actor | Qué hace | Autorización | Estado |
|---|---|---|---|
| Administrador de plataforma (`AdminPlataforma`, TOTP) | Crea planes, publica versiones, asigna plan, ajusta perillas, activa módulos | Servidor: `requerirAdminDePlataforma` y rol de base `motor2_plataforma` (ya existen) | PROPUESTA (como hoy y como Pedernal) |
| Soporte de plataforma (solo ver) | Pedernal lo distingue (SOPORTE solo ve) | Motor2 no tiene ese rol: **no se agrega**, no está pedido | NO VERIFICADA la necesidad |
| Gerente / administrador de la empresa | **Ve** su plan y perillas (solo lectura), nunca los cambia | Guard de la app | PROPUESTA; la pantalla de solo lectura para la empresa **no fue pedida**: queda como sugerencia (§9) |
| Dueño (Alejandro) | Decide qué perilla sube a qué empresa y cuándo (comercial) | Fuera del sistema | CONFIRMADA («la sube el dueño», fila 203 de Pedernal, aceptada con «como pedernal,») |
| Sistema (guards, casos de uso) | Pregunta la perilla efectiva en **cada** acción | Servidor, sin confiar en el cliente | PROPUESTA |

Contexto: dos instalaciones de producción con una base cada una (ADR-025), una consola para ambas; la plataforma escribe con el rol `motor2_plataforma`, la app con `motor2_app` (no puede escribir las tablas de plataforma). Congelamiento de despliegue vigente: nada se aplica a ninguna base real.

## 4. Nivel 3: casos de uso

| # | Caso | Quién | Etapa |
|---|---|---|---|
| C1 | Subir o bajar una perilla de una empresa (hoy: `rolesPropiosMax`, `permisosEditables`, `dosPaneles`) | plataforma | **P2** (script existente, ampliado) |
| C2 | Una acción de la empresa pregunta si la perilla lo permite (crear rol, etc.) y se rechaza con el texto ya existente | sistema | **P2** |
| C3 | Cambiar un perfil (`completo`/`lite`) | plataforma | existe; se reevalúa en M1 |
| C4 | Registrar un **ajuste** de perilla con motivo y vigencia, sin pisar el anterior | plataforma | M3 |
| C5 | Crear plan, guardar borrador, publicar versión inmutable | plataforma | M1 |
| C6 | Asignar plan a una empresa (con vigencia futura, reemplazar una decisión programada) | plataforma | M1 |
| C7 | Ver plan, módulos y perillas con su origen (base / plan / ajuste) | plataforma | M2 |
| C8 | Ver la propia política y límites | gerente | sugerencia, no pedida |
| C9 | Precios y cobro | — | fuera de alcance |

## 5. Nivel 4: conceptos y ciclo de vida

| Concepto | Definición propuesta (igual a Pedernal, adaptada a Prisma) | Estado |
|---|---|---|
| **Perilla** | Elemento de un **catálogo cerrado en código** (`src/core/…`): id, tipo (**INTERRUPTOR** o **LIMITE**, nada más), valor base, ámbito (EMPRESA, SUCURSAL), módulo, `requiere`. La base no conoce el catálogo. Regla heredada: **una perilla que nadie verifica no se declara** | PROPUESTA (forma de Pedernal; `perillas.ts:9-144`) |
| **Valor de base** | Todo nace apagado / en 0 (`rolesPropiosMax = 0`); `permisosEditables` y `dosPaneles` **nacen en `false` para las empresas NUEVAS** y la plataforma los abre cuando corresponde; las empresas existentes conservan su valor (hoy `true`) | CONFIRMADA («Sí, nacen cerradas (Recomendada)», 2026-11-16, `motor2-docs`, «tercera tanda») |
| **Perilla efectiva** | Cálculo puro: ajuste vigente más específico > valor del plan > base; luego `requiere` (falla cerrado) | PROPUESTA (M3+); en P2 es la columna |
| **Ajuste** | Fila que **solo se agrega** (serie numerada por empresa y perilla), con `motivo`, `aplicaDesde`, autor; nunca UPDATE ni DELETE | PROPUESTA (M3) |
| **Plan** | Dato de plataforma (nombre único, estado ACTIVO/RETIRADO), sin precio | CONFIRMADA en su semántica (2026-11-16); construcción en M1 |
| **Versión de plan** | BORRADOR (a lo sumo uno) → PUBLICADA (inmutable); lleva techo de módulos y valores de perillas | PROPUESTA (M1) |
| **Asignación** | Fila que solo se agrega: empresa → versión, `aplicaDesde`, `origen`, motivo; la vigente es la de número mayor ya empezada | PROPUESTA (M1) |

Ciclo de vida de una perilla de empresa: nace en su base → la plataforma la ajusta (cada ajuste queda) → una baja **no toca lo ya creado**, solo impide crear lo nuevo (igual a Pedernal y a las reglas R-1/R-2 del plan de roles).

## 6. Nivel 5: invariantes y políticas

| # | Invariante | Estado |
|---|---|---|
| I-1 | Solo la plataforma cambia perillas; la empresa nunca (guardián `politica-de-empresa-solo-plataforma.test.ts`, a ampliar) | PROPUESTA (ya vigente para política) |
| I-2 | Nada de lo que la empresa ya tiene se borra ni se edita al bajar una perilla: se rechaza solo **crear o reactivar** | PROPUESTA (S13 de Pedernal; R-2 del plan de roles) |
| I-3 | Un cambio de perilla y su auditoría son **una transacción**; con `FOR UPDATE` de la empresa | PROPUESTA (ya así en `cambiarPoliticaDeEmpresa`) |
| I-4 | Los ajustes y las asignaciones **solo se agregan**; lo vigente se **calcula**, no se marca | PROPUESTA (Pedernal) |
| I-5 | Una versión publicada es inmutable (trigger en la base) | PROPUESTA (M1) |
| I-6 | Encender una perilla cuyo `requiere` está apagado se rechaza | PROPUESTA (Pedernal `PERILLA_REQUIERE_OTRA`) |
| I-7 | Falla cerrado: valor ilegible, tipo equivocado o ciclo en `requiere` → perilla apagada | PROPUESTA |
| I-8 | Aislamiento: las tablas de plataforma las escribe solo `motor2_plataforma`; la empresa lee solo lo suyo | PROPUESTA (patrón de `ModuloEmpresa`) |
| I-9 | El cambio deja constancia **también en el historial de la empresa afectada** (hoy no: Pedernal sí) | PROPUESTA / PENDIENTE (diferencia fila 9 de la auditoría) |
| I-10 | Sin dinero y sin precios en este frente | PROPUESTA |

### Dimensiones que cambian permisos/visibilidad (oráculo de combinaciones, regla 2026-10-28)
Perilla (cada una del catálogo) × valor (0, igual al uso, mayor; interruptor sí/no) × módulo activo/inactivo × `permisosEditables` × rol (de sistema/propio) × estado de la empresa. Tabla de reglas esperada **escrita aparte del código** y un test que recorre las combinaciones; guardián que falla si aparece una perilla o columna de política nueva sin declarar si afecta. P2 ya lo plantea para roles; este frente lo generaliza en M3.

## 7. Etapas (actualizadas con la decisión B)

| Etapa | Qué entra | Toca tablas | Estado |
|---|---|---|---|
| **P2 + P3 (ya aprobadas)** | Perilla de roles propios nacida en 0 (`Empresa.rolesPropiosMax`, la sube la plataforma empresa por empresa) y nombres «empleado»/«administrador». Diseño en `plan-roles-y-permisos-como-pedernal-2026-11-16.md`; este frente no lo reescribe. Es la perilla por empresa que el dueño pidió; **no espera a los planes** | 1 columna aditiva en `Empresa` | CONFIRMADA («como pedernal,» y «Sí, «Administrador»», 2026-11-16) |
| **P4 (nacen cerradas)** | Empresas NUEVAS: `permisosEditables` y `dosPaneles` en `false` al nacer (cambio del `DEFAULT` de las dos columnas y de la alta de empresa); las existentes no cambian. Con planes, la perilla pasa a derivarse del plan en M1/M3 | 2 columnas (solo `DEFAULT`, aditivo y reversible) | CONFIRMADA (2026-11-16) |
| **M1 (MÍNIMA)** | **Planes versionados sobre lo que ya hay:** `Plan` (código único, ACTIVO/RETIRADO, sin precio), `VersionDePlan` (BORRADOR → PUBLICADA inmutable; `modulos` = techo; `perillas` con el valor de cada perilla del catálogo), `PlanDeEmpresa` (asignación **solo inserción**, número consecutivo, `aplicaDesde`, motivo, autor). Catálogo de perillas **en código** (hoy con una sola: `rolesPropiosMax`, valor base 0; las demás entran cuando su frente la pida con verificador). Estado de módulo **efectivo** = obligatorios ∪ (activados ∩ techo ∩ disponibles); activado fuera del techo = **solo lectura**. Casos de plataforma: crear plan, guardar borrador, publicar versión, asignar plan (con clave de idempotencia y `FOR UPDATE`). **Backfill (S-M1-1):** un plan de transición «Actual» versión 1 con techo = todos los módulos vendibles disponibles, asignado a **toda empresa existente**, para que ninguna pierda un módulo al encender el techo | 3 tablas nuevas + datos de arranque por base | PROPUESTA; niveles 1-5 por confirmar |
| M2 | Consola: pantalla «Plan de la empresa» (plan actual y programado, módulos, perillas con su origen) y diálogo de cambio, con clave de idempotencia | ninguna | PENDIENTE |
| M3 | `AjusteDePerilla` (solo inserción): subir una perilla a **una** empresa sobre el valor de su plan; absorbe `rolesPropiosMax` (columna → perilla del catálogo) y las dos políticas booleanas | 1 tabla nueva | PENDIENTE |
| M4 | Constancia en el historial de la empresa afectada (I-9) y **segundo factor reciente** para casos sensibles | posible tabla/uso de `RegistroAuditoria` | PENDIENTE |
| M5+ | Perillas concretas de otros frentes: `recepcion_separada` y `conciliacion_de_tres_vias` (Compras, verificador propuesto en su PR #326), `cajas_por_sucursal` (Caja, PR #327, ámbito SUCURSAL) | ninguna tabla | PENDIENTE de cada frente |
| Fuera | Precios, cobro, soporte de solo lectura, pantalla de plan para el gerente | — | sugerencias no pedidas |
| Perilla futura con nombre | `carta_modelo_libro`: en Pedernal el modelo base de la carta es la Lista y fotos, Cuadrícula, Libro y estadísticas son extras de plan; el Libro es «el de Motor2» (ZuluHub-docs `10-ux-ui/03-experiencia-de-la-carta.md`, decisión del dueño de Pedernal 2026-10-13). Cuando haya perillas, el Libro podría pasar a ser un extra y la Lista la base. **Decisión del dueño de Motor2 (2026-11-16, vía @parent): «Libro para todos, como hoy (Recomendada)»: no cambia nada ahora; sin pedido del dueño no se construye** | — | NO PEDIDA (nota de diseño) |

**Por qué M1 no incluye `AjusteDePerilla`:** el dueño pidió planes versionados, y «subir la perilla empresa por empresa» ya tiene su vía barata (la columna de P2). El ajuste es la forma de Pedernal y llega en M3 cuando haya una segunda perilla que subir por empresa.

**Costo de migrar de la columna a ajuste (anotado, no oculto):** `rolesPropiosMax` pasa de columna a primer ajuste; migración de datos aditiva y reversible; la columna queda hasta retirarla.

**Riesgo propio de M1 (el más importante):** encender el techo sin backfill dejaría a toda empresa existente **solo con los módulos obligatorios**. Por eso el backfill va **en la misma migración** que las tablas, con `verificacion-previa.sql` (cuántas empresas y qué módulos tiene cada una hoy; el techo del plan de transición debe contener todos) y autorización expresa por base.

## 8. Diferencias con Pedernal (declaradas con motivo)

| # | Tema | Pedernal | Motor2 (propuesta) | Motivo |
|---|---|---|---|---|
| D-1 | Dónde viven las perillas en P2 | catálogo + `ajuste_de_perilla` | columna en `Empresa` | Primero lo más barato; Pedernal tampoco construyó la perilla de roles; se convierte en M3 |
| D-2 | Semántica del plan | techo + versiones inmutables; los módulos los activa la plataforma dentro del techo | **Igual a Pedernal** (decisión del dueño 2026-11-16). **ADR-013 queda superado en esto**: ya no «genera filas» ni es «foto» con «reaplicar»; se actualiza o se anota en un PR propio al construir M1 | CONFIRMADA |
| D-3 | Valores base de `permisosEditables`/`dosPaneles` | n/a (NV) | empresas nuevas: `false`; existentes: sin cambio | Decisión del dueño («Sí, nacen cerradas (Recomendada)», 2026-11-16). **Implica cambiar el `DEFAULT` de las dos columnas y la alta de empresa** (`sembrar-empresa.ts`); no reescribe datos existentes. Toca el golden `huella-de-gobierno` y el e2e de alta (zona restringida: se pide por turno). Detalle de etapa en §7 (P4) | CONFIRMADA |
| D-4 | Constancia en la empresa | `auditoria_empresa` por empresa | solo `AuditoriaPlataforma` | Hoy sin motivo; M4 |
| D-5 | Idempotencia de la consola | tabla con clave y huella | estado («ya estaba así») | Basta para dos booleanos; con ajustes que **agregan filas** (M3) hace falta la clave (si no, repetir duplica) |
| D-6 | Prisma | SQL propio, triggers | Prisma + SQL a mano en la migración (`CHECK`, trigger de solo inserción, RLS), como `ModuloEmpresa` | Lo impone Prisma |
| D-8 | Nombre de la columna de «desde cuándo aplica» la asignación | `vigente_desde` | `aplicaDesde` | Motor2 retiró la palabra «vigencia» del código por decisión del dueño (la vigencia de promos, 2026-10-20; lo vigila `retirados-por-decision-del-duenio.test.tsx`); mismo resultado y misma forma, otro nombre | CONFIRMADA (decisión previa del dueño) |
| D-7 | Perfiles `completo`/`lite` | no existen | atajos | Candidatos a poda cuando haya planes (aviso al dueño) |

## 9. Nivel 7 (adelanto de lo que importa) — «¿qué pasa si…?» por comando

Comandos: **A** cambiar plan (M1) · **B** subir/bajar perilla (P2/M3) · **C** versionar plan (M1) · **D** cambiar permisos del actor.

| Situación | A. Cambio de plan | B. Subir/bajar perilla | C. Publicar versión | D. Permisos |
|---|---|---|---|---|
| **Repetición** | Misma clave + misma entrada = mismo resultado, sin escribir; misma clave + otra entrada → rechazo | P2: «sin cambios» (valor igual). M3: **clave de idempotencia obligatoria**, si no cada clic agrega una fila | Publicar dos veces: la segunda ve `numero` ya tomado y no duplica | — |
| **Concurrencia** | `FOR UPDATE` de la empresa + `numeroEsperado`: el segundo recibe «otro decidió antes» y relee | `FOR UPDATE` de la empresa (ya existe): el segundo lee el valor que dejó el primero; el `antes` auditado es cierto | Único `(plan, numero)`: gana una | Se evalúa en cada acción |
| **Tiempo** | Vigencia **futura** nunca retroactiva; la programada se puede reemplazar solo con confirmación | Rige en la **acción siguiente** (sin caché) | Publicada = congelada para siempre | Sesión de plataforma de 8 h, 30 min de inactividad |
| **Incertidumbre** | Si no se sabe si el cambio entró: reintentar con la misma clave es seguro | Reintentar es seguro (P2 estado; M3 clave) | Releer versión antes de reintentar | — |
| **Reintento** | Idempotente por clave | Idempotente | Idempotente | — |
| **Error parcial** | Todo (plan, módulos, auditoría, clave) en **una** transacción; nada a medias | Valor + auditoría en una transacción (ya así) | Versión + auditoría en una transacción | — |
| **Datos faltantes** | Empresa sin plan: solo valen módulos obligatorios y bases (falla cerrado) | Empresa inexistente: error claro; empresa en baja (DELETING): se rechaza | Perilla fuera de catálogo: se rechaza | Actor sin TOTP vigente: se rechaza |
| **Cambio de permisos** | Una baja de plan **no** borra ni edita lo creado; deja módulos en solo lectura | Bajar el tope no desactiva roles ni nada: solo bloquea **crear y reactivar** | Un gerente con sesión abierta ve el cambio en su operación siguiente | Quitarle `gestion_roles` al gerente lo corta en la operación siguiente; la plataforma no depende de roles de empresa |

## 10. Preguntas al dueño (una por vez; solo las que cambian modelo de datos o permisos)

**Respondidas:** (1) «Planes con versiones desde el inicio, como Pedernal» (2026-11-16, ver arriba). (2) «Sí, nacen cerradas (Recomendada)» (2026-11-16): las empresas NUEVAS nacen con la edición de permisos y los dos paneles cerrados y la plataforma los abre cuando corresponde; las existentes no cambian.

**Siguiente (q3, la hace el orquestador general, redactada para quien no programa):** cuando la plataforma le cambia a una empresa el plan o una opción (por ejemplo, le abre los roles propios), hoy eso queda anotado solo en el registro interno de la plataforma. ¿Querés que la propia empresa también lo vea en su historial («la plataforma cambió tu plan el día tal, motivo tal»)? Cambia qué datos se guardan y quién los ve.

**En cola, después (q4):** el plan de transición «Actual» de M1 ¿incluye todos los módulos que existen o solo los que cada empresa tiene hoy? (cambia qué ve cada cliente; recomendación: **solo los que tiene hoy**, para no darle nada que no usaba, y un plan por tipo de cliente después).

## 11. Carril de escritura (Fase 2; ahora no se escribe nada)

| Ruta | Para qué |
|---|---|
| `plataforma/**` (toda la consola) | pantallas y servidor de plan/perillas |
| `src/server/operaciones-de-plataforma/**` | casos de plataforma (cambiar política/módulos/plan/ajuste) |
| `src/core/features/empresa/cambio-de-politica.ts`, `src/core/permisos/politica-de-empresa.ts`, `src/server/acceso/politica-de-empresa.ts` | política y perfiles |
| `src/core/modulos/**` | catálogo de módulos y clausura (solo si el dueño pide un módulo nuevo; nada hoy) |
| nuevas: `src/core/planes/**` (catálogo de perillas, resolutor puro, vigencia), `src/server/acceso/derechos-de-uso*.ts` | M1/M3 |
| `scripts/politica-empresa.ts`, `scripts/modulos-empresa.ts`, `scripts/plataforma/**`, nuevo `scripts/ajuste-de-perilla.ts` | comandos de plataforma |
| P2/P3 (ya planificadas): `src/server/actions/permisos/casos-de-uso/crear-rol.ts`, `actualizar-activo-rol.ts`, `src/core/permisos/roles-de-fabrica.ts`, `src/core/permisos/nombres-de-rol.ts`, `prisma/seed.ts` (solo el nombre) | roles propios y nombres |
| `prisma/schema.prisma`: **solo** `Empresa` (las columnas de política), `ModuloEmpresa`, `AuditoriaPlataforma` y los modelos nuevos `AjusteDePerilla`, `Plan`, `VersionDePlan`, `PlanDeEmpresa` | datos |
| `docs/diseno-planes-y-perillas-*`, `docs/auditoria-planes-y-perillas-*` | documentos |
| Tests: `test/plataforma/**`, `test/permisos/` (solo lo de roles propios), `test/arquitectura/politica-de-empresa-solo-plataforma.test.ts`, tests nuevos de planes | pruebas |

**Zona restringida (se pide al orquestador general, no se toca):** `src/core/permisos/acciones.ts` y matrices, `src/core/textos/*`, `docs/registro-de-decisiones.md`, `package.json`, `.dependency-cruiser*`, `knip.jsonc`, numeración de migraciones, `test/modulos/__golden__/*`, `test/arquitectura/caracterizaciones-congeladas.test.ts` (el golden `huella-de-gobierno` nombra `permisosEditables`/`dosPaneles`: **sumar una columna a `Empresa` lo cambia**), `.github/**`. **`Empresa`** es modelo compartido: edito solo mis columnas y aviso.

## 12. Dependencias con otros frentes y corrientes

| Con | Qué necesito / ofrezco | Estado |
|---|---|---|
| **5 Compras** | Ofrezco: una perilla INTERRUPTOR por nivel (N3 recepción separada, N4 tres vías, orden de compra dentro de N4) **cuando el frente la pida** con su regla verificable. Hecho clave: en Pedernal esas perillas **no están declaradas** y el nivel se rechaza siempre; igualar es declararlas con su verificador, no copiar una perilla que no existe | PROPUESTA; pedir a 5 la lista de perillas y quién las verifica |
| **1 Caja** | Pedernal tiene `cajas_por_sucursal` (LIMITE 1, ámbito SUCURSAL, tope al crear **y al reactivar**). Si 1 diseña caja múltiple, la perilla es suya de pedir; el ámbito SUCURSAL no existe en Motor2 y sería parte de M3 | NO VERIFICADA la necesidad |
| **2 Unidades** | Pedernal gatea fracciones y peso con `venta_por_fracciones_y_peso` (apagada). Motor2 ya vende fraccionado sin perilla: **no se la agrego** salvo que 2 la pida | NO VERIFICADA |
| **3 Datos** | Mis tablas nuevas (M1/M3) seguirán su contrato: fechas con zona horaria, ids que genera la aplicación, «no se borra» desde la base, lista de permitidos. Les pido el contrato para que no haya que rehacerlas | pedir |
| **6 Pantallas** | Solo si algún día se pide la pantalla «Plan y módulos» del gerente (ADR-013 §4): sería suya; yo ofrezco la lectura | sugerencia no pedida |
| **Roles P1 (Parte)** | P2 y P3 no tocan `acciones.ts` ni la matriz de Parte; coordinar `crear-rol.ts` y el orden de migraciones | aviso |
| **Ocultar** | Sin cruce (no usa perillas de plan) | — |
| **Textos** | Mi consola tiene sus textos en `plataforma/src/app/**/textos.ts`; si el catálogo T1 debe absorberlos, lo pide Textos | NO VERIFICADA |

## 13. Qué entra al producto (aceptación del dueño)

Nada nuevo entra con este documento. Lo que se construirá en P2 ya tiene cita (§0). Los planes versionados (M1) tienen el pedido citado en la actualización del encabezado; el resto (M2 a M5+) va **sin aceptación**. Nada se construye hasta que el dueño confirme los niveles 1 a 5 (§2 a §6) y conteste la siguiente pregunta de §10.

## 14. Niveles 6 a 10 (solo esbozo; la compuerta prohíbe diseñar tablas sin 1 a 5 confirmados)

- **6 Historia y persistencia:** ajustes y asignaciones solo se agregan; versión publicada inmutable; todo con fecha en UTC con zona, id generado por la aplicación (contrato del frente 3). **No se diseña el SQL todavía.**
- **7 Atomicidad:** §9. **8 Acceso:** solo plataforma escribe; la app lee. **9 Consultas:** perilla efectiva con su origen. **10 Pruebas:** oráculo de combinaciones (§6), concurrencia (dos cambios a la vez sobre la misma empresa, uno gana y el otro lee el nuevo estado), idempotencia (mismo cambio con la misma clave, 0 filas nuevas), migración aplicada y revertida sobre base temporal, y el gate de 8 comandos en la misma corrida.

## 15. Verificación final prevista (Fase 2, no ahora)
`npx tsc --noEmit` · `npm run lint` · `npm run arquitectura` · `npm run analizar:muerto` (0) · `npm test` · `npm run build` · `npm run plataforma:build` · `npm run test:e2e` — los 8 limpios en la misma corrida. En Fase 1 no se corrió nada: solo lectura.

## 16. Honestidad: qué no sé
Ver §5 de la auditoría. Además: no verifiqué si Pedernal tiene un equivalente de `permisosEditables`/`dosPaneles`; no medí cuántos tests dependen del golden `huella-de-gobierno`; no sé si Compras, Caja o Unidades van a pedir perillas (lo deciden sus propios pedidos).
