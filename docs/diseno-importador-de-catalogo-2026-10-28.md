# Diseño: importador del catálogo unificado, con vista previa (2026-10-28)

Pedido del dueño (2026-10-28): «diseñá el importador con vista previa» sobre el Excel `catalogo_unificado.xlsx` (5 locales: Huinganco, Los Miches, Varvarco, Manzano Amargo, Las Ovejas). Diseño hecho por un agente de planificación y verificado contra `prisma/schema.prisma`, `src/` y `test/arquitectura/`. Estados: CONFIRMADA (dicha por el dueño), PROPUESTA, PENDIENTE, NO VERIFICADA.

## 0. Decisiones del dueño y supuestos

| # | Decisión | Estado |
|---|---|---|
| D1 | La carga es **única**, solo para arrancar. Por lo tanto: comando de un solo uso corrido por el ingeniero (opción B). Quedan **fuera** la pantalla de importación y «actualizar desde archivo» (regla «Poda»). | CONFIRMADA (2026-10-28) |
| D2 | El adicional `ADICIONAL-PAPAS-FRITAS-Y-HUEVO-FRITO-PARA-PIZZA` se carga a **$3.000 en todos los locales** que lo ofrecen (el Excel trae $3.000 en Huinganco y $25.000 en Los Miches). Corrección nominal con fecha y motivo; el detalle queda en la vista previa y en el reporte del resultado. No hay regla general de «tomar el menor o el mayor». | CONFIRMADA (2026-10-28: «dejar el 3000») |
| D3 | Los demás precios «sospechosos» (napolitana de Varvarco a $20.000, sorrentinos de trucha de $23.000 a $33.000) se cargan como vienen y se listan. | CONFIRMADA |
| D4 | Una variante con el mismo nombre en otro producto **no es la misma variante** y su precio no se hereda (Chivo y Trucha aparecen en 3 productos cada uno, con precios distintos). | CONFIRMADA (observación del dueño, 2026-10-28) |
| S1 | Nombre de `Papas "Los Miches"` + «Con huevo revuelto»: el charset de catálogo no admite comillas dobles (`RE_TEXTO_CATALOGO`, `src/core/texto.ts`). Propuesta: **«Papas Los Miches (con huevo revuelto)»** (los paréntesis sí se admiten), código `PAPAS-LOS-MICHES-CON-HUEVO-REVUELTO`. No es una variante de «Papas fritas» (otro plato: $13.000 en 4 locales; este cuesta $9.000 y solo en Los Miches). En la carta, «Con huevo revuelto» es la descripción; cuando se cargue la carta (E3) el nombre puede simplificarse. | PROPUESTA (el dueño evalúa) |
| S2 | Precio de lista (`Producto.precioVenta`): el más frecuente entre locales; en empate (6 SKU), el mayor. No cambia lo que se cobra: cada local conserva su precio del Excel. | PROPUESTA |
| S3 | Los precios del Excel son en ARS con IVA incluido. Alícuota de IVA: NULL («sin declarar»), nunca inventada. | PROPUESTA |
| S4 | «Disponible = FALSE» → `DisponibilidadProducto.disponible = false`. Ventus White Blend (sin precio en ningún local): se crea con precio 0 y queda no disponible. «Promo Dulce tarde de invierno» se carga como producto suelto. No se carga marca/bodega. Oficinas NQNTUR no recibe filas (no vende). | PROPUESTA |
| P2 | ¿Café (12 SKU→1), Milanesa (4→1), Pizza (10→1) y las demás bases elegibles se venden como un producto con opciones? Pasar de sueltos a opciones es barato **antes** de cargar recetas y vender, y caro después (§11.e). Se decide antes de cargar recetas. | PENDIENTE |
| P5 | Correspondencia de las 15 categorías del Excel con las 8 secciones de carta (§4.3). Etapa de carta. | PENDIENTE |

## 0.1 Correcciones a la evaluación previa (verificadas contra el código)

1. `CombinacionDeProducto`, `PrecioLocalDeCombinacion` y `GrupoDePrecio` existen pero ningún archivo de `src/` las usa: el eje de combinación se retiró (ADR-035). El precio de un producto con opciones vive en `ProductoAdmiteOpcion.precioAbsoluto` (MEDIDA en absoluto), la diferencia de la VARIANTE y `PrecioLocalDeOpcion` (sucursal × producto × opción). El tope de 2 ejes es de la lectura de la carta (`src/core/opciones/lectura-en-carta.ts`).
2. «13 bases con el mismo precio en todas sus variantes» estaba mal: es el criterio de `ItemAgrupadoCarta` (D5), no el de producto con opciones. El criterio correcto (a lo sumo 2 ejes, grilla completa en cada local, precio aditivo) lo cumplen **25 bases / 92 SKU**.
3. El Excel se contradice: la hoja Productos tiene 70 bases, Catálogo tiene 71 pares (categoría, base). «Adicional» está en Pizzas (3 SKU) y en Minutas (1 SKU, `ADICIONAL-HUEVO-FRITO-PARA-PLATOS`). Espumante declara el eje «Tamaño» sin ningún valor. El «tercer eje» aparece solo en Vino (20 filas).
4. 13 filas «no disponible»: 12 de Huinganco (sin stock) y 1 Ventus White Blend de Los Miches (sin precio).
5. El nombre del producto es único sin distinguir mayúsculas por empresa (`Producto_nombre_lower_key`), con charset y hasta 80 caracteres. El código es único por empresa, TEXT, sin validación de largo, inmutable después del alta.
6. El precio local solo rige si la sucursal tiene prendida la capacidad `precio_local` (`precioLocalActivoEn`); en producción NO VERIFICADA.
7. ADR-033 «Sin receta no se vende»: los 207 productos aparecen en el POS pero no se pueden cobrar hasta tener receta (`PRODUCTO_SIN_RECETA`).
8. `ContenidoCartaProducto` tiene `descripcion` por sucursal pero **no nombre por sucursal**: la carta muestra `Producto.nombre`. No hay historial de precios aparte: la historia es `RegistroAuditoria`. El alta de un producto no se audita por diseño.
9. `GrupoDeOpciones.nombre` es único por empresa. `OpcionApagadaEnSucursal` es por (sucursal, **opción**), no por producto: compartir una opción entre productos ata su disponibilidad por sucursal.

