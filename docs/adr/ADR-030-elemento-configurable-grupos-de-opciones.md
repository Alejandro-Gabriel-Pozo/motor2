# ADR-030: Elemento configurable (grupos de opciones de venta)

> Redactado el 2026-10-13 (GO-1). **Estado: propuesto; GO-1 aplicado a la base de producción el 2026-10-13.** El modelo de datos está en el repositorio (seis migraciones con su `down.sql` y sus pruebas contra Postgres real); desde GO-2a (rama `go2a-admin-opciones`, sin migración, pendiente de CI) los casos de uso de ADMINISTRACIÓN del catálogo las escriben (ver «GO-2a») y desde GO-2b también la venta (ver «GO-2b»), y están aplicadas a la base de producción (Neon) desde el 2026-10-13, con respaldo y ensayo previos (ver `docs/deploy-con-migraciones.md`); cada base nueva REQUIERE AUTORIZACIÓN EXPRESA, con respaldo y ensayo en una rama de Neon. Las pantallas no están diseñadas. Completa ADR-009 (sobrescritura por sucursal), ADR-011/014/015 (módulos), ADR-027 (pisos) y ADR-028 (alcance por sucursal). El 031 (centros de costos) ya existe: este es el 030 que había quedado reservado.

> **GO-2b (2026-10-13): la VENTA con opciones, sin pantallas**, en la rama `go2b-venta-opciones` (sin migraciones ni cambios de esquema): agregar ítems, enviar y quitar, el cierre, las anulaciones, el ticket, la comanda y los reportes de costo ya leen y escriben las opciones (sección «GO-2b» más abajo). La administración del catálogo de opciones es GO-2a; las pantallas van aparte.

## Contexto

El dueño quiere vender un «Café» con tamaño y tipo, sin crear siete productos. Sus decisiones (del 2026-10-08, filas 5, 7, 8 y 9; del 2026-10-09; y del 2026-10-12) fijan cuatro cosas distintas:

- el **tamaño**: obligatorio, precio absoluto o relativo, escala el consumo;
- la **variante**: con diferencia de precio opcional y consumo propio;
- la **guarnición**: obligatoria, nunca con recargo, compartida;
- el **adicional**: con recargo, en línea aparte, con tope por producto y por opción, IVA del producto, fuera del prorrateo de la promo y sin descuento de cliente.

Por defecto un producto no admite nada. Hay una lista de permitidos por producto, y una opción se puede apagar por sucursal. Los ítems agrupados y las promos con cupos conviven y no se tocan. Motor2 es multirrubro, así que el modelo se contrasta con una habitación doble con desayuno y con un masaje de 60 minutos con aceite premium, sin vocabulario de cocina en los nombres.

Las piezas puras ya existen desde GO-0b (`src/core/opciones/`: las listas cerradas, la composición exacta del precio, la huella y la validación de lo elegido, más `src/core/pos/clave-de-linea-con-opciones.ts` y `src/core/movimientos/consumo-de-linea-configurada.ts`) y no tenían dónde guardar nada. La «línea» de una venta vive en dos lugares: `CuentaItem` y la `Operacion` VENTA agrupada por `claveDeLineaDeVenta`; M2 no reservó la línea padre.

## Decisión

1. **Una sola estructura con un tipo que fija las reglas.** `GrupoDeOpciones` (`tipo` MEDIDA, VARIANTE, INCLUIDA o ADICIONAL; cantidad mínima y máxima) y `OpcionDeGrupo`, reutilizables en toda la empresa. El tipo es inmutable (la app no tiene UPDATE de esa columna). Una MEDIDA elige exactamente una; una INCLUIDA exige mínimo 1; un grupo tiene a lo sumo una opción «ninguna».
2. **Lo que la opción hace se versiona y solo se agrega.** `VersionDeOpcion` (la diferencia de precio y el factor de escala) y `ConsumoDeOpcion` (SUMA o REEMPLAZA, con `escalaConLaMedida`). La vigente es la de `numero` mayor, derivada (`DISTINCT ON`), sin flag ni UPDATE; dos versiones a la vez las arbitra el único `(opcionId, numero)`: gana una, la otra recibe 23505.
3. **La diferencia de precio es un monto fijo O un porcentaje**, nunca los dos: `tipoDeDiferencia` (`MONTO` o `PORCENTAJE`) con `diferenciaPrecio` `DECIMAL(14,2)` o `porcentaje` `DECIMAL(7,4)` (mayor que -100 y hasta 999,9999), uno solo cargado (CHECK). El porcentaje es de la diferencia de lista; el espejo que la pantalla muestre es de solo lectura.
4. **Lista de permitidos (fila ausente = no).** `ProductoAdmiteGrupo` (orden, mínimo y máximo por producto, modo de precio de la medida) y `ProductoAdmiteOpcion` (tope, precio absoluto o diferencia por producto). Se editan en el lugar con control optimista (`version`, que aplica la aplicación; la base garantiza `version >= 1`) y auditoría del antes y el después.
5. **Sucursal.**
   - `PrecioLocalDeOpcion` (`PROPIA`): la grilla del modo absoluto. ADR-009 familia `override`: sin fila habilitada rige el precio de la empresa. Se lee en un solo lugar (`src/server/lecturas/catalogo/precio-local.ts`, que ya decide el precio local de los productos) y la lectura exige además que el producto admita la opción.
   - `OpcionApagadaEnSucursal` (`PROPIA`): ADR-009 familia `optout`: **sin fila = prendida**; solo una fila con `apagada = true` la apaga (`src/core/opciones/validar-opciones-elegidas.ts`).
