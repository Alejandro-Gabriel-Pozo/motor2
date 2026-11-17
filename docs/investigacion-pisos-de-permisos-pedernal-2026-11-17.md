# Investigación: ¿qué puede la empresa darle a un operario? Pisos de permisos en Pedernal frente a Motor2 (borrador, 2026-11-17)

> **No cambia código ni pisos.** Es solo lectura de Pedernal y de Motor2. Nada de `src/`, `test/`, `prisma/` ni `scripts/` se tocó.
>
> **Estados:** CONFIRMADA = lo dice el código o una cita del dueño con fecha (con archivo:línea). PROPUESTA = recomendación de esta investigación. NO VERIFICADA = equivalencia o dato que no pude comprobar.
>
> **Fuentes (leídas en su versión vigente, después de `git fetch origin` el 2026-11-17):** ZuluHub-ERP `origin/main` e8b79787 (2026-11-17 12:07 -0300); ZuluHub-docs `origin/main` bb08dae9 (2026-11-17 14:48 UTC); Motor2 `origin/main` 611db08c.
>
> **Pedido del dueño (2026-11-17, literal):** «Sobre el alcance de EB3. Sí, una dificultad que tenía el sistema anterior es que los pisos, por ejemplo, apenas estaban determinando los permisos, los pisos ya debían ser cambiados porque querían distintos permisos para distinto personal y demás. Entonces ya se había quedado corto en alcance la primera versión de permisos que tenía Motor 2. Que la empresa pueda editar los permisos libremente y que a un operario, si la empresa quiere darle algo que es importante, se lo pueda dar, es más o menos lo que plantea Pedernal. Quiero creer.»

## 0. Respuesta corta

1. **Sí, el dueño lee bien a Pedernal** (CONFIRMADA). En Pedernal un rol propio puede recibir **cualquier acción** del catálogo que el plan habilite, **salvo 20** que son solo del gerente. Ninguna de las «importantes» de la operación diaria (cerrar caja, mover efectivo, anular venta, anular o corregir compra, pagar a proveedor) está entre esas 20. Más aún: en Pedernal el rol base **Operador ya trae por defecto** cerrar caja, mover efectivo y anular venta (decisiones 155 y 161 del dueño).
2. **En Motor2 hoy no se puede** (CONFIRMADA). 65 acciones tienen piso «administrador»: ningún rol que no sea el de clave `admin` (ni «Empleado» ni un rol propio) puede recibirlas, **ni aunque el gerente las tilde**: el servidor rechaza el guardado y el guard ignora la fila. Eso es exactamente el «se quedó corto» del dueño.
3. **Lo más barato** (PROPUESTA): bajar esas 65 a piso «operario» (= «sin piso» de Pedernal) **sin tocar la semilla**, que sigue dándoselas solo a `admin`. Todo sigue naciendo cerrado; lo que cambia es que el gerente **puede** dárselas a Empleado o a un rol propio. Ya se hizo así antes con `compra_repartir`, `declarar_pago_compra` y otras («clase O»). Las 12 de gobierno y las 2 de gerente **no se bajan**.

## 1. La regla de Pedernal (pregunta 1)

### 1.1 Qué es un piso y cuántos hay

