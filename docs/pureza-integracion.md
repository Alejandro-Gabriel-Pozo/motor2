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
| 1.1 | Huella de `vincularCuentaConInvitacion` (login) | 10.4 fila 1; auditoría de #82 | [x] | c12a6b78; huella-de-login (15 pasos, estable en dos corridas); mutaciones: sin comparar emails, cualquier cuenta previa sirve |
| 1.2 | Huella de la alta de admin con azar inyectado (byte a byte) | 10.4 fila 1; auditoría de #86 | [x] | 31459b18; huella-de-alta-de-admin con azar fijo; mutaciones: sin conflicto propio, un código de recuperación menos |
| 1.3 | Valor de ficha `permiso=SIN_PERMISO` (D-7) | plan §5 D-7 | [x] | 42a0c3db; SIN_PERMISO + CASOS_SIN_PERMISO (vacía); mutación: cerrar-cuenta declarado SIN_PERMISO |
| 1.4 | El analizador detecta **referencias** (`Math.random`, `fetch`, `Date.now`, `randomUUID` usados como valor), no solo llamadas; con mutación | 11.2 #5 | [x] | 57be2ed7; el analizador detecta referencias; mutación: sin identificadores, falla |
| 1.5 | `reintentar.ts` y `conTransaccionSerializable` reciben el azar del borde (sin `Math.random` por defecto en core) | 11.2 #5 | [x] | 546ddccc; Transaccion.aleatorio desde core/auth/base.ts; mutaciones: sin tomar el azar de la transacción, Math.random de vuelta |
| 1.6 | `core/correo/resend.ts` sale de `core` a un adaptador; `core/correo/enviar.ts` deja de importar `@/lib/reportar-error` | 11.2 #5, #19 | [x] | d19f38f6; resend a src/lib/correo; mutación: fetch dentro de core/correo |
| 1.7 | `esChoqueDeIndiceUnico` en `registrar-conteo-fisico`, `registrar-pago-consignante` y `carta/registro-publico` + regla «los casos de uso no importan `Prisma` como valor» (**corrige un camino de idempotencia**) | 11.2 #2 | [x] | 0bfa8c48; esChoqueDeIndiceUnico en 3 sitios + acciones-sin-prisma-como-valor; mutación: vuelve el instanceof |
| 1.8 | La regla de internals se amplía a `proxy.ts`, `env.ts`, `server/{acceso,carta-publica,adaptadores}` y la consola; `carta/public.ts` expone lo que usa el proxy; `ciclo-de-vida.ts` usa `public-servidor` | 11.2 #6 | [x] | a8c6e33c; sin-internals cubre proxy, env, server/*, lib y la consola; mutaciones en proxy, consola y server/acceso |
| 1.9 | Guardián: un componente `"use client"` no importa `public-servidor.ts` | 11.2 #7 | [x] | e9e13eed; cliente-sin-public-servidor; mutación: un cliente importa public-servidor |
| 1.10 | La auditoría de dinero ve `$executeRaw` sobre columnas `Decimal` (decisión del dueño sobre el vínculo: 4.3) | 11.2 #3 | [x] | 015d8be4 y la auditoría del vínculo (decisión 3 del dueño, 2026-10-08: se audita; entidad ProveedorPorProducto, 5 pruebas); escrituras-auditadas ve $executeRaw, $queryRaw que escribe y SQL no verificable |
| 1.11 | Ficha: campo `periodo` (o diferido por escrito a la Etapa A, 4.5) y fichas/exclusión declarada para los flujos de la consola y `operaciones-de-plataforma` | 11.2 #8 | [x] | d56f34a0 (consola fuera de la ficha, declarada y vigilada) y el campo `periodo` (decisión 5 del dueño, 2026-10-08: ahora): `periodo=NO_APLICA` en las fichas, `VERIFICA_CIERRE` si llama a `verificarPeriodoAbierto` (la función la trae la Etapa A) |
| 1.12 | `consultas-solo-lectura-y-ui-sin-base` cubre `server/acceso/`; regla `paginas-solo-consultas`; guardián de reloj leído desde `server/persistencia` | 11.2 #9 | [x] | ecfbe4f1 y la decisión 6 (2026-10-08): las páginas NO importan server/lecturas; las 5 pasan a consultas nuevas (cadenasDeGrupos, disponibilidad de un producto por sucursal —mudada—, cargarCostosYMargenes, cargarSelectorCartaDeLaMesa) y la lista de excepciones de paginas-solo-consultas queda VACÍA; reloj-y-azar-en-el-servidor (11 consultas en lista, D.3) |
| 1.14 | **Auditar** las 3 altas de documentos que `escrituras-auditadas` exceptuaba (conteo físico, solicitud de traspaso, envío directo de traspaso) con `registrarCambioAuditado` en su caso de uso y **sacar las 3 excepciones** de la lista (con mutación: quitar la auditoría pone el test en rojo). **Decidido por el dueño el 2026-10-07**; cambia comportamiento (filas nuevas en el registro de auditoría), commit aparte | #80; 4.8 | [x] | 899d109a y 87c79198; ConteoFisico y TraspasoSucursal auditables; mutación: el envío directo sin auditoría |
| 1.13 | Comentario falso de `ALCANCE_CARTA_PUBLICA` corregido; codemod de imports versionado (D-11) | 11.2 #9; D-11 | [x] | d70e2f99 (comentario de ALCANCE_CARTA_PUBLICA) y e2243962 (codemod reapuntar-imports, 10 pruebas) |