6. **Línea única para lo que va dentro del precio.** Medida, variante e incluida van dentro del precio del producto (una `CuentaItem`, una `Operacion`) y se identifican con una `huellaOpciones` (SHA-256 hexadecimal de 64 caracteres, CHECK) que entra en la clave de agrupación.
7. **El adicional es otra línea, respaldada por un producto ancla.**
   - `CuentaItem.lineaPadreId` y `Operacion.operacionPadreId` lo unen a su padre.
   - Nunca lleva promo, ni precio de carta (sin descuento de producto), ni huella, y nunca vale $0 (CHECK `CuentaItem_adicional_chk`; una línea en $0 se lee como «venta vieja sin precio» en el reporte Período).
   - Su consumo se declara directo sobre la opción con `ConsumoDeOpcion` (decisión 1 del dueño del 2026-10-12: como una receta, con materias primas). Lo que sigue haciendo falta es un **producto ancla**: la fila VENTA exige `productoId` y sin él el producto base contaría doble. El ancla es `OpcionDeGrupo.productoId`, **único por empresa** (un producto respalda a una sola opción) y no tiene filas de disponibilidad, así que queda **oculto por la semántica «sin fila = no disponible»** (ADR-009, familia `optin`).
   - Su alícuota de IVA se deriva de la del producto padre (`src/core/fiscal/alicuota-de-linea-de-venta.ts`).
8. **Foto.** `OpcionElegidaEnLinea` (`HEREDADA` de `CuentaItem`): el tipo y el nombre del grupo, el nombre de la opción, la cantidad, el modo de precio, la diferencia usada (tipo y porcentaje), el importe unitario `DECIMAL(14,2)`, el factor de escala y la versión. Solo se agrega; se borra únicamente con el borrador de su línea (`ON DELETE CASCADE`, que corre como dueño). Editar después la versión, el precio de lista o un nombre no cambia lo vendido. Anular es una fila espejo, como siempre.
9. **Consumo.** Una función pura transforma la receta efectiva de la base (escala, reemplaza, suma) en los mismos pedidos que hoy recibe el libro. El Kardex, el reparto, el arrastre de redondeo y los sustitutos no cambian. El costo de la línea configurada sale de sus consumos.
10. **Seguridad.**
    - Las nueve tablas son `POR_EMPRESA` con claves foráneas compuestas `(empresaId, x)` de dos columnas y RLS `aislamiento_empresa` sin FORCE.
    - Alcance de sucursal: `DE_EMPRESA` las seis del catálogo; `PROPIA` la grilla y el apagado; `HEREDADA` de `CuentaItem` la foto. Las cuatro políticas de sucursal van en migraciones propias que son la salida exacta del generador.
    - `motor2_app` solo agrega en versiones, consumos y foto; UPDATE por columna en el resto (nunca el tipo, el grupo, el ancla ni «ninguna»); nunca DELETE; `motor2_plataforma`, nada.
    - Claves `opciones_definir` y `producto_opciones_admitidas` (de empresa, piso administrador, clase A) y `opcion_apagar_en_sucursal` (de sucursal, piso operario, **clase O**, delegable por el administrador al encargado del turno), las tres con semilla `admin`. Quedan en la base y **fuera de `ACCIONES` hasta GO-2** (migración de datos GO-1a, como las de gastos y centros de costos); la grilla va con `precio_local`.
11. **Carta pública.** Solo con la ampliación de la lista cerrada que el dueño apruebe; la clave nueva sería `grupos` (la clave `opciones` ya la usan los ítems agrupados). No se toca.

### Las listas cerradas son TEXT + CHECK, no enums

Tipo de grupo, efecto de consumo, modo de precio de la medida y tipo de diferencia son listas cerradas guardadas como `TEXT` con un CHECK. Agregar o quitar un valor es cambiar un CHECK (reversible); un `ALTER TYPE` de un enum de Postgres no se deshace, y el `down.sql` necesitaría un `DROP TYPE`. Es el precedente de M4.1. El tipo para TypeScript sale de `src/core/opciones/tipos.ts` y una prueba de paridad (`test/persistencia/migracion-grupos-de-opciones.test.ts`) compara cada lista, los topes (10 de cantidad, 10 de factor, 0,01 de importe) y los bordes del porcentaje (-100 se rechaza, 1000 desborda) con la base. Los enums de Prisma (como `CanalDeVenta`) quedan descartados.

### Dinero

Todo importe es `DECIMAL` exacto con escala explícita (`numeric(14,2)`, el porcentaje `(7,4)`, el factor `(8,4)`), nunca float. **La base redondea sin avisar**: `numeric(14,2)` guarda 0,005 como 0,01 en vez de rechazarlo. Redondea igual que `core/moneda` (mitad lejos del cero, como `round(v::numeric, 2)`), pero el único redondeo válido es el del núcleo, que se hace antes de escribir; la base no lo reemplaza (`test/persistencia/opciones-dinero.test.ts`).

### Los tres disparadores y por qué no claves foráneas de tres columnas

Son un apartamiento deliberado de la regla de ADR-029 §10 y ADR-031 («sin disparadores»). Esa regla evita los disparadores que **suman filas** (que Σ de las líneas sea el total), difíciles de probar y de bajar. Estos tres no suman nada: comparan UNA fila contra otra tabla o contra su estado anterior, y tienen precedente (la recepción de la factura de proveedor, M3b, y `InvitacionSucursal`, E8). Son `SECURITY INVOKER` (alcanzan también al dueño) y responden `23514` con el nombre de la restricción:

