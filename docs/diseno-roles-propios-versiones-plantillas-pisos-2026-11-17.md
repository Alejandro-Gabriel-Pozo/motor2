# Diseño: roles propios con versiones inmutables, plantillas de rol y pisos de plataforma, como Pedernal 0061 (etapa E-B/E-D, 2026-11-17)

> **Solo un documento.** No cambia código, pruebas, migraciones, permisos ni textos. Frente 4 (planes y perillas). Etapa **posterior** a M1 (planes, ya en `main`), P2 (perilla de roles propios), P3 (nombres visibles) y P4 (empresas nuevas nacen cerradas): **no se construye antes de que entren en ese orden**.
> **Pedido del dueño (2026-11-17, literal, relatado por el orquestador general; no lo leí en su fuente):** «Sí, como Pedernal, etapa posterior (Recomendada)» a «¿Motor2 también lo tiene como Pedernal (roles propios con versiones inmutables, plantillas de rol de origen y pisos de plataforma, 0061), como etapa posterior a P2, P3 y P4?». Regla de paridad (2026-11-13): «Necesitamos ser iguales [a Pedernal] en todo… El resultado tiene que ser el mismo y sobre todo de las mismas formas, salvo porque nosotros usamos Prisma.»
> **Qué leí.** Pedernal: `ZuluHub-docs` `11-especificaciones/sql-pendientes-otros-modulos/0061_permisos_configurables.sql` (759 líneas, completo en sus partes estructurales: cabecera, validadores, 6 tablas, disparadores, semilla; **no leí** las políticas de RLS ni los privilegios de las líneas 330-759 ni la reversión) y `h4b-permisos-configurables.md` (índice y lo citado por la auditoría previa). Motor2: `docs/auditoria-roles-y-permisos-vs-pedernal-2026-11-16.md` (base de la comparación; verificada contra el código de `main` e1a83d03 por su autor) y el catálogo `src/core/permisos/acciones.ts` (133 claves planas en `snake_case`, la más larga con 33 caracteres; cuenta mía por patrón, NO VERIFICADA contra el catálogo completo).
> Estados: CONFIRMADA (cita del dueño) · PROPUESTA · PENDIENTE · NO VERIFICADA.
> **Actualización (2026-11-17):** el dueño respondió la primera pregunta de §10: «Reemplazar los 4 niveles por pisos por acción (Recomendada)» (2026-11-17, AskUserQuestion, relatada por el orquestador general; fuente: chat del dueño con el orquestador, 2026-11-17). **CONFIRMADA:** los pisos pasan a ser por acción y los 4 niveles de ADR-027 se reemplazan **por etapas aditivas** (§7 bis). Se agregan §6 bis (equivalencia 1 a 1 de las 133 acciones) y §7 bis (transición con convivencia, ensayo y rollback).
> **Actualización 2 (2026-11-17, respuestas del dueño por AskUserQuestion, relatadas por el orquestador general):** (1) las 12 acciones de gobierno: «Solo gerente y admin de sistema (Recomendada)» → piso `SOLO_GERENTE`, no cambia nada de hoy; (2) acciones de dinero: «Asignables a un rol propio, como Pedernal (Recomendada)» → sin piso, **nacen cerradas para todo rol nuevo**; (3) quién asigna roles: «Solo el gerente, como Pedernal (Recomendada)» → la asignación pasa a ser solo del gerente (hoy gerente y administrador): etapa propia aditiva **EB-5** (§7 ter). **Decisiones del orquestador, declaradas para que el dueño las corrija:** el rol propio REUTILIZA `Rol` (más barato); `TODOS_LOS_ROLES`: lista vacía por ahora; la edición de la matriz de los roles base por la empresa se quita en un paso aparte al final (EB-4).

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
| **Transición niveles → pisos** | Ver §7 bis (T0 a T5): convive con EB-1 a EB-3; T3 enciende pisos por empresa | — | CONFIRMADA en su dirección (2026-11-17); detalle PROPUESTA |
| **EB-5** | La asignación de rol a una persona pasa a ser solo del gerente (§7 ter): clave `asignar_rol`, interruptor `rolSoloGerente`, aviso previo, ensayo, marcha atrás | 0 tablas; 1 columna de política en `Empresa` | CONFIRMADA en su dirección (2026-11-17); detalle PROPUESTA; migración 20261117100600+ |
| **EB-4** | Retirar la edición directa de la matriz de los roles base por la empresa (Q2-A) | ninguna | PENDIENTE; **quita una capacidad que hoy existe: pregunta aparte** |

