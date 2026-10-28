# Diseño: factura de proveedor de mercadería repartida entre sucursales por PROPUESTA y ACEPTACIÓN (etapa E3a), 2026-10-27

Estado: **APROBADO por el dueño (2026-10-28) y EN IMPLEMENTACIÓN (Fase 2); ver §14 «Estado de implementación».** La forma de la migración E3a-M cambió el 2026-10-28 (aprobado por el coordinador): solo tablas NUEVAS, ver §7 y §11 paso 3; donde este documento todavía diga lo contrario, valen §7, §11 y §14. Los niveles 1 a 5 se apoyan en decisiones CONFIRMADAS del dueño (2026-10-05, 06 y 27). Cada decisión lleva su estado: CONFIRMADA (la dijo el dueño), PROPUESTA (mía, a validar), PENDIENTE (pregunta al dueño, §10) o NO VERIFICADA (falta comprobarla en el código). Insumos: `docs/diseno-circuito-de-abastecimiento-2026-10-27.md` (§1, §1.bis, E3a, E3b, §6), `docs/diseno-atribucion-de-costos-sucursal-y-unidad-2026-10-27.md`, ADR-029, ADR-040, `docs/auditoria-circuito-de-abastecimiento-2026-10-27.md`, `docs/pendientes-sesion-2026-10-27.md` y `motor2-docs/_planes/` (plan unificado v1.0, decisiones del 05, 06 y 08). Todo lo que se afirma sobre el código se comprobó en esta rama (`alegp/carril-y`, sobre E1 y E2) y con consultas de solo lectura a la base local.

## 0. Resumen para el dueño (una página)

**Qué se construye.** Desde la Compra, el operario de la sucursal que compra carga UNA factura de proveedor con sus renglones (los mismos productos y la misma «referencia del proveedor» que hoy) y, si quiere, la reparte entre sucursales tipeando el **importe** de cada una (que tiene que sumar el total) o el **porcentaje**. Su parte entra al stock en el acto. La parte de cada otra sucursal nace **pendiente** y aparece en la bandeja «Para aceptar» de esa sucursal; recién cuando el operario de esa sucursal la acepta (eligiendo sección y fecha de stock) entran su stock, su costo y su gasto. Si algo está mal, el administrador anula la factura entera (bloqueado si algo ya se usó) y se vuelve a cargar.

**Lo que contradice al pedido «sin migración en E3a» (dicho directo).** Con las tablas que ya están en la base, la propuesta + aceptación con importes exactos **no se puede hacer**. Dos bloqueos verificados (detalle en §1):
1. **La parte pendiente no tiene dónde guardar QUÉ le toca** (qué productos, cuántos y cuántos pesos). `FacturaProveedorSucursal` solo guarda el porcentaje en puntos básicos (`porcentajeDeclaradoBp`), y con 2.000.000 + 1.000.000 sobre 3.000.000 los puntos básicos (6667/3333) darían 2.000.100 y 999.900: rompe la decisión 4 («esos importes son los pesos»). Recalcularlo al aceptar tampoco sirve: la sucursal que acepta no puede leer las partes de las otras (RLS por sucursal) y el reparto de cada renglón depende de todas.
2. **Al aceptar no se puede anotar en la parte cuál es su compra** (`operacionId`): la base le da a la aplicación UPDATE solo de `estadoRecepcion`, `recibidaEn` y `recibidaPorId` (migración `20261016101500`, comprobado en la base local: `information_schema.column_privileges`).
Y un tercero que no bloquea pero obliga a abrir una excepción de seguridad: la parte de la 4 es una fila «de la sucursal 4» y el operario de la 3 no puede insertarla sin ensanchar su alcance (`conEscrituraEnLaEmpresa` abre la escritura en TODAS las sucursales para toda la transacción, Kardex incluido).

**Recomendación (APROBADA el 2026-10-28, forma final en §7 y §11 paso 3: tres tablas NUEVAS —la propuesta de parte, sus renglones y la anulación de la factura— sin tocar ninguna tabla, política ni migración ya aplicada; el texto que sigue es la forma original, reemplazada):** una **migración chica, aditiva y reversible, «E3a-M»** (REQUIERE AUTORIZACIÓN EXPRESA para aplicarla en cada base real; se escribe y se ensaya solo en local): (a) una tabla nueva «la parte de cada renglón» (cantidad y pesos de cada sucursal en cada renglón, solo se agrega); (b) en la parte, la sucursal que la propuso, con la misma regla de visibilidad que ya tienen los traspasos («origen o destino»), así nadie ensancha su alcance; (c) permiso para anotar `operacionId` una sola vez, al aceptar; (d) en la cabecera, motivo y clave de reintento de la anulación. Las cuatro tablas involucradas tienen **0 filas** en la base real (ningún código las escribe todavía), así que el riesgo de aplicarla es mínimo.

**Mientras tanto (lo más barato, sin código):** con E2 terminada, la 3 puede comprar todo con la compra simple y traspasar a la 4 y la 6: el costo ya viaja con el traspaso. Pero el **gasto queda entero en la 3**, que contradice la decisión 3 («el gasto se distribuye»): sirve solo como puente.

**Siete preguntas pendientes** (§10), una por tema, solo las que cambian modelo, dinero o permisos. La principal: autorizar E3a-M.

## 1. Inventario verificado (código real, base local y `motor2-docs`)

