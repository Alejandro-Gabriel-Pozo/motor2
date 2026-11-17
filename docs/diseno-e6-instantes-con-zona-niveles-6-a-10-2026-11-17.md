# E-6: instantes con zona (`TIMESTAMPTZ`) en las columnas viejas — diseño niveles 6 a 10 (frente 3, datos)

Fecha: 2026-11-17. Estado: **PROPUESTA — documento, sin código ni migraciones** (el orquestador general confirma el documento antes de que se escriba una línea; ninguna migración se aplica en bases reales: congelamiento vigente). Niveles 1 a 5: `docs/diseno-datos-paridad-pedernal-2026-11-16.md` (decisión N4-2 y etapa E-6: «si antes del despliegue» → se hace antes del despliegue, cita del dueño 2026-11-17 relatada por el orquestador). Esta etapa **reescribe tablas**: requiere autorización expresa por base, con respaldo y ensayo en una rama de Neon.

## 0. Qué se hace, con números verificados contra el código (2026-11-17)

- `schema.prisma`: **182 campos DateTime**; **43 ya son `Timestamptz(3)`**, **120 son `timestamp(3)` sin zona** (los que se convierten), 17 son `@db.Date` (fecha de negocio; no se tocan) y 2 son `@db.Time` (no se tocan). Los 120 están repartidos en **83 modelos**.
- **103 de esas columnas** tienen `DEFAULT CURRENT_TIMESTAMP` en la base; Prisma, para `@default(now())`, manda la hora desde la aplicación (UTC), así que el default de la base solo actúa en inserciones a mano (semillas, migraciones, scripts).
- Superficie SQL verificada por búsqueda en las migraciones: **no hay vistas**; las únicas funciones con tipos de instante ya son `timestamptz` (`caja_fecha_de_negocio`, caja C1/C2); los índices parciales que miran instantes solo usan `IS NULL` (no comparan horas); las políticas de seguridad miran empresa y sucursal, no instantes. **NO VERIFICADO** en una base real: lo comprueba `verificacion-previa.sql` (§10) con el catálogo (`pg_depend`), no solo por búsqueda de texto.

## 6. Historia y persistencia

| Tema | Diseño | Estado |
|---|---|---|
| El cambio | Por columna: `ALTER TABLE "T" ALTER COLUMN "c" TYPE TIMESTAMPTZ(3) USING "c" AT TIME ZONE 'UTC'`. El valor guardado era **hora UTC sin marca** (así escribe Prisma); la conversión la declara UTC y **no cambia ningún instante**. | PROPUESTA |
| Condición que hay que probar | Que **todas** las filas viejas estén en UTC. Riesgo concreto: las 103 columnas con `DEFAULT CURRENT_TIMESTAMP` guardan la hora **de la zona de sesión del servidor** al insertar a mano; si alguna base corrió con zona distinta de UTC, esas filas quedarían corridas horas. | NO VERIFICADO |
| Cómo se prueba | `SHOW timezone` y `pg_db_role_setting` de cada base; y por tabla un control de «no hay instantes en el futuro» (`max(c) > now() AT TIME ZONE 'UTC' + 1 día` marca un corrimiento). Si una base no es UTC, la migración **aborta** y se corrige a mano con el dueño: nunca se «arregla» en silencio. | PROPUESTA |
| Historial | Es un cambio de tipo, no de significado: no se agrega historial. Se guarda, antes de aplicar, la huella por tabla (§10) para demostrar después que ningún instante cambió. | PROPUESTA |
| Reversa | `down.sql`: `TYPE TIMESTAMP(3) USING "c" AT TIME ZONE 'UTC'` (vuelve a hora UTC sin marca; sin pérdida porque ambos guardan hasta milisegundos). | PROPUESTA |
| Default de la columna | Se conserva `CURRENT_TIMESTAMP` (en `timestamptz` ya es un instante absoluto). Pedernal usa `now()`: equivalente. | PROPUESTA |

## 7. Atomicidad y concurrencia

- **Un cambio de tipo toma bloqueo exclusivo de la tabla** y puede reescribirla (con la zona de sesión en UTC Postgres puede evitar la reescritura de `timestamp → timestamptz`; **NO VERIFICADO en la versión de Neon**, lo mide el ensayo). Con pocos datos reales el costo es de segundos, pero igual se hace **en ventana de mantenimiento**: la aplicación detenida o en solo lectura mientras corre.
- **Una transacción por tabla** (todas las columnas de esa tabla juntas): si falla, la tabla queda como estaba; el orden entre tablas no importa (los instantes no tienen claves foráneas entre sí).
- Mientras corre, un escritor concurrente espera el bloqueo y después escribe con el tipo nuevo: Prisma manda un `Date` (instante) y el servidor lo acepta en los dos tipos, así que **el código no necesita cambiar antes ni después** (compatible hacia adelante y hacia atrás).
- Idempotencia de la operación: cada paso empieza con «si la columna ya es `timestamptz`, no hacer nada»; correrla dos veces no rompe nada y el segundo corrido no reescribe.