### Hito 2: redes de pruebas (antes de mover más código)

| ID | Trabajo | Fuente | Estado | Evidencia |
|---|---|---|---|---|
| 2.1 | Los 10 tests de hora fija que faltan (cancelar/resolver conteo, cerrar cuenta, 7 de traspasos) | 11.2 #10 | [x] | 13/13 casos de uso con `actor.ahora` tienen su test de hora fija (3 ya estaban, +7 de traspasos, +cancelar/resolver conteo, +cerrar cuenta); mutación OK |
| 2.2 | Caracterización de los reportes (C0) con conteo de consultas por reporte | 11.2 #11 | [x] | `test/reportes/caracterizacion/reportes-c0.test.ts` + golden: 47 funciones de `consultas/reportes`, resultado y conteo de consultas; mutaciones OK. N+1 vistos (solo informados): rendimiento-recetas (42/15), resumen-consolidado (52) |
| 2.3 | Caracterización «.0» del tramo A de la Fase 3 (mesas, cuenta, ticket, ítems agrupados, precargados) | 11.2 #11 | [x] | `test/caracterizacion-tramo-a/lecturas-tramo-a.test.ts` + golden: 48 casos de resultado completo y conteo; mutaciones OK. Sin cubrir (ya tienen tests o no son del tramo): en-tránsito, clase A, dependencias de desactivar, `publica-sin-sesion`, catálogo productos/recetas/proveedores |
| 2.4 | Test de conteo del N+1 de grupos de insumos | 11.2 #12 | [x] | `test/catalogo/cadenas-de-grupos-consultas.test.ts` (una sola lectura); mutación OK |
| 2.5 | Propiedades (`fast-check`) del guard de acceso | 11.2 #13 | [x] | `test/permisos/decision-de-acceso.propiedades.test.ts`: 12 propiedades; 4 mutaciones OK |
| 2.6 | Clasificación declarada de tablas (en lugar de contadores fijos) | 11.2 #14 | [x] | `test/setup/clasificacion-de-tablas.ts` + guardián `test/arquitectura/clasificacion-de-tablas.test.ts`; los contadores 57/54/61/105 de los 2 tests de base se derivan de la declaración; mutación OK |
| 2.8 | **Dinero en `core`, medido:** prueba de propiedades que compara las sumas y márgenes de `core/reportes` contra el cálculo exacto (Decimal) en datos realistas; asentada la decisión de diseño (la plata exacta vive en la base y en `core/moneda`; `core/reportes` suma en `number` y redondea al presentar). Si la prueba muestra diferencias de centavos, se abre el paso de migración | Decisión 4 del dueño (2026-10-08) | [x] | `test/core/reportes-dinero-medicion.test.ts`. MEDIDO: importes en centavos = exacto siempre; ventas estimadas: 7 de 20.000 totales difían 1 centavo. ARREGLO APLICADO (decisión del dueño 2026-10-08): `calcularVentasDelPeriodo` redondea cada línea estimada con `importeDeLinea`; sin migrar a Decimal; mutación OK |
| 2.7 | **Ampliar la matriz de la venta** a ~30 escenarios (precio local, POS sin stock negativo, insumo sustituto, consignación, cierre real del POS) | 10.4 fila 5 | [x] | `venta-matriz-ampliada.test.ts` + golden: 33 escenarios nuevos (40 con los 7 vigentes) en 5 jornadas; mostrador, POS, consignación, cierre real, rechazos; mutaciones OK. Hallazgos informados (abajo) |

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
| 4.4 | **Auditar los cambios de `stockMinimoProducto.minimo`** (hoy exceptuado como «no es dinero») y sacar esa excepción de `escrituras-auditadas`; **decidido por el dueño el 2026-10-07**, con la migración de `actions/stock/stock-minimo.ts`; commit aparte | 4.8 | [ ] | |

