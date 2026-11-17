# Oráculo de combinaciones — recepción separada de compras (Compras N3-a y N3-b)

Regla «Combinaciones» del dueño (AGENTS.md, 2026-10-28). Este archivo es la tabla de reglas esperadas, escrita APARTE del código. La leen:

- `test/core/combinaciones-compras-recepcion.test.ts`: recorre TODAS las combinaciones de las reglas puras (con qué estado nace la parte, y confirmar la recepción: módulo, rol, sucursal de la parte, estado y sección) contra las tablas de abajo (exhaustivo).
- `test/movimientos/combinaciones-compras-recepcion-integracion.test.ts`: recorre contra la base real (el resultado del caso de uso, no solo de la regla pura) todas las combinaciones de sucursal de la parte × estado × sección de quien SÍ puede confirmar, la carga con módulo × reparto y la puerta de permisos (módulo × rol) de la Server Action.
- `test/arquitectura/combinaciones-compras-recepcion-declaradas.test.ts`: falla si aparece un estado, una entrada de la regla, un módulo o una acción nuevos sin declarar si afectan o no.

Complementa a `docs/oraculo-combinaciones-una-sola-compra-2026-11-06.md` (anular, corregir y pagar la factura entera; allí, la columna `estadoRecepcion` deja de ser constante y su efecto sobre anular se declara acá).
Diseño de origen: `docs/diseno-compras-paridad-escalera-2026-11-16.md` (niveles 4, 5 y 10) y `docs/sintesis-compras-etapa-minima-2026-11-16.md`. Pedido del dueño: «Compras: recepción separada (primera etapa)» e «Ya, con interruptor por empresa» (2026-11-16). Estado de las reglas: PROPUESTAS por el diseño; el dueño las corrige si no son así.

## Dimensiones que cambian el resultado

| Dimensión | Valores | De dónde sale |
|---|---|---|
| **M** módulo `recepcion_de_compras` de la empresa | APAGADO, ENCENDIDO | Registro `ModuloEmpresa` (lo enciende la plataforma por empresa; nace apagado) |
| **R** reparto de la factura al cargarla | UNA_PARTE, REPARTIDA | Una parte (la de la sucursal que carga, 100 %) o con partes de otras sucursales |
| **O** rol de quien actúa | OPERADOR, ADMINISTRADOR, GERENTE | Nivel de la persona (`nivelDe`) y fila de fábrica: `compra_recibir` (piso operario desde PISOS-65, 2026-11-17; de fábrica solo `admin`, así que el OPERADOR de fábrica no la tiene) para confirmar, `compra_controlar_recepcion` (operario, de fábrica admin y operador) para registrar el control |
| **P** de quién es la parte | PROPIA, AJENA | La parte pertenece (o no) a la sucursal activa de quien confirma |
| **E** estado de la parte | PENDIENTE, RECIBIDA, ANULADA | `FacturaProveedorSucursal.estadoRecepcion` y `FacturaProveedor.anuladaEn` (ANULADA = la factura está anulada) |
| **S** sección elegida para recibir | PROPIA_ACTIVA, AJENA, INACTIVA | La sección es de la sucursal que recibe y está activa, es de otra sucursal (o no existe), o es de la sucursal pero está dada de baja |
| **C** condición del control de una línea (N3-b) | CONFORME, CON_OBSERVACIONES, RECHAZADA, FUERA_DE_LISTA | `ControlDeLineaDeRecepcion.condicion` (CHECK de la base y `CONDICIONES_DE_CONTROL`); FUERA_DE_LISTA es cualquier otro valor |
| **B** observación del control (N3-b) | SIN, VALIDA, INVALIDA | Ausente o en blanco; texto de una línea de la lista de caracteres permitidos (hasta 500); texto con un carácter no permitido (por ejemplo `<`) |
| **Q** cantidad según remito (N3-b) | SIN, VALIDA, INVALIDA | No informada; número mayor que cero con hasta 4 decimales; cero, negativa o con más de 4 decimales |
| **N** destinos de stock de la confirmación (N3-b) | UNA_SECCION, DOS_SECCIONES, MISMA_SECCION_DOS_VECES | Cada renglón entra entero en UNA sección; el mismo renglón en dos secciones distintas (dividido); el mismo renglón dos veces en la misma sección |
| **K** control de la línea al confirmar (N3-b) | SIN_CONTROL, CONFORME, CON_OBSERVACIONES, RECHAZADA | Lo que quien recibe constató antes de confirmar; sin fila es «no se constató» |

