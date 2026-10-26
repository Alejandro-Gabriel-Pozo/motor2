# Diseño: ventas de salón y mostrador (2026-10-26)

Estado: **diseño en papel, a validar por el dueño. Sin código ni migraciones.** Sigue la regla del dueño del 2026-10-26 (`AGENTS.md`, «Diseño de módulos y features nuevos») y es hermano de `docs/diseno-clientes-convenios-y-facturacion-externa-2026-10-26.md` (el «documento hermano»): no lo contradice y cita sus decisiones por sección (por ejemplo «hermano B.5»). Verificado contra el código de la rama `alegp/stoic-davinci-185dm4` en `b1af7df8` (solo lectura).

Insumos: el pedido del dueño del 2026-10-26 (consigna de este diseño y respuesta H5 del documento hermano); `prisma/schema.prisma`; las migraciones `20260924150903_pos_mesas_cuentas`, `20261014140000_rls_sucursal_b4_punto_de_venta`, `20261020131000_go1d_rls_sucursal_opcion_elegida`, `20261021111000_go3a_rls_sucursal_combinaciones` y `20261015122000_m2_cabecera_de_venta`; `src/server/actions/pos/**`, `src/server/actions/movimientos/**`, `src/core/pos/**`, `src/server/consultas/pos/**`, `src/server/lecturas/pos/**`, `src/server/consultas/reportes/**`, `src/core/permisos/acciones.ts`; `docs/plan-tomar-pedido-2026-09-25.md`, `docs/plan-numeracion-boleta-2026-09-25.md`, `docs/decisiones-cerradas-ola-precio-y-carta-2026-10-19.md` (DEC-25), `docs/pendientes-sesion-2026-10-22.md`.

Estados de cada decisión: **CONFIRMADA** (dicha por el dueño; se cita dónde), **PROPUESTA** (de este diseño), **PENDIENTE** (falta decidir), **NO VERIFICADA** (no se pudo comprobar en el código).

## 0. Lo que el dueño ya decidió (y este diseño respeta)

| Decisión | Estado y fuente |
|---|---|
| La «venta de mostrador» de hoy (`registrarVenta`) está MAL LLAMADA: no tiene cuenta, ni ticket, ni cliente. El mostrador tiene que operar COMO UNA MESA: mismas pantallas y mismo flujo del salón (pedido con opciones y promos, enviar, cerrar cuenta, ticket numerado con ejemplares, cliente con %, y más adelante convenio y agente) | CONFIRMADA (consigna de este diseño; hermano H5, respuesta del 2026-10-26) |
| Forma sugerida por el dueño: «una mesa llamada Mostrador fija, o un apartado en el salón con las mismas pantallas, básicamente» | CONFIRMADA como intención; la forma concreta es la PROPUESTA de la sección B |
| «Cerrar cuenta» registra la venta y libera la mesa; **no es cobrar** (no hay caja ni medios de pago todavía) | CONFIRMADA (hermano B.6) |
| Un solo beneficio por ticket | CONFIRMADA (hermano H4) |
| Lo no pactado en la mesa de un convenio se rechaza y se vende por mostrador; dividir la cuenta es otra etapa | CONFIRMADA (hermano H5). Por eso el mostrador con cliente y ticket importa |
| Promo con interruptor «solo salón» (no aparece en la carta pública; se vende en el POS) | CONFIRMADA (hermano H1). El mostrador es POS: una promo «solo salón» se vende también en el mostrador (PROPUESTA) |
| Modelo completo en papel; se migra SOLO la etapa en curso, aditiva y con `down.sql`; nada de tablas que nadie escribe | CONFIRMADA (`AGENTS.md`; hermano §0) |

Reglas de ingeniería: las mismas del hermano §0 (SERIALIZABLE con `conTransaccionSerializable`, índices únicos parciales como árbitro, I3 cuando un comando crea filas, escritura y auditoría en la misma transacción, RLS por empresa y por sucursal, autorización por clave con piso y fail-closed, dinero `Decimal(14,2)` con `src/core/moneda.ts`, fechas en la zona de la empresa, nada se borra).

---

## A. Hallazgo verificado: qué es hoy el «mostrador» y en qué difiere de una cuenta de mesa

### A.1 Qué es hoy

- **Entrada**: menú Movimientos › «Venta» (`NAV_MOVIMIENTOS`, `src/core/movimientos/ui-config.ts`, línea 86: `label: "Venta"`, `accion: "proceso_venta"`), página `src/app/(app)/movimientos/venta/page.tsx` (título «Venta») y formulario `venta-form.tsx`. En el código real **la etiqueta visible es «Venta»**; «Venta de mostrador» es el nombre de los comentarios, de los tipos (`venta.schema.ts`: «Tipos de la feature Venta de mostrador») y del `detalle` que escriben los scripts de demo. Que la emulación de la Fase 7 la llame «Venta de mostrador»: NO VERIFICADA (la emulación es un artifact externo, `docs/decisiones-cerradas-ola-precio-y-carta-2026-10-19.md` línea 31; se toma de la consigna).
- **Comando**: `registrarVenta` (`src/server/actions/movimientos/venta.ts`): `conPermiso("proceso_venta")` → `guardComandoRegistrarVenta` (`src/core/features/ventas/venta.guard.ts`) → `registrarVentaCasoDeUso` (`src/server/actions/movimientos/casos-de-uso/registrar-venta.ts`) → núcleo `registrarVentaEnTx` (`src/server/actions/movimientos/casos-de-uso/registrar-venta-en-tx.ts`), el MISMO núcleo que usa `cerrarCuenta`.
- **Lo que recibe** (`DatosVentaInput`, `src/core/features/ventas/venta.schema.ts`): `fecha`, `seccionId`, `proveedorId?` («a quién se vende», sin selector en la pantalla), `nroFactura?`, `detalle?`, `ventas[]` de `{ productoId, cantidadVendida }` y `claveIdempotencia?`.
- **Lo que escribe**: una `Operacion` VENTA por línea con sus `MovimientoStock` (Kardex). Nada más: ni `Cuenta`, ni `CuentaItem`, ni `EjemplarTicket`, ni `Venta` (cabecera sin escritor), ni auditoría propia (`@ficha … auditoria=DOCUMENTO_PROPIO`).

### A.2 Quién llama hoy a `registrarVenta`

| Llamador | Para qué | Estado |
|---|---|---|
| `src/app/(app)/movimientos/venta/venta-form.tsx` | La única pantalla | Verificado |
| `scripts/seed-demo-pizzeria.ts` (con `detalle: "Venta de mostrador"`) y `scripts/seed-demo-pizzeria-6-meses.ts` | Cargar meses de ventas **con fecha pasada** para las demos | Verificado |
| `scripts/demo-seed/guion.ts` | Lo nombra como el camino de carga del guion de demo | Verificado (comentarios) |
| 63 archivos de `test/` (reportes, auditoría de precisión, idempotencia, concurrencia, caracterizaciones de la etapa A, recetas…) | Es el **dispositivo de prueba** para fabricar ventas | Verificado (`grep` de `registrarVenta\b` en `test/`) |
| Ningún otro código de `src/` | — | Verificado |

Consecuencia: `registrarVenta` no es solo una pantalla; es también **la carga directa y retroactiva** del sistema. Retirarlo tiene un costo enorme en pruebas y demos (sección C).

### A.3 Comparación punto por punto (verificada)

| Tema | Cuenta de mesa (`cerrarCuenta`) | «Venta» de Movimientos (`registrarVenta`) |
|---|---|---|
| Documento | `Cuenta` con `CuentaItem` (precio congelado al pedir), `PromoCuenta`, fotos de opciones; se cierra una vez | Ninguno: solo las `Operacion` VENTA |
| Fecha | `ctx.ahora` (la hora del pedido de cierre) | La elige quien carga: hasta 400 días atrás y no después de mañana (`validarFechaOperacion`, `src/core/datos/fecha-operacion.ts`); la pantalla manda el mediodía del día elegido |
| Precio | El congelado en `CuentaItem.precioUnitario` (override del núcleo) | Lo resuelve el núcleo al vender (`resolverPrecioVenta`: precio local o global); un `precioUnitario` colado en el POST se ignora (test `venta-en-tx`) |
| Descuento de producto | Sí (`precioCobradoConDescuentos`, «rige el mayor») | **No** («se aplica en la carta pública y en el POS, no en la venta de mostrador», `src/server/actions/carta/descuento-producto.ts`) |
| Cliente y % | `Cuenta.clienteId` + snapshot `descuentoPorcentaje`; se copia a `Operacion.clienteId` | **No** (D6: `Operacion.clienteId` existe «para que esa extensión, cuando llegue, no pida otra migración», `prisma/schema.prisma`, modelo `Operacion`) |
| Promos | Sí (`PromoCuenta`, `Operacion.promoCuentaId`) | **No** («`registrarVenta` (mostrador) nunca lo pasa») |
| Opciones (tamaño, adicionales) | Sí (GO-1/GO-2b) | **No**: un producto con grupo obligatorio se rechaza con `PRODUCTO_REQUIERE_OPCIONES` («se cobra desde las mesas/POS», `venta.schema.ts`; `src/core/movimientos/opciones-obligatorias.ts`) |
| De qué sección sale el stock | `origen: automatico` (sección habitual del producto → secciones de respaldo) | `origen: seccion` (la elige una persona en el formulario) |
| Stock insuficiente | **No bloquea** (B6bis): se registra igual y deja una fila de auditoría por insumo en negativo | **Bloquea** (no pasa `permitirStockNegativo`) |
| Enviar a cocina | Obligatorio antes de cerrar (`ITEMS_SIN_ENVIAR`) | No existe |
| Ticket | `EjemplarTicket` A: `numero = max + 1` por sucursal dentro de la transacción, después de validar la venta (`siguienteNumeroTicket`, `src/core/pos/numeracion-ticket.ts`) | **Ninguno** |
| Anulación | `anularVenta` por línea (Trazabilidad) + `emitirTicketCorregido` (ejemplar B) | `anularVenta` por línea; sin ticket que corregir |
| Idempotencia | Por estado (`YA_CERRADA`), sin I3; la apertura también por estado (la mesa ya tenía cuenta → ok) | I3: `claveIdempotencia` + `payloadHash` + `resultadoMensaje` en la PRIMERA `Operacion` del lote |
| Transacción | SERIALIZABLE (8 intentos) | SERIALIZABLE (8 intentos, `tambienChoqueDeUnico = true`) |
| Auditoría | Cliente asignado (dos filas), anulaciones, stock negativo | Ninguna propia |
| Permisos | `pos_mesas` (ver), `pos_abrir_cuenta`, `pos_tomar_pedido`, `pos_enviar_a_cocina`, `pos_asignar_cliente`, `pos_anular_item`, `pos_cerrar_cuenta`, `pos_emitir_ticket_corregido`, `pos_liberar_mesa` (`acciones.ts`, líneas 184 a 233; semilla solo `admin`) | `proceso_venta` (`acciones.ts`, línea 115; piso operario; semilla `admin` y `operador`); anular: `anular_venta` (línea 130) |
| Módulo | `salon` | `salon` (la misma clave de módulo) |
| `detalle` de la `Operacion` | `Mesa N` | Texto libre opcional (los scripts escriben «Venta de mostrador») |
| N.º de factura | No | Sí, texto libre opcional (`Operacion.nroFactura`; el único parcial `Operacion_factura_unica_vigente_key` es solo de COMPRA) |

