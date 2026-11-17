# Diseño M3d — rendimiento, «Usar este valor» y calibración por sucursal bajo la base bruta (niveles 1 a 5)

Fecha: 2026-11-17 · Frente 2 (unidades y clasificación) · Etapa M3d de `docs/diseno-merma-sobre-bruto-como-pedernal-2026-11-15.md` (§7.3, §7.4 y §15). **Solo diseño: ninguna tabla, migración ni código de M3d hasta que el orquestador general revise los niveles 6 a 10 y lo confirme.**

Estados de cada decisión: **CONFIRMADA** (dicha por el dueño, con cita), **PROPUESTA**, **PENDIENTE**, **NO VERIFICADO**. Reglas de método: escalera de diseño de 10 niveles (acá 1 a 5), primero la opción más barata, y lo que el dueño no pidió no entra.

Fuentes leídas el 2026-11-17: `ZuluHub-ERP` `26c7fc5` (`src/modulos/stock/dominio/merma.ts`, búsqueda de «calibr» y «rendimiento» en `src` y `migraciones`), `ZuluHub-docs` `dab0e47` (`11-especificaciones/conceptos/rendimiento.md`, `bruto-y-neto.md`, `ficha-de-cocina.md`, `receta-propia-y-receta-de-la-central.md`, `catalogo-y-niveles-maqueta.md` decisiones 74 y 75) y, de Motor2, `docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md` y el código real (inventario de lectores de merma del 2026-11-17).

## 0. En una frase

Motor2 ya tiene dos funciones propias que Pedernal **no construyó**: el reporte «Rendimiento de recetas» (con «Usar este valor») y la **calibración por sucursal** de la cantidad y la merma de una línea. Todo lo que escriben o muestran hoy está en base **neta**. Cuando existan versiones **brutas** (M3b), esas dos funciones tienen que seguir diciendo la verdad. M3d es ese ajuste; no agrega funciones nuevas.

## 1. Nivel 1 — Propósito, necesidad y alcance

| # | Necesidad | Quién la pidió y dónde está escrita | Estado |
|---|---|---|---|
| M3d-1 | Que el reporte «Rendimiento de recetas» y el cálculo del bruto teórico sigan siendo correctos con versiones brutas (hoy multiplican la merma sobre la cantidad escrita) | Consecuencia de N-2, N-3, N-5, N-9 (diseño de merma §1: dueño 2026-11-13 «Bruto, cargo el bruto…», 2026-11-14 «Marcar cada receta con «cómo se cargó»…», 2026-11-15 «La misma regla que las recetas») | **CONFIRMADA** (derivada) |
| M3d-2 | «Un valor calibrado nunca se aplica solo»: «Usar este valor» exige el clic y la confirmación | Dueño, 2026-11-08, chat: «el 75 es correcto» (`catalogo-y-niveles-maqueta.md` decisión 75, `ZuluHub-docs`) | **CONFIRMADA** |
| M3d-3 | Que exista la **calibración por sucursal** (cantidad y merma propias de una línea en la sucursal activa, sin tocar la receta central) | Dueño, 2026-09-26: autorizó la tabla `RendimientoLocalIngrediente`, el permiso `calibrar_rendimiento_local` y que «la merma se congela junto con la cantidad» (`docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md`, «Decisiones de autorización YA RESUELTAS por el dueño del producto»); y 2026-11-08 «el 74 es correcto» (receta versionada, receta propia, «merma y rendimiento por línea») | **CONFIRMADA** (existe y está autorizada; **no** es una función de Pedernal) |
| M3d-4 | Que la cantidad calibrada de una línea de una receta **bruta** sea también bruta | «Si el numer que guarsa también tiene que ser bruto» (dueño, 2026-11-17, chat con el orquestador, registrado en `motor2-docs`), respuesta a la pregunta de §8. **Corrige** lo fijado el 2026-09-26 («`cantidad` es SIEMPRE el estimado NETO», D4) solo para las recetas cargadas en bruto; para las netas esa autorización se mantiene | **CONFIRMADA** |

