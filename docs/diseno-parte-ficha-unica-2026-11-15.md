# Diseño: Parte (ficha única de clientes y proveedores) — actualización y primer paso (2026-11-15)

Estado: **diseño en papel. Sin código, sin migraciones, sin tocar ninguna base.** **Ninguna migración tiene autorización expresa.** Este documento **actualiza y no reemplaza** `docs/diseno-parte-2026-11-12.md` (todas sus decisiones de diseño están confirmadas por el dueño; no se reabren). Agrega lo que cambió desde entonces, lo que la cadena «identidad del renglón → factura externa N1 → N2» le pide a la ficha, el recorte del primer paso más barato y las preguntas que quedan.

Estados de cada decisión: **CONFIRMADA** (dicha por el dueño, con cita y fecha), **PROPUESTA**, **PENDIENTE**, **NO VERIFICADA**. Marcas de verdad: **(V)** verificado en el código; **(DOC)** sale solo de un documento.

Fotos usadas: Motor2 `origin/main` `a7077f52` (2026-11-15). Pedernal: código `ZuluHub-ERP` `7f3931be` (2026-11-14 23:28 -03:00) y documentos `ZuluHub-docs` `82b99179` (2026-11-15 00:38 UTC). Plan de paridad: `motor2-docs`, `_planes/plan-de-paridad-con-pedernal-2026-11-14.md` (etapa E7).

Redacción genérica a propósito (el repositorio es público): sin nombres de sucursales, cifras ni identificadores de bases reales.

## Para el dueño, en ocho líneas

1. La ficha única «Parte» ya está diseñada y confirmada (11-12/13). Antes de la factura externa tiene que existir al menos la **primera etapa** (P1), porque el comprobante identifica al cliente por CUIT y hoy `Cliente` no tiene ese dato.
2. Verifiqué contra el código de hoy: `Cliente` y `Proveedor` **no cambiaron de forma**; solo se sumaron dos protecciones chicas en `Cliente` (un tope del descuento y nombre único sin distinguir mayúsculas). No cambian el diseño.
3. Lo que la cadena de la factura externa necesita de la ficha es poco: **P1** antes de cargar facturas (N1) y **P3** (ligar la ficha al cliente de descuento) antes de conciliar por cliente (N2). **P2 (vínculos) y P4 (retiro de lo viejo) no entran en esta cadena**: pueden esperar.
4. Pedernal no cambió lo que importa para la ficha (verificado en su código de ayer). Hay tres diferencias entre lo que dice su documento y lo que hace su código; las anoto abajo.
5. El diseño del 11-12 se escribió **antes** de que ratificaras «lo nuevo nace con la forma de Pedernal» (2026-11-15). Propongo un ajuste chico del nivel 6 (identificador y clave de alta): lo explico en §4.
6. Primer paso más barato: **P1 tal como está diseñada** (ficha del proveedor, con copia de los proveedores de hoy en la misma migración). Hay una alternativa (partirla en dos) con su costo; la dejo anotada como decisión técnica.
7. **Una pregunta de negocio:** ¿a quien se le factura hace falta que exista como «Cliente» (perfil de descuento) o alcanza con su ficha? (§7).
8. Sigue sin autorización de migración: se pide aparte cuando quieras construir P1.

---

## 0. Decisiones del dueño que usa este documento

Las del 11-12/13 están citadas, con su texto literal, en `diseno-parte-2026-11-12.md` §0 (D1 a D19); acá solo las que importan para este paso y las nuevas.

