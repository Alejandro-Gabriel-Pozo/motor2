# ADR-032: GO-3. Precio y receta por combinación, combos y menú del día

> **Estado: BASE construida en la rama `go3-base` (esquema, núcleo puro y lectores tolerantes). Las cuatro migraciones están ESCRITAS, NO APLICADAS: cada una REQUIERE AUTORIZACIÓN EXPRESA para aplicarse a la base real (respaldo y ensayo en una rama de Neon; ver `docs/deploy-con-migraciones.md`, sección GO-3).** Los casos de uso, la administración, la venta y las pantallas (F3 a F6 del plan) vienen después de que GO-2a y GO-2b estén fusionadas. Construye sobre GO-1 (`docs/adr/ADR-030-elemento-configurable-grupos-de-opciones.md`, ya aplicado).

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
- **Pendiente (F3 en adelante):** casos de uso con sus claves en `ACCIONES`, `guardar-cupos` sin borrar, entradas y configuración fija (D4b, después de la lectura de opciones de GO-2b), menú del día, administración de combinaciones y grupos, integración a la venta y pantallas.
