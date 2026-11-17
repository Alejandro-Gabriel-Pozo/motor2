# DEMO: ver la aplicación en vivo con usuario y clave de demostración — diseño niveles 1 a 10 (frente 3)

Fecha: 2026-11-17. Estado: **PROPUESTA — documento, sin código** (se pide el visto del orquestador antes de escribir una línea). Origen: el dueño, 2026-11-17, chat (registrado en `motor2-docs` por el orquestador): «que tan factible es desplegar otro proyecto de vercel para mirar la app y que no tenga el login de google así, puedo ver este progreso en vivo?» → autorizó una base de demostración NUEVA en Neon y reconectar el proyecto Vercel `motor2-demo` («1.si me habia olvidado de motor2-demo; 2.- cuando te pida»): **el despliegue lo hace el orquestador, solo cuando el dueño lo pida**. Mi parte (pedido del orquestador): (1) el ingreso de demo, (2) la semilla de demo, (3) el script de preparación de la base. Reglas: «Todo nace cerrado» (falla cerrado), «Lo que el dueño no pidió no entra», «Primero la opción más barata».

Marcas: **CONFIRMADA** (dicha por el dueño o fijada por el orquestador citando al dueño), **PROPUESTA**, **PENDIENTE**, **NO VERIFICADO**.

## 1. Propósito y alcance

- Que el dueño **mire la aplicación funcionando** en una dirección propia (proyecto `motor2-demo`) sin Google, con datos de ejemplo inventados. CONFIRMADA (cita arriba).
- **Fuera de alcance:** tocar el login de Google; cualquier acceso de demo en la aplicación real; más de un usuario de demo; registrarse; recuperar clave; datos reales del dueño.
- **Necesidad escrita:** la pregunta del dueño del 2026-11-17 (arriba). Forma más barata: **reutilizar** el sistema de sesiones existente (no inventar otro) y **reutilizar** las semillas de demo que ya existen (`scripts/seed-demo-pizzeria*.ts`, `scripts/seed-demo-carta-la-cuadra.ts`, `scripts/demo-seed/`), sumando solo lo que falta (caja con cobros, clientes, familias de la carta).

## 2. Actores y contexto

| Actor | Qué hace | Cómo se lo reconoce |
|---|---|---|
| El dueño (o quien él invite) | Ingresa con la clave de demo y mira | Conoce la clave (se la da el orquestador por fuera del repositorio) |
| Usuario de demo | UN usuario, gerente de la empresa ficticia | Su email está **escrito en la marca de demo de la base** (nunca llega por el pedido) |
| Orquestador | Crea la base Neon, las variables de Vercel, corre preparación y semilla, despliega **cuando el dueño lo pide** | Credenciales propias; este frente no las ve ni las necesita |
| Una persona cualquiera de Internet | Puede tipear en el formulario | No tiene la clave: no entra, y no puede bloquear más que el propio formulario de demo |

## 3. Casos de uso

1. **Ingresar a la demo:** formulario «Clave de demostración» en `/login`, **solo si el ingreso de demo está habilitado** (§5); clave correcta → sesión normal de ese usuario → entra a la aplicación.
2. **Salir:** el cierre de sesión que ya existe.
3. **Preparar la base de demo** (script, una vez): roles de la base y la **marca de demo** (§6).
4. **Sembrar la demo** (script, idempotente en lo que escribe la capa nueva): empresa ficticia, catálogo, carta, caja, etc.
5. **Apagar la demo:** quitar la variable `DEMO_LOGIN` (el ingreso deja de existir al instante en el próximo pedido) o borrar la base.

## 4. Conceptos y ciclo de vida

