# E-8: ids `UUID` también en las tablas viejas — diseño niveles 6 a 10 (frente 3, datos)

Fecha: 2026-11-17. Estado: **PROPUESTA — documento, sin código ni migraciones** (el orquestador general confirma el documento antes; ninguna migración se aplica en bases reales: congelamiento vigente). Niveles 1 a 5: `docs/diseno-datos-paridad-pedernal-2026-11-16.md` (decisión N4-3). Decisiones del dueño relatadas por el orquestador: «También las viejas» (ids uuid en las tablas viejas, 2026-11-16) y «si antes del despliegue» (2026-11-17). Es la etapa **más pesada y más riesgosa** del frente: reescribe el id de **todas** las filas y todas las referencias a ellas. Requiere autorización expresa por base, con respaldo y ensayo en una rama de Neon.

## 0. Qué hay que mover, con números verificados contra el código (2026-11-17)

- **137 modelos**: **110 con `id` de texto `cuid()`** (los que se convierten), **25 ya `UUID` nativo** (los nacidos desde E-0), 2 con otra forma (`VerificationToken`, `Accion`).
- **444 claves foráneas** declaradas en `schema.prisma`; **411 apuntan a tablas con id cuid** (a `Empresa` 121, a `User` 60, a `Sucursal` 59, a `Producto` 30…). Cada una es una columna que cambia de tipo junto con su padre.
- **6 columnas `*Id` sin clave foránea** (referencias sueltas que el motor no protege y hay que convertir a mano): `RegistroAuditoria.entidadId` (apunta a cualquier tabla), `Account.providerAccountId`, `ModoDeOrdenDeSeccionCarta.actualizadoPorId`, `RecetaVersion.basadaEnVersionId`, `AuditoriaPlataforma.adminId` y `AuditoriaPlataforma.empresaAfectadaId`. Más cualquier id guardado **dentro de un JSON** o de un texto (**NO VERIFICADO**: lo barre el recuento previo, §10).
- **405 políticas de seguridad** (RLS) en 55 migraciones usan `app_empresa_actual()` (devuelve texto) y comparan `empresaId`: Postgres **no deja cambiar el tipo de una columna que una política usa**, así que hay que sacarlas y volver a ponerlas idénticas. **20 funciones** de las migraciones reciben o devuelven ids de texto.
- Aplicación: el motor de Prisma genera hoy el id (`@default(cuid())`) en **cada alta de las 110 tablas**; las pantallas, los guardas y 19 archivos de prueba asumen ids con forma de cuid (por ejemplo `cnoexiste000000000000000`); hay un tope de largo «los ids son cuid, ~25» (`src/server/actions/catalogo/productos.ts:512`).

## 6. Historia y persistencia

**Opciones (una sola pregunta de fondo, ya respondida por el dueño: «También las viejas»; se documenta por qué es la única que cumple lo que pidió):**

| Opción | Qué es | Veredicto |
|---|---|---|
| **A — convertir todo con una función determinista (recomendada)** | Una función pura `uuid_desde_id_viejo(texto)` (hash de un espacio de nombres fijo de Motor2 + el id viejo, con los bits de versión y variante de un uuid válido) da **siempre el mismo uuid para el mismo id**. Se aplica a cada `id` y a cada columna que lo referencia. Un id que ya es uuid se deja igual. | Cumple «también las viejas», es reproducible y **idempotente**, y no necesita tablas de correspondencia para conservar las referencias. |
| B — solo las nuevas | Dejar las 110 con cuid. | No cumple lo pedido. |
| C — uuid nuevo al azar por fila + tabla de correspondencia | Cada fila recibe un uuid aleatorio y se reescriben las referencias consultando la tabla. | Funciona, pero no se puede repetir (cada intento da ids distintos) y las referencias sueltas/JSON no se resuelven solas. Descartada. |

**Trazabilidad (regla «no se borra, se anula»):** antes de reescribir, se guarda en una tabla de solo inserción `IdAnteriorDeTabla(tabla, idAnterior, idNuevo, migradoEn)` **todos los pares**. Sirve para (1) la reversa exacta, (2) responder «¿qué era este id?» y (3) redirigir enlaces viejos **si el dueño lo pide** (no se construye: «Lo que el dueño no pidió no entra»). Se conserva hasta que el dueño confirme el despliegue. Nace con el molde (E-0): id uuid, instante con zona, sin DELETE para la app.