**Alcance.** Entra: el reporte de rendimiento (bruto teórico, estimado, desvío, rótulos), «Usar este valor» y «Volver al valor central», la calibración al guardar una versión nueva (arrastre), la comparación entre sucursales y los rótulos «Neto»/«Bruto» de las pantallas de receta e historial. **No entra:** escribir versiones brutas y convertir (M3b: exige la confirmación expresa del dueño, diseño de merma §11 texto X), stock y costo (M3a, hecho), la ficha impresa (M3c, hecha), merma de lote de producción, desarme, nada de tablas nuevas.

## 2. Nivel 2 — Actores y contexto

| Actor | Qué hace | Permiso real en Motor2 |
|---|---|---|
| Administrador / gerente | Edita la receta central; mira el reporte | `guardar_receta` (administrador, contexto empresa) |
| Quien opera la sucursal | Calibra la línea de su sucursal; crea o edita la receta propia | `calibrar_rendimiento_local` (D5, sembrado solo para admin); `receta_sucursal_editar` (operario) |
| El sistema | Arrastra o convierte las calibraciones al guardar una versión central nueva | — |

Contexto: una sucursal activa por pedido (la acción de calibrar **nunca** recibe `sucursalId`: usa la de la sesión); empresa única por base con RLS; costo y stock ya leen la base de la versión (M3a).

## 3. Nivel 3 — Casos de uso

| # | Caso | Resultado esperado |
|---|---|---|
| CU-1 | Ver el reporte de una receta **neta** | Igual a hoy (el bruto teórico es `cantidad × (1 + merma/100)`) |
| CU-2 | Ver el reporte de una receta **bruta** | El bruto teórico es la `cantidad` (sin sumar la merma otra vez); el «neto» se muestra derivado (`cantidad × (100 − merma)/100`, como Pedernal) |
| CU-3 | «Usar este valor» sobre una línea de receta **neta** | Calibra la línea de ESTA sucursal en **neto**, como hoy (D4 del plan de 2026-09-26, que se mantiene para las recetas netas); no cambia nada de lo ya confirmado |
| CU-4 | «Usar este valor» sobre una línea de receta **bruta** | Calibra el bruto estimado tal cual, sin convertir (coincide con lo que descuenta stock y costo). **CONFIRMADA** (§8) |
| CU-5 | «Volver al valor central» | Sin cambios: deja los dos campos en `null` y lo audita |
| CU-6 | Guardar una versión **central** nueva que tiene calibraciones de sucursales | Misma base: se arrastran si la unidad no cambió (D3, como hoy). Base distinta (neta→bruta): se descartan y se auditan (R-6). Cambió la unidad o salió el ingrediente: se descartan y se auditan (como hoy) |
| CU-7 | Comparar el bruto entre sucursales | Cada lado se pasa a bruto con la base de **su** versión (ya decidido en el diseño de merma §15) |
| CU-8 | Las pantallas de receta, historial y editor rotulan «Neto»/«Bruto» según la base de la versión que muestran | Rótulo derivado de la marca; sin la marca legible se cierra |

## 4. Nivel 4 — Conceptos y ciclo de vida

- **Base de la versión** (`NETA` | `BRUTA`, M2): una por versión, nace con ella, no cambia. La **calibración hereda la base de la línea a la que cuelga** (diseño de merma §4); no lleva marca propia.
- **Calibración de una línea en una sucursal:** par (`cantidad`, `merma`) opcionales, uno por (línea, sucursal), con auditoría y de solo agregar a nivel de historia (los campos vuelven a `null`, la fila no se borra).
- **Valor medido vs calibrado** (CYN 75, dueño): el sistema mide o estima, la persona decide; un valor calibrado nunca se aplica solo.
- **Ciclo de una calibración:** sin calibrar → calibrada → (descartada por cambio de unidad, por salir el ingrediente de la receta o por pasar la receta de neta a bruta, auditado) o → vuelta al valor central. Al guardarse una versión central nueva: se arrastra (misma base y misma unidad) o se descarta con registro y aviso (cambia la base, cambia la unidad o sale el ingrediente). No se convierte.