## Dimensiones que NO cambian el resultado

| Dimensión | Por qué no afecta |
|---|---|
| Reparto al CONFIRMAR | Solo una factura de UNA parte nace pendiente; la parte propia de una repartida nace RECIBIDA (E = RECIBIDA, ya cubierto) y la de cada destino entra al aceptar la propuesta (otro comando). El reparto decide el estado inicial (tabla «Cargar la factura»), no la confirmación. |
| Cantidad de renglones, productos, lotes, precios | La parte única recibe el renglón entero tal cual se cargó: cambian los movimientos que entran, no si se puede confirmar (salvo un producto ya no habilitado en la sucursal: «Producto no disponible», se prueba aparte). |
| Condición de pago (pagada al cargar o pendiente de pago) y pago declarado | La recepción es de la mercadería, no del dinero: confirmar no toca el pago. (PROPUESTA; el dueño la corrige si no es así.) |
| Medio de pago, proveedor, número de factura | No participan de la decisión de recibir. |
| Temperatura, lotes y series del control (N3-b) | No se capturan: nadie los pidió (el dueño no los pidió; Pedernal tiene temperatura y se declara como diferencia). |
| Cantidad según remito (N3-b) | Es solo un dato del control: no cambia cuánto stock entra (entra la cantidad del renglón repartida en las entradas). |
| Quién registró el control | El operador, el administrador o el gerente (los tres alcanzan el piso operario): el resultado no depende de la persona, sí del módulo y del estado de la parte (tabla «Registrar el control: puerta y estado»). |

## Cargar la factura

Con qué estado nace la parte de la sucursal que carga. PARTE_PENDIENTE_SIN_STOCK: sin `Operacion` ni `MovimientoStock`, sin fecha ni persona de recepción, y se ignora la sección que venga. PARTE_RECIBIDA_CON_STOCK: entra al stock al cargar, como siempre.

| M | R | Resultado |
|---|---|---|
| APAGADO | UNA_PARTE | PARTE_RECIBIDA_CON_STOCK |
| APAGADO | REPARTIDA | PARTE_RECIBIDA_CON_STOCK |
| ENCENDIDO | UNA_PARTE | PARTE_PENDIENTE_SIN_STOCK |
| ENCENDIDO | REPARTIDA | PARTE_RECIBIDA_CON_STOCK |

## Confirmar la recepción

Orden de las razones (la primera que corresponda): módulo apagado → el rol no tiene la acción (piso operario y semilla solo admin: PISOS-65) → la parte no es de esta sucursal → la factura está anulada → la parte ya está recibida (CONFIRMA_YA_RECIBIDA: ÉXITO sin mover nada, paridad con Pedernal `yaExistia`: no mira la sección, no carga stock de nuevo ni audita otra vez) → la sección no es de esta sucursal (o no existe) → la sección está dada de baja. La fecha del stock NO es una dimensión: es la de la confirmación (hora argentina, la pone el servidor; paridad con Pedernal `hechoEn: contexto.ahora`), no se elige ni se rechaza. Si ninguna razón corresponde, CONFIRMA: entra el stock (una `Operacion` COMPRA y un movimiento por renglón), la parte pasa a RECIBIDA con su compra, quién y cuándo, y queda la auditoría. La razón de módulo y la de rol las decide el guard de la Server Action (`compra_recibir`); las demás, la regla pura de recepción y el caso de uso.