| # | Fecha | Texto literal | Fuente | Qué fija | Estado |
|---|---|---|---|---|---|
| D1/D2 | 2026-11-12 | «tabla única» y «Si ficha de parte si, igual a la de Pedernal» | diseño del 11-12, §0 | Una tabla `Parte`, igual a la de Pedernal | **CONFIRMADA** |
| D9 | 2026-11-12 | «Me parece que B es la correcta… se le cargará la ficha… De paso, cada vez que se tenga que facturar a una de esas personas, ya queda cargado.» | diseño del 11-12, §0 | Todo cliente (empleado, residente, empresa con descuento) tiene su ficha | **CONFIRMADA** |
| D12, D14 | 2026-11-13 | «Acepto recomendaciones»; «Uno solo por ficha (Recomendada)» | diseño del 11-12, §0 | El % de descuento queda en la fila `Cliente`; un cliente por ficha | **CONFIRMADA** |
| D16 a D19 | 2026-11-13 | opciones recomendadas (pendiente de completar; nota cerrada; rol = ficha de proveedor; auditoría sin valores) | diseño del 11-12, §0 | Las 4 reglas donde Motor2 difiere de Pedernal | **CONFIRMADA** |
| N-1 | 2026-11-14 | «Esperar a Parte (ficha única como Pedernal) (Recomendada)» (a «¿dónde va el CUIT del cliente?») | `motor2-docs`, `seguimiento-de-pedernal/decisiones-del-dueno-2026-11-14-mesa-resend-contador.md`, sección «CUIT del cliente, cobro y registro…» | **No se agregan columnas a `Cliente`**; la ficha Parte va **antes** de la factura externa | **CONFIRMADA** |
| N-2 | 2026-11-15 | «Sí, copiar a Pedernal en esas cinco (Recomendada)» | mismo archivo, sección «Factura externa: campos, tipos, nota de crédito parcial y ratificación en bloque» | E5: lo nuevo nace con la forma de Pedernal (identificador que manda la aplicación, fecha con zona, solo inserción) | **CONFIRMADA en dirección**; ninguna migración autorizada |
| N-3 | 2026-11-13 | «Necesitamos ser iguales en todo. Por la salvedad de que nosotros usamos Prisma… el resultado tiene que ser el mismo y sobre todo de las mismas formas» | `AGENTS.md`, «Paridad con Pedernal» | Toda diferencia con Pedernal lleva motivo | **CONFIRMADA** |
| — | — | Autorización de la migración de P1 a P4 | — | — | **PENDIENTE** (no existe) |

---

## 1. Niveles 1 a 5: qué queda igual y qué se agrega

Los niveles 1 a 5 del 11-12 (§1, §3, §4, §7 de ese documento) **siguen vigentes sin cambio**. Se agrega solo lo siguiente.

**Nivel 1 (propósito).** Se suma una necesidad con dueño y fecha: *«identificar al cliente por CUIT… una vez cargado, el módulo de clientes lo identifica; si ya existe se le indica y no se carga de nuevo»* (dueño, 2026-11-04, punto 4 de `docs/diseno-caja-y-cobros-2026-11-04.md` §0.1, CONFIRMADA) y N-1 (la ficha va antes de la factura externa). Esa necesidad ya la cubre el caso de uso CU4 (buscar por documento) y CU1 (alta) del 11-12: **no se suma ninguna función**.

**Nivel 2 (actores).** Sin cambio. Quien carga un comprobante externo (administración, permiso propio de ese módulo) **no necesita** `partes_editar` para *buscar* una ficha, pero para *crear una ficha al instante* desde la pantalla del comprobante necesita el permiso de alta de ficha (D10: igual que Pedernal, el operario da de alta). Ver tabla «¿qué pasa si…?» de §3.

**Nivel 3 (casos de uso).** Sin cambio. La cadena usa **CU1, CU2, CU4** (P1) y **CU8** (P3). No usa CU6 ni CU7 (vínculos, P2) ni la retirada de columnas (P4).

**Nivel 4 (conceptos).** Sin cambio, más una aclaración de **rol** que hace falta para la factura externa: en Pedernal una parte **puede no tener ningún rol** (verificado en su código: `crearParte` acepta roles vacíos; la base no exige ninguno). En Motor2 el rol «es tener la ficha del rol» (R-3, D18). Por lo tanto una parte sin ficha de cliente ni de proveedor es válida y es lo que usaría un comprobante cuyo cliente no tiene descuento. Ver pregunta de negocio P-1.