## 5. Nivel 5 — Invariantes y políticas

| # | Regla | Estado |
|---|---|---|
| R-1 | El bruto es lo que sale del stock y se costea en las dos bases; el neto es derivado, solo para mostrar (diseño de merma I1; Pedernal `merma.ts`: «La receta guarda el BRUTO… El neto… sale ÚNICAMENTE de `netoDeBruto`») | **CONFIRMADA** (N-2, N-3) |
| R-2 | Un valor calibrado nunca se aplica solo: la acción exige el clic; y un guardado que descarta calibraciones lo muestra en el aviso y en la vista previa de M3b antes de confirmar | **CONFIRMADA** (CYN 75) |
| R-3 | La calibración nunca recibe la sucursal por parámetro: usa la de la sesión | **CONFIRMADA** (plan 2026-09-26, D4; ya en el código) |
| R-4 | La calibración se rechaza si la línea ya no es la vigente de su receta (reporte desactualizado) | **CONFIRMADA** (ya en el código) |
| R-5 | En una versión bruta la merma es menor que 100; con 100 o más se rechaza, no se acota | **CONFIRMADA** (N-4: dueño 2026-11-13 y 2026-11-14) |
| R-6 | Al guardar una versión central nueva con calibraciones: base igual (neta→neta, bruta→bruta) → se arrastran como hoy; base distinta (la vieja neta, la nueva bruta) → se **DESCARTAN** las calibraciones de esa receta y queda **registro** de cada una (quién, cuándo, valor descartado), nunca en silencio; **sin vista previa de conversión y sin convertir**. La conversión con vista previa queda como etapa posterior con nombre (M3d-F2) | **CONFIRMADA** («1.- Hoy no hay recetas, igual. pero no habria problema con removerlas o cualquier solución barata.» (dueño, 2026-11-17, chat con el orquestador, registrado en `motor2-docs`)). Supuesto declarado por el orquestador general: «solución barata» = descartar con registro |
| R-7 | La cantidad calibrada de una línea de receta **bruta** es **bruta**; la de una receta **neta** sigue neta (la calibración hereda la base de la línea) | **CONFIRMADA** («Si el numer que guarsa también tiene que ser bruto» (dueño, 2026-11-17, chat con el orquestador, registrado en `motor2-docs`)) |
| R-8 | Estas funciones **no se tocan** para nada que no sea la base: ni textos, ni permisos, ni pantallas nuevas, ni opciones | **CONFIRMADA** (regla «Lo que el dueño no pidió no entra») |
| R-9 | Hoy ningún camino escribe BRUTA: hasta M3b todo esto es lectura equivalente (resultado idéntico al de hoy con la marca en NETA) | **PROPUESTA** (diseño de merma I2, M3a) |

### «¿Qué pasa si…?» para los dos comandos que escriben

| Situación | «Usar este valor» (calibrar una línea) | Guardar versión central con calibraciones |
|---|---|---|
| Repetición (clic doble) | Idempotente por (línea, sucursal): el segundo clic escribe lo mismo | La versión esperada rechaza la segunda con «la receta cambió» |
| Concurrencia | Transacción serializable con reintento; si la línea dejó de ser vigente se rechaza | Serializable; la segunda pierde la carrera de forma limpia |
| Tiempo | Con el reporte abierto y una versión nueva guardada en medio: se rechaza (R-4) | Sin cambio |
| Incertidumbre (no hay conteos) | No ofrece valor: nunca se inventa (CYN 75) | — |
| Reintento tras corte de red | Mismo resultado; no duplica auditoría | No duplica versión ni descartes |
| Error parcial | Todo o nada (una transacción) | Todo o nada: versión, calibraciones y auditoría |
| Datos faltantes | Sin marca legible: **cierra** con error; nunca se asume una base | Ídem |
| Cambio de permisos | Se chequea en el servidor en cada llamada (`calibrar_rendimiento_local`) | `guardar_receta` en cada llamada |