| M | O | P | E | S | Resultado |
|---|---|---|---|---|---|
| APAGADO | OPERADOR | PROPIA | PENDIENTE | PROPIA_ACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | OPERADOR | PROPIA | PENDIENTE | AJENA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | OPERADOR | PROPIA | PENDIENTE | INACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | OPERADOR | PROPIA | RECIBIDA | PROPIA_ACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | OPERADOR | PROPIA | RECIBIDA | AJENA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | OPERADOR | PROPIA | RECIBIDA | INACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | OPERADOR | PROPIA | ANULADA | PROPIA_ACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | OPERADOR | PROPIA | ANULADA | AJENA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | OPERADOR | PROPIA | ANULADA | INACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | OPERADOR | AJENA | PENDIENTE | PROPIA_ACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | OPERADOR | AJENA | PENDIENTE | AJENA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | OPERADOR | AJENA | PENDIENTE | INACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | OPERADOR | AJENA | RECIBIDA | PROPIA_ACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | OPERADOR | AJENA | RECIBIDA | AJENA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | OPERADOR | AJENA | RECIBIDA | INACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | OPERADOR | AJENA | ANULADA | PROPIA_ACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | OPERADOR | AJENA | ANULADA | AJENA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | OPERADOR | AJENA | ANULADA | INACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | ADMINISTRADOR | PROPIA | PENDIENTE | PROPIA_ACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | ADMINISTRADOR | PROPIA | PENDIENTE | AJENA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | ADMINISTRADOR | PROPIA | PENDIENTE | INACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | ADMINISTRADOR | PROPIA | RECIBIDA | PROPIA_ACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | ADMINISTRADOR | PROPIA | RECIBIDA | AJENA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | ADMINISTRADOR | PROPIA | RECIBIDA | INACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | ADMINISTRADOR | PROPIA | ANULADA | PROPIA_ACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | ADMINISTRADOR | PROPIA | ANULADA | AJENA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | ADMINISTRADOR | PROPIA | ANULADA | INACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | ADMINISTRADOR | AJENA | PENDIENTE | PROPIA_ACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | ADMINISTRADOR | AJENA | PENDIENTE | AJENA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | ADMINISTRADOR | AJENA | PENDIENTE | INACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | ADMINISTRADOR | AJENA | RECIBIDA | PROPIA_ACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | ADMINISTRADOR | AJENA | RECIBIDA | AJENA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | ADMINISTRADOR | AJENA | RECIBIDA | INACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | ADMINISTRADOR | AJENA | ANULADA | PROPIA_ACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | ADMINISTRADOR | AJENA | ANULADA | AJENA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | ADMINISTRADOR | AJENA | ANULADA | INACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | GERENTE | PROPIA | PENDIENTE | PROPIA_ACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | GERENTE | PROPIA | PENDIENTE | AJENA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | GERENTE | PROPIA | PENDIENTE | INACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | GERENTE | PROPIA | RECIBIDA | PROPIA_ACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | GERENTE | PROPIA | RECIBIDA | AJENA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | GERENTE | PROPIA | RECIBIDA | INACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | GERENTE | PROPIA | ANULADA | PROPIA_ACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | GERENTE | PROPIA | ANULADA | AJENA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | GERENTE | PROPIA | ANULADA | INACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | GERENTE | AJENA | PENDIENTE | PROPIA_ACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | GERENTE | AJENA | PENDIENTE | AJENA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | GERENTE | AJENA | PENDIENTE | INACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | GERENTE | AJENA | RECIBIDA | PROPIA_ACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | GERENTE | AJENA | RECIBIDA | AJENA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | GERENTE | AJENA | RECIBIDA | INACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | GERENTE | AJENA | ANULADA | PROPIA_ACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | GERENTE | AJENA | ANULADA | AJENA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | GERENTE | AJENA | ANULADA | INACTIVA | RECHAZA_MODULO_NO_ACTIVO |
| ENCENDIDO | OPERADOR | PROPIA | PENDIENTE | PROPIA_ACTIVA | RECHAZA_SIN_PERMISO |
| ENCENDIDO | OPERADOR | PROPIA | PENDIENTE | AJENA | RECHAZA_SIN_PERMISO |
| ENCENDIDO | OPERADOR | PROPIA | PENDIENTE | INACTIVA | RECHAZA_SIN_PERMISO |
| ENCENDIDO | OPERADOR | PROPIA | RECIBIDA | PROPIA_ACTIVA | RECHAZA_SIN_PERMISO |
| ENCENDIDO | OPERADOR | PROPIA | RECIBIDA | AJENA | RECHAZA_SIN_PERMISO |
| ENCENDIDO | OPERADOR | PROPIA | RECIBIDA | INACTIVA | RECHAZA_SIN_PERMISO |
| ENCENDIDO | OPERADOR | PROPIA | ANULADA | PROPIA_ACTIVA | RECHAZA_SIN_PERMISO |
| ENCENDIDO | OPERADOR | PROPIA | ANULADA | AJENA | RECHAZA_SIN_PERMISO |
| ENCENDIDO | OPERADOR | PROPIA | ANULADA | INACTIVA | RECHAZA_SIN_PERMISO |
| ENCENDIDO | OPERADOR | AJENA | PENDIENTE | PROPIA_ACTIVA | RECHAZA_SIN_PERMISO |
| ENCENDIDO | OPERADOR | AJENA | PENDIENTE | AJENA | RECHAZA_SIN_PERMISO |
| ENCENDIDO | OPERADOR | AJENA | PENDIENTE | INACTIVA | RECHAZA_SIN_PERMISO |
| ENCENDIDO | OPERADOR | AJENA | RECIBIDA | PROPIA_ACTIVA | RECHAZA_SIN_PERMISO |
| ENCENDIDO | OPERADOR | AJENA | RECIBIDA | AJENA | RECHAZA_SIN_PERMISO |
| ENCENDIDO | OPERADOR | AJENA | RECIBIDA | INACTIVA | RECHAZA_SIN_PERMISO |
| ENCENDIDO | OPERADOR | AJENA | ANULADA | PROPIA_ACTIVA | RECHAZA_SIN_PERMISO |
| ENCENDIDO | OPERADOR | AJENA | ANULADA | AJENA | RECHAZA_SIN_PERMISO |
| ENCENDIDO | OPERADOR | AJENA | ANULADA | INACTIVA | RECHAZA_SIN_PERMISO |
| ENCENDIDO | ADMINISTRADOR | PROPIA | PENDIENTE | PROPIA_ACTIVA | CONFIRMA |
| ENCENDIDO | ADMINISTRADOR | PROPIA | PENDIENTE | AJENA | RECHAZA_SECCION_NO_ENCONTRADA |
| ENCENDIDO | ADMINISTRADOR | PROPIA | PENDIENTE | INACTIVA | RECHAZA_SECCION_INACTIVA |
| ENCENDIDO | ADMINISTRADOR | PROPIA | RECIBIDA | PROPIA_ACTIVA | CONFIRMA_YA_RECIBIDA |
| ENCENDIDO | ADMINISTRADOR | PROPIA | RECIBIDA | AJENA | CONFIRMA_YA_RECIBIDA |
| ENCENDIDO | ADMINISTRADOR | PROPIA | RECIBIDA | INACTIVA | CONFIRMA_YA_RECIBIDA |
| ENCENDIDO | ADMINISTRADOR | PROPIA | ANULADA | PROPIA_ACTIVA | RECHAZA_YA_ANULADA |
| ENCENDIDO | ADMINISTRADOR | PROPIA | ANULADA | AJENA | RECHAZA_YA_ANULADA |
| ENCENDIDO | ADMINISTRADOR | PROPIA | ANULADA | INACTIVA | RECHAZA_YA_ANULADA |
| ENCENDIDO | ADMINISTRADOR | AJENA | PENDIENTE | PROPIA_ACTIVA | RECHAZA_NO_ES_DE_ESTA_SUCURSAL |
| ENCENDIDO | ADMINISTRADOR | AJENA | PENDIENTE | AJENA | RECHAZA_NO_ES_DE_ESTA_SUCURSAL |
| ENCENDIDO | ADMINISTRADOR | AJENA | PENDIENTE | INACTIVA | RECHAZA_NO_ES_DE_ESTA_SUCURSAL |
| ENCENDIDO | ADMINISTRADOR | AJENA | RECIBIDA | PROPIA_ACTIVA | RECHAZA_NO_ES_DE_ESTA_SUCURSAL |
| ENCENDIDO | ADMINISTRADOR | AJENA | RECIBIDA | AJENA | RECHAZA_NO_ES_DE_ESTA_SUCURSAL |
| ENCENDIDO | ADMINISTRADOR | AJENA | RECIBIDA | INACTIVA | RECHAZA_NO_ES_DE_ESTA_SUCURSAL |
| ENCENDIDO | ADMINISTRADOR | AJENA | ANULADA | PROPIA_ACTIVA | RECHAZA_NO_ES_DE_ESTA_SUCURSAL |
| ENCENDIDO | ADMINISTRADOR | AJENA | ANULADA | AJENA | RECHAZA_NO_ES_DE_ESTA_SUCURSAL |
| ENCENDIDO | ADMINISTRADOR | AJENA | ANULADA | INACTIVA | RECHAZA_NO_ES_DE_ESTA_SUCURSAL |
| ENCENDIDO | GERENTE | PROPIA | PENDIENTE | PROPIA_ACTIVA | CONFIRMA |
| ENCENDIDO | GERENTE | PROPIA | PENDIENTE | AJENA | RECHAZA_SECCION_NO_ENCONTRADA |
| ENCENDIDO | GERENTE | PROPIA | PENDIENTE | INACTIVA | RECHAZA_SECCION_INACTIVA |
| ENCENDIDO | GERENTE | PROPIA | RECIBIDA | PROPIA_ACTIVA | CONFIRMA_YA_RECIBIDA |
| ENCENDIDO | GERENTE | PROPIA | RECIBIDA | AJENA | CONFIRMA_YA_RECIBIDA |
| ENCENDIDO | GERENTE | PROPIA | RECIBIDA | INACTIVA | CONFIRMA_YA_RECIBIDA |
| ENCENDIDO | GERENTE | PROPIA | ANULADA | PROPIA_ACTIVA | RECHAZA_YA_ANULADA |
| ENCENDIDO | GERENTE | PROPIA | ANULADA | AJENA | RECHAZA_YA_ANULADA |
| ENCENDIDO | GERENTE | PROPIA | ANULADA | INACTIVA | RECHAZA_YA_ANULADA |
| ENCENDIDO | GERENTE | AJENA | PENDIENTE | PROPIA_ACTIVA | RECHAZA_NO_ES_DE_ESTA_SUCURSAL |
| ENCENDIDO | GERENTE | AJENA | PENDIENTE | AJENA | RECHAZA_NO_ES_DE_ESTA_SUCURSAL |
| ENCENDIDO | GERENTE | AJENA | PENDIENTE | INACTIVA | RECHAZA_NO_ES_DE_ESTA_SUCURSAL |
| ENCENDIDO | GERENTE | AJENA | RECIBIDA | PROPIA_ACTIVA | RECHAZA_NO_ES_DE_ESTA_SUCURSAL |
| ENCENDIDO | GERENTE | AJENA | RECIBIDA | AJENA | RECHAZA_NO_ES_DE_ESTA_SUCURSAL |
| ENCENDIDO | GERENTE | AJENA | RECIBIDA | INACTIVA | RECHAZA_NO_ES_DE_ESTA_SUCURSAL |
| ENCENDIDO | GERENTE | AJENA | ANULADA | PROPIA_ACTIVA | RECHAZA_NO_ES_DE_ESTA_SUCURSAL |
| ENCENDIDO | GERENTE | AJENA | ANULADA | AJENA | RECHAZA_NO_ES_DE_ESTA_SUCURSAL |
| ENCENDIDO | GERENTE | AJENA | ANULADA | INACTIVA | RECHAZA_NO_ES_DE_ESTA_SUCURSAL |

