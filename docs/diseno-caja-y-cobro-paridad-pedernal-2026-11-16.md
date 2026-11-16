# Diseño: caja y cobro, paridad con Pedernal (2026-11-16)

Frente 1 del programa de paridad (contrato: `motor2-docs`, `_coordinacion/mapa-de-carriles-2026-11-16.md`). **Fase 1: solo documentos. Sin código, sin migraciones, sin DEC, nada aplicado a ninguna base, nada desplegado.**

Se parte en tres archivos:

1. **Este** — resumen para el dueño, etapas, carril de escritura, dependencias y preguntas.
2. `docs/diseno-caja-y-cobro-paridad-pedernal-auditoria-2026-11-16.md` — qué hay hoy en Motor2 (código real) y en Pedernal (versión vigente) y la tabla de paridad.
3. `docs/diseno-caja-y-cobro-paridad-pedernal-escalera-2026-11-16.md` — niveles 1 a 10 con estado de cada decisión y la tabla «¿qué pasa si…?» por comando.

Estados: **CONFIRMADA** (dicha por el dueño, con cita literal y fecha) · **PROPUESTA** · **PENDIENTE** · **NO VERIFICADA**.

**Pedido que habilita el frente** (2026-11-16, `motor2-docs`, `seguimiento-de-pedernal/decisiones-del-dueno-2026-11-14-mesa-resend-contador.md`, sección «Paridad con Pedernal: qué falta y cómo se trabaja»): «En realidad a nosotros nos falta caja, que tiene que ver con el cobro.» Y la dirección, 2026-11-14: «Como Pedernal: con caja, sesión y jornada (Recomendada)» (CONFIRMADA en dirección; «no autoriza migración ni construcción»).

## Para el dueño, en doce líneas

1. **Hoy Motor2 no tiene caja ni cobro.** Cerrar una cuenta descuenta el stock y numera el ticket, pero no registra con qué se pagó ni en qué caja entró la plata. Verificado en el código, no en documentos.
2. Pedernal sí tiene: caja, sesión (apertura con fondo y cierre con arqueo), medios de pago, cobro de un ticket, cierre del día y vuelto. **No** tiene propina (vos decidiste que no), ni cuenta corriente, ni seña, ni caja grande, ni cobro en partes construido.
3. El diseño del 04/11 de Motor2 (cuenta corriente, seña, caja diaria tipo Excel, caja chica en tres turnos, caja grande) **choca** con «como Pedernal». Propongo seguir Pedernal en lo mínimo y dejar eso del 04/11 como etapas posteriores **sin construir hasta que lo pidas**.
4. **Etapa mínima (C1):** una caja por sucursal que nace sola, el medio Efectivo y los demás tipos sin datos extra, abrir la caja con fondo, mover efectivo con motivo, **cobrar una cuenta cerrada** (la suma de los medios tiene que dar el total al centavo) y cerrar la caja contando los billetes. Sin cierre del día todavía.
5. Todo nace cerrado: módulo apagado, permisos solo para admin, ningún dato extra pedido al cobrar.
6. Nada se borra: un error se anula con un registro nuevo; un cobro mal cargado de medio se corrige sin tocar el original.
7. Cobrar dos veces el mismo pedido (doble clic, corte de red, reintento) **no duplica plata**; dos cajeros cobrando la misma cuenta a la vez: uno gana, el otro ve «ya cobrada».
8. Dinero en decimal exacto con peso argentino fijo; fechas en hora de Argentina; el día de caja puede tener una hora de corte por sucursal (etapa C2).
9. **Riesgo que necesito que decidas:** hoy se puede corregir o anular un ticket ya cerrado. Si ya está cobrado, eso cambia el total. Pedernal resuelve dejando la diferencia a explicar en el cierre del día. Es la pregunta Q-ANU.
10. Fuera de este frente: factura electrónica (ARCA), factura externa y notas de crédito. Pregunta Q-ARCA: **no la asumí**.
11. Tablas: ~15 en el modelo completo (en papel); C1 migraría **ocho**, y ninguna se aplica a ninguna base.
12. Pantallas: las arma el frente 6 sobre las maquetas de Pedernal con tus datos reales; este frente entrega el servidor.

