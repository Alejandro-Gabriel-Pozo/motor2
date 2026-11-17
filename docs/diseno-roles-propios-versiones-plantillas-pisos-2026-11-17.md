# Diseño: roles propios con versiones inmutables, plantillas de rol y pisos de plataforma, como Pedernal 0061 (etapa E-B/E-D, 2026-11-17)

> **Solo un documento.** No cambia código, pruebas, migraciones, permisos ni textos. Frente 4 (planes y perillas). Etapa **posterior** a M1 (planes, ya en `main`), P2 (perilla de roles propios), P3 (nombres visibles) y P4 (empresas nuevas nacen cerradas): **no se construye antes de que entren en ese orden**.
> **Pedido del dueño (2026-11-17, literal, relatado por el orquestador general; no lo leí en su fuente):** «Sí, como Pedernal, etapa posterior (Recomendada)» a «¿Motor2 también lo tiene como Pedernal (roles propios con versiones inmutables, plantillas de rol de origen y pisos de plataforma, 0061), como etapa posterior a P2, P3 y P4?». Regla de paridad (2026-11-13): «Necesitamos ser iguales [a Pedernal] en todo… El resultado tiene que ser el mismo y sobre todo de las mismas formas, salvo porque nosotros usamos Prisma.»
> **Qué leí.** Pedernal: `ZuluHub-docs` `11-especificaciones/sql-pendientes-otros-modulos/0061_permisos_configurables.sql` (759 líneas, completo en sus partes estructurales: cabecera, validadores, 6 tablas, disparadores, semilla; **no leí** las políticas de RLS ni los privilegios de las líneas 330-759 ni la reversión) y `h4b-permisos-configurables.md` (índice y lo citado por la auditoría previa). Motor2: `docs/auditoria-roles-y-permisos-vs-pedernal-2026-11-16.md` (base de la comparación; verificada contra el código de `main` e1a83d03 por su autor) y el catálogo `src/core/permisos/acciones.ts` (133 claves planas en `snake_case`, la más larga con 33 caracteres; cuenta mía por patrón, NO VERIFICADA contra el catálogo completo).
> Estados: CONFIRMADA (cita del dueño) · PROPUESTA · PENDIENTE · NO VERIFICADA.

## 0. Resumen

1. **Qué es.** Hoy en Motor2 un rol propio es una fila de `Rol` con `clave` nula más una matriz editable de `PermisoRol` («Ver / Editar» por acción); los pisos son 4 niveles escritos en el código (ADR-027); no hay plantillas ni versiones. En Pedernal (0061) hay **seis tablas**: tres plantillas base (`GERENTE`, `ADMINISTRADOR`, `OPERADOR`) con listas de acciones versionadas, un **piso** por acción fijado solo por la plataforma (`SOLO_GERENTE` o `TODOS_LOS_ROLES`), las acciones ya introducidas, el **rol propio** de la empresa y sus **versiones inmutables** (lista de acciones, número siguiente al mayor).
2. **Hallazgo que condiciona todo:** el piso de Motor2 es por **nivel** (operario, administrador, administrador de sistema, gerente) y decide quién alcanza qué; el de Pedernal es por **acción** y solo tiene dos valores. Igualar «como Pedernal» obliga a decidir qué pasa con los niveles de ADR-027 y con el «Encargado» (un rol de rango intermedio): es **la pregunta al dueño de §10**, porque cambia permisos.
3. **Diferencia de método declarada:** Pedernal creó las 6 tablas **antes** de usarlas («NO SE LEE TODAVÍA», tramo T1). Motor2 tiene la regla del dueño «nada de tablas a ciegas que nadie escribe»: cada tabla se migra **con quien la escribe** en la misma etapa (§7).
4. **Qué NO cambia hoy:** el guard (`decision-de-acceso.ts`) y la matriz siguen igual hasta que una etapa los conecte; este documento no toca nada.

## 1. Nivel 1: propósito y alcance