## 1. Propósito y alcance

- **Necesidad:** pedido del dueño del 2026-10-28; la base quedó limpia ese día (0 productos, `docs/limpieza-de-catalogo-2026-10-28.md`); hay que empezar a vender con el catálogo real. CONFIRMADA.
- **Etapa 1 (dentro):** un `Producto` PV por SKU, su precio de lista, sus precios locales donde difieren y su disponibilidad en los 5 locales.
- **Fuera, cada cosa como etapa con nombre:** opciones (E2), carta (E3: secciones, descripciones), recetas, alícuotas y categorías de producto.
- **Interfaz elegida (D1):** comando de un solo uso. Se descartó la pantalla (lector de xlsx en el servidor, dos Server Actions, UI, e2e, registro de alcance de pantallas, superficie expuesta) porque la carga es única. El núcleo (lector, normalizador, planificador, caso de uso) queda en `src/` por si algún día hiciera falta una pantalla; no se construye ahora.

## 2. Actores

Dueño (da el Excel, decide las correcciones, ve la vista previa y autoriza con la huella; no programa). Ingeniero (corre el comando con `--actor <email>` del dueño; el gate verifica los permisos). Otros usuarios (pueden editar el catálogo en paralelo). Destino: producción `stockhneuquen` y una rama de ensayo de Neon, con rol `motor2_app`.

## 3. Casos de uso

- **C1 Vista previa (solo lectura):** archivo + correcciones + estado de la base → plan, reporte .xlsx y huella. No escribe nada.
- **C2 Confirmar:** archivo + correcciones + huella vista → recalcula el plan dentro de una transacción SERIALIZABLE; si la huella coincide, aplica todo; si no, `VERSION_DESACTUALIZADA` y no escribe nada. Genera el reporte de resultado.
- Fuera: actualizar un SKU existente, despublicar, borrar (nunca se borra), carta y opciones.

## 4. Conceptos y ciclo de vida

### 4.1 Conceptos
- **Fila de precio:** (SKU, local, precio o vacío, disponible, nombre de carta, descripción de carta).
- **SKU:** clave natural, se guarda en `Producto.codigo`.
- **Corrección nominal:** lista explícita en `correcciones.json` junto al Excel, con `{tipo, sku, local, valorEnElExcel, valorACargar, fecha, motivo}`. Su hash entra en la huella y su contenido se copia en la vista previa. Si el Excel ya no trae `valorEnElExcel`, es un error (no se aplica en silencio). Correcciones iniciales: el adicional de pizza (D2) y el nombre de las papas (S1).
- **Plan:** por SKU, `CREAR`, `SIN_CAMBIOS` o `ERROR` (incluye `EXISTE_DISTINTO`), con la lista exacta de escrituras.
- **Huella:** SHA-256 de (bytes del archivo ‖ correcciones ‖ versión del normalizador ‖ estado leído: sucursales y capacidad `precio_local`, productos existentes con código del archivo o nombre en conflicto, sus filas de disponibilidad y precio local). Al dueño se le muestran 12 caracteres.

### 4.2 Ciclo
leído → validado (errores por fila) → planificado → visto (huella) → confirmado (reporte) o rechazado (huella vieja, permiso, error). Repetir sobre el estado ya aplicado da todo «sin cambios».

### 4.3 Correspondencia de datos

| Excel | Sistema | Estado |
|---|---|---|
| SKU | `Producto.codigo` tal cual | PROPUESTA |
| Producto base + variantes no vacías unidas por espacio (sin repetir la base) | `Producto.nombre` (medido: máx. 54 caracteres, 0 duplicados, 1 inválido: S1) | PROPUESTA |
| — | `tipo = PV`, `modoDeVenta = DIRECTO`, `seProduce = false`, `factorConversion = 1`, `unidadStockId = «unidad»` | PROPUESTA (defecto declarado) |
| Precio por local | Lista = S2; `PrecioLocalProducto` solo donde difiere de la lista. Medido: 13 SKU con precios distintos, **18 filas** (Huinganco 3, Los Miches 1, Varvarco 4, Manzano Amargo 7, Las Ovejas 3) | PROPUESTA |
| Local con fila | `DisponibilidadProducto`: **610 filas** (597 verdaderas, 13 falsas) | PROPUESTA |
| Local sin fila | Sin fila = no disponible (ADR-009) | CONFIRMADA |
| Categoría (15) | No se carga (las 2 `CategoriaProducto` son rubros, no secciones). Para E3: Entradas→Entrada, Platos Principales→Platos principales, Clásicos→Clásicos, Pastas Caseras→Pastas caseras, Pizzas→Pizzas, Postres→Postres; Bebidas sin/con alcohol, Vinos Neuquinos, Tragos y Jugos y Licuados→Bebidas; Minutas, Menú Infantil, Viandas y Confitería→sin sección existente | PENDIENTE (P5) |
| Nombre de carta por local (50 SKU) y descripciones (322) | No se cargan (no existe nombre por sucursal); la descripción va en `ContenidoCartaProducto` en E3 | PENDIENTE |
| Receta, alícuota, categoría | «Pendiente de completar», se listan, nunca se inventan | CONFIRMADA |