- **`CuentaItem_opciones_chk`** (`BEFORE INSERT OR UPDATE OF "huellaOpciones", "lineaPadreId", "cuentaId"`): la huella y el padre no cambian nunca; una línea que es adicional, o que tiene adicionales, no se mueve de cuenta; un adicional va con un padre que existe, se ve, es de la misma cuenta y no es adicional ni espejo (un solo nivel); el espejo repite la huella y el padre del original. Una línea sin padre y sin `anulaAItemId` (todas las de hoy) sale por el **camino corto, sin leer nada**, y el `OF` hace que los `UPDATE` de `numeroEnvio` y `operacionId` de hoy no lo disparen. Cambiar `cuentaId` solo se frena cuando la fila es adicional o tiene adicionales, para que una línea suelta movida a otra sucursal siga respondiendo 42501 por la RLS, como hoy.
- **`OpcionElegidaEnLinea_coherente_chk`** (`BEFORE INSERT`): la opción es del grupo y el tipo es el del grupo; la versión es de esa opción; la línea existe, se ve y no es un espejo; un ADICIONAL va en una línea con padre y con el producto ancla de la opción; las demás, en una línea sin padre y con huella.
- **`Operacion_padre_inmutable_chk`** (`BEFORE UPDATE OF "operacionPadreId"`): el padre de una operación no cambia nunca.

Una clave foránea de tres columnas no alcanza: la regla «el tipo de la foto es el del grupo» compara contra otra tabla, y «la foto va en la línea correcta» depende del estado de otra fila. Que la operación hija sea de la misma sucursal y de la misma venta que el padre lo controla GO-2, igual que `ventaId` en M2.

### Un detalle que costó un error: el NULL en un CHECK

Un CHECK que da NULL **pasa**. Con el tipo de diferencia NULL, `tipo = 'MONTO'` da NULL y un monto sin tipo se colaba en `ProductoAdmiteOpcion` y un adicional sin tipo en `OpcionElegidaEnLinea`. Todos los CHECK que comparan una columna nulable usan `IS NOT DISTINCT FROM` o `IS DISTINCT FROM`, y cada uno tiene una prueba con el valor NULL y una mutación que la pone en rojo.

### Las seis migraciones

| # | Migración | Qué agrega | Al bajar |
|---|---|---|---|
| 1 | `20261020100000_go1a_permisos_de_opciones` | Las tres claves de permiso y la fila del `admin` de cada empresa (datos) | Aborta si la configuración no es la semilla pura |
| 2 | `20261020110000_go1b_grupos_y_opciones` | Las seis tablas del catálogo (de empresa) | Aborta si hay filas |
| 3 | `20261020120000_go1c_opciones_por_sucursal` | `PrecioLocalDeOpcion` y `OpcionApagadaEnSucursal` | Aborta si hay filas |
| 4 | `20261020121000_go1c_rls_sucursal_opciones_por_sucursal` | Las 8 políticas de sucursal de esas dos | Pasa (regresión de seguridad, no de datos) |
| 5 | `20261020130000_go1d_linea_con_opciones` | Las tres columnas nuevas de `CuentaItem` y `Operacion`, `OpcionElegidaEnLinea` y los tres disparadores | Aborta si hay una foto, una línea con huella o con padre, o una operación con padre |
| 6 | `20261020131000_go1d_rls_sucursal_opcion_elegida` | Las 4 políticas de sucursal de la foto | Pasa |

Las políticas van en pares con sus tablas porque clasificar una tabla con alcance sin sus políticas rompe el guardián B7 y `rls-empresa`. Solo la quinta toca tablas con datos (`CuentaItem` y `Operacion`): todo nuevo es NULABLE, sin relleno y sin reescribir la tabla, pero toma `ACCESS EXCLUSIVE` hasta el COMMIT (ver la guarda de volumen en `docs/deploy-con-migraciones.md`). El código de hoy sigue andando sobre la base nueva: la única pieza que corre con él es `CuentaItem_opciones_chk` por el camino corto. Con GO-1c-rls o GO-1d-rls arriba la reversa de B1 falla (una política en uso impide borrar las funciones de alcance); con la foto o las tablas de la sucursal arriba la de GO-1b falla con 2BP01.

## Supuestos a confirmar por el dueño

Cuatro decisiones de negocio que el diseño no resolvía. **GO-1 asumió la recomendación de cada una** (están escritas así en el modelo); si el dueño decide otra cosa, cambia lo indicado:

1. **Una versión nueva de una opción rige desde que se carga** (`creadoEn`, en UTC, que se muestra en la zona de la empresa): la vigente es la de número mayor, sin columna de fecha, como `RecetaVersion`. *Alternativa:* una fecha de vigencia (`rigeDesde`, «desde el lunes» en hora argentina) y la vigente pasa a ser la mayor con `rigeDesde <= now()`.
2. **`ProductoAdmiteOpcion` y `PrecioLocalDeOpcion` se actualizan en el lugar, con auditoría del antes y el después.** Son precios de lista (configuración), como hoy `Producto.precioVenta` y `PrecioLocalProducto`; lo cobrado queda congelado en la foto, que no tiene UPDATE, y la diferencia de la versión solo se agrega. *Alternativa:* versionar también esas dos tablas (dos tablas más que solo se agregan, con su vigente).
3. **El adicional es solo monto fijo** (sin porcentaje), como ya aplica `componerPrecioDeLinea`; la foto lo repite con el CHECK `OpcionElegidaEnLinea_adicional_chk`. *Alternativa:* permitir porcentaje en el adicional: se saca ese CHECK y cambia el núcleo.
4. **No se da de alta la clave `reporte_opciones_vendidas`**: entra con el reporte, porque una clave sin consumidor queda reservada sin plazo. *Alternativa:* sumarla a GO-1a como cuarta clave (sucursal, piso administrador, semilla `admin`).

## GO-2a: administración del catálogo de opciones (2026-10-13, sin pantallas)

**Estado: hecho en la rama `go2a-admin-opciones`, pendiente de CI y de revisión.** Sin migración ni cambio de esquema: alcanzan los únicos, los CHECK y los GRANT de GO-1, SERIALIZABLE y `RegistroAuditoria`. Sin pantallas (GO-2b): ninguna Server Action nueva la importa un cliente, así que Next no las publica, y cada una lleva igual su guarda.