| # | Decisión | Estado |
|---|---|---|
| 1.1 | Propósito: que el **gerente** arme roles propios (copiando una plantilla o vacíos) **dentro de pisos que fija solo la plataforma**, con cada cambio como versión inmutable; y que la **plataforma** edite las plantillas de `ADMINISTRADOR` y `OPERADOR` y los pisos | CONFIRMADA («Sí, como Pedernal, etapa posterior (Recomendada)», 2026-11-17) en su intención; el detalle de §3 a §6 es PROPUESTA |
| 1.2 | Alcance de esta etapa: las 6 tablas equivalentes, sus escritores (consola de plataforma para plantillas y pisos; pantalla del gerente para roles propios) y la conexión al guard. **Fuera:** precios, planes (M1 ya existe), cualquier acción nueva del catálogo | PROPUESTA |
| 1.3 | Necesidad que resuelve: «como Pedernal» (el dueño, 2026-11-17). **Ninguna necesidad operativa propia está escrita hoy** (la auditoría del 2026-11-16 anotó que el cliente actual cargó solo productos y carta): por eso va como etapa posterior y no antes de P2 a P4 | PROPUESTA |
| 1.4 | Primero lo más barato: ya existe `permisosEditables = false` + `rolesPropiosMax = 0` (P2) para «sin roles propios». Esta etapa solo se justifica porque el dueño la pidió | PROPUESTA |

## 2. Nivel 2: actores y contexto

| Actor | Qué hace | Autorización (servidor) | Estado |
|---|---|---|---|
| Administrador de plataforma | Edita plantillas (nueva versión de `ADMINISTRADOR` u `OPERADOR`), fija o cambia pisos, sube el cupo de roles propios (P2) | `requerirAdminDePlataforma` + rol de base `motor2_plataforma`; en Pedernal además segundo factor reciente | PROPUESTA (el segundo factor de M4 de mi plan) |
| Gerente de la empresa | Crea, edita (nueva versión), archiva y asigna roles propios, dentro del cupo (P2) y los pisos | `rolEmpresa = gerente` (en Pedernal «asignar roles es solo del gerente», S6) | PROPUESTA. **Hoy en Motor2** lo hace quien tenga `gestion_roles`/`gestion_permisos`: diferencia de resultado (§8, D-5) |
| Administrador y operador | No editan roles propios ni plantillas | Guard | PROPUESTA (como Pedernal, Q2-A: los roles base no los edita la empresa) |
| Sistema | Evalúa en cada operación; sin caché entre transacciones | Servidor | PROPUESTA |

## 3. Nivel 3: casos de uso

| # | Caso | Quién |
|---|---|---|
| C1 | Crear un rol propio: vacío o copiando una plantilla (desde ahí es independiente) | gerente |
| C2 | Editar un rol propio = **agregar una versión** con su lista de acciones | gerente |
| C3 | Archivar y reactivar un rol propio (no se borra; solo si no tiene personas activas) | gerente |
| C4 | Asignar un rol propio a una persona | gerente |
| C5 | Publicar una nueva versión de la plantilla de `ADMINISTRADOR` u `OPERADOR` | plataforma |
| C6 | Fijar o cambiar el tipo de un piso por acción (`SOLO_GERENTE` / `TODOS_LOS_ROLES`) | plataforma |
| C7 | Registrar que una acción nueva del catálogo ya pasó por el sistema (sincronización aditiva) | sistema (migración de datos de cada acción nueva) |
| C8 | Ver el conjunto efectivo de acciones de una persona | gerente / la persona (`permisos.ver_propios`, piso `TODOS_LOS_ROLES` en Pedernal) |

## 4. Nivel 4: conceptos y ciclo de vida (equivalencias)

