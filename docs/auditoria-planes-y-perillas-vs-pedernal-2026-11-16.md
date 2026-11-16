# Auditoría: planes y perillas, Motor2 contra Pedernal (2026-11-16)

> **Solo documento.** No cambia código, migraciones ni datos. Frente 4 del programa de paridad (contrato: `_coordinacion/mapa-de-carriles-2026-11-16.md` de `motor2-docs`).
> **Qué leí.** Motor2: `main` 903c0f6d (`prisma/schema.prisma`, `src/core/modulos`, `src/core/permisos/politica-de-empresa.ts`, `src/core/features/empresa/cambio-de-politica.ts`, `src/server/operaciones-de-plataforma/*`, `plataforma/src/servidor/modulos.ts`, `scripts/politica-empresa.ts`, ADR-011/013). Pedernal: `ZuluHub-ERP` ad4a9a4 y `ZuluHub-docs` 125e09e, ambos del 2026-11-16 (clonados hoy; **un solo commit visible**, no hay historia para mirar cambios). La lectura de Pedernal la hizo un subagente de lectura; yo reverifiqué en el código las afirmaciones que sostienen este documento: las 12 perillas de `perillas.ts`, que `roles_propios_por_empresa` no existe en `src/`, `migraciones/` ni `apps/`, que `configurarCompras` rechaza siempre un nivel con perilla (`configuracion.ts:34-35`) y que `ajustarPerilla` no aparece en `apps/` ni `scripts/`.
> Estados: CONFIRMADA (cita del dueño) · PROPUESTA · PENDIENTE · NO VERIFICADA.

## 1. Qué hay hoy en Motor2 (código real)

| Pieza | Qué es | Dónde |
|---|---|---|
| **Módulos por empresa** | Catálogo en código (`MODULOS`: 3 tipos `fijo`/`soporte`/`vendible`; `requiere` dura, `usaSiExiste` blanda; `disponible`/`en_desarrollo`). La base solo guarda qué módulos tiene cada empresa: `ModuloEmpresa(empresaId, modulo TEXT, estado ACTIVO/INACTIVO)`, único por empresa+módulo, sin DELETE, lo escribe solo `motor2_plataforma` (RLS + REVOKE + trigger) | `src/core/modulos/catalogo.ts:23-41`, `schema.prisma:2729-2740` |
| **Cambio de módulos** | Desde la consola (`/empresas/[id]/modulos`), una transacción con `FOR UPDATE` de la empresa, validación de clausura (la misma del guard de la app), una fila de `AuditoriaPlataforma` por módulo. Repetir da «Sin cambios: ya estaba así». Rige en el próximo pedido | `plataforma/src/servidor/modulos.ts:36-72` |
| **Política de empresa** | Dos columnas en `Empresa`: `permisosEditables` y `dosPaneles` (booleanas, `DEFAULT true`). Dos «perfiles» (`completo`, `lite`) que **no se guardan**: son atajos para fijar las dos columnas | `schema.prisma:2607-2608`, `politica-de-empresa.ts:13-28` |
| **Cambio de política** | **Solo por script** (`npm run politica-empresa`), con TOTP del administrador, `FOR UPDATE`, una fila de `AuditoriaPlataforma` por perilla que cambió. **No hay pantalla en la consola** | `scripts/politica-empresa.ts`, `cambiar-politica-de-empresa.ts:19-45` |
| **Otras perillas-columna** | `Empresa.llevaIvaDeCompras` (boolean, default `false`): existe en el esquema y en el golden de gobierno, pero **no encontré ninguna lectura en `src/`, `plataforma/` ni `scripts/`** (la perilla de IVA de compras figura en el esquema sin quien la consulte). `Empresa.condicionIva` es dato fiscal, no perilla | `schema.prisma:2613-2615` |
| **Consola de plataforma** | Segunda app Next (`plataforma/`): ingreso con código por mail + TOTP, altas, ciclo de vida, módulos, auditoría. Una consola para varias instalaciones (ADR-025) | `plataforma/src/app/**` |
| **Auditoría** | `AuditoriaPlataforma`: solo inserción, sin RLS por empresa, administrador como texto (no es `User`). Los cambios de política y de módulos **ya no aparecen** en el registro de auditoría de la empresa | `schema.prisma:3264-3280` |
| **Planes** | **No existen.** ADR-013 (2026-10-03) los decide («un plan es un dato», `Plan` + `PlanModulo`, asignar genera filas del registro, editar un plan es una «foto» y se reaplica a mano, sin precios) y dice «Decidido, todavía sin implementar». Sin modelo `Plan`, sin `planId` en `Empresa`, sin pantalla «Plan y módulos» (verificado con `grep`) | `docs/adr/ADR-013-planes-editables.md` |
| **Precios y cobro** | No existen; ADR-013 §6 los deja afuera | — |