| # | Pieza | Qué hay (evidencia) | Consecuencia para E3a |
|---|---|---|---|
| I1 | Cabecera `FacturaProveedor` | DE_EMPRESA, `estado` `PENDIENTE_DE_REPARTO`/`CONFIRMADA`, `importeTotal`, `fecha` (mediodía AR), clave de reintento única GLOBAL + huella + `resultadoMensaje`, anulación `anuladaEn`/`anuladaPorId` **sin motivo** (`prisma/schema.prisma:2724-2784`). UPDATE por columna: estado, anulación, `resultadoMensaje` y datos de identificación (`20261016101000_factura_proveedor/migration.sql:210-215`) | Se usa tal cual. Falta dónde guardar el motivo y la clave de la anulación (E3a-M) |
| I2 | Renglón `FacturaProveedorRenglon` | DE_EMPRESA, `orden`, producto, `cantidadStock` (4 dec.), `precioPorUnidadStock` (4 dec., «calculado UNA vez»), lote, `detalle`, `precioTotal` con IVA; solo INSERT (`schema.prisma:2789-2838`) | Se usa tal cual (naturaleza `MERCADERIA`) |
| I3 | Parte `FacturaProveedorSucursal` | `PROPIA` (4 políticas por `sucursalId`, `20261016102000`), `porcentajeDeclaradoBp` 1..10000, `operacionId` único y opcional, recepción `PENDIENTE`→`RECIBIDA` con disparador; **UPDATE solo de las 3 columnas de recepción** (`20261016101500`, verificado en la base local) | **Bloqueos 1 y 2** del §0 y escritura en sucursal ajena |
| I4 | Kardex | `MovimientoStock.facturaProveedorRenglonId` con CHECK «solo COMPRA» (`20261016101000`, línea ~170); `Operacion` sin columnas de factura (el vínculo va al revés) | La línea del Kardex de cada parte apunta a su renglón |
| I5 | Unicidad del número | `FacturaProveedor_unica_vigente_key` (empresa + proveedor + letra + número normalizado, vigentes; existe en la base local) y `Operacion_factura_unica_vigente_key` (sucursal + proveedor + número, compras vigentes) | Una factura choca con otra factura de la empresa, y su compra choca con una compra simple de la misma sucursal con el mismo número |
| I6 | Compra simple | `registrarMovimientoCasoDeUso` (`src/server/actions/movimientos/casos-de-uso/registrar-movimiento.ts`) ya es **de varias líneas**, con proveedor, N.º de factura, aviso C25 de posible duplicado (no bloquea), clave obligatoria (E1) y vínculo proveedor↔producto con `referenciaProveedor` en la misma transacción (`:243-260`). La pantalla (`src/app/(app)/movimientos/[proceso]/panel-movimiento-form.tsx`) precarga lo que ya se le compró al proveedor con «Código/nombre del proveedor» (`:177-234`, `:467-473`) | **Se reutiliza la pantalla** (decisión 10 cumplida sin trabajo nuevo) y `armarLineaMovimiento` para validar y convertir cada renglón |
| I7 | Permisos | `compra_repartir`: empresa, piso `administrador`, semilla solo `admin` (`src/core/permisos/acciones.ts:241`); `compra_recibir`: sucursal, piso `operario`, semilla solo `admin` (`:245`); las dos «reservadas» en `test/arquitectura/toda-accion-se-usa.test.ts:39-40`. `proceso_compra`: sucursal, piso `operario`, semilla `admin` y `operador` (`:108`). `anular_compra` y `corregir_compra`: sucursal, piso `administrador` (`:132`, `:134`). El piso vive SOLO en el código (`Accion` en la base tiene clave y descripción: `schema.prisma:227`); la semilla de roles de una empresa existente es un dato (`PermisoRol`) | Bajar el piso de `compra_repartir` es código; **dársela al rol `operador` de las empresas existentes es configuración de la matriz o una migración de datos** (§10 P3). Una clave NUEVA exige migración de datos (la paridad catálogo↔base lo exige): se evita reutilizando las existentes |
| I8 | Nombres de piso | En el código el piso se llama `operario` (`NivelDeAccion`, `acciones.ts:30`); `operador` es el rol de fábrica | «Piso operador» del dueño = `nivelMinimo: "operario"` |
| I9 | Campos sensibles | `MovimientoStock.precioTotal`, `FacturaProveedor.importeTotal`, `FacturaProveedorRenglon.precioTotal` y `.precioPorUnidadStock`: piso `administrador` (`test/arquitectura/guardas/campos-sensibles.ts:22-34`) | Hoy el operario no ve importes de compras en ninguna lectura: la bandeja del destino, si muestra importes, cambia esa regla (§10 P4) |
| I10 | Ensanches de alcance | Catálogo cerrado de 5 funciones (`src/server/acceso/alcance.ts`, `test/arquitectura/ensanches-de-alcance.test.ts`); `conEscrituraEnLaEmpresa` abre lectura y escritura en TODAS las sucursales; `permisoYAlcanceEnSucursal` (`GATE_EN_ESA_SUCURSAL`) ensancha UNA sucursal después de su gate; la RLS `ENTRE_SUCURSALES` («origen o destino») ya la soporta el generador (`test/setup/politicas-de-alcance-de-sucursal.ts`, `TraspasoSucursal` en `test/setup/clasificacion-de-tablas.ts:156`) | Con E3a-M la parte pasa a `ENTRE_SUCURSALES` y **no hace falta ningún ensanche nuevo** (§7) |
| I11 | Anular y corregir una compra | `anularCompraCasoDeUso` y `corregirCompra` trabajan sobre UNA `Operacion` de la sucursal activa y no saben de facturas | **Hueco a cerrar en E3a:** anular o corregir la compra de UNA parte dejaría la factura incoherente; tienen que rechazarlo (paso 6 del plan; ADR-029 §9 ya lo anticipaba) |
| I12 | Costo y gasto | El costo de reposición (V-T1, E2) es la entrada valorizada más reciente por `Operacion.fecha` (`src/server/lecturas/reportes/comun.ts:166-178`); los lectores de gasto filtran COMPRA por `Operacion.fecha` y sucursal | La parte aceptada cuenta en el costo y el gasto de la destino en la **fecha de stock** que elija (§10 P5) |
| I13 | Dueño único y fronteras | Cerco `cerco-dueno-unico-por-modelo` (trinquete: `Operacion` la escriben movimientos 4, compras 1, traspasos 1; `MovimientoStock` movimientos 2, traspasos 1) y regla R2 de dependency-cruiser; anular/corregir compra ya son casos de uso de `actions/movimientos` con persistencia en `persistencia/compras` (deuda declarada, `MOTIVO_COMPRAS`, `.dependency-cruiser-excepciones.cjs:401-420`) | Las tablas de la factura las escribe solo `persistencia/compras`; `Operacion` y Kardex, con las funciones existentes de `persistencia/movimientos` (no suben el trinquete) |
| I14 | Base local | `FacturaProveedor`, `...Sucursal`, `...Renglon` y `MovimientoStock` con renglón: **0 filas**; los dos índices únicos existen | La migración E3a-M cae sobre tablas vacías |
| I15 | `motor2-docs` | D-STOCK = «directo» (S1), D-BASE = «un solo porcentaje» con la opción de fijar cantidades en un renglón indivisible (PB1), D-PERM = `compra_repartir` + `proceso_compra` en cada destino (piso cambiado el 2026-10-27), D-CAMBIO = anular entera y recargar, D-ANUL = atómica, bloqueada si algo se consumió (`_decisiones-del-dueno-2026-10-06.md:21-49`) | Se respetan; «directo» pasa a ser «al aceptar» por la decisión del 2026-10-27 |

**Contradicciones con documentos (se corrigen en el paso de documentación):**
- `diseno-circuito-de-abastecimiento` E3a dice «todas las partes `RECIBIDA`» y en el mismo párrafo «el operario de la 3 solo crea partes `PENDIENTE` en la 4 y la 6»: vale lo segundo (decisión 2 del 2026-10-27). Dice también «sin migración»: no alcanza (§0).
- ADR-029 §5 asocia «carga una persona y reparte otra» a `PENDIENTE_DE_REPARTO`. Con propuesta + aceptación el reparto se declara al cargar (cabecera `CONFIRMADA`) y lo pendiente es la RECEPCIÓN de cada parte (ADR-029 §5b). `PENDIENTE_DE_REPARTO` queda sin uso en E3a, como punto de extensión.
- ADR-029 §6 pide `proceso_compra` en cada destino «para quien reparte»: con aceptación, quien entra el stock en la destino es el operario de la destino, con su propio permiso allí; quien propone no necesita (ni tiene) membresía en la destino.

## 2. Escalera de diseño (10 niveles)

### Nivel 1. Propósito y alcance
- CONFIRMADA: cargar UNA vez una factura de mercadería y saber exactamente cuánto le costó a cada sucursal (decisión 4; §1.bis del circuito).
- CONFIRMADA: compra mixta: cada sucursal compra lo suyo, o una compra y reparte (decisión 1).
- CONFIRMADA: el gasto se distribuye; un traspaso posterior mueve stock y costo, no el gasto (decisión 3).
- Fuera de alcance (CONFIRMADA): gastos sin stock (E4), pago (E5; aquí solo el punto de extensión), centros de costos (E8), sábanas y toallas (activos, etapa BU), notas de crédito (E7).
- PROPUESTA: fuera de alcance en E3a también el desglose de IVA y los tributos (la perilla `llevaIvaDeCompras` está apagada en toda empresa: todo con IVA incluido, D-IVA); `importeTotal` = Σ renglones. La letra y la fecha impresa del comprobante: opcionales, «pendiente de completar».

### Nivel 2. Actores y contexto
- **Operario de la sucursal que compra** (alcance: solo la suya, ADR-028): carga la factura y, si tiene `compra_repartir`, propone el reparto. Escribe su parte (entra al stock) y crea las partes pendientes de las otras. CONFIRMADA.
- **Operario de cada sucursal destino** (alcance: solo la suya): ve en «Para aceptar» lo que le mandaron y acepta SU parte con su sección y su fecha de stock. CONFIRMADA (el qué ve: §10 P4).
- **Administrador**: anula la factura entera (con motivo) y ve el listado con importes. CONFIRMADA («correcciones de administrador»).
- **Gerente/dueño**: configura quién tiene cada clave (matriz) y lee los reportes. CONFIRMADA.
- Contexto: Argentina (UTC-3, sin horario de verano): todo día se interpreta en `ZONA_ARGENTINA` y se guarda como el mediodía argentino en UTC (igual que la compra). Varias empresas en la misma base (RLS por empresa) y varias sucursales por empresa (RLS por sucursal).

### Nivel 3. Casos de uso (comandos y lecturas)
1. **Cargar factura** (`registrarFacturaProveedor`): modo «una sola sucursal» (una parte del 100 % en la sucursal activa) y modo «reparto» (N partes; la propia, si tiene, nace RECIBIDA; las otras, PENDIENTE).
2. **Aceptar mi parte** (`aceptarParteDeFactura`): desde la sucursal destino.
3. **Anular factura** (`anularFacturaProveedor`): entera y atómica, con motivo.
4. **Ver «Para aceptar»** (bandeja de la sucursal activa) y «Lo que cargué» (estado de las partes que esta sucursal propuso).
5. **Ver «Facturas de proveedor»** (listado con importes, administrador).
- No hay «rechazar mi parte» en E3a (CONFIRMADA: «después, con migración»): la salida es anular y recargar.
- No hay «corregir el reparto» en E3a: es anular y recargar (D-CAMBIO, CONFIRMADA).

### Nivel 4. Conceptos y ciclo de vida
**Modelo de estados (forma final, 2026-10-28):**

| Pieza | Estados | Quién lo cambia y cómo |
|---|---|---|
| **Factura** (cabecera `FacturaProveedor`) | `CONFIRMADA` desde la carga → **anulada** (`anuladaEn`/`anuladaPorId` + una fila en la tabla nueva de anulación con motivo, clave y huella). Nada se borra | La carga la crea `CONFIRMADA`; el administrador la anula. PROPUESTA (ver abajo por qué no `PENDIENTE_DE_REPARTO`) |
| **Propuesta de parte** (tabla nueva, una por sucursal destino) | `PENDIENTE` → `ACEPTADA` (una sola vez). Con la factura anulada, su estado efectivo es **«anulada»**: queda guardada `PENDIENTE` y la marca la anulación de su factura (no se puede aceptar ni aparece en la bandeja). `RECHAZADA` con motivo: después (CHECK ampliable) | La crea la sucursal que carga; la acepta la destino |
| **Parte** (`FacturaProveedorSucursal`, existente) | Se crea SIEMPRE `RECIBIDA`, con su `operacionId` en el mismo INSERT: la de la sucursal que carga, al cargar; la de cada destino, AL ACEPTAR (la inserta la destino, dentro de su propio alcance) | Nadie la modifica en E3a (el `PENDIENTE` de la tabla queda para la recepción separada de E6) |
| **Renglones de la propuesta** (tabla nueva) | inmutables: cantidad y pesos de cada renglón para esa destino | Los escribe la carga; la aceptación los copia al Kardex tal cual |
| **Compra de la parte** (`Operacion` COMPRA + Kardex) | vigente → anulada (reversión existente) | Se crea al cargar (parte propia) o al aceptar; se anula solo con la factura entera |