### A.4 Reportes: qué depende de `Cuenta` y qué no

| Reporte o lectura | Fuente | ¿Distingue mesa de mostrador? |
|---|---|---|
| Período, margen, ventas por categoría, costo de lo vendido, pérdidas (`src/server/consultas/reportes/periodo.ts` y vecinos) | `MovimientoStock` VENTA + `Operacion` | **No**: cuentan igual las dos. `Operacion.cuentaItems` se lee solo para marcar líneas con opciones |
| Tickets emitidos (`tickets-emitidos.ts`) | `EjemplarTicket` → `Cuenta` → `mesa.numero` | Solo ve cuentas: la venta de Movimientos no aparece |
| Rotación de mesas (`rotacion-mesas.ts`) | `Cuenta` filtrada por `mesa: { sucursalId }`, con `comensales` | Solo cuentas |
| Descuentos de productos (`descuentos-productos.ts`) | `CuentaItem.precioCartaUnitario` | Solo cuentas (el mostrador no aplica ese descuento) |
| Margen de promociones (`margen-promociones.ts`) | `CuentaItem` por `operacionId` | Solo cuentas |
| Descuentos por cliente (`descuentos-clientes.ts`) | `Operacion.clienteId` no nulo | Solo lo que escribe `cerrarCuenta` |
| Cabecera `Venta` con `canal` MESA/MOSTRADOR (`20261015122000_m2_cabecera_de_venta`) | — | **Sin escritor** («Nada de `src/` la escribe todavía (Etapa C)») |

Hoy la única forma de separar las dos se **deriva**: una `Operacion` VENTA con `CuentaItem` enlazado viene de una cuenta; sin ninguno, de la carga directa. Ningún reporte usa ese corte (búsqueda de `canal`/`CanalDeVenta`/`MOSTRADOR` en `src/`: no encontrado).

### A.5 Concurrencia y aislamiento de la cuenta (lo que condiciona el diseño)

- **Una cuenta abierta por mesa**: índice único parcial `Cuenta_una_abierta_por_mesa_key` sobre `Cuenta("mesaId") WHERE "cerradaEn" IS NULL` (migración `20260924150903_pos_mesas_cuentas`, al final). Lo prueba `test/pos/cuenta-una-abierta-por-mesa.test.ts`. El estado de la mesa (libre, en pedido, ocupada) se DERIVA de esa única cuenta (`resolverEstadoMesa` y `armarMapaDeMesas`, `src/core/pos/mesas.ts`: «el índice único parcial garantiza a lo sumo una abierta»; `obtenerDetalleDeMesa` toma `cuentas[0]`).
- **`abrirCuenta`** (`src/server/actions/pos/casos-de-uso/abrir-cuenta.ts`): toma `mesaId` y es idempotente por estado (si la mesa ya tiene cuenta, ok sin escribir); exige comensales (`validarComensales`, 1 a `COMENSALES_MAXIMO`); cuenta las cuentas abiertas de la sucursal contra `Sucursal.maxMesasAbiertas` dentro de la misma transacción.
- **Todos los demás comandos del POS toman `cuentaId`**, no `mesaId` (`agregarItems`, `enviarACocina`, `quitarItemSinEnviar`, `anularItemEnviado`, `asignarClienteACuenta`, `corregirComensales`, `liberarMesa`, `cerrarCuenta`, `emitirTicketCorregido`) y validan con `cuentaAbiertaDeSucursal` (`src/server/persistencia/pos/cargar-cuenta-abierta.ts`), que filtra por `mesa: { sucursalId }`.
- **La sucursal de la cuenta sale de la mesa**. `Cuenta` es `HEREDADA` de `Mesa` por `mesaId` (`test/setup/clasificacion-de-tablas.ts`, `ALCANCE_HEREDADA`), y la RLS por sucursal lo materializa: 24 políticas RESTRICTIVE (4 por tabla) en `Cuenta`, `CuentaItem`, `AgregadoDeCuenta`, `PromoCuenta`, `OpcionElegidaEnLinea` y `CombinacionEnLinea` filtran con `"mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = …)` (migraciones `…140000_rls_sucursal_b4_punto_de_venta`, `…131000_go1d_rls_sucursal_opcion_elegida`, `…111000_go3a_rls_sucursal_combinaciones`). **Una cuenta con `mesaId` nulo sería invisible para la app y su INSERT fallaría (42501).** 27 archivos de `src/` leen `mesa.numero`, `mesaNumero` o filtran por `mesa: { sucursalId }`.
- **Ticket**: `max + 1` por sucursal dentro del cierre SERIALIZABLE; dos cierres a la vez chocan y uno reintenta (`docs/plan-numeracion-boleta-2026-09-25.md`, D2, verificado forzando el solapamiento). El tope de 8 intentos «puede agotarse con muchas ventas simultáneas en una sucursal» (`docs/pendientes-sesion-2026-10-22.md`, «Concurrencia de ventas»).
- **Apagar una sucursal** cuenta sus cuentas abiertas (`src/server/actions/auth/casos-de-uso/actualizar-activo-sucursal.ts`).
- **Las lecturas de entradas del POS** (selector de carta, promos y sus entradas, módulos: `src/server/lecturas/pos/selector-carta.ts`, `entradas-de-promo-para-vender.ts`, `promo-para-agregar.ts`, `modulos-del-pos.ts`) son por **sucursal**, no por mesa: sirven tal cual para el mostrador.

### A.6 Lo que existe con otro nombre (y lo que no)

**Existe y se reutiliza**: todo el flujo de la cuenta (sección A.5); `Venta.canal` con el valor `MOSTRADOR` (enum `CanalDeVenta`, sin escritor); `Operacion.clienteId` preparado para el mostrador (D6); `nombreDeMesa` (`src/core/pos/formato.ts`, «Mesa 07»); la pantalla de la mesa (`src/app/(pos)/mesas/[mesaId]/page.tsx` y sus componentes) y «Cuentas cerradas» por mesa (`obtenerTicketsRecientes`, `src/server/consultas/pos/tickets.ts`).

**Choca con el pedido del dueño**: `Venta_canal_y_cuenta_chk` exige `canal = MESA` **si y solo si** hay `cuentaId`. Con el mostrador como cuenta, una venta de mostrador tendría cuenta y canal MOSTRADOR: el CHECK la rechazaría. Como `Venta` está vacía y sin escritor, se corrige cuando llegue su escritor (sección C.4), sin migrar nada ahora.

**No encontrado**: un tipo o nombre de mesa (`Mesa` solo tiene `numero`, único por sucursal, 1 a 9999 por el guard `src/core/features/mesas/mesas.guard.ts`, sin CHECK en la base); varias cuentas abiertas por mesa; una cuenta sin mesa; una entrada «Mostrador» en el salón (`src/core/navegacion/estructura.ts`: el grupo «Salón» tiene solo «Mapa de mesas»); un corte mesa/mostrador en reportes; un número de pedido o de llamador; el archivo `docs/plan-numeracion-ticket-2026-09-25.md` que citan `src/core/pos/numeracion-ticket.ts` y el schema (existe con el nombre viejo, `docs/plan-numeracion-boleta-2026-09-25.md`).

---

## B. Variantes de diseño y recomendación

El punto clave: **una mesa admite UNA cuenta abierta** (índice parcial), pero **un mostrador necesita VARIAS a la vez** (varios clientes, varios cajeros). Si el dueño contesta que alcanza con una a la vez (H1), todas las variantes se simplifican.

### Variante 1. Una mesa especial «Mostrador» por sucursal, con una cuenta abierta a la vez

Una fila de `Mesa` marcada como mostrador, siempre disponible, que usa la pantalla de la mesa tal cual.
- **Concurrencia**: el índice de hoy la limita a una cuenta abierta: el segundo cliente espera a que se cierre la del primero. Dos cajeros sobre la misma cuenta se ordenan por SERIALIZABLE (igual que dos mozos en una mesa).
- **Numeración de cuentas**: no hace falta (hay una sola abierta).
- **Ticket**: el mismo `max + 1` de la sucursal; el mostrador comparte secuencia con el salón (D1 del plan de numeración: contador por sucursal).
- **`maxMesasAbiertas`**: el mostrador contaría como una mesa abierta más (hay que excluirlo; ver H3).
- **RLS y clasificación**: sin cambios (sigue `HEREDADA` de una mesa real).
- **Costo**: mínimo. **Límite**: en hora pico, una cola de un solo cliente; no sirve para «varios clientes, varios cajeros».

### Variante 2. Cuentas SIN mesa (`mesaId` nulo, canal MOSTRADOR) con un apartado «Mostrador» en el salón

- **Concurrencia**: el índice parcial no las toca (con `mesaId` nulo no hay choque): cuentas ilimitadas.
- **Lo que rompe**: la sucursal de la cuenta sale de la mesa (A.5). Habría que pasar `Cuenta` de `HEREDADA` a `PROPIA` (columna `sucursalId` nueva, rellenada desde `Mesa`, NOT NULL después), reescribir **las 24 políticas** de seis tablas calientes del POS (los hijos dejan de pasar por `Mesa`), tocar los 27 archivos que leen la mesa de la cuenta, y cambiar la FK obligatoria `(empresaId, mesaId)` a opcional con un CHECK «MESA ⇔ hay mesa». Además, `tickets-emitidos` y «Cuentas cerradas» dejan de tener mesa por la cual agrupar.
- **Numeración y quién ve qué**: una lista nueva de cuentas de mostrador por sucursal; ticket igual que hoy.
- **`maxMesasAbiertas`**: fácil de excluir (`mesaId` nulo).
- **Costo y riesgo**: los más altos (RLS, relleno en tabla caliente, 6 tablas, 27 archivos). Contradice «no refactorizar lo que no se pidió».