| Pedernal (0061) | Equivalente de Motor2 (PROPUESTA) | Nota |
|---|---|---|
| `plantilla_de_rol(clave)`: `GERENTE`, `ADMINISTRADOR`, `OPERADOR` | `PlantillaDeRol(clave)` con las tres, en la clase CONSOLA | Las claves técnicas de Motor2 son `admin` y `operador` (y el gerente es `UsuarioEmpresa.rolEmpresa`, no una fila de `Rol`): el mapa `ADMINISTRADOR↔admin`, `OPERADOR↔operador`, `GERENTE↔rolEmpresa gerente` va en código |
| `version_de_plantilla(clave, numero, acciones text[], autor)` inmutable, sin lista para `GERENTE` | `VersionDePlantilla(plantillaClave, numero, accionesVer text[], accionesEditar text[], autor)` | **Diferencia de forma con motivo:** en Motor2 un permiso es **(acción, Ver, Editar)** con la regla «Ver ⊇ Editar» (`PermisoRol`), no una acción suelta. Se guardan dos listas con CHECK `accionesEditar ⊆ accionesVer`. Estado: PROPUESTA |
| `piso_de_plataforma(accion, tipo)` | `PisoDePlataforma(accionClave, tipo)` | Ver §10: convive con los 4 niveles de ADR-027 o los reemplaza |
| `accion_introducida(accion)` | `AccionIntroducida(accionClave)` | Para sumar acciones nuevas a plantillas sin pisar lo que la plataforma ya editó |
| `rol_de_empresa(id, empresa_id, nombre, nombre_clave, plantilla_origen, activo, version, …)` | **Se reutiliza `Rol`** (clave nula = propio) y se le agregan `plantillaOrigen` y `version` | **Primero lo más barato:** `Rol` ya tiene empresa, nombre único por empresa, `activo`; duplicarlo en otra tabla sería un modelo más. Estado: PROPUESTA; **alternativa** (tabla nueva `RolDeEmpresa`, forma idéntica a Pedernal) en §10 |
| `version_de_rol(empresa_id, rol_id, numero, acciones, creado_por, creado_en)` inmutable | `VersionDeRol(empresaId, rolId, numero, accionesVer, accionesEditar, creadoPorId, creadoEn)` solo inserción | `PermisoRol` pasa a ser **derivada** de la versión vigente (el guard sigue leyéndola): ver §6, I-4 |

**Ciclo de un rol propio:** nace vacío o con la copia de una plantilla (versión 1) → cada edición agrega una versión (la vigente es la de número mayor) → se archiva (no se borra; con personas activas, no) → se puede reactivar si hay cupo (P2). **Plantilla:** la plataforma publica versiones; los roles base de la empresa **siguen a la plantilla** (Pedernal, Q2-A) y la empresa no los edita.

## 5. Nivel 5: invariantes y políticas (las de 0061, una por una)

| # | Invariante de Pedernal (0061) | En Motor2 | Estado |
|---|---|---|---|
| I-1 | Clave de acción con forma permitida (`recurso.accion`, hasta 40+40) | Forma de **lista de permitidos** de las claves de Motor2: `^[a-z][a-z0-9_]{1,79}$` (planas; la más larga hoy 33) | PROPUESTA; la forma exacta la fija el catálogo (NO VERIFICADA la cota) |
| I-2 | Conjunto de acciones: vacío o válido, sin repetidas ni nulas, una dimensión, a lo sumo 1000 (DEC-0630: tope de forma) | Igual, tope 1000 por forma | PROPUESTA |
| I-3 | Una lista respeta los pisos: ninguna `SOLO_GERENTE` y todas las `TODOS_LOS_ROLES`; **sin pisos legibles se rechaza** (cierra ante la duda) | Igual | PROPUESTA (ya es «todo nace cerrado») |
| I-4 | Versiones inmutables (ni UPDATE ni DELETE ni TRUNCATE, ni del dueño); número = siguiente al mayor; dos ediciones a la vez: la segunda choca (23505) y relee | Igual, con trigger y único `(rol, numero)`; el guardado de la matriz actual (comparar contra lo que la persona vio + serializable con reintento) se conserva como segunda línea | PROPUESTA |
| I-5 | Un rol propio no cambia de empresa ni de plantilla de origen; no se borra | Igual, trigger | PROPUESTA |
| I-6 | Un piso cambia de tipo, no de acción; no se borra | Igual | PROPUESTA |
| I-7 | Plantillas y `accion_introducida`: solo inserción | Igual | PROPUESTA |
| I-8 | Aislamiento: RLS por empresa, FK compuesta, ninguna política mira la membresía (sin ciclos) | `aislamiento_empresa` + FK compuesta con discriminador (patrón de Motor2); tablas de plataforma con `solo_plataforma` | PROPUESTA |
| I-9 | Sin `SECURITY DEFINER`; nadie recibe DELETE ni TRUNCATE; INSERT y UPDATE por columna | Igual (patrón del molde de Datos) | PROPUESTA |
| I-10 | «El comportamiento de hoy queda idéntico hasta que alguien cambie algo» (§6.1 de H4b) | **Obligatorio**: la semilla de plantillas = la matriz de fábrica actual; una prueba de paridad la compara | PROPUESTA |