- **Por qué la cabecera no pasa por `PENDIENTE_DE_REPARTO` mientras hay propuestas pendientes (PROPUESTA, decidida el 2026-10-28):** ADR-029 §5 define `PENDIENTE_DE_REPARTO` como «cargada y sin repartir: su mercadería NO entra al stock», y §5b exige cabecera `CONFIRMADA` para que entre el stock de una parte. Con la propuesta, el reparto ya está DECLARADO completo al cargar (las partes suman 10000 puntos básicos) y la parte de la sucursal que carga entra al stock en el acto: dejarla `PENDIENTE_DE_REPARTO` contradiría a ADR-029 y obligaría a cada destino a hacer UPDATE de la cabecera al aceptar la última (un escritor más de la cabecera y una carrera más). Lo pendiente es la RECEPCIÓN de cada destino, y eso se ve DERIVADO: «Repartida: N de M partes aceptadas» (cuenta de propuestas `PENDIENTE` de una factura vigente). `PENDIENTE_DE_REPARTO` queda sin uso en E3a, como punto de extensión («carga una persona y reparte otra»).
- **Las partes suman 10000 y la destino acepta exactamente lo propuesto (cómo se hace cumplir, PROPUESTA):** (1) el único escritor de la carga calcula el reparto con `repartirFactura` y, ANTES de escribir, verifica que la parte propia más las propuestas sumen 10000 puntos básicos, que cada renglón sume su importe y su cantidad, y que cada sucursal sume su importe (si no, falla sin escribir: es un error de programación, no del usuario); (2) el comando «aceptar» solo lleva la propuesta, la sección y la fecha: **no lleva cantidades ni importes**, así que la destino no puede cambiarlos; la aceptación copia el porcentaje de la propuesta a su parte y los renglones de la propuesta al Kardex; (3) la base impide cambiar lo propuesto (renglones de la propuesta: solo SELECT e INSERT; la propuesta: UPDATE solo de su estado de aceptación) y una consulta de coherencia verifica las sumas.
- **Renglón**: inmutable. Su `precioPorUnidadStock` se calcula una vez y se copia a cada línea del Kardex.
- Ciclo: cargar → (bandeja de cada destino) → aceptar → … ; o cargar → anular (las propuestas pendientes quedan anuladas con la factura) → recargar.

### Nivel 5. Invariantes y políticas
- **D1 Σ renglones = `importeTotal`** exacto en centavos (caso de uso; la base no suma filas).
- **D2 Σ partes de un renglón (pesos) = `precioTotal` del renglón** y **Σ partes de un renglón (cantidad) = `cantidadStock` del renglón**, exactos.
- **D3 Σ pesos de una sucursal en todos los renglones = el importe que se tipeó para ella** (o el que sale del porcentaje). Test obligatorio: 3.000.000 = 2.000.000 + 1.000.000 exacto (con 1 y con 7 renglones), y 100 = 33,33 + 33,33 + 33,34. CONFIRMADA (decisión 4).
- **D4 Parte recibida ⇒ sus líneas del Kardex = su detalle** (misma cantidad, mismos pesos, mismo `precioPorUnidadStock`, `facturaProveedorRenglonId` del renglón) y la sucursal de su `Operacion` es la de la parte.
- **D5 Nada pendiente cuenta**: una parte `PENDIENTE` no tiene stock, ni costo, ni gasto en la destino. CONFIRMADA.
- **D6 Una propuesta se acepta una sola vez**, solo desde su sucursal destino, solo si la factura está vigente (sin anulación) y `CONFIRMADA`; acepta exactamente lo propuesto (cantidades, pesos y porcentaje).
- **D7 La anulación es entera y atómica**: se rechaza si cualquier parte recibida ya se consumió o si hubo un conteo posterior (las reglas de `anularCompra`, por cada parte). CONFIRMADA (D-ANUL).
- **D8 La compra de una parte no se anula ni se corrige suelta**: `anularCompra` y `corregirCompra` la rechazan y mandan a la factura. PROPUESTA (cierra el hueco I11).
- **D9 El porcentaje declarado nunca atribuye dinero** (ADR-029): con importes tipeados, `porcentajeDeclaradoBp` es el redondeo por mayor residuo de los importes, con piso de 1 punto básico (la base exige 1..10000). CONFIRMADA.
- **D10 Número de factura obligatorio en el modo reparto** (sin número no hay unicidad y una factura repartida cargada dos veces duplicaría stock en tres sucursales). PROPUESTA. En el modo una sola sucursal sigue opcional como en la compra.
- **D11 Renglón indivisible**: si una celda (renglón × sucursal) queda con pesos > 0 y cantidad 0 (p. ej. 1 unidad entera repartida en tres), se rechaza con el nombre del producto. PROPUESTA (§10 P7).
- **D12 Total mayor que cero** en el modo importes (sin pesos no hay reparto); un renglón en 0 (bonificado) se admite y reparte su cantidad con los mismos pesos de su factura. PROPUESTA.
- **D13 Idempotencia obligatoria**: cada comando nuevo con clave (UUID de la pantalla) y huella. CONFIRMADA (decisión 8).
- **D14 Aislamiento**: nada se ve ni se escribe de otra empresa (RLS); el operario de una sucursal solo ve y acepta lo suyo; la sucursal que propone ve sus propuestas (la propuesta es `ENTRE_SUCURSALES` y sus renglones la heredan, E3a-M). CONFIRMADA (ADR-028).
- **D15 Autorización siempre en el servidor**, revalidada dentro de la transacción. CONFIRMADA.

## 3. Escalera de producto (lo que ve el cliente), N0 a N5

Peldaños acumulativos: subir no cambia lo ya cargado. Formalidad (qué tan «documento» es) y detalle (cuánta información) son ejes separados; lo que falta se muestra «pendiente de completar».

| Peldaño | Qué ve el cliente | Etapa | Estado |
|---|---|---|---|
| N0 | Stock inicial o ajuste, sin documento | existe | — |
| N1 | Compra simple por sucursal (varias líneas, proveedor, N.º, referencia del proveedor) | existe | — |
| N2 | La compra con proveedor es un **documento**: cabecera con número único en la empresa, renglones | E3b (con el escritor de E3a) | PROPUESTA |
| N3 | **Factura repartida por propuesta y aceptación**: la sucursal que compra propone, cada destino acepta, el gasto y el costo quedan en cada una con importes exactos | **E3a** (requiere E3a-M) | PROPUESTA |
| N4 | Rechazo con motivo, cantidades por renglón y sucursal, recepción separada en la misma sucursal, letra/IVA/tributos, «¿Cómo se pagó?» | E3a+ / E6 / E5 / IVA | después |
| N5 | Tres vías (orden de compra, recepción, factura), cuenta corriente, nota de crédito con candado | E7 / E9 | después |

Cruce con el nivel 5 de diseño: N3 exige D1 a D14; N4 agrega estados (`RECHAZADA` con CHECK, migración aditiva) sin reinterpretar lo cargado.

## 4. La regla de dinero (cómo se reparte, con la prueba hecha)

Entradas: los renglones con su `precioTotal` (centavos enteros, ordenados por `orden`) y, por sucursal, un importe tipeado o un porcentaje (dos decimales).
1. **Pesos de cada sucursal.** Modo importes: `S_j` = lo tipeado, y Σ S_j tiene que dar el total exacto (si no: «Faltan $X» / «Sobran $X», rechazo). Modo porcentaje: los puntos básicos tienen que sumar 10000 y `S_j = repartirImporte(total, bp)` (`src/core/moneda.ts:117`, mayor residuo). Los pesos se pasan **en centavos enteros** (nunca como `number` con decimales).
2. **Matriz renglón × sucursal con las dos sumas exactas** (pura, nueva, `repartirFactura`): se recorren los renglones; cada uno se reparte con `repartirImporte(precioTotal_i, presupuestoRestante)`, donde el presupuesto de cada sucursal empieza en `S_j` y baja con lo asignado; el último renglón se lleva exactamente lo que resta. Así cada renglón suma su `precioTotal` (D2) y cada sucursal suma su `S_j` (D3), sin negativos.
   - **Spike medido (2026-10-27, script de solo lectura en el scratchpad):** 200.000 casos al azar (1 a 12 renglones, 2 a 6 sucursales, de centavos a $10.000.000): las dos sumas exactas siempre, **ningún negativo**, y el mayor desvío de una celda contra su proporción ideal fue de 0,8 centavos con 2 renglones, 4,1 con 10, 5,7 con 20 y 7,8 con 50. La alternativa de «redondeo acumulado» dio 2.518 celdas negativas en 200.000 casos: descartada.
   - 3.000.000 → [[2.000.000, 1.000.000]]; 100 con 33,33/33,33/33,34 → exacto. Ambos quedan como test.