### Variante 3. Un puesto «Mostrador» (una `Mesa` de tipo MOSTRADOR por sucursal) que admite VARIAS cuentas abiertas

La mesa especial de la variante 1, pero el índice parcial **excluye** al mostrador. Como un índice parcial de `Cuenta` no puede mirar `Mesa.tipo`, la cuenta lleva una **columna discriminadora** (`Cuenta.tipoMesa`) que la base mantiene igual a la de su mesa con una **FK compuesta con discriminador** `(empresaId, mesaId, tipoMesa)` → `Mesa(empresaId, id, tipo)` (precedente ADR-029 §10 y §11, citado en hermano A).
- **Concurrencia**: único parcial nuevo `(mesaId) WHERE cerradaEn IS NULL AND tipoMesa = 'SALON'`: las mesas siguen con una cuenta; el mostrador, con las que hagan falta. Abrir una cuenta de mostrador **crea una fila nueva cada vez**: deja de ser idempotente por estado y necesita I3 (una clave de apertura única global; sección F).
- **Numeración de cuentas de mostrador abiertas**: no hace falta un contador; cada cuenta abierta se identifica por la hora, quién la abrió y una **etiqueta** opcional («Juan», «remera roja»). Un número de llamador queda diferido (H2): sería otro árbitro de concurrencia (otro `max + 1`) sin una necesidad confirmada.
- **Quién ve qué**: todos los que tienen `pos_mesas` en la sucursal ven todas las cuentas abiertas del mostrador (igual que hoy ven todas las mesas); la columna «Atendió» dice de quién es cada una. Filtrar «mis cuentas» es una comodidad de pantalla, no una regla.
- **Ticket bajo concurrencia**: el de hoy (`max + 1` por sucursal; el choque lo arbitra SERIALIZABLE + el único `(sucursalId, numero, ejemplar)`). Más cierres simultáneos = más reintentos: riesgo medible (sección G).
- **`maxMesasAbiertas`**: el conteo pasa a contar solo `tipoMesa = 'SALON'` (cambio de una consulta en `abrir-cuenta.ts`; PROPUESTA, H3).
- **RLS y clasificación**: **sin cambios** (`Cuenta` sigue `HEREDADA` de una `Mesa` real).
- **Pantallas**: el mapa muestra una tarjeta «Mostrador» con cuántas cuentas abiertas tiene; al entrar, la lista de cuentas abiertas y «Nueva cuenta»; cada cuenta abre la MISMA pantalla de pedido, cierre y ticket que una mesa.
- **Costo**: medio (una columna y un índice en `Cuenta`, que es tabla caliente; sección F).

### Variante 3b (respaldo). Varios puestos de mostrador fijos («Mostrador 1», «Mostrador 2»…), cada uno con una cuenta

N filas de `Mesa` de tipo MOSTRADOR, sin tocar el índice: la concurrencia es N (una por caja o por cajero). Sirve si el dueño prefiere «una cuenta por caja» a «cuentas ilimitadas»; no necesita I3 en la apertura (sigue idempotente por estado).

### Comparación

| Criterio | V1 una mesa, una cuenta | V2 cuentas sin mesa | **V3 puesto con varias cuentas** | V3b varios puestos |
|---|---|---|---|---|
| Varias cuentas abiertas | No | Sí, ilimitadas | **Sí, ilimitadas** | Sí, hasta N |
| Índice `Cuenta_una_abierta_por_mesa_key` | Igual | Igual | **Se reemplaza por uno que excluye MOSTRADOR** | Igual |
| RLS por sucursal (24 políticas) | Igual | Se reescribe | **Igual** | Igual |
| Archivos que leen `cuenta.mesa` (27) | Igual | Todos | **Igual** (más el rótulo «Mostrador») | Igual |
| Idempotencia de la apertura | Por estado | I3 | **I3** | Por estado |
| `maxMesasAbiertas` | Hay que excluirlo | Fácil | **Una condición en la consulta** | Hay que excluirlos |
| Riesgo de migración | Bajo | Alto | **Medio** | Bajo |

**Recomendación: Variante 3, en dos etapas chicas** (PROPUESTA): **M1** = el puesto «Mostrador» (columna `Mesa.tipo`), que ya funciona como la variante 1 con una cuenta a la vez y las pantallas de siempre; **M2** = varias cuentas abiertas (discriminador, índice nuevo, clave de apertura, etiqueta). Si el dueño contesta H1 con «una a la vez», M2 no se hace; si prefiere una cuenta por caja, M2 se reemplaza por la 3b (sin tocar el índice). Descartada la variante 2: el beneficio (no tener una mesa ficticia) no paga la reescritura de la RLS y de 27 archivos.

---

## C. La entrada «Venta» de Movimientos y `registrarVenta`

### C.1 Opciones

| Opción | Qué implica | Contra |
|---|---|---|
| (a) Retirarla cuando exista el mostrador | Una sola forma de vender | Se pierde la carga retroactiva (hasta 400 días) y por sección elegida; rompe 63 archivos de prueba y los 3 scripts de demo; contradice DEC-25 (CONFIRMADA el 2026-10-20: «FRECUENTES DIRECTOS (merma, compra, venta)») |
| (b) Renombrarla a «Venta sin ticket» y dejarla igual | Honesto con lo que hace | Sigue como acceso frecuente y compite con el mostrador: el operario elige el camino sin ticket por costumbre |
| (c) Mantenerla como **carga administrativa** («Carga de ventas sin ticket»): cargas atrasadas, ventas que no pasaron por el POS (un evento, un corte de luz) y semillas | Conserva lo único que el mostrador no puede hacer (fecha pasada, sección elegida) | Hay que sacarla de los frecuentes y explicar en la pantalla cuándo usarla |

**Recomendación: (c)** (PROPUESTA, H4). En detalle:
- **Nombre visible**: «Carga de ventas sin ticket» en el menú y en el título de la página (cambia `label` en `NAV_MOVIMIENTOS` y el `<h1>`; **no** la descripción de la clave `proceso_venta` en `ACCIONES`, que tiene paridad con las migraciones de datos, `test/permisos/paridad-catalogo-migraciones.test.ts`, línea 49). Aviso en la pantalla: «Para vender en el momento usá Salón › Mostrador: deja ticket y admite cliente».
- **`registrarVenta` no cambia** (ni su firma, ni su I3, ni el bloqueo por stock): las caracterizaciones `venta-matriz` y `venta-matriz-ampliada` y la red de pruebas quedan intactas.
- **Permisos**: por ahora iguales (`proceso_venta`, semilla `admin` y `operador`). Restringirla a administrador cambia la semilla y regenera la matriz de acceso congelada: decisión aparte (H4).
- **Plan de Movimientos de la Fase 7 (DEC-25)**: el acceso frecuente «venta» pasa a ser un **enlace a Salón › Mostrador**, y la carga sin ticket baja al selector «Registrar movimiento» (junto a los procesos no frecuentes). Cambia una decisión CONFIRMADA: requiere la palabra del dueño (H4). Hasta entonces, nada se mueve.

### C.2 Lo ya cargado sin ticket

- **Sin backfill ni tickets inventados** (mismo criterio que D5 del plan de numeración: «las cuentas cerradas antes no reciben número»). Lo cargado por Movimientos queda como histórico **«sin ticket»**, derivado: una `Operacion` VENTA sin `CuentaItem` enlazado. Si una pantalla lo muestra, dice «Sin ticket (carga directa)», nunca un número.
- Antes del despliegue de M1 se anota, con una consulta de **solo lectura** (contar las `Operacion` VENTA vigentes sin ningún `CuentaItem` que las apunte, por sucursal), cuántas ventas históricas quedan sin ticket: es parte de la línea de base, no se actúa sobre el resultado.

### C.3 Efecto sobre los reportes

Ninguno sobre los de dinero (A.4: salen del Kardex y cuentan igual las dos). Tickets emitidos y Descuentos por cliente empiezan a incluir el mostrador (porque pasa a ser una cuenta), que es justamente lo pedido. Rotación de mesas tiene que **excluir** el mostrador (sección F).

### C.4 La cabecera `Venta` (diferida)

Cuando se escriba `Venta` (su Etapa C), el canal se toma de la cuenta: `MESA` (cuenta de una mesa de salón), `MOSTRADOR` (cuenta del puesto mostrador) y un tercer valor para la carga sin cuenta (nombre PROPUESTO: `DIRECTA`); el CHECK pasa a «sin cuenta ⇔ DIRECTA». Hoy la tabla está vacía y sin escritor: el cambio es barato y va en esa etapa, no en esta. DIFERIDA.

---

## D. Escalera de diseño, niveles 1 a 5 (mostrador como puesto del salón)

### Nivel 1. Propósito y alcance
- **Para qué**: que toda venta en el momento, en mesa o en mostrador, deje **una cuenta con ticket numerado**, con el mismo pedido (opciones, promos, adicionales), el mismo cierre (venta y stock) y la misma puerta a cliente, beneficio y, más adelante, convenio, agente y factura externa. Así lo no pactado de un convenio tiene dónde venderse con ticket (hermano H5).
- **Dentro**: el puesto «Mostrador» por sucursal; abrir, cargar, enviar, cerrar, liberar y anular igual que una mesa; varias cuentas abiertas a la vez (si H1 = sí); el rótulo y la exclusión en los reportes de mesas; el renombre de la carga sin ticket.
- **Fuera**: cobrar (caja, medios de pago, vuelto: hermano B.6), número de llamador, pantalla de cocina, «para llevar» y delivery, dividir o unir cuentas, mover una cuenta del mostrador a una mesa, facturar.

### Nivel 2. Actores y contexto
- **Cajero o mozo** (POS, sucursal activa): abre cuentas de mostrador, carga, envía, cierra. Hoy no hay rol «cajero»: es un rol armado desde la matriz con las mismas claves `pos_*` (H5).
- **Administrador**: habilita el puesto «Mostrador» de la sucursal (como da de alta mesas), anula ventas, emite tickets corregidos, usa la carga sin ticket.
- **Cliente del mostrador**: anónimo por defecto; identificado si se le asigna (cliente con %, y en etapas del hermano: categoría, convenio, agente).
- **Sistemas**: el núcleo de venta (`registrarVentaEnTx`), la carta y promociones (por sucursal), el registro de módulos (`salon`), la numeración de tickets.
- **Contexto técnico**: `Mesa` es `PROPIA`; `Cuenta` y sus hijos `HEREDADA` de la mesa; ticket por sucursal; día en la zona de la empresa.