- **Ingreso de demo habilitado** = las cuatro condiciones a la vez (§5). Si falla cualquiera, **no existe**: ni se muestra el formulario ni responde la acción.
- **Marca de demo:** una tabla de UNA fila (`MarcaDeDemo`) que **solo crea el script de preparación**, nunca una migración de Prisma. Una base real **no tiene la tabla**: aunque alguien copie las variables a otro proyecto, el ingreso no se habilita. La fila guarda el email del usuario de demo, la empresa de demo y el estado anti fuerza bruta (§7). La aplicación (`motor2_app`) solo puede **leerla** y **actualizar el contador de fallos**; no puede crearla ni cambiarle el usuario.
- **Sesión de demo:** una fila `Session` normal (la misma tabla y la misma cookie que el ingreso de Google) con vencimiento igual al de las reales (12 h, `duracion-sesion.ts`). Todo lo demás (permisos, revalidación de membresía cada 5 min, cierre) es el de siempre.

## 5. Invariantes y políticas — cuándo existe el ingreso de demo (todas, y si hay duda, no existe)

| # | Condición | Estado |
|---|---|---|
| D1 | Variable explícita `DEMO_LOGIN=si` (cualquier otro valor, o ausente → apagado) | PROPUESTA |
| D2 | Variable secreta `DEMO_CLAVE` definida, de **al menos 16 caracteres** (solo en Vercel; nunca en el repositorio ni en un `.env` versionado) | PROPUESTA |
| D3 | La base tiene la tabla `MarcaDeDemo` con **exactamente una fila** y su usuario de demo existe y está activo | PROPUESTA |
| D4 | El usuario de demo tiene membresía activa de **gerente** de la empresa de demo (y solo de ella); no es administrador de plataforma | PROPUESTA |
| D5 | No está bloqueado por intentos fallidos (§7) | PROPUESTA |

- **La clave nunca se guarda ni se registra:** se compara contra la variable de entorno; en los registros solo queda «ingreso de demo: ok/fallido» sin el valor.
- **Comparación en tiempo constante:** SHA-256 de ambas y `crypto.timingSafeEqual`.
- **Un solo usuario:** la acción no recibe email ni id; el usuario sale de la marca. No existe forma de elegir otra cuenta.
- **No toca Google:** `src/lib/auth.ts` no cambia en su lista de proveedores (un guardián lo vigila).
- **Mensaje genérico:** «No se pudo ingresar.» para clave mala, bloqueo y cualquier otra falla (nunca dice cuál condición falló).

## 6. Historia y persistencia

- **`MarcaDeDemo`** (creada por `scripts/demo/preparar-base-de-demo.sql`, **no** por Prisma): `id` fijo en 1 (CHECK `id = 1`: una sola fila), `usuarioEmail`, `empresaId`, `creadaEn timestamptz`, `fallosSeguidos int`, `bloqueadaHasta timestamptz`, `ultimoIngresoEn timestamptz`. Privilegios: `motor2_app` solo `SELECT` y `UPDATE` de las tres últimas columnas; **sin INSERT ni DELETE**.
- **Rastro:** cada ingreso exitoso o fallido deja una fila en la **auditoría que ya existe** (`RegistroAuditoria`/su equivalente) con «ingreso de demo», sin la clave; no se borra, se agrega.
- **Semilla:** reutiliza las existentes (que ya corren las acciones reales de la aplicación, no INSERT a mano) y suma una capa chica nueva (§9). Es **idempotente en lo que ella escribe** (claves naturales + «ya existe → no hace nada»); la semilla vieja de movimientos **no** es idempotente (su propio encabezado lo dice): por eso se corre **una sola vez** sobre una base recién preparada, y la capa nueva se niega si ya hay datos.
- Sin migraciones de Prisma, sin cambios en `schema.prisma`.

## 7. Atomicidad y concurrencia