| Afirmación | Evidencia | Estado |
|---|---|---|
| Un piso es por **acción** y tiene dos tipos: `SOLO_GERENTE` («solo el rol gerente puede tenerla») y `TODOS_LOS_ROLES` («todo rol la tiene sí o sí»). **«Una acción sin piso es libre de asignar dentro del plan»** | ZuluHub-docs `11-especificaciones/h4b-permisos-configurables.md:90` | CONFIRMADA |
| Los pisos iniciales son **20 `SOLO_GERENTE` y 4 `TODOS_LOS_ROLES`**, los de hoy tal cual. Cita del dueño: «(Q1) los pisos iniciales de la plataforma son los de hoy tal cual: 20 acciones solo del gerente y 4 de todos los roles (ver, aceptar y rechazar un traspaso; ver los propios permisos); la plataforma los ajusta después desde la pantalla» (2026-11-14) | `11-especificaciones/decisiones-del-dueno-2026-11.md:128`; anexo A de h4b (`h4b…md:305-314`); semilla `sql-pendientes-otros-modulos/0061_permisos_configurables.sql:290-314` | CONFIRMADA |
| **Las 20 `SOLO_GERENTE`:** `sucursales.desactivar`, `sucursales.reactivar`, `gerencia.proponer_traspaso`, `gerencia.cancelar_traspaso`, `datos_fiscales.editar`, `datos_fiscales.confirmar`, `puntos_de_venta.crear`, `puntos_de_venta.editar`, `puntos_de_venta.activar`, `puntos_de_venta.desactivar`, `puntos_de_venta.cambiar_ambiente`, `emisores.confirmar_regla`, `productos.asignar_emisor`, `stock.verificar_saldos`, `series.resincronizar`, `certificados.gestionar`, `cajas.crear`, `cajas.reactivar`, `cajas.desactivar`, `compras.configurar` | Contadas en el código vigente: 20 filas `["GERENTE"]` en ZuluHub-ERP `src/capacidades/permisos/empresa.ts` (p. ej. :36, :38) | CONFIRMADA |
| **Las 4 `TODOS_LOS_ROLES`:** `gerencia.ver_traspaso`, `gerencia.aceptar_traspaso`, `gerencia.rechazar_traspaso`, `permisos.ver_propios` | `0061…sql:311-314`; `h4b…md:52-53` | CONFIRMADA |
| Todo lo demás **no es piso**: «Las otras 59 acciones que hoy tienen los tres roles y las 74 de gerente y administrador **no son pisos**: son lo que traen las plantillas `OPERADOR` y `ADMINISTRADOR`, y la plataforma o el gerente (con un rol propio) las pueden cambiar» | `h4b…md:314` | CONFIRMADA |
| Las acciones **nuevas** de H4b (`roles.ver`, `roles.crear`, `roles.editar`, `roles.archivar`, `usuarios.asignar_rol`) nacen con piso `SOLO_GERENTE` (S6) | `h4b…md:225`, `:282` | CONFIRMADA (diseño; aún no en `main`) |

**La frase «un rol propio recibe casi cualquier acción»** no aparece literal en ZuluHub-docs (busqué «casi cualquier» en todo `origin/main`: sin resultado de permisos). Es la paráfrasis que usa el diseño de Motor2 (§6 bis) del texto de h4b citado arriba: «casi» = todas salvo las 20 `SOLO_GERENTE`, y siempre dentro del plan. Estado: la regla, CONFIRMADA; la frase, NO VERIFICADA como cita.

### 1.2 Las «importantes»: en Pedernal ya las tiene el operador

| Acción importante | Pedernal (clave) | Plantilla base hoy | Piso | Evidencia |
|---|---|---|---|---|
| Cerrar caja | `sesiones_caja.cerrar` | Gerente, Administrador **y Operador** | sin piso | `empresa.ts:159` (decisión 161) |
| Mover efectivo (ingreso/egreso manual) | `movimientos_caja.registrar_manual` | G, A **y O** | sin piso | `empresa.ts:162` |
| Anular un movimiento propio / ajeno | `movimientos_caja.anular` / `…anular_de_otros` | G+A+O / G+A | sin piso | `empresa.ts:164-165` |
| Anular venta (cuenta) | `cuentas.anular` | G, A **y O** | sin piso | `empresa.ts:181` (decisión 155) |
| Anular compra | `comprobantes_de_proveedor.anular` | G+A | sin piso | `empresa.ts:221` |
| Corregir compra | `compras.corregir` | G+A | sin piso | `empresa.ts:248` |
| Pagar a un proveedor | `comprobantes_de_proveedor.pagar` | G+A | sin piso | `empresa.ts:227` |