### Nivel 3. Casos de uso

| # | Caso de uso | Comando | Etapa |
|---|---|---|---|
| CU1 | Habilitar el puesto «Mostrador» de la sucursal (una vez) | nuevo, PROPUESTO `habilitarMostrador` | M1 |
| CU2 | Abrir una cuenta de mostrador (sin comensales; con etiqueta opcional en M2) | M1: `abrirCuenta` sobre la mesa mostrador; M2: nuevo, PROPUESTO `abrirCuentaDeMostrador` | M1 / M2 |
| CU3 | Cargar, quitar, enviar, anular ítems y promos | los de hoy, por `cuentaId` (sin cambios) | M1 |
| CU4 | Asignar o quitar cliente con % | `asignarClienteACuenta` (sin cambios) | M1 |
| CU5 | Cerrar la cuenta: registra la venta, descuenta stock, emite el ticket A | `cerrarCuenta` (sin cambios de regla; solo el rótulo «Mostrador» en el mensaje y el `detalle`) | M1 |
| CU6 | Descartar una cuenta sin ítems | `liberarMesa` (sin cambios) | M1 |
| CU7 | Anular una línea después y emitir el ejemplar B | `anularVenta` + `emitirTicketCorregido` (sin cambios) | M1 |
| CU8 | Ver las cuentas abiertas del mostrador y sus últimos tickets | lectura nueva por mesa mostrador | M1 / M2 |
| CU9 | Cargar ventas sin ticket (fecha pasada, sección elegida) | `registrarVenta` (sin cambios; solo el nombre visible) | M1 |
| CU10 | Beneficios del hermano (categoría, convenio, agente) en una cuenta de mostrador | los del hermano, sin nada propio del mostrador | según el hermano |

### Nivel 4. Conceptos y ciclo de vida
- **Puesto de venta** = `Mesa`. Tipo **SALON** (las de hoy, numeradas) o **MOSTRADOR** (uno por sucursal, sin número visible: se muestra «Mostrador»). El tipo no cambia nunca.
- **Cuenta**: la de siempre. Su ciclo no cambia (hermano C): abierta → cerrada con venta y ticket A | cerrada sin venta (liberada o neto cero). En el mostrador, «abierta» no ocupa el puesto: el puesto nunca está «ocupado»; su estado derivado es «N cuentas abiertas».
- **Etiqueta** (M2): texto corto para reconocer una cuenta abierta del mostrador. No es un cliente, no se factura, no se imprime como dato fiscal.
- **Ticket**: el de hoy (número por sucursal, compartido entre salón y mostrador; ejemplares A, B…).
- **Venta sin ticket**: la carga directa; histórica y administrativa (sección C).
- **Comensales**: solo miden rotación de mesas; en el mostrador **no aplican** (NULL), y la rotación lo excluye por tipo (no por el NULL, que hoy significa «abierta antes del cambio»).

### Nivel 5. Invariantes y políticas

| # | Invariante | Lo impone | Estado |
|---|---|---|---|
| I1 | A lo sumo un puesto MOSTRADOR por sucursal | único parcial en `Mesa` | PROPUESTA |
| I2 | El tipo de un puesto no cambia y la cuenta lleva el tipo de su puesto | FK compuesta con discriminador (NO ACTION: no se puede cambiar `Mesa.tipo` con cuentas) | PROPUESTA (M2) |
| I3 | Una mesa de salón tiene a lo sumo una cuenta abierta; el mostrador, las que hagan falta | único parcial con `tipoMesa = 'SALON'` | PROPUESTA (M2); EXISTE para todas las mesas hoy |
| I4 | El mostrador no cuenta para `maxMesasAbiertas` | consulta de `abrirCuenta` | PROPUESTA (H3) |
| I5 | Toda venta de mostrador hecha desde el POS deja ticket A numerado, salvo neto cero | `cerrarCuenta` (EXISTE) | EXISTE |
| I6 | Un solo beneficio por ticket, también en el mostrador | hermano I1 | CONFIRMADA (hermano H4) |
| I7 | Mismas reglas de cierre que una mesa: precio congelado al pedir, sección automática, stock negativo no bloquea y se audita, hay que enviar antes de cerrar | `cerrarCuenta` (EXISTE) | PENDIENTE (H3: es un cambio frente al «mostrador» de hoy, que bloquea por stock) |
| I8 | Abrir una cuenta de mostrador con la misma clave de reintento devuelve la misma cuenta | único global de la clave de apertura | PROPUESTA (M2) |
| I9 | Una cuenta cerrada no se reabre ni se edita; corregir es anular una línea y emitir el ejemplar B | EXISTE | EXISTE |
| I10 | La carga sin ticket no inventa tickets ni cuentas, y no se usa para vender en el momento | sección C (nombre, aviso, ubicación) | PROPUESTA |
| I11 | El mostrador ve lo mismo que el salón de la carta y las promos de su sucursal (incluidas las «solo salón») | lecturas por sucursal (EXISTE) | PROPUESTA |
| I12 | Nada se borra: el puesto no se borra (FK RESTRICT de `Cuenta`); una cuenta sin ítems se cierra sin venta | EXISTE | EXISTE |

Políticas: las claves de hoy, fail-closed (sin fila de `PermisoRol` no hay acceso; módulo `salon` apagado rechaza antes que el rol, ADR-011). Habilitar el puesto pide `pos_alta_mesa` (Editar), como dar de alta una mesa. **Sin claves nuevas en M1 ni en M2** (PROPUESTA; ver F.3).

### «¿Qué pasa si…?»

Comandos: **abrir cuenta de mostrador** (CU2), **cerrar cuenta de mostrador** (CU5) y **habilitar el puesto** (CU1).

| Situación | Abrir cuenta de mostrador | Cerrar cuenta de mostrador | Habilitar el puesto |
|---|---|---|---|
| Doble clic | M1: idempotente por estado (el puesto ya tiene su cuenta → ok, como una mesa). M2: la pantalla manda una clave de apertura generada al mostrar el botón; el segundo envío con la misma clave devuelve la cuenta ya creada (I8), no crea otra | Idempotente por estado (hoy): el segundo ve la cuenta cerrada y responde `YA_CERRADA` sin escribir | Único parcial (I1): el segundo recibe «ya está habilitado» |
| Dos cajeros a la vez | Cada uno abre su cuenta (M2): no chocan entre sí; en M1, el segundo cae en la cuenta del primero (comparten la cuenta, como dos mozos en una mesa) | Sobre cuentas distintas: los dos cierran; la numeración `max + 1` choca, Postgres aborta uno (40001) y `conTransaccionSerializable` lo reintenta: tickets consecutivos, sin huecos. Sobre la misma cuenta: uno cierra, el otro ve `YA_CERRADA`. Cerrar contra agregar: SERIALIZABLE los ordena; lo que llega después de cerrar se rechaza («ya está cerrada») | Dos altas: una gana (I1) |
| Corte de red al cerrar | — | La transacción confirmó o no. Si confirmó, el reintento da `YA_CERRADA` **sin `numeroTicket`** (hoy devuelve `null`): la pantalla no imprime sola; el ticket se reimprime desde «Cuentas cerradas» del mostrador (reimpresión: no consume número, plan de numeración C). Si no confirmó, el reintento cierra normalmente | Releer |
| Reintento automático (40001) | Sin efectos dobles (la clave única arbitra en M2) | Sin efectos dobles; el número se asigna dentro de la transacción reintentada. Con picos, los 8 intentos pueden agotarse (G, riesgo 5) | Igual |
| Stock insuficiente | — | Como una mesa: **no bloquea** (B6bis), registra la venta y deja una fila de auditoría por insumo en negativo. Hoy la carga sin ticket sí bloquea. PENDIENTE (H3) | — |
| Cierre con total 0 | — | Sin líneas netas (todo anulado) → «cerrada sin venta», sin ticket (EXISTE). Una línea vendida a precio 0: si puede existir, NO VERIFICADA (solo los adicionales tienen CHECK `precioUnitario >= 0.01`); el descuento de cliente tiene piso de $0,01 (`precioConDescuento`) | — |
| Anulación posterior | — | `anularVenta` por línea (`anular_venta`, administrador) y ejemplar B (`pos_emitir_ticket_corregido`), igual que una mesa. Con una factura externa aplicada (hermano C), regirá lo que decida esa etapa | — |
| Datos faltantes | Sin puesto habilitado: «Habilitá el mostrador» (solo a quien tiene `pos_alta_mesa`). Sucursal desactivada: rechazo (`SUCURSAL_INACTIVA`, EXISTE). Etiqueta vacía: se acepta (es opcional) | Ítems sin enviar: rechazo `ITEMS_SIN_ENVIAR` (EXISTE). Producto que perdió la receta o con opción obligatoria sin elegir: rechazo, la cuenta sigue abierta (EXISTE) | Sucursal desactivada: rechazo |
| Tiempo | La cuenta no vence (como una mesa, sin vencimiento automático). Las cuentas abiertas del mostrador al final del día quedan visibles con «hace N h» | Hora del cierre = `ctx.ahora`; no se puede cerrar con fecha pasada (para eso, la carga sin ticket) | — |
| Error parcial | Una sola escritura (la cuenta) | Venta, ticket, enlace de ítems, cierre y auditoría en una transacción: todo o nada (EXISTE) | Una escritura + auditoría |
| Cambio de permisos | Se evalúa en cada pedido. Sin `pos_abrir_cuenta`, el botón «Nueva cuenta» queda deshabilitado; las cuentas ya abiertas siguen y otro usuario las puede cerrar | Sin `pos_cerrar_cuenta`, no se cierra; la cuenta queda abierta para otro. Módulo `salon` apagado: rechazo por módulo | Sin `pos_alta_mesa`: rechazo |

---

## E. Escalera de producto N0 a N5 del mostrador

Acumulativa; cada peldaño suma y no rompe lo cargado. Los controles de integridad (ticket sin huecos, aislamiento, una cuenta por mesa de salón) no son peldaños: rigen desde que existe el puesto. Referencias: (E) existe, (F) falta, (H) etapa del documento hermano.