## Registrar el control de una línea

Orden de las razones (la primera que corresponda): la condición no es de la lista → la observación escrita no pasa la lista de caracteres permitidos → falta la observación y la condición no es CONFORME → la cantidad según remito informada no es un número mayor que cero con hasta 4 decimales. Con CONFORME la observación es opcional. Sin control = «no se constató»: nunca hay un CONFORME por defecto.

| C | B | Q | Resultado |
|---|---|---|---|
| CONFORME | SIN | SIN | GUARDA |
| CONFORME | SIN | VALIDA | GUARDA |
| CONFORME | SIN | INVALIDA | RECHAZA_CANTIDAD_SEGUN_REMITO_INVALIDA |
| CONFORME | VALIDA | SIN | GUARDA |
| CONFORME | VALIDA | VALIDA | GUARDA |
| CONFORME | VALIDA | INVALIDA | RECHAZA_CANTIDAD_SEGUN_REMITO_INVALIDA |
| CONFORME | INVALIDA | SIN | RECHAZA_OBSERVACION_INVALIDA |
| CONFORME | INVALIDA | VALIDA | RECHAZA_OBSERVACION_INVALIDA |
| CONFORME | INVALIDA | INVALIDA | RECHAZA_OBSERVACION_INVALIDA |
| CON_OBSERVACIONES | SIN | SIN | RECHAZA_OBSERVACION_OBLIGATORIA |
| CON_OBSERVACIONES | SIN | VALIDA | RECHAZA_OBSERVACION_OBLIGATORIA |
| CON_OBSERVACIONES | SIN | INVALIDA | RECHAZA_OBSERVACION_OBLIGATORIA |
| CON_OBSERVACIONES | VALIDA | SIN | GUARDA |
| CON_OBSERVACIONES | VALIDA | VALIDA | GUARDA |
| CON_OBSERVACIONES | VALIDA | INVALIDA | RECHAZA_CANTIDAD_SEGUN_REMITO_INVALIDA |
| CON_OBSERVACIONES | INVALIDA | SIN | RECHAZA_OBSERVACION_INVALIDA |
| CON_OBSERVACIONES | INVALIDA | VALIDA | RECHAZA_OBSERVACION_INVALIDA |
| CON_OBSERVACIONES | INVALIDA | INVALIDA | RECHAZA_OBSERVACION_INVALIDA |
| RECHAZADA | SIN | SIN | RECHAZA_OBSERVACION_OBLIGATORIA |
| RECHAZADA | SIN | VALIDA | RECHAZA_OBSERVACION_OBLIGATORIA |
| RECHAZADA | SIN | INVALIDA | RECHAZA_OBSERVACION_OBLIGATORIA |
| RECHAZADA | VALIDA | SIN | GUARDA |
| RECHAZADA | VALIDA | VALIDA | GUARDA |
| RECHAZADA | VALIDA | INVALIDA | RECHAZA_CANTIDAD_SEGUN_REMITO_INVALIDA |
| RECHAZADA | INVALIDA | SIN | RECHAZA_OBSERVACION_INVALIDA |
| RECHAZADA | INVALIDA | VALIDA | RECHAZA_OBSERVACION_INVALIDA |
| RECHAZADA | INVALIDA | INVALIDA | RECHAZA_OBSERVACION_INVALIDA |
| FUERA_DE_LISTA | SIN | SIN | RECHAZA_CONDICION_INVALIDA |
| FUERA_DE_LISTA | SIN | VALIDA | RECHAZA_CONDICION_INVALIDA |
| FUERA_DE_LISTA | SIN | INVALIDA | RECHAZA_CONDICION_INVALIDA |
| FUERA_DE_LISTA | VALIDA | SIN | RECHAZA_CONDICION_INVALIDA |
| FUERA_DE_LISTA | VALIDA | VALIDA | RECHAZA_CONDICION_INVALIDA |
| FUERA_DE_LISTA | VALIDA | INVALIDA | RECHAZA_CONDICION_INVALIDA |
| FUERA_DE_LISTA | INVALIDA | SIN | RECHAZA_CONDICION_INVALIDA |
| FUERA_DE_LISTA | INVALIDA | VALIDA | RECHAZA_CONDICION_INVALIDA |
| FUERA_DE_LISTA | INVALIDA | INVALIDA | RECHAZA_CONDICION_INVALIDA |

