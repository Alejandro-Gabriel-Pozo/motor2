# B. Inventario de primitivas: partes, sucursal/empresa, medios de pago, usuarios y permisos (Motor2)

Fecha: 2026-11-12. Auditor: lectura solamente, sin editar nada en `/home/user/motor2`. Validado contra `prisma/schema.prisma`, migraciones, `src/core/**`, `src/server/**`, `plataforma/src/servidor/**` y `scripts/`. Los documentos (`docs/`, `zuluhub-docs`) se usaron solo como pista; cada afirmación de abajo cita código. Lo que no pude comprobar va marcado **NO VERIFICADO**.

Convención: `schema:N` = `prisma/schema.prisma` línea N. Las rutas `src/...` son relativas a `/home/user/motor2`.

---

## 0. Resumen ejecutivo (lo que más importa)

1. **No existe una primitiva "Parte".** Cliente y Proveedor son DOS modelos separados, sin base común, sin naturaleza (persona/empresa), sin documento tipado, sin domicilio, sin condición de IVA del cliente, sin vínculos entre partes ni convenios. **El "consignante" no es un modelo: es un `Proveedor` referenciado desde `Producto.proveedorConsignacionId`** (`schema:418-420`).
2. **Cliente es mínimo**: `nombre`, `descuentoPorcentaje`, `activo`, `creadoEn` (`schema:756-771`). No tiene CUIT, DNI, correo, teléfono, nota ni domicilio.
3. **Proveedor es la parte "rica"**: nombre, contacto (texto libre), teléfono, correo, CUIT con dígito verificador, condiciones de pago, notas, qué ofrece (productos/servicios), condición de IVA (columna existe pero **nadie la lee ni la escribe**), puntos de venta (tabla existe pero **nadie la lee ni la escribe**). Sin domicilio.
4. **Medios de pago no existe como entidad.** Solo hay una lista cerrada en código (`MEDIOS_DE_PAGO`, 5 valores) usada **únicamente para pagos a proveedores**. **No hay caja, cobro, turno ni arqueo**; cerrar una cuenta del salón es "vender con stock descontado", no cobrar.
5. **Empresa** (tenant) tiene nombre, slug, CUIT (se carga al confirmar el alta), zona horaria, moneda fija ARS, estado, condición de IVA (sin escritor en el código), perilla de IVA de compras (sin escritor) y dos perillas de política. **No tiene razón social, domicilio, contacto, logo ni colores de marca como columnas.** Marca y logo viven en JSON de la carta pública (`PortalCartaEmpresa.valores`, `TemaCartaSucursal.valores`), y hay un nombre de marca **hardcodeado** (`MARCA_PUBLICA = "Empresa B"`).
4b. **Sucursal** tiene solo `nombre`, `activo`, `creadoEn` (+ columna muerta `maxMesasAbiertas`). **No tiene domicilio, teléfono, correo, CUIT ni punto de venta propios.** Lo que se parece a contacto/marca de sucursal está en `SucursalPublica` y `TemaCartaSucursal` (JSON) y es para la carta pública, no un dato maestro.
5. **Usuarios/roles/permisos** es lo más maduro: RBAC con matriz rol x acción, pisos de nivel (operario < administrador < administrador de sistema < gerente), módulos por empresa, capacidades por sucursal, membresías N:M usuario-sucursal con rol distinto por sucursal, invitaciones con token hasheado, invariantes de gobierno y RLS Postgres por empresa y por sucursal.

---

## 1. PARTES

### 1.1 ¿Un modelo o varios? (verificado)

| Concepto | ¿Modelo propio? | Dónde vive | Evidencia |
|---|---|---|---|
| Cliente | Sí, `Cliente` | `schema:756-771` | modelo con 4 columnas de datos |
| Proveedor | Sí, `Proveedor` | `schema:636-670` | modelo propio |
| Consignante | **No.** Es un `Proveedor` marcado desde el producto | `Producto.esConsignacion` + `Producto.proveedorConsignacionId` + `Producto.precioConsignacion` (`schema:418-421`); pagos en `PagoConsignante` (`schema:679-710`) | no hay modelo `Consignante` |
| Agente / contacto de empresa | **No existe** | `Proveedor.contacto` es un string libre de hasta 120 caracteres | ningún modelo ni relación |
| Huésped / titular de reserva | **No existe** | sin reservas en el código (ver `docs/diseno-caja-y-cobros-2026-11-04.md` §0, y no hay modelo en el esquema) | grep sin resultados |
| Empleado / usuario como parte | Distinto: `User` (identidad de login), no es una "parte" comercial | `schema:18` | |
| Convenios | **No existe** | solo en diseño en papel (`docs/diseno-clientes-convenios-y-facturacion-externa-2026-10-26.md`) | grep "convenio" en `src/` sin resultados |
| Vínculos entre partes | **No existe** (ni agente-de, ni contacto-de, ni empresa-de) | `Cuenta.clienteId` y `Operacion.clienteId`/`proveedorId` son vínculos transaccionales, no entre partes | |

Los dos modelos NO comparten tabla base, ni identificador común, ni validaciones centralizadas de "parte" (cada uno arma las suyas). Se parecen en que ambos son catálogo de **empresa** (sin `sucursalId`), con `activo` en vez de borrado y FK compuesta `[empresaId, id]`.

### 1.2 Cliente (`Cliente`)