## 5. Invariantes y políticas

- **I1 Todo o nada.** Un error bloqueante invalida toda la importación; los avisos no bloquean.
- **I2 Lo confirmado es lo visto.** Se aplica solo si la huella recalculada dentro de la transacción es igual a la vista; si no, `VERSION_DESACTUALIZADA` (código que exige `cerco-escritores-de-precio-con-visto`).
- **I3 Idempotencia** por estado y clave natural: repetir con el estado aplicado da 207 «sin cambios», 0 escrituras, 0 auditorías.
- **I4** Si el SKU existe idéntico → `SIN_CAMBIOS`; si existe distinto → `ERROR EXISTE_DISTINTO` con el detalle campo por campo. No se actualiza (D1).
- **I5 Nada se borra.** Un SKU en la base y no en el archivo se informa y no se toca.
- **I6 Dinero.** Entero > 0 validado con `validarImporte`; a Decimal(14,2) desde texto (`aCentavos`), sin coma flotante; ARS; ningún precio local igual al de lista; el precio efectivo en cada uno de los 5 locales debe ser **igual** al del Excel corregido (comprobación interna antes de escribir). Si una sucursal necesita precio local y tiene `precio_local` apagado: error bloqueante (el importador no prende capacidades).
- **I7** Disponible TRUE sin precio es error. Un local fuera de los 5 nombres exactos (activa, de la empresa) es error.
- **I8 Validación por fila** (hoja, fila, columna, valor, motivo): encabezados distintos; SKU vacío, fuera de `^[A-Z0-9]+(-[A-Z0-9]+)*$` o de más de 80; SKU o (SKU, local) repetido; diferencia entre Catálogo y Precios por local; precio no entero, ≤ 0 o sobre el tope; «Disponible» distinto de TRUE/FALSE; nombre vacío, inválido o repetido sin distinguir mayúsculas; corrección sin su valor; celda con fórmula sin valor guardado.
- **I9 Autorización y aislamiento:** lista cerrada de las 5 sucursales, nunca «todas» (ADR-028), después de que el gate aprobó al actor en cada una.

## 6. Historia y persistencia

- **Cero tablas nuevas, cero migraciones.** Escribe `Producto` (207), `DisponibilidadProducto` (610), `PrecioLocalProducto` (18) y `RegistroAuditoria` (~243: 207 de `precioVenta` con valor anterior null y descripción «Importación de catálogo <huella12>», más 36 de precio local). La disponibilidad del alta no se audita (como `sembrarDisponibilidadDeProductoNuevo`).
- **Rendimiento:** escritor de auditoría por lotes en `src/server/auditoria/registrar-cambio-auditado.ts` (único escritor) y `createManyAndReturn`/`createMany` en la persistencia. Meta: menos de 15 viajes en la transacción (tope 15 s de `conTransaccionSerializable`). El tiempo real se mide en el ensayo (criterio: < 5 s).
- Las dos planillas (vista previa y resultado) las guarda el dueño; por tener precios no van al repositorio.

## 7. Atomicidad y concurrencia

Una sola transacción `conTransaccionSerializable`: gate → leer estado → recalcular plan y huella → comparar → escribir → auditar. Dos confirmaciones a la vez: gana una; la otra reintenta, ve otro estado y responde `VERSION_DESACTUALIZADA`. Un choque con el índice único de código o nombre (P2002) se traduce a «otro proceso cargó estos códigos o nombres: volvé a mirar la vista previa».

### ¿Qué pasa si…? (C2 confirmar)
| Caso | Resultado |
|---|---|
| Repetición / doble corrida | La segunda ve otro estado: `VERSION_DESACTUALIZADA` y 0 escrituras; con vista previa nueva, 207 «sin cambios» |
| Concurrencia | SERIALIZABLE + índices únicos: gana una, la otra se rechaza sin escribir |
| Tiempo (> 15 s) | Se aborta y no queda nada |
| Incertidumbre (corte de red en el commit) | Se corre la vista previa de nuevo: 207 «sin cambios» = se aplicó; si no, nada |
| Reintento | Seguro por I2 e I3 |
| Error parcial (falla la auditoría) | Rollback total |
| Datos faltantes | No se confirma con errores |
| Cambio de permisos entre C1 y C2 | El gate corre de nuevo; si falta en una sola sucursal, se rechaza todo |

C1 (vista previa): idempotente, no escribe; con errores la huella marca «NO CONFIRMABLE».

## 8. Acceso e interfaces

