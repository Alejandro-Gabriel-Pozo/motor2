# Auditoría de primitivas e invariantes: Motor2 contra Pedernal (FASE 1, solo documentos)

Fecha: 2026-11-12 · Foto de Motor2: commit `a1a9158` (main, con el guardián «todo nace cerrado», PR #229) · Estado de este documento: **borrador para el OK del dueño**. No hay código, ni migraciones, ni cambios de pantalla en este PR.

Anexos (informes completos con `archivo:línea`, en `docs/auditoria-primitivas-pedernal-motor2-anexos/`):

| Anexo | Contenido |
|---|---|
| A | Primitivas del catálogo (producto, opciones, carta, sección, promo, receta, precio, alícuota, unidades) |
| B | Partes (cliente, proveedor, consignante), sucursal, empresa, medios de pago, usuarios y permisos |
| C | Catálogo de invariantes (INV-01 a INV-175) y brecha documento ↔ código (HALL-01 a HALL-13) |
| D | Diseño visual: tokens, colores sueltos, marca, guardianes, mobile-first |
| E | Lo que dicen los documentos de Pedernal (primitivas, ficha de parte, catálogo, invariantes, diseño, comparaciones, 20 contradicciones internas) |
| F | «Todo nace cerrado»: línea de base, defaults que abren, textos sin forma, columnas sin CHECK |
| (fuera del repo) | 33 capturas a 375 px, entregadas aparte: un PNG dentro de `docs/` rompe el guardián de clasificación de rutas (la regla `documentacion` solo admite `.md`) y ampliarla es un cambio de configuración fuera del alcance de esta fase. Limitaciones en el punto 0.3 |

---

## 0. Límites de esta auditoría (leer primero)

1. **No pude leer el código de Pedernal.** El permiso para agregar `ZuluHub-ERP` fue denegado por el sistema; solo pude agregar `ZuluHub-docs`. Todo lo que digo de Pedernal sale de sus documentos y está marcado **DOC, NO VERIFICADO contra código**. Esto importa: el pedido era verificar contra su código real. Si el dueño habilita el acceso de lectura a `ZuluHub-ERP`, hay que repetir el contraste de la sección 4 (es una pasada corta, ya está armada la lista de qué mirar).
2. **El repo `motor2-docs` no está en esta máquina.** AGENTS.md manda revisarlo antes de auditar un módulo (planes aprobados, ADR, decisiones del dueño). Las brechas «documento ↔ código» se midieron contra `docs/` del propio repo. Puede haber planes aprobados allá que el código todavía no tiene.
3. **Capturas con datos de prueba, no con los datos reales del dueño.** No hay acceso de lectura a producción desde acá. Se levantó una base local descartable con los fixtures de los tests (pizzas, «LB Precio y carta»). **Esto no cumple la regla de maquetas con datos reales del dueño**; sirve para medir ancho y desborde a 375 px, no para que el dueño apruebe nada. Los seeds de demo del proyecto están rotos (ver anexo D §6) y no pude usarlos.
4. **No corrí el gate de 8 comandos**: este PR es solo documentos. Se corrió únicamente lo que se indica en el punto 11.
5. **Los números de Pedernal son los que sus documentos dicen sobre el 8–12/11.** Sus documentos se contradicen entre sí en 20 puntos (anexo E §7); donde importa lo señalo.
6. **Un documento de Pedernal se equivoca sobre Motor2** (verificado contra el código de Motor2, ver 4.3 fila O1). Los 32 «misma entrada, distinta salida» que Pedernal ya listó sobre Motor2 son una foto vieja; por eso sólo marco como verificadas las filas que comprobé contra el código de hoy.

Estados de cada decisión: **CONFIRMADA** (la dijo el dueño), **PROPUESTA**, **PENDIENTE**, **NO VERIFICADA**.

---

## 1. Resumen ejecutivo

1. **Motor2 no tiene la primitiva «Parte».** Cliente (`schema.prisma:756`) y Proveedor (`:636`) son modelos separados. Cliente tiene solo nombre y % de descuento. Proveedor tiene CUIT bien validado, contacto como texto libre y nada más de la ficha que describió el dueño. No existen naturaleza, DNI/CUIL/CDI/pasaporte, domicilio, nota de 2.000, ni los vínculos Contacto / Agente de. El «consignante» es un Proveedor referenciado desde Producto.
2. **El catálogo de Motor2 es más rico en opciones y más pobre en clases que el de Pedernal**: 2 clases de producto (MP, PV) contra 5; sin nombre de cocina propio; sin `se_vende` calculado; pero con recargos por porcentaje o negativos, tope «hasta N», promos con cupos y carta con tema por sucursal, que Pedernal decidió no tener (o dejó para después).
3. **Motor2 tiene 175 invariantes catalogadas** (anexo C): 69 las sostiene la base de datos, 21 el núcleo, 25 la capa de servidor, 9 solo un guardián de CI y **1 depende solo del frontend** (INV-44). 45 viven solo en la capa de aplicación, sin respaldo en la base.
4. **Hay 14 tablas con restricciones en la base que ninguna línea de `src/` escribe** (HALL-04) y otras 6 tablas de «combinaciones» retiradas pero todavía en el esquema. Contra la regla del dueño «nada de tablas a ciegas».
5. **Hallazgo fiscal**: ninguna pantalla ni acción escribe `Producto.alicuotaIvaVenta/Compra`. Todo producto de producción queda «sin declarar» (la emisión debe fallar cerrado; no verifiqué cómo reacciona el resto). Pedernal exige alícuota para vender.
6. **Diseño visual: Motor2 ya está casi en «lista cerrada»** (≈25 tokens, contraste medido por test; 0 clases de color arbitrarias; 2 desvíos reales en la app principal). **La brecha grande es la marca**: 64 claves de tema por sucursal (31 de color) + 22 por empresa, validadas solo por sintaxis y sin control de contraste. El dueño pidió hoy: lista cerrada del sistema, libre solo la marca por sucursal y por empresa (**CONFIRMADA**).
7. **Mobile-first: el código lo es** (base celular, `sm:`/`md:`), **pero hay 12 archivos con tablas sin scroll** y dos pantallas que desbordan a 375 px (usuarios, sucursales). No existe un barrido e2e de todas las rutas a 375 px.
8. **Fallo cerrado**: el guardián de PR #229 detecta 21 validaciones por lista de prohibidos (11 deuda real, 6 falsos positivos, 3 redundantes, 1 en negativo). No ve lo más serio: **defaults que abren** (el formulario de contenido de producto viene con «Se muestra en la carta» tildado por `?? true`, contra la propia columna `DEFAULT false`), textos libres validados solo por largo (pasan caracteres bidi e invisibles), y ~10 columnas categóricas sin CHECK en la base.
9. **Riesgo de dinero y concurrencia fuera del pedido (aviso)**: editar precio y título de una promo pisa sin control optimista (R1); alta de Cliente sin transacción serializable y con único que distingue mayúsculas (dos «Ana»/«ana» simultáneos, o un 500). Detalle en la sección 10.
10. **Plan**: 14 pasos chicos (sección 8), el primero es una línea de pantalla; **la ficha de parte es una etapa posterior con nombre** y exige autorización expresa por tocar `prisma/`. **La pregunta clave** para el dueño está en la sección 9.

---

## 2. Catálogo de primitivas de Motor2

«Primitiva» acá = pieza de negocio con identidad propia, que se pide al cargar, se compone de otras y es referenciada por otras. **No confundir** con el cerco `primitivas-de-dominio` ya existente (`test/arquitectura/cerco-primitivas-de-dominio.test.ts`), que vigila la validación de importes y porcentajes: mismo nombre, otro concepto. Se propone nombrar este catálogo «catálogo de primitivas de negocio» para no chocar.

Convenciones que valen para TODAS (verificadas, anexo A §cabecera): `empresaId` por defecto desde el contexto (`app_empresa_actual()`) + FK compuestas `(empresaId, id)` (95 únicos de ese tipo) + RLS `aislamiento_empresa`; mutación = Server Action fina → guard de formato → caso de uso con ficha `@contract/@idempotency/@transaction` → persistencia; dinero en `Decimal(14,2)`/`(14,4)` con `decimal.js`, `IMPORTE_MAXIMO = 1e12`, máximo 2 decimales, se rechaza (no se redondea); nombres de catálogo con lista de permitidos `^[\p{L}\p{N} \-.,()%&/'_]+$`, 80 caracteres; nada se borra (se desactiva o anula); auditoría por columna en `RegistroAuditoria`.

### 2.1 Tabla de primitivas

| Primitiva | Qué es | Qué se pide al cargarla | De qué se compone | La referencian | Ciclo de vida | Dónde vive |
|---|---|---|---|---|---|---|
| **Producto** | Fuente de verdad del catálogo (compartido entre sucursales). Solo 2 clases: `MP` y `PV` (enum `TipoProducto`, inmutable). «Semielaborado» = MP con `seProduce`; «base configurable» = `modoDeVenta` | Obligatorio: nombre (≤80, permitidos), tipo, unidad de stock, factor de conversión. Opcional: código (autogenerado), categoría, unidad de compra, insumo, precio (default 0), paso de venta, consignación, observaciones (≤500) | Insumo, presentaciones (apagadas por interruptor), receta, grupos/opciones admitidos | ≥25 tablas (receta, stock, carta, cuenta, factura, precio local…) | Nunca se borra. Baja = apagar disponibilidad por sucursal (bloquea con receta vigente o saldo). El alta **no se audita**; la edición audita por columna salvo nombre, categoría, insumo, observaciones | `schema:353`, `src/core/catalogo/*`, `src/server/actions/catalogo/productos.ts`, `src/app/(app)/catalogo/productos/` |
| Variante de producto | **No existe como entidad.** «Variante» es un tipo de grupo de opciones | — | — | — | — | `src/core/opciones/tipos.ts:14` |
| **Grupo de opciones / Opción / Versión de opción** | «Elemento configurable»: 4 tipos de grupo (`MEDIDA, VARIANTE, INCLUIDA, ADICIONAL`); grupo **compartido entre productos**; versión de opción append-only con diferencia de precio MONTO o PORCENTAJE (puede ser negativa) | Grupo: nombre (único sin distinguir mayúsculas), tipo (inmutable), mínimo 0–10, máximo 1–10, prefijo en carta. Opción: nombre, orden, descripción en carta (≤120) | `ConsumoDeOpcion` (qué insumo suma o reemplaza), `ProductoAdmiteGrupo/Opcion` (admisión por producto con precio propio) | Producto, línea de cuenta (foto congelada), carta | Nunca se borran: se archivan. Versiones y consumos solo se agregan | `schema:3559-3800`, `src/core/opciones/*` |
| **Carta** | **No hay modelo «Carta».** Se arma por sucursal con sección, contenido por producto, ítem agrupado, género, promos y descuento por producto | — | `SeccionCarta` (de la empresa), `ContenidoCartaProducto`, `ItemAgrupadoCarta`, `GeneroCarta`, promos, `TemaCartaSucursal` | Carta pública, POS | Publicada por sucursal (`SucursalPublica.publicada`, nace `false`) | `schema:1840-2260` |
| Sección de carta | Agrupador de la carta | Título, descripción, imagen, orden | — | Contenido de producto, ítems | Se desactiva | `schema:1843-1850` |
| Contenido de carta del producto | Lo que dice la carta de ese producto en esa sucursal | `visibleEnCarta` (nace `false`), sección, `nombreEnCarta` (≤80), descripción (≤500), tags (≤8×30) | — | Carta | Por sucursal; el nombre en carta pasa por estados `pendiente / propio / confirmado igual al interno` | `schema:1880-1900`, `src/core/carta/nombre-en-carta.ts` |
| **Promo** | De la empresa; cada sucursal la prende con `PromoCartaSucursal`. «Toda la sección» es un cupo `SECCION` resuelto en vivo. «Solo salón» filtrado en un único lugar que falla cerrado | Título, descripción, precio, cupos | Cupos y entradas de cupo | Cuenta (copia del título) | Nace `activa=true` y pública (ver D2 en 7.2) | `schema:2018-2200`, `src/core/pos/promo-combo.ts` (en vuelo, PR #230) |
| **Receta / ficha técnica** | Append-only; la vigente es `MAX(version)`; central o por sucursal. La «ficha de cocina» **no es tabla**, es vista derivada | Ingredientes, rendimiento (en cabecera de cada versión) | `RecetaIngrediente` | Producto (PV o MP que se produce), stock | Nunca se pisa | `schema:660-760`, `docs/diseno-ficha-de-cocina-2026-11-08.md` |
| **Precio e historial** | **No hay lista de precios ni vigencia por fecha.** Hay: precio global del producto, precio local por sucursal (capacidad `precio_local`) y descuento por sucursal. El historial es la auditoría genérica (valores como texto). El precio de la línea vendida se congela | Importe 0–1e12, ≤2 decimales | — | Cuenta, carta | Cambio con «precio visto» (control optimista) en producto y local; **la promo no lo tiene** (R1) | `src/core/datos/importe.ts`, `test/arquitectura/cerco-escritores-de-precio-con-visto.test.ts` |
| **Alícuota de IVA** | 8 códigos (`IVA_0 … NO_GRAVADO`), con CHECK en la base. **Sin escritor en `src/`** | — | — | Emisión fiscal | NULL = «sin declarar» | `src/core/fiscal/iva.ts:11` |
| Unidad / Categoría («rubro») | Unidad con magnitud y decimales 0–6, **sin conversión entre unidades**. Rubro y categoría son lo mismo (`CategoriaProducto`) | Nombre | — | Producto | — | `schema:557` |
| **Cliente** | Persona o empresa con descuento fijo en la cuenta del salón. **No distingue persona de empresa** | Nombre (≤80, permitidos), descuento % (0 ≤ % < 100, 2 decimales) | — | `Cuenta`, `Operacion` | Se activa/desactiva; el % se congela en la cuenta al asignarlo | `schema:756`, `src/server/actions/clientes/` |
| **Proveedor** (y «consignante») | Quién nos vende. «Consignante» = Proveedor referenciado por `Producto.proveedorConsignacionId` | Nombre (único sin distinguir mayúsculas, ≤80), CUIT (11 dígitos, prefijo ARCA, módulo 11, único por empresa), contacto ≤120 (texto), teléfono ≤40 (sin formato), correo ≤254 (regex simple), condiciones de pago ≤200, notas ≤500, ofrece productos/servicios | `ProveedorPorProducto`, facturas, `PagoConsignante` | Compras, consignación | Se desactiva. `condicionIva` y `PuntoDeVentaDeProveedor` existen en la base sin escritor | `schema:636` |
| Vínculos entre partes, convenios | **No existen** (solo en `docs/diseno-clientes-convenios-…-2026-10-26.md`) | — | — | — | — | grep sin resultados |
| **Sucursal** | Local. Nombre, activa, `maxMesasAbiertas` (sin uso). **Sin datos fiscales, domicilio, teléfono, correo ni punto de venta** | Nombre | — | Casi todo | Se desactiva; se crea con su primer admin en transacción SERIALIZABLE | `schema:127` |
| **Empresa** (tenant) | Nombre, slug, CUIT (lo confirma la plataforma al activar), zona horaria, moneda fija ARS, estado, `condicionIva` y `llevaIvaDeCompras` (ambos sin escritor en código). **Sin razón social, domicilio ni contacto** | Lo carga la plataforma | — | Todo | Alta por solicitud en la consola `plataforma/` | `schema:2492` |
| **Marca / tema** | No son columnas: `TemaCartaSucursal.valores` (JSON, 64 claves) y `PortalCartaEmpresa.valores` (22 claves). `MARCA_PUBLICA = "Hoteles del Neuquén"` está escrita en el código | Colores, tipografías, tamaños | — | Carta pública | Borrador (`aplicarEnCarta=false`) o publicado | `src/core/carta/tema.ts` |
| **Medios de pago / caja / cobro** | **No existen como entidad.** Solo una lista fija de 5 medios usada para pagar facturas de proveedor. «Cerrar cuenta» vende y descuenta stock pero no cobra. La cabecera `Venta` está en el esquema y nadie la escribe | — | — | — | — | `MEDIOS_DE_PAGO` |
| **Usuarios, roles, permisos** | Lo más maduro: membresía usuario-sucursal con rol por sucursal; matriz `PermisoRol` con 137 claves y pisos de nivel; decisión: membresía → módulo → capacidad de sucursal → rol; RLS por empresa y por sucursal; invitaciones con token hasheado (7 días); 6 invariantes de gobierno; login solo con Google | — | — | Todo | — | `src/core/permisos/*` |

### 2.2 La ficha de «parte» que pidió el dueño, campo por campo (CONFIRMADA como pedido; ninguno existe)

| Campo de la ficha (pedido del dueño) | Cliente (Motor2) | Proveedor (Motor2) | Pedernal (doc, NO VERIFICADO contra código) |
|---|---|---|---|
| Naturaleza: persona (humana) o empresa (jurídica); de ella dependen datos y vínculos | No existe | No existe | `naturaleza HUMANA\|JURIDICA`; una JURIDICA solo admite CUIT o ID extranjero (CHECK) |
| Nombre y apellido (apellido opcional) + alias | Solo `nombre` | Solo `nombre` | `nombre` 1–200, `apellido` ≤100 solo HUMANA, `alias` ≤100 |
| Documento: CUIT, CUIL, CDI, DNI, pasaporte | No | Solo CUIT (validado) | 6 tipos (+ ID extranjero); `cuit_valido()`; DNI `^[1-9][0-9]{5,8}$`; pasaporte 6–9; CUIT=CUIL=CDI del mismo número es la misma clave; único por empresa **incluso inactivas** |
| Condición frente al IVA | No | Columna sin uso (3 valores de **emisor**, no de receptor) | 11 valores del receptor (WSFE v4.8), solo valor sugerido |
| Contacto: correo y teléfono | No | Correo (regex mínima), teléfono (texto libre ≤40) | email ≤254, teléfono con forma y 6–15 dígitos; solo contacto (no único) |
| Domicilio: argentino estructurado con provincia; exterior una línea | No | No | Estructurado (tabla `provincia`) o `dom_texto` ≤300; «completo o ninguno» |
| Nota hasta 2.000 caracteres | No | `notas` ≤500, solo largo | `nota` ≤2000 |
| Vínculo **Contacto** (cargo opcional) | No | `contacto` es un texto | Tabla de vínculos; contacto HUMANA |
| Vínculo **Agente de** (persona que consume por cuenta de una empresa que paga) | No | No | Agente HUMANA, otra punta JURIDICA; una persona puede ser agente de varias |
| Una sola ficha para cliente y proveedor | No: dos modelos | | Una `parte` por empresa con roles `CUSTOMER`/`PROVEEDOR` (decidido 2026-10-15) |

Dos hallazgos que cambian cómo leer la comparación: (a) la lista de 3 condiciones de IVA de Motor2 describe a **quien emite** (la empresa) y Proveedor la reutilizó; las 11 de Pedernal describen a **quien recibe** el comprobante. No es «3 contra 11» de la misma cosa: es otro concepto, y mezclarlos sería un error de modelo. (b) La auditoría de Motor2 guarda **valores** como texto; Pedernal decidió auditar la ficha de parte **sin valores** (qué campo cambió, nunca el dato). Si Motor2 suma DNI/domicilio a la ficha, hay que decidir esto antes (dato personal).

### 2.3 Cosas que existen con otro nombre (inventario antes de crear nada)

- «Consignante» = Proveedor (+ `PagoConsignante`, que no se puede anular ni lleva medio de pago).
- «Rubro» = `CategoriaProducto`. «Semielaborado» = MP con `seProduce`. «Nombre de ticket» = `CuentaItem.nombreEnTicket` (congelado).
- «Convenio», «agente de», «contacto estructurado», «cliente persona/empresa»: no existen; solo diseño en papel.
- Tablas huérfanas (sin lector ni escritor en `src/`): `GrupoDePrecio`, `CombinacionDeProducto`, `PrecioLocalDeCombinacion`, `RecetaDeCombinacionVersion`, `RecetaDeCombinacionIngrediente`, `CombinacionEnLinea`; y, con reglas completas en la base, las de notas de crédito de proveedor, gastos, centros de costos, puntos de venta de proveedor (14 tablas, HALL-04; más las 6 de combinaciones). Esto es lo que Pedernal ya señaló como «migrar sin código que lo use».

### 2.4 El catálogo propio de Motor2 (PROPUESTA)

El dueño pidió que Motor2 tenga **su propio catálogo de primitivas e invariantes**. Lo más barato:

1. Un documento vivo `docs/catalogo-de-primitivas-motor2.md` (la tabla 2.1, ampliada con estados y la ficha de cada una) y `docs/catalogo-de-invariantes-motor2.md` (el anexo C con sus INV-xx), **sin tablas nuevas**.
2. Un guardián de trinquete: falla si aparece un modelo Prisma que no figura en el catálogo (declarado como «primitiva» o «parte de»), con la misma mecánica de línea de base y vencimiento que los demás. Hoy el cerco `columnas-de-significado` ya hace algo parecido a nivel de columna.
3. Cada invariante lleva su id, capa que la hace cumplir y test.

Estado: **PROPUESTA** (paso 14 del plan). No se construye hasta el OK.

---

## 3. Catálogo de invariantes de Motor2

El inventario completo (125 invariantes agrupadas en 10 primitivas, con numeración INV-01…INV-175) está en el **anexo C**. Resumen:

| Capa que la sostiene | Cantidad |
|---|---:|
| Base de datos (CHECK / único / FK / trigger / RLS / grants) | 69 |
| Núcleo (regla pura o guard) | 21 |
| Acción o caso de uso de servidor | 25 |
| Solo un guardián de arquitectura (test de CI) | 9 |
| **Solo UI / frontend** | **1** (INV-44) |
| Total | 125 |

Parcialmente en frontend (la regla de dato está en servidor, pero una parte es solo pantalla): INV-48, INV-70, INV-140. **45 invariantes viven solo en la capa de aplicación, sin respaldo en la base**: cualquier script, seed o SQL directo las salta. Sin test dedicado o con cobertura no verificada: INV-10, 16, 29, 41, 49, 137, 141, 144, más varios índices únicos de nombre.

Inventario de la capa BD: 112 modelos y 11 enums; 158 migraciones (99 con `down.sql`); 238 líneas CHECK; 206 `@@unique`; 24 índices únicos parciales; 14 triggers; 106 tablas con RLS, **0 con `FORCE`** (ver 4.2); 57 FK `Restrict` y 10 `Cascade`; 200 guardianes de arquitectura.

### 3.1 Brecha documento ↔ código (lo declarado que el código no cumple)

| Id | Lo declarado | Lo hallado |
|---|---|---|
| HALL-01 | Convenios y facturación externa (invariantes I1–I12 PROPUESTA) | Ni un modelo ni una línea de «convenio» |
| HALL-02 | Nombre de producto único | La app mira productos *disponibles*; la base los cuenta a *todos*: un nombre repetido de un producto no disponible pasa la app y la base lo rechaza con el mensaje equivocado («Ya existe un producto con ese código») |
| HALL-03 | Pagos y conciliación: N:N, tolerancia, «quien aprueba no es quien carga» | Solo existe un pago por factura, sin importe ni moneda; ninguna regla pagador ≠ cargador |
| HALL-04 | Servicios, notas de crédito, centros de costos | Tablas y CHECK en la base, sin escritor (14 tablas) |
| HALL-05 | Alícuota solo válida en el tipo de producto correcto | Ningún escritor |
| HALL-06 | CUIT de empresa inmutable desde la primera factura | No hay circuito fiscal; hoy el CUIT se puede cambiar |
| HALL-07 | Ver ⊇ Editar | Solo al escribir la matriz; no hay CHECK ni corrección al leer |
| HALL-09 | % de cliente con 0 < % < 100 | El código acepta 0; la columna `Decimal(5,2)` no tiene CHECK (acepta hasta 999,99) |
| HALL-10 | Todo nace cerrado | Ver sección 7 |
| HALL-12 | Toda compra nueva pertenece a una factura | Solo lo vigila un guardián; un INSERT directo lo salta |

---

## 4. Comparación con Pedernal

Todo lo de Pedernal es **DOC, NO VERIFICADO contra código** (límite 0.1). Para cada fila indico si el lado Motor2 está **verificado en el código de hoy (V)** o es de documentos.

### 4.1 Primitivas

| Primitiva | Motor2 | Pedernal (doc) |
|---|---|---|
| Parte única con roles | No (Cliente y Proveedor separados) | Sí (`parte`, `parte_rol`, `parte_vinculo`) |
| Naturaleza, documento de 6 tipos, domicilio estructurado, nota 2.000, vínculos | No | Sí (servidor en main, sin pantalla, según su mapa del 12/11) |
| Clases de producto | 2 (MP, PV) | 5 (materia prima, insumo, reventa, elaborado, vendible; inmutables) |
| `se_vende` calculado (clase + alícuota + no «falta completar») | No | Sí (columna generada) |
| Nombre de cocina propio | No (usa el interno) | Sí (≤80) |
| Precio por empresa y por sucursal, solo inserción, vigente por instante | No: cascada de precio global/local, historial en auditoría | Sí |
| Recargo en %, negativo, tope «hasta N», grupos compartidos, adicional como línea hija | **Sí** (V) | **No** (decisión 138, 9/11: solo monto ≥ 0; grupos propios del producto; sin tope) |
| Promos con cupos, «toda la sección», solo salón, menú del día, género/agrupado, descuento tachado | **Sí** (V) | Fuera de la 1.ª versión |
| Tema de carta por sucursal y portal por empresa | Sí (64 + 22 claves libres) | Lista cerrada de 4 tokens; luego (relayado 11/11) color de marca libre con control de contraste |
| Ocultar (dos alcances, independiente de desactivar, bloquea con existencia ≠ 0) | Disponibilidad por sucursal (V) | Especificado el 12/11, sin código |
| Caja, cobros, medios de pago, venta rápida, facturación | **No** (V) | Servidor en main, sin pantallas |
| Consignación, traspasos con aprobación, 26 reportes | **Sí** (V) | Fuera de la 1.ª versión |
| RLS forzada | No (0 tablas con `FORCE`, V) | Sí |

### 4.2 Invariantes (Pedernal las lista; contraste con Motor2)

| Invariante | Motor2 | Pedernal |
|---|---|---|
| Aislamiento por empresa con FK compuestas y RLS | Sí (V), RLS sin `FORCE` | Sí, RLS **forzada** + contexto firmado que falla cerrado |
| Escritura SERIALIZABLE con reintento | Sí (V, INV-173) | Sí |
| Dinero exacto | Sí (V: `decimal.js`, rechaza en vez de redondear) | Sí; redondeo único sobre el total; tope 999.999.999,99 (propuesta) |
| Auditoría solo inserción | Sí (V), guarda valores | Sí, **sin valores** en la ficha de parte |
| Idempotencia | Clave **global** única (ADR-028, V) | Clave **única por empresa** (evita oráculo de existencia entre empresas) |
| Un documento, una parte, por empresa, incluidas las inactivas | No aplica (sin documento en Cliente); CUIT único por empresa en Proveedor (V) | Sí |
| Nada se borra, se anula | Sí (V) | Sí |
| Validación por lista de permitidos | Parcial: 21 excepciones + defaults abiertos (sec. 7) | P1/P2 «una sola vez en la primitiva» |
| ADR-008: controles de negocio «permitir por defecto» | No documentado así | Sí, en tensión con «todo nace cerrado» (su contradicción C-17: no hay una frase que ordene las dos capas) |

Para Motor2 la lectura que propongo (PROPUESTA, la decide el dueño): reglas de **autorización, exposición pública y datos → cerrado**; reglas de negocio operativas (stock negativo, diferencia de caja) → configurables. Es lo que ya hace el guardián.

### 4.3 Oráculo: misma entrada, distinta salida

Convención: **V** = lado Motor2 verificado en el código de hoy; **D** = solo documentos. Pedernal siempre **D**.

| # | Entrada | Motor2 (hoy) | Pedernal (doc) |
|---|---|---|---|
| O1 | Nombre de producto `¿Querés papas?` | **Rechaza** (V: `RE_TEXTO_CATALOGO` no admite `¿ ? ¡ ! $`, `src/core/texto.ts:60`; también el nombre en carta, `contenido-producto.guard.ts:30`) | Admite (decisión Q3 del dueño, 12/11). **Su documento dice que Motor2 «los acepta»: es falso hoy** |
| O2 | `Combo 2x1 50% off` | Acepta (V: `%` y `&` están permitidos) | Antes de Q3 no pasaba; desde Q3, sí |
| O3 | `Precio $500` / `Pizza muzza!` | Rechaza (V) | Admite desde Q3 (pendiente qué pasa con el PDF fiscal) |
| O4 | Nombre que empieza con `-` (ej. `-A1`) | Rechaza (V, defensa contra fórmulas de planilla) | NO VERIFICADO |
| O5 | Dos proveedores `Ana` y `ana` | Rechaza el segundo (V: índice único sobre `lower(nombre)`) | Admite: el nombre no es único, solo el documento |
| O6 | Dos clientes `Ana` y `ana` al mismo tiempo | Dos clientes, o un 500 si el duplicado es exacto (V: la base distingue mayúsculas y la acción no captura el error) | Un documento, una parte; el alta es idempotente por clave |
| O7 | Mismo CUIT en dos fichas de la misma empresa | Rechaza en Proveedor (V); Cliente no tiene CUIT | Rechaza, también si una está inactiva y también si uno es CUIL o CDI del mismo número |
| O8 | Mismo CUIT en dos empresas | Acepta (V) | Acepta |
| O9 | Cliente con DNI `12345678` / `012345678` | No hay campo | Acepta / rechaza (`^[1-9][0-9]{5,8}$`) |
| O10 | Pasaporte `AB123456` | No hay campo | Acepta (6–9 alfanuméricos; el DDL del propio doc sigue con 3–20: su C-4) |
| O11 | Empresa (jurídica) con DNI | No hay naturaleza | Rechaza (CHECK) |
| O12 | Domicilio exterior `10 Downing St, London` / con provincia argentina | No hay domicilio | Acepta (`dom_texto`) / rechaza (exterior no lleva columnas estructuradas) |
| O13 | Nota de 600 caracteres | Proveedor rechaza (V: ≤500); Cliente no tiene nota | Acepta (≤2000) |
| O14 | Condición IVA `MONOTRIBUTISTA_SOCIAL` en un proveedor | Rechaza (V: lista de 3 de emisor) | Acepta (11 de receptor) |
| O15 | Descuento de cliente 0 / 100 / 99,99 | 0 acepta, 100 rechaza, 99,99 acepta (V); el doc de diseño decía 0 < % | El descuento no vive en la ficha (va a ventas) |
| O16 | Agente de una persona / una persona agente de dos empresas | No existe | Rechaza / acepta |
| O17 | Opción con recargo +10 % sobre $10.000 | $1.000 (D; redondeo alejándose del cero, se mueve si cambia el precio base) | Monto fijo; al migrar se convierte con aprobación caso por caso |
| O18 | Opción con recargo −$500 | Acepta (D) | Rechaza (`recargo ≥ 0`) |
| O19 | «Hasta 2 salsas» | Tope por grupo y por producto (D) | Solo «varias»: se pierde el tope |
| O20 | Producto con precio 0 | Ambiguo: «sin dato» o cortesía (hallazgo propio de Motor2, `docs/hallazgo-venta-en-cero-real-vs-legada-2026-11-06.md`) | `0` = cortesía real |
| O21 | Vender un producto sin receta | Rechaza (D: «sin receta no se vende», ADR-033) | Vende con aviso «falta receta» (decisión 140) |
| O22 | Cargar un producto vendible sin alícuota | La columna existe pero **ninguna pantalla la carga** (V); la emisión falla cerrado | No es vendible (`se_vende` calculado) |
| O23 | Costo de una compra de $121 con IVA 21 % (responsable inscripto) | $121 con IVA incluido (D) | $100 neto (D, decisión PC-1 con reserva del contador) |
| O24 | Importe `1.000.000.000,00` | Acepta (V: tope 1e12) | Rechaza (propuesta B3: máximo 999.999.999,99) |
| O25 | Importe `10,005` | Rechaza (V: no redondea) | NO VERIFICADO |
| O26 | `3 × $9,95` con 10 % de descuento | **No verificado** | `80,60`, repartido 26,87 / 26,87 / 26,86 (ADR-006). Ver paso 12: hay que correrlo contra el núcleo de Motor2 |
| O27 | Título de promo con carácter invisible (U+202E) | **Acepta** (V: solo se valida el largo, F §T1) | Rechaza (lista de permitidos) |
| O28 | Color de marca `inherit` / `#12345` / `#ffff00` sobre fondo blanco | Acepta los tres (V: regex `^[a-zA-Z]+$`, hex de 3 a 8 dígitos, sin contraste) | Solo `#rrggbb` en minúsculas y contraste ≥ 4,5:1 (`CONTRASTE_INSUFICIENTE`) |
| O29 | Abrir «Producto» sin contenido de carta | «Se muestra en la carta» **viene tildado** (V: `?? true`, `contenido-del-producto.tsx:147`) | Nace en «no» (decisión 157) |
| O30 | Crear una promo teniendo el permiso de activarla | Queda activa y pública en esa sucursal en el mismo gesto (V) | Nace cerrada (el dueño: «yo creo una promoción y nace sin ninguna sección tildada») |
| O31 | Producto con existencias, «Ocultar» | No existe «Ocultar» (V); la baja por disponibilidad bloquea con receta o saldo | Bloquea con existencia ≠ 0 (y su `desactivar` no lo hace: hallazgo de ellos) |
| O32 | Corte del día de un reporte cerca de medianoche | Hay guardianes de zona horaria Argentina (V: INV-174); no verifiqué cada reporte | Su doc dice que Motor2 corta en UTC: **probablemente desactualizado** |

**Reglas que ambos tienen y dan el mismo resultado** (no hay que tocarlas): las 8 alícuotas de IVA (mismos códigos), CUIT con módulo 11 y único por empresa, aislamiento por empresa con FK compuestas, escritura SERIALIZABLE, precio congelado en la línea vendida, nada se borra, stock al cerrar la cuenta, receta append-only.

### 4.4 Defectos de los prototipos de Pedernal que Motor2 ya evita (para no copiarlos)

Según los documentos de Pedernal (D): `1234.50` se lee como $123.450 en un prototipo; cambiar «precio por» de Caja a Kg infla $258.500 a $6.074.750; doble clic en «Cobrar» cobra directo. Motor2 trata el número con una función central (ADR-038: pregunta cuando es ambiguo, «Se entendió: $ 21.000,00») y deshabilita el botón mientras corre. **No hay que traer esos defectos** al unificar.

---

## 5. Qué es un cambio de BD, de pantalla y de código (y cómo se clasifica cada diferencia)

| Tipo | Qué es | Ejemplos | Costo y cuidado |
|---|---|---|---|
| **(a) Base de datos** | Tabla, columna, CHECK, único, FK, trigger, política RLS, default. **Toca `prisma/` → requiere autorización expresa del dueño.** Aditivo (columna opcional, CHECK `NOT VALID` y luego `VALIDATE`) o destructivo (borrar, estrechar, cambiar tipo). Reversible si tiene `down.sql` que no aborte | Tabla `Parte`, `Empresa.moneda` con CHECK, índice `lower(nombre)` en Cliente | El más caro: hay que probarlo sobre datos reales y avisar antes de lo destructivo |
| **(b) Pantalla** | Solo UI: formulario, valor inicial, tabla, color, texto, orden. No cambia qué acepta el servidor | `?? false`, tabla con scroll, quitar un `text-red-600` | El más barato; se verifica con captura a 375 px |
| **(c) Código o funcionamiento** | Regla de negocio, cálculo, validación, permiso. Cambia qué entrada produce qué salida | Ampliar los caracteres permitidos, recargos en %, «sin receta no se vende», costo neto de IVA | Cambia resultados: necesita oráculo (tabla de combinaciones) y decisión del dueño si es negocio |

### 5.1 Clasificación de cada diferencia

Costo: 1 trivial · 2 chico · 3 medio · 4 grande. «Prisma» = requiere autorización expresa.

| Id | Diferencia | Tipo | Costo | Depende de | Prisma |
|---|---|---|---|---|---|
| X1 | Una sola ficha de parte (cliente + proveedor) | BD + código + pantalla | 4 | Pregunta clave (sec. 9); X2–X9 | **Sí** |
| X2 | Naturaleza persona/empresa | BD (columna + CHECK) + código + pantalla | 2 | X1 o ampliar Cliente/Proveedor | **Sí** |
| X3 | Nombre + apellido opcional + alias | BD + pantalla | 2 | X2 | **Sí** |
| X4 | Documento de 6 tipos con validación | BD + código (reusar `validarCuit`) | 3 | X2 | **Sí** |
| X5 | Condición frente al IVA del receptor (11 valores), distinta de la del emisor (3) | BD (nueva columna o reemplazar CHECK) + código | 3 | X4; no mezclar con `Empresa.condicionIva` | **Sí** |
| X6 | Correo y teléfono con forma | BD + código | 2 | — | **Sí** (solo Cliente; Proveedor ya los tiene) |
| X7 | Domicilio estructurado (tabla `provincia`) o texto del exterior | BD (tabla + columnas + CHECK) + pantalla | 3 | X2 | **Sí** |
| X8 | Nota 2.000 caracteres | BD (CHECK de largo) + código | 1 | — | **Sí** (CHECK) |
| X9 | Vínculos Contacto y Agente de | BD (tabla de vínculos con reglas) + código + pantalla | 4 | X2, X1 | **Sí** |
| X10 | Un documento, una parte, por empresa (también inactivas) | BD (único parcial) + código; **hay que revisar datos reales antes** | 3 | X4 | **Sí** |
| X11 | Descuento fijo fuera de la ficha | código (mover a ventas) | 3 | Decisión del dueño | No |
| X12 | 5 clases de producto, inmutables | BD (enum/CHECK + trigger) + código | 4 | Decisión del dueño | **Sí** |
| X13 | Alícuota obligatoria para vender; pantalla que la carga | código + pantalla (la columna ya existe) | 2 | — | No |
| X14 | Precio por empresa/sucursal, solo inserción, vigencia por instante | BD + código | 4 | X12 | **Sí** |
| X15 | Recargos en % o negativos | código (decisión: ¿Motor2 los conserva?) | 2 | Decisión del dueño | No |
| X16 | Adicional como línea hija vs opción dentro de la línea | código | 4 | Decisión del dueño | No |
| X17 | Tope «hasta N» | código | 2 | Decisión del dueño (Pedernal lo pierde) | No |
| X18 | Grupos propios del producto vs compartidos | BD + código | 4 | Decisión del dueño | **Sí** |
| X19 | «Se muestra en carta» nace en «no» (formulario y columnas) | pantalla (1 línea) + BD default (aditiva) | 1–2 | — | Sí (solo el default de BD) |
| X20 | Nombre de cocina | BD (columna) + pantalla | 2 | — | **Sí** |
| X21 | Cero = cortesía vs «sin dato» | código | 2 | Decisión del dueño | No |
| X22 | Sin receta: ¿rechaza o avisa? | código (regla de negocio) | 2 | Decisión del dueño | No |
| X23 | Costo neto del IVA recuperable | código | 3 | Contador | No |
| X24 | Caracteres `¿ ¡ ? ! $` en nombres | código (ampliar lista de permitidos) | 1 | Decisión del dueño; efecto en ticket/PDF | No |
| X25 | «Ocultar» vs desactivar | código + pantalla | 3 | Decisión del dueño | Posible |
| X26 | Tema: lista cerrada de colores del sistema; libre solo la marca por sucursal y empresa (**CONFIRMADA**) | código (validador del tema) + pantalla | 3 | — | No (el tema es JSON) |
| X27 | Control de contraste al guardar la marca | código | 2 | X26 | No |
| X28 | Paleta de la consola `plataforma/` distinta (azul) | pantalla | 2 | Decisión: ¿es parte del sistema o excepción? | No |
| X29 | Tablas sin scroll a 375 px (12 archivos) y desborde en usuarios y sucursales | pantalla | 2 | — | No |
| X30 | RLS forzada | BD | 3 | Probar que el rol de la app no es dueño de las tablas | **Sí** |
| X31 | Clave de idempotencia por empresa en vez de global | BD + código | 3 | Decisión: la global es deliberada (ADR-028) | **Sí** |
| X32 | Auditoría sin valores para datos personales | código | 2 | X4, X7 | No |
| X33 | Tope de importe 999.999.999,99 | código (+ CHECK opcional) | 1–2 | Decisión; Pedernal lo tiene como propuesta | Opcional |

Lo que **no depende de nadie y es barato**: X13 (pantalla de alícuota), X19, X24 (si el dueño lo decide), X27, X29 y los pasos de «fallo cerrado» de la sección 7.

---

## 6. Diseño visual y colores (anexo D)

### 6.1 Lo que Motor2 tiene hoy

- **Tailwind v4 sin `tailwind.config`**: fuente única `src/app/globals.css` (829 líneas), bloque `@theme static` bajo el contrato `tokens-visuales`. **Lista cerrada de ≈25 colores** (papel, superficie, tinta, borde, marca `#A8431F`, ok/aviso/error con sus tintes, foco, velo, sombra). Contraste medido por test (`tokens-del-sistema-visual.test.ts`: texto ≥ 4,5:1, no texto ≥ 3:1).
- **Sin modo oscuro** (DEC-04): `color-scheme: light`, `dark:` apagado. Verificado: las capturas con y sin tema oscuro son idénticas byte a byte. Coincide con Pedernal («no en v1»).
- **Tipografías**: Geist y Geist Mono para el sistema; Playfair, Lora, Cormorant y Montserrat solo para la carta pública.
- **La consola `plataforma/` tiene su propia paleta** (azul `#1d4ed8`, 9 hex), distinta de la de la app principal.

### 6.2 Colores sueltos (medidos con `rg`)

| Medida | Cantidad | Dónde |
|---|---:|---|
| Hex literales | 54 | 34 en `src/app/globals.css`, 9 en `plataforma/src/app/globals.css`; **11 fuera de esas fuentes** (`campo-color.tsx` ×2, `global-error.tsx` ×2, `tema.ts`, `portada.tsx`, `selector-carta.tsx`, error de carta…) |
| Funciones de color (`rgb/hsl/oklch/color-mix`) | 26 | 11 en `core/carta/color-css.ts` (el saneador), 5 en `navegacion-carta`, 5 en `globals.css`, resto carta pública |
| Clases de color arbitrarias (`bg-[#…]`) | **0** | — |
| Paleta por defecto de Tailwind (`red-500`…) | 1 real | `src/app/page.tsx:10` (`text-red-600`); más `hover:bg-black/[0.03]` en `components/mesas/mesa-card.tsx:106` |
| `style={{color/background}}` | 52 en 9 archivos | 28 en `carta-publica/seccion.tsx`; los de mesas usan `var(--color-*)` |

**Conclusión**: fuera de la carta del cliente y de dos pantallas de último recurso, la app principal ya está en «lista cerrada» con **2 desvíos reales**.

### 6.3 La marca (el lugar donde la lista no está cerrada)

- Por **sucursal**: `TemaCartaSucursal` con 64 claves (31 de color, 5 familias tipográficas, tamaños, opacidades). Por **empresa**: `PortalCartaEmpresa` con 22 claves (8 de color).
- Validación **solo sintáctica** (`sanitizeCssColor`: hex de 3 a 8 dígitos, funciones, y **cualquier palabra de letras como «nombre CSS»**: `inherit`, `initial`…). **No hay control de contraste al guardar**: un color elegido por el cliente puede dar texto ilegible.
- La marca **no toca** la administración ni el POS: solo carta pública y portal.
- Lo pedido hoy por el dueño: lista cerrada del sistema, libre solo la marca por sucursal y empresa (**CONFIRMADA**). Pedernal arrastra una contradicción propia en este punto (su C-2: tema de 4 tokens vs «colores libres» relayado el 11/11). La salida más simple para Motor2 (PROPUESTA): **un color de marca por sucursal y uno por empresa**, con el resto derivado por el sistema y control de contraste; las 31+8 claves de color actuales se reducen a ese color más los derivados. Es un cambio de código del validador y la pantalla (JSON sin migración).

### 6.4 Guardianes que ya existen (líneas de base en `test/arquitectura/cercos/linea-de-base/`)

| Cerco | Línea de base | Límite |
|---|---:|---|
| `colores` / `colores-de-escala` | 1 / 2 | Las excepciones son **por archivo entero**: dentro de `carta-publica/` cualquier color nuevo pasa; no ve nombres CSS ni colores armados por variable |
| `modo-oscuro` | 0 | — |
| `tipografia` | 52 (+ regla dura 0 en carta pública) | No mide interlineado ni pesos |
| `pantallas-con-estructura` | 88 pantallas sin adoptar | Mide adopción de estructura de escritorio, nada de celular |
| `controles-a-mano` | 88 (47 botones, 23 inputs, 16 hidden, 2 selects) | No ve `<a>` con aspecto de botón |

Brecha: **ningún guardián** vigila el contraste del tema del cliente ni que una pantalla se vea bien a 375 px. Toda la deuda vence a 60 días como máximo (inicio 2026-11-06).

### 6.5 Mobile-first

- **Convención**: base celular y `min-width`: `sm:` 112 usos, `md:` 85, `lg:` 22, `max-md:` 41; botones de 44 px; menú en cajón bajo 768 px. El doc `diseno-estructura-de-pantalla-1366x768` **no** cambia eso: optimiza el alto a 1366×768, no es un diseño solo de escritorio (verificado contra el código).
- **Lo que rompe**: 128 `<table>` en 92 archivos y solo 18 `overflow-x-auto`. **12 archivos con tabla sin scroll**: `catalogo/proveedores/comparativa`, `reportes/tickets`, `reportes/rotacion-mesas`, `reportes/compras`, `catalogo/recetas/[productoId]` (+ historial), `traspasos/bandeja`, `admision-de-grupo`, `administracion/sucursales`, `panel-de-maestro-simple`, `ficha-de-cocina-vista`, `gestion-presentaciones`. **`/administracion/usuarios` a 375 px tiene la tabla rota** (cabeceras y celdas se pisan: «adminSi», «Activode Google»); usuarios y sucursales desbordan la página.
- **Pruebas**: 17 de 181 specs e2e fijan un viewport de 430 px o menos. No hay un barrido de todas las rutas a 375 px con `expectSinDesborde`.
- **Capturas**: 33 PNG a 375 px (deviceScaleFactor 2), no versionados en el repo (ver tabla de anexos): admin, login, carta pública (portada, índice, 4 secciones) con variante oscura. **Limitaciones**: datos de fixtures, POS vacío (0 mesas), sin captura de ficha de parte (no existe) ni de clientes. El chip «1 Issue» es del servidor de desarrollo.

---

## 7. Fallo cerrado en cambios (anexo F)

### 7.1 Qué detecta el guardián de PR #229 y qué no

Detecta, solo en `src/`, `plataforma/src/` y `scripts/`: regex de «todo menos esto» (`\p{C}`, `\p{Z}`, `\S`, clases con `<>`, clases negadas), `new RegExp()` equivalentes, `includes/startsWith` contra `<>` o controles. **No ve**: defaults que abren, texto libre validado solo por largo, `z.string()` sin límite, `String` de Prisma sin CHECK, `.sql`. La línea de base está en `test/arquitectura/cercos/linea-de-base/lista-de-prohibidos.json` (no en `linea-de-base/` a secas) y vence el **2027-01-09**; su aprobación consta como «pendiente de aprobar al mergear el PR #229».

La línea de base tiene **21 hallazgos en 19 archivos**: 11 deuda real (armar-menu, css-valores, metadatos, tema, limites, primer-admin, direcciones ×2, enviar, env, promo-combo), 3 redundantes con una lista de permitidos vecina, 1 lista escrita en negativo (`volver.ts:22`), **6 falsos positivos**. Por eso la meta «0» es inalcanzable sin cambiar el detector. Por módulo: 7 en carta/diseño, 2 en catálogo (redundantes), 4 en empresa/correo, 1 en precios, **0 en partes**.

### 7.2 Lo que el guardián no ve (hallazgos propios, anexo F §3)

**Defaults que abren** (la regla del dueño: «nada viene tildado salvo decisión explícita»):

| Id | Dónde | Qué pasa | Tipo | Riesgo |
|---|---|---|---|---|
| D1 | `src/components/carta/contenido-del-producto.tsx:147`, `?? true` | Producto sin contenido: «Se muestra en la carta» viene tildado, contra la columna (`DEFAULT false`) y contra el ejemplo del dueño; además provoca el error «sección obligatoria» | pantalla (1 línea) | Medio |
| D2 | `PromoCarta.activa @default(true)`, `guardar-promo-carta.ts:45,64` | Quien tiene `carta_promo_activar` crea la promo y la prende pública en el mismo gesto | código + BD default | Medio, decide el dueño |
| D3 | `ItemAgrupadoCarta.activo @default(true)` | Ítem agrupado nace visible | BD/código | Medio/bajo |
| D4 | `ProductoAdmiteGrupo.seMuestraEnCarta @default(true)` | Grupo de opciones vinculado nace «leído por la carta» | BD (+ backfill) | Medio |
| D5 | ~50 columnas `Boolean @default(true)`; `PromoCartaSucursal.activa @default(true)` | El default de la base abre aunque el código pase valor explícito (hoy lo pasa) | BD | Bajo |
| D6 | `producto-form.tsx:114` «Activo en todas las sucursales» | Producto nuevo nace vendible en todas las sucursales | pantalla | Medio, decide el dueño |

Ya nacen cerrados (modelo a copiar): `CamposCupos` (`defaultChecked={!!g}`), `wherePromoOfrecidaEn`, `SucursalPublica.publicada=false`, `TemaCartaSucursal.aplicarEnCarta=false`, `PermisoRol.puedeVer/puedeEditar=false`.

**Texto libre solo con largo** (T1, T2): títulos y descripciones de sección, promo, ítem agrupado y producto (salen a la carta pública), y notas/contacto/teléfono de proveedor. Pasan caracteres bidi, de ancho cero y de control (un `\u0000` rompe Postgres con 500). No hay `dangerouslySetInnerHTML` ni JSON-LD, así que el riesgo es de suplantación visual, no de XSS (verificado por grep). Además T3–T5: `Empresa.nombre` solo largo, `moneda` solo `length(3)`, CUIT de ciclo de vida sin forma.

**Columnas categóricas sin CHECK** (de 571 columnas `String`: 81 con CHECK de lista, 23 de largo, 442 sin ninguno; casi todas las de estado o tipo sí tienen): `Empresa.moneda`, `UsuarioEmpresa.rolEmpresa`, `CotizacionDolar.fuente`, `Empresa.cuit`, `Proveedor.cuit`; y ningún nombre de catálogo tiene CHECK de largo en la base (solo el guard de la app).

---

## 8. Plan de refactor propuesto (PROPUESTA, para el OK del dueño; nada se ejecuta en Fase 1)

Orden por costo. Cada paso es un PR chico y reversible, con el gate de 8 comandos (`npx tsc --noEmit`, `npm run lint`, `npm run arquitectura`, `npm run analizar:muerto`, `npm test`, `npm run build`, `npm run plataforma:build`, `npm run test:e2e`) verde en la misma corrida, y mutación → rojo → revertir → verde donde se agregue un guardián. Escribe Sonnet. «Necesidad» = quién la pidió y dónde está escrita.

| Paso | Qué | Necesidad (quién, dónde) | Tipo | Costo | Riesgo | Estado |
|---|---|---|---|---:|---|---|
| 1 | D1: `?? false` + test «el formulario nuevo nace sin tildar» | Dueño 2026-11-11, AGENTS.md «todo nace cerrado» (ejemplo literal) | pantalla | 1 | Bajo. Coordinar con la sesión «antes/después de la carta» | PROPUESTA |
| 2 | `validarTextoDeCarta` único con lista de permitidos (`\p{L}\p{M}\p{N}\p{P}\p{S}\p{Zs}`, largo en caracteres reales) para secciones, promos, ítems, descripción de producto y tema; borra 3 líneas de la línea de base (21 → 18) | AGENTS.md (validación declara lo permitido); anexo F T1/T10 | código | 2 | Medio: cambia qué texto se acepta. Oráculo con casos válidos (acentos, emoji común, saltos de línea) y no válidos (bidi, ancho cero, controles) | PROPUESTA |
| 3 | Un único `esEmailValido` con lista de permitidos (limites, primer-admin, direcciones): baja 4 | Idem | código | 2 | Bajo | PROPUESTA |
| 4 | Un único `urlHttpsPermitida` para armar-menu, css-valores, metadatos: baja 3 | Idem | código | 2 | Bajo | PROPUESTA |
| 5 | `promo-combo.ts:152` y `enviar.ts:37`, `env.ts:32`, `volver.ts:22` en positivo | Idem | código | 1 | **`promo-combo.ts` es del PR #230 en vuelo: no tocar hasta que mergee** | PROPUESTA |
| 6 | Declarar los 6 falsos positivos con marca explícita o fijar la meta del cerco en 6 (hoy «0», inalcanzable) | Corrección de una meta que no se puede cumplir | código (guardián) | 1 | Bajo | PROPUESTA |
| 7 | Pantalla: scroll horizontal en las 12 tablas + arreglar usuarios y sucursales a 375 px; guardián estático de `<table` sin contenedor de scroll | Dueño 2026-11-12 («mobile first»); decisión de Pedernal 2026-10-11, celular es el dispositivo principal | pantalla + guardián | 2 | Bajo | PROPUESTA |
| 8 | Quitar los 2 desvíos de color (`page.tsx:10`, `mesa-card.tsx:106`) por tokens; pasar las excepciones de color de la carta de «por archivo» a «por línea» | Dueño 2026-11-12 («lista cerrada de colores») | pantalla + guardián | 2 | Bajo | PROPUESTA |
| 9 | Marca: un color por sucursal y uno por empresa, derivados por el sistema, control de contraste al guardar; reducir las 39 claves de color | Dueño 2026-11-12 («libre solo para la marca por sucursal y por empresa») | código + pantalla | 3 | Medio: cambia cartas ya publicadas. Mapeo de las claves actuales y avisar al dueño de las que se pierden | PROPUESTA (alcance exacto, PENDIENTE) |
| 10 | CHECK en la base, aditivos y `NOT VALID` → `VALIDATE`: `Empresa.moneda`, `Empresa.cuit`, `Proveedor.cuit`, `UsuarioEmpresa.rolEmpresa`, `CotizacionDolar.fuente`, `Cliente.descuentoPorcentaje` (0 ≤ x < 100), largo de nombres de catálogo y de `tags`. **Antes: consultar los datos reales** para confirmar que ninguna fila viola | AGENTS.md fallo cerrado; HALL-09 | BD | 3 | **Requiere autorización expresa por tocar `prisma/`.** Un CHECK que encuentra una fila vieja inválida frena el despliegue | PROPUESTA |
| 11 | Cliente: índice único sobre `lower(nombre)` + capturar el choque + transacción SERIALIZABLE; ídem `SeccionCarta` | Reglas de concurrencia del dueño (preferencias de la cuenta); anexo A R3, anexo B | BD + código | 3 | **Requiere autorización (`prisma/`)**. Revisar duplicados existentes antes de crear el índice | PROPUESTA |
| 12 | Oráculo de dinero: test con los casos de ADR-006 (3 × $9,95 al 10 %; $2.260,00 = 1.950,23 + 309,77) contra el núcleo de Motor2, para saber si coincide | Dueño 2026-11-12: «qué reglas tiene Pedernal que nosotros tenemos y dan un resultado diferente» | código (solo test) | 1 | Ninguno: solo lee. Resultado puede abrir una decisión de dinero | PROPUESTA |
| 13 | Pantalla para cargar la alícuota de IVA del producto (la columna ya existe) | Hallazgo propio (anexo A R5); Pedernal la exige para vender | pantalla + código | 2 | Fiscal: decidir antes qué pasa con los productos ya cargados «sin declarar». **Decisión del dueño** | PENDIENTE |
| 14 | Catálogo propio de primitivas e invariantes (sec. 2.4) + guardián de «modelo nuevo sin declarar» | Dueño 2026-11-12 («Motor2 debe tener su propio catálogo») | docs + guardián | 2 | Bajo | PROPUESTA |

**Etapas posteriores con nombre** (no se hacen ahora):

- **Etapa «Ficha de parte»** (X1–X10, X32): una ficha con naturaleza, documento, condición de IVA del receptor, contacto, domicilio, nota y vínculos. Es BD grande (aditiva) y requiere la respuesta a la pregunta clave y autorización expresa. Camino barato posible: empezar por columnas opcionales sobre Cliente (naturaleza, documento, correo, teléfono, nota) **sin unificar**, y unificar después, si el dueño lo decide. Hasta que no se decida, no se toca `prisma/`.
- **Etapa «Clases de producto y precio por instante»** (X12, X14, X18): depende de decisiones del dueño sobre qué conserva Motor2 (recargos en %, adicional como línea hija, grupos compartidos).
- **Etapa «Caja y cobros»**: Motor2 no los tiene (ver `docs/diseno-caja-y-cobros-2026-11-04.md`).
- **Limpieza de lo huérfano** (HALL-04, 14 tablas más las 6 de combinaciones): se decide con el dueño: borrar (destructivo, requiere aviso) o dejar con escritor pendiente.

**Dependencias**: 1, 6, 7, 8, 12, 14 no dependen de nadie. 2 → 3 → 4 comparten el mismo helper. 5 espera al PR #230. 10 y 11 necesitan una lectura previa de los datos reales y autorización. 9 depende del alcance que confirme el dueño. 13 depende de una decisión fiscal.

**Lo que NO se toca en Fase 2** hasta que mergeen los frentes en vuelo: `src/core/pos/promo-combo.ts`, `plato-de-seccion.ts` (PR #230), AGENTS.md y la plantilla de PR (PR #231), «Está bien así» (PR #233), el cerco del tope de 400 líneas por archivo y la sesión de antes/después de la carta.

---

## 9. Preguntas abiertas para el dueño

**La clave (UNA, la única que cambia el modelo de datos):**

> **¿La ficha de parte se construye como UNA tabla «Parte» con roles (cliente y proveedor, como Pedernal), o como columnas nuevas sobre Cliente y Proveedor por separado (que después se pueden unificar)?**
> Recomendación del ingeniero: columnas aditivas sobre Cliente primero (el camino más barato para empezar a usarlo), unificar en una etapa posterior con nombre. Pero si el objetivo es que los datos queden *iguales* a Pedernal sin migraciones forzadas, conviene decidir la tabla única desde ahora, porque cambiarlo después es un cambio destructivo.

**Resto (no se asume nada; quedan como preguntas abiertas):**

1. ¿La condición frente al IVA de la ficha es la del **receptor** (las 11 de ARCA) y se mantiene aparte la del emisor (3)?
2. ¿«Todo nace cerrado» alcanza a la promo (que nazca apagada y «solo salón»), al ítem agrupado, al grupo de opciones de un producto y a «Activo en todas las sucursales»? (D2–D6; cambian producto.)
3. ¿Motor2 conserva recargos en porcentaje, recargos negativos, tope «hasta N» y adicionales como línea hija (Pedernal los quitó)? Define cuánto se parecen los datos.
4. ¿Se ampliaron los caracteres permitidos de nombres a `¿ ¡ ? ! $` en Motor2, como en Pedernal (Q3 del 12/11)? Ojo: en Motor2 hoy no entran.
5. ¿Se aprueban los pasos 1–8 y 12–14 (sin `prisma/`) y se autoriza leer producción en solo lectura para los pasos 10 y 11?
6. ¿Alcance exacto de la marca (paso 9): un color por sucursal y uno por empresa, con el resto derivado?
7. ¿Qué pasa con la consola `plataforma/` (azul propio): parte del sistema o excepción declarada?
8. ¿Sin receta no se vende (Motor2) o se vende con aviso (Pedernal)? ¿Cero es cortesía o «sin dato»?
9. ¿Habilitás la lectura de `ZuluHub-ERP` para repetir el contraste contra el código real? ¿Y `motor2-docs` en este entorno?
10. ¿Aprobás la fecha de vencimiento del guardián de listas de prohibidos (consta «pendiente de aprobar al mergear el PR #229»)?

---

## 10. Riesgos que aparecieron en el camino (no eran lo pedido; anotados sin arreglar)

| Id | Tipo | Hallazgo | Dónde |
|---|---|---|---|
| R1 | **Dinero y concurrencia (alta)** | Editar precio y título de una promo (`guardarPromoCarta`) pisa sin control optimista; precio de producto y local sí lo tienen | anexo A R1 |
| R2 | Concurrencia | Cliente: el único de la base distingue mayúsculas y la app no; alta y edición sin SERIALIZABLE ni captura de `P2002` | anexo B §6.1 |
| R3 | Concurrencia | Nombre de `SeccionCarta` único solo en la app, sin transacción; sin índice `lower(nombre)` | anexo A R3 |
| R4 | Integridad | Renombrar un producto no vuelve a chequear nombres iguales en la carta de la sucursal | anexo A R2 |
| R5 | **Fiscal** | Ninguna pantalla escribe la alícuota de IVA del producto | anexo A R5 |
| R6 | Política | El cupo `SECCION` es una regla viva: un producto nuevo de la sección entra solo a la promo (choca con «todo nace cerrado») | anexo A R6 |
| R7 | Idempotencia | Altas de cliente, proveedor y sucursal sin clave de reintento (el nombre arbitra); `PagoConsignante` no se puede anular ni lleva medio de pago | anexo B §6.2 |
| R8 | Aislamiento | `MARCA_PUBLICA = "Hoteles del Neuquén"` está escrita en el código y sale en la carta pública de cualquier empresa | anexo B §6.3 |
| R9 | Autorización | Notas de membresía sin tope; cambios de contacto y CUIT de proveedor y el alta de proveedor sin auditoría; el email invitado solo se recorta | anexo B §6.4 |
| R10 | Dinero | `Cliente.descuentoPorcentaje` sin CHECK; `PagoConsignante` usa `Decimal(14,4)` y el resto `(14,2)`; columnas `medioPagoDeclarado` y `fechaPagoDeclarada` sin uso | anexo B §6.5 |
| R11 | Integridad | Alta de producto sin transacción ni auditoría; alta de promo sin deduplicar; lecturas de validación fuera de la transacción | anexo A R8–R10 |
| R12 | Herramientas | Los seeds de demo están rotos (no cargan `next-cache`, fallan en `factorConversion` y en el alta de catálogo OT002) | anexo D §6 |
| R13 | Seguridad (no verificado) | RLS sin `FORCE` en 106 tablas: seguro si el rol de la app no es dueño de las tablas; **no lo probé contra una base real** | anexo C |

---

## 11. Verificación, reglas cubiertas y declaración de autoría

- **Gate**: no aplica a un PR de solo documentos. No se tocó `src/`, `test/`, `prisma/`, `scripts/` ni configuración. Se agregaron: este documento y seis anexos `.md` bajo `docs/`. Las 33 capturas (6,1 MB) no se versionan (ver tabla de anexos).
- **Quién escribió qué**: todo (documento, anexos y relevamientos de código) lo hizo **Sonnet** (esta sesión y sus subagentes de lectura). Ningún código nuevo.
- **Reglas del dueño aplicadas**: escalera de diseño (esta auditoría es nivel 1–5 de las mejoras propuestas, sin tablas); «todo nace cerrado» (sec. 7); poda (cada paso lleva su necesidad escrita); primero lo más barato (orden del plan); alcance de la petición (no se suma nada que nadie pidió: lo extra está en la sec. 10 como aviso); maquetas con datos reales (**no cumplida**, ver 0.3, y por eso las capturas no se presentan como aprobables).
- **Decisiones mías que esperan tu OK**: (1) llamar a esto «catálogo de primitivas de negocio» para no chocar con el cerco `primitivas-de-dominio`; (2) copiar los informes de los subagentes como anexos tal cual (con sus «NO VERIFICADO»); (3) tratar la condición de IVA de la ficha como concepto distinto de la de la empresa (pregunta 1); (4) proponer «un color de marca por sucursal/empresa con el resto derivado» como lectura de «libre solo la marca»; (5) no versionar las capturas en el repo (rompen el guardián de rutas); si querés que queden en el repo, hay que ampliar la regla `documentacion` en `gobernanza/clasificacion.ts`, un paso aparte.