### Combinaciones que cambian permisos (oráculo, regla 2026-10-28)
Rol (de sistema / propio / plantilla) × tipo de piso (sin piso / `SOLO_GERENTE` / `TODOS_LOS_ROLES`) × acción en la versión vigente (sí / no) × estado del rol (activo / archivado) × módulo (activo / fuera de techo) × `permisosEditables` × cupo (P2). Tabla de reglas esperada escrita aparte del código y un test que recorre todas; guardián que falla si aparece una dimensión nueva sin declarar.

## 6. Contraste línea por línea con 0061

| Elemento de 0061 | Qué hace | Motor2 | ¿Igual? / motivo |
|---|---|---|---|
| `clave_de_accion_valida` | Regex de forma | CHECK con la forma de Motor2 (I-1) | **Forma distinta**: el catálogo de Motor2 es plano (DATOS existentes) |
| `claves_de_accion_validas` | Conjunto sin repetidas, ≤ 1000 | Igual | = |
| `plantilla_de_rol` | 3 filas fijas, solo inserción | `PlantillaDeRol`, igual | = (clase CONSOLA, escribe solo `motor2_plataforma`) |
| `version_de_plantilla` | Versiones inmutables sin lista para `GERENTE`, autor texto ≤ 100 | `VersionDePlantilla`, autor = email del administrador de plataforma como texto (como `AuditoriaPlataforma`) | = en resultado; dos listas (Ver y Editar) por el motivo de §4 |
| `piso_de_plataforma` | `tipo` de 2 valores; autor; versión de control optimista | `PisoDePlataforma` | = en forma; **su relación con ADR-027 es la pregunta de §10** |
| `accion_introducida` | Sincronización aditiva de acciones nuevas | `AccionIntroducida` | = |
| `rol_de_empresa` | Rol propio: nombre único por `nombre_clave`, plantilla de origen, `activo`, `version` | Reutiliza `Rol` (+ `plantillaOrigen`, `version`) | **Diferencia declarada** (§10 b): menor costo; el nombre ya es único por empresa y se valida con la regla de Datos (lista común sin `¿ ¡ ? ! % $`, hasta 80: DEC-0632 de Pedernal) |
| `version_de_rol` | Versión inmutable | `VersionDeRol` | = |
| `incumplimiento_de_pisos()` | Una sola definición para plantillas y roles propios; sin pisos visibles, rechaza | Función SQL equivalente | = |
| Disparadores de número siguiente, inmutabilidad, sin borrado | Segunda línea de la base | Equivalentes (patrón de M1: `proteger_*`, `reglas_*`) | = |
| Semilla generada desde `PERMISOS_DE_EMPRESA` (`npm run semilla:plantillas`, con verificación) | Plantillas y pisos iniciales | Semilla generada desde `ACCIONES.rolesEditarSemilla` y los 4 niveles; verificada por prueba | = en idea. **Los pisos iniciales de Motor2 los tiene que fijar el dueño** (Pedernal: 20 `SOLO_GERENTE` y 4 `TODOS_LOS_ROLES`; en Motor2 hoy solo 2 acciones son de gerente): **PENDIENTE de pregunta** |
| Cabecera «NO SE LEE TODAVÍA» (tramo T1 solo tablas) | Tablas antes del uso | **No**: cada tabla con su escritor | **Diferencia con motivo**: regla del dueño «nada de tablas a ciegas» (AGENTS.md) |
| RLS forzada, `app_empresa_id()`, privilegios por rol, `pedernal_app`/`pedernal_plataforma` | Aislamiento y privilegios | RLS sin FORCE + `aislamiento_empresa` / `solo_plataforma`, roles `motor2_app` / `motor2_plataforma` | Lo impone Prisma/RLS y los roles existentes |
| ids `uuid DEFAULT gen_random_uuid()` («lo manda la app: es la idempotencia del alta»), `timestamptz` | Molde | Molde de Datos: `@db.Uuid` que genera la app, `Timestamptz(3)`, sin DELETE, `claveIdempotencia` | = (contrato del frente 3). `empresaId` sigue `TEXT` hasta la decisión «también las viejas» |
| Reversión `reversiones/0061_…` (frena si hay roles propios o plantillas/pisos cambiados) | Bajada segura | `down.sql` con la misma condición | = |
| Lo que 0061 deja a propósito para T4 (`membresia.rol_propio_id`, valor `PROPIO` en los CHECK de rol, disparador de cambio entre roles no gerente) | Asignar un rol propio a una persona | En Motor2 la asignación ya existe: `UsuarioSucursal.rolId` apunta a `Rol` | **Diferencia de forma preexistente**: Motor2 asigna el rol por **sucursal**, Pedernal por **empresa** (S4); es la fila 2 de la auditoría del 2026-11-16, sigue **sin motivo del dueño** |