Cita del dueño que lo origina (decisión 161, 2026-11-08): «el operador, y la empresa cambia el permiso si quiere»; el registro agrega: «Por defecto el operador puede hacer el cierre del día, la corrección de medio y las anulaciones, con todo auditado» (ZuluHub-docs `11-especificaciones/catalogo-y-niveles-maqueta.md:1451`). La decisión del 2026-11-14 dice que la 161 «se cumple con los roles propios» (`decisiones-del-dueno-2026-11.md:127`). CONFIRMADA.

### 1.3 Roles base frente a roles propios

| | Pedernal | Motor2 hoy | Motor2 según el dueño |
|---|---|---|---|
| Roles base (Gerente, Administrador, Operador/«Empleado») | **No los edita la empresa**: «los tres roles base de cada empresa NO se editan: se copian y se ajusta la copia; los base siguen a la plantilla de la plataforma» (Q2, 2026-11-14, `decisiones…:128`) | La empresa edita la matriz de `operador` (quien tenga `gestion_permisos`) y la de `admin` (solo el gerente, `src/core/permisos/matriz.ts:57-60`) | **Se siguen editando**: el dueño dijo hoy «no quitarla nunca» (relatado por el orquestador, 2026-11-17). Diferencia con Pedernal **con motivo: decisión del dueño** |
| Roles propios | El gerente los crea copiando una plantilla o vacíos (`h4b…md:120`), dentro de los pisos y del cupo (perilla `roles_propios_por_empresa`, base 0; «La perilla nace en 0 para cualquier plan y yo la subo», 2026-11-16, `decisiones…:203`) | Fila de `Rol` con clave nula, rango operario (`jerarquia.ts:63-70`); cupo `Empresa.rolesPropiosMax` | Igual que Pedernal, reutilizando `Rol` (diseño 2026-11-17, D-2) |
| Quién asigna roles a las personas | Solo el gerente (Q4, `decisiones…:128`) | Gerente y administrador (`gestion_usuarios`) | Solo el gerente (EB-5, confirmada 2026-11-17) |

Ojo con «Empleado» en Pedernal: es solo el **nombre visible** de `OPERADOR` («1 si empleado», 2026-11-16, `decisiones…:206`). En Pedernal no se edita; en Motor2 sí.

## 2. Las 79 acciones de Motor2 con piso por encima de operario (pregunta 2)

Cuenta leída con `tsx` sobre `ACCIONES` de `main` (611db08c): **140 acciones = 61 operario + 65 administrador + 12 administrador de sistema + 2 gerente**. Por encima de operario: **79**.

> El diseño de pisos (§6 bis) contó 61 de administrador sobre 133 acciones. Desde entonces entraron 4 de nivel administrador que no figuran en su lista: `caja_cerrar_sesion`, `caja_mover_efectivo`, `caja_anular_movimiento_ajeno` (caja C1, piso «decidido por el orquestador (criterio, no decisión del dueño: PROPUESTA)», `acciones.ts:241-248`) y `compra_recibir` (`acciones.ts:273`, piso administrador por cita del dueño «un gerente o administrador la confirma»). La lista del §6 bis hay que actualizarla a 65.

**Cómo leer la tabla.** «Piso Pedernal» = el piso de la acción equivalente. «Plantilla» = qué roles base la traen hoy en Pedernal (G = gerente, A = administrador, O = operador): la plantilla no es piso, el gerente puede dársela a un rol propio. «¿Igual?» compara **si un rol de nivel operario o propio puede llegar a tenerla**: en Motor2 piso administrador = no puede; en Pedernal sin piso = sí puede. Las equivalencias marcadas «≈» son por función, NO VERIFICADAS fila por fila.

### 2.1 Dinero, caja y anulaciones (12)