- `scripts/importar-catalogo.ts` (se corre con `tsx --conditions=react-server`, como `db:seed`). Flags: `--archivo`, `--correcciones`, `--empresa`, `--actor`, `--vista-previa <salida.xlsx>` o `--confirmar <huella>`. Producción exige además `MOTOR2_IMPORTAR_CONFIRMAR=si`.
- Lector de xlsx en `scripts/importacion/` con `fflate` (ya está en las dependencias): sin librerías nuevas. Normalizador y planificador puros en `src/core/features/catalogo/importacion/`; caso de uso en `src/server/actions/catalogo/casos-de-uso/importar-catalogo.ts`.
- **Permisos, sin clave nueva** (evaluados en el servidor): `alta_producto`, `producto_campos_sensibles` (empresa); `precio_local` en cada sucursal que recibe precio local; `producto_disponibilidad` en cada una de las 5. Si al actor le falta una sucursal, se rechaza todo y se listan las que faltan.
- **Punto delicado:** armar el contexto de actor sin sesión para el comando exige una función nueva `server-only` en `src/server/sesion/` y un guardián que solo permita importarla desde `scripts/importar-catalogo.ts`. Hay que revisarla como superficie de seguridad.
- Guardianes que debe pasar: `escrituras-auditadas`, `cerco-escritores-de-precio-con-visto`, `precio-local-en-un-solo-lugar`, `auditoria-un-solo-escritor`, `ensanches-de-alcance`, `ids-de-sucursal-declaran-a-que-se-atan`, `escrituras-en-sucursal-desde-empresa`, `ficha-de-caso-de-uso`, `casos-de-uso-con-tags-de-contrato`, `exigir-rol-de-la-app`, `escrituras-solo-en-persistencia`. No agrega Server Action ni pantalla, así que no toca el registro de alcance de pantallas.

## 9. La vista previa (.xlsx generada con `src/core/excel.ts`)

1. Resumen: archivo y su sha, fecha, base destino, huella, conteos por acción, «CONFIRMABLE»/«NO CONFIRMABLE».
2. Productos: SKU, nombre propuesto, categoría del Excel (informativa), precio de lista, acción, motivo.
3. Precios por local: SKU × local con el precio del Excel, el que regirá, de dónde sale (lista o local), disponibilidad y acción.
4. Correcciones del dueño: el adicional ($25.000 en Los Miches → $3.000, decisión del 2026-10-28; Huinganco ya en $3.000 y no disponible) y el nombre de las papas.
5. Avisos: las 34 filas de «Inconsistencias»; los 13 SKU con precio distinto entre locales; los 13 no disponibles; Ventus sin precio; Adicional partido en dos categorías; Espumante con el eje Tamaño vacío; napolitana de Varvarco; los Sorrentinos de trucha con 4 precios distintos.
6. No se importa y por qué: nombre y descripción de carta por local, categoría/sección, marca, ejes, Oficinas NQNTUR.
7. Errores por fila. 8. Pendiente de completar: receta (207: no se pueden cobrar, ADR-033), alícuota (207), categoría y carta.

## 10. Pruebas, migración y operación

- **Unitarias:** lector (fixtures armados con `write-excel-file`, sin binarios en el repo), normalizador (cada regla de I8), correcciones, planificador, huella. **Propiedad (`fast-check`):** `plan(aplicar(plan(x)))` = todo `SIN_CAMBIOS`; para todo (SKU, local) el precio efectivo es el del Excel corregido. Caso explícito: Sorrentinos (trucha con 4 precios por local; relleno que mueve el precio).
- **Integración (Postgres real):** idempotencia (confirmar dos veces: 207/610/18 y la segunda `VERSION_DESACTUALIZADA`), concurrencia (`Promise.all`: exactamente 207 productos, una confirmación OK y una rechazada), atomicidad (falla la auditoría a mitad: 0 filas), aislamiento (sucursal de otra empresa con el mismo nombre no coincide), permisos (sin `precio_local` en una sucursal o sin `producto_campos_sensibles`: 0 filas), `precio_local` apagado: error bloqueante.
- **Combinaciones (regla del dueño):** dimensiones SKU {no existe, existe igual, existe distinto} × precio en el local {sin precio, igual a lista, distinto} × disponible {sí, no} × alcance del actor {sí, no} × corrección {sí, no} × capacidad `precio_local` {on, off} = 216, recorridas contra un oráculo escrito aparte (`test/catalogo/importacion/oraculo-combinaciones.ts`). Guardián `DIMENSIONES_DEL_IMPORTADOR`: falla si el lector acepta una columna o el caso de uso escribe un campo no declarado.
- **Operación** (cero migraciones; **REQUIERE AUTORIZACIÓN EXPRESA del dueño para tocar Neon**): rama de respaldo → rama de ensayo (vista previa → OK con la huella → confirmar → medir) → producción (vista previa nueva → OK → confirmar → lectura de verificación). Vuelta atrás: restaurar desde el respaldo (nada se borra).

## 11. Variantes compartidas

### a) Inventario medido
Ejes con el mismo nombre en varias bases: Tipo (14), Presentación (8), Tamaño (6), Medida (5 tragos con el único valor «Medida»; Gin y Vermut: Medida/Zorro Colorado), Proteína (Escabeche, Wok), Carne (Milanesa, Sándwich), Salsa (Pechuga, Trucha), Relleno (Canelones, Sorrentinos), Gusto (Pizza, Bombón helado), Línea (Espumante, Vino), Cantidad (Medialunas, Tostadas), Cobertura (Pancakes, Waffles). Conjuntos idénticos: solo [Carne, Pollo] (Milanesa y Sándwich) y [Medida, Zorro Colorado] (Gin y Vermut). 20 ejes tienen un solo valor (no son variante).

Valores repetidos con **significado y precio distintos** (observación del dueño): «Chivo» es la variante de Escabeche ($3.000/$3.500), el relleno de Sorrentinos ($23.000) y el plato Chivo ($34.000 al horno, $23.000 estofado); «Trucha» es el relleno de Sorrentinos ($30.000/$33.000/$23.000/$33.000 según el local) y el plato Trucha ($53.000).