## 7. Etapas (cada una con su escritor; el gate de 8 comandos en cada una)

| Etapa | Qué entra | Tablas | Estado |
|---|---|---|---|
| **EB-0** | Decisión del dueño de §10 (niveles de ADR-027 frente a pisos por acción; lista inicial de pisos) y diseño de niveles 6 a 10 | — | PENDIENTE |
| **EB-1** | Plantillas y pisos en la consola de plataforma: `PlantillaDeRol`, `VersionDePlantilla`, `PisoDePlataforma`, `AccionIntroducida` + semilla verificada + pantalla/comando para editarlos (escritor) | 4 de plataforma | PENDIENTE; migración 20261117100400+ |
| **EB-2** | Roles propios con versiones: `VersionDeRol` + `Rol.plantillaOrigen/version` + casos de uso del gerente (crear, editar = versión, archivar, reactivar con cupo P2) | 1 nueva + columnas | PENDIENTE; 20261117100500+ |
| **EB-3** | Conectar el guard al conjunto efectivo (plantilla vigente para roles base; versión vigente para propios; piso por encima), sin cambiar el resultado de hoy (I-10) | ninguna | PENDIENTE |
| **EB-4** | Retirar la edición directa de la matriz de los roles base por la empresa (Q2-A) | ninguna | PENDIENTE; **quita una capacidad que hoy existe: pregunta aparte** |

## 8. Diferencias con Pedernal (declaradas con motivo)

| # | Tema | Pedernal | Motor2 | Motivo | Estado |
|---|---|---|---|---|---|
| D-1 | Pisos | Por acción, 2 tipos | Hoy 4 niveles en código (ADR-027) | DUEÑO (2026-10-08) / DATOS; **a decidir en §10** | PENDIENTE |
| D-2 | Rol propio | Tabla `rol_de_empresa` | Reutiliza `Rol` | Primero lo más barato; menos modelos | PROPUESTA |
| D-3 | Lista de acciones | `text[]` | Dos listas (Ver y Editar) | El permiso de Motor2 es (acción, Ver, Editar) con Ver ⊇ Editar | PROPUESTA |
| D-4 | Tablas antes del uso | Sí (T1) | No | Regla del dueño «nada de tablas a ciegas» | CONFIRMADA (AGENTS.md) |
| D-5 | Quién gestiona roles | Gerente | Hoy `gestion_roles` / `gestion_permisos` | MODELO existente; EB-4 lo acercaría | PENDIENTE |
| D-6 | Rol por persona | Por empresa | Por sucursal | DATOS; sin motivo del dueño | SIN MOTIVO (fila 2 de la auditoría) |
| D-7 | Claves de acción | `recurso.accion` | planas `snake_case` | Catálogo existente | PROPUESTA |

## 9. «¿Qué pasa si…?» (comandos principales)