| Clave Motor2 | Piso Motor2 | Equivalente Pedernal | Piso Pedernal (plantilla) | ¿Igual? |
|---|---|---|---|---|
| `anular_venta` | administrador | `cuentas.anular` | sin piso (G+A+O) | No |
| `caja_cerrar_sesion` | administrador | `sesiones_caja.cerrar` | sin piso (G+A+O) | No |
| `caja_mover_efectivo` | administrador | `movimientos_caja.registrar_manual` + `movimientos_caja.anular` | sin piso (G+A+O) | No |
| `caja_anular_movimiento_ajeno` | administrador | `movimientos_caja.anular_de_otros` | sin piso (G+A) | No |
| `anular_compra` | administrador | `comprobantes_de_proveedor.anular` (≈ también `recepciones.anular`) | sin piso (G+A) | No |
| `corregir_compra` | administrador | `compras.corregir` | sin piso (G+A) | No |
| `pagar_consignante` | administrador | sin equivalente (≈ `comprobantes_de_proveedor.pagar`, NO VERIFICADA: Pedernal no tiene consignación) | sin piso (G+A) | No (si vale el ≈) |
| `compra_recibir` | administrador | `recepciones.confirmar` | sin piso (G+A) | No |
| `comparar_precios` | administrador | ≈ `costos.ver` | sin piso (G+A) | No |
| `proceso_ajuste` | administrador | `stock.ajustar` | sin piso (G+A) | No |
| `cancelar_conteo` | administrador | `conteos.cancelar` | sin piso (G+A) | No |
| `clientes` (catálogo y % de descuento) | administrador | ≈ `partes.crear/editar` (G+A+O); el % de descuento sin equivalente | sin piso | No (NO VERIFICADA) |

### 2.2 Catálogo, recetas, stock y precios (20)

| Clave Motor2 | Piso Motor2 | Equivalente Pedernal | Piso Pedernal (plantilla) | ¿Igual? |
|---|---|---|---|---|
| `categorias` | administrador | `categorias.crear/editar/desactivar/reactivar` | sin piso (G+A) | No |
| `unidades` | administrador | sin equivalente (NO VERIFICADA) | — | — |
| `grupos_familia` | administrador | sin equivalente como acción (≈ `productos.editar`; NO VERIFICADA) | sin piso (G+A) | No (si vale el ≈) |
| `insumo_renombrar_fusionar` | administrador | ≈ `productos.editar` | sin piso (G+A) | No |
| `insumos_mezclados` | administrador | sin equivalente | — | — |
| `opciones_definir` | administrador | `opciones.editar` | sin piso (G+A) | No |
| `producto_opciones_admitidas` | administrador | ≈ `opciones.editar` / `productos.editar` | sin piso (G+A) | No |
| `precio_local` | administrador | ≈ `productos.cambiar_precio` | sin piso (G+A) | No |
| `proveedores` | administrador | ≈ `proveedores.editar_ficha` / `partes.desactivar` | sin piso (G+A) | No |
| `partes_desactivar` | administrador | `partes.desactivar` / `partes.reactivar` | sin piso (G+A) | No |
| `guardar_receta` | administrador | ≈ `composiciones.editar` | sin piso (G+A) | No |
| `calibrar_rendimiento_local` | administrador | ≈ `composiciones.editar` (NO VERIFICADA) | sin piso (G+A) | No |
| `receta_sucursal_copiar` | administrador | sin equivalente | — | — |
| `receta_sucursal_volver_central` | administrador | sin equivalente | — | — |
| `margen_objetivo_editar` | administrador | sin equivalente | — | — |
| `motivos_merma` | administrador | sin equivalente | — | — |
| `motivos_destino_consumo` | administrador | sin equivalente | — | — |
| `secciones` | administrador | ≈ `depositos.crear/editar` (NO VERIFICADA) | sin piso (G+A) | No |
| `stock_minimo` / `stock_seccion_habitual` (2) | administrador | ≈ `articulos.controlar` (NO VERIFICADA) | sin piso (G+A) | No |