| Peldaño | Qué ve el cliente del sistema | Depende de |
|---|---|---|
| N0 | Puesto «Mostrador» en el salón con las mismas pantallas; ticket numerado; una cuenta a la vez (F, M1) | — |
| N1 | Varias cuentas abiertas a la vez, con etiqueta; el mostrador no cuenta para el límite de mesas (F, M2) | H1 |
| N2 | Cliente con % en el mostrador (E: `asignarClienteACuenta` sirve sin cambios desde N0) y descuento por categoría anónimo (H, N1b) | hermano N1b |
| N3 | Convenio y agente–empresa en una cuenta de mostrador: «lo no pactado» de la mesa del convenio se vende acá, con el % del cliente o sin beneficio (un solo beneficio por ticket) (H, N1 y N3) | hermano N1, N3 |
| N4 | Ticket de mostrador «pendiente de facturar» y aplicable a una factura externa, igual que uno de mesa (H, facturación N3) | hermano facturación |
| N5 | Cobro en caja al cerrar o después (caja N0 del hermano); número de llamador y «para llevar», si se piden (F) | hermano caja |

Eje de **detalle** (perillas, no peldaños): etiqueta de la cuenta; mostrar u ocultar «enviar a cocina» en el mostrador (H3); rótulo del puesto.

**Conexión con el documento hermano** (PROPUESTA): con la variante 3 una venta de mostrador **es una `Cuenta`**, así que todo lo del hermano aplica sin nada propio: el beneficio único (hermano B.3), el imputado (`Cuenta.clienteId`, hermano B.2), `Cuenta.convenioId`, `Cuenta.descuentoCategoriaId` y `Cuenta.agenteVinculoId` (hermano F), la línea TICKET de la factura externa (`ConceptoFacturaExterna.cuentaId`, hermano B.4) y el saldo derivado. Esto resuelve el «PENDIENTE para mostrador» del hermano B.5 y saca la venta de mostrador de su «fuera de alcance» (hermano E, Nivel 1): **la venta sin ticket** (carga directa) es la que sigue sin ser aplicable. Al aprobarse este diseño, se actualiza el hermano en esos dos puntos (solo texto).

---

## F. Modelo de la primera etapa (solo lo que se migra) y lo diferido

Criterios del hermano F: privilegios de `motor2_app` (hoy `Mesa` y `Cuenta` tienen SELECT, INSERT, UPDATE y DELETE por el GRANT general de `scripts/operaciones/crear-rol-motor2-app.sql`, línea 100); cada migración con su `down.sql`; aplicar requiere autorización expresa, respaldo y ensayo en rama de Neon (`docs/deploy-con-migraciones.md`).

### F.1 Etapa M1: el puesto «Mostrador» (la primera que se implementa)

| Objeto | Columnas y reglas | Riesgo |
|---|---|---|
| `Mesa.tipo` (NUEVA columna) | TEXT NOT NULL DEFAULT `SALON`, CHECK `SALON`/`MOSTRADOR` (TEXT + CHECK, como `GrupoDeOpciones_tipo_chk`). Las mesas de hoy quedan `SALON` por el default (no es un dato inventado: es lo que son) | Bajo: `Mesa` se escribe poco; agregar una columna con default constante es solo metadatos |
| CHECK `Mesa_numero_segun_tipo_chk` (NUEVO) | `(tipo = 'MOSTRADOR') = (numero = 0)`: el mostrador ocupa el número 0, que el guard de alta de mesas (1 a 9999) nunca da, y así no choca con `Mesa_sucursalId_numero_key` ni obliga a volver nulo `numero` (lo leen 27 archivos) | Bajo. Antes de aplicar: contar (solo lectura) mesas con `numero <= 0`; si hay, el CHECK no valida y se frena |
| Único parcial `Mesa_un_mostrador_por_sucursal_key` (NUEVO) | `Mesa(sucursalId) WHERE tipo = 'MOSTRADOR'` | Bajo |
| Clasificación y RLS | `Mesa` sigue `PROPIA`; `Cuenta` y sus hijos siguen `HEREDADA`. **Sin políticas nuevas** | Ninguno |
| `down.sql` | Aborta si existe algún puesto MOSTRADOR (sus cuentas lo apuntan con RESTRICT); si no, quita índice, CHECK y columna | — |

Código de M1 (sin regla de negocio nueva): `habilitarMostrador` (caso de uso nuevo: SERIALIZABLE, el único parcial arbitra, auditoría); `abrirCuenta` acepta el puesto mostrador **sin comensales** (NULL) y lo excluye del conteo de `maxMesasAbiertas`; rótulo «Mostrador» donde hoy se arma «Mesa N» (una función pura junto a `nombreDeMesa`, usada por el mapa, la pantalla, los mensajes, el `detalle` de la `Operacion`, el ticket impreso y Tickets emitidos); Rotación de mesas filtra `tipo = SALON`; el mapa dibuja la tarjeta «Mostrador» aparte.

### F.2 Etapa M2: varias cuentas abiertas (solo si H1 = sí)

| Objeto | Columnas y reglas | Riesgo |
|---|---|---|
| Único `Mesa(empresaId, id, tipo)` (NUEVO) | Destino de la FK con discriminador | Bajo |
| `Cuenta.tipoMesa` (NUEVA columna) | TEXT NOT NULL DEFAULT `SALON`, CHECK `SALON`/`MOSTRADOR`; FK `(empresaId, mesaId, tipoMesa)` → `Mesa(empresaId, id, tipo)` (NO ACTION) | **Medio**: `Cuenta` es tabla caliente. Columna con default constante = metadatos; la FK se agrega `NOT VALID` y se valida aparte, fuera de horario y con `lock_timeout` (precedentes `20261021110000_go3a_combinaciones` y `20261021130000_producto_modo_de_venta`) |
| Único parcial `Cuenta_una_abierta_por_mesa_de_salon_key` (NUEVO) y retiro de `Cuenta_una_abierta_por_mesa_key` | `(mesaId) WHERE cerradaEn IS NULL AND tipoMesa = 'SALON'`. Primero se crea el nuevo, después se quita el viejo (dos migraciones: nunca hay un instante sin árbitro) | **Medio**: construir un índice único en tabla caliente; con `CONCURRENTLY` va en una migración propia, fuera de transacción. `down.sql` recrea el viejo y **aborta** si hay dos cuentas abiertas en el mostrador |
| `Cuenta.claveApertura` (NUEVA columna, NULL) | Única global (como `AgregadoDeCuenta.claveIdempotencia`); CHECK: solo con `tipoMesa = 'MOSTRADOR'`. Reintento con la misma clave y la misma etiqueta → la misma cuenta; con otra etiqueta → conflicto | Bajo |
| `Cuenta.etiqueta` (NUEVA columna, NULL) | TEXT, un carácter visible y hasta 40; CHECK: solo con `tipoMesa = 'MOSTRADOR'` (fail-closed: si las mesas la quieren, se amplía después). Editable mientras la cuenta esté abierta, con auditoría | Bajo |
| CHECK `Cuenta_comensales_segun_tipo_chk` (NUEVO) | `tipoMesa = 'SALON' OR comensales IS NULL` | Bajo |

Código de M2: `abrirCuentaDeMostrador` (SERIALIZABLE, I3 con la clave de apertura, `tambienChoqueDeUnico = true` como el ticket corregido); lectura «cuentas abiertas del mostrador»; la pantalla del pedido se abre por cuenta (la de la mesa toma la única cuenta abierta; la del mostrador, la elegida). El resto de los comandos no cambia: ya trabajan por `cuentaId`.

### F.3 Claves de permiso

- **M1 y M2: ninguna clave nueva** (PROPUESTA). Habilitar el puesto: `pos_alta_mesa`; abrir: `pos_abrir_cuenta`; el resto, las de hoy. La matriz de acceso congelada no se regenera.
- **Propuestas, no creadas** (solo si el dueño quiere separar al cajero del mozo, H5): `pos_mostrador` (sucursal, piso operario, semilla solo `admin`, módulo `salon`, clase O): ver y operar el puesto mostrador, exigida además de las `pos_*`. Y, si se decide restringir la carga sin ticket (H4), **no** una clave nueva sino cambiar la semilla de `proceso_venta` a solo `admin` (regenera la matriz con motivo declarado en `test/arquitectura/caracterizaciones-congeladas.test.ts`).

### F.4 Diferido (en papel)

- Cabecera `Venta` con canal `MESA`/`MOSTRADOR`/`DIRECTA` y su CHECK nuevo (C.4).
- Número de llamador o de pedido del día (otro `max + 1` por sucursal y día; H2).
- «Para llevar» y delivery como otros tipos de puesto (el CHECK de `Mesa.tipo` se amplía con otra migración).
- Mover una cuenta del mostrador a una mesa y viceversa (choca con I2: sería cerrar y abrir, o un comando propio).
- Todo lo del hermano (beneficios, convenio, agente, factura externa, caja).

### F.5 Guardianes que se tocan (verificados que existen)

`test/pos/cuenta-una-abierta-por-mesa.test.ts` (M2: se reescribe al índice nuevo y suma «dos abiertas en el mostrador»), `test/pos/cuenta-concurrencia.test.ts`, `test/pos/abrir-cuenta-lee-el-limite-en-la-transaccion.test.ts`, `test/pos/limite-mesas-action.test.ts`, `test/pos/crear-mesa-action.test.ts`, `test/persistencia/multiempresa-estructura.test.ts` (FK con discriminador), `test/setup/clasificacion-de-tablas.ts` (sin cambio de alcance; verificar que lo acepte), `test/arquitectura/escrituras-auditadas.test.ts`, `test/arquitectura/toda-accion-se-usa.test.ts`, `test/e2e/pos-tomar-pedido.spec.ts`, `test/e2e/pos-mapa-de-mesas.spec.ts`, `test/e2e/pos-comensales-limite-mesas.spec.ts`. **No se regeneran**: `test/pos/caracterizacion/huella-del-pos.golden.txt`, `venta-con-opciones.golden.txt`, `venta-matriz.golden.txt`, `venta-matriz-ampliada.golden.txt`, `matriz-de-acceso.txt` (los casos del mostrador van en archivos de prueba nuevos). Que no haya otros afectados: NO VERIFICADA hasta correr la suite.

---

## G. Piezas y riesgos