- **Anti fuerza bruta global** (hay un solo usuario, así que un contador global alcanza y no se puede esquivar cambiando de IP): `UPDATE "MarcaDeDemo" SET "fallosSeguidos" = "fallosSeguidos" + 1, "bloqueadaHasta" = CASE WHEN "fallosSeguidos" + 1 >= 5 THEN now() + interval '15 minutes' END … RETURNING` **atómico**: dos intentos a la vez no se saltean el límite. Éxito → contador en 0. Mientras está bloqueada, ni siquiera se compara la clave. **Costo declarado:** cualquiera puede bloquear la demo 15 minutos tipeando mal 5 veces; es lo esperable (falla cerrado) y se levanta solo.
- **Crear la sesión** = un `INSERT` en `Session` con token aleatorio (32 bytes, `crypto.randomBytes`), en la misma transacción que actualiza el contador y deja el rastro: o se hace todo o nada. Dos ingresos simultáneos dan dos sesiones válidas distintas (no hay estado compartido que se pise).
- **Idempotencia:** repetir un ingreso correcto crea otra sesión (como volver a entrar con Google); repetir uno incorrecto suma un fallo, nunca algo más grave.

## 8. Acceso e interfaces

- **Pantalla:** en `/login`, debajo del botón de Google, un campo «Clave de demostración» y «Ingresar» **solo si D1 a D5 se cumplen al renderizar**. Sin eso la pantalla es idéntica a la de hoy.
- **Acción de servidor** `ingresarADemo(clave)` (`src/server/actions/auth/ingreso-de-demo.ts`): re-chequea D1 a D5 **en el servidor** (no confía en lo que mostró la pantalla), aplica el límite, compara, crea la sesión, pone la cookie con **el mismo nombre y las mismas opciones** que usa Auth.js (`nombreCookieSesion`, `httpOnly`, `sameSite=lax`, `secure` por https) y redirige a `/`. La protección de origen de las Server Actions de Next cubre el CSRF.
- **Núcleo puro:** `decidirIngresoDeDemo({ entorno, marca, usuario, ahora })` en `src/core/auth/` devuelve «habilitado o motivo» (sin I/O): es lo que prueba la matriz de §10.
- **Permisos:** la sesión es la de un gerente real: los permisos son los de siempre; nada especial.
- **Fuera de este PR de diseño:** no se escribe código hasta el visto.

## 9. Consultas, experiencia y semilla de demo

| Pieza | Fuente | Estado |
|---|---|---|
| Empresa ficticia, 1–2 sucursales, roles de fábrica, catálogo (~25 productos), secciones, proveedores, recetas con merma, 30 días de movimientos, carta | **Semillas existentes** (`seed-demo-pizzeria.ts`, `-6-meses`, `seed-demo-carta-la-cuadra.ts`) | NO VERIFICADO que cubran cada punto pedido; se audita antes de tocar |
| Clientes de ejemplo, **sesión de caja abierta con algunos cobros**, familias de carta | **Capa nueva** `scripts/demo/capa-nueva.ts`, llamando a las acciones reales (cajas C1/C2, clientes, familias) | PROPUESTA |
| **Destino remoto:** las semillas viejas se niegan a escribir en Neon/Vercel (`guardas-destino.ts`, S-33) | Una vía **nueva y explícita**: se permite un destino remoto **solo si** la base tiene la `MarcaDeDemo`, el nombre de la base termina en `_demo`, está `MOTOR2_SEED_CONFIRMAR=si` y no hay otra empresa con datos reales | PROPUESTA |

- **Datos inventados:** nada de los datos reales del dueño; nombres, CUIT y precios de ejemplo (CUIT con dígito verificador válido pero ficticios). **PENDIENTE (la pregunta):** si «La Cuadra» es un nombre inventado o un negocio real del dueño.

## 10. Pruebas, migración y operación

**Combinaciones (regla del 2026-10-28):** las dimensiones que cambian si el ingreso existe son D1 a D5 (variable de demo, clave definida y su largo, marca presente/ausente/duplicada, usuario de demo activo/inactivo/sin rol, bloqueo). **Tabla esperada escrita aparte del código** (`test/auth/ingreso-de-demo-oraculo.ts`) y un test que recorre **todas** las combinaciones: el ingreso existe **si y solo si** todas se cumplen. Un guardián falla si aparece una variable `DEMO_*` nueva sin declarar.