## Registrar el control: puerta y estado

Quién y cuándo se puede registrar el control. Orden de las razones: módulo apagado → el rol no llega al piso de `compra_controlar_recepcion` (operario: lo alcanzan los tres roles, el operador también) → la parte no es de esta sucursal → la factura está anulada → la parte ya está recibida (el control solo existe antes de confirmar). Confirmar la recepción sigue siendo de gerente y administrador (tabla «Confirmar la recepción»).

| M | O | P | E | Resultado |
|---|---|---|---|---|
| APAGADO | OPERADOR | PROPIA | PENDIENTE | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | OPERADOR | PROPIA | RECIBIDA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | OPERADOR | PROPIA | ANULADA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | OPERADOR | AJENA | PENDIENTE | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | OPERADOR | AJENA | RECIBIDA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | OPERADOR | AJENA | ANULADA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | ADMINISTRADOR | PROPIA | PENDIENTE | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | ADMINISTRADOR | PROPIA | RECIBIDA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | ADMINISTRADOR | PROPIA | ANULADA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | ADMINISTRADOR | AJENA | PENDIENTE | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | ADMINISTRADOR | AJENA | RECIBIDA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | ADMINISTRADOR | AJENA | ANULADA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | GERENTE | PROPIA | PENDIENTE | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | GERENTE | PROPIA | RECIBIDA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | GERENTE | PROPIA | ANULADA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | GERENTE | AJENA | PENDIENTE | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | GERENTE | AJENA | RECIBIDA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | GERENTE | AJENA | ANULADA | RECHAZA_MODULO_NO_ACTIVO |
| ENCENDIDO | OPERADOR | PROPIA | PENDIENTE | GUARDA |
| ENCENDIDO | OPERADOR | PROPIA | RECIBIDA | RECHAZA_YA_RECIBIDA |
| ENCENDIDO | OPERADOR | PROPIA | ANULADA | RECHAZA_YA_ANULADA |
| ENCENDIDO | OPERADOR | AJENA | PENDIENTE | RECHAZA_NO_ES_DE_ESTA_SUCURSAL |
| ENCENDIDO | OPERADOR | AJENA | RECIBIDA | RECHAZA_NO_ES_DE_ESTA_SUCURSAL |
| ENCENDIDO | OPERADOR | AJENA | ANULADA | RECHAZA_NO_ES_DE_ESTA_SUCURSAL |
| ENCENDIDO | ADMINISTRADOR | PROPIA | PENDIENTE | GUARDA |
| ENCENDIDO | ADMINISTRADOR | PROPIA | RECIBIDA | RECHAZA_YA_RECIBIDA |
| ENCENDIDO | ADMINISTRADOR | PROPIA | ANULADA | RECHAZA_YA_ANULADA |
| ENCENDIDO | ADMINISTRADOR | AJENA | PENDIENTE | RECHAZA_NO_ES_DE_ESTA_SUCURSAL |
| ENCENDIDO | ADMINISTRADOR | AJENA | RECIBIDA | RECHAZA_NO_ES_DE_ESTA_SUCURSAL |
| ENCENDIDO | ADMINISTRADOR | AJENA | ANULADA | RECHAZA_NO_ES_DE_ESTA_SUCURSAL |
| ENCENDIDO | GERENTE | PROPIA | PENDIENTE | GUARDA |
| ENCENDIDO | GERENTE | PROPIA | RECIBIDA | RECHAZA_YA_RECIBIDA |
| ENCENDIDO | GERENTE | PROPIA | ANULADA | RECHAZA_YA_ANULADA |
| ENCENDIDO | GERENTE | AJENA | PENDIENTE | RECHAZA_NO_ES_DE_ESTA_SUCURSAL |
| ENCENDIDO | GERENTE | AJENA | RECIBIDA | RECHAZA_NO_ES_DE_ESTA_SUCURSAL |
| ENCENDIDO | GERENTE | AJENA | ANULADA | RECHAZA_NO_ES_DE_ESTA_SUCURSAL |