### 2.3 Carta y promociones (13)

| Clave Motor2 | Piso Motor2 | Equivalente Pedernal | Piso Pedernal (plantilla) | ¿Igual? |
|---|---|---|---|---|
| `carta_ver` | administrador | `vidrieras.ver` | sin piso (G+A+O) | No (Pedernal: la ve el operador por defecto) |
| `carta_secciones`, `carta_generos`, `carta_contenido_producto`, `carta_items_agrupados`, `carta_tema` (5) | administrador | ≈ `vidrieras.editar` (y `conjuntos.editar_contenido` para agrupados) | sin piso (G+A) | No |
| `carta_portal` | administrador | ≈ `vidrieras.publicar_en_linea` / `renovar_enlace` | sin piso (G+A) | No |
| `carta_producto_descuento` | administrador | ≈ `productos.cambiar_precio` (NO VERIFICADA) | sin piso (G+A) | No |
| `carta_copiar_de_sucursal` | administrador | sin equivalente | — | — |
| `carta_promo_definir`, `carta_promo_activar`, `carta_promo_precio_local` (3) | administrador | sin equivalente (Pedernal no tiene promociones en su catálogo de acciones) | — | — |
| `reporte_margen_promociones` | administrador | ≈ `costos.ver` | sin piso (G+A) | No |

### 2.4 Reportes de solo ver (20; el 21.º, `reporte_margen_promociones`, está en 2.3)

| Clave Motor2 | Piso Motor2 | Equivalente Pedernal | Piso Pedernal (plantilla) | ¿Igual? |
|---|---|---|---|---|
| Con costos o importes: `reporte_costos`, `reporte_valuacion`, `reporte_historial_importes`, `reporte_perdidas`, `reporte_diferencias`, `reporte_rendimiento_recetas`, `reporte_rendimiento_sucursal`, `reporte_sin_receta`, `reporte_insumos_sin_receta`, `reporte_compras`, `reporte_consolidado`, `reporte_periodo`, `reporte_resumen`, `reporte_categorias`, `reporte_devoluciones` (15) | administrador | ≈ `costos.ver` (+ `stock.ver` / `comprobantes_de_proveedor.ver`) | sin piso (G+A; «el operador no los ve nunca» es de la **plantilla**, no un piso, `empresa.ts:116-117`) | No |
| De ventas: `reporte_tickets`, `reporte_ventas_por_seccion`, `reporte_descuentos_clientes`, `reporte_descuentos_productos` (4) | administrador | ≈ `ventas.ver` / `comprobantes.ver` | sin piso (G+A+O) | No |
| `reporte_huecos_catalogo` | administrador | sin equivalente | — | — |
| (`reporte_margen_promociones` está en 2.3) | | | | |

Suma de 2.1 a 2.4: 12 + 20 + 13 + 20 = **65 de nivel administrador**, ninguna de ellas es `SOLO_GERENTE` en Pedernal. Las que no tienen equivalente no pueden ser «iguales»: la regla de paridad aplicable es la general de Pedernal («sin piso = libre dentro del plan»).

### 2.5 Gobierno: administrador de sistema (12) y gerente (2)

