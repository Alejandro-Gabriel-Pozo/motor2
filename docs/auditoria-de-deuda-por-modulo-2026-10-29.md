# Auditoría de deuda por permiso / acción / módulo (2026-10-29)

Pedido del dueño: «una auditoría por permiso/acción/módulo, de lo más grande a lo más pequeño» para ver si hay combinaciones que agrandan el código y se podrían haber resuelto de otra forma. Método: inventario medido de las 131 claves de `ACCIONES` en 13 módulos (`src/` 1.170 archivos / 103.913 líneas; `test/` 1.450 archivos / 216.166 líneas), y una auditoría de solo lectura (agentes Opus) de los 5 módulos más grandes: Stock, Catálogo básico, Salón, Carta y Recetas (74 % del código atribuido). **Limitación del inventario:** el reparto por clave es por archivo y no por función; lo compartido entre 2 y 15 claves se prorratea en partes iguales; sirve para ordenar, no como medida de deuda (varios informes lo corrigen: p. ej. 1.918 líneas «exclusivas» de `stock_minimo` eran textos en dos specs e2e). Nada se ejecutó contra producción; las consultas de uso propuestas no se corrieron. Estado de cada decisión: PENDIENTE hasta que el dueño responda.

## Conclusión
El código está bastante limpio: la deuda por combinaciones suma unas 2.500 líneas de `src/` (≈ 2,4 %) más sus tests, casi todo repetición estructural y código sin uso. Lo grande no es repetición sino **funciones cuya necesidad no está escrita** o que quedaron superpuestas con otras: límite de mesas y comensales (~1.000 líneas), calibración de rendimiento por sucursal (~1.700 con tests, superpuesta con la receta propia), descuento por producto (nunca se aplica con precio local apagado), borrador del tema, sincronización de precio de ítems agrupados.

## A. Paquete sin riesgo (sin migración, sin cambio de permisos; reversible con git)
- **Código sin llamadores en `src/`:** `registrarConteoFisico` (endpoint público que escribe stock, solo lo usan tests), `buscarProductoParaHistorial` y `FilaBusquedaProducto`, Server Action `guardarReceta`, `compararRendimientosDeSucursales` con su test de equivalencia, `dentroDeLaBanda`, `versionVigentePorProducto`, `obtenerPrecioLocalProducto`, la comparación con la `SiteConfig` externa del tema (`CLAVES_NO_POR_TENANT`, `CLAVES_RETIRADAS`, `bloque`), banderas duplicadas de `ui-config` de movimientos.
- **Botones de confirmación armados a mano → `BotonConConfirmacion`** (4 archivos de Stock, 315 → ~80 líneas; arregla de paso el botón «Cancelar» del conteo que se dibuja sin mirar `cancelar_conteo`).
- **Filas del reporte de rendimiento** (`fila-simple` / `fila-compartida`): ~240 líneas menos.
- **Páginas de motivos de merma y destinos de consumo:** un componente común, ~100 líneas.
- **Opciones:** quitar parámetros que la pantalla nunca cambia (`activo`, `orden`, `activa`) y una pieza común para las 11 acciones: ~200 líneas. `activo` de grupo constante en la admisión: ~25.
- **Salón:** `MesaCard` con un solo `href` y sin botón muerto (~30); `proveedorId` en la venta sin uso (~35); un ayudante para los `guardComando*` triviales (~80); poda de comentarios históricos (~300).
- **Portal:** «Quitar del portal» hace lo mismo que destildar «Publicada» (~130).
- **Stock/POS menores:** `liberarMesa` delega en el cierre de cuenta vacía (~40); `agregarPasoAReceta` como inserción al final (~20, después de la carga de recetas).
- **Clave `notificar_alertas`** (cero usos): retirarla de `ACCIONES` y pasarla a `RETIRADAS`, sin migración y reversible.
- **Errores de permisos a corregir (mínimos):** la página del conteo físico exige `proceso_control` pero llama a una lectura que exige `reporte_conteos`; «Cancelar» sin mirar permiso.