### «¿Qué pasa si…?» con la base y las calibraciones (agregado el 2026-11-17)

| Situación | Resultado | Estado |
|---|---|---|
| Una receta cargada en **neta** tiene calibraciones de sucursal | **Se mantienen en neto** (autorización del 2026-09-26). M3d no convierte nada por sí sola | **CONFIRMADA** |
| Una receta cargada en **bruto** se calibra con «Usar este valor» | Se guarda el **bruto** estimado tal cual; la merma congelada se guarda como dato, sin multiplicar | **CONFIRMADA** («Si el numer que guarsa también tiene que ser bruto», 2026-11-17) |
| Una receta **neta** se edita y la versión nueva nace **bruta** (N-8 «Al editarla se convierte a bruto», dueño 2026-11-15) y tenía calibraciones guardadas | Las calibraciones de esa receta se **descartan** y cada una deja su registro (quién, cuándo, cantidad y merma descartadas, sucursal); la persona ve en el aviso del guardado cuáles se descartaron. **Nunca en silencio, sin convertir** | **CONFIRMADA** («1.- Hoy no hay recetas, igual. pero no habria problema con removerlas o cualquier solución barata.» (dueño, 2026-11-17, chat con el orquestador, registrado en `motor2-docs`)) |
| (Sin caso aparte) La calibración que se descarta por **cambio de unidad** o por **salir el ingrediente** | Igual que hoy (D3): se descarta y se audita; el motivo cambia solo en el texto | **CONFIRMADA** (precedente: D3 del plan de 2026-09-26) |
| La misma edición llega dos veces | Una sola versión nueva; la segunda se rechaza por versión esperada y no convierte dos veces | **PROPUESTA** (el control por versión esperada ya existe) |
| Se mira una versión vieja neta del historial | No se reescribe ninguna versión; cada una conserva la base con que nació (N-5) | **CONFIRMADA** |

## 6. Qué hace Pedernal hoy (leído, 2026-11-17)

- **Receta:** guarda el **bruto** (`composicion`/componente: «se carga el BRUTO; neto = bruto × (1 − merma)», dueño 2026-11-13); el neto sale solo de `netoDeBruto` (`ZuluHub-ERP` `26c7fc5`, `src/modulos/stock/dominio/merma.ts`), con un solo redondeo a 4 decimales; la merma menor que 100 se impone también en la base (`componente_perdida_ck`).
- **Rendimiento medido («Pasar a la receta»):** **decidido y sin construir** (`conceptos/rendimiento.md` §2: «B. Decidida sin construir»; no hay nada en `src` ni en `migraciones`). Pedernal define que el valor medido nunca se aplica solo y que «Pasar a la receta» abre la edición y se guarda como versión nueva si la persona lo decide.
- **Calibración por sucursal:** **no existe** en Pedernal (`receta-propia-y-receta-de-la-central.md`: la «calibración por sucursal» figura como «otra idea», con la decisión 75). Pedernal tiene **receta propia por sucursal** completa.
- **NO VERIFICADO:** el código de `ZuluHub-ERP` se buscó por texto («calibr», «rendimiento medido»); no se recorrió módulo por módulo.

## 7. Diferencias declaradas con Pedernal (cada una con su motivo)

| Diferencia | Motivo | Estado |
|---|---|---|
| Motor2 tiene calibración por sucursal y Pedernal no | Función propia que el dueño autorizó el 2026-09-26 y confirmó con «el 74 es correcto» (2026-11-08); la regla de paridad no obliga a quitar lo ya autorizado | **CONFIRMADA**; candidata a revisar con la regla de poda si el dueño lo pide |
| «Usar este valor» escribe la calibración de la sucursal y Pedernal diría «Pasar a la receta» (abre la edición) | Mismo origen; en las dos el valor nunca se aplica solo | **CONFIRMADA** |
| Motor2 mantiene dos niveles (receta propia **y** calibración); Pedernal solo receta propia | Ídem | **CONFIRMADA** |

