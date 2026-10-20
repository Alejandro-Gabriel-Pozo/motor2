# ADR-032: GO-3. Precio y receta por combinación, combos y menú del día

> **Fase 3 de la ola «precio y carta» (2026-10-20): GO-3a —el precio por combinación, las tarifas compartidas y la receta propia por combinación (frentes A y B)— se RETIRÓ del código; GO-3d (combos con entradas y menú del día) se conserva.** Lo que sigue es la historia tal como se decidió y construyó; el retiro está en la sección final «Fase 3: retiro de GO-3a».

> **Estado: BASE construida en la rama `go3-base` (esquema, núcleo puro y lectores tolerantes). Las cuatro migraciones están APLICADAS a la base de producción desde el 2026-10-13 (respaldo `respaldo-pre-go3-20261013`, ensayo subir/bajar/subir y verificación por huella; ver `docs/deploy-con-migraciones.md`, sección GO-3); cada base nueva REQUIERE AUTORIZACIÓN EXPRESA.** Los casos de uso, la administración, la venta y las pantallas (F3 a F6 del plan) están CONSTRUIDOS en la rama `go3-tanda2` (sección «GO-3b» al final), sin migraciones nuevas y pendientes de la fusión. Construye sobre GO-1 (`docs/adr/ADR-030-elemento-configurable-grupos-de-opciones.md`, ya aplicado).

## Contexto

Hoy un combo (`PromoCarta` + `PromoCartaCupo` + `PromoCuenta`) solo deja «elegí N de tal sección de la carta». El dueño necesita (1) menús del día con un plato que cambia cada día por sucursal, (2) componentes fijos y listas propias, aunque el producto no esté en la carta, (3) vigencia por días y fechas, y (4) para los productos con opciones de GO-1, precio y receta por COMBINACIÓN de opciones (tarifas compartidas, combinaciones apagadas, el flat white grande con doble shot).

## Decisiones (del dueño, 2026-10-13)

| # | Decisión | Cómo quedó |
|---|---|---|
| D-1 | El plato del día va por FECHA y por SUCURSAL; si no se cargó, el menú no se ofrece (falla cerrado) | `EntradaDelDiaDeCupo` (PROPIA, con sus 4 políticas de sucursal); en el núcleo, un cupo DEL_DIA sin plato de hoy y con mínimo > 0 da `MENU_DEL_DIA_SIN_CARGAR` (`src/core/pos/promo-combo.ts`) |
| D-2 | Todo va al 21 %: un combo NO mezcla alícuotas declaradas distintas; sin declarar es un aviso | `revisarAlicuotasDeCombo` (`src/core/pos/alicuotas-de-combo.ts`): `COMBO_ALICUOTAS_DISTINTAS`. Regla de código, sin esquema: si el contador aprueba mezclar, se quita sin migración |
| D-3 | Precios de combinación y de grupo editados EN EL LUGAR, con versión optimista y auditoría por columna | `version` en `CombinacionDeProducto` y `GrupoDePrecio` (CHECK >= 1); lo cobrado queda en la línea y en la foto `CombinacionEnLinea` |
| D-4 | Grupos de precio (tarifas compartidas) y precio local de combinación o de grupo en v1 | `GrupoDePrecio`, `PrecioLocalDeCombinacion` (una sola tabla, `num_nonnulls = 1`); precedencia en `src/core/opciones/combinaciones.ts` |
| D-5 | El permiso del menú del día es delegable al encargado (operario, clase O) | Clave `promo_menu_del_dia` (sucursal, piso operario, semilla admin) dada de alta por la migración GO-3d; entra a `ACCIONES` con su caso de uso (F3) |
| D-6 | El mozo NO elige opciones dentro del combo en v1 | Un producto con grupo obligatorio solo entra como entrada con CONFIGURACIÓN FIJA del dueño (`EntradaDeCupo.claveConfiguracion` + `OpcionDeEntradaDeCupo`); en un cupo de sección sigue `PROMO_CON_OPCIONES` (GO-2b) |
| D-7 | Vigencia opcional por días de semana y por fechas, sin horario | `PromoCarta.vigenteDesde/vigenteHasta/diasDeSemana`; `promoVigenteEl` (`src/core/carta/vigencia-de-promo.ts`), con «hoy» de la zona de la empresa (`diaDeLaSemana` en `src/core/tiempo/zona-horaria.ts`) |
| D-8 | Todo componente tiene precio de referencia (>= 0,01) | Lo valida el caso de uso al cargar y al vender (`COMPONENTE_SIN_PRECIO_DE_REFERENCIA`, F3/F5): el prorrateo pesa por el precio de lista |
| D-9 | Solo entran productos PV existentes con ORIGEN DE STOCK (receta vigente habilitada en la sucursal, o stock propio `seProduce`); sin eso, `COMPONENTE_SIN_RECETA` | Validación de los casos de uso (F3 y F5), al cargar y al vender; sin cambios de esquema. La venta suelta NO cambia |

