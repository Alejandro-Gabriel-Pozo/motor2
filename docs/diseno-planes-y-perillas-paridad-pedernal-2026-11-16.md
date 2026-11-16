# Diseño: planes y perillas como Pedernal (Fase 1, solo documento, 2026-11-16)

> **No cambia código, migraciones, permisos ni textos.** Frente 4 del programa de paridad. Auditoría de base: `docs/auditoria-planes-y-perillas-vs-pedernal-2026-11-16.md`. Roles propios y «Empleado»/«Administrador» ya tienen plan: `docs/plan-roles-y-permisos-como-pedernal-2026-11-16.md` (P2 y P3, **no se rehacen acá**).
> Estados: CONFIRMADA (dicha por el dueño, con cita y fecha) · PROPUESTA · PENDIENTE · NO VERIFICADA.

## 0. Pedido del dueño (citas)

- «Las unidades de clasificación, el tema de datos, planes y perillas. Sí, eso tiene que ver con la plataforma.» — 2026-11-16 — `motor2-docs`, `seguimiento-de-pedernal/decisiones-del-dueno-2026-11-14-mesa-resend-contador.md`, sección «Paridad con Pedernal: qué falta y cómo se trabaja».
- «Necesitamos ser iguales [a Pedernal] en todo… El resultado tiene que ser el mismo y sobre todo de las mismas formas, salvo porque nosotros usamos Prisma.» — 2026-11-13 — regla «Paridad con Pedernal» de `AGENTS.md`.
- «como pedernal,» (a la perilla de roles propios nacida en 0, a Parte y a «Empleado») — 2026-11-16 — misma fuente, línea 340.
- «Sí, «Administrador» (Recomendada)» — 2026-11-16 — misma fuente, línea 347.

## 1. Resumen y recomendación

1. **Hoy Motor2 no tiene planes ni perillas tipadas**: tiene módulos por empresa (completos y auditados), dos booleanos de política (`permisosEditables`, `dosPaneles`), una columna `llevaIvaDeCompras` sin lector y un ADR-013 (planes) decidido y nunca construido. Pedernal tiene catálogo de perillas en código, planes con versiones inmutables, ajustes por empresa que solo se agregan y consola con «cambiar plan».
2. **La forma más barata de empezar a usar algo** es la que ya está planificada: **P2** (perilla `rolesPropiosMax` nacida en 0, columna en `Empresa`, la cambia la plataforma por el script existente) y **P3** (nombres visibles). No hace falta ninguna tabla nueva para eso. Esta etapa mínima se declara abajo (§7) y **no agrega nada que el dueño no pidió**.
3. **Los planes con versiones, los ajustes por empresa y la pantalla de plan son etapas con nombre** (E1 a E4), que **no se migran** hasta que el dueño confirme los niveles 1 a 5 (§2 a §6) y conteste la pregunta de §10.
4. **Dos hallazgos que cambian cómo se iguala**: (a) Pedernal **no tiene** `roles_propios_por_empresa` ni las perillas de compras N3/N4 en el código (solo en documentos), así que se iguala el **diseño**, no un comportamiento que exista; (b) **ADR-013 contradice a Pedernal** en la semántica del plan (genera filas vs. techo con versiones inmutables). Esa diferencia hay que cerrarla con el dueño antes de E2.

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
| C1 | Subir o bajar una perilla de una empresa (hoy: `rolesPropiosMax`, `permisosEditables`, `dosPaneles`) | plataforma | **E0** (script existente, ampliado) |
| C2 | Una acción de la empresa pregunta si la perilla lo permite (crear rol, etc.) y se rechaza con el texto ya existente | sistema | **E0** |
| C3 | Cambiar un perfil (`completo`/`lite`) | plataforma | existe; se reevalúa en E2 |
| C4 | Registrar un **ajuste** de perilla con motivo y vigencia, sin pisar el anterior | plataforma | E1 |
| C5 | Crear plan, guardar borrador, publicar versión inmutable | plataforma | E2 |
| C6 | Asignar plan a una empresa (con vigencia futura, reemplazar una decisión programada) | plataforma | E2 |
| C7 | Ver plan, módulos y perillas con su origen (base / plan / ajuste) | plataforma | E3 |
| C8 | Ver la propia política y límites | gerente | sugerencia, no pedida |
| C9 | Precios y cobro | — | fuera de alcance |