3. **Cantidades**: cada renglón reparte su `cantidadStock` con `repartirCantidad` (pura, nueva: mayor residuo en pasos de `10^-decimales` de la unidad de stock, nunca más de 4 decimales) usando como pesos los pesos de su celda (o `S_j` si el renglón vale 0). Así el precio por unidad de cada celda queda cerca del del renglón.
4. **Rechazos** (D11): celda con pesos > 0 y cantidad 0; parte sin ninguna cantidad.
5. **`porcentajeDeclaradoBp`** = mayor residuo de 10000 con los `S_j`, piso 1 (D9).
6. Todo lo calcula el SERVIDOR con lo que tipeó la persona; la pantalla muestra la misma cuenta como vista previa (función pura compartida en `src/core/`), nunca la manda hecha.

## 5. Estados y Kardex: qué se escribe al cargar, al aceptar y al anular

| Momento | Se escribe (todo en UNA transacción SERIALIZABLE) | NO se escribe |
|---|---|---|
| **Cargar** | Cabecera (`CONFIRMADA`, `confirmadaEn/PorId` = ahora/quien carga, clave y huella, `resultadoMensaje`); renglones; por cada sucursal destino, una **propuesta** `PENDIENTE` (origen = la que carga, destino, `porcentajeDeclaradoBp`) con sus **renglones de propuesta** (cantidad y pesos de cada renglón con algo > 0); **parte propia** `RECIBIDA` (`recibidaEn` = fecha de la factura, `recibidaPorId`, `operacionId` en el mismo INSERT) con su `Operacion` COMPRA (fecha de la factura, proveedor, N.º tal cual, sección elegida) y una línea del Kardex por celda con cantidad > 0 (`facturaProveedorRenglonId`, `precioPorUnidadStock` del renglón, `precioTotal` de la celda, lote, `detalle` de conversión); el vínculo proveedor↔producto con la referencia (una vez por renglón, `registrarVinculoDeCompraEnTx`); auditoría de la cabecera (quién, desde qué sucursal, el reparto) | Nada de stock, costo ni gasto en las destino; ninguna fila de auditoría con `sucursalId` ajena |
| **Aceptar** (desde la destino) | `SELECT … FOR UPDATE` de la cabecera (primera sentencia: serializa contra la anulación y contra otra aceptación); `Operacion` COMPRA en la destino (fecha = fecha de stock elegida, proveedor, N.º, clave y huella de la aceptación, sección elegida) y sus líneas desde los renglones de la propuesta; INSERT de la **parte** de la destino ya `RECIBIDA` (`recibidaEn` = fecha de stock, `recibidaPorId`, `operacionId`, el porcentaje de la propuesta); `UPDATE` de la propuesta `SET estado='ACEPTADA', aceptadaEn, aceptadaPorId, parteId WHERE estado='PENDIENTE'` (si toca 0 filas, se aborta todo: ganó otro) | Nada en otras sucursales |
| **Anular** | `FOR UPDATE` de la cabecera; por cada parte RECIBIDA, la reversión existente de una compra (AJUSTE con `revierteAOperacionId`, único por operación, y `anuladaEn` de la `Operacion`), con las reglas de `anularCompra`; la cabecera `anuladaEn/PorId`; la fila nueva de **anulación** (motivo, clave y huella; única por factura); auditoría | Las propuestas pendientes no se tocan: las marca la anulación de su factura (estado efectivo «anulada») |

- **Vínculos:** parte → compra por `FacturaProveedorSucursal.operacionId` (siempre: toda parte nace con su compra); propuesta → parte por `parteId` (al aceptar); línea → renglón por `MovimientoStock.facturaProveedorRenglonId`. La función única que lee «las compras de una factura» usa los dos y una consulta de coherencia verifica D1–D4 (va al chequeo posterior de `docs/deploy-con-migraciones.md`).
- **Costo (V-T1, E2):** la entrada de la destino pasa a ser su costo de reposición si es la más reciente por fecha. **Gasto:** cada sucursal suma sus celdas en el período de la fecha de su compra (§10 P5). **Ratio compras/ventas:** el de cada sucursal con lo suyo.
- **Clave de la `Operacion` de la parte propia:** PROPUESTA: `NULL` (la protege la clave de la cabecera, en la misma transacción). NO VERIFICADO que ningún guardián exija clave en toda `Operacion` COMPRA: se verifica en el paso 5; si lo exige, se deriva (`<clave>#<sucursal>`).
- **Pago (punto de extensión, decisión 7):** la cabecera queda con `condicionPago = CONTADO_PAGADA` (el único valor del CHECK; es el significado de hoy: «toda compra se da por pagada») y sin fecha ni medio declarados; E5 suma la pregunta «¿Cómo se pagó?» sin migración.

## 6. Permisos: claves, pisos y qué ve cada rol

| Acción | Clave (existente) | Contexto y piso | Cambio en E3a | Estado |
|---|---|---|---|---|
| Cargar una factura (modo una sucursal) y la parte propia | `proceso_compra` en la sucursal activa | sucursal, `operario` | ninguno | PROPUESTA |
| Proponer partes en otras sucursales | `compra_repartir` + `proceso_compra` en la activa | empresa, **`administrador` → `operario`** | solo el piso, en `ACCIONES` (código); clase A → O en `clases-de-claves.test.ts`; sale de las reservadas | CONFIRMADA (decisión 6); cómo llega al rol `operador`: §10 P3 |
| Aceptar mi parte | `proceso_compra` en la destino | sucursal, `operario` | ninguno | PENDIENTE §10 P2 (alternativa: `compra_recibir`) |
| Anular la factura | `anular_compra` en CADA sucursal con una parte RECIBIDA y en la activa (`permisoYAlcanceEnSucursal`) | sucursal, `administrador` | ninguno | PENDIENTE §10 P6 (alternativa: clave nueva = migración de datos) |
| Ver «Para aceptar» y «Lo que cargué» | `proceso_compra` (Ver) en la activa | sucursal, `operario` | ninguno | PROPUESTA |
| Ver «Facturas de proveedor» (con importes) | `reporte_compras` en las sucursales que puede ver (`lecturaEnSucursalesVisibles`) | sucursal, `administrador` | ninguno | PROPUESTA |

**Qué ve cada uno (PROPUESTA, con P4 pendiente):**

| Rol | En la carga | En «Para aceptar» | En «Lo que cargué» | En el listado |
|---|---|---|---|---|
| Operario de la que compra | lo que tipea (vista previa con importes: es su propio dato, no una lectura) | — | estado de cada parte (pendiente / aceptada el día X por Y), productos y cantidades, sin importes | no entra |
| Operario de la destino | — | proveedor, N.º, fecha, desde qué sucursal y quién la propuso, productos y cantidades de SU parte, antigüedad; **sin importes** (P4) y sin el total de la factura ni las partes de otras | — | no entra |
| Administrador | igual | igual + importe de su parte | igual + importes | cabecera, total, partes que puede ver con sus importes y estado, y «N partes en sucursales que no ves» (una cuenta, permitida en la verificación) |

- La cabecera y los renglones son DE_EMPRESA (legibles en la base desde cualquier sucursal, ADR-029 §2): lo que se muestra lo decide la lectura y GT-1 (`campos-sensibles`). La propuesta y sus renglones son por sucursal (`ENTRE_SUCURSALES` y heredada): en la base misma, la destino solo lee las suyas y la sucursal que cargó, las que propuso.
- **Visibilidad exacta del operario de la sucursal destino (CONFIRMADA por el dueño el 2026-10-28):** ve SOLO los productos (nombre y unidad) y las cantidades de SU propuesta, más el proveedor, el N.º, la fecha, la sucursal que la propuso y quién, y la antigüedad. **Nada de importes** (ni los de su parte, ni el total de la factura, ni el precio por unidad) **ni partes o propuestas de otras sucursales.** La lectura de la bandeja no selecciona ningún campo de dinero (lo verifica una prueba sobre el objeto que devuelve, además de GT-1); los importes llegan después, con la distribución por unidad de negocio (E8).
- **Auditoría:** `FacturaProveedor` entra a `ENTIDADES_AUDITABLES` (`src/core/permisos/auditoria.ts:6`, código; la tabla de auditoría no tiene CHECK de entidades, verificado en las migraciones). Se audita: la carga (con el reparto: sucursales, importes y puntos básicos), cada aceptación (quién, cuándo, fecha de stock) y la anulación (motivo). Cada fila con la sucursal de quien actúa, nunca la ajena.

## 7. Escribir en sucursales ajenas sin ensanchar el alcance (forma final, 2026-10-28)