| Aspecto | Detalle | Dónde |
|---|---|---|
| Qué es | Persona o empresa a la que se le aplica un % de descuento fijo en la cuenta del salón. No distingue persona de empresa | `schema:756-771`, `src/server/actions/clientes/cliente.ts:1-83` |
| Naturaleza (persona/empresa) | **No existe** (ninguna columna) | `schema:756-771` |
| Nombre / apellido / alias | Solo `nombre` (un string). Sin apellido ni alias | `schema:761` |
| Documento | **No existe** (ni CUIT, CUIL, CDI, DNI ni pasaporte). El diseño de caja lo confirma: "Sin CUIT, tipo, condición de IVA ni cuenta corriente" | `docs/diseno-caja-y-cobros-2026-11-04.md` §0 + `schema:756-771` |
| Condición frente al IVA | **No existe** para el cliente (existe solo en `Empresa` y `Proveedor`) | `schema:2492+`, `schema:652` |
| Contacto (correo/teléfono) | **No existe** | `schema:756-771` |
| Domicilio | **No existe** | `schema:756-771` |
| Nota | **No existe** | `schema:756-771` |
| Vínculos / convenios | **No existen** | n/a |
| Campos que se piden al crear | `nombre` (obligatorio) y `descuentoPorcentaje` (obligatorio, 0 <= % < 100, hasta 2 decimales) | `src/core/features/clientes/clientes.guard.ts:25-31`, `src/core/datos/porcentaje-descuento.ts` |
| Validación del nombre | `nombreDeCatalogo`: recortado, no vacío, regex de permitidos `^[\p{L}\p{N} \-.,()%&/'_]+$`, máximo 80 caracteres, sin guion inicial, al menos letra o número | `src/core/texto.ts:60-61`, `src/core/features/catalogo/nombre-de-catalogo.ts:10-16` |
| Unicidad | `@@unique([empresaId, nombre])` **distingue mayúsculas en la base**; la app compara sin distinguir mayúsculas | `schema:773`, `src/server/actions/clientes/casos-de-uso/alta-cliente.ts:30` |
| Qué lo referencia | `Cuenta.clienteId` (`schema:2346`), `Operacion.clienteId` (`schema:1116`). FK RESTRICT: no se borra | |
| Ciclo de vida | Se crea, se corrige nombre/% (`actualizarCliente`), se activa/desactiva. **Nunca se borra** (`activo`). Un cliente desactivado no se puede asignar a una cuenta (`CLIENTE_DESACTIVADO`) | `src/server/actions/clientes/casos-de-uso/actualizar-activo-cliente.ts`, `asignar-cliente-a-cuenta.ts:66` |
| Historia | Auditoría por campo (`nombre`, `descuentoPorcentaje`, `activo`) en `RegistroAuditoria`, misma transacción. El % se **congela** en `Cuenta.descuentoPorcentaje` al asignarlo | `src/core/features/clientes/auditoria-de-cliente.ts`, `schema:2352` |
| Permiso | `clientes` (empresa) para ABM; `pos_asignar_cliente` (sucursal) para asignarlo | `src/server/actions/clientes/cliente.ts:48,66,77` |
| Aislamiento | RLS `aislamiento_empresa` | `prisma/migrations/20260929120000_multiempresa_rls/migration.sql:21-22` |

### 1.3 Proveedor (`Proveedor`), incluido como "consignante"

| Aspecto | Detalle | Dónde |
|---|---|---|
| Qué es | Parte a la que se le compra mercadería o servicios (y, si un producto está marcado como consignación, a quien se le debe lo vendido) | `schema:636-670` |
| Naturaleza (persona/empresa) | **No existe** columna. Se infiere solo del prefijo del CUIT (20/23/24/27 personas, 30/33/34 empresas) y no se guarda | `src/core/fiscal/cuit.ts:6` |
| Nombre / apellido / alias | Solo `nombre` (único por empresa, sin distinguir mayúsculas con índice `lower("nombre")`); `codigo` autogenerado `PRV_<uuid6>` (identidad visible, único por empresa) | `schema:640-641`, `prisma/migrations/20260929100000_multiempresa_estructura/migration.sql:285`, `alta-proveedor.ts:38` |
| Documento | Solo CUIT (opcional). **Se valida**: se quitan espacios/puntos/guiones, exactamente 11 dígitos, prefijo de ARCA (20,23,24,27,30,33,34) y dígito verificador módulo 11; se guarda canónico de 11 dígitos; máx. 20 caracteres de entrada. **Único por empresa** (índice `(empresaId, cuit)`). **No existe** CUIL, CDI, DNI ni pasaporte | `src/core/fiscal/cuit.ts:5-34`, `schema:669`, `prisma/migrations/20261008120000_cuit_unico/migration.sql` |
| Condición frente al IVA | Columna `condicionIva` (RESPONSABLE_INSCRIPTO, MONOTRIBUTO, EXENTO; NULL = no declarada; CHECK en base). **Ningún código de `src/` la lee, la escribe ni la valida** (grep de `condicionIva` solo da `src/core/fiscal/iva.ts`; el `select` de la ficha no la incluye). Es deuda de datos sin escritor | `schema:652`, `prisma/migrations/20261016104000_proveedor_condicion_iva_y_puntos_de_venta/migration.sql`, `src/server/consultas/catalogo/proveedores.ts:11` |
| Contacto | `contacto` (texto libre, máx 120), `telefono` (texto libre, máx 40, **sin formato**), `email` (máx 254, regex simple `algo@dominio.tld`) | `src/core/datos/limites.ts:10-15,34`, `src/core/features/catalogo/contacto-de-proveedor.ts:16-35` |
| Domicilio | **No existe** (sin calle, localidad ni provincia; ni estructurado ni texto libre) | grep de `domicilio/provincia/direccion` en el esquema: sin resultados relevantes |
| Nota | `notas`, texto libre, **máx 500 caracteres**; también `condicionesPago` máx 200 | `limites.ts:10-11`, `contacto-de-proveedor.ts:22-23` |
| Qué se ofrece | `ofreceProductos` / `ofreceServicios` (al menos una; CHECK `Proveedor_ofrece_productos_o_servicios_chk`; default productos) | `schema:648-649`, `src/core/features/catalogo/oferta-de-proveedor.ts` |
| Vínculos | Ninguno entre partes. Sí: `ProveedorPorProducto` (qué producto compra a qué proveedor, con precio y unidad), `PuntoDeVentaDeProveedor` (tabla sin uso en `src/`), `FacturaProveedor`, `NotaCreditoProveedor`, `PagoConsignante`, `Operacion.proveedorId`, `Producto.proveedorConsignacionId` | `schema:723,3061,2755,3269,679,1108,420` |
| Campos que se piden al crear | Solo `nombre` es obligatorio. Todo lo demás opcional | `src/core/features/catalogo/proveedores.guard.ts:23-33` |
| Ciclo de vida | Se crea (con reintento de código), se edita (nombre con control optimista `nombreEsperado`, contacto, oferta), se activa/desactiva. **Nunca se borra** (`activo`). Un proveedor inactivo no puede recibir pago de consignación (`cargarProveedorActivo`) | `actualizar-proveedor.ts`, `pago-consignante.ts:16` |
| Historia | Solo `nombre`, `ofreceProductos`, `ofreceServicios` dejan auditoría por campo. **Contacto, teléfono, correo, CUIT, condiciones y notas NO se auditan** (declarado en el código) | `actualizar-proveedor.ts:27-28,71-75` |
| Alta | `altaProveedorCasoDeUso` **no audita** ("un proveedor no tiene columnas de plata: sin auditoría") | `alta-proveedor.ts:27` |
| Permisos | Alta: `proveedor_alta`; resto `proveedores` (ambos de empresa, módulo `proveedores_basico`); listado para selectores: cualquiera con alguna de 5 claves de compra/catálogo | `src/server/actions/catalogo/proveedores.ts:48-52,100,119` |
| Aislamiento | RLS por empresa; FK compuestas | `schema:636`, migración RLS |