## 6 bis. Equivalencia 1 a 1: de los 4 niveles a los pisos por acción (PROPUESTA; la lista de pisos la confirma el dueño)

Cuenta real del catálogo de `main` (`ACCIONES`, 133 claves): **58 operario, 61 administrador, 12 administrador de sistema, 2 gerente**. Regla de la equivalencia: **el resultado de hoy no cambia para nadie que ya tenga un rol**. Un piso por acción solo tiene dos valores; «sin piso» significa «se puede asignar dentro del plan».

| Nivel de hoy | Cuántas | Piso por acción propuesto | Por qué (resultado) |
|---|---|---|---|
| gerente | 2: `ver_auditoria_empresa`, `traspasar_gerencia` | `SOLO_GERENTE` | Hoy solo las tiene quien es gerente de la empresa: igual |
| administrador de sistema (gobierno de la empresa) | 12: `gestion_usuarios`, `activar_usuario_sucursal`, `notas_usuario_sucursal`, `apagar_cuenta_empresa`, `gestion_permisos`, `gestion_roles`, `renombrar_rol`, `capacidades_sucursal`, `alta_sucursal`, `activar_sucursal`, `renombrar_sucursal`, `ver_auditoria` | `SOLO_GERENTE` (**CONFIRMADA 2026-11-17**) **para que un rol propio («Encargado») siga sin alcanzarlas**, como hoy (ADR-027: «un rango 2 nunca lo alcanza»). El rol de sistema `admin` las conserva por su plantilla (`ADMINISTRADOR`), no por el piso | Mantiene el resultado. **Pregunta al dueño:** en Pedernal el administrador de sistema no es gerente; si estas 12 pasaran a «sin piso», un Encargado podría gobernar la empresa |
| administrador | 61 (grupos abajo) | **sin piso** (asignables a roles propios dentro del plan) | Es lo que Pedernal permite («un rol propio recibe casi cualquier acción»); el rol `admin` las sigue teniendo por su plantilla |
| operario | 58 | **sin piso** | Hoy cualquier rol las puede recibir: igual |
| «de todos» (Pedernal: `TODOS_LOS_ROLES`, 4 acciones) | **0 identificadas** | Ninguna por ahora | En Motor2 no hay acciones que deban tener todos los roles hoy: `traspaso_*` y `partes_ver` se asignan por matriz. **NO VERIFICADA** la equivalencia de las 4 de Pedernal (`gerencia.aceptar/rechazar/ver_traspaso`, `permisos.ver_propios`); se pregunta al dueño si alguna de Motor2 debe serlo |

**Las 61 del nivel administrador, por grupo** (todas «sin piso»; los grupos sirven para que el dueño marque si alguna debería ser `SOLO_GERENTE`):
- *Catálogo, recetas y opciones (15):* `guardar_receta`, `grupos_familia`, `secciones`, `unidades`, `proveedores`, `categorias`, `margen_objetivo_editar`, `motivos_merma`, `motivos_destino_consumo`, `calibrar_rendimiento_local`, `receta_sucursal_copiar`, `receta_sucursal_volver_central`, `insumo_renombrar_fusionar`, `opciones_definir`, `producto_opciones_admitidas`.
- *Carta y promociones (13):* `carta_ver`, `carta_secciones`, `carta_generos`, `carta_contenido_producto`, `carta_producto_descuento`, `carta_items_agrupados`, `carta_portal`, `carta_promo_definir`, `carta_promo_activar`, `carta_promo_precio_local`, `carta_tema`, `carta_copiar_de_sucursal`, `precio_local`.
- *Stock y conteos (6):* `stock_minimo`, `comparar_precios`, `insumos_mezclados`, `proceso_ajuste`, `cancelar_conteo`, `stock_seccion_habitual`.
- *Dinero: anular, corregir, pagar (5, **sin piso: CONFIRMADA 2026-11-17, «Asignables a un rol propio, como Pedernal»; nacen cerradas para todo rol nuevo**):* `anular_venta`, `anular_compra`, `corregir_compra`, `pagar_consignante`, `clientes`.
- *Reportes de solo ver (21):* `reporte_resumen`, `reporte_consolidado`, `reporte_periodo`, `reporte_categorias`, `reporte_ventas_por_seccion`, `reporte_costos`, `reporte_compras`, `reporte_rendimiento_recetas`, `reporte_rendimiento_sucursal`, `reporte_valuacion`, `reporte_tickets`, `reporte_descuentos_clientes`, `reporte_descuentos_productos`, `reporte_margen_promociones`, `reporte_historial_importes`, `reporte_perdidas`, `reporte_devoluciones`, `reporte_diferencias`, `reporte_sin_receta`, `reporte_insumos_sin_receta`, `reporte_huecos_catalogo`.
- *Parte (1):* `partes_desactivar` (en Pedernal `partes.desactivar` es del gerente y el administrador, no del operador: hoy es nivel administrador; sin piso lo conserva el `admin`).
Suma comprobada con un script contra `ACCIONES`: 15 + 13 + 6 + 5 + 21 + 1 = **61**, sin ninguna repetida ni suelta. La cuenta exacta la fija además la prueba de equivalencia (T1).