| Clave Motor2 | Piso Motor2 | Equivalente Pedernal | Piso Pedernal (plantilla) | ¿Igual? |
|---|---|---|---|---|
| `gestion_permisos` | adm. sistema | `roles.editar` (H4b, aún no en `main`) | `SOLO_GERENTE` (S6) | No: Motor2 deja también al `admin` (decisión del dueño 2026-11-17, «Solo gerente y admin de sistema») |
| `gestion_roles` | adm. sistema | `roles.crear` / `roles.archivar` (H4b) | `SOLO_GERENTE` (S6) | Ídem |
| `renombrar_rol` | adm. sistema | ≈ `roles.editar` (H4b) | `SOLO_GERENTE` (S6) | Ídem |
| `gestion_usuarios` | adm. sistema | `usuarios.invitar` (+ `usuarios.asignar_rol`, H4b) | invitar: sin piso (G+A); asignar rol: `SOLO_GERENTE` | Parcial: Motor2 más cerrado en invitar |
| `apagar_cuenta_empresa` | adm. sistema | `usuarios.apagar` | **sin piso** (G+A) | No: Motor2 más cerrado |
| `activar_usuario_sucursal` | adm. sistema | ≈ `usuarios.asignar_sucursales` | **sin piso** (G+A) | No: Motor2 más cerrado |
| `notas_usuario_sucursal` | adm. sistema | sin equivalente | — | — |
| `alta_sucursal` | adm. sistema | `sucursales.crear` | **sin piso** (G+A) | No: Motor2 más cerrado |
| `renombrar_sucursal` | adm. sistema | `sucursales.editar` | **sin piso** (G+A) | No: Motor2 más cerrado |
| `activar_sucursal` | adm. sistema | `sucursales.desactivar` / `sucursales.reactivar` | `SOLO_GERENTE` | Casi: Motor2 deja también al `admin` |
| `capacidades_sucursal` | adm. sistema | sin equivalente (en Pedernal los módulos los activa la plataforma: `modulos_de_empresa.activar`, consola) | — | — |
| `ver_auditoria` | adm. sistema | sin equivalente de empresa (`auditoria.ver` es de plataforma: ADMIN y SOPORTE) | — | — |
| `traspasar_gerencia` | gerente | `gerencia.proponer_traspaso` | `SOLO_GERENTE` | Sí |
| `ver_auditoria_empresa` | gerente | sin equivalente de empresa | — | — |

**Hallazgo:** en Pedernal **invitar y apagar usuarios, crear y editar sucursales no tienen piso** (`empresa.ts:27-35`): un rol propio armado por el gerente podría recibirlas. Motor2 decidió más cerrado (las 12 de gobierno con piso, CONFIRMADA por el dueño el 2026-11-17). Es una diferencia **con motivo** (decisión del dueño) y ya está declarada en el diseño.

## 3. Propuesta mínima (pregunta 3)

### 3.1 ¿El piso de Motor2 impide que el gerente le dé «anular venta» o «cerrar caja» a un operario? Sí (CONFIRMADA)

- `jerarquia.ts:68-75`: todo rol que no tenga la clave `admin` (`operador` = «Empleado», y cualquier rol propio) cuenta como **operario** frente al piso; `rolAlcanzaLaAccion` compara con `nivelMinimo`.
- `decision-de-acceso.ts:47-49`: «si el rol no llega al piso, no hay permiso aunque la fila exista».
- `matriz.ts:38-40` (`esCeldaFueraDeNivel`): la pantalla no deja tildar la celda y `guardarPermisos` la rechaza.
- Resultado: hoy **nadie** puede dar `anular_venta` (`acciones.ts:140`), `caja_cerrar_sesion` (:246), `caja_mover_efectivo` (:247), `anular_compra` (:142), `corregir_compra` (:144) ni `pagar_consignante` (:153) a Empleado ni a un rol propio. Ni siquiera el gerente.

### 3.2 Cómo se levanta: las tres opciones

| Opción | Qué cambia | Costo | Riesgo |
|---|---|---|---|
| **A. Bajar el `nivelMinimo` de las 65 a «operario»** («clase O»: piso operario, semilla solo `admin`) | Un dato por acción en `acciones.ts`. Sin migración de base, sin tabla nueva. **La semilla no cambia**: los roles nuevos y «Empleado» siguen sin esas acciones; solo el `admin` las trae | Chico: 65 líneas de catálogo y sus pruebas (la de pisos y la de combinaciones) | Ver 3.3 |
| B. Perilla por empresa (`pisosPorAccion`, T3 del diseño) | Interruptor de plataforma que hace decidir al guard por pisos por acción | Medio: necesita EB-1 (tabla de pisos), T2 (oráculo) y T3 | Bajo, pero tarda: el dueño espera hoy |
| C. Esperar la transición completa T1 a T5 | Pisos por acción en datos, plantillas, versiones | Grande | Bajo, pero llega último |