**Consignante, en detalle (qué hay de verdad):**
- Un producto de consignación lleva `esConsignacion`, `proveedorConsignacionId` y `precioConsignacion` (`schema:418-421`). La deuda sale del Kardex (líneas `LIQUIDACION_CONSIGNACION`) menos `PagoConsignante` (`schema:672-678`).
- `PagoConsignante` (`schema:679-710`): `importe` Decimal(14,4), `fecha`, `notas` (máx 500), `claveIdempotencia` única global, `payloadHash`, `resultadoMensaje`. Append-only; **no hay anulación de pago de consignación** (busqué `AnulacionDePagoConsignante`: no existe). El consignante no se puede cambiar una vez que hay liquidaciones (`CONSIGNANTE_CON_HISTORIA`).
- Módulo `consignacion` requiere `proveedores_basico` y `stock` (`src/core/modulos/catalogo.ts:29`); permiso `pagar_consignante` (sucursal, piso administrador) (`src/core/permisos/acciones.ts:153`).

### 1.4 Convenios, agente-de, contacto: estado real

| Pieza | ¿Existe en código? | Evidencia |
|---|---|---|
| `Convenio` / oferta permitida por convenio | **No** | grep sin resultados en `src/` y esquema |
| Vínculo agente-empresa | **No** | no hay tabla |
| Contacto estructurado (persona de contacto) | **No**: `Proveedor.contacto` es un string | `schema:643` |
| Cliente tipo empresa vs persona | **No** | |
| Factura emitida (de venta) | **No** (solo `FacturaProveedor`, de compra) | `schema:2755` |
| Todo lo anterior | Existe **solo en diseño en papel**: `docs/diseno-clientes-convenios-y-facturacion-externa-2026-10-26.md`, `docs/diseno-caja-y-cobros-2026-11-04.md` | |

Nota: `/home/user/zuluhub-docs` (repo hermano, proyecto Pedernal) tiene especificaciones de "parte/customer" (`11-especificaciones/clientes-y-proveedores.md`, `01-vision/primitivas-de-negocio.md`). **No se validaron contra el código de Motor2**: son otro producto. **NO VERIFICADO** si Motor2 pretende adoptarlas. El repo `motor2-docs` que menciona AGENTS.md **no está en esta máquina** (solo está `zuluhub-docs`): **NO VERIFICADO** si hay un plan aprobado de "partes" ahí.

### 1.5 Tabla de validación de campos de partes (lo que realmente se exige)

| Campo | Cliente | Proveedor | Tipo/forma | Límite | Obligatorio |
|---|---|---|---|---|---|
| nombre | sí | sí | lista de permitidos (letras, números, espacio y `-.,()%&/'_`) | 80 | sí |
| código visible | no | sí (`PRV_xxxxxx`, auto) | auto | n/a | auto |
| descuento % | sí | no | número 0 <= x < 100, 2 decimales | n/a | sí |
| CUIT | no | sí | 11 dígitos, prefijo ARCA, verificador | 20 entrada | no |
| contacto | no | sí | texto libre | 120 | no |
| teléfono | no | sí | texto libre, sin formato | 40 | no |
| correo | no | sí | regex `^[^\s@]+@[^\s@]+\.[^\s@]+$` | 254 | no |
| condiciones de pago | no | sí | texto libre | 200 | no |
| notas | no | sí | texto libre | 500 | no |
| condición de IVA | no | columna sin uso | enum en base | n/a | no |
| domicilio/provincia | no | no | n/a | n/a | n/a |

Observación sobre la regla "Todo nace cerrado": `validarTextoLibre` (contacto, teléfono, notas, condiciones) **solo acota largo**: no restringe el conjunto de caracteres (admite `<`, `>`, invisibles, saltos de línea). Y `RE_EMAIL` es una forma mínima. El nombre sí usa lista de permitidos. Ver riesgos.

---

## 2. SUCURSAL y EMPRESA/CLIENTE-TENANT

### 2.1 Sucursal (`Sucursal`, `schema:127-184`)