## 8. Pregunta que estaba abierta y su respuesta (2026-11-17)

**Pregunta** (la hizo el orquestador general al dueño): «Cuando una sucursal ajusta, con “Usar este valor”, cuánto de un ingrediente usa en su cocina, y esa receta está cargada como “lo que sale de la cámara” (bruto), ¿el número que se guarda también tiene que ser “lo que sale de la cámara”?»

**Respuesta literal** (dueño, 2026-11-17, chat con el orquestador, registrada en `motor2-docs`): «Si el numer que guarsa también tiene que ser bruto».

**Resultado: CONFIRMADA.** El número calibrado es **bruto** cuando la receta está cargada en bruto (coincide con lo que descuenta stock y costo). Corrige lo del 2026-09-26 («SIEMPRE el estimado neto») solo para las recetas brutas; las netas mantienen la autorización original. No quedan preguntas abiertas en los niveles 1 a 5.

## 8b. Segunda consulta al dueño y su respuesta (2026-11-17)

**Pregunta** (orquestador general): qué hacer con las calibraciones ya guardadas cuando una receta neta pasa a bruta (propuesta mía: convertirlas con vista previa).

**Respuesta literal** (dueño, 2026-11-17, chat con el orquestador, registrada en `motor2-docs`): «1.- Hoy no hay recetas, igual. pero no habria problema con removerlas o cualquier solución barata.»

**Resultado: CONFIRMADA la solución barata.** Se **descartan** las calibraciones de esa receta y queda **registro** (quién, cuándo, valor descartado); sin conversión ni vista previa de conversión. **Supuesto declarado por el orquestador general:** «solución barata» = descartar con registro. La conversión con vista previa pasa a etapa posterior con nombre (**M3d-F2**), sin construir. Esto reemplaza mi propuesta anterior (R-6 y las filas de §5).

## 9. Estado de las decisiones y lo que sigue

- Niveles 1 a 5: **CONFIRMADOS** (el orquestador general, 2026-11-17, con las dos citas del dueño de arriba).
- Niveles 6 a 10 (secciones 10 a 14): **PROPUESTA**, para que el orquestador los revise. **Sin migraciones ni código** hasta su confirmación.
- Sugerencia (no implementada): retirar la calibración por sucursal si, con recetas reales, nadie la usa y la receta propia alcanza (regla de poda). El dueño dijo el 2026-11-17 «Hoy no hay recetas»: hoy no hay uso que medir.

## 10. Nivel 6 — Historia y persistencia

**Hallazgo central: M3d no necesita ninguna tabla, columna ni migración.** Verificado en el código real (`prisma/schema.prisma`, 2026-11-17):

| Qué | Dónde está hoy | Cambia |
|---|---|---|
| Base de la versión (`NETA`/`BRUTA`) | `RecetaVersion.baseDeCantidad` (M2, en main) | No |
| Calibración (cantidad y merma por línea y sucursal) | `RendimientoLocalIngrediente`: `recetaIngredienteId`, `sucursalId`, `cantidad` Decimal(14,4)?, `mermaPorcentaje` Decimal(6,2)?, `actualizadoEn`; `@@unique([recetaIngredienteId, sucursalId])`; RLS por empresa | **No** |
| La calibración **no lleva marca de base propia** | Hereda la de la línea: `RendimientoLocalIngrediente → RecetaIngrediente → RecetaVersion.baseDeCantidad` | No: evita un segundo dato que pueda discrepar (diseño de merma §4) |
| Registro de lo descartado | `RegistroAuditoria` (`entidad`, `entidadId`, `descripcion`, `campo`, `valorAnterior`, `valorNuevo`, `actorId`, `sucursalId`, `creadoEn`); el arrastre ya escribe una fila por `cantidad` y otra por `mermaPorcentaje` con el valor descartado en `valorAnterior`, el actor y la sucursal de la calibración | **No** (solo cambia el texto del motivo) |

