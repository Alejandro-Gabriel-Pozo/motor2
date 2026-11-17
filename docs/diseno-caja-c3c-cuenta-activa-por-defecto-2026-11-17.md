# Caja y cobro, etapa P-C3: el cobro asigna solo la cuenta activa de la sucursal (diseño, 2026-11-17)

Escalera de diseño de 10 niveles (AGENTS.md). Estado: CONFIRMADA = dicha por el dueño; PROPUESTA = criterio del ingeniero; NO VERIFICADA = no ejecutada.

## 1. Propósito y alcance (nivel 1) — CONFIRMADA

**Necesidad:** el dueño, 2026-11-17, chat con el orquestador general (registrado en `motor2-docs`, d335641), a la pregunta «¿el cobro debe asignar solo la cuenta activa de la sucursal cuando el medio admite cuenta?» (ver `docs/diseno-caja-c3-cuenta-de-cobro-y-marcas-2026-11-16.md`, «Pregunta para el dueño»): **«RESPUESTA: b»** = el cobro asigna solo la cuenta activa de la sucursal cuando hay EXACTAMENTE UNA; con más de una cuenta activa hay que elegir. Antecedentes: «Por ahora es lo primero» (2026-11-16, una sola cuenta de cobro activa por sucursal, C3b).
**Qué entra:** un cambio chico dentro del caso de uso `cobrarCuenta`. **Qué NO entra:** cobros ya hechos (no se reescriben: los que quedaron «sin cuenta» siguen así), movimientos manuales y ajustes, pantallas, permisos nuevos, migración.

## 2. Actores y contexto (nivel 2)

Quien cobra (permiso `cobrar_cuenta`, sin cambios). La sucursal es la de la caja abierta del contexto (nunca la manda el frontend).

## 3. Casos de uso (nivel 3)

Un solo comando afectado: **cobrar una cuenta cerrada** (C1/C3). La pantalla ya no necesita pedir la cuenta de cobro cuando la sucursal tiene una sola activa; si igual la manda, se respeta y se valida como hoy.

## 4. Conceptos (nivel 4)

«Cuenta activa compatible con el medio» = una `CuentaDeCobro` de la sucursal de la caja, `activa`, cuyo tipo admite el tipo del medio (`CUENTAS_ADMITIDAS`, `src/core/caja/medios.ts`: débito/crédito → terminal; QR → QR o terminal; transferencia → cuenta bancaria; otro → cualquiera; efectivo → ninguna; espejo de `CuentaDeCobro_admitida_por_medio` de la base).

## 5. Invariantes y políticas (nivel 5)

Para cada renglón del cobro que **no trae** `cuentaDeCobroId` y cuyo medio **admite cuenta** (tipo distinto de efectivo), sea A el conjunto de cuentas activas compatibles de la sucursal de la caja:

| |A| | Resultado | Estado |
|---|---|---|
| 1 | se asigna esa cuenta al renglón (movimiento COBRO, `Cobro` y arqueo quedan en esa cuenta) | CONFIRMADA («RESPUESTA: b») |
| 0 | el renglón queda **sin cuenta**, como hoy: el cobro se registra igual y después se ordena (**la venta nunca se frena por falta de cuenta**) | CONFIRMADA («A (aceptar sin cuenta)…», 2026-11-17) |
| 2 o más | rechazo de regla `CUENTA_DE_COBRO_A_ELEGIR` (hay que elegir una), sin escribir nada | CONFIRMADA («con más de una cuenta activa hay que elegir») |