## Entradas de la confirmación

Qué se hace con los destinos `{ renglón, sección }` de una confirmación que ya pasó las reglas de la tabla «Confirmar la recepción» (módulo, rol, parte, estado, secciones). UN solo destino por renglón, que recibe la cantidad TOTAL del renglón (paridad con Pedernal: una asignación por línea; dividir un renglón entre secciones no está permitido y no hay pedido del dueño que lo pida). El control de la línea (K) NO cambia cuánto stock entra: una línea RECHAZADA entra igual en la sección que elige quien recibe, y una sin control también. CONFIRMA: entra una línea del Kardex por renglón, con la cantidad y el precio del renglón tal cual.

| N | K | Resultado |
|---|---|---|
| UNA_SECCION | SIN_CONTROL | CONFIRMA |
| UNA_SECCION | CONFORME | CONFIRMA |
| UNA_SECCION | CON_OBSERVACIONES | CONFIRMA |
| UNA_SECCION | RECHAZADA | CONFIRMA |
| DOS_SECCIONES | SIN_CONTROL | RECHAZA_ENTRADA_REPETIDA |
| DOS_SECCIONES | CONFORME | RECHAZA_ENTRADA_REPETIDA |
| DOS_SECCIONES | CON_OBSERVACIONES | RECHAZA_ENTRADA_REPETIDA |
| DOS_SECCIONES | RECHAZADA | RECHAZA_ENTRADA_REPETIDA |
| MISMA_SECCION_DOS_VECES | SIN_CONTROL | RECHAZA_ENTRADA_REPETIDA |
| MISMA_SECCION_DOS_VECES | CONFORME | RECHAZA_ENTRADA_REPETIDA |
| MISMA_SECCION_DOS_VECES | CON_OBSERVACIONES | RECHAZA_ENTRADA_REPETIDA |
| MISMA_SECCION_DOS_VECES | RECHAZADA | RECHAZA_ENTRADA_REPETIDA |