**Nivel 5 (invariantes).** Sin cambio. Se agrega **una** regla propia de la cadena (la decide el diseño de la factura externa, no la ficha): *una ficha inactiva no se ofrece para comprobantes nuevos; los ya cargados no cambian* (PROPUESTA, coherente con «inactiva = no se ofrece en operaciones nuevas», 11-12 §1 nivel 4).

---

## 2. Qué cambió desde el diseño del 11-12 (verificado)

### 2.1 Motor2

| # | Hecho | Verificación | Efecto en el diseño |
|---|---|---|---|
| M-1 | `Cliente` tiene ahora un CHECK del descuento (0 ≤ % < 100) | (V) migración `20261112160000_checks_de_datos_basicos` (PR #250, posterior a la foto `5ef9b5f5` del 11-12) | El inventario del 11-12 §2.1 decía «CHECK: ninguno». **Desactualizado en esa fila**; no cambia el diseño |
| M-2 | `Cliente` tiene ahora un único `(empresaId, lower(nombre))` | (V) migración `20261112170000_nombre_unico_sin_mayusculas` (PR #251) | Mismo efecto: el nombre del cliente ya es único sin distinguir mayúsculas **en la base**. En P3 la ficha **no** reemplaza ese nombre (el nombre del perfil de descuento sigue siendo el de `Cliente`) |
| M-3 | Última migración del repositorio: `20261112170000_…`; la de Parte debe llevar un sello **posterior** | (V) `prisma/migrations` | Dato operativo para quien escriba P1 |
| M-4 | `Cliente`, `Proveedor`, `Cuenta` y las tablas que los referencian **no tienen más cambios de forma** | (V) `prisma/schema.prisma` (`Proveedor` `:636-671`, `Cliente` `:756-771`) y `git log 5ef9b5f5..origin/main` sobre `prisma/` | El inventario del 11-12 §2.2 a §2.3 **sigue valiendo** |
| M-5 | Permisos: `clientes` (módulo `clientes_basico`, administrador) y `proveedor_alta` / `proveedores` (módulo `proveedores_basico`) siguen como el 11-12 los describe | (V) `src/core/permisos/acciones.ts:215,235,62` | Sin cambio. El 11-12 propone las claves nuevas `partes_ver`, `partes_editar`, `partes_desactivar` dentro de `proveedores_basico` para P1; ver decisión técnica T-3 sobre qué módulo las lleva cuando llegue P3 |
| M-6 | Los conteos de filas reales (proveedores, clientes, CUIT válidos) **siguen sin medirse** | NO VERIFICADO (la consulta de solo lectura está escrita en el 11-12 §2.4 y el dueño autorizó su lectura el 2026-11-12) | Ver §5: es lo primero que hay que correr antes de P1 |

### 2.2 Pedernal (código `7f3931be`, documentos `82b99179`)

Verificado en su migración `0034_clientes.sql` y en `src/modulos/clientes`: **no cambió nada de lo que usa el diseño** (`parte` con naturaleza obligatoria, documento de 6 tipos, 11 condiciones de IVA, nota hasta 2.000, vínculos, versión, solo inserción de vocabularios, RLS forzada). Tres diferencias **entre su documento y su código** que conviene tener presentes (la regla de paridad manda copiar el **comportamiento real**, o sea el código):

| # | Su documento dice | Su código hace | Qué hace este diseño |
|---|---|---|---|
| P-a | La condición de IVA de la ficha lista 6 valores | La migración tiene las **11** de WSFE | El 11-12 ya usa 11 (D3). Sin cambio |
| P-b | Pasaporte de 3 a 20 caracteres y teléfono de 6 a 15 dígitos | Pasaporte de **6 a 9** (decisión del dueño de Pedernal del 06/11) y teléfono de **1 a 40** caracteres imprimibles | El 11-12 ya adoptó el teléfono del código (S5, CONFIRMADA). **El pasaporte de 6 a 9 no estaba en el 11-12** (copió 3 a 20 del documento): corrección a hacer en el nivel 6 (PROPUESTA, igual a Pedernal; ver §4) |
| P-c | Anonimizar y buscar también por correo y teléfono | Existe el estado `ANONIMIZADA` en la base pero **no hay caso de uso**; la búsqueda usa solo nombre y documento (el correo y el teléfono solo sirven para avisar de posibles duplicados) | El 11-12 dice «buscar por documento, nombre, alias, correo o teléfono» (CU4) y S1 deja «anonimizar» fuera. **Ajuste PROPUESTO:** CU4 busca por nombre y documento como Pedernal; correo y teléfono solo en el aviso de duplicado. Es una **reducción** de lo diseñado (poda: nadie pidió buscar por teléfono) |

Además, de Pedernal conviene copiar (ya está en el 11-12): `cuit_valido` (módulo 11, sin validar el prefijo), documento normalizado único por empresa incluso entre inactivas, jurídica solo CUIT o ID extranjero, domicilio AR estructurado o extranjero en texto, vínculos `CONTACTO` y `AGENTE_DE`.

---

## 3. Lo que la cadena pide de la ficha: dependencias mínimas

| Necesidad (con quién la pidió) | Qué etapa de Parte la cubre | ¿Entra en la cadena? |
|---|---|---|
| Cargar una factura externa con el cliente **por CUIT**, que se busque y, si no existe, se ofrezca cargarlo al instante (dueño, 2026-11-04, punto 4; confirmada) | **P1**: tabla `Parte`, `cuit_valido`, alta/edición/búsqueda (CU1, CU2, CU4) | **Sí**, antes de FE-N1 |
| Letra A exige cliente con CUIT; B admite consumidor final y DNI (C9, CONFIRMADA la parte del CUIT) | P1 (documento de 6 tipos con las reglas de Pedernal) | Sí |
| «Cliente específico (empresa, empleado, consumidor final recurrente identificado) → trae **sus** tickets» (punto 5 del 11-04) | **P3**: `Cliente.parteId`; la cuenta ya apunta a `Cliente` (`Cuenta.clienteId`), el cliente apunta a su ficha | **Sí**, antes de FE-N2 (la parte «por cliente» de la propuesta) |
| El agente de una empresa es una persona de la empresa (H2 del 26/10; punto 12 del 11-04) | P2 (vínculos) | **No** en esta cadena: sirve a convenios y reservas |
| Retirar columnas viejas de `Proveedor` | P4 | **No**; es limpieza |

**Orden mínimo propuesto (PROPUESTA, decisión técnica T-1): P1 → FE-N1 → P3 → FE-N2.** P2 y P4 quedan para después. Esto **respeta** la decisión N-1 («la ficha va antes de la factura externa»): P1 va antes de FE-N1 y P3 antes de FE-N2.

Sin P3, FE-N2 igual funcionaría para consumidor final y para elegir a mano al cliente; solo faltaría proponer «los tickets de este cliente» automáticamente. Por eso P3 es requisito de esa función puntual, no de N2 entera.

---

## 4. Ajustes propuestos al nivel 6 del 11-12 (por E5 y por la paridad)

Se **dejan como PROPUESTA** y no tocan lo confirmado: el 11-12 los marcó «los resuelve quien construye».

| # | Qué dice el 11-12 | Ajuste propuesto | Motivo |
|---|---|---|---|
| A-1 | `Parte.id` texto `cuid` y una columna aparte `claveIdempotencia uuid NOT NULL` con único `(empresaId, claveIdempotencia)` | `Parte.id` **uuid** (lo genera la aplicación) y la clave de alta como en Pedernal: columna aparte `idempotenciaAlta` uuid, única por empresa (verificado en su `0034`: `parte_idempotencia_uk`). Cambia el **tipo** del id (cuid → uuid) y el **nombre** de la columna; la mecánica de reintento es la del 11-12 | N-2 (E5, ratificada): identificador que manda la aplicación; paridad con la forma real de Pedernal |
| A-2 | Fechas `timestamptz` | Sin cambio (ya estaba) | — |
| A-3 | Pasaporte con el patrón del documento (3 a 20) | Pasaporte `^[A-Z0-9]{6,9}$` con país; ID extranjero `^[A-Z0-9]{3,20}$` con país | Corrección P-b (el código de Pedernal manda) |
| A-4 | Historial de la ficha solo por auditoría | Sin cambio en P1. La **versión de fila** ya está | Pedernal tampoco guarda historial aparte de la auditoría |
| A-5 | CU4 busca por documento, nombre, alias, correo o teléfono | Nombre y documento; correo y teléfono solo para avisar duplicados | P-c |
| A-6 | Columnas del cliente: `Cliente.parteId` con único parcial | Sin cambio. Se suma: **el nombre del cliente sigue siendo único sin distinguir mayúsculas** (M-2) y no se reemplaza por el de la ficha | M-2 |

Las FK de `Proveedor.parteId` y `Cliente.parteId` apuntan a `Parte.id`: si `Parte.id` es uuid, esas columnas nuevas son uuid. Las tablas existentes siguen con su `id` texto; no se convierte ninguna (E5 clase «solo lo nuevo»; convertir lo viejo sería destructivo y no se propone).

---

## 5. Primer paso más barato y migración de datos reales

### 5.1 Qué copia la migración de datos (sin pérdida)

La regla de copia del 11-12 §5.5 **sigue vigente** (nunca se inventa un dato: CUIT inválido queda vacío en la ficha y visible como «CUIT anterior, pendiente de corregir»; naturaleza deducida del prefijo 20/23/24/27 o 30/33/34 y, si no hay CUIT válido, «pendiente de completar»; `contacto` no se copia; nombre >80 no entra). Lo único nuevo:

- El tope de nombre de la ficha es 200 (como Pedernal); mientras exista la copia en `Proveedor.nombre` el efectivo es 80 (R-9 del 11-12).
- Antes de escribir la migración hay que **correr en solo lectura** las consultas del 11-12 §2.4 y `npm run medir-cuit` **sin pegar nombres ni documentos en ningún chat** (el dueño autorizó la lectura el 2026-11-12, «5.-Si»). Con esos números se ve cuántos proveedores quedarán «pendientes de completar»; es información para el dueño, no una decisión técnica.
- Reversibilidad: sin cambios (`down.sql` que se niega si ya hay fichas no migradas o ediciones; P4 destructiva con aviso previo).

### 5.2 Opciones para empezar

| Opción | Qué se migra primero | Qué ve el dueño | Costo y riesgo | Cuándo conviene |
|---|---|---|---|---|
| **A. P1 tal como está diseñada** (recomendada) | `Parte`, `cuit_valido`, `Proveedor.parteId` y la copia de todos los proveedores, **una** migración | La ficha completa en la pantalla de proveedor; «pendiente de completar» donde falte el dato | Una migración con datos reales (ensayo en copia, subir-bajar-subir). Es lo que el dueño ya vio y confirmó | Si se prefiere no discutir nada de lo confirmado |
| **B. Partirla en dos** | P1a: `Parte` + `cuit_valido` + casos de uso de alta/edición/búsqueda, **sin tocar `Proveedor`**; P1b: `Proveedor.parteId` + copia | En P1a solo se vería una ficha nueva sin proveedores asociados | Dos migraciones. P1a deja una tabla cuyo único escritor visible sería una pantalla «Partes» que el 11-12 no previó (la ficha se mostraba dentro de proveedor) o el alta al instante de FE-N1 (**tabla sin escritor propio hasta FE-N1**, lo que la regla «nada de tablas a ciegas» no admite) | Solo si el dueño quiere ver la factura externa **antes** de tocar los proveedores |

**Recomendación: A.** Es la única que cumple a la vez «primero lo más barato que se pueda usar» y «sin tabla a ciegas»: P1 entrega un escritor y una pantalla (proveedor) desde el primer día. B se descarta salvo pedido. La elección es una **decisión técnica de secuencia** (T-6), no una pregunta al dueño: no cambia datos, dinero ni permisos.

---

## 6. Tabla «¿qué pasa si…?» para los comandos que la cadena invoca

Los comandos de la ficha ya tienen su tabla en `diseno-parte-2026-11-12.md` §3. Acá solo lo que cambia cuando los llama **otro módulo** (la pantalla de comprobante externo):

| | **Alta de ficha al instante desde un comprobante (CU1 invocado por FE-N1)** | **Ligar ficha a cliente (CU8, P3)** |
|---|---|---|
| Repetición (doble clic, reintento) | El `id` uuid que manda la pantalla es la clave de alta: el mismo envío devuelve la misma ficha («ya existía»); mismo `id` con otros datos: `CLAVE_REUTILIZADA` | Reintento: «ya estaba ligado»; no duplica |
| Concurrencia | Dos altas del mismo CUIT: una gana, la otra recibe `DOCUMENTO_YA_REGISTRADO` con el id de la ganadora y **la pantalla usa esa ficha** (no un error) | Dos clientes a la misma ficha: lo impide el único parcial `(empresaId, parteId)`; gana uno (D14) |
| Tiempo | La ficha nace ahora; no hay fechas de vigencia | Idem |
| Incertidumbre | Si no se sabe si se creó (corte de red), el reintento con el mismo `id` lo resuelve | Idem |
| Error parcial | La ficha y su auditoría se guardan juntas; si falla el comprobante **después**, la ficha queda creada (es válida por sí sola) | Ligadura y auditoría juntas |
| Datos faltantes | Naturaleza y nombre obligatorios; sin documento la ficha queda «sin documento» y **no sirve para letra A** (lo exige el comprobante, no la ficha) | Cliente sin ficha: sigue funcionando como hoy |
| Cambio de permisos | Se valida en el servidor cada vez, con el permiso de alta de ficha (D10); quien carga comprobantes pero no puede dar de alta fichas **solo puede elegir una existente** | Permiso del catálogo de clientes |
| Ficha inactiva | No se ofrece en comprobantes nuevos; reactivar es de administrador o gerente (D10) | No se liga a un cliente nuevo |

---

## 7. Preguntas de NEGOCIO abiertas

**P-1 (modelo de datos). ¿Hace falta que una persona o empresa exista como «Cliente» para poder facturarle, o alcanza con su ficha?**
Hoy «Cliente» en Motor2 es un **perfil de descuento** del salón (D8 del 11-12). Una empresa que pide factura A y **no tiene descuento** no es ninguno de esos perfiles. Pedernal no obliga: una ficha puede no tener ningún rol.
- **Opción 1 (recomendada):** alcanza con la ficha. El comprobante externo apunta a la ficha; «Cliente» sigue siendo solo el perfil de descuento. Lo más barato: no hay que crear un «cliente al 0 %» por cada empresa a la que se factura.
- **Opción 2:** toda persona o empresa a la que se factura tiene también su fila de «Cliente» (con 0 % si no tiene descuento). Más cargas y dos lugares que mantener.
- **Si no se responde:** se asume la opción 1 (declarado como supuesto), porque no agrega nada y se puede cambiar después sin perder datos (agregar el cliente a una ficha es aditivo).

*(La pregunta de si a un consumidor final con DNI en factura B se le **guarda la ficha** o solo se anota el DNI en el comprobante está en el documento de la factura externa, `diseno-factura-externa-n1-n2-2026-11-15.md`, porque cambia cómo se guarda un dato personal.)*

---

## 8. Decisiones técnicas (con recomendación; no se le preguntan al dueño)

| # | Decisión | Recomendación y motivo |
|---|---|---|
| T-1 | Orden mínimo de etapas de Parte antes de la cadena | **P1 → FE-N1 → P3 → FE-N2**; P2 y P4 después. Respeta N-1 y no suma funciones |
| T-2 | Forma de lo nuevo (E5) | Ajustes A-1 a A-6 de §4 |
| T-3 | Módulo que lleva las claves `partes_*` | En P1, `proveedores_basico` (como el 11-12). Al llegar P3, la ficha sirve también a `clientes_basico` y a `salon`: evaluar un módulo de soporte propio (`partes_basico`) que ambos requieran. Se decide al diseñar P3; no cambia datos |
| T-4 | La instantánea del receptor vive en el comprobante, no en la ficha | Igual que Pedernal (ADR-014): el comprobante copia nombre, documento, condición de IVA y domicilio; guarda `parteId` solo como referencia opcional. Se detalla en el documento de la factura externa |
| T-5 | `FORCE ROW LEVEL SECURITY` | Sin cambio respecto del 11-12 (PROPUESTA con reserva) |
| T-6 | Empezar por A o por B (§5.2) | **A** |
| T-7 | Prueba de paridad `cuit_valido` SQL ↔ `esCuitValido` TS | Sin cambio (con propiedades de `fast-check`, ya en las dependencias) |
| T-8 | Sello de la migración | Posterior a `20261112170000` |

---

## 9. Pruebas y combinaciones (nivel 10)

Sin cambio respecto del 11-12 §4.2 y §8.1 (oráculo A–E contra la base real y contra el validador; guardián de dimensiones; paridad SQL ↔ TS; concurrencia de dos altas del mismo CUIT; idempotencia; aislamiento entre empresas; migración subir–bajar–subir; mutación de los CHECK nuevos; e2e a 375 px con datos reales de la empresa).

**Dimensiones nuevas que declara este documento** (afectan visibilidad y permisos de lo que sigue): *estado de la ficha* (activa o inactiva) × *quién pide* (con o sin permiso de alta) × *documento de la ficha* (CUIT, DNI, extranjero, ninguno), cruzadas con la letra del comprobante en el oráculo de la factura externa. El oráculo vive en el documento de la factura externa; acá solo se declara que la ficha **expone** esas tres dimensiones.

**Necesidad que resuelve cada ajuste** (poda): A-1 a A-3 y A-6, la regla de paridad y la ratificación de E5; A-5 **reduce** la búsqueda a lo que Pedernal hace.

---

## 10. NO VERIFICADO

1. Cantidad de proveedores y clientes reales, CUIT válidos y teléfonos o correos que no pasarían las reglas (consultas escritas, no corridas).
2. Cómo trata Prisma la columna generada `GENERATED ALWAYS … STORED` (Pedernal las usa para `nombre_busqueda`, `documento_normalizado`, `telefono_digitos`; Motor2 no tiene ninguna). Alternativa ya descrita en el 11-12 §5.1.
3. Si `createMany({ skipDuplicates })` de Prisma se comporta como `ON CONFLICT DO NOTHING` dentro de una transacción SERIALIZABLE.
4. Que los prefijos 20/23/24/27 y 30/33/34 sean exactos según ARCA (lo dice el código de Motor2, no una fuente oficial; Pedernal tampoco valida el prefijo).
5. Qué otros scripts leen con el rol dueño y se romperían con `FORCE ROW LEVEL SECURITY`.
6. Contexto exacto de la decisión de Pedernal del pasaporte de 6 a 9 (la cita es la del encabezado de su migración).

---

## Decisiones a esperar del dueño (resumen)

Una pregunta de negocio abierta (P-1). La autorización de la migración de P1 se pide aparte, cuando quiera construirse.

Autoría: este documento lo escribió **Sonnet** (sesión de diseño en papel). No hay código.