Un renglón que **sí trae** cuenta se valida como hoy (`validarParDeCobro`, sin cambios). El efectivo nunca lleva cuenta.
**Lectura de «exactamente una» — CONFIRMADA (2026-11-17):** una cuenta activa **compatible con el medio**. Respuesta del dueño, chat con el orquestador general (registrada en `motor2-docs`), literal: «A (aceptar sin cuenta): el cobro se registra igual, queda “sin cuenta” y después lo ordenás. La venta nunca se frena.» Si la única cuenta activa de la sucursal es de un tipo que el medio no admite (p. ej. solo hay una cuenta bancaria y se paga con débito), no se asigna: el cobro se registra igual y queda sin cuenta, como hoy. **Principio nuevo del dueño: la venta nunca se frena por falta de cuenta.** Con una sola cuenta activa por sucursal (C3b) el caso «2 o más» no se da con datos nuevos; queda por datos anteriores a C3b y para cuando el dueño cambie esa regla.
**Diferencia con Pedernal (declarada con su motivo):** en Pedernal el cobro no asigna cuenta por sí solo (no encontré esa regla en `src/modulos/caja` ni `ventas`; NO VERIFICADO exhaustivamente) y una sucursal puede tener varias cuentas; en Motor2 es decisión expresa del dueño (2026-11-17, «RESPUESTA: b», y 2026-11-16, «Por ahora es lo primero»).

## 6. Historia y persistencia (nivel 6)

Sin tablas ni migración. La cuenta asignada queda escrita donde ya queda la elegida a mano (`MovimientoCaja.cuentaDeCobroId` y `Cobro.cuentaDeCobroId`), así que el arqueo por (medio, cuenta) la agrupa solo. La auditoría del cobro (que ya cuenta «con cuenta de cobro: N») cuenta también las asignadas.

## 7. Atomicidad y concurrencia (nivel 7)

La lectura de las cuentas activas va **dentro de la misma transacción SERIALIZABLE** del cobro. Si otra persona crea, desactiva o reactiva una cuenta a la vez, Postgres aborta a una de las dos y el reintento relee: el cobro se resuelve con el conjunto vigente. La defensa final es la de siempre: `CuentaDeCobro_validar_par` (cuenta de la sucursal, activa y compatible) al insertar el movimiento. Idempotencia: la huella del pedido NO incluye la cuenta resuelta (el pedido es el mismo); repetir con la misma clave devuelve el cobro ya hecho con la cuenta con que se hizo (no se reasigna).

## 8. Acceso e interfaces (nivel 8)

Sin Server Action nueva ni permiso nuevo. El resultado suma un código: **`CUENTA_DE_COBRO_A_ELEGIR`** (texto propuesto: «Hay más de una cuenta de cobro activa para este medio: elegí una.»; lo fija la sesión de Textos). Contrato para el Frente 6: si la sucursal tiene una sola cuenta activa, el renglón puede ir sin cuenta; si el servidor responde `CUENTA_DE_COBRO_A_ELEGIR`, la pantalla muestra la lista de cuentas activas compatibles.

## 9. Consultas y experiencia (nivel 9)

Las lecturas de cobranzas y del arqueo no cambian: ya muestran la cuenta de cada renglón. Un cobro asignado solo se ve igual que uno elegido a mano.

## 10. Pruebas, migración y operación (nivel 10)

- **Migración:** ninguna. **Operación:** no retroactivo.
- **Combinaciones (regla del 2026-10-28), oráculo escrito aparte del código** (`test/caja/oraculo-de-cuenta-por-defecto.ts`) y test exhaustivo contra Postgres real: dimensiones (tipo de medio: 6) × (cuentas activas compatibles en la sucursal: 0, 1, 2) × (el renglón trae cuenta: no / una compatible / una incompatible / de otra sucursal / inactiva) → resultado esperado y cuenta con que queda cada renglón. Guardián: si aparece un tipo de medio o de cuenta nuevo sin declarar en el oráculo, falla.
- **Núcleo puro** `cuentaPorDefectoDelRenglon(tipoDeMedio, cuentasActivas)` con propiedades (fast-check): nunca devuelve una cuenta inactiva, incompatible ni de otra sucursal; con una explícita no la cambia.
- **Concurrencia (Postgres real, varias vueltas):** cobro vs. desactivar la única cuenta; cobro vs. crear una segunda cuenta; dos cobros a la vez; sin error crudo y con resultado coherente (con la cuenta, o sin cuenta si la desactivación ganó).
- **No se pierde el cobro:** con 2 o más compatibles, el rechazo `CUENTA_DE_COBRO_A_ELEGIR` no escribe nada y el reintento con la MISMA clave y una cuenta elegida registra el cobro (prueba en Postgres real; mutación: que el rechazo deje escrita la clave de reintento → rojo).
- **Idempotencia:** el mismo cobro dos veces con la misma clave; el segundo devuelve `yaExistia` con la misma cuenta aunque entretanto cambien las cuentas activas.
- **Mutaciones:** quitar el filtro de compatibilidad → rojo; quitar el filtro «activa» → rojo; asignar con 2 o más → rojo; hacer que la huella incluya la cuenta resuelta → rojo la prueba de idempotencia.