## Entradas de la regla de confirmar y su efecto

Cada entrada de `decidirConfirmacionDeRecepcion` declara la dimensión a la que responde o «no afecta» con su motivo. Una entrada nueva obliga a decidir acá si cambia el resultado.

| Entrada | Efecto |
|---|---|
| esDeLaSucursalDelActor | P |
| facturaAnulada | E |
| estadoDeLaParte | E |
| seccion | S |

## Entradas de la regla de registrar el control y su efecto

Cada entrada de `decidirRegistroDeControl` y de `validarControlDeLinea` declara la dimensión a la que responde o «no afecta» con su motivo. Una entrada nueva obliga a decidir acá si cambia el resultado.

| Entrada | Efecto |
|---|---|
| esDeLaSucursalDelActor | P |
| facturaAnulada | E |
| estadoDeLaParte | E |
| condicion | C |
| observacion | B |
| cantidadSegunRemito | Q |

## Entradas de la regla de las entradas de stock y su efecto

Cada campo de un destino de stock y cada renglón que recibe `validarEntradasDeRecepcion`. La condición del control (K) NO cambia el stock que entra. La cantidad ya no es una entrada: es siempre la total del renglón.

| Entrada | Efecto |
|---|---|
| renglonId | N |
| seccionId | N |
| renglones | N |