---

## Etapas

Regla «primero lo más barato»: cada etapa se puede usar sola y no rompe lo cargado. Etapa = un PR chico, aditivo y reversible. Estado de cada una: **PROPUESTA** (el dueño confirma niveles 1 a 5 antes de la Fase 2).

| Etapa | Qué incluye | Tablas nuevas (solo las de la etapa) | Para qué se puede usar |
|---|---|---|---|
| **C1 — Cobrar con caja** | Módulo `caja` (apagado por defecto), una caja por sucursal que nace sola, medios de pago (6 tipos, solo Efectivo habilitado de fábrica), apertura con fondo, ingreso/egreso manual de efectivo con motivo, anulación por espejo, **cobrar una cuenta cerrada**, ver cuentas cerradas sin cobrar, cierre de sesión con conteo de efectivo por billetes y «conforme general» para el resto. La fecha de negocio se sella con corte 00:00 (calendario argentino) | `Caja`, `MedioDePago`, `SesionCaja`, `MovimientoCaja`, `Cobranza`, `Cobro`, `ArqueoCaja`, `ArqueoBillete` (8; si Q-TOTAL se resuelve escribiendo `Venta`, la cobranza no guarda el total) | Saber qué se cobró por medio, qué falta cobrar y si la caja cuadra |
| **C2 — Jornada y cierre del día** | Hora de corte por sucursal, jornada `ABIERTA`/`EN_AUDITORIA`/`CERRADA`, controles con severidad, corregir el medio de un cobro, declarar totales, conforme general, ajuste a jornada cerrada | `JornadaDeSucursal`, `ControlDeJornadaCerrada`, `CorreccionDeMedio`, `DeclaracionDeTotal`, `ConformeDeJornada` (+ columna de hora de corte en `Sucursal`, zona compartida) | Cierre del día como en Pedernal |
| **C3 — Datos del cobro y cuentas de cobro** | Cupón, últimos 4, marca, cuotas 1 a 36, DNI según el medio (techo por tipo, nacen apagados), cuentas de cobro (terminal/QR/banco), marcas de tarjeta | `CuentaDeCobro`, lista global de marcas | Conciliar con la terminal |
| **C4 — Varias cajas** | Perilla de plan de cantidad de cajas, alta/baja de cajas | (ninguna; usa `Caja`) | Sucursales con más de un puesto de cobro |
| **C5 — Mostrador: vender y cobrar en un gesto** | Según Q1 | (ninguna o una) | |
| **Posterior, sin pedido en Motor2** | Cobro en partes (Pedernal lo decidió y no lo construyó), cuenta corriente, seña, folio de reservas, caja grande, depósitos, caja chica por turnos, obligatoriedad por dato del medio, ARCA | — | No entran hasta que el dueño los pida |

**Qué se hace con el diseño del 04/11 (`docs/diseno-caja-y-cobros-2026-11-04.md`):** se conserva como antecedente. Sus niveles 1 a 5 confirmados el 04/11 que Pedernal tampoco tiene (cuenta corriente como medio, seña, caja chica en turnos con billetes de 10 a 20.000, caja grande) quedan **pendientes de decisión (Q-CC)**; ninguno entra en C1 a C4. Lo que ese diseño pide sobre factura externa sigue su propio documento (`docs/diseno-factura-externa-n1-n2-2026-11-15.md`) y depende de que cobrar exista.

---

## Carril de escritura (Fase 2, declarado hoy)

Solo escribe en estas rutas el frente 1. Si otra sesión necesita alguna, se arregla por mensaje y, si no, decide el orquestador general.

**Carpetas propias (nuevas, hoy inexistentes):**

- `src/core/caja/**` (dominio puro: sesión, movimiento, cobro, arqueo, fecha de negocio con corte, vuelto, validaciones de dinero)
- `src/core/features/caja/**` (guards/esquemas de comandos, como el resto de `core/features`)
- `src/server/actions/caja/**` (acciones y `casos-de-uso/`)
- `src/server/persistencia/caja/**`
- `src/server/consultas/caja/**`
- `test/caja/**`
- `prisma/migrations/<timestamp reservado al pasar a Fase 2>_caja_*` (aditivas, con `down.sql` y `verificacion-previa.sql`)
- `docs/diseno-caja-y-cobro-paridad-pedernal-*` y `docs/diseno-caja-*` de etapas