- **Historia:** la calibración se descarta (el valor queda en la auditoría de solo agregar); las versiones de receta no se reescriben (N-5). El registro cubre lo que pidió el dueño: **quién** (`actorId`), **cuándo** (`creadoEn`), **valor descartado** (`valorAnterior`, uno por campo).
- **Clave estable de la auditoría:** `sucursalId:productoId:insumoProductoId` (la que ya usa el arrastre), no el id de la fila.
- **Migración:** ninguna. No hay nada que revertir ni `down`. Antes de afirmarlo en un despliegue: verificar que `RecetaVersion.baseDeCantidad` esté aplicada en esa base (M2).
- **Datos existentes:** ninguna fila se toca. Hoy todas las versiones son `NETA` y ningún camino escribe `BRUTA` (llega con M3b), así que el comportamiento observable de hoy no cambia.
- **NO VERIFICADO:** el tamaño real de `RendimientoLocalIngrediente` en producción (el dueño dice que hoy no hay recetas).

## 11. Nivel 7 — Atomicidad y concurrencia

Comandos que escriben (dos), con la regla nueva:

1. **Guardar una versión central** (`guardarVersionDeRecetaCasoDeUso`, SERIALIZABLE con reintento, ya existe). En el bloque del arrastre se compara, **por línea**, la base de la versión vieja con la de la nueva:
   - misma base y misma unidad → se copia la calibración (como hoy);
   - base distinta, cambió la unidad o salió el ingrediente → se **descarta** y se audita en la **misma transacción** que crea la versión, con el motivo correspondiente (la base viene de `leerBaseDeCantidad`, que cierra ante una marca ilegible).
   - Todo o nada: la versión, las calibraciones copiadas y los registros de descarte entran juntos o no entra nada.
2. **«Usar este valor»** (`fijarRendimientoLocalCasoDeUso`, SERIALIZABLE con reintento, ya existe). Lee la base de la línea (`ing.recetaVersion.baseDeCantidad`) **en la transacción** y la deja junto al valor: el servidor no confía en que el cliente diga en qué base viene el número.

Qué pasa si… (la tabla completa de repetición, concurrencia, tiempo y errores está en §5; acá lo que agrega este nivel):

| Situación | Resultado |
|---|---|
| Dos personas: una calibra una línea **neta** y otra guarda la versión nueva **bruta** a la vez | La SERIALIZABLE aborta una; la perdedora reintenta y ve el resultado de la otra: si calibró primero, su calibración se descarta con registro; si guardó primero, la calibración se rechaza por «la receta cambió» (R-4). **Nunca** queda una calibración neta colgada de una línea bruta |
| Se repite el guardado de la misma versión (clic doble, reintento) | La versión esperada rechaza el segundo y **no** se descarta dos veces ni se duplica el registro |
| Corte a mitad del guardado | Nada a medias: ni versión, ni descartes |
| La base de la línea no se puede leer | Cierra con error; nunca se asume `NETA` |
| Cambia el permiso de quien calibra mientras tanto | Se chequea en el servidor en cada llamada (`calibrar_rendimiento_local`, `guardar_receta`) |

**Invariante nueva (I-M3d-1):** una calibración vigente cuelga siempre de una línea de la versión vigente y **se interpreta en la base de esa línea**; ningún camino la reinterpreta en otra base.

## 12. Nivel 8 — Acceso e interfaces

Sin pantallas, rutas ni permisos nuevos (R-8). Los puntos del código que cambian (todos de lectura de la marca, sobre lo que M2 y M3a dejaron):

