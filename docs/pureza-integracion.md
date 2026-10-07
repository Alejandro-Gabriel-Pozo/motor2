# Rama integradora de la pureza (`pureza-integracion`): lista de control

> Estado: **abierta el 2026-10-07**. Decisión del dueño (2026-10-07): **no un PR por paso o por fase, sino una rama que integra**, con una sola auditoría por hito y no por PR. Este documento es la **fuente única de verdad** de la rama: cada trabajo se anota acá al hacerse, y la auditoría final compara el código contra esta lista y contra `docs/plan-fase-4-pureza.md` (secciones 10 y 11), nunca contra un resumen de la conversación.

## 1. Reglas de la rama

> Alcance (aclarado por el dueño, 2026-10-07): esta rama es **solo** para corregir lo que quedó con reservas en las Fases 0 a 3 y para lo que falta de la Fase 4. La Fase 5 y todo lo que le sigue vienen después.

1. **Un commit por trabajo**, atómico y revertible por sí solo (un cambio estructural nunca se mezcla con uno de comportamiento). La rama se fusiona a `main` con **merge commit, no squash**: con squash se pierde la reversión paso a paso.
2. **En cada commit:** verificaciones breves en local (`tsc`, `lint`, `arquitectura`, `knip` y los tests de la zona tocada; las pruebas con base se corren **de a una**). Cada regla o test nuevo con su **mutación demostrada** (rojo → revertido → verde), anotada en la columna «Evidencia».
3. **En cada hito** (sección 3): el gate completo en local de lo tocado cuando es barato, se sube la rama (una corrida de CI) y se pasa el **auditor independiente** del hito (agente con modelo igual o superior, solo lectura) contra esta lista. Los hallazgos se corrigen **dentro de la rama** antes del hito siguiente.
4. **Se mezcla `main` en la rama** al arrancar cada hito (no se rebasa), y se resuelven los conflictos ahí.
5. **Quedan FUERA de la rama** (cada uno, aparte y con autorización expresa o decisión del dueño): la **Fase 5 [MIG]** (migraciones, base por base, simulación primero, `down.sql`), cualquier cosa que toque producción, y la **Etapa A** (su propia rama de integración). La **Fase 6** va en su propia rama integradora después de esta.
6. **Se fusiona a `main` solo** con: Gate verde, auditoría final sin hallazgos críticos abiertos, las decisiones de la sección 4 resueltas, y esta lista sin casillas «pendiente» salvo las que digan «diferido por escrito a …».

## 2. Cómo se usa esta lista

Cada fila: **ID**, qué es, fuente en el plan, estado (`[ ]` pendiente, `[x]` hecho, `[d]` diferido por escrito) y **evidencia** (commit, test y mutación). Una fila que entrega menos que lo que pide su fuente se marca `[~]` con la diferencia escrita.

## 3. Hitos y trabajos (en el orden de ejecución)

### Hito 1: guardianes y huellas (protegen todo lo que sigue; sin cambio de comportamiento salvo donde se dice)

| ID | Trabajo | Fuente | Estado | Evidencia |
|---|---|---|---|---|
| 1.1 | Huella de `vincularCuentaConInvitacion` (login) | 10.4 fila 1; auditoría de #82 | [ ] | |
| 1.2 | Huella de la alta de admin con azar inyectado (byte a byte) | 10.4 fila 1; auditoría de #86 | [ ] | |
| 1.3 | Valor de ficha `permiso=SIN_PERMISO` (D-7) | plan §5 D-7 | [ ] | |
| 1.4 | El analizador detecta **referencias** (`Math.random`, `fetch`, `Date.now`, `randomUUID` usados como valor), no solo llamadas; con mutación | 11.2 #5 | [ ] | |
| 1.5 | `reintentar.ts` y `conTransaccionSerializable` reciben el azar del borde (sin `Math.random` por defecto en core) | 11.2 #5 | [ ] | |
| 1.6 | `core/correo/resend.ts` sale de `core` a un adaptador; `core/correo/enviar.ts` deja de importar `@/lib/reportar-error` | 11.2 #5, #19 | [ ] | |
| 1.7 | `esChoqueDeIndiceUnico` en `registrar-conteo-fisico`, `registrar-pago-consignante` y `carta/registro-publico` + regla «los casos de uso no importan `Prisma` como valor» (**corrige un camino de idempotencia**) | 11.2 #2 | [ ] | |
| 1.8 | La regla de internals se amplía a `proxy.ts`, `env.ts`, `server/{acceso,carta-publica,adaptadores}` y la consola; `carta/public.ts` expone lo que usa el proxy; `ciclo-de-vida.ts` usa `public-servidor` | 11.2 #6 | [ ] | |
| 1.9 | Guardián: un componente `"use client"` no importa `public-servidor.ts` | 11.2 #7 | [ ] | |
| 1.10 | La auditoría de dinero ve `$executeRaw` sobre columnas `Decimal` (decisión del dueño sobre el vínculo: 4.3) | 11.2 #3 | [ ] | |
| 1.11 | Ficha: campo `periodo` (o diferido por escrito a la Etapa A, 4.5) y fichas/exclusión declarada para los flujos de la consola y `operaciones-de-plataforma` | 11.2 #8 | [ ] | |
| 1.12 | `consultas-solo-lectura-y-ui-sin-base` cubre `server/acceso/`; regla `paginas-solo-consultas`; guardián de reloj leído desde `server/persistencia` | 11.2 #9 | [ ] | |
| 1.13 | Comentario falso de `ALCANCE_CARTA_PUBLICA` corregido; codemod de imports versionado (D-11) | 11.2 #9; D-11 | [ ] | |

### Hito 2: redes de pruebas (antes de mover más código)