- **Decisión (PROPUESTA): NO usar `conEscrituraEnLaEmpresa`.** Abre lectura y escritura en TODAS las sucursales durante toda la transacción (también el Kardex) y su lista de usos es de «objetos de la empresa entera» (alta de producto, receta central, alta de sucursal: `escrituras-en-sucursal-desde-empresa.test.ts`). Usarlo aquí convertiría un error de programación en stock escrito en otra sucursal.
- **Por qué cambió la forma de E3a-M (2026-10-28, aprobado por el coordinador):** la idea original era reclasificar la parte (`FacturaProveedorSucursal`) como `ENTRE_SUCURSALES`. No se puede: `test/arquitectura/migraciones-de-alcance-de-sucursal.test.ts` exige que la migración YA APLICADA en producción `20261016102000` (M3c) sea la salida exacta del generador para la clasificación ACTUAL, y esa migración no se edita; además una columna NOT NULL nueva rompía 21 inserciones de pruebas existentes.
- **Forma final, 100 % aditiva** (ninguna tabla, política ni migración existente cambia):
  1. **`FacturaProveedorPropuesta`** (nueva, `ENTRE_SUCURSALES`: `origenSucursalId` = la que carga, `destinoSucursalId` = la que acepta; las dos NOT NULL con FK a `Sucursal` y distintas). La sucursal que carga la puede INSERTAR porque es su origen; las dos la ven. Políticas: salida EXACTA del generador para esa clasificación.
  2. **`FacturaProveedorPropuestaRenglon`** (nueva, `HEREDADA` de la propuesta por `propuestaId`): cantidad y pesos de cada renglón. Solo SELECT e INSERT.
  3. **`AnulacionDeFacturaProveedor`** (nueva, `DE_EMPRESA`, una por factura): motivo, clave de reintento (única global) y huella. Solo SELECT e INSERT.
  4. Al **aceptar**, la sucursal destino INSERTA su propia `FacturaProveedorSucursal` ya `RECIBIDA` con su `operacionId`, dentro de SU alcance (tabla `PROPIA` existente, sin ensanche). El índice único existente `(facturaProveedorId, sucursalId)` es la segunda barrera contra una doble aceptación. No hace falta permiso de UPDATE sobre `operacionId` ni tocar el disparador de la recepción.
- **Lo único que se escribe en la «zona» de la destino desde la sucursal que carga** son la propuesta y sus renglones. Nunca `Operacion`, `MovimientoStock`, `FacturaProveedorSucursal`, disponibilidad ni auditoría.
- Límite declarado (igual que en traspasos): la política de UPDATE de la propuesta también deja al origen marcarla aceptada; lo impide el caso de uso (solo acepta si `destinoSucursalId` = sucursal activa, con `proceso_compra` en ella) y una prueba con cero filas. Tampoco hay disparador que impida volver de `ACEPTADA` a `PENDIENTE` por SQL directo (la regla de la etapa es no usar disparadores): el caso de uso usa `WHERE estado = 'PENDIENTE'`.
- **Guardianes a actualizar** (en el mismo commit que su cambio): `test/setup/clasificacion-de-tablas.ts` (primera dimensión: las tres tablas con empresa; segunda: propuesta `ENTRE_SUCURSALES`, renglones `HEREDADA`, anulación `DE_EMPRESA`); `test/setup/migraciones-de-alcance-de-sucursal.ts` (la migración de políticas nueva en `MIGRACIONES_DE_POLITICAS_POSTERIORES`, salida EXACTA del generador); `alcance-de-sucursal.test.ts` (sin cambios de reglas: las tablas nuevas las cumplen); `ids-de-sucursal-declaran-a-que-se-atan.test.ts` (las ids destino del comando de carga, declaradas con su evidencia); `kardex-solo-agrega.test.ts` (los renglones de la propuesta y la anulación solo agregan; la propuesta tiene UPDATE solo de su aceptación, con un único escritor); `cerco-dueno-unico-por-modelo` (sin subir el trinquete); `campos-sensibles.ts` (los pesos de los renglones de la propuesta, piso `administrador`); `toda-accion-se-usa` y `clases-de-claves`; `.dependency-cruiser-excepciones.cjs` (pares `actions/movimientos` → `persistencia/compras` con `MOTIVO_COMPRAS`, deuda ya declarada); `ensanches-de-alcance.test.ts`: **sin cambios** (prueba de que no se ensancha nada).
- **Anulación** con partes recibidas en otras sucursales: `permisoYAlcanceEnSucursal(ctx, sucursal, "anular_compra")` por cada una (forma `GATE_EN_ESA_SUCURSAL`, existente). Si al administrador le falta el permiso en una, se rechaza nombrándola.
- **Producto disponible en la destino**: lo decide la aceptación (la destino lo ve en su propio alcance); si el producto ya no está habilitado allí, la aceptación se rechaza nombrándolo y la salida es anular y recargar.

## 8. Relación con la compra simple (E3a coexiste, E3b la une)

- E3a no cambia la compra simple: sin activar «Repartir entre sucursales», la pantalla registra la compra de siempre (`registrarMovimiento`), sin cabecera.
- El caso de uso nuevo soporta las dos formas (1 parte o N partes) y es el **único escritor** de las tablas de la factura. En E3b, `registrarMovimiento` COMPRA con proveedor pasa por ese mismo escritor (una parte), así hay un solo camino y el número pasa a ser único en la empresa (D-FACT). PROPUESTA: en E3a el modo una sola sucursal queda probado pero no se expone como pantalla aparte (sería lo mismo que la compra simple).
- Coexistencia y duplicados en E3a: factura vs. compra simple con el mismo número **en la misma sucursal** → el índice de `Operacion` lo rechaza (también al aceptar, si la destino ya la había cargado como compra simple: se le dice cuál anular); **en distinta sucursal** → solo el aviso C25 (no bloquea), como hoy. Lo cierra E3b.
- Los reportes que leen compras (Compras registradas, Período, Costos, Valuación) ven la compra de cada parte como una compra más: no cambian.

## 9. ¿Qué pasa si…? (por comando)

### 9.1 Cargar factura (modo una sola sucursal y modo reparto)
| Situación | Qué pasa | Cómo se garantiza |
|---|---|---|
| Repetición (doble clic, misma clave) | Devuelve el mismo mensaje, «repetida»; nada nuevo | Chequeo I3 por `FacturaProveedor.claveIdempotencia` dentro de la transacción; `resultadoMensaje` guardado |
| Misma clave, otro contenido | «Conflicto de reintento» | Huella distinta (`calcularPayloadHash`, incluye la sucursal activa) |
| Concurrencia: 8 envíos a la vez con la misma clave | Una sola factura, una sola compra propia, partes una vez | Clave única global + reintento SERIALIZABLE (`tambienChoqueDeUnico`); test con `Promise.all` |
| Concurrencia: dos personas cargan el mismo número (claves distintas) | Una gana; la otra: «Ya hay una factura de este proveedor con ese número» | Índice `FacturaProveedor_unica_vigente_key`; su nombre se suma a los reconocidos (`src/core/movimientos/factura-unica.ts`) |
| Ya hay una compra simple con ese número en la sucursal que carga | «Ya hay una compra registrada con esa factura…» | Índice de `Operacion` (por sucursal) |
| Tiempo: fecha | El día elegido (hora argentina) es la fecha de la factura y la de stock de la parte propia; mismos límites que la compra | `diaDeCalendario(…, ZONA_ARGENTINA)`, mediodía AR |
| Incertidumbre («no sé cuánto le toca a cada una») | E3a no tiene borrador: o se carga todo a la propia, o se espera | `PENDIENTE_DE_REPARTO` queda como punto de extensión (sin uso) |
| Reintento tras corte de red | Con la misma clave: el resultado guardado, sin duplicar | I3 |
| Error parcial (falla una parte, un vínculo o una línea) | No queda nada | Una transacción SERIALIZABLE |
| Datos faltantes | Sin proveedor, sin renglones, renglón sin cantidad, N.º vacío en reparto (D10), importes que no suman (con la diferencia), % que no suma 100, total 0 en modo importes, celda indivisible (D11), parte sin cantidad, sección no elegida | Guard del comando (zod) + reglas puras; rechazo con mensaje, cero filas |
| Sucursal destino inexistente, de otra empresa o desactivada | «No se encontró la sucursal» / «está desactivada» | RLS + lectura de `Sucursal` dentro de la transacción |
| Producto no disponible en la destino | Rechazo nombrando producto y sucursal | Verificación sí/no (§7) |
| Proveedor o sección desactivados en el medio | Rechazo («ya no está disponible» / `SECCION_INACTIVA`) | Revalidación dentro de la transacción (U11, P17) |
| Cambio de permisos entre abrir y guardar | Rechazo; sin `compra_repartir`, el reparto no se guarda (la pantalla tampoco lo ofrece) | Gate en el servidor en cada envío |
| Otra empresa | Invisible; ids ajenos → «No se encontró…» | RLS por empresa |