### b) Criterio para que dos ejes sean el mismo grupo (PROPUESTA)
Se cumplen las cuatro: (1) mismo significado de negocio (el mismo nombre no alcanza: el Tamaño de un café no es el del vino; Napolitana de milanesa no es Napolitana de pizza); (2) mismo conjunto de valores o un subconjunto admitido por producto; (3) misma disponibilidad por sucursal (apagar una opción la apaga en todos los productos que la admiten); (4) compartir da algo concreto (un renombre o prefijo, o una tanda de columnas en la carta). **El precio no se hereda**: vive por producto y opción.

### c) Propuesta: no abrir ningún grupo compartido
El único candidato idéntico (Carne/Pollo en Milanesa y Sándwich) falla la condición 3: en Huinganco y Los Miches el sándwich de carne no se ofrece y la milanesa de carne sí. «Medida de trago» tiene un solo valor (Poda). Para la Etapa 2 (25 bases / 92 SKU): sin compartir, 28 grupos y 86 opciones; compartiendo el candidato, 27 y 84, con el costo de romper la disponibilidad en 2 locales. Los nombres de grupo son únicos por empresa, así que los no compartidos llevan nombre por producto («Tipo de café», «Gusto de pizza»).

### d) Precio con grupo compartido
Vive por producto: `ProductoAdmiteOpcion.precioAbsoluto` (MEDIDA en ABSOLUTO, único camino a una base), la diferencia de la VARIANTE y `PrecioLocalDeOpcion`. No hay precio por combinación (inerte): solo sirven grillas completas y aditivas. Milanesa (2×2) y Café (4×3: 4.000/4.100/4.300 por tamaño) lo cumplen; Agua, Cerveza, Espumante, Medialunas, Gin y Adicional son incompletas o no aditivas; Vino tiene 3 ejes. La alternativa más barata para mostrar una sola fila en la carta es `ItemAgrupadoCarta` (mismo precio por sucursal).

### e) Pasar de la Etapa 1 a la Etapa 2
Por base: crear el producto base (código `BASE-<NOMBRE>`), grupos (clave: nombre), opciones (clave: grupo + nombre), admisiones con su `precioAbsoluto`, `PrecioLocalDeOpcion` donde difiere, `OpcionApagadaEnSucursal` para lo que un local no ofrece, pasar a `BASE_CONFIGURABLE`, y retirar los SKU poniendo su disponibilidad en false (nunca se borran). Todas las claves naturales ya son índices únicos, así que es idempotente. Lo caro no son las tablas sino las recetas (una por SKU → receta base + `ConsumoDeOpcion`), el historial (las ventas quedan en los SKU) y rehacer la carta. Conclusión: decidir P2 **antes** de cargar recetas y vender.

## 12. Plan de etapas (un commit por paso; cero migraciones)

- E1.0 este documento. E1.1 lector de xlsx mínimo. E1.2 normalizador y validador (I8) y correcciones. E1.3 planificador, huella, oráculo de 216 combinaciones y guardián de dimensiones. E1.4 escritor de auditoría por lotes y escrituras en lote. E1.5 caso de uso (C1/C2, SERIALIZABLE, gate por sucursal) e integración. E1.6 comando con reporte .xlsx y contexto de actor (con guardián). **E1.7 ensayo en rama de Neon y producción: REQUIERE AUTORIZACIÓN EXPRESA.**
- Etapas con nombre, cada una con OK del dueño: E2 opciones para las bases elegibles (P2); E2b adicionales de pizza como ADICIONAL; E3 contenido de carta desde el Excel (P5, descripción por local; `ItemAgrupadoCarta` para mismo precio). Retiradas por D1: pantalla de importación y «actualizar desde archivo».

## 13. Verificación final (en la misma corrida, con línea de base previa)

`npx tsc --noEmit`, `npm run lint`, `npm run arquitectura`, `npm run analizar:muerto` (0 hallazgos), `npm test`, `npm run build`, `npm run plataforma:build`, `npm run test:e2e`; pesados con `flock /tmp/pesado.lock` (e2e además `flock /tmp/e2e.lock`) y `NODE_OPTIONS=--max-old-space-size=6144`. Criterio: los 8 con código 0; tests y e2e en cantidad igual o mayor a la línea de base; ningún guardián con excepción nueva sin motivo. Mutaciones (rojo → revertir → verde): no aplicar la corrección; escribir un precio local igual al de lista; saltear la comparación de huella; quitar el gate de `precio_local`; escribir fuera de la transacción; sacar el control «existe idéntico».

---

# ADENDA v2 (2026-10-28): carta mínima en la primera carga y precio único por empresa

**Esta adenda REEMPLAZA** lo que contradiga en las secciones 0, 0.1 (puntos 7 y 11), 1, 3, 4.1, 4.3, 5 (I4, I6, I7, I9), 6, 7, 8, 9, 10 y 12 de arriba. Todo lo verificado contra el código y el Excel por el agente de diseño.

## A.0 Decisiones del dueño (CONFIRMADAS, 2026-10-28)
- **D1** La carga es ÚNICA. La hace el ingeniero con un comando; no hay pantalla ni «actualizar desde archivo».
- **D2** La carta mínima, por secciones, entra en la primera carga: misma transacción, misma huella, misma vista previa.
- **D3** Hay **un precio por empresa**: las 5 sucursales tienen apagado el precio local (`precio_local`). El importador **no escribe `PrecioLocalProducto`**.
- **D4** El adicional de pizza se carga a $3.000 («dejar el 3000»), como corrección nominal `precioUnico`.