**Qué pasa con el «Encargado» (rango intermedio):** deja de necesitar un nivel nuevo (`Rol.nivel`, F3 de ADR-027, que nunca se construyó): es un rol propio sin piso que el gerente arma con las acciones del nivel administrador que quiera, **salvo las `SOLO_GERENTE`**. Resultado de Pedernal igualado.

## 7 bis. Transición por etapas aditivas (nada se rompe para quien ya tiene un rol)

Principio del diseño de Pedernal que se conserva (§6.1 de H4b): **el comportamiento de hoy queda idéntico hasta que alguien cambie algo.** Propiedad que hace segura la bajada: en Motor2 el piso manda sobre la fila de la matriz (`decision-de-acceso.ts`), así que una fila de un rol que el piso ya no deja pasar queda **inerte**, no abre nada.

| Etapa | Qué hace | Cambia el resultado | Verificación | Rollback |
|---|---|---|---|---|
| **T0** | El dueño confirma la lista de pisos (§6 bis) y las preguntas de §10 | — | Documento | — |
| **T1** | Tablas de plantillas y pisos (EB-1) con la **semilla generada desde `nivelMinimo`** por la equivalencia de §6 bis; el código sigue decidiendo por niveles | No | Prueba de **paridad**: cada una de las 133 acciones mapea a exactamente un piso o a ninguno; la semilla = `ACCIONES` | `down.sql` (aborta si hay datos cargados a mano) |
| **T2** | **Oráculo en pruebas, sin tocar producción:** para cada acción × cada tipo de actor (gerente, `admin`, `operador`, rol propio) × estado de la matriz, la decisión **por niveles = la decisión por pisos**. Cualquier diferencia rompe el test | No | Test exhaustivo (133 × 4 × estados) y guardián que falla si aparece una acción o un nivel nuevo sin declarar | Borrar el test |
| **T3** | **Interruptor por empresa `pisosPorAccion`** (política de plataforma, como `permisosEditables`; nace apagado en las existentes) que hace que el guard decida por pisos. **Ensayo:** primero una empresa de prueba, después una real con respaldo, después el resto | Solo en la empresa a la que la plataforma se lo enciende | Prueba de las dos formas lado a lado; auditoría del cambio de la perilla | **Apagar la perilla** (vuelven los niveles al instante; las acciones que un rol propio haya recibido mientras tanto quedan inertes por el piso de nivel) |
| **T4** | El gerente puede asignar a un rol propio acciones del nivel administrador (el «Encargado»); recién ahí cambia lo que alguien puede hacer, **por decisión del gerente** | Sí, a pedido | Pruebas de las combinaciones (§5) | Archivar el rol o quitarle las acciones (nueva versión) |
| **T5** | Retirar los niveles del código (`nivelMinimo`, `RANGO_DE_PISO`, `nivelAlcanzaElPiso`) cuando **todas** las empresas estén en pisos y estables | No | Gate de 8 comandos; `knip` en 0 | Revertir el commit (los datos de pisos siguen) |