## Lo construido en la base (esta rama)

- **Esquema (F0):** GO-3d (vigencia, tipo/nombre/baja lógica de cupos, entradas de lista con su configuración fija, plato del día) y GO-3a (ejes, grupos de precio, combinaciones, precio local, recetas de combinación y la foto de la combinación vendida), cada una con su migración de políticas (salida exacta del generador) y su `down.sql` que ABORTA con datos de GO-3. Todo aditivo, sin datos reescritos. Pruebas: `test/persistencia/migracion-go3d.test.ts`, `test/persistencia/migracion-go3a.test.ts` y `test/aislamiento/paquete-go3-subir-bajar-subir.test.ts`.
- **Lectores tolerantes (D2, primer despliegue de «expandir y contraer»):** `src/core/carta/cupos-de-promo.ts` y sus usos: el selector, la promo para agregar y la administración leen solo cupos de sección activos; una promo con un cupo ACTIVO de tipo nuevo no se ofrece; el reemplazo de cupos solo toca los de sección. Prueba: `test/carta/cupos-tolerantes-go3.test.ts`.
- **Núcleo puro de D (D1):** cupos de entradas, componentes fijos completados por el servidor, `claveComponente` en el prorrateo, vigencia y alícuotas. Paridad con la versión anterior por propiedad contra un oráculo copiado (`test/pos/promo-combo-go3.propiedades.test.ts`); los dos ejemplos del diseño exactos al centavo (`test/pos/promo-combo-go3.test.ts`).
- **Núcleo puro de A (A1):** `src/core/opciones/combinaciones.ts` (`test/core/opciones/combinaciones.test.ts`).
- **Núcleo puro de B (B1):** rama aditiva `excepcion` de `src/core/movimientos/consumo-de-linea-configurada.ts`; sin excepción, idéntica bit a bit (`test/core/opciones/consumo-con-excepcion.test.ts`).

## Correcciones al diseño (verificadas contra el código)

1. **D2 va junto con E1.** Al pasar `PromoCartaCupo.seccionCartaId` a nulable, los lectores de hoy dejan de compilar; además, así la migración nunca viaja sin el código tolerante.
2. **Sin `NOT VALID` + `VALIDATE`.** Cada migración corre en una transacción y el `ALTER TABLE` ya tomó `ACCESS EXCLUSIVE` hasta el COMMIT: validar aparte no reduce ningún bloqueo (mismo criterio que GO-1d). Las tablas tocadas son chicas.
3. **Únicos comunes en `PrecioLocalDeCombinacion`** en lugar de dos parciales: la columna que no se usa es NULL y dos NULL son distintos, así que el efecto es el mismo y Prisma los puede declarar.
4. **El campo de relación del insumo de una receta de combinación se llama `productoInsumo`** (con `insumo`, el guardián `sin-filas-enteras` leía `include: { insumo }` de otras consultas como una fila entera de `Producto`; mismo caso que GO-1b).
5. **«Control optimista de la promo» (§5 del diseño) no tenía columna** en el §4.1. **Cerrado (2026-10-13, a pedido del coordinador, como las migraciones todavía no se aplicaron a ninguna base real):** la migración GO-3d agrega `PromoCarta.version INTEGER NOT NULL DEFAULT 1` con CHECK `PromoCarta_version_chk` (`>= 1`). Es un DEFAULT constante (solo metadatos en PG >= 11): toda promo de hoy queda en 1. `PromoCarta` usa el privilegio de UPDATE de tabla (no por columna), así que la app ya puede escribirla. La aplicación la incrementa con `UPDATE … WHERE version = esperada` (0 filas = `VERSION_DESACTUALIZADA`, GO-3 F3); la base solo garantiza el piso. El `down.sql` aborta si alguna promo tiene `version` distinta de 1. No se audita (es control de concurrencia, no un dato de negocio).
6. **«Solo con el borrador» en la cascada de la foto:** la base no distingue un borrador de una línea enviada al borrar `CuentaItem` (hoy tampoco lo hace para `OpcionElegidaEnLinea`); lo garantiza la aplicación (borra solo con `numeroEnvio` NULL). La foto en sí la app no la puede borrar ni cambiar.
7. **Los tests de consumo** viven en `test/core/opciones/` (donde ya están los de `consumoDeLineaConfigurada`), no en `test/core/movimientos/`, que no existe.
9. **Golden congelado `test/catalogo/caracterizacion/dinero-tramo-c.golden.txt`:** vuelca las filas enteras de `PromoCarta` y `PromoCartaCupo`, así que las columnas nuevas de GO-3d lo ponían en rojo. NO se regenera: la huella omite esas columnas solo mientras tienen su valor de antes de GO-3 (cualquier otro valor sale y la pone en rojo; lo probé con una mutación).
8. **`piso-de-promo.ts` no cambia:** el peor caso sigue siendo la suma de los máximos (un componente fijo cuenta como su máximo). Lo fija un caso de `test/carta/cupos-tolerantes-go3.test.ts`.