**Antecedente de A ya usado en Motor2 (CONFIRMADA):** `compra_repartir` bajó de administrador a operario por decisión del dueño del 2026-10-27, «sin migración de datos» (`acciones.ts:262-265`); `declarar_pago_compra` (pago de facturas, dinero) nació así (`acciones.ts:266-268`); y la caja C1 dice que «el gerente las delega en la matriz» (`acciones.ts:241`). Es la misma forma.

**A es exactamente el resultado de la equivalencia ya aprobada** (§6 bis del diseño: las de nivel administrador quedan «sin piso»; dinero «Asignables a un rol propio, como Pedernal», CONFIRMADA 2026-11-17), adelantado en el código actual sin esperar las tablas. Cuando lleguen los pisos por acción (T1 en adelante), la semilla de `PisoDePlataforma` para estas 65 es «sin fila» y nada cambia de nuevo.

### 3.3 Riesgos de A y cómo se cubren

| Riesgo | Qué pasa | Cobertura (PROPUESTA) |
|---|---|---|
| **Filas dormidas que despiertan** | Hoy una fila de `PermisoRol` de un rol no-admin sobre esas 65 queda **inerte** por el piso. Al bajar el piso, **vuelve a dar acceso** sin que nadie la tilde | Antes del cambio, **consulta de solo lectura en producción**: filas de `PermisoRol` con `puedeVer` o `puedeEditar` en esas 65 claves para roles con clave distinta de `admin`. Si hay alguna, se lista y el dueño decide (borrarla en la misma migración o dejarla). Sin este paso, A no entra |
| Quién puede darlas | Hoy la matriz de los roles de nivel operario la edita **quien tenga `gestion_permisos`** (gerente y `admin`, `matriz.ts:51-56`). Con A, un administrador podría dar «anular venta» a Empleado | Es la UNA pregunta de 3.4 |
| Dinero mal delegado | Un Empleado con `anular_venta` o `caja_mover_efectivo` | Igual que Pedernal: todo queda auditado; la decisión es del gerente (nace cerrado). No hay piso que lo impida en Pedernal tampoco |
| Acción nueva del catálogo | — | Sigue la regla: nace con semilla solo `admin` (todo nace cerrado) |
| Marcha atrás | — | Volver el `nivelMinimo` a «administrador»: lo otorgado queda inerte de inmediato (el piso manda), no se borra nada |
| Roles propios | El cupo (`rolesPropiosMax`, nace en 0) no cambia | Nada: un rol propio recibe lo mismo que Empleado |

### 3.4 Recomendación y la pregunta

**Recomendación (PROPUESTA):** opción A, en una etapa chica propia: (1) consulta de solo lectura de filas dormidas; (2) bajar a «operario» las 65 de nivel administrador sin tocar `rolesEditarSemilla`; (3) actualizar §6 bis (61 → 65) y la prueba de combinaciones. Las 12 de gobierno y las 2 de gerente no se tocan. «Empleado» y los roles propios se tratan igual: los edita la empresa (el dueño: «no quitarla nunca»), arrancan sin estas acciones y el gerente decide.

**UNA pregunta para el dueño:**
> Cuando el sistema permita darle a «Empleado» o a un rol propio acciones importantes (anular venta, cerrar caja, mover efectivo, anular o corregir compras), **¿quién puede dárselas?**
> **A (recomendada, como Pedernal):** solo el gerente.
> **B:** el gerente y también el administrador (como funciona hoy la matriz de los roles de nivel operario).