| Aspecto | Detalle | Dónde |
|---|---|---|
| Qué es | Local físico/operativo de una empresa; ancla del stock, mesas, caja futura, carta pública, precios locales, etc. | `schema:127` |
| Columnas | `id`, `empresaId`, `nombre`, `activo`, `creadoEn`, y `maxMesasAbiertas` (**sin uso desde 2026-10-29**, borrado pendiente de autorización) | `schema:127-141` |
| Datos fiscales (CUIT, razón social, punto de venta propio) | **No existen** en la sucursal. Existe `PuntoDeVentaDeProveedor` (del proveedor), **no hay punto de venta propio** | `schema:3061`, `docs/diseno-caja-y-cobros-2026-11-04.md` §0 |
| Domicilio / teléfono / correo | **No existen** como datos maestros. Existen, como **configuración de la carta pública**, `restaurante_whatsapp`, `restaurante_footer_maps_url`, `restaurante_instagram`, `restaurante_facebook` dentro del JSON del tema | `src/core/carta/tema.ts:141-144` |
| Marca / colores / logo por sucursal | En `TemaCartaSucursal.valores` (JSON, claves `CLAVES_TEMA_V1`, p. ej. `color_marca`, `restaurante_logo_url`, `hero_color_fondo`) y `SucursalPublica` (slug, etiqueta, subtítulo, posición en mapa, `publicada`) | `schema:2205-2255`, `src/core/carta/tema.ts:86-144` |
| Qué se pide al crear | `nombre` (obligatorio, mismo charset/80) y **email del primer admin** (obligatorio; debe ser alguien que ya pertenezca a la empresa) | `src/core/features/sucursales/sucursal.guard.ts:19-28`, `crear-sucursal-con-admin.ts:86-91` |
| Unicidad | `@@unique([empresaId, nombre])` sensible a mayúsculas en base; la app lo chequea sin distinguir mayúsculas **dentro de transacción SERIALIZABLE** | `schema:181`, `crear-sucursal-con-admin.ts:71`, `renombrar-sucursal.ts` |
| Alta (qué hace) | Transacción de gobierno: crea sucursal, reactiva/crea cuenta de empresa del admin, crea membresía con rol `admin`, siembra `DisponibilidadProducto` solo con productos "universales"; 3 filas de auditoría | `crear-sucursal-con-admin.ts:107-130` |
| Ciclo de vida | Crear, renombrar, activar/desactivar. **Nunca se borra** (decisión; FK RESTRICT). No se puede desactivar con traspasos pendientes, cuentas abiertas, ni dejando al gerente sin sucursal activa | `actualizar-activo-sucursal.ts` |
| Renombrar | **No cambia el `slug` público** (se genera una vez desde el nombre y "nunca se recalcula") | `schema:2212` |
| Historia | Auditoría de `nombre` y `activo` en `RegistroAuditoria` | `renombrar-sucursal.ts`, `crear-sucursal-con-admin.ts:118` |
| Permisos | `alta_sucursal`, `activar_sucursal`, `renombrar_sucursal` (empresa, administración) | `src/server/actions/auth/sucursales.ts:41,62,77` |
| Aislamiento | RLS `aislamiento_empresa` y, además, RLS por sucursal en las tablas de operación (alcance de lectura/escritura) | `migration RLS:101-102`, `src/server/acceso/alcance.ts` |
| Quién la referencia | Prácticamente todo el dominio operativo (ver bloque de relaciones `schema:143-179`) | |

### 2.2 Empresa (tenant) (`Empresa`, `schema:2492-2528`)

| Aspecto | Detalle | Dónde |
|---|---|---|
| Qué es | El cliente-tenant de la plataforma (dueño de las sucursales y de todos los datos). Tabla global (sin RLS). **No hay una "razón social" aparte**: `nombre` es único global | `schema:2492-2528` |
| Columnas | `nombre` (único), `slug` (único), `cuit` (único, opcional), `zonaHoraria`, `moneda`, `estado`, `permisosEditables`, `dosPaneles`, `condicionIva`, `llevaIvaDeCompras`, `creadoEn` | |
| Marca / colores / logo | **No son columnas de `Empresa`**. Portal: `PortalCartaEmpresa.valores` (22 claves `CLAVES_PORTAL_V1`: `empresa_logo_url`, colores `portal_*`, derechos…); por sucursal: tema. Todo JSON validado por clave | `schema:2256-2262`, `src/core/carta/portal.ts:31-60` |
| Nombre de marca visible al público | **Hardcodeado**: `MARCA_PUBLICA = "Empresa B"`, usado en título/descripción/nombre de sitio de la carta pública de **cualquier** empresa | `src/core/carta/marca.ts:5`, `src/core/carta/metadatos.ts:49-50`, `src/app/(carta-publica)/carta-publica/[empresa]/page.tsx:32` |
| Datos fiscales | `cuit` (11 dígitos validados, único; lo carga la plataforma al confirmar el alta, o lo corrige con motivo), `condicionIva` (lista cerrada; **sin escritor encontrado**), `llevaIvaDeCompras` (perilla; **sin escritor encontrado**). **Sin razón social, domicilio fiscal ni punto de venta** | `plataforma/src/servidor/ciclo-de-vida.ts:93-118`, grep de `condicionIva`/`llevaIvaDeCompras` en `plataforma/`, `scripts/`, `src/`: solo `iva.ts` |
| Contacto de la empresa | **No existe** como columna (sí `Invitacion.email` del gerente) | |
| Moneda | **Fija ARS** (`MONEDA_FIJA`), no se pide al alta | `src/core/moneda.ts:29`, `empresa.schema.ts:72` |
| Zona horaria | IANA validada; las horas se muestran en esa zona. Algunas reglas usan `ZONA_ARGENTINA` fija (p. ej. el "hoy" del pago de factura) | `empresa.schema.ts:19`, `declarar-pago-de-factura-proveedor.ts:31` |
| Estados | `PROVISIONING` -> `ACTIVE` <-> `SUSPENDED` -> `DELETING` (terminal, sin circuito); una empresa en alta no se suspende | `empresa.schema.ts:50-62` |
| Alta (consola de plataforma) | Datos: `nombre` (1-120), `slug` (<=63, minúsculas/dígitos/guion), `zonaHoraria`, `nombreSucursal` (1-120), `emailDuenio` (z.email). Nace `PROVISIONING`, sin CUIT ni módulos. El gerente acepta una invitación y **declara su CUIT**; la plataforma lo confirma contra la constancia de ARCA (`revisado: true`) y la activa | `plataforma/src/servidor/empresas.ts:75-107`, `empresa.schema.ts:68-75`, `ciclo-de-vida.ts:93-118` |
| Módulos | `ModuloEmpresa` (módulo, estado ACTIVO/INACTIVO). Catálogo en código: fijos/soporte/vendibles; dependencias. Solo escribe `motor2_plataforma` | `schema:2613-2631`, `src/core/modulos/catalogo.ts:22-39` |
| Política de plataforma | `permisosEditables`, `dosPaneles` (solo vía script `scripts/politica-empresa.ts` con TOTP) | `scripts/politica-empresa.ts` |
| Historia | `AuditoriaPlataforma` (append-only, sin FK) para acciones de plataforma; `RegistroAuditoria` para lo interno de la empresa | `schema:3157` |
| Qué la referencia | Todas las tablas de dominio (`empresaId`, FK compuesta `[empresaId, id]`) | |
| Aislamiento | `Empresa` es global; el resto, RLS `aislamiento_empresa` con `app_empresa_actual()`. El rol `motor2_app` la cumple; el dueño la salta (`ENABLE`, sin `FORCE`) | `schema:~100-111` |