## Estados y reglas que el código declara

Los estados de recepción de la base son exactamente PENDIENTE y RECIBIDA (la dimensión E suma ANULADA, que sale de la factura y no de la parte). El módulo `recepcion_de_compras` requiere `compras` y la acción `compra_recibir` es de ese módulo, de la sucursal y de piso administrador; la acción `compra_controlar_recepcion` (N3-b) es de ese módulo, de la sucursal y de piso operario (semilla admin y operador): así lo verifica el guardián. Los valores de la condición del control son exactamente los del CHECK `ControlDeLineaDeRecepcion_condicion_chk` de la base.

## Límite conocido: apagar el módulo con partes pendientes (2026-11-17, hallazgo del verificador del PR #364)

Si la plataforma apaga `recepcion_de_compras` en una empresa que tiene partes de factura en `estadoRecepcion = PENDIENTE`, esas partes quedan sin camino para recibirse: la acción `compra_recibir` es del módulo y con el módulo apagado el guard la cierra (fila «módulo apagado» de «Confirmar la recepción»); tampoco hay otra pantalla que las reciba. NO está resuelto en el código y NO se agregó una guarda en esta etapa, con este motivo:

- El único mecanismo de guardas de apagado que existe (`validarCambioDeModulos`, `core/modulos/clausura.ts`, usado por `planDeCambioDeModulos`) es PURO y decide solo por dependencias entre módulos (`LO_REQUIEREN_OTROS`): no mira datos. Una guarda por datos (contar partes pendientes) no cabe en él sin rediseñarlo.
- La operación que apaga módulos (`cambiarModulosDeEmpresa`, `server/operaciones-de-plataforma/`) corre con el rol `motor2_plataforma`, que NO tiene ningún privilegio sobre `FacturaProveedorSucursal` (solo `motor2_app` y el dueño). Contar las partes pendientes exigiría darle a la consola de plataforma SELECT sobre una tabla de sucursal (un cambio de privilegios y de aislamiento que decide el dueño) o una función de la base con `SECURITY DEFINER`.
- Hay más de un camino que deja el módulo fuera (apagarlo directo, bajar el techo de un plan, apagar `compras`, que lo requiere): una guarda en uno solo dejaría los otros abiertos.

Mitigación vigente (operativa, sin código): antes de apagar el módulo en una empresa, recibir o anular las partes pendientes (la lista de «Por recibir» de cada sucursal las muestra). Si igual se apagó, volver a encenderlo devuelve el camino: las partes pendientes no se pierden ni cambian. Opción barata a decidir con el dueño si quiere la guarda: un SELECT acotado (solo `COUNT` de partes PENDIENTE de la empresa) para `motor2_plataforma`, con su migración, su prueba de privilegios y la guarda en `cambiarModulosDeEmpresa` y en el cambio de plan. PENDIENTE de decisión del dueño; no se construye sin su pedido.