**Piezas (estimación)**: M1 = 1 migración de esquema + 1 caso de uso nuevo (`habilitarMostrador`) + 3 ajustes de regla chicos (`abrirCuenta` sin comensales y fuera del límite, rotación por tipo) + rótulo en ~8 lugares + tarjeta y entrada del mostrador en el mapa + renombre de la carga sin ticket + pruebas (unidad, integración con base, e2e). M2 = 3 migraciones (columnas y FK; índice nuevo; retiro del viejo) + 1 caso de uso (`abrirCuentaDeMostrador`) + 1 lectura + pantalla de lista + pruebas de concurrencia reales.

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | **Dinero**: el mostrador por cuenta cobra el precio congelado al pedir y aplica el descuento de producto, que la carga sin ticket no aplica: el mismo producto puede salir a precios distintos según el camino | Es el comportamiento del salón y lo que el dueño pide; la carga sin ticket queda rotulada como administrativa (C). Las caracterizaciones de la venta no se regeneran: prueba de que el núcleo no cambió |
| 2 | **Stock**: el mostrador pasa de «bloquea por stock» a «no bloquea y audita» y de «sección elegida» a «sección automática» | Decisión explícita (H3); el respaldo por sección (`Seccion.sirveDeRespaldoEnVentas`) ya existe |
| 3 | **Ticket y numeración**: el mostrador comparte la secuencia del salón (más cierres por minuto) | La secuencia por sucursal sin huecos ya está probada bajo solapamiento; si el dueño quisiera secuencias separadas sería otra decisión (no se propone) |
| 4 | **Índice en tabla caliente** (M2): reemplazar el árbitro de «una cuenta por mesa» | Crear el nuevo antes de quitar el viejo; `CONCURRENTLY`; ensayo en rama de Neon; `down.sql` que aborta si el estado ya no admite el índice viejo |
| 5 | **Concurrencia de cierres**: tope de 8 reintentos (`docs/pendientes-sesion-2026-10-22.md`) | Medir con la prueba de concurrencia real (varios cierres simultáneos en una sucursal) antes de habilitar M2; la alternativa (`pg_advisory_xact_lock` por sucursal) queda para cuando se mida |
| 6 | **Reportes**: Rotación de mesas incluiría el mostrador; Tickets emitidos lo mostraría como «Mesa 00» | Filtro por tipo y rótulo, con pruebas |
| 7 | **Idempotencia de la apertura** (M2): deja de ser por estado | Clave I3 con único global; prueba de doble envío y de reintento con 23505 |
| 8 | **Goldens congelados** | Ninguno se regenera en M1 ni en M2; si alguno cambia, es señal de que se tocó una regla que no se pidió |
| 9 | **Hábitos**: los operarios siguen usando la carga sin ticket | Renombre, aviso en la pantalla y (H4) sacarla de los frecuentes |

---

## H. Preguntas para el dueño (con recomendación)

**Respuestas del dueño (2026-10-26): las cinco CONFIRMADAS con lo recomendado.**
1. Varias cuentas de mostrador abiertas a la vez, sin tope propio, con un solo puesto «Mostrador» por sucursal (variante 3; etapas M1 y M2). CONFIRMADA.
2. Cada cuenta abierta se reconoce por la hora, quién la abrió y una etiqueta opcional; el número de llamador queda diferido. CONFIRMADA.
3. El mostrador hereda las cuatro reglas de la mesa: enviar antes de cerrar, el stock insuficiente no frena (queda auditado), el stock sale de la sección habitual y no cuenta para el límite de mesas. CONFIRMADA («sí a todo»).
4. La entrada «Venta» de Movimientos pasa a llamarse «Carga de ventas sin ticket» (cargas atrasadas y ventas fuera del POS), sale de los frecuentes de DEC-25 y en su lugar va un acceso a Salón › Mostrador. CONFIRMADA. Esto modifica DEC-25 por palabra del dueño.
5. Sin claves de permiso nuevas: el mostrador lo opera quien tiene los permisos del salón. CONFIRMADA.

Texto original de las preguntas (para referencia):

1. **¿Puede haber varias cuentas de mostrador abiertas a la vez (varios clientes esperando, varios cajeros)?** Recomiendo: **sí, sin tope propio**, con un solo puesto «Mostrador» por sucursal (variante 3). Si preferís una cuenta por caja, hacemos «Mostrador 1, 2…» (3b); si alcanza con una a la vez, solo la etapa M1.
2. **¿Cómo se reconoce cada cuenta abierta del mostrador?** Recomiendo: por la hora, quién la abrió y una **etiqueta opcional** («Juan»); el número de llamador lo dejamos para cuando lo pidas.
3. **El mostrador hereda las reglas de la mesa: hay que «enviar» antes de cerrar, el stock insuficiente no frena la venta (queda auditado), el stock sale de la sección habitual de cada producto, y no cuenta para el límite de mesas abiertas. ¿De acuerdo?** Recomiendo: **sí a todo**; si «enviar» molesta en el mostrador, un botón «Enviar y cerrar» en la pantalla (sin cambiar la regla).
4. **La entrada «Venta» de Movimientos: ¿la mantenemos como «Carga de ventas sin ticket» (para cargas atrasadas y ventas fuera del POS), la sacamos de los accesos frecuentes de la Fase 7 (DEC-25) y ponemos en su lugar un acceso a Salón › Mostrador?** Recomiendo: **sí**; lo ya cargado queda «sin ticket», sin inventar números. Restringirla a administradores lo dejamos para después de ver el uso.
5. **¿El mostrador lo opera cualquiera que hoy tiene los permisos del salón, o querés un permiso propio de «cajero»?** Recomiendo: **los mismos permisos del salón** (sin claves nuevas); el permiso propio `pos_mostrador` solo si necesitás que un mozo no pueda vender en el mostrador.

---

## I. Plan de etapas

**Fase 4: diseño de tablas (sin aplicar a ninguna base)**
1. El dueño contesta H1 a H5; se actualizan los estados de este documento y, en solo texto, el hermano (B.5 y Nivel 1).
2. **Línea de base**, en el commit de partida: `prisma/schema.prisma` con 107 modelos; `ACCIONES` con 131 claves (55 operario, 62 administrador, 12 administrador de sistema, 2 gerente); 144 carpetas en `prisma/migrations`; 1119 archivos de prueba de Vitest y 154 specs de Playwright (conteo de archivos; los conteos de tests los da la corrida); los blobs de los goldens congelados (`test/arquitectura/caracterizaciones-congeladas.test.ts`); y, por sucursal, la cantidad de ventas históricas sin ticket (consulta de solo lectura de C.2). Se anotan en el ADR.
3. ADR nuevo (número a asignar) «El mostrador es un puesto del salón», con las decisiones de B, C y D.
4. Migración de M1 escrita (columna, CHECK, único parcial) con `down.sql` y la prueba de subir, bajar y subir. **No se aplica** sin autorización expresa, respaldo y ensayo en rama de Neon.

**Fase 5: implementación de M1 (pasos chicos, un commit cada uno)**
1. Núcleo puro: rótulo del puesto (junto a `nombreDeMesa`), estado derivado del puesto mostrador, y pruebas.
2. Migración M1 + test de esquema + limpiezas de test (`limpiarBaseDeTest`, `limpiar()` de los e2e del POS).
3. `habilitarMostrador` (caso de uso, auditoría) con su prueba de concurrencia (dos altas).
4. `abrirCuenta`: el puesto mostrador sin comensales y fuera de `maxMesasAbiertas` (pruebas nuevas; las de hoy, sin tocar).
5. Rótulo «Mostrador» en mensajes, `detalle`, ticket impreso y Tickets emitidos; Rotación de mesas filtra por tipo.
6. Pantallas: tarjeta «Mostrador» en el mapa y entrada en Salón; la pantalla de la cuenta es la de la mesa.
7. Carga sin ticket: nombre visible y aviso (C.1). Sin tocar `registrarVenta`.
8. E2E: habilitar, abrir, cargar con opciones y promo, asignar cliente, enviar, cerrar, ver el ticket numerado; y la carga sin ticket con su nombre nuevo.

**Fase 5b: M2 (solo si H1 = sí)**: migraciones de F.2 en tres pasos (columnas y FK; índice nuevo; retiro del viejo), `abrirCuentaDeMostrador` con I3, lista de cuentas abiertas, etiqueta, y e2e de dos cuentas a la vez.

**Fase 6: controles**
1. Concurrencia real con clientes `pg` como `motor2_app`: dos aperturas con la misma clave; dos cajeros abriendo a la vez; N cierres simultáneos en la misma sucursal (tickets consecutivos, sin huecos, sin agotar reintentos); cerrar contra agregar en la misma cuenta; una mesa de salón sigue rechazando una segunda cuenta abierta.
2. Aislamiento con dos empresas y dos sucursales: el mostrador de una sucursal no se ve desde otra (la RLS heredada de `Mesa` alcanza).
3. Las caracterizaciones de venta y de cierre y la matriz de acceso **sin regenerar**.
4. Auditoría independiente del bloque (toca dinero, stock y numeración).
5. **Verificación total, en la misma corrida y todo limpio**: `npx tsc --noEmit`, `npm run lint`, `npm run arquitectura`, `npm run analizar:muerto` (0 hallazgos), `npm test`, `npm run build`, `npm run plataforma:build` y `npm run test:e2e`. Criterio: los ocho con salida 0 sobre el commit final (local o el job «Gate (requerido)» del CI), y los conteos de la línea de base cambian solo en lo declarado: M1 = 0 modelos, 0 claves, +1 carpeta de migración y los tests nuevos; M2 = 0 modelos, 0 claves, +3 carpetas de migración y los tests nuevos; goldens con el mismo blob.

Después: las etapas del hermano (N1b, N1, N3 y facturación) se aplican a las cuentas de mostrador sin trabajo propio, salvo las pruebas e2e que lo demuestren.

---

## J. Plan de implementación verificado contra el código (M1 y M2) — 2026-10-26

Verificado por un agente de planificación contra `alegp/stoic-davinci-185dm4` en `a4551321` (solo lectura). **Donde este apartado contradice a los anteriores, manda este.** Todo cambio de esquema REQUIERE AUTORIZACIÓN EXPRESA para aplicarse a una base real (respaldo en rama de Neon, ensayo subir/bajar/subir, `lock_timeout` de 5 s, fuera de horario, base por base); en la base local de pruebas y en las efímeras de la CI se aplica con `npx prisma migrate deploy`. Nunca contra Neon desde un agente.