### 2.3 Marca y colores (qué hay en realidad)
- Validación de color: copia literal de `sanitizeCssColor` de la carta (`src/core/carta/color-css.ts`): bloquea `; { } " ' < > \` y acepta hex, `rgb()/hsl()/oklch()…`, nombres de solo letras. Logo: URL `https://` sin espacios, comillas ni paréntesis (`tema.ts:275-279`).
- No hay una paleta de empresa (marca global) que alimente la app interna ni los documentos (tickets, facturas): **NO VERIFICADO** si el ticket interno toma algo de la marca; no lo encontré.

---

## 3. MEDIOS DE PAGO, CAJA y COBROS

### 3.1 Lo que existe

| Pieza | Existe | Detalle | Dónde |
|---|---|---|---|
| Entidad `MedioDePago` (catálogo configurable) | **No** | solo una constante en código | `src/core/compras/pago-de-factura.ts:9` |
| Lista de medios | Sí, **fija** (TRANSFERENCIA, EFECTIVO, CHEQUE, TARJETA, OTRO) con CHECK en base; usada **solo para pagos a proveedores** | `pago-de-factura.ts:9-10`, `prisma/migrations/20261104110000_pago_de_factura_proveedor/migration.sql` |
| Pago de factura de proveedor | Sí: `PagoDeFacturaProveedor` (fecha, medio, clave de reintento, hash, mensaje, anulación aparte). Un único pago vigente por factura (índice parcial). **No guarda importe ni moneda** (paga la factura entera) | `schema:~2998-3023`, `declarar-pago-de-factura-proveedor.ts` |
| Pago a consignante | Sí: `PagoConsignante` (importe, fecha, notas, idempotencia). **No tiene medio de pago** ni anulación | `schema:679-710` |
| Cobro de una venta/cuenta | **No existe** | `src/server/actions/pos/cuenta-cierre.ts:17-18` ("motor2 no tiene entidad de caja ni de pago") y diseño de caja §0 |
| Caja, turno, arqueo, billetes | **No existen** | idem (solo en diseño: `docs/diseno-caja-y-cobros-2026-11-04.md`) |
| Cuenta corriente de clientes | **No existe** | idem |
| `Venta` (cabecera con `importeTotal`) | Existe en el esquema; **nadie la escribe ni la lee** | `schema:2724-2748` (comentario "Nada de `src/` la escribe todavía") |
| `FacturaProveedor.medioPagoDeclarado`, `fechaPagoDeclarada` | Columnas **SIN USO** (candidatas a poda) | `schema:2793-2795` |
| Propina, QR, tarjeta con cuotas/cupón | **No existen** | grep sin resultados |

### 3.2 Pago declarado de factura de proveedor (única cosa con medio de pago)
- Qué se pide: `facturaId`, `fechaPago` (día AR; no anterior al de la factura ni posterior a hoy), `medio` (lista cerrada), `claveIdempotencia` (UUID).
- Reglas (`decidirDeclaracionDePago`, `pago-de-factura.ts:48-55`): factura no anulada; condición `PENDIENTE_DE_PAGO`; sin pago vigente; fecha en rango.
- Concurrencia/idempotencia: transacción SERIALIZABLE, factura bloqueada (`bloquearFacturaParaPago`), `chequearIdempotencia` por clave + `payloadHash`, índice parcial de pago vigente, captura del choque de unicidad.
- Auditoría: `registrarCambioAuditado` (`pagoDeclarado`). Permiso `declarar_pago_compra` (empresa, módulo compras, piso operario, semilla solo admin).
- Anulación: registro aparte `AnulacionDePagoDeFacturaProveedor` + marca `anuladoEn` (único UPDATE de la app).

---

## 4. USUARIOS, ROLES y PERMISOS

### 4.1 Modelos

| Modelo | Qué es | Campos clave | Dónde |
|---|---|---|---|
| `User` | Identidad (Auth.js). Global, sin `empresaId` | `email` único, `name`, `image`, `emailVerified`, `activoGlobal` (kill-switch), `creadoEn` | `schema:18-71` |
| `Account`/`Session`/`VerificationToken` | Infra de Auth.js (Google, sesión en base de datos) | `provider+providerAccountId` único | `schema:73-107` |
| `UsuarioEmpresa` | Pertenencia a empresa + `rolEmpresa` (hoy solo `"gerente"` o null), `activo` | único `(usuarioId, empresaId)` | `schema:3075-3086` |
| `UsuarioSucursal` | Membresía N:M usuario-sucursal, con `rolId`, `activo`, `notas` | único `(usuarioId, sucursalId)` | `schema:212-228` |
| `Rol` | Rol por empresa: `nombre` (minúsculas), `clave` (solo roles de sistema `admin`, `operador`), `activo` | único `(empresaId,nombre)` y `(empresaId,clave)` | `schema:186-206` |
| `Accion` | Catálogo global de claves gateables (137 claves en `ACCIONES`) | `clave`, `descripcion` | `schema:234`, `src/core/permisos/acciones.ts` |
| `PermisoRol` | Matriz rol x acción: `puedeVer`, `puedeEditar` (Ver incluye Editar) | único `(rolId, accionClave)` | `schema:247-262` |
| `CapacidadSucursal` | Interruptor "acción habilitada en esta sucursal" (fila `sucursalId` null = default) | único `(accionClave, sucursalId)` | `schema:268-282` |
| `ModuloEmpresa` | Módulos activos de la empresa | ver 2.2 | `schema:2622` |
| `Invitacion` / `InvitacionSucursal` | Invitación (gerente, usuario, vinculación) con hash de token SHA-256, estado, vencimiento 7 días; qué sucursales y rol da | `schema:2644-2690`, `src/core/features/empresa/invitacion.ts:10` | |
| `RegistroAuditoria` | Auditoría administrativa append-only por campo | `schema:297` | |
| `AdminPlataforma`, `SesionPlataforma`, `CodigoDe...Plataforma`, `AuditoriaPlataforma` | Identidad aparte de la consola de plataforma (TOTP + código por mail) | `schema:3091-3170` | |