| ID | Trabajo | Fuente | Estado | Evidencia |
|---|---|---|---|---|
| 2.1 | Los 10 tests de hora fija que faltan (cancelar/resolver conteo, cerrar cuenta, 7 de traspasos) | 11.2 #10 | [ ] | |
| 2.2 | Caracterización de los reportes (C0) con conteo de consultas por reporte | 11.2 #11 | [ ] | |
| 2.3 | Caracterización «.0» del tramo A de la Fase 3 (mesas, cuenta, ticket, ítems agrupados, precargados) | 11.2 #11 | [ ] | |
| 2.4 | Test de conteo del N+1 de grupos de insumos | 11.2 #12 | [ ] | |
| 2.5 | Propiedades (`fast-check`) del guard de acceso | 11.2 #13 | [ ] | |
| 2.6 | Clasificación declarada de tablas (en lugar de contadores fijos) | 11.2 #14 | [ ] | |
| 2.7 | **Ampliar la matriz de la venta** a ~30 escenarios (precio local, POS sin stock negativo, insumo sustituto, consignación, cierre real del POS) | 10.4 fila 5 | [ ] | |

### Hito 3: login y gobierno (tramo B)

| ID | Trabajo | Fuente | Estado | Evidencia |
|---|---|---|---|---|
| 3.1 | **B3**: nace `server/sesion/` con `acceso`; 2 casos de uso de aceptar invitación | 10.4 fila 2 | [ ] | |
| 3.2 | **B4a/B4b**: lecturas de decisión a `server/lecturas/permisos`, gerencia, 5 casos de uso de invitaciones de usuario | 10.4 fila 3 | [ ] | |
| 3.3 | Migración de las acciones de auth y permisos (5 archivos, 12 funciones) | 10.4 fila 3 | [ ] | |
| 3.4 | **ADR-027** escrito (hoy no existe) y **F1 del RBAC** (piso «administrador de sistema», sin migración; con D15 = ninguna acción de empresa por defecto y D16 = `ver_auditoria` en ese piso, ya decididas) | 10.4 fila 3 | [ ] | |

### Hito 4: migración de las acciones (tramo C restante)

| ID | Trabajo | Fuente | Estado | Evidencia |
|---|---|---|---|---|
| 4.1 | POS: apertura y mesas (6 casos de uso) → pedido (4; `agregarItems` al final, con test de conteo) | 10.4 fila 4 | [ ] | |
| 4.2 | Dinero de carta (11) | 10.4 fila 4 | [ ] | |
| 4.3 | Configuración de catálogo (19) y stock (14) y restos (7); D-9: auditar `renombrarOFusionarInsumo` en commit aparte | 10.4 fila 4 | [ ] | |

### Hito 5: venta, frontera de la carta y cierre

| ID | Trabajo | Fuente | Estado | Evidencia |
|---|---|---|---|---|
| 5.1 | **Segundo tiempo de la venta** (`armarLinea` y `cargarDeudaDeRedondeo` a `server/lecturas`, lo puro a `core`) | 10.4 fila 5 | [ ] | |
| 5.2 | **4A-5** precio local y capacidades a `server/acceso` (frontera `ALCANCE_CARTA_PUBLICA`; **autorizado el 2026-10-07**, commits propios al final del hito, con las 3 mutaciones de seguridad y revisión del auditor sobre esa frontera) | 10.4 fila 6 | [ ] | |
| 5.3 | Decidir el destino de `con-reintento` y sacar `core/movimientos` a `core-sin-consultas` | 10.4 fila 7 | [ ] | |
| 5.4 | **B5**: auditoría a `server/auditoria/` con su regla, cierre de `core-sin-consultas` para todo `core`, documentos de estado | 10.4 fila 8 | [ ] | |

### Fuera de los hitos, con decisión del dueño (sección 4)

| ID | Trabajo | Fuente | Estado | Evidencia |
|---|---|---|---|---|
| D.1 | **H8**: las 18 lecturas con solo sesión exigen módulo y permiso (con el mapa aprobado) | 11.2 #1 | [ ] | |
| D.2 | Frontera UI → `server/lecturas` (formalizar o mover) | 11.2 #15 | [ ] | |
| D.3 | `ahora` obligatorio en los 5 reportes; `ctx.ahora` en `auth/usuarios.ts`; `ORDER BY` de `rendimiento-recetas` | 11.2 #16 | [ ] | |
| D.4 | Límite `habilitada` de H7 (la pantalla manda también si la receta propia estaba habilitada) | 10.2 | [ ] | |

## 4. Decisiones del dueño que condicionan la fusión

1. ~~Autorización de **4A-5** (frontera de la carta pública, D-2)~~ **RESUELTA (2026-10-07): autorizada**, en commits propios y revertibles al final del Hito 5, con las 3 mutaciones de seguridad de la carta pública y la matriz de la venta ampliada antes; el auditor independiente revisa esa frontera antes de fusionar.
2. Mapa de **H8** (módulo y acción de cada una de las 18 lecturas).
3. SQL crudo del vínculo proveedor↔producto: ¿se audita o se exceptúa con motivo?
4. Dinero en `number` dentro de `core`: ¿diseño escrito o paso nuevo?
5. Campo `periodo` de la ficha: ¿ahora o diferido por escrito a la Etapa A?
6. Frontera UI → `server/lecturas`.
7. Confirmar D-4 y D-5 de la Fase 3. ~~D15 y D16 de RBAC~~ **RESUELTAS (2026-10-07):** **D15** = el rango intermedio («encargado», opcional por empresa, D0) no alcanza ninguna acción de empresa por defecto; la empresa se las habilita de a una. **D16** = `ver_auditoria` pasa al piso «administrador de sistema» (F1, sin migración).