### 9.2 Aceptar mi parte (desde la sucursal destino)
| Situación | Qué pasa | Cómo se garantiza |
|---|---|---|
| Repetición con la misma clave (doble clic, reintento) | «Repetida», mismo mensaje, una sola entrada | I3: la clave y la huella van en la `Operacion` COMPRA de la aceptación (`chequearIdempotencia` dentro de la transacción) |
| Misma clave, otro contenido (otra sección o fecha) | «Conflicto de reintento», nada escrito | Huella distinta |
| Otra clave sobre una propuesta ya aceptada | «Esta parte ya fue aceptada»; cero filas nuevas | `UPDATE … WHERE estado='PENDIENTE'` de la propuesta toca 0 filas → se aborta la transacción; y la segunda barrera: el índice único existente `(facturaProveedorId, sucursalId)` de la parte (23505 → el mismo mensaje) |
| Concurrencia: 2 u 8 operarios de la 4 a la vez (claves distintas o la misma) | Una sola compra, una sola parte y un solo juego de líneas | `FOR UPDATE` de la cabecera + guarda del UPDATE + único de la parte + único de la clave; test con `Promise.all` de 8 en las dos variantes |
| Concurrencia contra la anulación | Si gana la anulación: «La factura fue anulada» y nada escrito; si gana la aceptación: la anulación incluye esa parte (o se bloquea si ya se usó) | El mismo `FOR UPDATE` de la cabecera como primera sentencia en los dos; test con `Promise.allSettled` de aceptar + anular |
| El operario de la 3 intenta aceptar la propuesta de la 4 | Rechazo, cero filas | Gate en la sucursal activa + el caso de uso exige `destinoSucursalId` = activa (la 3 VE la propuesta por ser su origen) |
| La destino quiere aceptar otra cantidad u otro importe | No puede: el comando no lleva cantidades ni importes | Se copian los renglones de la propuesta tal cual |
| Tiempo: fecha de stock | Por defecto la de la factura; se puede elegir entre la fecha de la factura y hoy (hora AR) | Guard + regla pura; §10 P5 |
| Tiempo: nadie la acepta | Queda en «Para aceptar» con su antigüedad; la que compró la ve pendiente en «Lo que cargué»; no cuenta en nada | D5 |
| Incertidumbre (llegó distinto o no llegó) | E3a: no se acepta parcial; se acepta y se corrige con un ajuste o merma, o se pide anular | «Rechazar con motivo» es N4 (migración) |
| Reintento tras corte | Misma clave → resultado guardado | I3 |
| Error parcial | Compra, líneas y UPDATE: todo o nada | Transacción |
| Datos faltantes | Sin sección o sección de otra sucursal o dada de baja → rechazo; producto deshabilitado en la destino desde la propuesta → rechazo nombrándolo | `obtenerSeccionPropia`, P17, `productoDisponibleEn` |
| Factura anulada (la propuesta quedó marcada por la anulación) o propuesta de otra empresa | «La factura fue anulada» / «No se encontró» | Cabecera y su anulación releídas bajo candado; RLS |
| La destino ya cargó esa factura como compra simple | Rechazo: «ya hay una compra con esa factura en esta sucursal: anulá una de las dos» | Índice de `Operacion` |
| Cambio de permisos | Sin `proceso_compra` en la destino → rechazo | Gate en el servidor |

### 9.3 Anular factura (administrador)
| Situación | Qué pasa | Cómo se garantiza |
|---|---|---|
| Repetición / reintento con la misma clave | El mismo mensaje, «repetida», sin nada nuevo | Clave y huella en la fila de anulación (tabla nueva, clave única global) leída dentro de la transacción |
| Otra clave sobre una factura ya anulada | «La factura ya está anulada» | Anulación única por factura (índice) + `UPDATE … WHERE anuladaEn IS NULL` + reversión única por operación |
| Concurrencia: dos administradores | Una sola anulación | `FOR UPDATE` de la cabecera |
| Algo ya consumido o conteo posterior en CUALQUIER parte | Rechazo entero nombrando sucursal y producto; nada escrito | `evaluarAnulacion` y `evaluarPosterioresAAnularCompra` por cada parte, antes de escribir |
| Propuestas pendientes | Quedan marcadas por la anulación (estado efectivo «anulada»): desaparecen de «Para aceptar», en «Lo que cargué» dicen «anulada» y ya no se pueden aceptar | Las lecturas y la aceptación miran la anulación de su factura, bajo el candado de la cabecera; prueba de aceptar contra anular a la vez |
| Falta el permiso en una sucursal con parte recibida | Rechazo nombrando la sucursal | `permisoYAlcanceEnSucursal` por sucursal |
| Quien anula no tiene permiso en la sucursal que CARGÓ la factura (aunque esa no se haya quedado con parte: compró solo para otras) | Rechazo «la cargó otra sucursal…»; nada escrito | PROPUESTA (2026-10-28, hallazgo de la matriz de denegación GT-3b: sin esto, un administrador de cualquier sucursal anulaba la factura que otra cargó solo para terceras): la lectura de verificación devuelve también el origen de las propuestas y se pide `anular_compra` allí |
| Datos faltantes | Motivo obligatorio (1 a 200 caracteres visibles) | Guard + CHECK de la tabla de anulación |
| Tiempo | Sin límite de antigüedad (no hay cierre de períodos todavía, etapa CP) | — |
| Número | Queda libre para volver a cargarla | Índice parcial de vigentes |
| Notas de crédito vigentes | Rechazo (C29) | Chequeo barato; hoy no hay notas (nadie las escribe) |
| Error parcial | Todo o nada | Transacción |
| Cambio de permisos | Revalidado en el servidor | Gate |

### 9.4 Ver «Para aceptar» (y «Lo que cargué»)
| Situación | Qué pasa |
|---|---|
| Quién | Quien tiene «Ver» de `proceso_compra` en la sucursal activa; sin él, la sección no se muestra (falla cerrado) |
| Qué | Solo propuestas `PENDIENTE` cuyo destino es esta sucursal y cuya factura no está anulada: proveedor, N.º, fecha, desde qué sucursal y quién, productos y cantidades, antigüedad en días (hora AR). **Sin importes** (CONFIRMADA, 2026-10-28) y sin propuestas de otras sucursales |
| Lista vieja (otro la aceptó o se anuló en el medio) | Al aceptar se revalida y se avisa; la lista se refresca |
| Otra sucursal u otra empresa | No se ve (RLS) |
| Producto dado de baja después | Se muestra con «(dado de baja)»; aceptar lo rechaza con el motivo |
| «Lo que cargué» | Partes que esta sucursal propuso, con su estado (sin importes para el operario) |

### 9.5 Ver «Facturas de proveedor» (listado)
| Situación | Qué pasa |
|---|---|
| Quién | `reporte_compras` (administrador), en las sucursales que puede ver |
| Período | Por la fecha de la factura (día AR); filtro por proveedor |
| Qué | Cabecera, total, partes visibles con importe y estado, «N partes en sucursales que no ves», anulada (con motivo) o vigente; botón «Anular» con el permiso |
| Lo que falta | Letra, fecha impresa, pago: «pendiente de completar» |
| Cambio de permisos | Sin la clave, no entra; los importes respetan GT-1 |

## 10. Decisiones PENDIENTES (una pregunta por tema, con recomendación)

> **Respondidas el 2026-10-28 (CONFIRMADAS):** P1 sí, E3a-M autorizada SOLO en bases locales (aplicarla a una base real se pide aparte) y con la forma final de §7; P4: el operario de la destino ve solo productos y cantidades; P2, P3, P5, P6 y P7: rige la recomendación de cada una (acepta `proceso_compra`; `compra_repartir` a piso operario y asignación por la matriz, sin migración de datos; el gasto cae en el mes de la fecha de stock elegida, entre la fecha de la factura y hoy; anula `anular_compra` en cada sucursal donde ya entró una parte; el producto indivisible se rechaza). «RECHAZADA con motivo» queda para después (migración aparte).