### 4.2 Cómo se decide un acceso (orden fijo)
Membresía vigente (usuario y rol activos) -> módulo de la empresa -> capacidad de la sucursal -> fila de la matriz del rol, con el **piso** de nivel de la acción mandando sobre la fila. Código puro: `src/core/permisos/decision-de-acceso.ts:59-185`; cáscara: `src/server/acceso/gate.ts`; envoltorios: `src/server/actions/con-permiso.ts` (`conPermiso`, `conPermisoDeEmpresa`, `conEdicionDePermisos`).
- Pisos (`src/core/permisos/jerarquia.ts:24`): operario(1) < administrador(2) < administrador de sistema(3) < gerente(4). Hoy el rol `admin` es nivel 3; todo otro rol es operario; el gerente es `UsuarioEmpresa.rolEmpresa`, no un rol de sucursal.
- Acciones de contexto empresa vs sucursal (`ContextoDeAccion`). Una acción de empresa vale si **cualquier** membresía activa del usuario en la empresa la tiene y la Central no la deshabilitó.
- Un rol "propio" (mozo, cajero) nunca llega a acciones de piso administrador o superior, aunque tenga la fila (`rolAlcanzaLaAccion`).

### 4.3 Alcance por sucursal (RLS + contexto)
- El contexto nace con `alcance = { lectura: [sucursalActiva], escritura: [sucursalActiva] }` (`src/server/sesion/contexto.ts:90-92`). Solo se ensancha con las funciones de `src/server/acceso/alcance.ts` (después del gate, con membresía vigente, sin valor "todas"). La base lo aplica con RLS por sucursal.
- Empresa y sucursal activas vienen de cookies **pero se validan contra la pertenencia leída de la base** (`contexto.ts:61-66,128-139`).
- Con 2+ empresas y sin elección, estado `ELEGIR_EMPRESA` (no opera por defecto).

### 4.4 Invitación y alta de usuarios
- Login solo con Google (`src/lib/auth.ts`), sin vincular por email automáticamente. Sesión en base, 12 h, con revalidación de membresía cada 5 min (`sesionSigueVigente`) y kill-switch `activoGlobal` en cada request.
- `agregarOActualizarUsuario` (`gestion_usuarios`): si la persona no es de la empresa, crea una `Invitacion` (token hasheado, 7 días) con la sucursal y el rol, manda mail después del commit; **no crea User ni membresía hasta aceptar**; al aceptar se revalida el permiso de quien invitó. Si ya es miembro: upsert de membresía y, si no vinculó Google, invitación de vinculación. Todo en transacción de gobierno SERIALIZABLE (`conGobierno`) con invariantes.
- Invitación de gerente: la crea la plataforma (consola), al aceptar la persona declara el CUIT (`Invitacion.cuitDeclarado`).
- Cupo de correo diario por empresa y destinatario (S-21).

### 4.5 Invariantes de gobierno (`src/core/permisos/invariantes.ts`)
(a) la empresa siempre conserva un admin efectivo; (b) el gerente conserva una sucursal activa; (c) un rol de sistema no se desactiva/borra/cambia de clave; (d) acciones de gobierno de accesos conservan admin entre sus roles de Editar; (e) un rol con usuarios activos no se desactiva; (f) el gerente es admin efectivo en al menos una sucursal. Medidas antes y después de cada escritura; un cambio que empeora una invariante se rechaza.
- Techo de privilegio (`jerarquia.ts:95-102`): se gestiona a quien está en tu nivel o menos; dar el rol admin es de admin o gerente; la matriz del rol admin la edita solo el gerente (D13/D14).
- Nombres de rol reservados (`admin`, `administrador`, `operador`, `operario`, `gerente`) solo para el rol que corresponde (`nombres-de-rol.ts`).

### 4.6 Ciclo de vida y historia
| Entidad | Borrado | Baja lógica | Auditoría |
|---|---|---|---|
| User | no hay borrado en `src/` | `activoGlobal` (sin UI encontrada para apagarla globalmente: **NO VERIFICADO**) | n/a |
| UsuarioEmpresa | no | `activo` (`apagar_cuenta_empresa`) | sí |
| UsuarioSucursal | no | `activo` (`activar_usuario_sucursal`) | sí (rol, activo, notas) |
| Rol | no | `activo` (no si es de sistema o tiene usuarios activos) | sí |
| PermisoRol | upsert | n/a | sí, por celda, con control optimista (`CONFLICTO_DE_EDICION`) |
| Invitación | no | `REVOCADA` / `ACEPTADA`; "vencida" se calcula | sí |

---

## 5. Relaciones entre primitivas (mapa)

```
Empresa 1--N Sucursal 1--N (Mesa, Cuenta, Operacion, Stock..., SucursalPublica 1:1, TemaCartaSucursal 1:1)
Empresa 1--1 PortalCartaEmpresa (JSON de marca del portal)
Empresa 1--N Proveedor 1--N (ProveedorPorProducto, FacturaProveedor, NotaCreditoProveedor, PuntoDeVentaDeProveedor, PagoConsignante)
Producto N--1 Proveedor (consignación: proveedorConsignacionId)
Empresa 1--N Cliente 1--N (Cuenta.clienteId con % congelado, Operacion.clienteId)
User N--M Empresa (UsuarioEmpresa.rolEmpresa) ; User N--M Sucursal (UsuarioSucursal.rolId -> Rol -> PermisoRol -> Accion)
CapacidadSucursal: Accion x Sucursal(opcional)
```