- **Claves.** `opciones_definir` y `producto_opciones_admitidas` (empresa, piso administrador, clase A) y `opcion_apagar_en_sucursal` (sucursal, piso operario, clase O) entran a `ACCIONES`, con la descripción idéntica a la de GO-1a, y salen de las reservadas en la base. La grilla por sucursal va con `precio_local` (su gate exige la capacidad).
- **Reglas puras** (`src/core/opciones/validar-configuracion.ts`): grupo, opción nueva, versión, consumos, admisión por producto, control de precio de lista (con `componerPrecioDeLinea`, que se usa adentro del dominio y no hizo falta exportar), igualdad de versiones y el antes y el después por columna.
- **Casos de uso** (`src/server/actions/catalogo/casos-de-uso/`): crear y editar un grupo; crear y editar una opción; agregar una versión; fijar lo que admite un producto de un grupo; apagar o prender una opción en la sucursal activa; fijar el precio de una opción en la sucursal activa. Todos en `conTransaccionSerializable` (con `tambienChoqueDeUnico`), leyendo adentro lo que deciden, con versión optimista donde hay `version` (`updateMany` con la versión esperada en el `where`: defensa doble con la relectura), y con su auditoría por columna con el mismo `tx`.
- **Lecturas** (`src/server/lecturas/catalogo/opciones-de-venta.ts`): el catálogo con la versión VIGENTE derivada (número mayor), un grupo con su historial, lo que admite un producto y lo apagado en una sucursal. La grilla se lee en `src/server/lecturas/catalogo/precio-local-de-opciones.ts` (el único lector de `PrecioLocalDeOpcion`).

### Supuestos de GO-2a (escritos así en el código; si el dueño decide otra cosa, cambia lo indicado)

1. **D-1, el producto ancla del ADICIONAL: variante A′.** Lo crea el caso de uso en la MISMA transacción que la opción: PV, con el nombre de la opción, código `PV_<6 del azar>`, la unidad de stock que elige la pantalla, factor 1, sin receta, sin categoría y **sin filas de disponibilidad** (oculto por «sin fila = no disponible»). Si ya hay un producto con ese nombre (sin distinguir mayúsculas), `NOMBRE_DE_ANCLA_REPETIDO`. El alta se audita como `Producto` (alta, unidad y factor). Blindaje: el ancla no puede tener receta (`ES_ANCLA_DE_ADICIONAL` en `guardar-version-de-receta`), no se pone a la venta suelta (`actualizar-disponibilidad-producto`; apagarla sí) y no admite opciones. *Alternativa B:* elegir un PV existente sin receta ni disponibilidad.
2. **D-2, la opción «ninguna»:** solo en una VARIANTE o una INCLUIDA (nunca en una MEDIDA ni en un ADICIONAL), a lo sumo una por grupo, con una versión en MONTO 0, sin factor y sin consumos.
3. **D-3, los consumos exigen el módulo Recetas** (`denegacionDeModuloDeAccion("guardar_receta", …)`; como Producción requiere Recetas, apagar Recetas exige apagar las dos). Sin consumos, la opción se guarda igual.
4. **D-4, desactivar un grupo o una opción que deja a un producto sin poder venderse no se bloquea:** el mensaje avisa a cuántos productos afecta.
5. **El mismo pedido repetido es idempotente aunque la versión vista ya sea vieja:** si la fila ya está como se pide (un doble clic que llegó después de que el primero confirmó: Next despacha las Server Actions de un cliente de a una), éxito sin escribir ni auditar. Con la versión vieja y OTRO cambio, `VERSION_DESACTUALIZADA`. Una versión nueva con el mismo contenido que la vigente no se agrega.
6. **Consumos:** el insumo y el reemplazado son MATERIAS PRIMAS de la empresa, y el consumo se guarda en la unidad de stock del insumo (U7, como la receta: la unidad no viaja desde el cliente). El orden es la posición en la lista. Tope: 50 líneas por versión.
7. **Admisión:** las opciones del grupo que el comando no trae quedan como están (y cuentan para las reglas); quitar es `activo = false`. Al admitir o reactivar, el grupo y la opción tienen que estar prendidos para la empresa. El control de precio de lista (cada opción sola sobre el precio de venta) se hace solo si el producto tiene precio de venta: uno en 0 se cobra con el de cada sucursal y la venta igual falla cerrado. El aviso S3 (un REEMPLAZA cuyo insumo no está en la receta central) se da solo si el producto ya tiene receta central.
8. **Grilla:** solo para una MEDIDA en ABSOLUTO admitida (fila del producto y de su grupo activas). La baja es `habilitado = false` conservando el último precio, y se permite aunque la opción ya no esté admitida. Como la tabla no tiene `version`, la edición compara el precio y el `habilitado` que vio la pantalla (`PRECIO_DESACTUALIZADO`).
9. **El lector de la grilla vive aparte** (`precio-local-de-opciones.ts`, no `precio-local.ts`): la carta pública alcanza `precio-local.ts` y su guardián de lista cerrada junta los campos de todo archivo que alcanza.

## Lo que GO-2 hereda (obligaciones escritas)

- **`enlazarItemsConOperaciones`** (`src/server/persistencia/pos/cerrar-cuenta.ts`) enlaza cada ítem con su operación por producto, precio, promo y precio de carta, **sin huella ni padre**. Hoy no rompe nada porque todo está en NULL; GO-2 tiene que cambiarlo, o dos cafés con distinta configuración se enlazarían a la misma operación.
- **El producto ancla no tiene disponibilidad por sucursal** y `src/server/actions/movimientos/casos-de-uso/registrar-venta-en-tx.ts` rechaza un producto no disponible en la sucursal: GO-2 tiene que dejar pasar el ancla.
- La lectura agrupada al agregar ítems (declarada en el conteo de consultas), el cierre con la huella en la clave de agrupación, el ticket y la comanda, anular un producto arrastrando a sus adicionales, la auditoría y el control de que el padre de una operación sea de la misma sucursal y de la misma venta. (Pasar las tres claves a `ACCIONES` con su guarda ya lo hizo GO-2a.)
- Los reportes que reconstruyen el costo con la receta vigente tienen que leer los consumos de las líneas configuradas; los reportes por producto ven al adicional como su producto ancla.