**Modelos de `prisma/schema.prisma`** (cada frente edita **solo** los suyos y avisa): `Caja`, `MedioDePago`, `SesionCaja`, `MovimientoCaja`, `Cobranza`, `Cobro`, `ArqueoCaja`, `ArqueoBillete` (C1); `JornadaDeSucursal`, `ControlDeJornadaCerrada`, `CorreccionDeMedio`, `DeclaracionDeTotal`, `ConformeDeJornada` (C2); `CuentaDeCobro` y la lista de marcas de tarjeta (C3).

**Se leen y NO se escriben** desde este frente: `Cuenta`, `CuentaItem`, `PromoCuenta`, `EjemplarTicket`, `Venta`, `Operacion`, `Mesa`, `Cliente`, y todo `src/server/actions/pos/**`, `src/server/actions/movimientos/**` y `src/core/pos/**`.

**Zona restringida: pedidos al orquestador general** (con motivo, entran por turno):

| Archivo / modelo | Qué se pide | Cuándo |
|---|---|---|
| `src/core/permisos/acciones.ts` y matrices | ~12 acciones de caja (nivel 8 de la escalera), todas con piso y fail-closed, semilla `admin` | C1 |
| `src/core/textos/*` | textos nuevos de caja y cobro (catálogo T1) | C1 |
| `src/core/modulos/catalogo.ts` | **No lo pido yo:** lo escribe Frente 4 (ver «Acuerdos») | C1 |
| `prisma/schema.prisma`: relaciones inversas en `Empresa`, `Sucursal`, `User`, `Cuenta` | campos de relación que Prisma exige; **no** cambia columnas | C1 |
| `prisma/schema.prisma`: `Sucursal.horaDeCorte` | una columna (frente 3 `fechas`) | C2 |
| `test/aislamiento/m1-mostrador-subir-bajar-subir.test.ts`, `test/modulos/__golden__/*`, `test/arquitectura/caracterizaciones-congeladas.test.ts` | lista de migraciones, golden de módulos | cada etapa |
| `docs/registro-de-decisiones.md` | DEC si las hubiera (hoy **ninguna abierta**) | — |
| `.dependency-cruiser*.cjs`, `knip.jsonc`, `package.json`, `.github/**` | solo si un guardián lo exige | cada etapa |

**Puntos de contacto con código ajeno (sin editarlo):** el cobro lee el total de la cuenta con la misma función que usa `cerrarCuenta` (`lineasDeVenta`, `importeDeLinea`, descuento congelado); si hace falta exportarla distinto, se pide a quien tenga `src/core/pos/**` (Frente 6/Ocultar).

---

## Dependencias con los otros frentes y corrientes