**Pregunta clave (dinero, PENDIENTE):** para los 13 productos que en el Excel tienen precios distintos según el local, ¿qué precio único se carga? Propuesta: el más frecuente y, si empatan, el mayor, con vista previa (hoja «Precio único») para corregir caso por caso con correcciones nominales. La vista previa sale «NO CONFIRMABLE» hasta que el dueño acepte la regla o corrija cada caso. Ya no es cierto que «no cambia lo que se cobra»: con la regla propuesta, 13 celdas SKU × local cobran más que su precio del Excel y 5 cobran menos (extremos: Sorrentinos de trucha en Manzano Amargo +43,5 %; Saurus Estate Malbec en Manzano Amargo −28,6 %).

Otras abiertas: **P2** (Café, Milanesa, Pizza y demás bases elegibles como producto con opciones; se decide antes de cargar recetas; no cambia la Etapa 1). **S1** nombre de las papas: «Papas Los Miches (con huevo revuelto)» (PROPUESTA, el dueño evalúa; bloquea la importación hasta confirmarse).

Supuestos: correspondencia de secciones de A.2; los 50 SKU sin sección quedan fuera de carta (en el POS salen en «Fuera de carta»); los 12 sin stock llevan contenido visible; Ventus no lleva contenido; el orden en la carta es el número de fila del SKU en la hoja «Catálogo»; el nombre de carta por local no se carga; precios con IVA incluido en ARS; Oficinas NQNTUR no recibe filas.

## A.1 Precio (reemplaza 0.1 punto 7 y 11, 4.3 «Precio por local», I6)
- Con la capacidad `precio_local` apagada, `filtrarPreciosLocalesVigentes` (`src/core/catalogo/precio-local.ts`) devuelve vacío y `precioDeCarta` (`src/core/carta/armar-menu.ts`) cae a `Producto.precioVenta`; igual en la carta pública, el selector del POS y el cobro. Que las 5 tengan la capacidad apagada lo dijo el dueño (CONFIRMADA); el estado en la base está NO VERIFICADO (se lee, solo lectura, antes de cargar).
- Solo se carga `Producto.precioVenta`: entero > 0 (`validarImporte`), Decimal(14,2) desde texto, IVA incluido, ARS. **0 filas** de `PrecioLocalProducto`; un producto existente con alguna fila local en las 5 da error. No se exige la clave `precio_local`.
- Precio único por SKU: si los 5 coinciden, ese; si no, el de una corrección `precioUnico` o el de la regla (PENDIENTE). La diferencia por local se informa siempre.
- **Correcciones nominales** (`correcciones.json`, hasheado en la huella y copiado en la vista previa): `precioUnico {sku, preciosEnElExcel{local:precio}, valorACargar, fecha, motivo}` (adicional: `{Huinganco:3000, "Los Miches":25000}` → 3000, motivo «Decisión del dueño: dejar el 3000») y `nombre` (para S1). El mismo archivo trae `mapeoDeSecciones` (categoría → nombre de `SeccionCarta` o `null`). Si el Excel ya no trae los valores registrados, es error (nunca se aplica en silencio); una corrección sin usar es aviso.

## A.2 Carta mínima (sección 4.4 nueva)
**Qué se escribe:** un `ContenidoCartaProducto` por cada (SKU, local) con fila en «Precios por local» tal que: la categoría del SKU en la hoja «Catálogo» tiene sección, la fila tiene precio, el producto es PV, no es ancla de adicional y no está en un ítem agrupado de ese local. Valores: `visibleEnCarta = true`, `seccionCartaId`, `descripcion` = «Descripción en la carta» de esa fila o null, `orden` = número de fila del SKU en «Catálogo», `especial = false`, `tags = []`, `generoCartaId = null`, `mostrarNombreArriba = false`. No se crean secciones: se resuelven por nombre exacto (único por empresa) y deben estar **activas**; si no, error bloqueante.

| Categoría del Excel | Sección de carta |
|---|---|
| Entradas | Entrada |
| Platos Principales | Platos principales |
| Clásicos | Clásicos |
| Pastas Caseras | Pastas caseras |
| Pizzas | Pizzas |
| Postres | Postres |
| Bebidas sin alcohol, Bebidas con alcohol, Vinos Neuquinos, Tragos, Jugos y Licuados | Bebidas |
| Minutas, Menú Infantil, Viandas, Confitería | **Sin sección** (PENDIENTE de decidir) |

«Promociones» no se usa. **Conteos medidos:** 430 contenidos (Huinganco 75, Los Miches 92, Varvarco 77, Manzano Amargo 89, Las Ovejas 97); por sección: Entrada 8, Platos principales 30, Clásicos 30, Pastas caseras 25, Pizzas 35, Postres 35, Bebidas 267; 212 con descripción. **Sin sección: 50 SKU / 179 filas** (Minutas 10, Menú Infantil 3, Viandas 2, Confitería 35; las 110 descripciones de esas filas no se cargan). **Confitería incluye todos los cafés: la carta no va a tener cafés ni meriendas** hasta que el dueño decida su sección. Adicional: 3 SKU a Pizzas; `ADICIONAL-HUEVO-FRITO-PARA-PLATOS` es Minutas en la hoja Catálogo (queda sin sección; se reporta la inconsistencia con la hoja Productos).