| Punto | Hoy | Con M3d |
|---|---|---|
| `src/core/reportes/rendimiento-recetas-vistas.ts` | `calcularCantidadTeoricaBruta(cantidad, merma)` = `cantidad × factorDeMerma`; `calcularCantidadEstimadaNeta(bruto, merma)` = `bruto ÷ factor` | Reciben la base (o el factor ya resuelto con `factorDeBruto`): **NETA** como hoy; **BRUTA**: el teórico es la `cantidad` y el estimado es el bruto observado **tal cual** (R-7). El desvío no cambia: se calcula bruto contra bruto en las dos bases |
| `src/server/consultas/reportes/rendimiento-recetas.ts` (líneas del teórico y del estimado, en los dos caminos: simple y pool compartido) | Siempre neto | Leen la base de la versión de la línea (`select` de `baseDeCantidad`; guardián `lectores-de-reportes` / `lectores-de-receta`) |
| `src/server/consultas/reportes/rendimiento-por-sucursal.ts` | Compara sobre la receta central | Cada lado a bruto con la base de **su** versión (diseño de merma §15); donde hay receta propia no hay calibración y se marca como hoy |
| `src/server/consultas/reportes/historial-producto.ts` | Lee calibraciones | Lee la base de la versión que muestra |
| `FilaRendimientoSimple` / pool (`src/core/reportes/rendimiento-recetas.ts`) | `cantidadEstimada` documentada como NETA | Se documenta «en la base de la línea» y la fila lleva la base (para el rótulo, CU-8) |
| `fijarRendimientoLocalCasoDeUso` | Docstring D4: «cantidad es SIEMPRE el estimado NETO» | Se corrige el docstring a «en la base de la línea»; no cambia el contrato de la acción ni su permiso |
| `guardarVersionDeRecetaCasoDeUso` (arrastre) | Copia o descarta por unidad / ingrediente | Suma el caso «cambió la base» (descarta) y el motivo en `describirDescarteArrastre`; la base de cada lado viene de `leerBaseDeCantidad` |
| `rendimientoEfectivo` (`src/core/catalogo/rendimiento-local.ts`) | Resuelve cantidad y merma efectivas por sucursal | **No cambia** (es pura y no conoce la base); el consumidor aplica `factorDeBruto` sobre el resultado, como ya hacen la venta y el costo (M3a) |

- **Autorización:** sin cambios; todo se valida en el servidor y nunca recibe `sucursalId` del cliente (R-3).
- **Guardián de arquitectura:** el que prohíbe fórmulas de merma fuera de la función única (`formula-de-merma-unica`) debe seguir en verde: los reportes pasan por `factorDeBruto`, no repiten la cuenta.
- **Textos que ve el cliente (PROPUESTA):** el aviso del guardado reutiliza el formato existente («Se descartó la calibración de «Norte» para X (…)»), con el motivo «la receta pasó de neta a bruta». Es texto nuevo para el cliente: queda **PENDIENTE de OK** del dueño antes de construir (regla de no inventar textos).

## 13. Nivel 9 — Consultas y experiencia

- Quien mira el reporte ve las mismas columnas, rotuladas «Neto» o «Bruto» según la base de la línea (textos ya aprobados: «Bruto», «Merma», «Neto»; sin textos nuevos para eso).
- «Usar este valor» en una receta bruta calibra el bruto estimado; en una neta, el neto, como hoy. El valor que se ofrece y el que se guarda son siempre **los de la base de la línea**, nunca mezclados.
- Después de un guardado que descartó calibraciones, la persona ve en el aviso cuáles (sucursal e ingrediente) y el historial/auditoría muestra quién, cuándo y qué valor.
- «Pendiente de completar»: sin calibración o sin estimado se muestra como hoy, nunca se inventa un número.
- **Escalera de producto N0–N5:** M3d no sube ni baja peldaños; mantiene el que ya tenía la función de calibración.

## 14. Nivel 10 — Pruebas, migración y operación

**Dimensiones cuyas combinaciones cambian dinero, permisos, visibilidad o stock (declaradas):** D1 base de la línea (`NETA`/`BRUTA`); D2 merma (0, intermedia, 99,99; **100 o más no existe en bruta**); D3 calibración (sin ella, solo cantidad, solo merma, ambas); D4 método del estimado (compras, conteo); D5 camino del reporte (simple, pool compartido, comparativo entre sucursales, historial); D6 resultado del guardado respecto de la calibración (se arrastra, se descarta por unidad, por salir el ingrediente, por cambio de base); D7 actor (con y sin `calibrar_rendimiento_local`). **Guardián:** falla si aparece un lector de receta o de calibración nuevo sin clasificar (`lectores-de-receta`, `lectores-de-reportes`) o una fórmula de merma fuera de la función única.