## GO-2b: la venta con opciones (reglas v1)

Lo que GO-2b escribió para cumplir «lo que GO-2 hereda», sin migraciones, sin claves de permiso nuevas (rigen `pos_tomar_pedido`, `pos_enviar_a_cocina`, `pos_anular_item`, `pos_cerrar_cuenta` y `anular_venta`; el descuento de producto con el módulo Carta; la grilla con `precio_local`) y sin pantallas. Todo es ADITIVO: un producto sin opciones se vende bit a bit igual (los goldens congelados no se regeneraron; la venta con opciones tiene su caracterización propia, `test/pos/caracterizacion/venta-con-opciones.golden.txt`).

- **Al pedir** (`src/server/actions/pos/casos-de-uso/agregar-items.ts`): UNA lectura agrupada de lo que admite cada producto del pedido (`src/server/lecturas/opciones/opciones-para-vender.ts`, el único lugar que elige la versión vigente: la de número mayor, `versionVigente`) y la grilla de la sucursal solo para una MEDIDA en ABSOLUTO elegida (`src/server/lecturas/catalogo/precio-local-de-opciones.ts`). Lo elegido pasa por `armarLineaConfigurada` (`src/core/pos/linea-configurada.ts`): validación, precio por prioridad (la diferencia del producto le gana a la de la versión; en la MEDIDA en ABSOLUTO la grilla de la sucursal le gana al precio absoluto del producto; `modoPrecio` NULL hace fallar la venta), composición exacta, descuento de producto sobre la lista compuesta, huella y consumo con base vacía. El cliente nunca manda precio y SÍ manda la versión que vio (si cambió: `OPCION_CAMBIO`). Códigos nuevos: `OPCIONES_INVALIDAS`, `OPCION_CAMBIO`, `PROMO_CON_OPCIONES`.
- **La grilla vive al lado de `precio-local.ts`, no adentro** (apartamiento de la decisión 5, solo de archivo; el mismo criterio que tomó GO-2a): la carta pública alcanza `src/server/lecturas/catalogo/precio-local.ts` y su lista cerrada de campos (`test/arquitectura/carta-publica-lista-cerrada.test.ts`) no incluye la grilla de las opciones. La venta usa el lector ÚNICO de GO-2a (`preciosLocalesDeOpcionVigentes`, uno por producto, con la capacidad leída una sola vez por pedido); lo fija `test/arquitectura/precio-local-en-un-solo-lugar.test.ts`.
- **«Misma venta»** = la misma llamada a `registrarVentaEnTx` (el mismo cierre), con la sucursal de la sesión: la operación del adicional nace con `operacionPadreId` (el disparador no deja ponerlo después) y el padre va antes en el mismo lote.
- **Promos (v1):** los componentes no llevan opciones. Un componente con un grupo obligatorio rechaza la promo (`PROMO_CON_OPCIONES`); con grupos opcionales entra sin opciones.
- **Mostrador y cierre sin selector (fila O.430):** un producto con un grupo obligatorio no se vende sin elegirlo en ninguna vía. La barrera final está en `armarLinea` (`src/server/actions/movimientos/casos-de-uso/registrar-venta-en-tx.ts`): toda línea SIN configurar de un producto con un grupo de mínimo mayor que 0 (o apagado: falla cerrado) se rechaza con `PRODUCTO_REQUIERE_OPCIONES` y «cobralo desde las mesas/POS», con la misma lectura (una por lote) y la misma regla que el POS (`src/core/movimientos/opciones-obligatorias.ts`); la venta de mostrador, que no tiene selector, nunca manda `configurada`. Guardián: `test/arquitectura/venta-exige-opciones-obligatorias.test.ts`.
- **La opción «ninguna»:** en INCLUIDA o VARIANTE va a la foto con importe 0 y sin consumo (aunque su versión tenga diferencia); en ADICIONAL cuenta para el mínimo y no genera línea ni foto; en MEDIDA es una configuración inválida.
- **El ancla:** solo un PV que no se produce respalda un adicional (si no, la opción queda sin ancla y no se puede pedir); pedido suelto, `PRODUCTO_INVALIDO` («se vende solo como adicional»); al vender saltea la disponibilidad SOLO si es el `productoId` de la opción leído de la base. Un PV que se produce por lote no se vende con opciones (v1: rechazo explícito, nunca un consumo perdido).
- **Agrupación:** la huella entra en la clave (`lineasDeVenta`, `src/core/pos/cuenta.ts`); cada adicional va justo después de su producto y lleva la versión de su opción (dos versiones al mismo precio no se juntan: consumen distinto); un padre que solo tiene adicionales no tiene huella y se junta con los de su producto sin opciones. El enlace ítem → operación (`src/server/persistencia/pos/cerrar-cuenta.ts`) va por id para lo configurado y por la clave de siempre con `huellaOpciones` y `lineaPadreId` en NULL para lo demás.
- **Descuento de cliente:** al producto (con la regla de siempre: rige el mayor); nunca al adicional (ni en el cierre, ni en el ticket, ni en el total de la mesa).
- **Anulación:** un adicional no se anula solo (`ES_ADICIONAL`, en el POS y en Trazabilidad); anular el producto lo arrastra (k × lo anulado, validado entero antes de escribir, un espejo por línea con una auditoría cada uno). La venta del producto arrastra a sus operaciones hijas vigentes. Quitar un adicional sin enviar sí se puede; quitar el producto se lleva sus adicionales y las fotos.
- **Consumo y costo:** el consumo sale de la receta efectiva de la base transformada por las opciones de la FOTO (la versión congelada, nunca la vigente), una fila por insumo; cada insumo de una opción es MP, disponible y en la unidad de stock de la opción. El costo congelado de una línea configurada es la suma de sus pedidos por el costo de cada insumo (el mismo resolutor de `src/core/reportes/costos.ts`), sobre la cantidad vendida; sin el costo de algún insumo, `null`. **A confirmar con el dueño:** los pedidos llevan el rendimiento efectivo de la sucursal (con una configuración neutra el costo da igual al del producto base: lo fija `test/movimientos/venta-configurada.test.ts`).
- **Reportes:** sin costo congelado, una línea configurada se reconstruye con los CONSUMO de su propia operación (`src/server/consultas/reportes/costo-historico.ts`), nunca con la receta base. El rendimiento de recetas saca lo vendido con opciones de lo vendido del plato y resta su consumo de lo que entró.
- **IVA (fuera de alcance):** nada fiscal; la alícuota del adicional se deriva del producto padre por `operacionPadreId` (probado con `alicuotaDeLineaDeVenta`).
- **Pendientes (fuera de GO-2b):** que el ancla no aparezca como «PV sin receta» en los reportes de catálogo (va con GO-2a); el margen NOMINAL del Período sigue costeando por la receta del producto (el real ya usa los consumos); en el rendimiento de recetas, el consumo de un adicional colgado de un producto SIN receta no se descuenta del pool de su insumo.