## 5. Nivel 4: conceptos y ciclo de vida

| Concepto | Definición propuesta (igual a Pedernal, adaptada a Prisma) | Estado |
|---|---|---|
| **Perilla** | Elemento de un **catálogo cerrado en código** (`src/core/…`): id, tipo (**INTERRUPTOR** o **LIMITE**, nada más), valor base, ámbito (EMPRESA, SUCURSAL), módulo, `requiere`. La base no conoce el catálogo. Regla heredada: **una perilla que nadie verifica no se declara** | PROPUESTA (forma de Pedernal; `perillas.ts:9-144`) |
| **Valor de base** | Todo nace apagado / en 0 (`rolesPropiosMax = 0`); `permisosEditables` y `dosPaneles` nacen en `true` **por compatibilidad con empresas existentes** y es una diferencia declarada con «Todo nace cerrado» (§8, D-3) | PROPUESTA; NO VERIFICADA su aceptación por el dueño |
| **Perilla efectiva** | Cálculo puro: ajuste vigente más específico > valor del plan > base; luego `requiere` (falla cerrado) | PROPUESTA (E1+); en E0 es la columna |
| **Ajuste** | Fila que **solo se agrega** (serie numerada por empresa y perilla), con `motivo`, `vigenteDesde`, autor; nunca UPDATE ni DELETE | PROPUESTA (E1) |
| **Plan** | Dato de plataforma (nombre único, estado ACTIVO/RETIRADO), sin precio | PROPUESTA (E2); **semántica PENDIENTE** (pregunta de §10) |
| **Versión de plan** | BORRADOR (a lo sumo uno) → PUBLICADA (inmutable); lleva techo de módulos y valores de perillas | PROPUESTA (E2) |
| **Asignación** | Fila que solo se agrega: empresa → versión, `vigenteDesde`, `origen`, motivo; la vigente es la de número mayor ya empezada | PROPUESTA (E2) |

Ciclo de vida de una perilla de empresa: nace en su base → la plataforma la ajusta (cada ajuste queda) → una baja **no toca lo ya creado**, solo impide crear lo nuevo (igual a Pedernal y a las reglas R-1/R-2 del plan de roles).

## 6. Nivel 5: invariantes y políticas

| # | Invariante | Estado |
|---|---|---|
| I-1 | Solo la plataforma cambia perillas; la empresa nunca (guardián `politica-de-empresa-solo-plataforma.test.ts`, a ampliar) | PROPUESTA (ya vigente para política) |
| I-2 | Nada de lo que la empresa ya tiene se borra ni se edita al bajar una perilla: se rechaza solo **crear o reactivar** | PROPUESTA (S13 de Pedernal; R-2 del plan de roles) |
| I-3 | Un cambio de perilla y su auditoría son **una transacción**; con `FOR UPDATE` de la empresa | PROPUESTA (ya así en `cambiarPoliticaDeEmpresa`) |
| I-4 | Los ajustes y las asignaciones **solo se agregan**; lo vigente se **calcula**, no se marca | PROPUESTA (Pedernal) |
| I-5 | Una versión publicada es inmutable (trigger en la base) | PROPUESTA (E2) |
| I-6 | Encender una perilla cuyo `requiere` está apagado se rechaza | PROPUESTA (Pedernal `PERILLA_REQUIERE_OTRA`) |
| I-7 | Falla cerrado: valor ilegible, tipo equivocado o ciclo en `requiere` → perilla apagada | PROPUESTA |
| I-8 | Aislamiento: las tablas de plataforma las escribe solo `motor2_plataforma`; la empresa lee solo lo suyo | PROPUESTA (patrón de `ModuloEmpresa`) |
| I-9 | El cambio deja constancia **también en el historial de la empresa afectada** (hoy no: Pedernal sí) | PROPUESTA / PENDIENTE (diferencia fila 9 de la auditoría) |
| I-10 | Sin dinero y sin precios en este frente | PROPUESTA |