## 2. Qué hay hoy en Pedernal vigente (ad4a9a4)

| Pieza | Qué es | Dónde (ZuluHub-ERP) |
|---|---|---|
| **Catálogo de perillas = código** | 12 perillas, solo dos tipos (INTERRUPTOR, LIMITE); cada una con base, ámbito (TENANT/EMPRESA/SUCURSAL), módulo y `requiere`. Regla escrita: «una perilla que nadie verifica no se declara» | `src/capacidades/planes/perillas.ts:9-144` |
| **Las 12** | `empresas_por_tenant` (LIMITE 1), `composiciones_con_perdida`, `subcomposiciones`, `lotes`, `calidad_de_lote`, `produccion`, `conjuntos`, `composiciones_por_tamano`, `salon`, `venta_por_fracciones_y_peso`, `vidriera_por_qr` (todas INTERRUPTOR apagado) y `cajas_por_sucursal` (LIMITE 1, ámbito SUCURSAL) | `perillas.ts:51-138` |
| **Datos** | `plan` (código único, ACTIVO/RETIRADO), `version_de_plan` (BORRADOR → PUBLICADA, inmutable, `modulos text[]` = techo, `perillas jsonb`), `plan_de_tenant` (asignación **solo inserción**, número consecutivo, `vigente_desde`, `origen`, `motivo`), `ajuste_de_perilla` (**solo inserción**, serie numerada por tenant/empresa/perilla, valor `0`/entero/`ILIMITADO`/`DEL_PLAN`), `modulo_de_empresa` (activo, sin borrado). La base **no conoce el catálogo**: lo valida el dominio | `migraciones/0007_marcas_y_planes.sql:416-560` |
| **Perilla efectiva** | Función pura: ajuste vigente más específico (empresa, luego tenant) > valor de la versión del plan > base del catálogo; después `requiere` (falla cerrado). **Sin caché**: se resuelve en cada acción, dentro de la transacción del llamador | `derechos.ts:177-215`, `puertos/derechos-de-uso.ts:8-13` |
| **Exigir** | Interruptor apagado → `FUNCION_NO_INCLUIDA`; límite con `uso >= limite` → `LIMITE_DEL_PLAN`; `ILIMITADO` nunca falla. El módulo cuenta el uso dentro de su transacción | `derechos.ts:239-256` |
| **Bajar con datos** | No se rechaza ni se borra nada: se rechaza **crear lo nuevo** (reactivar una caja también exige tope). La baja de módulos los deja en solo lectura | `asignar-plan.ts:264-266`, `cambiar-estado-de-caja.ts:103` |
| **Concurrencia / idempotencia** | Un solo flujo `ejecutarCasoDePlataforma`: transacción serializable con guard, clave de idempotencia (misma clave + misma entrada → mismo resultado; misma clave + otra entrada → `CLAVE_REUTILIZADA`), trabajo, auditoría; `numeroEsperado` → `VERSION_DESACTUALIZADA` si otro decidió antes; sin vigencia retroactiva; una decisión programada pendiente exige `reemplazaProgramada` | `caso-de-plataforma.ts:101-170`, `vigencia.ts` |
| **Auditoría** | `auditoria_plataforma` + una constancia en `auditoria_empresa` de **cada empresa afectada**, en la misma transacción | `marcas-y-planes-comun.ts:110-124` |
| **Quién** | Solo rol ADMIN de plataforma (SOPORTE solo ve); asignar plan, ajustar perilla, publicar versión y activar/desactivar módulos exigen segundo factor de menos de 5 minutos | `permisos/plataforma.ts:220-237` |
| **Consola** | Pantalla «Plan de la empresa» (plan actual y programado, módulos, perillas con su origen) y diálogo de **cambiar plan**. **No hay pantalla ni comando de CLI** para ajustar una perilla, crear/publicar un plan, activar un módulo ni migrar versiones; el CLI `plataforma:caso` expone `crearPlan`, `guardarBorradorDePlan`, `publicarVersionDePlan`, `asignarPlan`, `altaDeEmpresa`, `activar/desactivarModuloDeEmpresa`, **no** `ajustarPerilla` | `apps/plataforma/app/empresas/[id]/plan/*`, `pedido-de-caso.ts:38-130` |
| **Techo de módulos** | ACTIVO = obligatorios ∪ (activados ∩ techo del plan ∩ disponibles); activado pero fuera del techo = SOLO LECTURA. El techo se mira solo al activar | `modulos/activos.ts:38-56` |
| **Precios** | **No hay.** «Global de la fábrica, sin precio»; diseño de suscripciones diferido y sin SQL | `0007…sql:415`, `version-de-plan.ts:11` |