| Con | Qué necesito / qué ofrezco | Ruta o modelo exacto | Estado |
|---|---|---|---|
| **Frente 3 DATOS** (`session_01FWp2kfrA1HP5aCRYMqYak9`) | Que decida: ids `uuid` generados por la app vs `cuid()`; `timestamptz` vs `DateTime`; ancho del dinero (`Decimal(18,2)` y tope de Pedernal 999.999.999,99); disparador `solo_insercion()` para tablas de movimiento. **Ofrezco:** declarar que las tablas de caja nacen con lo que decidan. Pido además `Sucursal.horaDeCorte` y una función pura `fechaDeNegocio(instante, zona, corte)` en `src/core/tiempo/` | `prisma/schema.prisma` (`Sucursal`), `src/core/tiempo/zona-horaria.ts` | **Pendiente de contrato**; se envía mensaje |
| **Frente 4 PLANES y PERILLAS** (`session_01FWp2kimyKRo3i4pWzavWoj`) | Módulo `caja` en el catálogo y perilla de cantidad de cajas por sucursal (C4); si planes con perillas todavía no existen, C1 usa «una caja por sucursal» fija. **Ofrezco:** la clave `cajas_por_sucursal` y el nombre del módulo | `src/core/modulos/catalogo.ts`, perillas de plan | Pendiente de contrato |
| **Frente 5 COMPRAS** (`session_01FWp2kh2bayQURHmaJULuc6`) | Compras quiere pagar en efectivo **desde una caja abierta**. **Ofrezco** (C1 o posterior, no antes): un puerto `registrarEgresoDeCajaEnTx(tx, {sesionId?, origenTipo, origenId, importe, motivo, claveIdempotencia})` que escribe un `MovimientoCaja` de clase `EGRESO_MANUAL` con origen, transaccional con el pago de la factura. **No** reutiliza `MEDIOS_DE_PAGO` de proveedores (otro libro) | `src/server/actions/caja/` (puerto), `PagoDeFacturaProveedor` (no se toca) | Pendiente; **no entra en C1** salvo que Frente 5 lo pida con cita del dueño |
| **Frente 6 PANTALLAS** (`session_01FWp2kk5PrAyuuNP3Ufwf9V`) | Pantallas: caja (abrir, mover efectivo, cerrar), cobrar una cuenta, cierre del día, configuración de medios, mostrador. **Ofrezco:** la lista de acciones de servidor y de consultas con sus nombres, errores y textos antes de construir cada etapa. **Pido:** que no toquen `src/server/actions/caja/**`; yo no toco `src/app/**` ni `src/components/**` | `src/app/(app)/caja/**`, `src/app/(pos)/mesas/**` (cobrar), `src/components/caja/**` (de Frente 6); servidor en `src/server/actions/caja/**` y `src/server/consultas/caja/**` (mío) | Pendiente de contrato; se envía mensaje |
| **Frente 2 UNIDADES y CLASIFICACIÓN** (`session_01FWp2kiftTcYYrgUtRy35dg`) | Ninguna dependencia directa de datos | — | — |
| **Ocultar** (`session_01FWp2khnmfSfh88wNWCu66B`) | «Un oculto no admite líneas nuevas en mostrador y salón, **deja cobrar lo ya cargado**» (decisión de Pedernal, 14/11): el cobro **no** mira `OcultamientoProducto`; solo cobra lo ya vendido | `src/server/actions/pos/**` (no lo toco) | Sin contrato; informado |
| **Roles P1** (`session_01FWp2kg16mmRbJwGpsiMpHA`) | Mis permisos nuevos nacen en semilla `admin`; cualquier cambio de roles de fábrica pasa por ellos/orquestador general | `src/core/permisos/**` | Informado |
| **Textos** (`session_01FWp2kipcKtTwtYF9fwRY4H`) | Los textos de caja siguen el catálogo T1; propongo la lista antes de construir | `src/core/textos/*` | Informado |

Mensajes a enviar a los frentes 3, 4, 5 y 6 con rutas/modelos exactos: ver el aviso de este PR. Lo que me pidan es información, no una orden.

---

## Acuerdos entre orquestadores (2026-11-16, por mensaje; información, no decisión del dueño)

- **Frente 3:** las tablas de caja nacen con el molde E-0 de su PR #323 (uuid de la app, `TIMESTAMPTZ(3)`, sin DELETE, solo inserción por disparador, `claveIdempotencia`). Tipo exacto del uuid y ancho del dinero (`Decimal(14,2)` vs `(18,2)`) los resuelve el orquestador general; hasta entonces `(18,2)` es pregunta abierta. `fechaDeNegocio` la escribe Frente 3 en `src/core/tiempo/**`; la columna `Sucursal.horaDeCorte` la agrega este frente en C2. Este frente **no agrega columnas** a `Cuenta`, `Venta` ni `EjemplarTicket`.
- **Frente 4:** el módulo `caja` en `src/core/modulos/catalogo.ts` lo escribe Frente 4 (no se pide al orquestador general), citando el pedido del dueño; la perilla `cajas_por_sucursal` es suya. Verificador propuesto: `crearCaja` y `reactivarCaja` rechazan con `LIMITE_DE_CAJAS`.
- **Decisión del orquestador general (2026-11-16, información, no del dueño):** id `@db.Uuid` nativo; la hora de corte y el módulo `caja` quedan como arriba. **Ancho del dinero:** se diseña con `Decimal(14,2)` (el de Motor2 hoy) como PROPUESTA, parametrizado en **una sola constante** para cambiarlo a `(18,2)` sin rehacer; la decide el dueño (el orquestador general se lo lleva). Ya no vale la propuesta `(18,2)` de este documento.
- **Frente 5:** puerto propuesto `registrarEgresoDeCajaEnTx(tx, {sucursalId, origenTipo, origenId, importe, motivo, claveIdempotencia})` en `src/server/actions/caja/puertos/`; no entra hasta después de C1 y con pedido citado del dueño.