**Esquema:** `id` pasa a `@id @db.Uuid`; el default pasa de `cuid()` a **`@default(uuid())`** (Prisma genera el uuid en cada alta, sin tocar los cientos de sitios de alta). Esto es **una diferencia declarada con el molde de las tablas nuevas** (donde manda la aplicación con `azar.uuid()`): motivo, el costo de cambiar 110 tablas de alta; el resultado en la base es el mismo (id uuid v4 sin repetición). **Decisión técnica propuesta**, el dueño la corrige si no es así.

## 7. Atomicidad y concurrencia

- **Una ventana de mantenimiento por base, con la aplicación detenida** (no hay forma segura de convertir ids con usuarios escribiendo: una alta con id cuid en medio del cambio quedaría huérfana).
- **Una sola transacción por base** (no por tabla): las claves foráneas cruzan todo el modelo, así que un estado a medias (padres convertidos, hijos no) es inválido. Si algo falla, **la transacción entera vuelve atrás** y la base queda como estaba (Postgres permite DDL transaccional).
- Pasos dentro de la transacción: (1) guardas (§10); (2) llenar `IdAnteriorDeTabla`; (3) guardar la definición de las 405 políticas y los 444 `FOREIGN KEY` desde el catálogo (`pg_get_constraintdef`, `pg_policy`) en una tabla temporal; (4) sacar políticas y claves foráneas; (5) por tabla, `UPDATE` de `id` y de cada columna que lo referencia con la función determinista y `ALTER COLUMN … TYPE UUID USING …`; (6) `app_empresa_actual()` y las 20 funciones pasan a uuid (se recrean); (7) volver a poner claves foráneas (validadas) y políticas **desde las definiciones guardadas**, y comparar contra el catálogo original (mismo conteo, mismo texto); (8) `ANALYZE`.
- **Idempotencia:** si todas las columnas ya son uuid la migración no hace nada; correrla dos veces no cambia nada.
- **Concurrencia después de la ventana:** nada especial; los ids nuevos son `uuid()` sin choque.

## 8. Acceso e interfaces

- **Sesión y cookies:** el id de usuario cambia, así que **todas las sesiones abiertas se invalidan** (hay que volver a ingresar); la cookie de «empresa activa» trae un id viejo y el código ya cae en la primera empresa del usuario si no le pertenece (ver `ContextoUsuario`). Antes del despliegue no hay usuarios reales que se vean afectados: **declarado, no oculto**.
- **Enlaces viejos** (`/productos/<id>`, marcadores) dejan de resolver (devuelven «no encontrado»).
- **Validación en el borde (fallo cerrado):** con un id que no es uuid, Postgres/Prisma lanzan un error de conversión en lugar de «no encontrado» (hoy un id inventado simplemente no matchea). **Hay que validar la forma de uuid en el guard de cada punto de entrada que recibe un id** (URL, formulario, acción) y devolver el rechazo genérico; un ayudante central evita repetirlo. Sin esto una URL con basura sería un error 500: es parte de la etapa, no un agregado.
- **Aplicación:** quitar el tope «cuid ~25» y los tests con ids falsos con forma de cuid (19 archivos) pasan a ids uuid inexistentes. Cambio mecánico, en un PR aparte **después** de la migración (el código acepta los dos formatos durante la ventana).
- **Permisos y RLS:** quedan **idénticos** (se vuelven a crear desde el catálogo); el guardián de arquitectura de RLS y la suite de aislamiento son la prueba.
- **Prisma:** 110 modelos con `@db.Uuid` y `@default(uuid())`: **zona restringida**, un solo PR mecánico, por turno del orquestador y al final.

## 9. Consultas y experiencia

- Orden por id: los cuid se ordenaban casi por fecha de creación; los uuid v4 **no**. Cualquier lugar que ordene o pagine por `id` esperando orden de alta cambia de comportamiento: se busca antes (**NO VERIFICADO**) y se reemplaza por el instante de creación.
- Los ids se muestran poco al cliente; lo que ve (códigos, nombres) no cambia.
- El rendimiento de índices por uuid es equivalente a texto en estas tablas chicas; no hay costo visible.

## 10. Pruebas, migración y operación