1. **Modelo (REQUIERE AUTORIZACIÓN EXPRESA):** ¿autorizás la migración chica E3a-M (§11, paso 3)? Sin ella, propuesta + aceptación con importes exactos no se puede hacer (§0). **Recomendación: sí**; se escribe y ensaya solo en local, y aplicarla a cada base real se avisa antes, con respaldo y ensayo en rama de Neon. Las tablas tienen 0 filas.
2. **Permisos — quién acepta:** ¿alcanza con poder «Registrar una Compra» en la sucursal (`proceso_compra`, que ya tienen los operadores) o querés una llave aparte («Confirmar la recepción», `compra_recibir`, que hoy solo tiene el admin y el gerente tendría que dar en la matriz)? **Recomendación: `proceso_compra`** (anda desde el primer día sin configurar nada); `compra_recibir` queda para la recepción separada en la misma sucursal (E6).
3. **Permisos — cómo reciben los operadores la llave de repartir:** bajar el piso no se la da a nadie. ¿La asigna el gerente en la matriz a quien corresponda, o la damos de fábrica a todos los operadores (migración de datos)? **Recomendación: la matriz** (decidís sucursal por sucursal quién reparte; cero migración).
4. **Permisos y dinero — qué ve el operario de la destino:** ¿ve el importe de su parte o solo productos y cantidades? Hoy ningún operario ve importes de compras (piso administrador). **Recomendación: solo cantidades en E3a**; el importe de su parte se abre cuando haga falta para distribuir a unidades de negocio (E8), con su clave.
5. **Dinero — en qué mes cae el gasto de una parte aceptada:** el gasto y el costo de la destino se cuentan en la fecha de stock que elija al aceptar (así leen hoy todos los reportes). Una factura del 31/10 aceptada el 2/11 con fecha 2/11 cae en noviembre en la destino. **Recomendación: la fecha de stock arranca en la fecha de la factura** (cae en el mismo mes) y se puede cambiar solo entre esa fecha y hoy.
6. **Permisos — quién anula:** ¿alcanza con «Anular una compra» (`anular_compra`, administrador) en cada sucursal donde ya entró una parte, o querés una llave aparte para facturas (clave nueva = migración de datos)? **Recomendación: `anular_compra`** (anular la factura es anular sus compras).
7. **Dinero — producto que no se puede partir** (1 unidad para 3 sucursales): ¿se rechaza y se carga aparte, o en esta etapa ya se pueden escribir las cantidades de cada sucursal por renglón (PB1)? **Recomendación: rechazar en E3a** con mensaje claro; cantidades por renglón en E3a+ (la tabla de E3a-M ya las guarda, no necesita otra migración).

## 11. Plan de implementación (un commit por paso; Fase 2)

Convenciones de cada paso: tests nuevos con su **mutación** (mutar → rojo → revertir → verde, anotada en el commit); comandos pesados con `flock /tmp/pesado.lock`; `tsc` y `lint` con `NODE_OPTIONS=--max-old-space-size=6144`; nada contra Neon ni Vercel; commit sin firmas; push a `alegp/carril-y`; sin PR.

| Paso | Qué | Migración | Archivos (aprox.) | Pruebas y mutaciones |
|---|---|---|---|---|
| 0 | Línea de base: conteos (`find test -name "*.test.ts" \| wc -l` = 1105; specs e2e = 157 + 1 demo) y los 8 comandos verdes antes de tocar nada | no | 0 | — |
| 1 | `src/core/compras/`: `repartirFactura` (matriz con presupuesto remanente), `repartirCantidad`, `pesosDelReparto` (importes o %, bp con piso 1), `normalizarNumeroDeComprobante` («1-1234» = «0001-00001234») y reglas D10–D12 | no | 4 src + 4 tests | Propiedades (fast-check): sumas exactas por fila y columna, sin negativos, desvío acotado; 3.000.000 = 2.000.000 + 1.000.000 (1 y 7 renglones); 100 = 33,33 + 33,33 + 33,34; renglón indivisible. Mutaciones: el último renglón sin «resto», pesos en `number` con decimales, mayor residuo → redondeo simple |
| 2 | Esquemas y guards de los tres comandos (clave obligatoria, motivo, fechas AR) | no | 3 src + 3 tests | Sin clave → rechazo; formato; fecha fuera de rango. Mutación: clave opcional |
| 3 | **E3a-M (forma final, 2026-10-28)**: dos migraciones nuevas, 100 % aditivas, sin tocar tablas, políticas ni migraciones existentes. (1) `20261028100000_factura_proveedor_propuesta`: tabla `FacturaProveedorPropuesta` (`facturaProveedorId`, `origenSucursalId`, `destinoSucursalId` —distintas—, `porcentajeDeclaradoBp` 1..10000, `estado` `PENDIENTE`/`ACEPTADA` con CHECK, `aceptadaEn`/`aceptadaPorId`/`parteId` juntos si y solo si `ACEPTADA`, `creadoPorId`, `creadoEn`; única por (factura, destino); UPDATE solo de las cuatro columnas de la aceptación), tabla `FacturaProveedorPropuestaRenglon` (`facturaProveedorId`, `propuestaId`, `facturaProveedorRenglonId`, `cantidadStock` DECIMAL(14,4) ≥ 0, `precioTotal` DECIMAL(14,2) ≥ 0, al menos uno > 0; FK compuestas que atan propuesta y renglón a la MISMA factura; única por (propuesta, renglón); solo SELECT e INSERT) y tabla `AnulacionDeFacturaProveedor` (`facturaProveedorId` único, `motivo` 1..200 con un carácter visible, `claveIdempotencia` única global, `payloadHash`, `resultadoMensaje`, `creadoPorId`, `creadoEn`; solo SELECT e INSERT), con RLS de empresa y privilegios; (2) `20261028101000_rls_sucursal_factura_proveedor_propuesta`: las 4 políticas de cada una de las dos tablas por sucursal, salida EXACTA del generador. Cada una con `down.sql` (aborta si hay filas). ADR-041 «La parte de una factura repartida se propone y se acepta» | **SÍ — autorizada SOLO en bases locales (subir/bajar/subir); aplicarla a una base real se pide aparte** | ~4 migración + schema + 3 `test/setup` + ADR | Subir/bajar/subir con datos; RLS (la 3 ve y crea la propuesta de la 4; la 4 ve solo la suya; la 6 no ve la de la 4; otra empresa nada); privilegios (sin DELETE, sin UPDATE de cantidades ni pesos); CHECK de coherencia de la aceptación; concurrencia con clientes `pg` como `motor2_app` (8 aceptaciones con la guarda → 1). Mutaciones: política sin el origen, grant de más, CHECK de aceptación quitado |
| 4 | `src/server/persistencia/compras/`: escribir cabecera + renglones + partes + detalle; cargar parte para aceptar; cargar factura para anular; extender `escribirLineasDeMovimientoStock` con `facturaProveedorRenglonId`. Guardianes: `kardex-solo-agrega`, cerco de dueño único, R2 | no | 4 src + ~6 guardianes | Contra la base: D1–D4 con la consulta de coherencia en cero. Mutación: renglón sin `facturaProveedorRenglonId` |
| 5 | Caso de uso `registrarFacturaProveedor` + Server Action (`conPermiso("proceso_compra")` + `compra_repartir` en el caso de uso si hay partes ajenas); `compra_repartir` a piso `operario`; `FacturaProveedor` a auditables; GT-4 (forma de las ids destino), ficha y etiquetas de contrato | no (usa E3a-M) | 4 src + 5 tests + 5 guardianes + goldens de la matriz | Modo una sucursal y reparto; 8 envíos con `Promise.all` misma clave → 1; dos claves mismo número → 1 + mensaje; operario sin `compra_repartir` → rechazo y cero filas; otra empresa; producto no disponible en destino; proveedor/sección desactivados. Mutaciones: sin chequeo I3, sin gate de reparto, parte ajena `RECIBIDA` |
| 6 | `anularCompra` y `corregirCompra` rechazan la compra de una parte de factura (D8) | no | 2 src + 2 tests | Mutación: quitar el rechazo → la factura queda incoherente (test rojo) |
| 7 | Caso de uso `aceptarParteDeFactura` + Server Action | no | 3 src + 3 tests | 8 operarios de la 4 con `Promise.all` (claves distintas y misma clave) → 1 compra; el de la 3 no puede (cero filas); pendiente no entra al stock ni al costo ni al gasto de la 4 hasta aceptar; aceptar contra anulación concurrente; fecha fuera de rango. Mutaciones: sin `WHERE PENDIENTE`, sin `FOR UPDATE`, sin chequeo de sucursal |
| 8 | Caso de uso `anularFacturaProveedor` + Server Action | no | 3 src + 3 tests | Dos administradores a la vez → 1; algo consumido en la 6 → nada anulado en la 3 ni en la 4; falta permiso en una → rechazo; pendientes muertas; número liberado. Mutación: anular parte por parte sin transacción única |
| 9 | Lecturas: «Para aceptar», «Lo que cargué», «Facturas de proveedor»; GT-1 (campos sensibles) y matriz de denegación | no | 3 src + 4 tests | El operario de la 4 no recibe importes ni partes ajenas (prueba sobre el objeto devuelto); otra empresa vacía |
| 10 | Pantallas (opción barata, §11.1) y spec e2e `factura-repartida.spec.ts` (operario 3 carga para 3, 4 y 6 → operario 4 acepta → stock y costo en 4 → admin anula) | no | ~5 UI + 1 e2e | Playwright con dos sesiones |
| 11 | Documentación (ADR-029 §5/§6/§9, circuito E3a, pendientes) y cierre: gate completo, ratio/`totalGastado`/costo/valuación sobre los datos existentes **iguales** que antes | no | ~4 docs | Golden de caracterización regenerado y declarado |

Costo estimado de la Fase 2: **~12 commits, ~85 a 100 archivos** (la mitad pruebas y guardianes), unas **25 a 30 horas de agente** (cada corrida completa del gate tarda ~20 min más e2e, en una máquina compartida). Sin la autorización de E3a-M se pueden hacer los pasos 0, 1, 2 y 6 (y escribir el 3 sin aplicarlo); el resto depende de E3a-M.