### Dimensiones que cambian permisos/visibilidad (oráculo de combinaciones, regla 2026-10-28)
Perilla (cada una del catálogo) × valor (0, igual al uso, mayor; interruptor sí/no) × módulo activo/inactivo × `permisosEditables` × rol (de sistema/propio) × estado de la empresa. Tabla de reglas esperada **escrita aparte del código** y un test que recorre las combinaciones; guardián que falla si aparece una perilla o columna de política nueva sin declarar si afecta. P2 ya lo plantea para roles; este frente lo generaliza en E1.

## 7. Etapas

| Etapa | Qué entra | Toca tablas | Estado |
|---|---|---|---|
| **E0 (MÍNIMA)** | P2: columna `Empresa.rolesPropiosMax INTEGER NOT NULL DEFAULT 0 CHECK (>= 0)`, `PoliticaDeEmpresa.rolesPropiosMax`, `--roles-propios-max N` en `scripts/politica-empresa.ts`, helper puro y regla en crear/reactivar rol con `FOR UPDATE` (ya diseñado en el plan de roles §4). P3: nombre visible «empleado»/«administrador» (dato + semilla, ya diseñado §3). **Una columna, cero tablas nuevas.** Se reutiliza el plan existente; este frente no lo reescribe | solo `Empresa` (1 columna aditiva) | PROPUESTA (el plan ya tiene el «como pedernal,» del dueño) |
| E1 | Catálogo de perillas en código + tabla `AjusteDePerilla` (solo inserción) + resolutor puro + guardián de dimensiones. Migra `rolesPropiosMax` (y las otras dos políticas) de columna a perilla del catálogo | `AjusteDePerilla` (nueva) | PENDIENTE de niveles 1-5 y de la pregunta §10 |
| E2 | `Plan`, `VersionDePlan` (inmutable), `PlanDeEmpresa` (asignación solo inserción), techo de módulos y estado «solo lectura» | 3 tablas nuevas | PENDIENTE (semántica ADR-013 vs Pedernal) |
| E3 | Consola: pantalla «Plan de la empresa» (ver plan, módulos, perillas con origen) y diálogo de cambio, con clave de idempotencia | ninguna | PENDIENTE |
| E4 | Constancia en el historial de la empresa afectada (I-9) y **segundo factor reciente** para casos sensibles | posible tabla/uso de `RegistroAuditoria` | PENDIENTE |
| Fuera | Precios, cobro, soporte de solo lectura, pantalla de plan para el gerente | — | sugerencias no pedidas |

**Por qué no saltar a E1/E2 ya:** (a) cada perilla es un renglón del producto y hoy solo hay una pedida (roles propios); (b) una columna por perilla se paga en una migración **cuando aparezca la segunda o tercera** perilla (§10 lo pregunta); (c) «primero la opción más barata» (regla 2026-10-27).

**Costo de migrar de E0 a E1 (anotado, no oculto):** `rolesPropiosMax` pasa de columna a ajuste; es una migración de datos aditiva (copiar el valor como primer ajuste) y la columna queda hasta retirarla. Es la razón de la pregunta de §10.

## 8. Diferencias con Pedernal (declaradas con motivo)

| # | Tema | Pedernal | Motor2 (propuesta) | Motivo |
|---|---|---|---|---|
| D-1 | Dónde viven las perillas en E0 | catálogo + `ajuste_de_perilla` | columna en `Empresa` | Primero lo más barato; Pedernal tampoco construyó la perilla de roles; se convierte en E1 |
| D-2 | Semántica del plan | techo + versiones inmutables, módulos los activa la plataforma | ADR-013: «genera filas» + «foto»/«reaplicar» | **Sin motivo vigente**: ADR-013 es anterior a la paridad; se resuelve en §10 y E2 |
| D-3 | Valores base de `permisosEditables`/`dosPaneles` | n/a (NV) | `true` | Empresas existentes dependen de ello (DATOS existentes); **choca con «Todo nace cerrado»**: PENDIENTE del dueño si las empresas nuevas deben nacer cerradas |
| D-4 | Constancia en la empresa | `auditoria_empresa` por empresa | solo `AuditoriaPlataforma` | Hoy sin motivo; E4 |
| D-5 | Idempotencia de la consola | tabla con clave y huella | estado («ya estaba así») | Basta para dos booleanos; con ajustes que **agregan filas** (E1) hace falta la clave (si no, repetir duplica) |
| D-6 | Prisma | SQL propio, triggers | Prisma + SQL a mano en la migración (`CHECK`, trigger de solo inserción, RLS), como `ModuloEmpresa` | Lo impone Prisma |
| D-7 | Perfiles `completo`/`lite` | no existen | atajos | Candidatos a poda cuando haya planes (aviso al dueño) |