### Qué pasa si… (cambio de permisos durante la transición)
| Situación | Qué pasa |
|---|---|
| Un rol propio con personas activas cuando se enciende `pisosPorAccion` | Nada cambia: sus filas son las mismas; solo puede recibir más acciones si el gerente se las da (T4) |
| Se apaga `pisosPorAccion` después de T4 en esa empresa | Vuelven los niveles: las acciones de administrador que ese rol había recibido quedan **inertes** (el piso de nivel manda); no se borra nada y se ven al volver a encender |
| La plataforma cambia un piso de `SIN_PISO` a `SOLO_GERENTE` con roles que ya tienen esa acción | La acción **deja de otorgarse** (el piso va por encima); la lista del rol no se toca; queda registrado quién y cuándo |
| Dos cambios a la vez (un gerente edita un rol y la plataforma cambia un piso) | Se serializan por la versión del rol y la del piso; el que llega segundo relee; no hay estado a medias |
| Se enciende el interruptor y falla algo a mitad | Es una sola fila de política (`FOR UPDATE` + auditoría en la misma transacción): o cambia o no cambia |
| Un actor intenta saltarse el piso con un pedido armado a mano | El servidor decide con pisos y plantillas; lo que manda el cliente no cuenta |
| Una acción nueva del catálogo | Sin piso por defecto **y apagada para los roles propios** (todo nace cerrado); la sincronización aditiva la agrega a las plantillas del sistema |

## 7 ter. EB-5: la asignación de rol a una persona pasa a ser solo del gerente (etapa propia, aditiva)

**Decisión del dueño (2026-11-17):** «Solo el gerente, como Pedernal (Recomendada)». **Qué cambia de lo que existe:** hoy asigna o cambia el rol de una persona quien tiene `gestion_usuarios` (el gerente y el `admin`; `agregarOActualizarUsuario`, con el «techo de privilegio» de `gestion-de-usuarios.ts` y la regla de que solo el gerente reactiva a un administrador). Con EB-5 **solo el gerente** asigna o cambia roles. Es un permiso **que se quita a algo que existe**: por eso etapa propia, aviso previo, ensayo y marcha atrás.

| Pieza | Diseño (PROPUESTA) |
|---|---|
| Clave nueva | `asignar_rol` (en el catálogo de acciones; **zona restringida, por turno**), piso `SOLO_GERENTE` (con el sistema de pisos por acción; antes de que exista, nivel gerente). Nace **cerrada**: nadie la tiene salvo el gerente de la empresa |
| Qué corta | Solo la parte «rol» de `agregarOActualizarUsuario`: dar un rol a una persona o cambiárselo. `gestion_usuarios` sigue permitiendo invitar, activar, desactivar y las notas |
| Interruptor por empresa | `rolSoloGerente` (política de plataforma, igual que `permisosEditables`): **nace apagado en las empresas existentes** (el comportamiento de hoy) y **encendido en las nuevas** («todo nace cerrado», como P4). La plataforma lo enciende empresa por empresa |
| Aviso previo | Antes de encender en una empresa real: lista (de solo lectura, sin datos personales) de cuántos administradores asignaron roles en los últimos 90 días, para saber a quién afecta; y aviso al gerente de esa empresa. **El texto visible del aviso en pantalla**, si se pide, va por el catálogo de textos con aceptación del dueño |
| Ensayo | Empresa de prueba primero; después una real con respaldo; después el resto |
| Marcha atrás | Apagar el interruptor: vuelve a valer `gestion_usuarios` para asignar; **no se borra ni se cambia ningún rol ya asignado** |
| Qué NO hace | No quita roles ya asignados, no cambia lo que cada rol puede (eso es la matriz), no toca las invariantes de gobierno (siempre queda un administrador efectivo) |