### Hito 5: venta, frontera de la carta y cierre

| ID | Trabajo | Fuente | Estado | Evidencia |
|---|---|---|---|---|
| 5.1 | **Segundo tiempo de la venta** (`armarLinea` y `cargarDeudaDeRedondeo` a `server/lecturas`, lo puro a `core`) | 10.4 fila 5 | [ ] | |
| 5.2 | **4A-5** precio local y capacidades a `server/acceso` (frontera `ALCANCE_CARTA_PUBLICA`; **autorizado el 2026-10-07**, commits propios al final del hito, con las 3 mutaciones de seguridad y revisión del auditor sobre esa frontera) | 10.4 fila 6 | [ ] | |
| 5.3 | Decidir el destino de `con-reintento` y sacar `core/movimientos` a `core-sin-consultas` | 10.4 fila 7 | [ ] | |
| 5.4 | **B5**: auditoría a `server/auditoria/` con su regla, cierre de `core-sin-consultas` para todo `core`, documentos de estado | 10.4 fila 8 | [ ] | |

### Otros hallazgos de las auditorías y de las revisiones (todos entran en la rama; decisión del dueño, 2026-10-07)

Cada uno se hace en el hito indicado, junto con el trabajo que toca el mismo código. Los que dicen «docs» son documentación o comentarios.