## 9. Nivel 7 (adelanto de lo que importa) — «¿qué pasa si…?» por comando

Comandos: **A** cambiar plan (E2) · **B** subir/bajar perilla (E0/E1) · **C** versionar plan (E2) · **D** cambiar permisos del actor.

| Situación | A. Cambio de plan | B. Subir/bajar perilla | C. Publicar versión | D. Permisos |
|---|---|---|---|---|
| **Repetición** | Misma clave + misma entrada = mismo resultado, sin escribir; misma clave + otra entrada → rechazo | E0: «sin cambios» (valor igual). E1: **clave de idempotencia obligatoria**, si no cada clic agrega una fila | Publicar dos veces: la segunda ve `numero` ya tomado y no duplica | — |
| **Concurrencia** | `FOR UPDATE` de la empresa + `numeroEsperado`: el segundo recibe «otro decidió antes» y relee | `FOR UPDATE` de la empresa (ya existe): el segundo lee el valor que dejó el primero; el `antes` auditado es cierto | Único `(plan, numero)`: gana una | Se evalúa en cada acción |
| **Tiempo** | Vigencia **futura** nunca retroactiva; la programada se puede reemplazar solo con confirmación | Rige en la **acción siguiente** (sin caché) | Publicada = congelada para siempre | Sesión de plataforma de 8 h, 30 min de inactividad |
| **Incertidumbre** | Si no se sabe si el cambio entró: reintentar con la misma clave es seguro | Reintentar es seguro (E0 estado; E1 clave) | Releer versión antes de reintentar | — |
| **Reintento** | Idempotente por clave | Idempotente | Idempotente | — |
| **Error parcial** | Todo (plan, módulos, auditoría, clave) en **una** transacción; nada a medias | Valor + auditoría en una transacción (ya así) | Versión + auditoría en una transacción | — |
| **Datos faltantes** | Empresa sin plan: solo valen módulos obligatorios y bases (falla cerrado) | Empresa inexistente: error claro; empresa en baja (DELETING): se rechaza | Perilla fuera de catálogo: se rechaza | Actor sin TOTP vigente: se rechaza |
| **Cambio de permisos** | Una baja de plan **no** borra ni edita lo creado; deja módulos en solo lectura | Bajar el tope no desactiva roles ni nada: solo bloquea **crear y reactivar** | Un gerente con sesión abierta ve el cambio en su operación siguiente | Quitarle `gestion_roles` al gerente lo corta en la operación siguiente; la plataforma no depende de roles de empresa |

## 10. Pregunta al dueño (UNA, cambia modelo de datos)

**Pregunta 1 (modelo de datos).** Hoy Motor2 le da a cada empresa sus módulos uno por uno y tiene solo tres interruptores de política. Pedernal agrupa lo que puede usar cada cliente en **planes** (con versiones que no se pisan) y sube las funciones de a una con **perillas**. Lo mínimo ya aprobado («como pedernal,») es la perilla de roles propios en 0 y los nombres «Empleado» y «Administrador». Para lo que sigue, ¿qué prefiere?
- **(A) Recomendada:** primero las **perillas por empresa** (una tabla de ajustes con motivo y fecha, sin planes todavía) y los **planes después**, cuando haya más de un tipo de cliente. Es más barato y no obliga a decidir hoy la forma del plan.
- (B) Planes con versiones desde el principio, igual que Pedernal.
- (C) Dejar por ahora solo la perilla de roles propios (E0) y no construir nada más hasta que la pida otro frente.

Preguntas **en cola, no hechas** (cuando toque, una por vez): (q2) ¿las empresas **nuevas** de Motor2 deben nacer con `permisosEditables`/`dosPaneles` en cerrado (cambia permisos)? (q3) ¿la empresa debe ver en su historial que la plataforma le cambió una perilla (D-4)? (q4) ¿qué perillas piden Caja, Unidades y Compras? (esas las contestan los otros frentes con su propio pedido, no yo).