## GO-2d: las pantallas (2026-10-14)

**Estado: hecho en la rama `go2d-pantallas-opciones`, pendiente de CI y de revisión.** Sin migración ni cambio de esquema y sin claves de permiso nuevas (rigen `opciones_definir`, `producto_opciones_admitidas`, `opcion_apagar_en_sucursal`, `precio_local` y las del POS). Lo que el dueño decidió para esta parte (2026-10-13) y cómo quedó:

1. **La carta pública muestra las opciones** (ampliación de la lista cerrada aprobada): «desde $ X», los tamaños con su precio final, la guarnición incluida y los adicionales con «+ $». Se calcula en el SERVIDOR con la regla de la venta (`resumenDePrecios`, `src/core/pos/precio-de-configuracion.ts`), se lee con una lectura propia campo por campo (`src/server/lecturas/carta/opciones.ts`: nunca el factor de escala, los consumos ni el producto que respalda un adicional) y sale por la proyección campo por campo (`src/core/carta/carta-publica.ts`). Guardianes ampliados con motivo: `test/arquitectura/carta-publica-lista-cerrada.test.ts`, `test/carta/salida-publica-inventariada.test.ts` (canarios de la alícuota, el factor, el consumo y el código del producto de respaldo) y `test/carta/carta-publica-sin-ids.test.tsx`; la caché sigue por empresa y las acciones de opciones la invalidan (`test/carta/revalida-al-cambiar-el-catalogo.test.ts`).
2. **Lo agotado no se muestra en la carta**, y un producto con un grupo obligatorio sin nada para elegir tampoco sale.
3. **«Agotada» dura hasta que alguien la prende** (`/movimientos/opciones-agotadas`, con «Deshacer»).
4. **El stock teórico avisa, nunca bloquea**: «Opciones agotadas», la carta del admin y el diálogo del POS dicen «el sistema dice 0» con el enlace al conteo físico; vender sigue permitido. El saldo lo lee `saldosTeoricosEnSucursal` (`src/server/lecturas/movimientos/saldos.ts`), un agregado por sucursal sin N+1.
5. **«Sin receta no se vende»** es otra tarea: estas pantallas no lo deciden ni lo suponen.

### Supuestos de GO-2d (escritos así en el código; si el dueño decide otra cosa, cambia lo indicado)

1. **«Otro igual» abre «Elegir opciones» con la misma elección** (en «Por agregar», en «Sin enviar» y en cada envío), en vez de copiar la línea directo: así el mozo ve el precio y lo agotado de HOY antes de confirmar. El «+» de «Por agregar» suma una igual sin abrir nada.
2. **«Lo más pedido acá»** cuenta las líneas PEDIDAS en las mesas de la sucursal (no solo las cobradas) en los últimos 30 días contando hoy, con los días cortados en la zona de la empresa; agrupa por huella y junta la misma elección pedida con dos versiones de precio; no cuenta adicionales (no entran en la huella) y no ofrece una configuración con algo que hoy no se puede elegir (`src/server/lecturas/pos/mas-pedidas.ts`).
3. **En la carta**, el precio de un producto con opciones es lo más barato con lo que se puede pedir; el tachado, ese mismo sin el descuento de producto (el descuento va sobre el tamaño, nunca sobre un recargo); «desde» solo si el precio cambia según lo elegido; un recargo en 0 no se escribe y la «ninguna» de un adicional no se muestra. El tope de cada adicional NO se muestra (GO-0 §4 lo pedía aprobar aparte). Solo la carta pública lee las opciones: el POS arma su diálogo y la vista del admin sigue como antes.
4. **La carta lee también `tipoDeDiferencia` y `porcentaje`** (de la versión y del producto), que GO-0 §4 no listaba porque el recargo en % llegó con GO-2a: sin ellos un recargo en % se mostraría mal.
5. **El lector de la grilla perdió `server-only`** (como `src/server/lecturas/catalogo/precio-local.ts`): la carta pública lo alcanza y a ella la carga una fixture de Playwright (`test/e2e/fixtures/carta-menu.ts`).
6. **Ordenar las opciones de un grupo** es una acción nueva y atómica (`reordenarOpcionesDeGrupo`, `src/server/actions/catalogo/casos-de-uso/reordenar-opciones-de-grupo.ts`): una sola transacción, con la versión de cada opción y una auditoría por opción movida; la «ninguna» nunca va primera.
7. **Los mensajes no dicen «versión»**: «cambio de precio», «otra persona lo guardó antes. Recargá la pantalla» (con el botón «Recargar»).
8. **«Precios por tamaño en esta sucursal»** muestra también el precio cargado de un producto que ya no está disponible acá, para poder sacarlo.
9. **En una promo** (v1) un producto con un grupo obligatorio se ve con «Con tamaño: pedilo suelto» y sin «+», como ya exigía el servidor.