| ID | Hallazgo | Origen | Hito | Estado | Evidencia |
|---|---|---|---|---|---|
| O.1 | `guardarReceta` en modo «a ciegas» es alcanzable desde la red (la acción pública acepta `undefined`/`null`): separar el modo ciego en una función interna para seeds y scripts y que la acción pública exija un entero ≥ 0 | Revisión #93 (3) | 4 | [ ] | |
| O.2 | Dos acciones seguidas sin recargar reciben «recargá» aunque la pantalla se refresque sola: distinguir el mensaje o deshabilitar los otros formularios mientras uno está ocupado | Revisión #93 (5) | 4 | [ ] | |
| O.3 | Clave de cifrado de los closures de Server Actions con más de una instancia (`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`): verificar y documentar | Revisión #93 (8, sospecha) | 4 | [ ] | |
| O.4 | Docstrings de `guardarReceta` y del caso de uso: ya no dicen «la UNIQUE es el árbitro final» como único mecanismo | Revisión #93 (7) | 4 | [ ] | |
| O.5 | Carrito de compras: fusionar las derivaciones (empresa y sucursal) en una sola consulta (hoy 3 lecturas por cambio de proveedor) | Revisión #92 (3) | 4 | [ ] | |
| O.6 | Conciliación 11 de `verificar-demo-invariantes` con un cruce realmente independiente (recorrer las compras del par en memoria y recalcular precio, `ultimaCompra` y la regla del precio 0) | Revisión #92 (6) | 2 | [x] | cruce independiente en memoria (precio, fecha, regla del 0); validado en el test de volumen; mutación OK |
| O.7 | Test de volumen de ofertas de proveedor: aserción de tiempo laxa o no bloqueante (propensa a fallar en CI frío) | Revisión #92 (7) | 2 | [x] | tope 30 s y tiempo informado por consola; el test fija el resultado |
| O.8 | Comparativa: listas `in` acotadas y `nombreDe.get(...) ?? ""` → «(proveedor desconocido)» o `continue` | Revisión #92 (8, 9) | 4 | [ ] | |
| O.9 | Docs: `docs/grounding-lista-ver-editar-2026-09-18.md:57` aún lista `ProveedorPorProducto` como fuente de «Proveedores y precios» | Revisión #92 (10) | 1 | [x] | a0baf619 |
| O.10 | Precarga del carrito (`panel-movimiento-form.tsx`) sigue poniendo `unidadCompraId: ""`: o se usa el que calcula el lector o se quita del tipo | Revisión #92 (11) | 4 | [ ] | |
| O.11 | Adaptador de imports de la huella de gobierno (B0) | Auditoría Fase 4 (#82) | 1 | [x] | d70e2f99; adaptador-de-imports de las tres huellas, goldens intactos |
| O.12 | D-9: documentar que `agregarItems` del POS no tiene I3 | Auditoría Fase 4 (D-9) | 4 | [ ] | |
| O.13 | Preparación de la Fase 5 **sin migración** (plan §6): reunir las 2 escrituras de traspasos y las 2 de anulación en una sola función; `EXPLAIN` del índice del Kardex | Plan Fase 4 §6 | 5 | [ ] | |
| O.14 | D-5 del plan (lote de lecturas repetidas de la venta; costo congelado solo de lo vendido): el plan lo deja «explícitamente después» | Plan Fase 4 | — | [d] | Diferido por escrito: se hace después de esta rama |
| O.15 | Guardián de «la fase de un heredado no retrocede» (D-4 se violó cuatro PR sin que nada lo viera) | Auditoría Fase 4 (D-4) | 1 | [x] | 33e6ffcd; fases-de-heredados-no-retroceden; mutación: base.ts a la Fase 4 |
| O.16 | 0.4: con `MOTOR2_ENTORNO_ESTRICTO=1` fuera de Vercel el escape `MOTOR2_ROL_ESTRICTO=0` no se prohíbe | Auditoría Fase 0 (4) | 1 | [x] | fb200771; mutación: otra vez solo Producción |
| O.17 | Asentar la decisión de reemplazar el tipo `FichaCasoDeUso`/`FICHA_PENDIENTE` por la línea `@ficha` (docs) | Auditoría Fase 0 | 1 | [x] | a0baf619; docs/pureza-decisiones-asentadas.md §2 |
| O.18 | Docstring de `pureza-del-nucleo.test.ts` dice «117 de 256» (hoy 38 entradas) y vocabulario `core-sin-prisma`/`core-sin-db-tipos` | Auditoría Fase 0 (7) | 1 | [x] | a0baf619 |
| O.19 | 0.7: escrituras anidadas por relación (`data: { rel: { create } }`) que `clavesDeData` no recorre | Auditoría Fase 0 (9) | 1 | [x] | f4f93642; escrituras anidadas por relación |
| O.20 | 0.7: alcance a `plataforma/src/servidor` y `operaciones-de-plataforma` si una tabla de plataforma suma `Decimal` | Auditoría Fase 0 (10) | 1 | [x] | 1a281baf; sembrarEmpresa exceptuada con motivo |
| O.21 | Reloj y `randomUUID` dentro de `server/persistencia` (`upsert-proveedor-por-producto.ts`: `fechaCompra ?? new Date()`, `crypto.randomUUID()`): sacarlos | Auditoría Fases 0 y 1 (D-7) | 1 | [x] | ecfbe4f1; el id lo genera la base y sin fecha vale now() |
| O.22 | Reloj con valor por defecto en consultas y acciones (`server/consultas/pos/*`, `server/lecturas/carta/*`, `server/actions/reportes/sincronizaciones.ts`): `ahora` obligatorio, como los 5 reportes | Auditoría Fase 1 (D-8) | 4 | [ ] | |
| O.23 | Crear el documento de la Fase 1 que nunca existió (sub-pasos 1.1 a 1.6 solo estaban en los mensajes de PR) | Auditoría Fase 1 | 1 | [x] | a0baf619; docs/pureza-decisiones-asentadas.md §1 |
| O.24 | `core/auth/{acceso,invitacion}.ts` leen el reloj y `process.env`: B3 saca el reloj de `invitacion.ts` y mueve `acceso.ts` a `server/sesion`; lo de `env` va con la Fase 6 y queda declarado | Auditoría Fase 1 (D-9) | 3 | [ ] | |
| O.25 | Registrar el «punto de control con el dueño» de la Fase 2 (no consta) | Auditoría Fase 2 (M-1) | 1 | [x] | a0baf619; docs/pureza-decisiones-asentadas.md §3 |
| O.26 | P1.4: revisar `DOMINIOS_SIN_PUBLIC_TODAVIA` en dos direcciones | Auditoría Fase 2 (M-4) | 1 | [x] | f137d720 |
| O.27 | Regex con escape inútil `"\.ts$"` en `.dependency-cruiser.cjs:80` y `:129` (usar `[.]`) | Auditoría Fase 2 (M-5) | 1 | [x] | fb200771 |
| O.28 | Ciclo de tipos `pos/comanda ↔ pos/impresion` en `CICLOS_CONOCIDOS` | Auditoría Fase 2 (M-6) | 4 | [ ] | |
| O.29 | Docs: `arquitectura-casos-de-uso-2026-09-27.md` habla de `DOMINIOS_CON_PUBLIC`; `descuento-producto-en-un-solo-lugar.test.ts:62` cita un archivo que ya no existe | Auditoría Fase 2 (M-7) | 1 | [x] | a0baf619 |
| O.30 | C4 y C5 de la Fase 3: N+1 de `rendimiento-recetas` y «la página lo calcula dos veces»; lecturas repetidas de `periodo` (costo actual ×3, IPC ×2, precios locales ×2) | Auditoría Fase 3 (C4, C5) | 4 | [ ] | |
| O.31 | `server-only` inconsistente (28 de 30 archivos de `server/consultas/reportes` y 4 de `server/lecturas/carta` no lo llevan): guardián de cuáles deben llevarlo | Auditoría Fase 3 (14) | 1 | [x] | f137d720; server-only-en-consultas-y-lecturas (39 congelados); mutación: una consulta sin server-only |
| O.32 | Cabeceras de `core/reportes/public-servidor.ts` y `core/movimientos/public-servidor.ts` citan archivos que ya no existen; retirar la fachada de `core/reportes` si no tiene lecturas | Auditoría Fase 3 (12) | 5 | [ ] | |
| O.33 | 3B.12 «limitador» sin rastro (`core/permisos/limitador-tasa.ts`) y matriz de acceso «idéntica a lo largo de todo el tramo» no verificable | Auditoría Fase 3 (16) | 3 | [ ] | |
| O.34 | Confirmar que B0 (#82) cubrió el punto «a verificar» de `invitacion.ts:223` | Auditoría Fase 3 | 3 | [ ] | |
| O.35 | Contratos C1 a C6 del RBAC: techo en el alta de sucursal, releer rol y actor dentro de la transacción, regla de «uno mismo», matriz de los roles de nivel administrador editable solo por el gerente, guardián de `Rol.nivel` (la migración `Rol.nivel` es [MIG] y queda fuera de la rama) | Evaluación RBAC | 3 | [ ] | |
| O.36 | Copia externa `para motor 2\_planes\plan-fase-3-pureza.md` sin el encabezado «HECHA» y sin la sección de desvíos | Auditoría Fase 3 (11) | 1 | [x] | la copia externa ya coincide con docs/plan-fase-3-pureza.md (verificado con diff) |
| O.37 | **N+1 de `rendimiento-recetas`** (simples: 42 consultas por reporte; compartidas: 15): las lecturas por pool dentro de un bucle (`aggregate` apertura/cierre, `conteoFisico.findMany`, `groupBy` por día de ancla, `producto.findMany` por pool) se pueden leer de una vez para todos los pools. La red de C0 (trabajo 2.2) ya fija resultado y conteo, así que se puede arreglar sin riesgo de cambiar números. **No se arregló en el Hito 2 porque el Hito 2 es solo de redes de pruebas (no toca `src/`); propuesta: hacerlo en el Hito 4** | Informe de 2.2 | 4 | [ ] | |
| O.38 | **`resumen-consolidado` hace 52 consultas** (un resumen operativo completo por sucursal, 26 cada uno, e incluye el reporte de período entero): crece lineal con las sucursales. Propuesta: que el consolidado pida solo lo que muestra y comparta lo común (catálogo, recetas, IPC) entre sucursales | Informe de 2.2 | 4 | [ ] | |
| O.39 | **Lecturas repetidas** vistas por C0 (no son N+1): `cargarCostosYMargenes` carga dos veces catálogo, recetas, costos y clasificación; `periodo` lee dos veces el IPC y los precios locales; `salud-por-producto` hace 4 `producto.findMany`; el selector de carta del POS hace `capacidadSucursal.findMany` 6 veces en una carga (7 en `cargarPromoCartaParaAgregar`); `generarReporteVentasPorSeccion` 23 consultas | Informes de 2.2 y 2.3 | 4 | [ ] | |
| O.40 | **Hallazgos de comportamiento de 2.3 y 2.7 para el dueño (solo informados, no se tocó nada):** (1) un PV que se produce no reparte entre lotes: la Torta ×2 salió entera del lote que vence antes y lo dejó en −1 con stock en otro lote; (2) el descuento de cliente se aplica también a los componentes de una promo al cerrar la cuenta (Pizza 10000→9000); (3) `cargarCuentaParaCerrar` lee los ítems sin `orderBy` (el orden de las operaciones depende del de inserción); (4) el orden de alertas de stock de un mismo producto y estado en dos secciones no está definido (el `sort` solo mira estado y nombre); (5) el golden del cierre del POS depende del ICU de Node (`Intl`) | Informes de 2.3 y 2.7 | decide el dueño | [ ] | |

### Fuera de los hitos, con decisión del dueño (sección 4)

| ID | Trabajo | Fuente | Estado | Evidencia |
|---|---|---|---|---|
| D.1 | **H8**: las 18 lecturas con solo sesión exigen módulo y permiso (con el mapa aprobado) | 11.2 #1 | [ ] | |
| D.2 | Frontera UI → `server/lecturas` (formalizar o mover) | 11.2 #15 | [x] | resuelto junto con 1.12: la UI pasa por server/consultas |
| D.3 | `ahora` obligatorio en los 5 reportes; `ctx.ahora` en `auth/usuarios.ts`; `ORDER BY` de `rendimiento-recetas` | 11.2 #16 | [ ] | |
| D.4 | Límite `habilitada` de H7 (la pantalla manda también si la receta propia estaba habilitada) | 10.2 | [ ] | |

## 4. Decisiones del dueño que condicionan la fusión

1. ~~Autorización de **4A-5** (frontera de la carta pública, D-2)~~ **RESUELTA (2026-10-07): autorizada**, en commits propios y revertibles al final del Hito 5, con las 3 mutaciones de seguridad de la carta pública y la matriz de la venta ampliada antes; el auditor independiente revisa esa frontera antes de fusionar.
2. ~~Mapa de **H8**~~ **RESUELTA (2026-10-08): lo arma Claude y lo revisa el dueño antes de fusionar**; ccada lectura exige el permiso de la pantalla que la consume, sin claves nuevas; va en el Hito 3 con el RBAC (trabajo D.1). Es el único cambio de seguridad de la rama.
3. ~~SQL crudo del vínculo proveedor↔producto: ¿se audita o se exceptúa con motivo?~~ **RESUELTA (2026-10-08): se audita** (trabajo 1.10).
4. ~~Dinero en `number` dentro de `core`: ¿diseño escrito o paso nuevo?~~ **RESUELTA (2026-10-08): se escribe como diseño y se mide** (trabajo 2.8); solo se abre un paso de migración a Decimal si la medición muestra diferencias de centavos.
5. ~~Campo `periodo` de la ficha: ¿ahora o diferido por escrito a la Etapa A?~~ **RESUELTA (2026-10-08): ahora** (trabajo 1.11).
6. ~~Frontera UI → `server/lecturas`.~~ **RESUELTA (2026-10-08): la UI no importa `server/lecturas`**; pasa por `server/consultas` (trabajo 1.12; D.2 cerrado).
8. ~~Las excepciones de la auditoría de dinero (3 altas de documentos y `stockMinimoProducto.minimo`)~~ **RESUELTA (2026-10-07): se auditan** (trabajos 1.14 y 4.4).
9. ~~Registrar formalmente D-3 a D-6 de la Fase 3~~ **RESUELTA (2026-10-07): registradas** tal como se aplicaron (`para motor 2\_planes\_decisiones-del-dueno-2026-10-07.md` y `docs/plan-fase-3-pureza.md`).
7. Confirmar D-4 y D-5 de la Fase 3. ~~D15 y D16 de RBAC~~ **RESUELTAS (2026-10-07):** **D15** = el rango intermedio («encargado», opcional por empresa, D0) no alcanza ninguna acción de empresa por defecto; la empresa se las habilita de a una. **D16** = `ver_auditoria` pasa al piso «administrador de sistema» (F1, sin migración).