## B. Decisiones del dueño (cambian dinero, permisos o modelo)
1. **Descuento por producto:** con precio local apagado en las 5 sucursales (D3) y la regla R1 (2026-10-01) nunca se aplica. Propuesta: ocultar el campo con interruptor ahora; borrar después (destructivo).
2. **Calibración de rendimiento por sucursal** vs **receta propia:** son dos overrides de lo mismo; con receta propia habilitada la calibración no rige y «Usar este valor» falla siempre. ¿Alcanza con la receta propia?
3. **Límite de mesas abiertas y comensales obligatorios (Task #13):** ¿quién los pidió y qué problema resuelven?
4. **`opcion_apagar_en_sucursal`:** ¿se retira y «agotar una opción» pasa a pedir `producto_disponibilidad` (dicho el 2026-10-20)?
5. **Stock (D3/S-09):** ¿un operario que cuenta puede aplicar la diferencia o exige Ajuste de un administrador? Y si `conteo_resolver_pendiente` sigue separada de `proceso_control`.
6. **Tema de la carta:** ¿hace falta el borrador (`aplicarEnCarta`)? ¿Quién pidió `carta_fuente_familia`?
7. **Sincronización de precio de ítems agrupados** (local y global): sin necesidad escrita. Propuesta: ocultar.
8. **`receta_sucursal_editar` con piso operario:** no tiene pantalla (la página exige administrador). ¿Bajar la puerta o subir el piso?
9. **Salón sin Recetas:** una empresa con Salón y sin Recetas no puede vender nada que no se produzca. Propuesta: que Salón y Stock exijan Recetas.
10. **Menores:** objetivo de food cost por categoría, `reporte_sin_receta` (ADR-033 dice mantener), unir `reporte_descuentos_*`, unir «Ver» de las claves de carta con `carta_ver`, `producto_sincronizar_precio_carta` bajo `producto_editar`, diferencia de precio por producto encima de la de la opción.

## C. Destructivo (solo con autorización expresa del dueño; respaldo, ensayo y verificación antes)
- **Retiro de GO-3a** (6 tablas, 1 columna, 1 clave): ya decidido (DEC-02/DEC-16), migración escrita en `origin/alegp/fase-3-migracion-retiro` con `verificar-retiro-go3a.sql` de solo lectura; producción tenía 0 filas el 2026-10-20.
- **Cabecera `Venta`, enum `CanalDeVenta` y columnas `Operacion.ventaId`, `reemplazaAOperacionId`, `mermaPorAnulacionDeId`:** sin escritor; contradicen «nada de tablas a ciegas».
- **Vigencia de promos y `EntradaDelDiaDeCupo`; `DescuentoProductoSucursal` y su reporte** (si el dueño decide 1); **`RendimientoLocalIngrediente`** (si decide 2); **`Sucursal.maxMesasAbiertas`** y su clave (si decide 3).

## D. No tocar
Composición del precio y versiones de opción, descuento de cliente, cierre de cuenta, anulación de ventas, numeración de tickets, versionado append-only de recetas, costeo, `reporte_historial_importes` y `producto_campos_sensibles` (deciden quién ve dinero), validadores de URL/CSS del tema (cierran inyección), reserva de slug y 404 neutro del portal, la partición «una clave por acción».

## E. Riesgos de concurrencia en código existente (ya señalados)
`asignarInsumoAProducto` sin transacción ni auditoría (dos asignaciones simultáneas con distinta unidad pasan las dos); altas simultáneas de unidad/categoría con el mismo nombre dan error genérico en vez de «ya existe» (el índice único ya impide el duplicado).

## Consultas de uso propuestas (solo lectura, NO ejecutadas)
Los informes de módulo traen consultas por tema: conteos por estado, frecuencias en 0, mínimos globales vs por depósito, roles con claves desparejas (`PermisoRol`), temas con `aplicarEnCarta` y fuente de familia, publicación y mapa del portal, ítems agrupados/géneros/descuentos, capacidades `precio_local`, `RendimientoLocalIngrediente` y `RecetaSucursal`, `MargenObjetivo` por categoría, modos de precio y tipos de diferencia de opciones, `OpcionApagadaEnSucursal`, módulos por empresa, sucursales con límite de mesas, cuentas vacías cerradas, tickets corregidos. Se corren solo con autorización, con el rol de diagnóstico de solo lectura.

## Decisiones del dueño sobre la sección B (2026-10-29)
- **B6 Tema de la carta — CONFIRMADA:** guardar el tema = aplicarlo (se retira el borrador `aplicarEnCarta`; sin migración: la columna se deja y se escribe `true` al guardar). Verificado en producción (solo lectura, 2026-10-29): 1 tema, ya aplicado: no hay borradores. **La fuente de la carta (`carta_fuente_familia`) la pidió el dueño: se mantiene** (necesidad confirmada).
- **B7 Sincronización de precio de ítems agrupados — PENDIENTE:** el dueño pregunta si un ítem agrupado resuelve lo mismo que un producto base con variantes que comparten precio. Se decide junto con el modelo de variantes (opciones vs productos sueltos); no se oculta nada por ahora.
- **B2 Calibración de rendimiento vs receta propia — EN DISEÑO:** el dueño pide pensar el modelo («el rendimiento por receta jamás va a dar el valor si no es la receta efectivamente usada») y reducir código. Diseño de solo lectura encargado el 2026-10-29. No se retira nada hasta tenerlo.
- **B4 Agotar opciones — PENDIENTE:** el dueño pide revisar si «agotar» se relaciona con el ajuste de stock. Verificado en el código: `OpcionApagadaEnSucursal` y `DisponibilidadProducto` son marcas manuales sin relación con el Kardex ni con el stock de insumos.
- **B8 Delegar la edición de recetas de sucursal — PENDIENTE** (la idea es poder delegar; se retoma junto con el diseño de recetas).