### CARTA-B y CARTA-C: la carta pública muestra lo que cambia el precio y, aparte, lo que no cuesta nada (2026-10-14; decisión del dueño, variante B «lista clásica» y pastillas)

Cambia la PRESENTACIÓN de la carta pública, no sus datos de origen ni su seguridad: la lectura (`src/server/lecturas/carta/opciones.ts`) lee los mismos campos y la carta sigue cacheada por ISR. Reemplaza los puntos 1 y 3 de arriba en lo que dicen del «desde» y del desplegable.

1. **Qué se muestra de cada grupo.** Lo decide el SERVIDOR al armar la salida (`src/core/carta/opciones-en-carta.ts`), así que el navegador nunca recibe lo que no se dibuja. Un grupo de **tamaños con precios finales distintos** va como lista clásica; en **todos los demás grupos**, las opciones disponibles **sin costo** (diferencia 0: «Solo», «Flat white», «Cortado»; guarnición; punto de cocción) van como **pastillas bajo el nombre del grupo**, y las que suman o restan, a la línea «Adicionales». Un grupo con una sola opción sin costo no muestra pastillas (no hay nada que elegir); la «ninguna» («Sin guarnición») nunca es una pastilla; lo agotado o apagado y un grupo sin opciones disponibles no salen. (CARTA-B ocultaba las opciones sin costo y el cliente no se enteraba de que existían: por eso CARTA-C.)
2. **Los tamaños (precios finales distintos) van como lista clásica con puntitos**, un renglón por tamaño, siempre a la vista y sin desplegable («Chico ........ $2.500»); el producto ya no dice «desde» y el renglón del nombre va sin precio (con descuento de producto, solo el «−10 %»). Los adicionales y las variantes con «+ $» van en una línea «Adicionales: Con leche +$400 · Medialuna +$600 · Shot +$500»; un producto sin tamaños pero con extras conserva su precio base a la derecha del nombre. Un grupo de tamaños con TODOS los precios iguales cuenta como un grupo sin costo: sus tamaños salen como pastillas.
3. **Un grupo obligatorio ya está en el precio** con su opción más barata (`desde`): sus recargos se cuentan sobre esa («Pollo +$500 / Carne +$800» sale como «Carne +$300»), para no sumar dos veces lo que el precio ya incluye; y las opciones al precio más barato son las «sin costo» de ese grupo.
4. **La salida pública suma UN campo, solo textos.** Siguen sin salir `precioDesde` y, de cada grupo, `obligatorio` y `maximo`; entra `items[].opcionesSinCosto: { grupo: string; opciones: string[] }[]` (nombre del grupo y de sus opciones sin costo, en orden), sin ids, sin precios y sin la clave si no hay nada. Era imprescindible: lo que se descarta en el servidor no puede dibujarse. Los guardianes (`CLAVES_DE_LA_CARTA` en `salida-publica-inventariada`, la proyección campo por campo de `proyectarCartaPublica`, `carta-publica-sin-ids`, `carta-publica-lista-cerrada` —la lectura no cambia— y `carta-publica-cacheable`) cierran la lista con esa clave declarada.
5. **Legibilidad** (pisos, no topes): en un producto con opciones, nombre y precio de 19 px como mínimo, tamaños de 17 px, la línea «Adicionales» de 16 px, la descripción de 14 px, **la etiqueta del grupo de las pastillas de 14,5 px y las pastillas de 15 px**; el tema de la sucursal manda si pide más en lo que ya se medía con `max(piso, tema)`. Los colores salen de las variables del tema (`--carta-ink`, `--carta-ink-soft`). Las pastillas no son botones: no se eligen en la carta (las elige el mozo en el POS), llevan una lista con el nombre del grupo para el lector de pantalla y envuelven a la línea siguiente, sin desborde horizontal.
6. **Límite conocido y declarado:** los productos sin opciones siguen con el tamaño de letra del tema (por defecto 14 px para el nombre y el precio, 11 px para la descripción, los valores congelados de `lecturas-tramo-a.golden.json`): subirlos para toda la carta es una decisión aparte, porque cambia el tema por defecto de todas las sucursales. Y el recargo de una variante se muestra en pesos de lista: con un descuento de producto vigente, lo que realmente suma es algo menos (nadie paga más de lo que ve).

### Pendientes que GO-2d encontró (fuera de su alcance)

- **La venta de mostrador** (`/movimientos/venta`) no rechaza hoy un producto con un grupo obligatorio: lo vende al precio base, sin opciones. El plan decía que ya lo rechazaba. Va con el caso de uso de la venta (`src/server/actions/movimientos/casos-de-uso/registrar-venta.ts`), que es de otra tarea en curso.
- El aviso de «Enviar a cocina» cuenta los adicionales como ítems («2 ítems» para un café con un adicional).
- Un PV con opciones dentro de un ítem agrupado de la carta se muestra como opción del agrupado, sin sus grupos.
- **La prueba del dueño con el flujo del café** (alta del grupo, admisión, pedido en la mesa, comanda, ticket y carta) queda pendiente.

## OPCIONES-LIMPIEZA: archivar, restaurar y quitar sin miedo (2026-10-14; decisión del dueño)