### Tabla «¿qué pasa si…?»

| Situación | Resultado esperado |
|---|---|
| Repetición / doble clic con la misma clave | mismo cobro (`yaExistia`), misma cuenta |
| Hay 2 o más cuentas activas compatibles y el renglón no trae cuenta | el servidor responde `CUENTA_DE_COBRO_A_ELEGIR` **sin escribir nada** (ni cobranza ni clave de reintento): el cobro no se pierde, el cajero elige una cuenta y **reintenta con la misma clave** (como el pedido cambió y la primera vez no se escribió nada, no hay `CLAVE_REUTILIZADA`); la pantalla ofrece la lista de cuentas activas compatibles |
| Se crea una segunda cuenta activa justo mientras se cobra | una transacción aborta y reintenta; con 2 compatibles el cobro responde `CUENTA_DE_COBRO_A_ELEGIR`; nunca error crudo (con C3b la creación misma se rechaza si ya hay una activa) |
| Se desactiva la única cuenta justo mientras se cobra | o entra el cobro con la cuenta (si ganó) o queda sin cuenta (si ganó la desactivación); nunca queda asignada una inactiva |
| Se reactiva otra cuenta mientras se cobra | igual: se relee el conjunto vigente |
| Sucursal sin cuenta activa | sin cuenta, como hoy |
| La única activa no es compatible con el medio | sin cuenta, como hoy |
| El renglón trae una cuenta explícita | se valida como hoy; no se reemplaza |
| Efectivo | nunca lleva cuenta |
| Permisos revocados a mitad | rechazo por permiso (sin cambios) |
| Error parcial | todo o nada (sin cambios) |
| Cobros anteriores «sin cuenta» | no se tocan |
| Reintento tras corte de red | la clave de reintento devuelve el cobro ya hecho |

## 11. Preguntas abiertas

- **Q-P3-1 — CONFIRMADA (2026-11-17):** «exactamente una» = una activa compatible con el medio (cita en la sección 5).
- **Q-P3-2 — CONFIRMADA (2026-11-17):** con 0 cuentas activas compatibles el cobro se registra igual y queda sin cuenta («La venta nunca se frena», misma cita).
- **Sin preguntas abiertas** en esta etapa.

## Construido (2026-11-17)

Etapa P-C3 construida según este diseño (código escrito por Sonnet; sin migración, sin permiso nuevo, sin pantallas).

**Nombres exactos**
- Código de resultado nuevo: **`CUENTA_DE_COBRO_A_ELEGIR`** (en `CodigoDeFalloDeCobro`, `src/core/features/caja/caja.schema.ts`; por lo tanto parte de `ResultadoCobrarCuenta`). Texto (el del diseño, lo fija la sesión de Textos): «Hay más de una cuenta de cobro activa para este medio: elegí una.» (mapa `TEXTOS_DE_PAR` de `cobrar-cuenta.ts`).
- Núcleo puro (`src/core/caja/medios.ts`, exportado por `src/core/caja/public.ts`): **`cuentaPorDefectoDelRenglon(tipoDeMedio, cuentasActivasDeLaSucursal)`** → `ResultadoDeRegla<string | null, "CUENTA_DE_COBRO_A_ELEGIR">` (`valor` = la cuenta asignada o `null` si ninguna es compatible), y **`cuentaDelRenglon(cuentaDeCobroId, tipoDeMedio, cuentasActivas)`** (si el renglón trae cuenta devuelve esa, sin cambiarla; si no, la de la primera). Tipo `CuentaActivaDeLaSucursal = { id; tipo }`.
- Persistencia: **`cargarCuentasActivasDeLaSucursal(db, empresaId, sucursalId)`** en `src/server/persistencia/caja/configuracion.ts` (id y tipo, solo `activa: true`, por sucursal, orden por id).
- Caso de uso (`src/server/actions/caja/casos-de-uso/cobrar-cuenta.ts`): en la MISMA transacción SERIALIZABLE, dentro del recorrido por renglón y antes de `validarParDeCobro`, un renglón sin cuenta, de un medio que existe, está activo y no es efectivo, recibe la cuenta de `cuentaDelRenglon` (las cuentas activas se leen UNA vez por cobro, solo si hace falta); con `CUENTA_DE_COBRO_A_ELEGIR` devuelve el fracaso sin haber escrito nada (la cobranza, que lleva la clave de reintento, se inserta después). La cuenta resuelta se usa en el movimiento COBRO, en el `Cobro` y (por eso) en el arqueo, y en la auditoría («con cuenta de cobro: N» cuenta las asignadas). La huella (`calcularPayloadHash`) no cambió: sigue calculándose del pedido, sin la cuenta resuelta.

