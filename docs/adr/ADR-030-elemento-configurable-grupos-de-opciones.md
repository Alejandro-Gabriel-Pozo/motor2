# ADR-030: Elemento configurable (grupos de opciones de venta)

> Redactado el 2026-10-13 (GO-1). **Estado: propuesto; GO-1 escrito y sin aplicar.** El modelo de datos está en el repositorio (seis migraciones con su `down.sql` y sus pruebas contra Postgres real); NINGÚN caso de uso las escribe todavía (GO-2) y NO están aplicadas a ninguna base real (cada una REQUIERE AUTORIZACIÓN EXPRESA, base por base, con respaldo y ensayo en una rama de Neon). Las pantallas (GO-2) no están diseñadas. Completa ADR-009 (sobrescritura por sucursal), ADR-011/014/015 (módulos), ADR-027 (pisos) y ADR-028 (alcance por sucursal). El 031 (centros de costos) ya existe: este es el 030 que había quedado reservado.

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

## Lo que GO-2 hereda (obligaciones escritas)

- **`enlazarItemsConOperaciones`** (`src/server/persistencia/pos/cerrar-cuenta.ts`) enlaza cada ítem con su operación por producto, precio, promo y precio de carta, **sin huella ni padre**. Hoy no rompe nada porque todo está en NULL; GO-2 tiene que cambiarlo, o dos cafés con distinta configuración se enlazarían a la misma operación.
- **El producto ancla no tiene disponibilidad por sucursal** y `src/server/actions/movimientos/casos-de-uso/registrar-venta-en-tx.ts` rechaza un producto no disponible en la sucursal: GO-2 tiene que dejar pasar el ancla.
- La lectura agrupada al agregar ítems (declarada en el conteo de consultas), el cierre con la huella en la clave de agrupación, el ticket y la comanda, anular un producto arrastrando a sus adicionales, la auditoría, pasar las tres claves a `ACCIONES` con su guarda y el control de que el padre de una operación sea de la misma sucursal y de la misma venta.
- Los reportes que reconstruyen el costo con la receta vigente tienen que leer los consumos de las líneas configuradas; los reportes por producto ven al adicional como su producto ancla.

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