Los grupos, las opciones y su vínculo con cada producto NO generan una venta por sí mismos: componen la venta de un producto. Por eso se gestionan con facilidad (deshacer, archivar,
quitar) y con registro de quién, cuándo y qué, pero sin la rigidez del dinero o del stock. Tres niveles, **sin migraciones ni campos nuevos**:

1. **Quitar de un producto** (`vincularGrupoEnProducto`, `src/server/actions/catalogo/casos-de-uso/vincular-grupo-en-producto.ts`): `ProductoAdmiteGrupo.activo = false`, «llevar al estado»
   (sin la versión de la pantalla, para que el «Deshacer» funcione después del refresco; la versión se lee dentro de la transacción SERIALIZABLE y va en el `where`). Lo que el producto
   admitía de cada opción se conserva tal cual; «Volver a vincular» pasa por el MISMO cuerpo de la admisión (`fijarAdmisionDeGrupoEnTx`), con sus reglas. Clave `producto_opciones_admitidas`
   (la misma columna que el formulario ya cambiaba).
2. **Archivar / restaurar** (`archivarOpciones`, `src/server/actions/catalogo/casos-de-uso/archivar-opciones.ts`): `GrupoDeOpciones.activo` y `OpcionDeGrupo.activa`, de a uno o en lote, TODO O
   NADA, por estado (dos veces no duplica), con una auditoría por elemento y la versión + 1 (una edición abierta en otra pestaña recibe «cambió mientras la editabas»). Lo archivado sale de la
   venta y de la carta por la vía que ya existía (las lecturas de la venta y de la carta filtran esas columnas) y queda en «Archivados» con «Restaurar». Clave `opciones_definir`: archivar es la
   columna que el «Apagar» de esa clave ya cambiaba; no da ningún poder nuevo. «Apagado» en la empresa pasa a llamarse **archivado**; lo que se acaba por un día sigue siendo «agotada» en la
   sucursal (`OpcionApagadaEnSucursal`), que no cambia.
3. **Borrar definitivo**: NO en esta etapa. El rol de la app no tiene `DELETE` sobre ninguna tabla del catálogo de opciones (GO-1b: solo `SELECT`, `INSERT` y `UPDATE` por columna); borrar exige
   una migración con el `GRANT DELETE` y, por la regla del dueño, un permiso más alto que archivar. Queda pendiente de autorización expresa (fila O.492 de `docs/pureza-integracion.md`).

4. **Limpiar** (G2, `/catalogo/opciones/limpiar`, misma clave y exige Editar): propone archivar de una vez lo que no se usa —sin productos disponibles en alguna sucursal, o sin
   ventas en 30, 90 o 180 días en cualquier sucursal— con la regla pura `src/core/opciones/limpieza.ts` y la consulta `src/server/consultas/catalogo/limpieza-de-opciones.ts`, que lee con la
   base de verificación (de las ventas solo sale un sí o no por período). El lote va por `archivarOpciones` (todo o nada) y «Deshacer» lo restaura entero. No hay borrado masivo.

Lo YA VENDIDO no cambia nunca: la foto de la línea (`OpcionElegidaEnLinea`, solo agregar) guarda el nombre, el tipo, la versión y el importe de lo vendido, y las claves foráneas `Restrict`
impiden que desaparezca lo que una línea nombra. La interfaz es la del prototipo aprobado de Mantenimiento: un toque, sin pantalla de confirmación, y el aviso con «Deshacer» abajo
(`src/components/aviso-con-deshacer.tsx`).

## Consecuencias

- Un producto sin opciones se vende igual, bit a bit. Lo cuidan los goldens: cuatro cambiaron solo con columnas nuevas en NULL (`operacionPadreId`, `huellaOpciones`, `lineaPadreId`), verificado con diff y declarado en el guardián de caracterizaciones congeladas.
- Cada configuración tendrá su `Operacion`: «cuántos medianos con leche» saldrá de las fotos, y el margen de la configuración, de sus consumos.
- Nueve tablas nuevas y seis migraciones; ninguna destructiva al bajar con datos (abortan). Los guardianes se tocaron sumando entradas (clasificación, alcance, políticas posteriores, solo-agrega, semántica de «sin fila», claves reservadas, ayudas de test).
- El IVA por línea se fotografía en la emisión fiscal, no acá.

## Alternativas descartadas

| Alternativa | Por qué se descarta |
|---|---|
| Siete productos (o variantes de producto) | Duplica recetas y reportes; es lo que el dueño rechazó |
| Ítem agrupado | Exige el mismo precio y es elegir entre productos distintos |
| Promo con cupos | Es un paquete prorrateado; distorsiona el margen de promos |
| Foto en JSON dentro de `CuentaItem` | Sin integridad ni consultas |
| Recargo como columna en la línea del producto | Contradice la decisión del adicional como línea aparte |
| Adicional sin producto | La fila VENTA exige `productoId`; contaría doble el producto base |
| Una tabla por tipo | Cuatro mecanismos para lo mismo |
| Receta completa por tamaño | El dueño eligió escalar; el vaso se resuelve con REEMPLAZA |
| Copiar la receta de la opción en cada línea vendida | Voluminoso; la versión inmutable ya es la foto |
| Deduplicar las configuraciones en una tabla de valores | Agrega una carrera de upsert sin beneficio en v1 |
| Módulo vendible propio | El «no admite nada» ya es el interruptor |
| Enums de Prisma o de Postgres para las listas cerradas | Agregar un valor es un `ALTER TYPE`, que no se deshace; con TEXT + CHECK es reversible |
| Clave foránea de tres columnas para «misma cuenta» y «tipo del grupo» | No expresa una comparación contra otra tabla ni el estado de otra fila; se usa un disparador |
| Foto de IVA solo en el adicional | Inconsistente con la línea padre |
| Esperar a `PrecioAplicable`, D27 y D31 | Postergados por el dueño; la composición queda en una función pura que podrá absorber después |