**Archivos de prueba** (Postgres real, base `motor2_f3`): `test/caja/oraculo-de-cuenta-por-defecto.ts` (oráculo aparte, sin importar `src/`), `test/caja/cuenta-por-defecto-oraculo.test.ts` (guardián de tipos de medio y de cuenta nuevos + recorrido exhaustivo tipo × 0/1/2 compatibles × lo que trae el renglón × alcance de lectura, con «distractores» siempre presentes: cuenta inactiva, de otra sucursal e incompatible), `test/caja/cuenta-por-defecto-nucleo.test.ts` (propiedades con `fast-check`), `test/caja/cuenta-por-defecto-comportamiento.test.ts` ((c) no se pierde el cobro, asignación y arqueo, (e) idempotencia y huella, (f) auditoría, (g) lo anterior no se toca, (d) concurrencia en 6 vueltas), y los apoyos `apoyo-cuenta-por-defecto.ts` e `indice-una-activa.ts` (quita `CuentaDeCobro_una_activa_por_sucursal_key` dentro de la prueba y lo restituye SIEMPRE, en `finally`/`afterAll`, con la definición de la migración 20261117118100). Inventarios tocados: el encabezado de `test/caja/oraculo-de-combinaciones-del-cobro.ts` (regla R9 y dimensión 5, apuntando al oráculo nuevo); en `caja-c3-casos-de-uso.test.ts` la prueba del arqueo desactiva la cuenta antes de su segundo cobro para obtener un cobro «sin cuenta» (con la regla nueva el renglón sin cuenta la recibiría).

**Diferencias con el diseño**
- Con el alcance de lectura normal, una cuenta de OTRA sucursal que el renglón trae responde `CUENTA_DE_COBRO_NO_ENCONTRADA` (la RLS por sucursal la oculta; comportamiento anterior, no cambió), y `CUENTA_DE_COBRO_DE_OTRA_SUCURSAL` solo con alcance de lectura ancho; el oráculo declara ambos.
- La pantalla (Frente 6) no se tocó.

**Mutaciones (rojo/verde, hechas a mano y revertidas; verde = el código sin mutar)**: sin filtro de compatibilidad → rojo (oráculo y propiedades); sin filtro «activa» → rojo (oráculo); asignar con 2 o más → rojo (oráculo, núcleo, «no se pierde el cobro» y concurrencia); huella con la cuenta resuelta → rojo (idempotencia, huella, doble clic); el rechazo que intenta dejar escrita la cobranza con su clave → rojo (la base lo corta con `cobranza_no_cuadra` por el disparador diferido, o sea que además hay una segunda barrera).

**NO VERIFICADO**: el gate completo con `npm run build`, `plataforma:build` y `test:e2e` (no se corrieron); ningún texto pasó por el catálogo de textos (`src/core/textos/catalogo`), el mensaje está en el mapa del caso de uso como los otros códigos del cobro; el comportamiento bajo carga distinta de la de 6 vueltas por carrera; el uso desde la pantalla.