### 11.1 Pantallas: la opción barata contra la completa
| Pantalla | Opción barata (E3a) | Opción completa (después, con nombre) |
|---|---|---|
| Cargar factura | **La misma pantalla de Compra** (`panel-movimiento-form.tsx`): un interruptor «Repartir entre sucursales» (visible con `compra_repartir`) que agrega un bloque con las sucursales de la empresa, «importe» o «%» por sucursal, «Falta/Sobra» en vivo y la vista previa del reparto; la precarga del proveedor con su referencia queda igual. Al guardar llama al caso de uso nuevo | Pantalla propia «Factura de proveedor» con letra, fecha impresa, IVA y tributos, cantidades por renglón y sucursal (Ola PM, E3a+/IVA) |
| Para aceptar | Un bloque «Para aceptar (N)» arriba de la página de Compra de la sucursal, con «Aceptar» que abre un diálogo chico (sección + fecha de stock); y «Lo que cargué» debajo | Bandeja propia con filtros, aviso en el menú y antigüedad destacada (E6) |
| Facturas de proveedor | Página simple de solo lectura en Reportes › Compras (período y proveedor) con el botón «Anular» y su motivo | «Documentos de proveedor» unificada con notas de crédito y pago declarado (E5/E7) |

## 12. Verificación final obligatoria (los 8 comandos, en la MISMA corrida, todos limpios)

```bash
cd /home/user/lanes/y && set -a; . <archivo de entorno del carril>; set +a
flock /tmp/pesado.lock env NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit      # salida 0, sin errores
flock /tmp/pesado.lock env NODE_OPTIONS=--max-old-space-size=6144 npm run lint          # salida 0, 0 avisos nuevos
flock /tmp/pesado.lock npm run arquitectura                                              # dependency-cruiser + contratos: 0 violaciones (excepciones solo con motivo)
flock /tmp/pesado.lock npm run analizar:muerto                                           # knip: salida 0, 0 hallazgos
flock /tmp/pesado.lock npm test                                                          # vitest: todo verde; *.test.ts ≥ 1105 + los nuevos
flock /tmp/pesado.lock npm run build                                                     # build de la app: salida 0
flock /tmp/pesado.lock npm run plataforma:build                                          # consola de plataforma: salida 0
flock /tmp/pesado.lock npm run test:e2e                                                  # Playwright: 157 + nuevos specs, 0 fallas, 0 flaky sin explicar
```

Criterio de éxito: los 8 con salida 0 en la misma corrida y sobre el mismo commit; conteos iguales o mayores que la línea de base del paso 0; cada test nuevo con su mutación anotada; la consulta de coherencia de la factura en cero; ratio compras/ventas, `totalGastado`, costo y valuación sobre los datos existentes **exactamente** iguales que antes (ninguna factura vieja existe: la diferencia esperada es cero).

## 13. Riesgos

- **Sin E3a-M no hay N3.** Si la autorización tarda, E3a solo deja listas las piezas puras y los rechazos de anular/corregir (pasos 1, 2 y 6).
- **Cambio de RLS en una tabla aplicada en producción** (la parte pasa a `ENTRE_SUCURSALES`): tabla vacía, salida exacta del generador y prueba de subir/bajar/subir; igual se ensaya en una rama de Neon antes de aplicar.
- **Desvío por redondeo de una celda** (hasta ~8 centavos con 50 renglones) contra la proporción ideal: las sumas que importan (por renglón y por sucursal) son exactas; la celda es la que absorbe.
- **Guardián GT-4 con una lista de ids** (NO VERIFICADO): puede requerir ampliar su lector.
- **Fecha de stock elegida por la destino** mueve el gasto de mes (P5).
- **Golden de la matriz de acceso y huella de gobierno** cambian por el piso de `compra_repartir`: regenerar y declarar en `caracterizaciones-congeladas`.
- **Máquina compartida** (4 CPU, reinicios del contenedor): correr el gate completo con `flock` y repetir si un reinicio corta una corrida.

## 14. Estado de implementación (Fase 2, desde 2026-10-28)

| Paso | Estado | Commit |
|---|---|---|
| 0 Línea de base | sobre `42c5060c` (cliente de Prisma regenerado: estaba viejo, sin la columna de E2): tsc, lint, arquitectura y knip verdes; vitest 1147 archivos / 15111 pruebas con 3 rojas que son del montaje de la copia de trabajo descartable (sus `node_modules` son un enlace: `dependencias.test.ts` y `plataforma-declara-sus-dependencias.test.ts` no ven los paquetes), no del código; build, plataforma y e2e de la línea de base NO se corrieron (se cortaron para liberar la máquina compartida) | — |
| 1 Funciones puras del reparto y del número | hecho, 5 mutaciones rojas | `1ce2f9d6` |
| 2 Contratos y guards | hecho, 4 mutaciones rojas | `06e596b6` |
| 6 Compra de una parte no se anula ni corrige suelta | hecho, 3 pruebas contra la base, 3 mutaciones rojas | `37818c13` |
| 3 Migración E3a-M (forma final, §7) + ADR-041 | hecho; subir/bajar/subir ensayado SOLO en bases locales; 4 pruebas, 3 mutaciones rojas (política sin el origen, grant de UPDATE de más, CHECK de aceptación quitado) | `a3c6d7cc` |
| 4, 5, 7 y 8 Persistencia + los tres casos de uso + Server Actions + lecturas | hecho en UN commit (desvío del plan: los cuatro pasos comparten la persistencia y los guardianes, y por separado no compilaban los guardianes de ficha y de idempotencia); 21 pruebas contra la base, 5 mutaciones rojas (sin `compra_repartir`, sin chequeo de destino, sin chequeo de anulada, anular sin evaluar, y la triple barrera de la aceptación) | `c9adcf30` |
| 9 y 10 Pantallas (opción barata) + spec e2e | hecho: interruptor «Repartir entre sucursales» en la Compra, bandeja «Para aceptar (N)» (solo productos y cantidades), «Partes propuestas a otras sucursales», «Anular factura entera» con motivo en Compras registradas; `test/e2e/factura-repartida.spec.ts` (2 mutaciones rojas); el spec de `alegp/carril-z` sigue verde | `f4dd8628` |
| 11 Documentación y gate final | ADR-029 (notas en §5, §5b, §6 y §9), circuito de abastecimiento (cómo quedó E3a), pendientes. Gate de 8 comandos en la MISMA corrida sobre `e490a5ce`, todos con salida 0 (base local del carril, 2026-10-28): tsc, lint, arquitectura, knip (0 hallazgos), vitest 1152 archivos / 15202 pruebas (línea de base 1147 / 15111), build, plataforma:build y e2e 767 pasadas, 7 omitidas, 0 fallas (158 specs: 157 + `factura-repartida`) | `3ddfb4d7`, `6426f6f6`, `22136732`, `f0af6527`, `e490a5ce` |

**Desvíos y hallazgos de la implementación (NO VERIFICADO = no se pudo comprobar en esta corrida):**
- **La aceptación tiene TRES barreras** contra la doble entrada (estado leído bajo el `FOR UPDATE` de la cabecera, `UPDATE … WHERE estado = 'PENDIENTE'` y el único (factura, sucursal) de la parte; más el único del número de factura en la compra de la sucursal). La mutación «sin `WHERE PENDIENTE`» sola NO pone rojo ningún test (las otras barreras la tapan); se la vio roja recién quitando las tres en una base de trabajo descartable (`motor2_cy_trabajo`), y los índices se restauraron.
- **El producto tiene que estar habilitado en la sucursal que carga** (se reutiliza `armarLineaMovimiento`), aunque toda la cantidad vaya a otra; la destino se verifica recién al aceptar (§7).
- **Sin aviso C25** (precio fuera de lo habitual) en la carga de una factura: la compra simple lo sigue dando.
- **GT-4** (`ids-de-sucursal-declaran-a-que-se-atan`) no mira ids anidadas en listas (`reparto.partes[].sucursalId`): se declaró igual el ensanche por dato de la base, pero el guardián no lo habría exigido.
- **Corregir una factura** = anularla entera y volver a cargarla (no hay clave de corrección de reparto).
- **Anular pide permiso también en la sucursal que cargó la factura** (PROPUESTA, endurece P4 sin cambiarla en el caso normal): la matriz de denegación (GT-3b) mostró que una factura cargada por una sucursal SOLO para otras (sin parte propia, con propuestas pendientes) la podía anular cualquier administrador de la empresa, porque la cabecera es de la empresa y no había ninguna parte donde pedir el permiso. Prueba en `factura-proveedor-repartida.test.ts` y escenario `ajenaSucursal` de la matriz; ambos rojos sin el arreglo.
- **Goldens y caracterizaciones** que cambian a propósito por E3a: `reportes-c0.golden.txt` (12 líneas `facturaProveedorId: null`, declarada en `caracterizaciones-congeladas`), `test/modulos/__golden__/empresa-principal.json` (el piso de `compra_repartir`), `matriz-esperada.ts` y `piso-de-gobierno.test.ts` (18 acciones de empresa de piso administrador; 56 operario y 61 administrador). La matriz de acceso y las huellas de gobierno NO cambian (la semilla sigue siendo solo `admin`).