## 11. Carril de escritura (Fase 2; ahora no se escribe nada)

| Ruta | Para qué |
|---|---|
| `plataforma/**` (toda la consola) | pantallas y servidor de plan/perillas |
| `src/server/operaciones-de-plataforma/**` | casos de plataforma (cambiar política/módulos/plan/ajuste) |
| `src/core/features/empresa/cambio-de-politica.ts`, `src/core/permisos/politica-de-empresa.ts`, `src/server/acceso/politica-de-empresa.ts` | política y perfiles |
| `src/core/modulos/**` | catálogo de módulos y clausura (solo si el dueño pide un módulo nuevo; nada hoy) |
| nuevas: `src/core/planes/**` (catálogo de perillas, resolutor puro, vigencia), `src/server/acceso/derechos-de-uso*.ts` | E1/E2 |
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
| **1 Caja** | Pedernal tiene `cajas_por_sucursal` (LIMITE 1, ámbito SUCURSAL, tope al crear **y al reactivar**). Si 1 diseña caja múltiple, la perilla es suya de pedir; el ámbito SUCURSAL no existe en Motor2 y sería parte de E1 | NO VERIFICADA la necesidad |
| **2 Unidades** | Pedernal gatea fracciones y peso con `venta_por_fracciones_y_peso` (apagada). Motor2 ya vende fraccionado sin perilla: **no se la agrego** salvo que 2 la pida | NO VERIFICADA |
| **3 Datos** | Mis tablas nuevas (E1/E2) seguirán su contrato: fechas con zona horaria, ids que genera la aplicación, «no se borra» desde la base, lista de permitidos. Les pido el contrato para que no haya que rehacerlas | pedir |
| **6 Pantallas** | Solo si algún día se pide la pantalla «Plan y módulos» del gerente (ADR-013 §4): sería suya; yo ofrezco la lectura | sugerencia no pedida |
| **Roles P1 (Parte)** | P2 y P3 no tocan `acciones.ts` ni la matriz de Parte; coordinar `crear-rol.ts` y el orden de migraciones | aviso |
| **Ocultar** | Sin cruce (no usa perillas de plan) | — |
| **Textos** | Mi consola tiene sus textos en `plataforma/src/app/**/textos.ts`; si el catálogo T1 debe absorberlos, lo pide Textos | NO VERIFICADA |

## 13. Qué entra al producto (aceptación del dueño)

Nada nuevo entra con este documento. Lo que se construirá en E0 ya tiene cita (§0). Todo lo demás (E1 a E4) va **sin aceptación**: no se construye hasta que el dueño conteste §10 y confirme los niveles 1 a 5.

## 14. Niveles 6 a 10 (solo esbozo; la compuerta prohíbe diseñar tablas sin 1 a 5 confirmados)

- **6 Historia y persistencia:** ajustes y asignaciones solo se agregan; versión publicada inmutable; todo con fecha en UTC con zona, id generado por la aplicación (contrato del frente 3). **No se diseña el SQL todavía.**
- **7 Atomicidad:** §9. **8 Acceso:** solo plataforma escribe; la app lee. **9 Consultas:** perilla efectiva con su origen. **10 Pruebas:** oráculo de combinaciones (§6), concurrencia (dos cambios a la vez sobre la misma empresa, uno gana y el otro lee el nuevo estado), idempotencia (mismo cambio con la misma clave, 0 filas nuevas), migración aplicada y revertida sobre base temporal, y el gate de 8 comandos en la misma corrida.

## 15. Verificación final prevista (Fase 2, no ahora)
`npx tsc --noEmit` · `npm run lint` · `npm run arquitectura` · `npm run analizar:muerto` (0) · `npm test` · `npm run build` · `npm run plataforma:build` · `npm run test:e2e` — los 8 limpios en la misma corrida. En Fase 1 no se corrió nada: solo lectura.

## 16. Honestidad: qué no sé
Ver §5 de la auditoría. Además: no verifiqué si Pedernal tiene un equivalente de `permisosEditables`/`dosPaneles`; no medí cuántos tests dependen del golden `huella-de-gobierno`; no sé si Compras, Caja o Unidades van a pedir perillas (lo deciden sus propios pedidos).