## Preguntas al dueño (una por vez; solo las que cambian modelo de datos, dinero o permisos)

**Pregunta 1 (la primera, abierta):** *Hoy, en Motor2, «cerrar cuenta» descuenta stock y numera el ticket pero no cobra. En Pedernal, en el salón, **cerrar y cobrar es un solo gesto** (si el pago no cuadra, la cuenta no se cierra). ¿En Motor2 querés que cerrar una cuenta pida cobrarla en el mismo momento (como Pedernal), o que se siga cerrando sin cobrar y el cobro se haga después, cuenta por cuenta (más simple de empezar y no cambia lo que ya anda)?* Mi recomendación para empezar, y la que está en el diseño: **cobro aparte** de una cuenta ya cerrada en C1, y el gesto único en C5 solo si lo pedís. Estado: **PENDIENTE**; cambia el modelo de datos y el dinero (el instante de cobro frente al de venta).

Preguntas siguientes (en cola, **no abiertas**):

- **Q-ANU:** ¿qué pasa si se corrige o anula un ticket ya cobrado? (Pedernal: anular todo deja la diferencia a explicar en el cierre del día; no mueve la caja.)
- **Q-DENOM (RESUELTA, CONFIRMADA):** billetes, respuesta del dueño 2026-11-16: «Las 10 de tu planilla» → $10, $20, $50, $100, $200, $500, $1.000, $2.000, $10.000 y $20.000, más las monedas como un solo importe (registrada en `motor2-docs`, «Caja y Datos: dos respuestas más»; relatada por el orquestador general). Difiere de Pedernal (7) por decisión del dueño.
- **Q-CC:** de lo que pediste el 04/11 y Pedernal no tiene (cuenta corriente, seña, caja chica en tres turnos, caja grande, depósitos): ¿entra alguna, y cuándo?
- **Q-ARCA:** ¿la facturación electrónica con ARCA es otro frente? (Hoy: «facturan en otro sistema, Motor2 no emite», vigente; emisión propia = etapa futura sin decidir.) **No lo asumí.**
- **Q-ANT:** las cuentas ya cerradas antes de activar caja: ¿quedan como «anterior a la caja» o se cobran después?
- **Q-CAJAS:** ¿una caja por sucursal para salón y mostrador juntos (Pedernal, primera versión) o una por puesto?

Preguntas **técnicas, que no son del dueño** (las resuelve el ingeniero): Q-TOTAL (guardar el total de la cuenta en la cobranza o escribir `Venta`); uuid vs cuid; ancho del dinero.

---

## Riesgos y pendientes

- Los 3 riesgos principales: (1) corregir/anular tickets cobrados (I-14, Q-ANU); (2) la hora de corte requiere una columna en `Sucursal`, zona compartida; (3) dos diseños que chocan (04/11 vs paridad).
- Lectura de Pedernal: hecha por un agente sobre un clon superficial; la lógica completa de `arqueo.ts`, `cerrar-sesion.ts`, `corregir-medio-de-cobro.ts` y `cobrarMesa` **NO VERIFICADO**. Se lee completa contra `main` de Pedernal antes de la Fase 2.
- Frente 6 puede pedir cambios a pantallas que cambien el servidor; se acuerda por mensaje.
- Nada se migra ni se aplica. Toda migración queda sin autorización expresa por base y con respaldo (congelamiento de despliegue, decisión del 2026-11-16).

## Sugerencias (no implementadas)

Ninguna se implementa sin tu «sí». Ideas anotadas: aviso en pantalla «Esta caja sigue abierta del día anterior» (Pedernal no tiene texto aprobado); reutilizar la sesión de caja como `origen` del pago de compras en efectivo (Frente 5); descartar «cobrar en partes» hasta que Pedernal lo construya.