**No disponibles:** de los 12 de Huinganco, los 7 con sección llevan contenido visible y los 5 sin sección no. La carta pública y el POS filtran con `whereDisponibleEn`: un visible no disponible **no se ve** (no hay «agotado» a nivel plato, límite declarado en ADR-035); vuelve solo cuando alguien lo marca disponible (función «Hoy»). Ventus White Blend: producto a $0 no disponible, **sin contenido de carta** (activarlo lo mostraría a $0); queda pendiente.

**La carta no filtra por receta:** los 430 se ven pero no se pueden pedir hasta tener receta (ADR-033); aviso en la vista previa. **Opt-in (ADR-009/D3):** se cumple: marca el importador por pedido expreso del dueño (D2), con el gate de `carta_contenido_producto` en cada local y una fila de auditoría por contenido.

**Para que se vea en la web (pendiente, no se agrega):** por sucursal, una fila `SucursalPublica` publicada con su slug, el módulo Carta activo y el portal de la empresa (NO VERIFICADO en producción). Dentro de la app, el dueño ve la carta de cada local en `/carta` (permiso `carta_ver`), cambiando de sucursal activa. La carta pública tiene caché de 60 s (`revalidate = 60`).

## A.3 Invariantes (reemplaza I4, I7, I9; agrega I10 a I12)
- **I4** Producto idéntico → `SIN_CAMBIOS`; distinto → `ERROR EXISTE_DISTINTO`. Contenido de carta idéntico → `SIN_CAMBIOS`; distinto → `ERROR CONTENIDO_DISTINTO`. No hay camino de actualización.
- **I7** Una sección del mapeo inexistente o apagada es error, además de lo anterior.
- **I10** Solo se crea contenido para lo que define A.2; nunca una sección; nunca contenido en un ancla de adicional ni en un miembro de ítem agrupado.
- **I11 (descripción)** Se valida con el **mismo** validador que usa la carta: `validarTextoLibreCarta(valor, "La descripción", LARGO_MAXIMO_DESCRIPCION_CARTA)` (`src/core/carta/validaciones.ts`; hasta 500, sin charset propio) y `validarOrdenCarta`, reutilizados desde `@/core/carta/public`, sin copiarlos; más sacar NUL y sustitutos sueltos (`quitarCaracteresInadmisibles`; verificar si `texto()` ya lo cubre). Descripción inválida = error bloqueante de la fila. Medido: máximo 220 caracteres, sin saltos de línea ni caracteres inválidos.
- **I12** Una corrección que no coincide con el Excel es error; una sin usar es aviso.

## A.4 Persistencia (reemplaza la sección 6)
Cero tablas, cero migraciones. Se escriben: `Producto` 207; `DisponibilidadProducto` 610; `ContenidoCartaProducto` 430; `PrecioLocalProducto` 0; `RegistroAuditoria` **637** (207 de `Producto.precioVenta`, de null al precio, con la huella y el origen del precio único; 430 de `ContenidoCartaProducto.visibleEnCarta`, de null a true, con `entidadId = sucursal:producto`, la misma auditoría que deja «Agregar a la carta»). Todo en lotes: `createManyAndReturn` de productos, `createMany` de disponibilidad, `createMany` de contenido (función nueva en `src/server/persistencia/carta/contenido-producto.ts`; create y no upsert, como `crearContenidoVisibleDeProducto`, para no pisar nada) y un solo `createMany` de auditoría con el escritor por lotes de `registrar-cambio-auditado.ts`.

## A.5 Atomicidad y concurrencia (agrega a la sección 7)
Todo en la **misma** transacción SERIALIZABLE. La huella suma: el mapeo de secciones, las secciones (id, nombre, activa), los contenidos existentes de esos productos en las 5 y la membresía en ítems agrupados; **sale** la capacidad `precio_local`. Clave natural del contenido: `@@unique([sucursalId, productoId])`.

| Caso (C2) | Resultado |
|---|---|
| Repetición | Los 430 contenidos dan `SIN_CAMBIOS` |
| Concurrencia | «Agregar a la carta» del mismo producto a la vez choca con el índice único (P2002): se rechaza todo y se pide una vista previa nueva; un cambio de sección o de contenido en paralelo cambia la huella: `VERSION_DESACTUALIZADA` |
| Error parcial | Rollback de productos, disponibilidad, carta y auditoría juntos |
| Datos faltantes | Sección inexistente/apagada o descripción inválida: error bloqueante |
| Cambio de permisos | Se revalida `carta_contenido_producto` en cada local |

Agrega unos 4 viajes; meta: menos de 20 viajes y menos de 5 s, medido en el ensayo.

## A.6 Permisos (reemplaza «Permisos» de la sección 8)
Sin clave nueva. El comando exige `alta_producto` y `producto_campos_sensibles` (empresa) y, en **cada una** de las 5 sucursales, `producto_disponibilidad` y `carta_contenido_producto` (nivel administrador, módulo `carta`, contexto sucursal; la que usan `guardarContenidoCartaProducto` y `agregarProductoALaCarta`). **Se quita `precio_local`.** El alcance se ensancha sucursal por sucursal solo después de que el gate aprobó todas las claves en esa sucursal (`permisoYAlcanceEnSucursal`, forma `GATE_EN_ESA_SUCURSAL`); nunca `conEscrituraEnLaEmpresa`. Falla cerrado: si falta una clave en una sola sucursal, se rechaza todo. Guardianes: los mismos más `carta-solo-lectura` y `escrituras-solo-en-persistencia`; `cerco-escritores-de-precio-con-visto` deja de aplicar (solo hay un alta de `precioVenta`); se mantiene `VERSION_DESACTUALIZADA` por la huella.