## 8. Acceso e interfaces

- **Prisma:** se agrega `@db.Timestamptz(3)` a los 120 campos; el cliente generado devuelve el mismo `Date`. Cambio de `schema.prisma` en **~83 modelos de otros frentes: zona restringida**, por turno del orquestador, **en un solo PR mecánico y al final** (después de que los frentes 1, 2, 5, 6 y 7 terminen de tocar sus modelos), para no chocar.
- **Permisos:** sin cambios (no se tocan grants ni políticas).
- **Raw SQL del código** (33 archivos usan `$queryRaw`/`$executeRaw`): el servidor compara `timestamptz` con `timestamptz`; un `timestamp` literal sin zona en una consulta a mano se interpretaría en la zona de sesión: se revisa cada uno de los que mencionan columnas convertidas (los de caja ya usan `timestamptz`). **NO VERIFICADO**: lista cerrada al escribir la migración.
- **Mostrar fechas:** E-6 no cambia lo que ve el cliente; la conexión de `fechaParaMostrar` (zona de la empresa) sigue siendo del frente 6 (inventario de fechas, `motor2-docs/_coordinacion/`).

## 9. Consultas y experiencia

- Los filtros por rango de instante no cambian de resultado (mismo instante). Los de «día» siguen usando la **fecha de negocio** (`fechaDeNegocio`, frente 1), no un `date_trunc` sobre el instante.
- Los reportes que agrupan por día calendario con `date_trunc` sobre un `timestamp` quedaban en UTC; sobre `timestamptz` dependen de la zona de sesión → se revisan (los hay solo si usan SQL a mano: ver §8) y se reemplazan por el día de negocio.

## 10. Pruebas, migración y operación

**Pruebas (antes de escribir el PR):**
1. Subir-bajar-subir sobre base temporal migrada, **con filas de todas las clases de columna** (con y sin default, nulas, en el borde de medianoche UTC y de cambio de día en Buenos Aires): el **valor en milisegundos desde la época es idéntico antes y después**, en cada columna.
2. Prueba de la guarda: una base con zona de sesión ≠ UTC (o con una fila a futuro) aborta nombrando tabla y columna.
3. Prueba de idempotencia: correr dos veces = una; bajar dos veces no falla.
4. Guardián de arquitectura: ninguna migración nueva puede crear una columna `TIMESTAMP` sin zona (el del molde de tabla nueva ya lo hace desde E-0; se quita su excepción para las viejas cuando termine E-6).

**Ensayo y despliegue (por base, con autorización expresa del dueño):** respaldo → ensayo en rama de Neon con copia → `verificacion-previa.sql` (zona de sesión, filas a futuro, dependencias de políticas/vistas/índices de cada columna, conteo y huella por tabla: `sum(extract(epoch from c))` y `count(*)`) → ventana → migración → `verificacion-previa.sql` otra vez (la huella tiene que ser **igual**) → prueba humana (§ abajo). Si la huella difiere, **se baja** con `down.sql` y no se reabre la aplicación.

**«¿Qué pasa si…?»**

| Caso | Resultado esperado |
|---|---|
| Se aplica dos veces | La segunda no hace nada (cada columna ya es `timestamptz`). |
| Corte a mitad de camino | Una transacción por tabla: las tablas hechas quedan hechas y la que falló, intacta; se reanuda. |
| La base no está en UTC | Aborta antes de tocar nada y avisa cuál; no se corrige sola. |
| Escribe la aplicación durante la ventana | Espera el bloqueo; no se pierde ni se corre ningún dato. |
| Se vuelve para atrás | `down.sql`; la huella tiene que volver a ser la inicial. |
| Hay una fila con fecha a futuro | Señal de zona mal en esa base: aborta y se decide con el dueño. |

**Combinaciones (regla del 2026-10-28):** las dimensiones que cambian el resultado son *columna con/sin default*, *nula/no nula*, *zona de sesión de la base* y *versión de Postgres*; la tabla esperada («el instante en ms es idéntico») va en la prueba 1, escrita aparte del código.

**Necesidad que resuelve (poda):** igualar a Pedernal («Necesitamos ser iguales en todo», 2026-11-13) y evitar que una fecha cambie de día según la zona de quien consulta; decisión N4-2 y «si antes del despliegue» (2026-11-17, relatadas por el orquestador). **Prueba para el dueño:** abrir una venta o una factura hecha antes de la migración y ver **la misma fecha y hora** que antes; revisar que ninguna cierre de caja cambió de día.

## Qué NO verifica este documento

Zona de sesión y contenido real de cada base; versión de Postgres de Neon y si evita la reescritura; la lista cerrada de SQL a mano que toca columnas convertidas; el tamaño real de cada tabla. Todo eso lo mide el ensayo en la rama de Neon antes de pedir autorización.