**Pruebas de denegación (obligatorias):** variable apagada; `DEMO_LOGIN` con otro valor («true», «1», «SI »); sin clave definida; clave corta; **base sin la tabla de marca (base real)**; marca con dos filas; usuario de demo inexistente o inactivo; usuario sin rol de gerente o con rol de plataforma; clave mala (mensaje genérico, contador +1); 5 fallos → bloqueado aunque la sexta clave sea correcta; bloqueo vencido → vuelve a andar; **dos ingresos fallidos simultáneos** (el contador no pierde un fallo); clave correcta con la variable cambiada en vivo → deja de andar en el pedido siguiente; que ni la ruta ni el formulario existan cuando está apagado (la acción responde «No se pudo ingresar.»). Contra Postgres real (como las demás pruebas con base).
**Pruebas del script de preparación:** idempotente (correrlo dos veces no cambia nada), crea la marca con una sola fila, deja a `motor2_app` sin INSERT/DELETE, se niega si la base ya tiene la marca con otro usuario.
**Operación (a cargo del orquestador):** `psql` del script de preparación sobre la base nueva → `prisma migrate deploy` → semilla → variables en Vercel (`DEMO_LOGIN`, `DEMO_CLAVE`, `DATABASE_URL` de la base de demo, `AUTH_SECRET`/`AUTH_GOOGLE_*` de relleno si hace falta) → despliegue **solo cuando el dueño lo pida**. Orden de los scripts y de las variables documentado en `scripts/demo/LEEME.md`.

**«¿Qué pasa si…?»**

| Caso | Resultado esperado |
|---|---|
| Se copian `DEMO_LOGIN` y `DEMO_CLAVE` a otro proyecto con una base real | No existe el ingreso: la base real no tiene `MarcaDeDemo` (D3). |
| Alguien intenta crear la tabla `MarcaDeDemo` en una base real | `motor2_app` no puede; solo el dueño de la base, a mano: es una acción de administración, no del sistema. |
| Se tipea mal la clave 5 veces | Bloqueo 15 min, mensaje genérico; el dueño espera o el orquestador pone `bloqueadaHasta = NULL`. |
| Dos personas ingresan a la vez | Dos sesiones independientes. |
| Se cambia `DEMO_CLAVE` | Las sesiones abiertas siguen hasta que venzan (12 h) o se las borre; los ingresos nuevos usan la clave nueva. |
| Se apaga `DEMO_LOGIN` | El próximo pedido ya no muestra ni acepta el formulario. Las sesiones abiertas siguen hasta vencer: para cortarlas ya, borrar sus filas de `Session`. |
| El usuario de demo pierde la membresía | La revalidación cada 5 min (M-20) corta la sesión; el ingreso nuevo falla por D4. |
| Se corre la semilla dos veces | La capa nueva no duplica; la vieja se niega (la base ya tiene datos), salvo la bandera de rehacer. |
| Falla a mitad la semilla | Se rehace sobre una base nueva (la semilla vieja no es reentrante); el ingreso de demo no existe hasta que la marca y el usuario estén. |
| Alguien deja la variable en Producción real del dueño | No pasa nada si D3 falla; además la variable es de **un proyecto** de Vercel distinto del de producción. |

**Necesidad que resuelve (poda):** una sola: que el dueño vea el avance en vivo (2026-11-17). **No incluye** (y no se construye sin pedido): más usuarios de demo, reinicio automático de la demo, métricas, correo, modo «solo lectura».

## Pregunta (una, la clave)

**¿«La Cuadra» (nombre de la pizzería de las semillas existentes) es un nombre inventado o un negocio real del dueño?** Si es real, la demo usa nombres genéricos distintos y no se suben sus datos; si es inventado, se reutiliza tal cual (lo más barato).

## Qué NO verifica este documento

Que las semillas existentes cubran lo pedido (se audita antes de escribir); que `RegistroAuditoria` sirva tal cual para el rastro del ingreso; el comportamiento de la cookie de sesión de Auth.js al crearla fuera del flujo de Google (se prueba contra `auth()` real con una base: debe resolver la sesión como cualquier otra); límites del plan de Neon/Vercel; nada de despliegue ni de infraestructura (es del orquestador).