### Qué pasa si… (EB-5)
| Situación | Qué pasa |
|---|---|
| Un administrador intenta asignar un rol con el interruptor encendido | Rechazo claro en el servidor; no se escribe nada; queda registrado el intento denegado (como los demás rechazos de permiso) |
| Un administrador invita a una persona nueva | **CONFIRMADA (2026-11-17, q6): «El administrador invita y queda sin rol hasta que el gerente lo asigna (Recomendada)».** El administrador sigue pudiendo invitar; la persona queda **sin rol** (no puede hacer nada) hasta que el gerente se lo asigna. Hoy la invitación lleva el rol: con EB-5 el administrador no lo elige |
| Persona con un rol ya asignado por un administrador antes de encender | Conserva su rol: nada se toca |
| El gerente cambia a alguien de rol a la vez que se enciende el interruptor | Se serializan; el que llega segundo ve el estado nuevo |
| Se enciende y se arrepienten | Se apaga: vuelve a valer lo de antes |
| Reactivar a un administrador | Sigue siendo solo del gerente (ya es así hoy) |
| El gerente no está disponible (de vacaciones, sin acceso) | Nadie asigna roles hasta que vuelva; la transferencia de la gerencia (`traspasar_gerencia`) ya existe y es el camino: **riesgo operativo declarado** |
| Repetición / reintento del mismo pedido | Idempotente por el estado (misma persona y mismo rol = sin cambios); la auditoría registra una sola vez |

## 8. Diferencias con Pedernal (declaradas con motivo)

| # | Tema | Pedernal | Motor2 | Motivo | Estado |
|---|---|---|---|---|---|
| D-1 | Pisos | Por acción, 2 tipos | Hoy 4 niveles en código (ADR-027); **pasan a pisos por acción por etapas** (§7 bis) | Decisión del dueño 2026-11-17: «Reemplazar los 4 niveles por pisos por acción (Recomendada)» | CONFIRMADA |
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

**Respondidas (2026-11-17, AskUserQuestion, relatadas por el orquestador general):** (a) «Reemplazar los 4 niveles por pisos por acción (Recomendada)»; (b) 12 acciones de gobierno: «Solo gerente y admin de sistema (Recomendada)»; (c) acciones de dinero: «Asignables a un rol propio, como Pedernal (Recomendada)»; (d) quién asigna roles: «Solo el gerente, como Pedernal (Recomendada)».

**Decisiones del orquestador, declaradas (el dueño las corrige):** el rol propio reutiliza `Rol`; `TODOS_LOS_ROLES` queda vacía por ahora; la edición de la matriz de los roles base por la empresa se quita al final (EB-4).

**Respondida (q6, 2026-11-17, AskUserQuestion, relatada por el orquestador general):** «El administrador invita y queda sin rol hasta que el gerente lo asigna (Recomendada)». CONFIRMADA; ver §7 ter.

**Siguiente:** ninguna pregunta de permisos pendiente antes de construir; las de abajo se hacen cuando llegue cada etapa.

**En cola, después:** (q7) EB-4, cuando llegue su turno: ¿se le quita a la empresa la edición de la matriz de los roles base (Q2-A de Pedernal)? (quita algo que hoy existe; recomendado: sí, al final); (q8) en EB-5, ¿cuánto aviso previo se da antes de encender en una empresa real (recomendado: el que el dueño decida por empresa, con la lista de a quiénes afecta)?

## 11. Carril de escritura y dependencias

- **Rutas (cuando se construya):** `plataforma/**` (pantalla de plantillas y pisos), `src/server/operaciones-de-plataforma/**`, `src/core/permisos/**` (conjunto efectivo, pisos; **zona restringida con acciones/matrices: por turno**), `src/server/actions/permisos/**`, `prisma/schema.prisma` (solo los modelos nuevos y las columnas de `Rol`), migraciones `20261117100400+`.
- **Dependencias:** Roles P1/Parte (usa `acciones.ts` y la matriz), Datos (molde de tabla nueva y regla del nombre de rol), Textos (T2: todo texto visible nuevo por el catálogo con DEC), Pantallas (el menú de la consola), Ocultar (acción propia de gerente y administrador: ya alineada).

## 12. Qué no verifiqué
- Las líneas 330 a 759 de la 0061 (RLS, privilegios, políticas de plataforma) ni su reversión.
- Cuántas acciones hay por piso hoy en Motor2 (uso los números de la auditoría previa: 58 / 61 / 12 / 2).
- Si el guard de Motor2 mira el techo del plan al otorgar una acción en la matriz.
- Ninguna prueba ni migración se corrió: es solo un documento.