**Oráculo escrito aparte** (tabla a mano, antes del código), con merma 10 % y cantidad cargada 0,2 (neta) / 0,22 (bruta), estimado bruto observado 0,25:

| Base | Teórico bruto | Estimado que se muestra y que «Usar este valor» escribe | Desvío |
|---|---|---|---|
| NETA, cantidad 0,2 | 0,22 | 0,2273 (neto = 0,25 ÷ 1,10) | 13,6 % |
| BRUTA, cantidad 0,22 | 0,22 | **0,25** (bruto, tal cual) | 13,6 % |

El desvío es **idéntico** en las dos bases (invariante de prueba): el mismo plato, cargado de una forma u otra, da el mismo desvío.

**Pruebas por sitio** (las que se escribirán en M3d, con Postgres real donde toque la base):
- Unitarias del núcleo: teórico, estimado y desvío en las dos bases contra la tabla; propiedad (`fast-check`): estimado en neto convertido a bruto = estimado en bruto, dentro del redondeo; base ilegible → cierra.
- Reportes: simple, pool y comparativo con una línea neta y una bruta; mutación en rojo por cada sitio que lee la base (el reporte ignora la marca; el comparativo mezcla bases; el pool usa siempre neto).
- «Usar este valor»: en línea bruta guarda el bruto; en neta, el neto; doble clic → una sola fila y una sola auditoría; **concurrencia** con un guardado de versión nueva (una de las dos pierde, nunca queda una calibración en la base equivocada).
- Guardar versión: base igual → copia; base distinta → descarta **con registro** (quién, cuándo, valor, sucursal; una fila por campo); repetir el guardado → no duplica; corte a mitad → nada a medias; **aislamiento** entre empresas (RLS) y entre sucursales (una calibración de «Norte» no se ve ni se descarta con efecto en «Sur» más que con su propio registro).
- Regresión: una receta neta editada sin cambiar de base **sigue** arrastrando sus calibraciones y da el mismo resultado de hoy.
- E2E a 375 px del reporte de rendimiento y de la pantalla de receta (los rótulos), con datos reales de ejemplo.

**Verificación (CI de GitHub como compuerta):** `tsc`, lint, arquitectura, knip, pruebas, build, plataforma:build y e2e, todos limpios en la misma corrida; local, solo pruebas acotadas.

**Operación y migración:** sin migración. **Marcha atrás:** M3d solo lee la marca; si se apaga M3b (que es lo que escribe `BRUTA`), las versiones brutas ya escritas se siguen leyendo bien (M3a no se retira). **Despliegue:** después de M3a (ya en main) y **antes o junto con M3b** (si M3b se encendiera sin M3d, el reporte mostraría el estimado de una línea bruta en base neta: un valor equivocado). Es un **orden obligatorio**: M3d antes de encender M3b.

**Etapas posteriores con nombre (no se construyen):**
- **M3d-F2:** convertir las calibraciones con vista previa al pasar de neta a bruta (en vez de descartarlas), si el día de mañana hay calibraciones reales que valga la pena conservar.

**Preguntas abiertas para el dueño:** ninguna. Una **DEC propuesta:** el texto del aviso de descarte (nivel 8), a aprobar antes de construir.

## 15. Resumen para quien no programa

- No hace falta tocar la base de datos para esta etapa: solo cambia cómo se leen y se escriben los números según la receta esté cargada en neto o en bruto.
- Cuando una receta vieja (neto) se pase a bruta, las calibraciones de sucursal de esa receta se **borran con registro** (quién, cuándo y qué valor tenían), porque hoy no hay recetas y no vale la pena construir la conversión.
- Antes de encender la carga en bruto (M3b), esta etapa tiene que estar lista; si no, el reporte mostraría un número equivocado.