Motivo de la recomendación A: en Pedernal editar roles es `SOLO_GERENTE` (S6, `h4b…md:282`) y quien asigna roles ya pasa a ser solo el gerente en Motor2 (EB-5). B es lo que existe hoy y no quita nada a nadie; A le quita al administrador la posibilidad de **dar** esas acciones (no de usarlas), y necesita una regla chica en `guardarPermisos` para esas celdas.

## 4. Lo que no se baja nunca (pregunta 4)

| Clave Motor2 | Por qué no se baja | Qué hace Pedernal |
|---|---|---|
| `gestion_usuarios` | Da acceso a personas: quien la tiene arma el personal | `usuarios.invitar` sin piso (G+A); `usuarios.asignar_rol` `SOLO_GERENTE` (H4b) |
| `activar_usuario_sucursal` | Prende y apaga el acceso de personas | `usuarios.asignar_sucursales` sin piso (G+A) |
| `apagar_cuenta_empresa` | Deja a alguien sin entrar a toda la empresa | `usuarios.apagar` sin piso (G+A) |
| `notas_usuario_sucursal` | Datos de personas | sin equivalente |
| `gestion_roles` | Crear roles = fabricar permisos | `roles.crear` / `roles.archivar` `SOLO_GERENTE` (H4b, S6) |
| `gestion_permisos` (la matriz) | Quien la edita se puede dar cualquier cosa: es la llave de todas las llaves | `roles.editar` `SOLO_GERENTE` (H4b, S6) |
| `renombrar_rol` | Cambia lo que la gente ve como su rol | ≈ `roles.editar` `SOLO_GERENTE` |
| `capacidades_sucursal` | Equivale a prender o apagar módulos por sucursal (el plan) | Los módulos los activa solo la plataforma (`modulos_de_empresa.activar`, consola) |
| `alta_sucursal`, `activar_sucursal`, `renombrar_sucursal` | Estructura de la empresa | crear/editar sin piso (G+A); desactivar/reactivar `SOLO_GERENTE` |
| `ver_auditoria` | El registro de quién hizo qué: quien es auditado no debe ver ni elegir el rastro | Solo plataforma (`auditoria.ver`: ADMIN y SOPORTE) |
| `traspasar_gerencia` | Cambia quién manda | `gerencia.proponer_traspaso` `SOLO_GERENTE` |
| `ver_auditoria_empresa` | Auditoría de toda la empresa | Solo plataforma |

Estado de esta lista: CONFIRMADA por el dueño el 2026-11-17 («Solo gerente y admin de sistema (Recomendada)», relatada por el orquestador; diseño §6 bis). El plan y los módulos de la empresa no son acciones de la empresa en Motor2: viven en la consola de plataforma y no se pueden delegar.

## 5. Qué no verifiqué

- **Pedernal todavía no aplica los pisos en `main`**: la 0061 está en ZuluHub-docs como «SQL pendiente» y su cabecera dice «NO SE LEE TODAVÍA» (`0061…sql:7`); el modelo de datos está en la rama `orq/h4b-t1-modelo-de-datos` de ZuluHub-ERP, no mergeada. Lo «vigente» de Pedernal es la tabla fija `PERMISOS_DE_EMPRESA` más el diseño H4b y las decisiones del dueño. Hay además una rama `orq/compras-permisos-confirmados` sin mergear que podría cambiar permisos de compras.
- Las equivalencias marcadas «≈» o «sin equivalente» son por función; no las crucé caso de uso por caso de uso.
- No consulté producción: la cantidad de filas dormidas (3.3) es desconocida.
- La frase literal «roles propios reciben casi cualquier acción» no aparece en ZuluHub-docs (ver 1.1).
- h4b dice en su resumen «63 las pueden los tres roles» y en el anexo «59»; con el código vigente cuento 65 de los tres roles, 90 de gerente y administrador y 20 solo del gerente (175 filas): la tabla creció desde que se escribió h4b. Los 20 + 4 pisos no cambiaron.