| Situación | Crear / editar un rol propio (versión) | Publicar versión de plantilla | Cambiar un piso |
|---|---|---|---|
| Repetición | Misma clave de reintento = lo ya hecho; repetir el nombre = «ya existe», no gasta cupo | Igual (número esperado) | Mismo tipo = «sin cambios» |
| Concurrencia | Dos ediciones del mismo rol a la vez: gana una (único `(rol, número)`), la otra relee (23505) | Igual por plantilla | Control optimista por `version` |
| Tiempo | Rige en la operación siguiente (sin caché) | Igual | Igual |
| Incertidumbre | Reintentar con la misma clave es seguro | Reintentar con número esperado | Idempotente |
| Error parcial | Rol + versión + auditoría en una transacción | Versión + auditoría | Piso + auditoría |
| Datos faltantes | Sin pisos legibles: **rechaza** (cierra) | Idem | — |
| Cambio de permisos | Un piso nuevo **no quita** lo ya otorgado: en Pedernal la acción deja de otorgarse al evaluar (el piso va por encima); se declara en EB-3 | Las empresas con roles base ven la plantilla nueva | La lista de un rol que incumple el piso nuevo **no se borra**: deja de otorgar esa acción |

## 10. Preguntas al dueño (una por vez; solo permisos o modelo de datos)

**Primera (la que cambia permisos):** hoy Motor2 decide quién puede hacer cada cosa con **4 niveles** (operario, administrador, administrador de sistema, gerente) y un rol que armás a mano es «operario»: no puede recibir ninguna de las 61 acciones de nivel administrador. Pedernal, en cambio, deja armar un rol propio con casi cualquier acción y solo reserva al gerente un puñado fijado por la plataforma (20 acciones «solo gerente» y 4 «de todos»). Para igualar a Pedernal, ¿los **4 niveles de Motor2 se reemplazan** por esos pisos por acción (el «Encargado» pasa a poder tener casi todo menos lo del gerente), o se **mantienen los niveles** y los pisos de la plataforma se suman por encima?
- (A, recomendada) **Reemplazar** los niveles por pisos por acción, como Pedernal: mismo resultado. Exige que el dueño fije la lista inicial de acciones «solo gerente».
- (B) Mantener los niveles y sumar los pisos: menos cambio, pero Motor2 quedaría distinto de Pedernal en el resultado.

**En cola, después:** (b) ¿el rol propio reutiliza la tabla de roles de hoy (más barato, recomendado) o se crea una tabla aparte idéntica a Pedernal? (modelo de datos); (c) ¿la lista inicial de acciones «solo gerente» de Motor2 (hoy 2) la fija el dueño acción por acción o se toma el criterio de Pedernal con los nombres de Motor2? (permisos); (d) EB-4: ¿se quita a la empresa la edición de la matriz de los roles base (Q2-A de Pedernal)? (permisos, quita algo que hoy existe).

## 11. Carril de escritura y dependencias

- **Rutas (cuando se construya):** `plataforma/**` (pantalla de plantillas y pisos), `src/server/operaciones-de-plataforma/**`, `src/core/permisos/**` (conjunto efectivo, pisos; **zona restringida con acciones/matrices: por turno**), `src/server/actions/permisos/**`, `prisma/schema.prisma` (solo los modelos nuevos y las columnas de `Rol`), migraciones `20261117100400+`.
- **Dependencias:** Roles P1/Parte (usa `acciones.ts` y la matriz), Datos (molde de tabla nueva y regla del nombre de rol), Textos (T2: todo texto visible nuevo por el catálogo con DEC), Pantallas (el menú de la consola), Ocultar (acción propia de gerente y administrador: ya alineada).

## 12. Qué no verifiqué
- Las líneas 330 a 759 de la 0061 (RLS, privilegios, políticas de plataforma) ni su reversión.
- Cuántas acciones hay por piso hoy en Motor2 (uso los números de la auditoría previa: 58 / 61 / 12 / 2).
- Si el guard de Motor2 mira el techo del plan al otorgar una acción en la matriz.
- Ninguna prueba ni migración se corrió: es solo un documento.