**Pruebas (antes del PR de la migración):**
1. Subir-bajar-subir sobre base temporal migrada **con datos en todas las tablas** (semilla completa): tras subir, (a) todas las columnas `id` y las 411 claves foráneas son `uuid`; (b) **cada fila vieja se reencuentra** por su id nuevo = función(id viejo) y no se perdió ninguna (conteo por tabla igual); (c) **cero huérfanos** en las 444 claves foráneas; (d) las 405 políticas y las 20 funciones tienen el mismo texto que antes salvo el tipo; (e) las columnas sueltas y los JSON recontados se convirtieron.
2. Reversa con datos: `down.sql` devuelve los ids originales usando `IdAnteriorDeTabla`, y la foto del catálogo (columnas, claves, políticas) es idéntica a la de antes de subir.
3. Idempotencia: correr dos veces = una. Falla cerrada: una fila con un id duplicado después de la función (colisión) **aborta** y nombra la tabla.
4. Suite de aislamiento y de RLS completas sobre la base ya convertida: ninguna política cambió de efecto.
5. Guardián de arquitectura: tablas nuevas siguen exigiendo uuid (E-0); se retira la excepción de las viejas al terminar.

**Guardas / recuento previo (solo lectura, por base):** versión de Postgres; que **ninguna** tabla tenga un id que ya parezca uuid pero no lo sea; conteo de filas por tabla; las referencias sueltas y los ids dentro de JSON/texto (búsqueda de cada columna de texto contra la tabla de ids viejos, para encontrar las que no tienen clave foránea); colisiones de la función sobre los ids reales (tiene que dar cero); espacio libre para duplicar temporalmente las tablas chicas.

**Ensayo y despliegue (por base, autorización expresa del dueño):** respaldo → copia en rama de Neon → recuento previo → ensayo completo con las pruebas 1 a 4 sobre la copia **con datos reales** → ventana → migración → mismo recuento y suite de humo → reabrir. Si cualquier comparación falla, **se vuelve atrás** (la transacción, o `down.sql` si ya se confirmó).

**Orden con E-6:** son migraciones separadas (cada una con su PR y su `down.sql`) pero **se aplican en la misma ventana** en cada base: primero E-6 (instantes), después E-8 (ids), para no abrir dos ventanas.

**«¿Qué pasa si…?»**

| Caso | Resultado esperado |
|---|---|
| Se aplica dos veces | La segunda no hace nada. |
| Corte a mitad | Una transacción: no queda nada a medias. |
| Hay una referencia que la migración no conoce (JSON, texto) | El recuento previo la lista y **bloquea**; se resuelve antes de la ventana. |
| Alguien escribe durante la ventana | No puede: la aplicación está detenida; la base rechaza conexiones de la app (`motor2_app`) durante el cambio. |
| Se pega a mano una URL con un id viejo | «No encontrado» (rechazo genérico), nunca un error 500. |
| Se vuelve para atrás | `down.sql` con `IdAnteriorDeTabla`; los ids originales vuelven y las sesiones se invalidan otra vez. |
| Una política queda distinta | La comparación contra el catálogo original lo detecta y **aborta**. |
| Un id nuevo choca con uno convertido | Imposible en la práctica (uuid v4 de 122 bits); la restricción de clave primaria lo frena igual. |

**Combinaciones (regla del 2026-10-28):** las dimensiones que cambian el resultado son *tabla con/sin referencias sueltas*, *tabla con políticas por sucursal*, *id que ya era uuid* y *sesión abierta*; la tabla esperada va escrita aparte del código en la prueba 1.

**Necesidad que resuelve (poda):** igualar a Pedernal («Necesitamos ser iguales en todo», 2026-11-13) y ya no mezclar dos formatos de id en el modelo: decisiones «También las viejas» (2026-11-16) y «si antes del despliegue» (2026-11-17), relatadas por el orquestador. **Prueba para el dueño:** después de la ventana, entrar, abrir una venta, un producto, una factura y un cierre de caja **hechos antes** y ver los mismos datos; probar una URL con un id inventado y ver «no encontrado»; probar con dos sucursales que cada una sigue viendo solo lo suyo.

## Qué NO verifica este documento

Los ids guardados dentro de JSON o de textos sueltos; los lugares que ordenan por id; el tamaño real de cada tabla; la versión de Postgres y el espacio de cada base de Neon; privilegios reales de producción. Todo eso lo mide el recuento previo y el ensayo sobre la copia **antes** de pedir autorización. Tampoco se construyó nada de código de la etapa.