---

## 6. RIESGOS DETECTADOS (aparte)

Clasificados por tipo. Severidad A/M/B es mi criterio (NO VERIFICADO con pruebas dinámicas; todo salió de lectura de código).

### 6.1 Concurrencia
| # | Riesgo | Evidencia | Sev. |
|---|---|---|---|
| C1 | **Alta de cliente sin transacción serializable ni captura de unicidad.** Chequea duplicado sin distinguir mayúsculas con `findFirst`, luego crea. La base solo tiene único **sensible a mayúsculas** `(empresaId, nombre)` (no hay índice `lower(nombre)` para `Cliente`; sí para `Proveedor`). Dos altas simultáneas con "Ana" y "ana" crean dos clientes; dos con el mismo texto exacto chocan con el índice y la acción **lanza** (500) porque no hay `catch` de `P2002` | `alta-cliente.ts:30-38`, `schema:773`, grep de índices `lower(` | M |
| C2 | Misma carrera en `actualizarCliente` (lee, chequea duplicado, escribe sin SERIALIZABLE; no hay control optimista del nombre como en proveedor) | `actualizar-cliente.ts:71-86` | M |
| C3 | **Alta de rol**: chequeo `findFirst` y luego `insert` con captura de unicidad (ok), pero el único `(empresaId, nombre)` es sensible a mayúsculas; el nombre se normaliza a minúsculas, lo cual lo mitiga | `crear-rol.ts`, `nombres-de-rol.ts:26` | B |
| C4 | Alta de proveedor: sin transacción a propósito; el reintento del código lo cubre; el CUIT repetido lo frena el índice y se traduce. Bien resuelto | `alta-proveedor.ts:36-46` | B |
| C5 | `actualizarActivoProveedor`/`actualizarActivoCliente`: último gana, sin control optimista (inofensivo salvo que dos admins se pisen) | `actualizar-activo-cliente.ts` | B |

### 6.2 Idempotencia
| # | Riesgo | Evidencia | Sev. |
|---|---|---|---|
| I1 | **Alta de cliente, de proveedor, de sucursal, de rol, de usuario no llevan clave de reintento** (idempotencia por estado: el nombre arbitra). Sin duplicados mientras el nombre sea el árbitro; el reintento devuelve "ya existe" en vez del éxito original | `alta-cliente.ts`, `alta-proveedor.ts:27`, `crear-sucursal-con-admin.ts:41` | B |
| I2 | **`PagoConsignante` no se puede anular** y no tiene medio de pago: un pago mal cargado (importe) queda para siempre; solo mitigado por la clave de reintento. No hay corrección con registro | `schema:679-710`, grep de anulación | M (dinero) |
| I3 | Pago declarado de factura sí es idempotente (clave global + `payloadHash`) y anulable. Bien | `declarar-pago-de-factura-proveedor.ts` | n/a |

### 6.3 Aislamiento entre clientes (tenants)
| # | Riesgo | Evidencia | Sev. |
|---|---|---|---|
| A1 | **Marca hardcodeada**: toda carta pública de cualquier empresa lleva "Empresa B" en título y `nombreSitio`. Con una segunda empresa real, fuga de marca ajena y SEO erróneo | `src/core/carta/marca.ts:5`, `metadatos.ts:49-50` | M |
| A2 | `Empresa` y `User` son **globales sin RLS**; `Empresa.nombre` y `slug` únicos globales: un nombre ocupado por otra empresa se revela al dar de alta (lo hace solo la plataforma, no riesgo de tenant) | `schema:2492`, `empresas.ts:90-91` | B |
| A3 | `idempotency keys` `@unique` **globales** (no por empresa) en `PagoConsignante`, facturas, pagos, anulaciones: un UUID colisionante de otra empresa devolvería conflicto (probabilidad nula con UUID v4). El diseño lo declara a propósito (ADR-028) | `schema:700,2790+` | B |
| A4 | `Invitacion` tiene RLS especial `lectura_por_token` (la app lee sin empresa). Superficie sensible; su prueba de aislamiento **NO VERIFICADA** por mí | doc del modelo, `schema:2633-2670` | M |
| A5 | `RegistroAuditoria.entidadId` sin FK (a propósito) y `actorId` es un `User` global: un actor de otra empresa no se filtra por la tabla, pero la descripción puede incluir emails | `schema:297+` | B |
| A6 | `UsuarioEmpresa.rolEmpresa` es **texto libre** (solo "gerente" documentado); no hay CHECK. Un valor distinto no da privilegios (`esGerenteDeEmpresa` compara con igualdad), falla cerrado | `schema:3080`, `rol-empresa.ts:9` | B |

### 6.4 Autorización
| # | Riesgo | Evidencia | Sev. |
|---|---|---|---|
| Z1 | Las acciones de proveedores/clientes de catálogo central se gatean con una clave **de empresa** (`proveedores`, `clientes`): vale si **cualquier** membresía del usuario en la empresa la tiene, no la de la sucursal activa. Diseño declarado; es coherente con que sean catálogos centrales | `decision-de-acceso.ts:121-164` | B |
| Z2 | `alta proveedor` usa `proveedor_alta` (de empresa); el listado para selectores es accesible con cualquiera de 5 claves (`proceso_compra`, `alta_producto`, …) y devuelve id/nombre/activo: aceptable | `proveedores.ts:48-52` | B |
| Z3 | **`notas` de la membresía y de `InvitacionSucursal` sin límite de largo ni juego de caracteres** (el comentario del propio caso de uso dice que recibe "un texto libre que nunca se validó"). Entra a `RegistroAuditoria` como valor | `actualizar-notas-membresia.ts:21,42`, `usuario.guard.ts:18` | M |
| Z4 | El email del usuario invitado **solo se recorta y pasa a minúscula**: no se valida el formato en el guard (la invitación puede ir a una dirección inválida; cupo de correo mitiga abuso) | `usuario.guard.ts:21-25`, `sucursal.guard.ts:25-27` | B |
| Z5 | Contacto/teléfono/notas/condiciones de proveedor: validación **por largo, no por conjunto permitido** (regla "Todo nace cerrado" del propio AGENTS.md); admite `<`, `>`, controles y saltos de línea. Entra a pantallas y exportaciones | `limites.ts:36-42` | M |
| Z6 | Datos de proveedor (contacto, CUIT, teléfono, notas) cambian **sin auditoría**; el CUIT es dato fiscal que habilita facturas | `actualizar-proveedor.ts:27-28` | M |
| Z7 | Alta de proveedor **sin auditoría** | `alta-proveedor.ts:27` | B |
| Z8 | `capacidades_sucursal` (editar capacidades) corre en transacción `SIMPLE` y no tiene control optimista (último gana) | ficha de `actualizar-capacidad.ts:40` | B |
| Z9 | `User.activoGlobal`: la baja de cuenta es kill-switch en vivo, pero **no encontré una acción de la app que lo apague** (solo lecturas y plataforma). NO VERIFICADO si existe vía consola | grep `activoGlobal` | B |