## A.7 Vista previa (reemplaza la lista de hojas de la sección 9; 12 hojas)
1 Resumen (430 contenidos, 0 precios locales, «CONFIRMABLE» solo si la regla del precio único está aceptada o cada caso corregido). 2 Productos (+ «origen del precio»: único en el Excel, corrección o regla propuesta). 3 **Precio único**: por cada SKU con precios distintos, los 5 del Excel, el propuesto, si hubo empate y por local la diferencia en $ y % con «cobrará MÁS/MENOS» (con la regla propuesta: 13 celdas cobran más y 5 menos; p. ej. Milanesa napolitana $25.000 → Varvarco +$5.000 (+25 %), Manzano Amargo y Las Ovejas +$3.000 (+13,6 %); Sorrentinos de trucha $33.000 → Manzano Amargo +$10.000 (+43,5 %), Huinganco +$3.000 (+10 %); Saurus Estate Malbec $20.000 → Manzano Amargo −$8.000 (−28,6 %); Gaseosa 1500 $9.000 → Manzano Amargo −$1.000 (−10 %)). 4 Disponibilidad por local. 5 **Carta** (430 filas: SKU, local, sección, descripción, orden, visible, disponible, acción). 6 **Sin sección** (los 50 SKU por categoría, con las 110 descripciones que no se cargan). 7 **Nombre de carta distinto entre locales** (50 SKU: 37 con sección y 13 sin; no se carga). 8 Correcciones del dueño (incluye el precio único del adicional). 9 Avisos (los anteriores + adicional en dos categorías, la carta muestra productos sin receta, la carta pública exige sucursal publicada y tiene caché de 60 s). 10 No se importa. 11 Errores. 12 Pendiente de completar (receta 207, alícuota 207, categoría, carta de los 50 sin sección, Ventus en carta, nombre por local, publicación en el portal por sucursal).

## A.8 Pruebas (reemplaza «Combinaciones» de la sección 10)
- **Oráculo de producto** (pierde precio local y capacidad): SKU {no existe, existe igual, existe distinto} × precios del Excel {únicos, distintos con corrección, distintos con regla aceptada, distintos sin regla} × disponible {TRUE, FALSE, sin fila} × alcance del actor {sí, no} = **72 combinaciones**, todas recorridas.
- **Oráculo de carta** (`test/catalogo/importacion/oraculo-carta.ts`): acción del producto {CREAR, SIN_CAMBIOS, ERROR} × categoría {con sección, sin sección} × sección {activa, apagada, no existe} × disponible {TRUE, FALSE} × precio {sí, no} × descripción {válida, ausente, inválida} × contenido existente {no, igual, distinto} × `carta_contenido_producto` en el local {sí, no} = **1.296 combinaciones**, sobre el planificador puro.
- Guardián `DIMENSIONES_DEL_IMPORTADOR`: suma «Descripción en la carta» (afecta: sí), «Nombre en la carta» (afecta: no, se reporta) y los campos escritos de `ContenidoCartaProducto`, cada uno con su motivo.
- **Integración (Postgres real):** idempotencia (dos confirmaciones dejan 430 contenidos y 430 auditorías, no 860); concurrencia (importar y «Agregar a la carta» del mismo producto/local a la vez dejan una sola fila); atomicidad (si falla el `createMany` de contenido, quedan 0 productos); aislamiento (sección de otra empresa con el mismo nombre no coincide; sin `carta_contenido_producto` en un local no se escribe nada); precio (con la capacidad prendida y apagada, la carta de cada sucursal muestra `precioVenta`, 0 filas locales).
- **Mutaciones (rojo → revertir → verde):** (1) tomar el precio de Huinganco en vez del único; (2) ignorar la corrección `precioUnico` (se cargaría $25.000); (3) crear contenido para «sin sección»; (4) no validar la descripción; (5) quitar el gate de carta en un local; (6) usar upsert en vez de create; (7) escribir una fila de `PrecioLocalProducto`.

## A.9 Plan de etapas (reemplaza la sección 12; cero migraciones en todas)
E1.0 este documento. E1.1 lector. E1.2 normalizador, correcciones (`precioUnico`, `nombre`) y mapeo de secciones. E1.3 planificador de producto (precio único, disponibilidad), oráculo de 72 y guardián. E1.3b planificador de carta (A.2, I10 a I12) y oráculo de 1.296. E1.4 escrituras en lote (productos, disponibilidad, contenido, auditoría). E1.5 caso de uso C1/C2 con el gate de 4 claves por sucursal e integración. E1.6 comando y reporte .xlsx (12 hojas). **E1.7 ensayo y producción: REQUIERE AUTORIZACIÓN EXPRESA y que la regla del precio único y S1 estén resueltas.** Etapas con nombre: E2 opciones para las bases elegibles (P2); E2b adicionales de pizza como ADICIONAL; E3 «Carta: lo que falta» (dónde van Minutas, Menú Infantil, Viandas y Confitería; nombre por local; ítems agrupados del mismo precio; Ventus; publicación en el portal). **Se borran** la pantalla de importación y «Actualizar desde archivo» (D1). Verificación final: los mismos 8 comandos con `flock` y criterios, más las 7 mutaciones de A.8.