## Supuestos declarados (no cambian el modelo, el dinero ni los permisos)

- Si la MEDIDA vendida NO es un eje de la combinación (los ejes son dos variantes), la receta propia se escala por el tamaño como cualquier base; si la MEDIDA es eje, la receta propia ya es la de ese tamaño y no se escala. La cuenta de la receta propia es siempre en decimal exacto.
- Un precio local sobre una combinación sin precio propio ni grupo (aditiva en la empresa) rige como PROPIO de la sucursal (ADR-009, `override`).
- Una combinación que apunta a un grupo inactivo falla cerrado como no disponible (no debería pasar: un grupo con miembros no se desactiva).
- La clave de una configuración fija es el canónico `opcionId=cantidad` ordenado por `opcionId` y separado por `;` (CHECK de forma en la base; la coherencia con sus opciones la controla la aplicación).
- Un plato del día (DEL_DIA) es un producto sin configuración fija: un producto con un grupo obligatorio no puede ser plato del día en v1 (D-6).
- Un nombre de cupo dado de baja sigue ocupando su nombre (se reactiva, no se duplica), igual que el único `(promo, sección)`.
- Las claves de GO-3 (`promo_menu_del_dia`, `grupos_de_precio_definir`) van dentro de sus migraciones de esquema y no en una migración de datos aparte: el diseño pide cuatro migraciones.

## Consecuencias y riesgos

- **IVA de combos, no verificado con el contador:** bloqueado por D-2 hasta que se confirme.
- **Rollback:** dos despliegues (ver `docs/deploy-con-migraciones.md`). Con combinaciones inactivas cargadas, el código de GO-2b sin GO-3 vendería una combinación apagada si se vuelve atrás.
- **Bloqueo breve de `CuentaItem`** al crear la clave foránea de la foto: aplicar fuera de horario, con `lock_timeout`.
- **F3 en adelante:** construido en GO-3b (sección siguiente).

## GO-3b (tanda 2: F3 a F6, rama `go3-tanda2`, 2026-10-13/14)