### 6.5 Dinero
| # | Riesgo | Evidencia | Sev. |
|---|---|---|---|
| D1 | **No hay cobro, caja ni medio de pago de ventas**: "cerrar cuenta" descuenta stock y registra operaciones, pero nada indica si se cobró, cómo ni cuánto en cada medio. No hay conciliación posible con efectivo/tarjeta/transferencia | `cuenta-cierre.ts:17-18` | A (producto, no bug) |
| D2 | `Venta.importeTotal` existe pero **nadie la escribe**; la plata de ventas se deriva del Kardex (`importeDeLinea`) | `schema:2724` | M |
| D3 | **`Cliente.descuentoPorcentaje` sin CHECK en la base** (0 <= % < 100 solo en el guard). Un script, migración o SQL directo podría guardar 100 o negativo y regalaría el consumo o lo encarecería. Se **congela** en la cuenta, así que el daño se propaga | `schema:763`, ningún `CHECK` en migraciones de Cliente | M |
| D4 | `Proveedor.condicionIva` y `Empresa.condicionIva`/`llevaIvaDeCompras` **sin escritor**: todo cálculo de IVA que dependa de ellos "falla cerrado" (NULL) o queda en la perilla apagada: hoy todo se carga con IVA incluido. Riesgo de que se asuma que existen datos que nadie carga | `schema:652,2506,2512` | M |
| D5 | `PagoConsignante.importe` Decimal(14,4) mientras el resto de dinero va en (14,2): posible mezcla de precisión al restar de liquidaciones | `schema:688` vs `schema:2736` | B |
| D6 | `FacturaProveedor.medioPagoDeclarado`/`fechaPagoDeclarada` sin uso y con CHECK: confunde el modelo de pagos (hay dos "medios" distintos: columna y `PagoDeFacturaProveedor.medio`) | `schema:2793-2795` | B |
| D7 | `ZONA_ARGENTINA` fija en validaciones de fecha de pago, mientras `Empresa.zonaHoraria` es configurable: inconsistencia si se vende a otra zona | `declarar-pago-de-factura-proveedor.ts:31` | B |

---

## 7. Qué NO pude verificar (NO VERIFICADO)
1. Existencia de un plan aprobado de "Partes" en `motor2-docs` (repo no presente en esta máquina); solo vi `zuluhub-docs` (Pedernal).
2. Quién carga `Empresa.condicionIva` y `Empresa.llevaIvaDeCompras` en producción (puede ser SQL manual de la plataforma): en código no hay escritor.
3. Si hay pantalla/acción para apagar `User.activoGlobal`.
4. Aislamiento real de `Invitacion` (`lectura_por_token`) y de RLS por sucursal: lo leí en comentarios y migraciones, no lo ejecuté.
5. Si algún texto libre se exporta a Excel/CSV con inyección de fórmulas (`src/core/excel.ts` existe; no lo auditó).
6. Cantidad de datos reales (cuántos proveedores/clientes hay, cuántos con CUIT).
7. Contenido completo de las pantallas de clientes y proveedores (solo vi `proveedor-form.tsx` línea del nombre `required`).

## 8. Archivos clave (rutas)
- `/home/user/motor2/prisma/schema.prisma`
- `/home/user/motor2/src/core/fiscal/cuit.ts`, `iva.ts`
- `/home/user/motor2/src/core/datos/limites.ts`
- `/home/user/motor2/src/core/texto.ts`
- `/home/user/motor2/src/core/features/catalogo/{proveedores.guard,contacto-de-proveedor,proveedores.schema}.ts`
- `/home/user/motor2/src/core/features/clientes/{clientes.guard,clientes.schema,auditoria-de-cliente}.ts`
- `/home/user/motor2/src/server/actions/catalogo/{proveedores.ts,casos-de-uso/alta-proveedor.ts,casos-de-uso/actualizar-proveedor.ts}`
- `/home/user/motor2/src/server/actions/clientes/{cliente.ts,casos-de-uso/*.ts}`
- `/home/user/motor2/src/server/actions/auth/{sucursales.ts,usuarios.ts,invitacion.ts,casos-de-uso/*.ts}`
- `/home/user/motor2/src/server/actions/permisos/{roles,permisos,capacidades-sucursal}.ts`
- `/home/user/motor2/src/core/permisos/*.ts`, `/home/user/motor2/src/server/acceso/*.ts`, `/home/user/motor2/src/server/sesion/contexto.ts`, `/home/user/motor2/src/lib/auth.ts`
- `/home/user/motor2/src/core/carta/{marca,portal,tema,color-css}.ts`
- `/home/user/motor2/src/core/compras/pago-de-factura.ts`, `/home/user/motor2/src/server/actions/movimientos/casos-de-uso/declarar-pago-de-factura-proveedor.ts`
- `/home/user/motor2/plataforma/src/servidor/{empresas,ciclo-de-vida}.ts`, `/home/user/motor2/src/core/features/empresa/*.ts`