### J.1 Correcciones al diseño (lo que el código no confirma)
1. **Los goldens SÍ cambian (aditivamente).** `test/pos/caracterizacion/huella-del-pos.test.ts` vuelca `Mesa` y `Cuenta` con todas sus columnas (207 líneas `MESA`, 174 `CUENTA`) y `test/movimientos/caracterizacion/venta-matriz-ampliada.test.ts` (línea 152, 21 líneas `CUENTA`). Cada columna nueva suma `tipo=SALON` / `tipoMesa=SALON` y en M2 `claveApertura=null etiqueta=null`. Se regeneran con declaración en `test/arquitectura/caracterizaciones-congeladas.test.ts` (blob nuevo con `git hash-object`, commit padre, motivo «ADITIVO, no cambia comportamiento», verificado con `git diff --word-diff`); nunca a ciegas. Los demás goldens (`lecturas-tramo-a`, `reportes-c0`, `venta-matriz`, `venta-con-opciones`, `matriz-de-acceso`, `huella-de-gobierno`…) NO deben cambiar: si alguno cambia, se tocó una regla que no se pidió y se frena.
2. **`Cuenta.tipoMesa` y su FK con discriminador pasan a M1.** Si quedaran en M2, aplicar M2 con código M1 en marcha haría que toda apertura del mostrador escribiera `SALON` y la FK la rechazara (23503). En M1 no hay ventana: no existe ningún puesto MOSTRADOR al migrar y el default `SALON` es correcto para todas las filas.
3. **El índice `Mesa_un_mostrador_por_sucursal_key` sobra:** `Mesa_sucursalId_numero_key` + el CHECK `(tipo='MOSTRADOR') = (numero=0)` ya garantizan un mostrador por sucursal (un test lo demuestra).
4. **No usar `CREATE INDEX CONCURRENTLY`:** Prisma corre cada `migration.sql` en una transacción (precedente: `docs/deploy-con-migraciones.md` ~l.306 y 330, ADR-029). Va bloqueo corto con `SET lock_timeout='5s'`, fuera de horario y con guarda de volumen (si `Cuenta` pasa de 500.000 filas, no se aplica y se replantea con un archivo de una sola sentencia). M2 son 2 carpetas de migración; el índice nuevo y el retiro del viejo van en la misma transacción (nunca un instante sin árbitro).
5. **El candado consultivo (`pg_advisory_xact_lock`) no sirve** en SERIALIZABLE (la foto se toma antes de esperar el candado: aborta igual con 40001). La palanca real es medir y, si hace falta, subir `maxIntentos` solo en `cerrarCuenta`.
6. **Abrir la cuenta del mostrador es una acción propia desde M1:** `abrirCuentaDeMostrador()` (no se cambia la firma congelada de `abrirCuenta(mesaId, comensales)`; con el id del mostrador `abrirCuenta` responde `MESA_NO_ENCONTRADA`).
7. **Clave de apertura sola, sin huella** (PROPUESTA): la etiqueta es editable con la cuenta abierta, una huella del contenido quedaría vieja. La clave identifica el clic; el reintento devuelve la misma cuenta (`repetida: true`).
8. **La entrada de Movimientos no puede ser un segundo ítem de menú con el mismo destino** (`test/navegacion/item-activo.test.ts` ~l.60 prohíbe `href` repetidos): el acceso a Salón › Mostrador desde Movimientos es un enlace en la página de entrada de Movimientos (la arma el paso P5a de la Fase 7), no un ítem de menú.
9. Menores: `TICKETS_RECIENTES_POR_MESA = 3` (con varios cierres seguidos el ticket recién cerrado puede salir de la lista de impresión: en M2 la pantalla de cada cuenta carga el ticket de ESA cuenta); el comentario de `Sucursal.maxMesasAbiertas` dice `pos_mesas` pero la clave real es `pos_limite_mesas_abiertas`; `habilitarMostrador` sigue el molde de `crearMesa` (sin transacción, idempotente por estado).

### J.2 Esquema
**M1 (una carpeta `…_m1_puesto_mostrador`):** guarda `DO` que aborta si existe alguna `Mesa` con `numero <= 0`; `Mesa.tipo TEXT NOT NULL DEFAULT 'SALON'` con `Mesa_tipo_chk` (`SALON`,`MOSTRADOR`) y `Mesa_numero_segun_tipo_chk`; único `Mesa_empresaId_id_tipo_key (empresaId, id, tipo)` (destino de la FK); `Cuenta.tipoMesa TEXT NOT NULL DEFAULT 'SALON'` con CHECK; se quita `Cuenta_empresaId_mesaId_fkey` y se agrega `Cuenta_empresaId_mesaId_tipoMesa_fkey (empresaId, mesaId, tipoMesa) → Mesa(empresaId, id, tipo) ON DELETE RESTRICT ON UPDATE RESTRICT` (la base impide una cuenta con un tipo distinto del de su puesto y cambiar el tipo de un puesto con cuentas); `Cuenta_comensales_segun_tipo_chk (tipoMesa='SALON' OR comensales IS NULL)`. Sin cambios de RLS, GRANT ni clasificación (`Mesa` PROPIA, `Cuenta` HEREDADA); sin UPDATE de filas. `down.sql`: aborta si existe alguna `Mesa` o `Cuenta` MOSTRADOR; si no, quita CHECK y FK nueva, recrea `Cuenta_empresaId_mesaId_fkey` original (`ON DELETE RESTRICT ON UPDATE CASCADE`, migración `20260929100000` ~l.540), quita columnas, CHECK e índice. En `schema.prisma`: `Mesa.tipo`, `@@unique([empresaId, id, tipo])`, `Cuenta.tipoMesa`, relación `mesa` con los tres campos (precedente `ImputacionDeGasto.naturalezaRenglon`), y se corrige el comentario de `maxMesasAbiertas`.
**M2a `…_m2_cuentas_de_mostrador`:** `Cuenta.claveApertura TEXT NULL` con único global `Cuenta_claveApertura_key` y CHECK `claveApertura IS NULL OR tipoMesa='MOSTRADOR'`; `Cuenta.etiqueta TEXT NULL` con CHECK (`etiqueta IS NULL OR (tipoMesa='MOSTRADOR' AND etiqueta = btrim(etiqueta) AND char_length(etiqueta) BETWEEN 1 AND 40)`); `down.sql` aborta si alguna cuenta tiene `claveApertura` o `etiqueta`.
**M2b `…_m2_una_abierta_por_mesa_de_salon`:** `CREATE UNIQUE INDEX "Cuenta_una_abierta_por_mesa_de_salon_key" ON "Cuenta"("mesaId") WHERE "cerradaEn" IS NULL AND "tipoMesa"='SALON'` y después `DROP INDEX "Cuenta_una_abierta_por_mesa_key"`, en la misma transacción; `down.sql` aborta si algún mostrador tiene 2 o más cuentas abiertas; bajar dos veces no falla.

### J.3 Código
- Núcleo puro `src/core/pos/puesto.ts` (exportado por `public.ts`): `TIPOS_DE_PUESTO`, `NUMERO_DEL_MOSTRADOR = 0`, `esMostrador(numero)`, `rotuloDePuesto` («Mesa 07»/«Mostrador»), `detalleDePuesto` («Mesa 7»/«Mostrador») y las frases de mensajes («de la mesa 7»/«del mostrador», etc.). El mostrador se reconoce por `numero === 0` (respaldado por el CHECK): no cambia la forma de las lecturas congeladas. Para las mesas, cada texto queda byte a byte igual al de hoy.
- Se adaptan solo en el texto los casos de uso de mesa/cuenta/ticket (`abrir-cuenta`, `agregar-items`, `enviar-a-cocina`, `quitar-*`, `asignar-cliente-a-cuenta`, `liberar-mesa`, `cerrar-cuenta`, `anular-*`, `emitir-ticket-corregido`, `corregir-comensales`, `cargar-cuenta-abierta`) y `reportes/tickets/page.tsx`.
- Cambios de regla: `abrir-cuenta.ts` busca la mesa con `tipo: "SALON"` y el conteo del límite suma `tipoMesa: "SALON"`; `corregir-comensales.ts` sobre el mostrador responde «El mostrador no lleva comensales»; `rotacion-mesas.ts`, `consultas/pos/mesas.ts` (`obtenerMapaDeMesas`) y `detalle-de-mesa.ts` filtran `SALON`. Sin cambios de regla en `cerrarCuenta`, el ticket ni `registrarVentaEnTx` (el mostrador hereda las 4 reglas de la mesa).
- Comandos nuevos, sin claves de permiso nuevas: `habilitarMostrador()` (`pos_alta_mesa`; inserta el puesto `numero 0`, idempotente por estado: si choca con el único responde éxito «ya estaba habilitado»); `abrirCuentaDeMostrador()` (`pos_abrir_cuenta`; en M1 SERIALIZABLE, por estado: devuelve la cuenta abierta si ya existe, no mira el límite; `MOSTRADOR_NO_HABILITADO`, `SUCURSAL_INACTIVA`); en M2 con `claveApertura` obligatoria (`esClaveIdempotenciaValida`), `etiqueta` opcional, `tambienChoqueDeUnico = true`, `repetida: true` en el reintento; `corregirEtiqueta(cuentaId, etiqueta)` (M2).
- Lecturas nuevas en `server/consultas/pos/`: `obtenerPuestoMostrador`, `obtenerCuentasAbiertasDelMostrador` y `obtenerDetalleDeCuentaDeMostrador` (M2).
- Pantallas: se extrae el cuerpo de `src/app/(pos)/mesas/[mesaId]/page.tsx` a `pantalla-del-puesto.tsx` (`variante: "mesa" | "mostrador"`, sin cambio visible para la mesa). Variante mostrador: título «Mostrador», sin comensales, «Nueva cuenta», cierre «la cuenta queda cerrada», «Descartar cuenta (sin consumo)». Ruta `/mesas/mostrador` (estática, `requierePermisoVer(…, "pos_mesas")` y `lecturaSinCupo`; sin puesto: «Habilitá el mostrador» con botón solo con `pos_alta_mesa`); en M2 es la lista de cuentas abiertas y cada una abre `/mesas/mostrador/[cuentaId]`; `/mesas/<id del mostrador>` redirige. Tarjeta «Mostrador» aparte en el mapa; ítem «Mostrador» en el grupo `pos` de `estructura.ts` después de «Mapa de mesas» (`{ href: "/mesas/mostrador", label: "Mostrador", accion: "pos_mesas", panel: "sucursal" }`); ruta en `test/e2e/rutas-sin-parametros.ts`.
- **El puesto se crea de forma perezosa y explícita** (botón del administrador, idempotente). Descartados: backfill en la migración (escribe datos de producción), alta automática al crear la sucursal (dos caminos de alta; obligaría a darle INSERT sobre `Mesa` a `motor2_plataforma`) y creación implícita al abrir la primera cuenta (mezcla permisos).