> **Estado: construido en la rama, pendiente de CI y de la fusión que hace el dueño. SIN migraciones nuevas y sin tocar `prisma/schema.prisma`:** todo corre sobre el esquema de GO-3 que ya está en producción. Las filas están en `docs/pureza-integracion.md`, de O.410 a O.421 (bloque «// GO-3b»). Para el despliegue, ver `docs/deploy-con-migraciones.md`, sección GO-3, «Segundo despliegue».

### Lo construido

| Paso | Qué | Commit |
|---|---|---|
| D3 | Los cupos se guardan sin borrar. La lista es la FINAL de todos los tipos y un cupo que falta se da de baja. Admite lugares LISTA y DEL_DIA | `3f14bfcb`, `b0e35ffb` |
| D4a+D4b | Las entradas de una lista, con su configuración fija y las reglas D-8, D-9 y D-2. La vigencia de la promo usa versión optimista | `562e914f` |
| D6 | `promo_menu_del_dia` y `grupos_de_precio_definir` entran a `ACCIONES` | `6ed68ca0` |
| D5 | Menú del día: cargar, quitar y copiar el día anterior, solo en la sucursal activa y con «hoy» en la zona de la empresa | `80bb9982` |
| AB3+AB4 | Ejes, combinaciones, tarifas (grupos de precio) y precio local de combinación o de tarifa | `ed28edbf` |
| AB5 | Receta propia de una combinación (versiones que solo se agregan) y su embudo de lectura | `48741e0a` |
| I1 | La venta aplica la precedencia de la combinación, devuelve `PRECIO_CAMBIO` y escribe la foto `CombinacionEnLinea` | `ed95265a` |
| I2 | La venta de un combo con entradas (fijos que completa el servidor, `PROMO_CAMBIO`, `ENTRADA_NO_DISPONIBLE`, `MENU_DEL_DIA_SIN_CARGAR`, vigencia, D-2) | `8d9503c1`, `2d7363a2`, `9acc2130` |
| (merge) | `origin/main` con GO-2d (#114) y «sin receta no se vende» (#113) | `0dfb20e2` |
| U5 | El POS ofrece y arma los combos de entradas; «Elegir opciones» usa la combinación; cobra lo que muestra | `39ce4ae8` |
| I3 | El cierre consume la receta propia CONGELADA en la foto, nunca la vigente | `3ec84c62` |
| I4 | Reportes con combos configurados y recetas propias (sin cambios de código) | `4b15c5c5` |
| U1 a U4 | Pantallas: lugares, entradas y vigencia en «Carta → Promos», «Menú del día», «Combinaciones» del producto y «Tarifas» | `51b85f7e` |

### Correcciones al plan (verificadas contra el código)

1. **D2 ya estaba hecho en la base** (lectores tolerantes, junto con E1); en esta tanda no se tocó.
2. **D4a y D4b van en un solo commit:** comparten el caso de uso del componente (`core/pos/componente-de-combo.ts`) y sus guardianes.
3. **D6 va ANTES que D5:** el menú del día necesita su clave en `ACCIONES` para tener guarda.
4. **El precio local de combinación tiene su archivo propio de lectura** (`server/lecturas/catalogo/precio-local-de-combinaciones.ts`), y no `precio-local.ts`: así no se ensancha la lista cerrada de los lectores de la carta pública.
5. **El chequeo de alícuotas al VENDER (D-2) corre solo en las promos con cupos de entradas.** Una promo solo de secciones se vende igual que antes; sus alícuotas las revisa la administración al guardar los cupos.
6. **El selector del POS ofrece las promos con entradas solo si recibe el día y la zona de la empresa.** Sin ellos, devuelve lo de siempre, y las caracterizaciones del selector no cambian.
7. **U1 a U4 van en un solo commit:** comparten tipos y la página de la carta.
8. **No se hizo un golden `venta-combos-go3`:** los tests de venta e I4 fijan los importes al centavo con números exactos, que dicen más que una huella.

### Hallazgos (arreglados en la rama)

- **Con D3, el formulario de cupos de antes habría dado de baja los lugares de entradas.** Solo mandaba los cupos de sección y, como guardar lleva la lista final, el resto se daba de baja. Ahora el formulario manda siempre todos los lugares (`lugares-del-formulario.ts`). Lo fija el e2e `carta-promo-cupos-lista`.
- **Anular una promo enviada con un componente CONFIGURADO no copiaba la huella al espejo**, así que el espejo no neteaba al cerrar y el café se habría cobrado igual. Ahora `cargarPromoParaAnular` lee la huella y el espejo la repite (`test/pos/cerrar-combinacion-go3.test.ts`, «anular»).

### Supuestos declarados

- **El precio que ve el mozo es un contrato.** Si cambió entre la pantalla y el servidor, la venta se rechaza (`PRECIO_CAMBIO`, `PROMO_CAMBIO`) y nunca se cobra otro. Si no viene un precio esperado (clientes viejos), se cobra el de hoy, como antes.
- **Las entradas elegibles HOY se calculan con una sola lectura** (`entradas-de-promo-para-vender.ts`), la misma para el selector y para la venta. Una entrada es elegible si está activa; si es un plato del día, tiene que ser de esta sucursal y de la fecha de hoy en la zona de la empresa; el producto tiene que estar disponible y seguir pudiendo ser componente, y su configuración tiene que armarse con la versión vigente.
- **El prorrateo de un combo pesa cada entrada por su precio de lista con su configuración.** No se aplica el descuento de producto dentro de la promo.
- **Un espejo de anulación hereda la versión de la receta propia de su original.** La receta propia vacía vuelve a la regla general.
- **El stock teórico avisa y nunca bloquea** (decisión del dueño), también en el menú del día.

### Pendientes y riesgos

- **La venta de MOSTRADOR (`registrarVenta`) no rechaza un producto con un grupo obligatorio** (hallazgo de GO-2d): lo vende a precio base, sin opciones. I1 e I2 no tocan esa zona (es la venta por la cuenta), así que queda como pendiente aparte.
- **IVA de los combos:** sigue bloqueado por D-2 (`COMBO_ALICUOTAS_DISTINTAS`) hasta que confirme el contador.
- **Un plato del día no lleva opciones (D-6).** Un producto con un grupo obligatorio no puede ser plato del día en v1.

## OPCIONES-LIMPIEZA G3: quitar componentes de un producto compuesto (2026-10-14; decisión del dueño)

Los componentes de un producto compuesto (los lugares y las entradas de un combo, el plato del día, la receta propia de una combinación) no generan una venta por sí mismos: se sacan con
un toque, con registro y con forma de volver atrás. Verificado contra el código, sin migraciones:

- **Combo (lugares LISTA):** antes de guardar, un lugar se destilda en el formulario de cupos (`lugaresDelFormulario`) y queda fuera; ya guardado, cada entrada tiene «Sacar» y «Volver a
  ofrecer» (`actualizarActivaEntradaDeCupo`: por estado y con auditoría de `EntradaDeCupo.activa`; volver a ofrecer revalida el componente). Esa pantalla es la de la carta (`/carta`): no se
  tocó en esta rama.
- **Menú del día:** «Quitar» un plato ahora es un toque con el aviso abajo y **«Deshacer»**, que vuelve a poner el MISMO plato en el mismo lugar y el mismo día (`agregarPlatoDelDia` es
  «llevar al estado»: reactiva la misma fila de `EntradaDelDiaDeCupo`, con su auditoría). Pantalla `/movimientos/menu-del-dia`, con `src/components/aviso-con-deshacer.tsx`.
- **Combinación:** «Se vende» se destilda y se vuelve a tildar (`guardarCombinacionDeProducto`, con versión y auditoría); la receta propia se quita guardando una versión sin ingredientes
  (vuelve la regla general; el historial queda).
- **Receta de un producto:** «Quitar» un ingrediente genera una versión nueva (el historial de versiones es el registro). NO se le agregó «Deshacer»: volver a la versión anterior perdería
  las calibraciones locales de ese ingrediente (`RendimientoLocalIngrediente` se arrastra de la versión vigente, que ya no lo tiene) y eso es stock; queda como decisión del dueño (fila O.497
  de `docs/pureza-integracion.md`).

## Fase 3: retiro de GO-3a (DEC-02, DEC-16; ola «precio y carta», 2026-10-20)

> **Estado: el retiro del CÓDIGO está hecho en la rama de la ola (PR 1). La migración que borra las tablas, la columna y la clave va en un PR APARTE (PR 2, rama `alegp/fase-3-migracion-retiro`) y REQUIERE AUTORIZACIÓN EXPRESA para aplicarse; por ahora, solo a la base de producción.** Decisiones del dueño (cerradas): se retira TODO GO-3a; GO-3d se conserva; se borra también la columna `ProductoAdmiteGrupo.ejeDeCombinacion`. En producción GO-3a tiene 0 filas en sus seis tablas, 0 ventas con combinación y ningún producto declara un eje.

**Por qué.** Las combinaciones nunca se usaron (0 filas) y la carta pública nunca las leyó: con una combinación de precio propio, la carta mostraba el aditivo y se cobraba otro (ver `docs/linea-de-base-precio-y-carta-2026-10-19.md`). La precedencia de precios queda en una sola regla para el POS, la vista previa y la carta (`resumenDePrecios`). Lo que el dueño quería expresar con una combinación se carga como producto aparte o con un recargo fijo (decisión de la Fase 5).

**Frentes retirados.** A (ejes, combinaciones, tarifas y precio local de combinación o de tarifa) y B (receta propia por combinación y su foto en la venta). La decisión D-3 sigue valiendo para lo que queda de GO-3d; D-4 se retiró entera.

| Paso | Qué | Commit |
|---|---|---|
| 3.0b | Rescate de la cobertura que NO es de GO-3a: el precio visto (`PRECIO_CAMBIO`, `test/pos/agregar-precio-visto.test.ts`), los dos comportamientos de los combos configurados al cerrar (`test/pos/cerrar-combo-configurado-go3.test.ts`) y los reportes de combos sin receta propia | `0c12131` |
| 3.1 | Tarifas (`GrupoDePrecio`): pantalla, comandos y clave `grupos_de_precio_definir` (sale de `ACCIONES`; la base la conserva hasta la migración) | `990ff83` |
| 3.2 | Pantalla de combinaciones de un producto y sus comandos (ejes, combinación, precio local, receta propia) | `ed9ff97`, `cf4f325` |
| 3.3 | La venta, el selector, el diálogo de opciones y los combos dejan de leer combinaciones y de escribir la foto; la lectura de opciones para vender deja de pedir `ejeDeCombinacion`. Se retira el golden de combinaciones de la Fase 0 | `9750d6b` |
| 3.4 | El cierre consume sin receta propia (`consumoDeLineaConfigurada` pierde la rama `excepcion`; `lineasDeVenta`, la clave de la versión) | `d21145e` |
| 3.5 | `ejeDeCombinacion` sale del modelo de Prisma; cerco `test/arquitectura/go3a-retirado.test.ts` | `132fdcd` |

**El precio cobrado no cambió.** Sin ejes declarados, cada rama borrada devolvía la misma entrada que recibía. Lo prueban, en cada commit y sin regenerarse: `test/caracterizacion-precio-y-carta/precios.golden.txt`, `test/caracterizacion-precio-y-carta/cobro-y-carta.golden.txt`, `test/pos/caracterizacion/venta-con-opciones.golden.txt`, `test/pos/caracterizacion/huella-del-pos.golden.txt`, las dos matrices de la venta y la huella de escritores del Kardex; y la paridad exhaustiva y de propiedad del consumo contra el oráculo anterior (`test/core/opciones/consumo-paridad-con-el-anterior.test.ts`). El golden de las combinaciones de la Fase 0 se RETIRÓ con su prueba (registro `RETIRADAS` de `test/arquitectura/caracterizaciones-congeladas.test.ts`).

**Orden de despliegue («código antes que tablas»).**
1. PR 1 (este código) a producción. El build no tiene migraciones pendientes. Las tablas siguen y nadie las lee ni las escribe.
2. Con el código ≥ 3.5 en producción y verificado, PR 2: la migración de retiro, en dos carpetas (políticas y esquema, por el guardián B7), con su verificación previa de solo lectura que ABORTA si hay una sola fila, un eje o la clave configurada fuera de la semilla, y su `down.sql`. Ver `docs/deploy-con-migraciones.md`, sección «Retiro de GO-3a».
3. Volver atrás: antes de la migración, Instant Rollback sin restricción. Después de la migración, Instant Rollback SOLO a un despliegue ≥ 3.5: antes de 3.3 la lectura de las opciones de toda venta y de la carta pide `ejeDeCombinacion`; antes de 3.4 el cierre de una cuenta con opciones lee `CombinacionEnLinea`; y antes de 3.5 el modelo de Prisma todavía declara la columna (un `create` de `ProductoAdmiteGrupo` la devolvería). Para ir más atrás, primero las reversas de la migración.

**Riesgos.** Los previews viejos comparten la base de producción y se rompen al borrar las tablas. Borrar `CombinacionEnLinea` toma un bloqueo breve sobre `CuentaItem` (fuera de horario, `lock_timeout`). Si `RegistroAuditoria` tiene filas de las entidades retiradas, la pantalla de auditoría ya no las ofrece como filtro (las filas quedan).