## 3. Tabla de paridad

Clave: **=** igual · **R** difiere en resultado · **F** difiere en forma · **FM** falta en Motor2 · **FP** falta en Pedernal · **NV** no verificado.

| # | Tema | Motor2 hoy | Pedernal hoy | Estado | Nota |
|---|---|---|---|---|---|
| 1 | Perillas como catálogo cerrado en código | No hay catálogo: cada perilla es una columna de `Empresa` | `perillas.ts` con tipo, base, ámbito, módulo, `requiere` | **FM / F** | Pedernal valida en el dominio; la base solo guarda valores |
| 2 | Tipos de perilla | boolean (2 columnas + 1 sin lector) | INTERRUPTOR y LIMITE | **FM** | Motor2 no tiene ningún límite numérico |
| 3 | Plan | no existe (ADR-013 sin implementar) | `plan` + `version_de_plan` inmutable + `plan_de_tenant` | **FM** | |
| 4 | Semántica del plan | ADR-013: asignar **genera filas** de módulos; editar es «foto» + «reaplicar» | El plan es **techo** de módulos; las filas de `modulo_de_empresa` las activa la plataforma dentro del techo; versiones inmutables | **R / F** | Hay que decidir cuál rige; ADR-013 se escribió sin mirar a Pedernal (§5 del diseño) |
| 5 | Versionado | no hay | versión de plan publicada inmutable; asignación y ajuste con serie numerada | **FM** | |
| 6 | Ajuste de perilla por empresa | no hay | `ajuste_de_perilla`, solo inserción, con motivo y vigencia | **FM** | |
| 7 | Resolución de la perilla efectiva | se lee la columna de `Empresa` en cada acción | función pura plan/ajuste/base + `requiere` | **R**: mismo efecto hoy; difiere al haber planes | Sin caché en ambos (en Motor2 lectura directa; NV si algún lugar cachea la política) |
| 8 | Módulos por empresa | `ModuloEmpresa` ACTIVO/INACTIVO, clausura `requiere`, solo plataforma | `modulo_de_empresa` + techo del plan + estado «solo lectura» | **R**: Motor2 no tiene «solo lectura» ni techo | |
| 9 | Auditoría del cambio | `AuditoriaPlataforma` (sin constancia en la empresa) | `auditoria_plataforma` + constancia en `auditoria_empresa` de cada empresa afectada | **F / R** | En Motor2 la empresa no ve en su historial que la plataforma le cambió algo |
| 10 | Idempotencia de la consola | cambio de módulos y de política: «sin cambios» si ya estaba así; **no vi clave de idempotencia** | tabla `idempotencia_plataforma` con clave y huella | **F** (NV si la consola de Motor2 manda clave) | Una acción repetida no duplica en ambos; en Motor2 se apoya en el estado, no en la clave |
| 11 | Concurrencia de la consola | `FOR UPDATE` de la fila de la empresa | transacción serializable + `numeroEsperado` | **F** | Ambos serializan; Pedernal además detecta «otro decidió antes» |
| 12 | Quién cambia | administrador de plataforma, TOTP por comando | rol ADMIN, segundo factor de < 5 min para los casos sensibles | **=** en la idea; **NV** el detalle del TOTP de Motor2 | |
| 13 | Consola: ver plan y perillas | no hay pantalla de política ni de plan | pantalla «Plan de la empresa» | **FM** | |
| 14 | Consola: cambiar perilla de empresa | solo script (`politica-empresa`) | **ninguna vía operativa** (el caso de uso existe sin pantalla ni CLI) | **FP** | Hallazgo: Pedernal no puede hoy «subir la perilla del dueño» salvo por código |
| 15 | `roles_propios_por_empresa` | no existe; plan P2: columna `Empresa.rolesPropiosMax` | **tampoco existe en el código** (diseñada EMPRESA·LIMITE·base 0, tramo T4 de H4b sin construir) | **FM en ambos** | Igualar a algo que Pedernal todavía no tiene: se iguala el **diseño** |
| 16 | Compras N3/N4 por perillas | no hay N3/N4 | las perillas `recepcion_separada` y `conciliacion_de_tres_vias` **no están declaradas**; `configurarCompras` rechaza siempre el nivel | **FM en ambos** | Ver dependencia con frente 5 |
| 17 | Caja múltiple | no hay perilla | `cajas_por_sucursal` (LIMITE 1, SUCURSAL) con tope al crear y al reactivar | **FM** | Dependencia con frente 1 |
| 18 | Venta por fracciones y peso | existe sin perilla (venta fraccionada, Task #25) | `venta_por_fracciones_y_peso` INTERRUPTOR apagado | **R** (en Pedernal nace apagada) | Dependencia con frente 2; **no** se agrega nada sin pedido |
| 19 | Política: `permisosEditables`, `dosPaneles` | existen | **NV** si Pedernal tiene equivalentes (su permisos configurables, H4b, usa roles y plantillas, no un interruptor global) | **NV** | No leí H4b completo |
| 20 | Perfiles `completo` / `lite` | atajos no guardados | no hay equivalentes (el plan cumple ese papel) | **FP** | Cuando haya planes, el perfil queda como atajo o se retira (poda) |
| 21 | Precios de planes | no hay | no hay; decisión del dueño de Pedernal: cobro manual en el piloto, precios aparte | **= (ninguno lo tiene)** | No se diseña dinero |
| 22 | Lectura pública que se cierra al bajar de plan | no aplica | la carta pública se cierra sola si baja el plan o el módulo | **FM** | Solo si Motor2 hace «carta pública por plan»: no está pedido |

## 4. Contradicciones y desfases hallados (no son de Motor2, afectan cómo se igualan)

1. **Roles propios:** la fila 191 de Pedernal decía «1 por plan» y la 203 la corrige («nace en 0 para todos y la sube el dueño empresa por empresa»). `novedades-para-motor2.md:238` todavía dice «1 por plan». Vale la 203, que además es la que el dueño de Motor2 aceptó con «como pedernal,».
2. **El camino de «subirla»:** la decisión de Pedernal dice que se sube «con un ajuste de perilla, ya existe, sin código». Es cierto del caso de uso, no de la consola ni del CLI (§3, fila 14). En Motor2 el equivalente **sí** tiene vía (el script), pero hoy solo para dos booleanos.
3. **Cantidad de perillas:** la auditoría de paridad del 14/11 cuenta 11; el código tiene 12 (`venta_por_fracciones_y_peso`).
4. **Módulos «disponible»:** los docs de Pedernal dicen que `catalogo`, `caja`, `ventas` y `vidriera` pasan a disponible; el código los marca `en_desarrollo`. Motor2 se iguala al código, no al documento.
5. **N3/N4 de compras:** el documento dice «se habilitan por perillas del plan»; en el código la perilla no se declara y el caso de uso rechaza el nivel siempre.

## 5. Qué no verifiqué
- Si `Empresa.llevaIvaDeCompras` tiene algún lector fuera de `src/`, `plataforma/` y `scripts/` (el `grep` dio vacío salvo pruebas).
- Si algún lugar cachea la política de empresa en Motor2 (`politicaDeEmpresa` lee directo; no auditó cachés de sesión).
- Cómo valida la consola de Motor2 el TOTP por comando y si manda clave de idempotencia (solo vi que repetir da «Sin cambios»).
- `h4b-permisos-configurables.md` y `permisos-dimensiones.md` completos (solo por búsqueda de palabra clave); el uso real de `composiciones_por_tamano` y `conjuntos` en Pedernal.
- Si en producción de Pedernal hay un plan cargado y con qué módulos; estado real de las bases de Motor2.
- Ninguna prueba ni migración se ejecutó.