### J.4 Concurrencia, idempotencia, aislamiento, permisos
Ticket `max + 1` dentro del cierre SERIALIZABLE con el único `(sucursalId, numero, ejemplar)`; salón y mostrador comparten secuencia; reintentos de `conTransaccionSerializable` (8, con jitter). Con N cierres simultáneos el último puede necesitar N−1 reintentos: en M2.4 se mide N = 10 y 20 y, si se agota, se sube `maxIntentos` solo en `cerrarCuenta` con motivo declarado. Aislamiento por la RLS heredada de `Mesa` (sin políticas nuevas); `sucursalId` siempre de `ctx`. Permisos con `conPermiso` y claves existentes (módulo `salon` apagado rechaza antes que el rol); hay que declarar las acciones nuevas en `test/arquitectura/pos-envoltorio-y-clave.test.ts`, `test/pos/pos-rechaza-sin-permiso.test.ts`, `test/pos/modulos-apagados-en-el-pos.test.ts` y sumar el puesto al mundo de denegación (`test/aislamiento/denegacion/mundo.ts` y `generadores.ts`).

### J.5 Reportes
Lo toman solos: Período, margen, ventas por categoría, costo de lo vendido, pérdidas, Descuentos por cliente y de productos, Margen de promociones, Trazabilidad (detalle «Mostrador») y «más pedidas» del POS. A ajustar: rotación de mesas (excluye por `tipoMesa`), límite de mesas abiertas (conteo y métricas del mapa), Tickets emitidos (rótulo «Mostrador» en la fila y el filtro). Apagar la sucursal sigue contando el mostrador.

### J.6 Coordinación con la Fase 7 (rama `alegp/carril-m`)
El rótulo «Carga de ventas sin ticket», la salida de «venta» de los directos y el enlace a Salón › Mostrador (dentro de la página de entrada de Movimientos, no ítem de menú) los hace el paso P5a de la Fase 7; depende de que exista la ruta `/mesas/mostrador` (M1.4b). Esta etapa NO toca `src/core/movimientos/ui-config.ts` ni `/movimientos/venta`. Orden: P1–P3 de carril-m (cambian el tipo `ItemNav`) antes; esta rama parte de ese commit. Se anota que DEC-25 queda modificada por palabra del dueño.

### J.7 Pasos (un commit cada uno; cada uno verde en las compuertas)
- **0.2 Documentos:** ADR nuevo «El mostrador es un puesto del salón» con las correcciones J.1 (número: el siguiente libre; 036 reservado; verificar contra `adr-al-dia` y `alegp/docs-adr-037`); actualizar el hermano (B.5 y Nivel 1); sección de M1 y M2 en `docs/deploy-con-migraciones.md` marcada «pendiente de autorización».
- **M1.1** `core/pos/puesto.ts` y el reemplazo de textos (mesas byte a byte iguales: `huella-del-pos` sin regenerar; guardián **G1**: ningún `Mesa ${`/`mesa ${` en `actions/pos/**`, `persistencia/pos/**` ni `(pos)/**` fuera de `puesto.ts`).
- **M1.2** migración M1 + `schema.prisma` + `down.sql` + tests (`test/persistencia/migracion-puesto-mostrador.test.ts`: CHECK, paridad `TIPOS_DE_PUESTO` ↔ CHECK, 2.º mostrador 23505, cuenta SALON sobre puesto MOSTRADOR 23503, cambiar `Mesa.tipo` con cuentas 23503, comensales en mostrador 23514; `test/aislamiento/m1-mostrador-subir-bajar-subir.test.ts` con foto del catálogo idéntica, la reversa aborta con datos y bajar dos veces no falla); declarar la FK en `FK_CON_DISCRIMINADOR` (`test/persistencia/multiempresa-estructura.test.ts`); regenerar y declarar `huella-del-pos` y `venta-matriz-ampliada`.
- **M1.3** exclusiones (abrir-cuenta, rotación, mapa, detalle, rechazo de comensales en el mostrador) + guardián **G2** (el conteo de `abrir-cuenta.ts`, la consulta de `rotacion-mesas.ts` y la de `obtenerMapaDeMesas` llevan el filtro `SALON`); `lecturas-tramo-a` y `reportes-c0` sin regenerar.
- **M1.4a** extraer `PantallaDelPuesto` sin cambio visible. **M1.4b** `habilitarMostrador`, `obtenerPuestoMostrador`, página `/mesas/mostrador` (sin habilitar/habilitado), tarjeta en el mapa, ítem de menú, ruta en `rutas-sin-parametros`, declaraciones de acciones y mundo de denegación; tests: dos «Habilitar» a la vez (`Promise.all`: una crea, la otra «ya estaba», una sola fila) y aislamiento como `motor2_app` con dos empresas y dos sucursales (`test/aislamiento/mostrador-rls.test.ts`). **M1.4c** `abrirCuentaDeMostrador` (M1), variante mostrador de la pantalla y la redirección; tests: doble clic (dos llamadas a la vez dan una cuenta y el mismo id), dos cajeros comparten la cuenta en M1, reintento del cierre devuelve `YA_CERRADA`, cierre de una cuenta de mostrador y una de mesa a la vez dan tickets 1 y 2 sin huecos, cerrar contra agregar, detalle «Mostrador» y aparece en Tickets emitidos.
- **M1.5** e2e `test/e2e/pos-mostrador.spec.ts` (habilitar, abrir, cargar con opciones y promo, asignar cliente con %, enviar, cerrar, ticket numerado comparando contra la base, descartar una cuenta vacía, el límite de mesas no afectado; limpieza en `finally` con el orden de `pos-tomar-pedido.spec.ts`, incluido el puesto). **M1.6** (después de P5a) e2e conjunto con el aviso y el enlace desde Movimientos. **M1.7** verificación total.
- **M2.1** migraciones M2a y M2b (+ reescribir `test/pos/cuenta-una-abierta-por-mesa.test.ts` con el nombre del índice nuevo; goldens regenerados y declarados; el código M1 sigue verde). **M2.2** `abrirCuentaDeMostrador` con clave y etiqueta (tests: misma clave a la vez, carrera forzada con barrera como el molde (f) de `cuenta-concurrencia.test.ts`, claves distintas, clave de otra sucursal, etiqueta inválida; guardián **G3**: el único que escribe una `Cuenta` MOSTRADOR es `escribirCuentaDeMostrador` y su llamador va dentro de `conTransaccionSerializable` con `tambienChoqueDeUnico = true`). **M2.3** `corregirEtiqueta`, lecturas y pantallas de lista y de cuenta, ticket de la cuenta. **M2.4** concurrencia real (`test/pos/mostrador-concurrencia.test.ts`: dos cajeros, 5 cierres simultáneos con tickets exactamente 1 a 5, mezcla salón y mostrador, cerrar contra agregar; medición N=10 y 20 en `scripts/medicion-cierres-concurrentes.ts`; correr 20 veces seguidas). **M2.5** e2e `pos-mostrador-varias-cuentas.spec.ts`. **M2.6** verificación total.
- Demostración mutar→rojo→revertir→verde (se anota en el commit): G1 (volver a poner `` `Mesa ${mesa}` `` en `cerrar-cuenta.ts`), G2 (sacar `tipoMesa: "SALON"` del conteo), G3 (`tambienChoqueDeUnico` en `false`), `FK_CON_DISCRIMINADOR` (quitar la entrada), envoltorio y clave (cambiar `pos_alta_mesa` por `pos_tomar_pedido`), CHECK en la base (comentar la línea en una copia local de `migration.sql`), guardián de goldens (regenerar sin declarar).

### J.8 Verificación total y criterio de éxito
Los 8 comandos (`npx tsc --noEmit` [con `NODE_OPTIONS=--max-old-space-size=6144` si falta memoria], `npm run lint`, `npm run arquitectura`, `npm run analizar:muerto`, `npm test`, `npm run build`, `npm run plataforma:build`, `npm run test:e2e`) en la misma corrida, sobre el commit final de cada etapa. Línea de base en `a4551321`: 107 modelos, 131 claves en `ACCIONES`, 144 carpetas de migración, 1121 archivos de Vitest, 154 specs de e2e + 1 de e2e-demo. M1: 145 migraciones (+1), 155 specs (+1); M2: 147 migraciones (+2), 156 specs (+1). Goldens cambian SOLO en los blobs declarados. Ninguna prueba que pasaba queda salteada o borrada. Specs e2e que ejercitan lo tocado: nuevos `pos-mostrador` y `pos-mostrador-varias-cuentas`; `pos-tomar-pedido`, `pos-mapa-de-mesas`, `pos-comensales-limite-mesas`, `pos-dialogos`, `pos-agregar-varios`, `pos-opciones`, `pos-mesa-opciones`, `pos-promo-combo`, `pos-menu-del-dia`, `pos-carta-secciones`, `pos-descuento-con-carta-apagada`, `pos-venta-fraccionada`, `movil-pos-mesa`, `salon-volver-a-gestion`, `cambiar-sucursal-vuelve`, `reportes-tickets`, `periodo-y-tickets-mismo-dia`, `venta-anular-trazabilidad`, `movimientos-venta-fraccionada`, `formularios-hoy-en-hora-argentina`, `catalogo-disponibilidad-por-sucursal`, `menu-item-activo`, `menu-paneles`, `movil-menu`, `inicio`, `navegacion-en-curso`, `maquetacion-general` (suma `/mesas/mostrador`) y las secciones de POS de `accesibilidad`. Al cerrar cada etapa, auditoría independiente (toca dinero, stock y numeración).

### J.9 Preguntas menores y supuestos (2026-10-26)
- **P1. ¿El administrador habilita el mostrador con un botón por sucursal, o aparece solo?** SUPUESTO del ingeniero (recomendado, a confirmar por el dueño): botón, como dar de alta una mesa.
- **P2. El rol de fábrica «operador» vende hoy por «Venta» pero no tiene las claves `pos_*`.** SUPUESTO: no cambiar la semilla (regeneraría la matriz congelada); armar un rol «cajero» desde la matriz.
- **P3. ¿La etiqueta de la cuenta se imprime en el ticket y la comanda?** SUPUESTO: sí, como dato para llamar al cliente, sin valor fiscal.
Lo demás es técnico y lo decide el ingeniero (tope de reintentos, clave sin huella, etiqueta editable, auditoría al habilitar).
