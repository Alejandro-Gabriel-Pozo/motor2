# Diseño: la ficha de parte (una sola ficha para cliente y proveedor) — 2026-11-12

Estado: **diseño en papel con TODAS las decisiones de diseño confirmadas por el dueño** (las 5 reglas de §6.2 incluidas: D4, D16 a D19; los mecanismos técnicos marcados PROPUESTA —cómo se implementa cada regla— los resuelve quien construye, sin cambiar lo decidido). Sin código, sin migraciones, nada en `prisma/`, `src/`, `test/` ni `scripts/`. El dueño confirmó el 2026-11-13 dónde queda el % de descuento (opción A, D12) y los supuestos S1 a S9 (D13); las etapas P1 a P4 siguen en **PROPUESTA**. **Ninguna migración tiene autorización expresa todavía**: hace falta la del dueño, dicha para esta migración, antes de escribir o aplicar cualquier `migration.sql` (la autorización general de integrar las migraciones de la auditoría, 2026-11-12, es de otras migraciones y no alcanza a ésta).

Foto de Motor2: `origin/main` en `5ef9b5f5` (verificado con lectura del código de este repositorio). Foto de Pedernal: código en `/home/user/alejandro-gabriel-pozo/zuluhub-erp` (solo lectura; `migraciones/0034_clientes.sql`, `migraciones/reversiones/0034_revertir_clientes.sql`, `src/modulos/clientes/**`, `src/primitivas/contacto/telefono.ts`, `src/capacidades/permisos/empresa.ts`) y documentos en `/home/user/zuluhub-docs/11-especificaciones/clientes-y-proveedores.md`.

Fuentes de este diseño: la auditoría `docs/auditoria-primitivas-pedernal-motor2-2026-11-12.md` (rama `claude/auditoria-primitivas-pedernal-motor2-2026-11-12`: §2.2, §4, §5.1 X1–X10, §9) y sus anexos B, E y G; el piloto `docs/diseno-clientes-convenios-y-facturacion-externa-2026-10-26.md`; `motor2-docs/_planes/_decisiones-del-dueno-2026-10-05.md`.

Marcas de verdad: **(V)** verificado en el código de hoy (Motor2 o Pedernal, con archivo); **(DOC)** sale solo de un documento; **NO VERIFICADO** no se pudo comprobar. Estados de decisión: **CONFIRMADA** (la dijo el dueño, con cita), **PROPUESTA** (de este diseño), **PENDIENTE** (falta decidir), **NO VERIFICADA**.

---

## Para el dueño, en diez líneas

1. Hoy Motor2 tiene **dos fichas separadas**: Cliente (solo nombre y % de descuento) y Proveedor (nombre, CUIT, teléfono, correo, notas…). No hay ficha de persona ni de empresa.
2. Se propone una **ficha única «Parte»** igual a la de Pedernal: persona o empresa, nombre, apellido y alias, documento (6 tipos), condición frente al IVA del receptor (11), correo, teléfono, domicilio, nota de 2.000 y los vínculos «Contacto» y «Agente de».
3. La ficha guarda **solo quién es** la persona o la empresa. Lo que es de un rol (las condiciones de pago del proveedor, el % de descuento del salón) sigue en su propia ficha y **apunta** a la Parte. Así lo hace Pedernal.
4. Primer paso propuesto (el más barato que se puede usar): **la ficha de parte para los proveedores**. Cada proveedor de hoy recibe su Parte copiando lo que ya tiene; nada de lo que funciona se rompe.
5. Lo que no se sabe no se inventa: si un proveedor no tiene CUIT, su ficha queda «pendiente de completar» (persona o empresa sin declarar).
6. **Los clientes de hoy pasan a tener su ficha** (D9, opción B del dueño: «se le cargará la ficha»): hoy son sobre todo perfiles de descuento («Residente 15 %», «Empleado 25 %», ISSN) y hay que cargar la ficha de cada persona o empresa; **el porcentaje queda en la fila Cliente** (D12, opción A). Las preguntas 2 y 3 quedaron resueltas (D10 y D11).
7. Dos altas del mismo CUIT al mismo tiempo dejan **una sola** ficha; un reintento no duplica.
8. Cada etapa se puede deshacer (`down.sql`) mientras no haya datos nuevos que se perderían; lo que borre algo se avisa antes, con los datos a la vista.
9. Hay **5 reglas donde Motor2 da otro resultado que Pedernal** (§6.2): el dueño las decidió una por una (R-1 a R-4 el 2026-11-13, D16 a D19; R-5 ya estaba decidida, D4).
10. Preguntas clave: las tres están resueltas (D12 el %, D10 permisos, D11 nombres repetidos); los supuestos S1 a S9 están confirmados (D13). «Un cliente por ficha» quedó confirmado (D14) y las 5 reglas de §6.2 también (D16 a D19; R-5, D4). **No hay decisión de diseño pendiente; sigue sin autorización de migración** (se pide aparte cuando se quiera construir P1).

---

## 0. Decisiones del dueño que este diseño usa (citas textuales)

| # | Fecha | Texto literal | Fuente | Qué fija | Estado |
|---|---|---|---|---|---|
| D1 | 2026-11-12 | «tabla única» (a «¿tabla única "Parte" o columnas sobre Cliente y Proveedor?») | auditoría §9.0 | Una sola tabla Parte, no columnas sueltas en Cliente y Proveedor | **CONFIRMADA** |
| D2 | 2026-11-12 | «Si ficha de parte si, igual a la de Pedernal» | mensaje del dueño relayado por el orquestador en esta tarea | La ficha copia los campos y reglas de la `parte` de Pedernal | **CONFIRMADA** |
| D3 | 2026-11-12 | «1.-Si» (condición de IVA de la ficha = la del receptor, 11 valores, aparte de la del emisor) | auditoría §9.0 | Dos listas distintas; no se reutiliza la de `Empresa` | **CONFIRMADA** |
| D4 | 2026-11-12 | «4.- que sigan sin entrar» (caracteres `¿ ¡ ? ! $` en nombres) | auditoría §9.0 | El nombre de la Parte usa la lista de permitidos de Motor2, **no** la de Pedernal | **CONFIRMADA** |
| D5 | 2026-11-12 | «Quiero tener lo mismo que en Pedernal salvo [el tema de] Kysely, acá estamos usando Prisma y lo mantengo» | auditoría §9.1 | Modelo y reglas iguales; acceso a datos con Prisma | **CONFIRMADA** |
| D6 | 2026-11-12 | «eso habrá que adaptarlo si es necesario y poder mejorarlo; Pedernal no lo tiene en su primera versión, y es muy distinto a sacarlo» | auditoría §9.1 | La consignación (que Pedernal no tiene) se conserva y se adapta a la Parte | **CONFIRMADA** |
| D7 | 2026-10-26 | «Una persona puede ser agente de varias empresas (N:M), con un solo vínculo vigente por par; en el POS se elige la empresa» (respuesta 2, «lo recomendado») | `docs/diseno-clientes-convenios-…-2026-10-26.md` §H | Regla del vínculo «Agente de» | **CONFIRMADA** |
| D8 | 2026-10-05 | «…un buscador con códigos por cliente: 00 Consumidor final 0 %, 01 Residente 15 %, 02 ISSN 18 %, 03 EPEN (…es empresa pero no tiene descuento), 04 Empleado 25 %.» | `motor2-docs/_planes/_decisiones-del-dueno-2026-10-05.md`, fila 3 | Lo que hoy es un «Cliente» incluye perfiles que no son personas | **CONFIRMADA** como descripción; su efecto en la Parte es la **pregunta clave 1** |
| D9 | 2026-11-12 | «Me parece que B es la correcta. Si es un empleado y hay que cargarle la ficha, bueno, se le cargará la ficha. Si es un residente, se le cargará la ficha. Si es una empresa que tiene descuento especial, se le cargará la ficha. Y así quedará sentado. De paso, cada vez que se tenga que facturar a una de esas personas, ya queda cargado.» | chat del dueño con la sesión de la auditoría (respuesta a la pregunta clave 1, opción B) | Todo cliente (empleado, residente, empresa con descuento especial) tiene su ficha de parte; no quedan «perfiles» sin ficha | **CONFIRMADA** (qué se hace con el % lo resuelve D12) |
| D10 | 2026-11-12 | «Lo mismo que Pedernal en 2.» | mismo chat (pregunta clave 2) | Quién da de alta, edita y desactiva fichas: igual que Pedernal (el operario busca, da de alta y edita; solo el administrador o el gerente desactiva) | **CONFIRMADA** |
| D11 | 2026-11-12 | «En 3 también lo mismo.» | mismo chat (pregunta clave 3) | El nombre puede repetirse en la Parte, como en Pedernal (solo el documento no se repite; se avisa «posible duplicado»); el único de `Proveedor.nombre` se retira en P4, con aviso | **CONFIRMADA** |
| D12 | 2026-11-13 | «Acepto recomendaciones» (a la pregunta clave 1: % de descuento, opción A o B; la recomendada era A) | chat del dueño con el orquestador (relayado a la sesión de la auditoría; el orquestador fijó el alcance de la respuesta) | El % de descuento sigue en la fila `Cliente`, que ahora apunta a su ficha; «Consumidor final» (00, 0 %) sin ficha; sin categorías de descuento | **CONFIRMADA** |
| D13 | 2026-11-13 | «Acepto recomendaciones» (a los supuestos S1 a S9 del documento, cada uno con su recomendación escrita) | mismo chat | Los supuestos S1 a S9 de §7 quedan tal como el documento los recomienda | **CONFIRMADA** |
| D14 | 2026-11-13 | «Uno solo por ficha (Recomendada)» (a «¿una misma persona o empresa puede tener más de un cliente?») | chat del dueño con el orquestador (pregunta con opciones; texto literal de la opción que eligió) | Un cliente por ficha: `Cliente.parteId` lleva único `(empresaId, parteId)` (P3). La dirección es del dueño; el mecanismo (índice único parcial) es PROPUESTA | **CONFIRMADA** |
| D15 | 2026-11-13 | «Repasarlas de a una (Recomendada)» (a cómo decidir las 5 reglas de §6.2 donde Motor2 daría otro resultado que Pedernal) | chat del dueño con el orquestador (pregunta con opciones) | Las reglas de §6.2 se le preguntan **de a una**; **ninguna está decidida todavía** | **CONFIRMADA** como forma de decidir; las 5 reglas se decidieron después (D16 a D19; R-5, D4) |
| D16 | 2026-11-13 | «Quedan «pendiente de completar» (Recomendada)» (R-1) | chat del dueño con el orquestador (preguntas con opciones) | Un proveedor de hoy sin CUIT pasa a la Parte con naturaleza vacía, «pendiente de completar»; no se inventa el dato | **CONFIRMADA** |
| D17 | 2026-11-13 | «Se rechaza al guardar (Recomendada)» (R-2) | chat del dueño con el orquestador (preguntas con opciones) | Una nota con un carácter invisible o con etiquetas se rechaza al guardar (lista de permitidos, «todo nace cerrado») | **CONFIRMADA** |
| D18 | 2026-11-13 | «Se crea su ficha de proveedor de Motor2 (Recomendada)» (R-3) | chat del dueño con el orquestador (preguntas con opciones) | Marcar a una parte como proveedor crea su ficha de proveedor de Motor2; no hay un rol aparte en la Parte | **CONFIRMADA** |
| D19 | 2026-11-13 | «Solo «el teléfono cambió», sin el número (Recomendada)» (R-4) | chat del dueño con el orquestador (preguntas con opciones) | La auditoría del cambio de teléfono dice que cambió, sin el valor | **CONFIRMADA** |
| — | — | Autorización de la migración (P1 a P4) | — | Ninguna tabla se crea sin ella. **No hay autorización expresa para ninguna migración de este diseño**; las etapas P1 a P4 siguen en PROPUESTA | **PENDIENTE** |

---

## 1. Escalera de diseño (10 niveles)

**Compuerta:** los niveles 6 a 10 están escritos en papel, pero **no se migra nada** hasta que los niveles 1 a 5 estén confirmados (hoy: 1 confirmado; 2–5 con partes PROPUESTA, el % de descuento confirmado (D12) y los supuestos S1 a S9 confirmados (D13)) y el dueño dé la autorización expresa de migración.

### Nivel 1. Propósito y alcance — CONFIRMADA (D1, D2)
- **Necesidad:** una sola ficha para quien le vende o le compra al negocio, con los datos que pide la facturación y la vida diaria (documento, IVA, domicilio, contacto), igual a Pedernal. Quién la pidió: el dueño, 2026-11-12 (D1, D2).
- **Entra:** identidad de la parte (naturaleza, nombre/apellido/alias, documento, condición IVA del receptor, correo, teléfono, domicilio, nota), su estado (activa/inactiva), los vínculos Contacto y Agente de, y la búsqueda por documento y por nombre.
- **No entra** (PROPUESTA, cada uno con su motivo): facturar a la parte (no hay facturación de venta en Motor2, anexo B §3); cuenta corriente; convenios (piloto del 2026-10-26, etapa propia); unir duplicados (Pedernal tampoco lo tiene: «la fusión es futura», `clientes-y-proveedores.md` §G.1, DOC); anonimizar (ver §7, supuesto S1); importar por planilla.

### Nivel 2. Actores y contexto — PROPUESTA
- **Administrador** (rol `admin`, nivel 3): hoy administra Cliente (`clientes`) y Proveedor (`proveedores`) (V: `src/core/permisos/acciones.ts:62,215`).
- **Operario**: hoy puede dar de alta un proveedor (`proveedor_alta`, piso operario, V: `acciones.ts:235`) y asignar un cliente a una mesa (`pos_asignar_cliente`, V: `:221`).
- **Gerente**: todo lo del administrador.
- Alcance: **empresa** (la ficha es de la empresa, no de la sucursal), como Cliente y Proveedor hoy y como Pedernal (§B.2, DOC). Canal: solo el panel interno.
- Quién hace qué en la Parte: **pregunta clave 2** (§7).

### Nivel 3. Casos de uso — PROPUESTA
| CU | Comando | Etapa |
|---|---|---|
| CU1 | Alta de una parte (con aviso de posibles duplicados) | P1 |
| CU2 | Edición (con versión: no se pisa el cambio de otro) | P1 |
| CU3 | Desactivar / reactivar | P1 |
| CU4 | Buscar por documento, nombre, alias, correo o teléfono | P1 |
| CU5 | Ver y completar la ficha de un proveedor existente («pendiente de completar») | P1 |
| CU6 | Vincular / desvincular «Contacto» (con cargo opcional) | P2 |
| CU7 | Vincular / desvincular «Agente de» (persona → empresa) | P2 |
| CU8 | Cargar la ficha de un cliente (empleado, residente, empresa con descuento especial) y ligarla a su cliente | P3 (D9); el % queda en la fila Cliente (D12) |
| — | Unir duplicados | **No aplica** en este diseño (ver §3.6) |

### Nivel 4. Conceptos y ciclo de vida — PROPUESTA (salvo lo citado)
- **Parte:** una persona humana o una persona jurídica con la que **una empresa** tiene relación. Pertenece a una sola empresa (D2, igual que Pedernal).
- **Naturaleza:** `HUMANA` o `JURIDICA` (palabras del Código Civil, como Pedernal). En la pantalla: «Persona» / «Empresa».
- **Rol:** qué es la parte para el negocio. En Motor2 el rol **es tener la ficha del rol**: una Parte es proveedor si tiene su fila `Proveedor`; es cliente si tiene su ficha de cliente (P3). Diferencia con Pedernal en §6.2 (R-3).
- **Consignante:** no es un rol nuevo. Es un proveedor al que un producto marca como consignante (`Producto.proveedorConsignacionId`, V: `schema.prisma:419-420`). Se conserva tal cual (D6). Supuesto S2.
- **Vínculo:** «X es contacto de Y», «X es agente de Y». Una fila por par y por tipo; se apaga, no se borra.
- **Ciclo de vida:** `ACTIVA ↔ INACTIVA`. Nunca se borra. Inactiva = no se ofrece en operaciones **nuevas**; lo ya hecho no cambia. (Pedernal tiene además `ANONIMIZADA`: supuesto S1.)
- **Pendiente de completar:** una Parte copiada de un proveedor de hoy cuya naturaleza no se puede saber. Se ve como tal y se completa a mano; nunca se adivina.

### Nivel 5. Invariantes y políticas — ver §4 (PROPUESTA, salvo las que copian a Pedernal por D2, que heredan CONFIRMADA en su **dirección**)

### Nivel 6. Historia y persistencia — §5
### Nivel 7. Atomicidad y concurrencia — §3 (tablas «¿qué pasa si…?») y §5.4
### Nivel 8. Acceso e interfaces — §5.3 (RLS, privilegios) y pregunta clave 2
### Nivel 9. Consultas y experiencia — §3.5 (búsqueda) y §6.1 (pantalla)
### Nivel 10. Pruebas, migración y operación — §4.2 (combinaciones), §5.5 (migración de datos), §8

---

## 2. Inventario: lo que existe hoy (verificado contra el código)

### 2.1 Cliente (`prisma/schema.prisma:756-771`)
| Aspecto | Hoy (V) |
|---|---|
| Columnas | `id` (cuid), `empresaId` (default `app_empresa_actual()`), `nombre`, `descuentoPorcentaje Decimal(5,2)`, `activo`, `creadoEn` |
| Únicos | `@@unique([empresaId, nombre])` (distingue mayúsculas en la base; la app compara sin distinguirlas: `alta-cliente.ts:30`), `@@unique([empresaId, id])` |
| CHECK | Ninguno (el % 0 ≤ x < 100 solo en el código: HALL-09, R10) |
| RLS | `aislamiento_empresa`, sin `FORCE` (`20260929120000_multiempresa_rls/migration.sql`) |
| Escriben | `src/server/persistencia/clientes/clientes.ts`, casos de uso `alta-cliente.ts`, `actualizar-cliente.ts`, `actualizar-activo-cliente.ts` (alta en transacción simple, sin SERIALIZABLE, sin clave de reintento) |
| Leen | `asignar-cliente-a-cuenta.ts` (POS), reporte «Descuentos por cliente»; `clienteId` aparece en **27 archivos** de `src/` |
| Lo referencian | `Cuenta.clienteId` (`:2346`, el % se **congela** en `Cuenta.descuentoPorcentaje`), `Operacion.clienteId` (`:1116`) |
| Qué es en la práctica | Un **perfil de descuento** del salón (D8): «Residente», «Empleado», «ISSN», «EPEN». Algunos son empresas reales (ISSN, EPEN), otros son categorías de gente (Residente) |

### 2.2 Proveedor (`schema.prisma:636-671`) — incluye al consignante
| Aspecto | Hoy (V) |
|---|---|
| Columnas | `id`, `empresaId`, `codigo` (`PRV_<uuid6>`, autogenerado), `nombre`, `contacto` (texto ≤120), `telefono` (texto ≤40, sin forma), `email` (≤254, regex mínima), `cuit` (11 dígitos canónicos, validado en código: `src/core/fiscal/cuit.ts`), `condicionesPago` (≤200), `notas` (≤500), `activo`, `ofreceProductos`/`ofreceServicios` (CHECK: al menos una), `condicionIva` (3 valores **de emisor**, CHECK, **sin escritor**) |
| Únicos | `(empresaId, codigo)`, `(empresaId, nombre)` + índice `(empresaId, lower(nombre))` (`20260929100000_multiempresa_estructura:285`), `(empresaId, cuit)` (`20261008120000_cuit_unico`), `(empresaId, id)` |
| CHECK de CUIT en la base | **No hay.** La base solo impide repetirlo; que sea válido lo asegura el código. Tampoco existe una función SQL de CUIT en Motor2 (grep de `cuit_valido` en migraciones: sin resultados) |
| Escriben | `src/server/persistencia/catalogo/proveedores.ts` (crear, editar, activar), casos de uso `alta-proveedor.ts`, `actualizar-proveedor.ts`, `actualizar-activa-proveedor.ts`; los seeds de demo |
| Leen | `proveedorId`/`proveedorConsignacionId` aparecen en **70 archivos** de `src/`; hay SQL crudo con `"Proveedor"` en `src/server/lecturas/reportes/comun.ts`, `src/server/consultas/reportes/historial-producto.ts` y `scripts/medir-cuit.ts` |
| Lo referencian (FK compuestas con empresa) | `Producto.proveedorConsignacionId`, `PagoConsignante`, `ProveedorPorProducto`, `Operacion.proveedorId`, `FacturaProveedor`, `NotaCreditoProveedor` (FK de 3 columnas), `PuntoDeVentaDeProveedor` (sin uso en `src/`) |
| Auditoría | Solo `nombre`, `ofreceProductos`, `ofreceServicios`. Contacto, teléfono, correo, CUIT, condiciones y notas **no se auditan**; el alta tampoco (anexo B Z6, Z7) |

### 2.3 Consignante, contacto, agente
- **Consignante (V):** no es un modelo. `Producto.esConsignacion` + `proveedorConsignacionId` + `precioConsignacion`; pagos en `PagoConsignante` (append-only, sin anulación, `Decimal(14,4)`).
- **Contacto de proveedor (V):** `Proveedor.contacto` es un texto libre. No hay persona de contacto estructurada.
- **Agente de (V):** no existe. El piloto del 2026-10-26 lo diseñó como `Cliente.tipo` + `AgenteDeCliente` (etapa N3), **sin construir**. Este diseño lo **reemplaza** por el vínculo `AGENTE_DE` de la Parte (PROPUESTA; la regla D7 se mantiene).
- **Otras cosas con nombre parecido:** `Empresa.condicionIva` (emisor, sin escritor), `User` (quien inicia sesión, no es una parte), `Cliente.codigo` aprobado el 2026-10-05 y **sin construir** (D8).

### 2.4 Cuántas filas hay en producción — NO VERIFICADO
No se consultó producción. Consulta escrita para que la corra quien tenga la lectura autorizada (respuesta 5 del dueño, 2026-11-12: «5.-Si»), **en una transacción de solo lectura, con el rol dueño** (ve todas las empresas porque el RLS no está forzado) y **sin pegar la salida con nombres ni documentos en ningún chat**:

```sql
BEGIN READ ONLY;
-- 1. Volumen por empresa
SELECT e."slug",
       (SELECT count(*) FROM "Proveedor" p WHERE p."empresaId" = e."id")                         AS proveedores,
       (SELECT count(*) FROM "Proveedor" p WHERE p."empresaId" = e."id" AND p."cuit" IS NOT NULL) AS proveedores_con_cuit,
       (SELECT count(*) FROM "Cliente" c WHERE c."empresaId" = e."id")                            AS clientes
  FROM "Empresa" e ORDER BY 1;
-- 2. Naturaleza deducible por prefijo de CUIT (solo cuenta; la validez completa la mide `npm run medir-cuit`)
SELECT left("cuit", 2) AS prefijo, count(*) FROM "Proveedor" WHERE "cuit" ~ '^[0-9]{11}$' GROUP BY 1 ORDER BY 1;
-- 3. Datos que no pasarían las reglas de la Parte (cuentas, sin valores)
SELECT count(*) FILTER (WHERE "telefono" IS NOT NULL AND ("telefono" <> btrim("telefono") OR "telefono" !~ '^[[:print:]]+$')) AS telefonos_fuera_de_forma,
       count(*) FILTER (WHERE "email" IS NOT NULL AND ("email" <> lower(btrim("email")) OR "email" !~ '^[[:graph:]]+$'))   AS correos_a_normalizar,
       count(*) FILTER (WHERE "condicionIva" IS NOT NULL) AS con_condicion_iva,
       count(*) FILTER (WHERE "contacto" IS NOT NULL)     AS con_contacto_texto,
       count(*) FILTER (WHERE "notas" IS NOT NULL)        AS con_notas
  FROM "Proveedor";
-- 4. Proveedores que son consignantes
SELECT count(DISTINCT "proveedorConsignacionId") FROM "Producto" WHERE "proveedorConsignacionId" IS NOT NULL;
-- 5. Nombres de cliente que coinciden con un proveedor (posible misma parte) y clientes repetidos sin distinguir mayúsculas
SELECT count(*) FROM "Cliente" c JOIN "Proveedor" p ON p."empresaId" = c."empresaId" AND lower(p."nombre") = lower(c."nombre");
SELECT count(*) FROM (SELECT 1 FROM "Cliente" GROUP BY "empresaId", lower("nombre") HAVING count(*) > 1) d;
ROLLBACK;
```
Además, `npm run medir-cuit` (ya existe, `scripts/medir-cuit.ts`, solo lectura) dice cuántos CUIT de proveedor son canónicos, cuáles no normalizan y cuáles fallan el verificador.

### 2.5 Cómo conviven lo viejo y lo nuevo durante la transición (PROPUESTA)
- **Una sola fuente por dato en cada momento.** Mientras un proveedor no tenga Parte, sus datos se leen de `Proveedor` como hoy. Desde que la tiene (la etapa P1 se la da a todos en la misma migración), **la identidad se lee y se escribe en la Parte**; las columnas viejas de `Proveedor` (`nombre`, `cuit`, `telefono`, `email`, `notas`, `condicionIva`) dejan de escribirse salvo `nombre`, que se **copia** en la misma transacción mientras haya lecturas de reportes que lo usan (se retira en P4).
- **Nada cambia para la compra, la consignación ni los reportes:** siguen apuntando a `Proveedor.id`. La Parte se suma **al lado**, con `Proveedor.parteId`.
- **Cliente no se toca en P1.** Los perfiles de descuento siguen funcionando igual (Cuenta, % congelado). En P3 (D9) cada cliente pasa a tener su ficha; el % queda en la fila Cliente (D12).
- **Unicidad del nombre:** hoy el nombre de proveedor es único; en Pedernal el nombre de la parte **no** es único. Mientras `Proveedor.nombre` exista, su único sigue vigente (pregunta clave 3).

---

## 3. Comandos: tabla «¿qué pasa si…?»

Convenciones comunes (PROPUESTA): transacción **SERIALIZABLE con reintento** (el mecanismo de Motor2, INV-173); errores de unicidad (`P2002`/23505) **capturados y traducidos**, nunca un 500; auditoría en la **misma** transacción; permiso evaluado en cada pedido.

### 3.1 Alta de parte (CU1)
Entrada: `claveIdempotencia` (UUID que la pantalla genera al abrir el formulario y repite en cada reintento), naturaleza, nombre, apellido?, alias?, documento?, condición IVA?, correo?, teléfono?, domicilio?, nota?. Salida: `{ parteId, yaExistia, posiblesDuplicados }` (como Pedernal, V: `src/modulos/clientes/casos-de-uso/partes.ts`).

| Situación | Qué pasa |
|---|---|
| Repetición (doble clic, mismo pedido) | Misma clave y mismo contenido (`payloadHash`) → devuelve la parte ya creada con `yaExistia: true`; no crea otra ni audita de nuevo |
| Misma clave, datos distintos | Rechazo `CLAVE_REUTILIZADA` (convención de Motor2 para `PagoConsignante`; Pedernal no compara el contenido: diferencia menor, R-5) |
| Concurrencia: dos altas del mismo documento a la vez | El único `(empresaId, documentoNormalizado)` deja entrar **una**; la otra recibe `DOCUMENTO_YA_REGISTRADO { parteId }` con el id de la ganadora. Si la ganadora está inactiva: `PARTE_INACTIVA_CON_ESE_DOCUMENTO { parteId }` (se reactiva, no se duplica) |
| Concurrencia: mismo nombre, correo o teléfono | Entran las dos; cada una informa a la otra como **posible duplicado** (aviso, no bloqueo; igual que Pedernal F3, DOC). Excepción mientras exista el único de `Proveedor.nombre`: ver pregunta clave 3 |
| CUIT, CUIL o CDI del mismo número | Es la **misma clave** (`T` + número): el segundo choca, aunque sea otro tipo |
| Tiempo | Sin reloj de negocio: no hay vigencias. `creadoEn` lo pone la base |
| Incertidumbre (se cortó la red, no sé si se creó) | Reintentar con la misma clave: devuelve el resultado original |
| Reintento por conflicto de serialización (40001) | El adaptador reintenta; el resultado final es el mismo que sin conflicto |
| Error parcial | Parte + auditoría en una transacción: todo o nada |
| Datos faltantes | Solo naturaleza y nombre son obligatorios (como Pedernal). Lo demás vacío = «pendiente de completar», nunca un valor inventado |
| Datos inválidos | Se devuelven **todos** los errores por campo (no solo el primero). La base repite las reglas con CHECK |
| Cambio de permisos | Se evalúa en cada pedido; perder el permiso a mitad de camino → rechazo, nada escrito |

### 3.2 Edición (CU2)
Entrada: `parteId`, `versionEsperada`, cambios parciales.

| Situación | Qué pasa |
|---|---|
| Repetición | Mismos datos que los guardados → éxito sin escribir ni auditar |
| Concurrencia (dos personas editan) | `UPDATE … WHERE id AND empresaId AND version = versionEsperada`; el segundo recibe `VERSION_DESACTUALIZADA` y recarga |
| Cambio de documento a uno ya usado | `DOCUMENTO_YA_REGISTRADO` (traducido de la restricción) |
| Cambio de naturaleza con vínculos que la exigen | Rechazo (la base lo impide, §4.1 I8) |
| Persona → empresa con DNI cargado | Rechazo: una empresa solo admite CUIT o ID extranjero (I4) |
| Tiempo / incertidumbre / reintento | Reintento con la misma versión: si ya se aplicó, la versión cambió y vuelve `VERSION_DESACTUALIZADA` con los datos actuales a la vista (no se aplica dos veces) |
| Error parcial | Edición + auditoría juntas |
| Datos faltantes | Vaciar un campo opcional = `NULL`; vaciar el nombre se rechaza |
| Cambio de permisos | Igual que el alta |
| Proveedor ligado | Desde P1 la pantalla de proveedor edita la identidad en la Parte; `Proveedor.nombre` se copia en la misma transacción (§2.5) |

### 3.3 Desactivar / reactivar (CU3)
| Situación | Qué pasa |
|---|---|
| Repetición | Ya inactiva → `yaEstabaInactiva: true`, sin escribir ni auditar (y al revés) |
| Concurrencia | Dos desactivaciones: `UPDATE … WHERE estado = 'ACTIVA'`, una sola escribe. Desactivar contra editar: la versión ordena |
| Efecto | No toca vínculos, roles ni operaciones existentes; solo impide usarla en operaciones **nuevas** (como hoy `Proveedor.activo`: un proveedor inactivo no recibe pago de consignación, V: `pago-consignante.ts:16`) |
| Relación con `Proveedor.activo` | Son cosas distintas: la Parte inactiva apaga todo; `Proveedor.activo` apaga solo el rol proveedor. Un proveedor activo de una Parte inactiva **no se ofrece** (gana lo cerrado) |
| Tiempo / incertidumbre / reintento / error parcial | Idempotente por estado; una transacción |
| Datos faltantes | Sin motivo obligatorio (Pedernal lo deja opcional) |
| Cambio de permisos | Pedernal: solo administrador y gerente (V: `capacidades/permisos/empresa.ts:209`). Ver pregunta clave 2 |

### 3.4 Vincular / desvincular «Contacto» y «Agente de» (CU6, CU7)
| Situación | Qué pasa |
|---|---|
| Repetición | El par y el tipo ya vinculados y activos → `yaExistia: true`. Desvincular lo ya desvinculado → `yaNoEstaba: true` |
| Concurrencia (dos vínculos iguales a la vez) | Clave primaria `(empresaId, parteId, deParteId, tipo)`: uno entra, el otro se traduce a `yaExistia` |
| Volver a vincular | Se reactiva la misma fila (no se crea otra); el cargo se puede actualizar |
| Contacto que no es persona | Rechazo `CONTACTO_DEBE_SER_PERSONA` (la base lo impide) |
| «Agente de» hacia una persona | Rechazo `VINCULO_DEBE_SER_CON_EMPRESA` |
| Una parte consigo misma | Rechazo `VINCULO_CONSIGO_MISMA` (CHECK) |
| Persona agente de dos empresas | Permitido (D7) |
| Parte «pendiente de completar» (sin naturaleza) | Rechazo hasta que se complete: falla cerrado |
| Parte inactiva | Se puede ver el vínculo; no se crea uno nuevo con una parte inactiva (PROPUESTA; Pedernal solo lo impide con anonimizadas: diferencia menor) |
| Error parcial / reintento | Una transacción; idempotente por clave natural |
| Cambio de permisos | Pedernal: operario, administrador y gerente (V: `empresa.ts:207-208`). Ver pregunta clave 2 |

### 3.5 Buscar por documento (CU4)
| Situación | Qué pasa |
|---|---|
| Texto con dígitos, puntos o guiones | Busca por documento normalizado y por dígitos de teléfono |
| Con `@` | Por correo (prefijo) |
| Otro texto | Por nombre, apellido o alias, sin acentos ni mayúsculas |
| Orden | Documento idéntico primero; después los que empiezan con el texto; después los que lo contienen; dentro de cada grupo por nombre e id (estable). Paginado por cursor, hasta 50 (igual que Pedernal §B.5, DOC) |
| Inactivas | Solo si se pide |
| Concurrencia / repetición | Lectura `read committed`; no escribe |
| Permisos | Ver la ficha exige permiso (pregunta clave 2). Los datos personales no salen en listados para selectores de otros módulos más allá de nombre y documento (PROPUESTA) |
| Datos faltantes | Una parte sin documento aparece por nombre, marcada «pendiente de completar» |

### 3.6 Unir duplicados — no aplica
Pedernal no lo tiene («un duplicado se desactiva (la fusión es futura)», `clientes-y-proveedores.md` §G.1, DOC). Unir dos partes obliga a mover referencias de compras, consignación y reportes: es caro y nadie lo pidió. En su lugar: el aviso de posible duplicado al dar de alta y la desactivación del sobrante. Queda como etapa futura con nombre, **sin diseño**.

### 3.7 Darle Parte a un proveedor existente (migración de P1, no es un botón)
| Situación | Qué pasa |
|---|---|
| Repetición | La migración solo crea Parte para proveedores con `parteId` nulo: correrla dos veces no duplica |
| Concurrencia | Corre en la migración, con la app detenida para escritura del catálogo o, si no se puede, con `LOCK TABLE "Proveedor" IN SHARE ROW EXCLUSIVE MODE` durante la copia (NO VERIFICADO cuánto tarda: depende del volumen de §2.4) |
| Datos faltantes o inválidos | §5.5: nunca se inventa; lo que no pasa queda vacío en la Parte y el dato viejo sigue visible en el proveedor como «pendiente de completar» |
| Error parcial | Toda la copia en una transacción; si una fila viola un CHECK, se detiene la migración con el detalle (precedente: `20261008120000_cuit_unico`) |

---

## 4. Invariantes, combinaciones y poda

### 4.1 Invariantes (dónde se sostienen)
| Id | Invariante | Capa | Origen | Estado |
|---|---|---|---|---|
| I1 | Un documento, una parte, por empresa, **incluso entre inactivas** (se reactiva, no se duplica) | BD: único parcial `(empresaId, documentoNormalizado) WHERE documentoNormalizado IS NOT NULL` | Pedernal `parte_documento_uk` (V) | Dirección CONFIRMADA (D2) |
| I2 | CUIT, CUIL y CDI del mismo número son la misma clave | BD: `documentoNormalizado` = `'T' || número` para los tres | Pedernal (V) | Dirección CONFIRMADA (D2) |
| I3 | **CHECK de documento por tipo, dentro de la Parte**: CUIT/CUIL/CDI con módulo 11 y prefijo ARCA; DNI `^[1-9][0-9]{5,8}$`; pasaporte `^[A-Z0-9]{6,9}$` con país; ID extranjero `^[A-Z0-9]{3,20}$` con país; o los tres vacíos. **Esto reemplaza la nota «sin CHECK de CUIT» de la auditoría** (paso 10 y X4): el CHECK del CUIT no se agrega a `Proveedor.cuit`, va en la Parte, que pasa a ser donde vive el CUIT | BD (CHECK `Parte_documento_chk`) + código (`validarCuit` existente) | Pedernal `parte_documento_ck` (V) | Dirección CONFIRMADA (D2); requiere una función SQL nueva `cuit_valido(text)` (§5.2) |
| I4 | Una empresa (`JURIDICA`) solo admite CUIT o ID extranjero | BD CHECK | Pedernal `parte_naturaleza_documento_ck` (V) | Dirección CONFIRMADA |
| I5 | Apellido solo en una persona | BD CHECK | Pedernal `parte_apellido_ck` (V) | Dirección CONFIRMADA |
| I6 | Domicilio: o nada, o argentino estructurado (calle, número o `S/N`, localidad y provincia obligatorias; piso, depto y CP opcionales), o del exterior en **una línea** (≤300) con país, **nunca las dos cosas** | BD CHECK | Pedernal `parte_domicilio_ck` (V) | Dirección CONFIRMADA |
| I7 | Nota ≤ 2.000 caracteres, no vacía si existe | BD CHECK + código | Pedernal `parte_nota_ck` (V); dueño (D2) | CONFIRMADA |
| I8 | «Agente de»: persona → empresa; «Contacto»: la punta contacto es persona; ninguna parte vinculada consigo misma; cambiar la naturaleza de una parte vinculada se rechaza | BD (FK con discriminador, §5.2) | Pedernal: disparadores `parte_vinculo_validar` y `parte_validar_cambio` (V) | Dirección CONFIRMADA; **mecanismo** PROPUESTA (otro que Pedernal, mismo resultado) |
| I9 | Un solo vínculo por par y tipo (se reactiva) | BD clave primaria | Pedernal (V); D7 | CONFIRMADA |
| I10 | Condición IVA de la parte ∈ 11 valores del receptor (WSFE v4.8); es solo un **valor sugerido**, no fija lo que vale en un comprobante | BD CHECK | Pedernal (V); D3 | CONFIRMADA |
| I11 | Correo: minúsculas, sin blancos en los extremos, sin espacios internos, `algo@algo`, ≤254 | BD CHECK + código | Pedernal `parte_email_ck` (V) | Dirección CONFIRMADA |
| I12 | Teléfono: una línea, 1–40 caracteres imprimibles, sin blancos en los extremos. **Ojo: Pedernal no exige dígitos ni forma** (V: `primitivas/contacto/telefono.ts`; su documento decía 6–15 dígitos y es falso, anexo G fila 1) | BD CHECK + código | Pedernal (V) | Dirección CONFIRMADA (copiar el código, no el documento) |
| I13 | Nombre: lista de permitidos de Motor2 (`RE_TEXTO_CATALOGO`, sin `¿ ¡ ? ! $`) hasta 200 caracteres; alias y apellido ≤100 | BD CHECK + código | D4 para el conjunto; Pedernal para los largos | Conjunto CONFIRMADO (D4); largo PROPUESTA |
| I14 | La identidad de la parte no cambia (id, empresa, clave de alta, autor, fecha de alta) | BD (privilegios por columna + disparador como Pedernal) | Pedernal `parte_identidad_inmutable` (V) | PROPUESTA |
| I15 | Nada se borra: sin DELETE ni TRUNCATE para la app | BD (privilegios) | Motor2 y Pedernal | CONFIRMADA (regla del proyecto) |
| I16 | Alta idempotente por clave **única por empresa** | BD único `(empresaId, claveIdempotencia)` | Pedernal (V); auditoría §9.1 resolvió «igualar» | Dirección CONFIRMADA (D5) |
| I17 | Todo vive en la empresa: FK compuestas `(empresaId, id)` y RLS | BD | Motor2 y Pedernal | CONFIRMADA |
| I18 | Un proveedor tiene a lo sumo una Parte y una Parte a lo sumo un proveedor | BD único `(empresaId, parteId)` en `Proveedor` | PROPUESTA | PROPUESTA |
| I19 | Parte sin naturaleza solo si vino de la migración («pendiente de completar»); una alta nueva siempre la trae | BD CHECK `naturaleza IS NOT NULL OR migradaDe IS NOT NULL` | **Diferencia con Pedernal** (R-1) | PROPUESTA |
| I20 | La auditoría de los datos personales guarda **qué campo cambió, nunca el valor** (y la descripción no lleva el nombre de la persona) | Código | Pedernal F2 (V: `partes.ts:204,259`) | Dirección CONFIRMADA (D2); hoy Motor2 guarda valores (R-4) |
| I21 | Un cliente por ficha | BD: único parcial `(empresaId, parteId) WHERE parteId IS NOT NULL` en `Cliente` (P3) | D14 | Dirección CONFIRMADA (D14); mecanismo PROPUESTA |

### 4.2 Combinaciones que cambian dinero, permisos o visibilidad (regla del 2026-10-28)

**Dimensiones declaradas:** naturaleza (HUMANA, JURIDICA, sin declarar), tipo de documento (7 contando «ninguno»), tipo de vínculo (2), estado de la parte (2), activo del rol proveedor (2), permiso del usuario (por acción), domicilio (ninguno, AR, exterior). **Dinero:** en P1 ninguna de estas dimensiones cambia un importe (la condición IVA es solo sugerida y no hay facturación de venta); el % de descuento sigue en el perfil Cliente, fuera de la Parte. **Afecta visibilidad:** estado, activo del rol. **Afecta permisos:** acción × rol (pregunta clave 2).

Oráculo (tabla escrita aparte del código; un test la recorre **completa**, porque son pocas):

**A. Naturaleza × documento** (✔ se acepta, ✘ se rechaza)
| | ninguno | CUIT | CUIL | CDI | DNI | Pasaporte | ID extranjero |
|---|---|---|---|---|---|---|---|
| HUMANA | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| JURIDICA | ✔ | ✔ | ✘ | ✘ | ✘ | ✘ | ✔ |
| sin declarar (solo migradas) | ✔ | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ |

(La fila «sin declarar» es PROPUESTA: la migración solo deja sin naturaleza a proveedores **sin** CUIT válido, así que en la práctica solo aparece «ninguno»; el ✔ con CUIT es para no frenar una corrección manual del CUIT antes de completar la naturaleza. Diferencia R-1.)

**B. Vínculo × naturaleza de cada punta**
| Tipo | contacto/agente | de quién | Resultado |
|---|---|---|---|
| CONTACTO | HUMANA | HUMANA o JURIDICA | ✔ |
| CONTACTO | JURIDICA o sin declarar | cualquiera | ✘ |
| AGENTE_DE | HUMANA | JURIDICA | ✔ |
| AGENTE_DE | HUMANA | HUMANA o sin declarar | ✘ |
| AGENTE_DE | JURIDICA o sin declarar | cualquiera | ✘ |
| cualquiera | misma parte en las dos puntas | — | ✘ |

**C. Estado × rol × uso en una operación nueva** (compra, pago de consignación, asignar a cuenta)
| Parte | Rol (fila `Proveedor.activo`) | ¿Se ofrece? |
|---|---|---|
| ACTIVA | activo | ✔ |
| ACTIVA | inactivo | ✘ |
| INACTIVA | activo | ✘ (gana lo cerrado) |
| INACTIVA | inactivo | ✘ |
| sin Parte (antes de P1) | activo | ✔ (comportamiento de hoy) |

**D. Domicilio**: ninguno ✔; AR completo ✔; AR sin provincia o sin localidad ✘; AR con línea de exterior ✘; exterior con país `AR` ✘; exterior con alguna columna estructurada ✘; exterior >300 ✘.

**E. Documento equivalente**: CUIT 20-12345678-? y CUIL del mismo número en la misma empresa → choca; en otra empresa → ✔ (sin oráculo de existencia entre empresas).

**Guardián de dimensiones** (PROPUESTA, en `test/`): falla si aparece una columna nueva en `Parte` o `ParteVinculo`, o un valor nuevo en un CHECK de naturaleza, documento, condición IVA o tipo de vínculo, sin declarar en el oráculo si afecta o no. Mismo patrón que el mapa de cobertura (`docs/mapa-cobertura-de-combinaciones-2026-10-28.md`). Sin librerías nuevas.

### 4.3 Poda: qué necesidad resuelve cada campo
| Campo | Necesidad | Cita | Entra |
|---|---|---|---|
| naturaleza, nombre, apellido, alias, documento, condición IVA, correo, teléfono, domicilio, nota, vínculos | La ficha que pidió el dueño | D1, D2 (2026-11-12); «Agente de» también D7 | Sí |
| estado ACTIVA/INACTIVA | «Nada se borra, se desactiva» (regla vigente de Motor2) | AGENTS.md / ADR del proyecto | Sí |
| `claveIdempotencia`, `version`, `creadoEn`, `actualizadoEn`, `creadoPorId`, columnas de búsqueda | Técnicas (I8 de AGENTS.md: autonomía en lo técnico) | — | Sí |
| `migradaDe` | Técnica para no inventar la naturaleza de lo migrado | — | Sí, como punto de extensión que se retira cuando no queden pendientes |
| estado `ANONIMIZADA`, `anonimizadaEn` | Pedernal lo tiene en la base **sin caso de uso** (V: `0034_clientes.sql:6` «el estado ANONIMIZADA con su disparador pero sin caso de uso») | Nadie lo pidió en Motor2 | **No** (supuesto S1). Es una columna que nadie escribiría |
| `es_atajo` (alta rápida) | Pedernal (dos ejes, 2026-10-23, DOC) | No pedido en Motor2 | **No** (supuesto S3) |
| `Proveedor.codigo`, `condicionesPago`, `ofreceProductos/Servicios` | Datos del rol proveedor, vigentes | Decisiones de 2026-10-06 (ofrece) y migración de catálogo | Se quedan en `Proveedor` |
| `Proveedor.contacto` (texto) | Reemplazable por el vínculo Contacto | — | Se conserva hasta P4; candidato a poda con aviso |
| `Proveedor.telefono/email/cuit/notas/condicionIva` | Duplican la Parte | — | Dejan de escribirse en P1; se retiran en P4 con aviso |
| `PuntoDeVentaDeProveedor` | Sin escritor (anexo B) | — | No se toca (es la poda general, otra etapa) |

---

## 5. Modelo completo en papel y etapas

### 5.1 Modelo completo (todas las etapas)

Convenciones de Motor2 (V): id `cuid` en texto; `empresaId` con default `app_empresa_actual()`; FK compuestas `(empresaId, x)`; categóricas como TEXT + CHECK (Prisma no modela los CHECK: van en el SQL de la migración, como el resto); RLS `aislamiento_empresa`.

**`Parte`** (P1)
| Columna | Tipo | Regla |
|---|---|---|
| `id` | text (cuid) | PK |
| `empresaId` | text | FK `Empresa`; default contexto |
| `claveIdempotencia` | uuid NOT NULL | único `(empresaId, claveIdempotencia)` |
| `payloadHash` | text NOT NULL | — |
| `naturaleza` | text NULL | CHECK `IN ('HUMANA','JURIDICA')`; NULL solo con `migradaDe` (I19) |
| `migradaDe` | text NULL | CHECK `IN ('PROVEEDOR')` (ampliable a `'CLIENTE'` en P3); inmutable |
| `nombre` | text NOT NULL | CHECK largo 1–200 y conjunto `RE_TEXTO_CATALOGO` (I13) |
| `apellido`, `alias` | text NULL | ≤100; apellido solo HUMANA (I5) |
| `documentoTipo` | text NULL | CHECK 6 tipos |
| `documentoPais` | char(2) NULL | `^[A-Z]{2}$`; solo pasaporte e ID extranjero |
| `documentoNumero` | text NULL | CHECK por tipo (I3) |
| `documentoNormalizado` | text | `T…`/`D…`/`P{país}:…`/`I{país}:…`; ver nota de columnas calculadas |
| `condicionIva` | text NULL | CHECK 11 valores (I10) |
| `email` | text NULL | I11 |
| `telefono` | text NULL | I12 |
| `domPais`, `domCalle`, `domNumero`, `domPiso`, `domDepartamento`, `domLocalidad`, `domProvincia`, `domCodigoPostal`, `domTexto` | text NULL | I6; `domProvincia` CHECK `IN` los 24 códigos ISO 3166-2:AR (`AR-B` … ) |
| `nota` | text NULL | I7; conjunto de permitidos multilínea (el validador de textos de PR #239) — **más cerrado que Pedernal** (R-2) |
| `estado` | text NOT NULL DEFAULT `'ACTIVA'` | CHECK `IN ('ACTIVA','INACTIVA')` |
| `nombreBusqueda`, `telefonoDigitos` | text | calculadas (ver nota) |
| `creadoPorId` | text | FK `User`; inmutable |
| `creadoEn`, `actualizadoEn` | timestamptz | — |
| `version` | int NOT NULL DEFAULT 1 | control optimista |
| Únicos | | `(empresaId, id)`; `(empresaId, id, naturaleza)` (destino de las FK con discriminador); I1 parcial; I16 |
| Índices | | búsqueda por `(empresaId, nombreBusqueda text_pattern_ops, id)`, por correo, por dígitos de teléfono, «sin documento» |

*Nota sobre columnas calculadas:* Pedernal usa `GENERATED ALWAYS AS … STORED` (V). Motor2 **no tiene ninguna** columna generada hoy (grep en migraciones: sin resultados) y **NO VERIFIQUÉ** cómo la trata la versión de Prisma del proyecto. Alternativa si no funciona: el código las calcula con **la misma** función que la base y un CHECK `documentoNormalizado = <expresión>` impide que el código las falsee (mismo resultado, I2).

**`ParteVinculo`** (P2)
| Columna | Regla |
|---|---|
| `empresaId`, `parteId`, `deParteId`, `tipo` | PK de las cuatro; CHECK `tipo IN ('CONTACTO','AGENTE_DE')`; CHECK `parteId <> deParteId` |
| `naturalezaParte` | text NOT NULL DEFAULT `'HUMANA'`, CHECK `= 'HUMANA'`; FK `(empresaId, parteId, naturalezaParte) → Parte(empresaId, id, naturaleza)` **ON UPDATE RESTRICT** |
| `naturalezaDeParte` | text NULL; CHECK `(tipo = 'AGENTE_DE') = (naturalezaDeParte IS NOT DISTINCT FROM 'JURIDICA')`; FK `(empresaId, deParteId, naturalezaDeParte) → Parte(empresaId, id, naturaleza)` ON UPDATE RESTRICT (con NULL no se evalúa: CONTACTO) |
| FK simple | `(empresaId, deParteId) → Parte(empresaId, id)` |
| `cargo` | text NULL, ≤100, lista de permitidos |
| `activo`, `creadoEn`, `actualizadoEn`, `version`, `creadoPorId` | — |

Esto es la «FK con discriminador» que Motor2 ya usa (ADR-029 §10–11, citado en el piloto del 2026-10-26): la base impone I8 **sin disparadores**, y cambiar la naturaleza de una parte vinculada falla por la FK. Pedernal llega al mismo resultado con disparadores.

**`Proveedor`** (P1, columnas nuevas): `parteId text NULL` + FK `(empresaId, parteId) → Parte(empresaId, id)` + único `(empresaId, parteId)` (I18). En P4 pasa a NOT NULL.

**`Cliente`** (P3, D9): `parteId text NULL` con FK compuesta; los clientes de hoy quedan «pendiente de completar» (NULL) hasta cargarles la ficha y todo cliente nuevo se carga con su ficha. Con único `(empresaId, parteId)` (un cliente por ficha, D14; el índice es único **parcial**, para que los clientes sin ficha —NULL— no choquen entre sí).

**Función SQL** (P1): `cuit_valido(text) RETURNS boolean IMMUTABLE`, `search_path` fijo, sin `SECURITY DEFINER`, con el mismo algoritmo que `esCuitValido` (`src/core/fiscal/cuit.ts`) y un test de paridad que compara las dos con miles de casos (como Pedernal).

**RLS y privilegios** (P1/P2): `ENABLE ROW LEVEL SECURITY` + política `aislamiento_empresa` como el resto. `FORCE ROW LEVEL SECURITY` como Pedernal: **PROPUESTA con reserva**, porque Motor2 tiene 0 tablas con `FORCE` y scripts como `medir-cuit.ts` leen con el rol dueño confiando en que el RLS no está forzado (V: su encabezado). Si se fuerza, esos scripts necesitan otro camino. `motor2_app`: SELECT; INSERT y UPDATE **por columna** (sin `id`, `empresaId`, `claveIdempotencia`, `creadoPorId`, `creadoEn`, `migradaDe`); sin DELETE ni TRUNCATE (precedente V: `20261104110000_pago_de_factura_proveedor`).

**Clasificación de tablas**: `Parte` y `ParteVinculo` entran como `DE_EMPRESA` en `test/setup/clasificacion-de-tablas.ts` (donde ya están `Cliente` y `Proveedor`).

### 5.2 Etapas (solo se migra la etapa que se implementa; cada una aditiva y con `down.sql`)

| Etapa | Qué se migra | Escritor que entra en el mismo PR (nada de tablas a ciegas) | `down.sql` | Reversible sin pérdida |
|---|---|---|---|---|
| **P1 «Ficha del proveedor»** (la más barata que se puede usar) | `cuit_valido()`; tabla `Parte` con RLS y privilegios; `Proveedor.parteId` + FK + único; copia de cada proveedor a su Parte (§5.5) | Casos de uso alta/edición/desactivar/buscar Parte; la pantalla de proveedor muestra y edita la ficha | Quita la FK, la columna `parteId`, la tabla y la función. **Se niega** (`RAISE`) si hay partes **no** migradas (`migradaDe IS NULL`) o ediciones posteriores, salvo confirmación explícita con `SET LOCAL`, como la reversión de Pedernal | Sí mientras nadie haya cargado datos nuevos; después, pierde lo cargado (se avisa) |
| **P2 «Vínculos»** | `ParteVinculo` | Vincular/desvincular Contacto y Agente de desde la ficha | Quita la tabla (mismo resguardo) | Igual |
| **P3 «Fichas de cliente»** (D9, opción B) | `Cliente.parteId` | Cargar la ficha de cada cliente y ligarla; el mostrador elige a la persona o empresa | Quita la columna | Sí |
| **P4 «Retiro de lo viejo»** (destructiva, **con aviso previo y datos a la vista**) | `Proveedor.parteId` NOT NULL; borrar `Proveedor.telefono/email/cuit/notas/condicionIva` (y `contacto` si el dueño lo aprueba); migrar lecturas de reportes a `Parte.nombre` | Lecturas | Recrea las columnas y las rellena desde la Parte | Sí en estructura; el dato vuelve desde la Parte |

Orden de despliegue (como el precedente `solo_salon`): la migración va **antes** que el código; el código nuevo tolera que `parteId` sea nulo hasta que la copia termine.

### 5.3 Puntos de extensión previstos
- `migradaDe` admite `'CLIENTE'` en P3 si corresponde (ampliar el CHECK).
- Estado: agregar `ANONIMIZADA` es ampliar un CHECK y sumar las columnas de Pedernal, sin tocar filas.
- Tipos de vínculo: ampliar el CHECK.
- Roles nuevos (empleado, huésped): una ficha de rol que apunta a `Parte`, igual que `Proveedor`.
- Facturación de venta: la instantánea del receptor vive en el comprobante, copiada de la Parte.

### 5.4 Atomicidad y concurrencia (nivel 7)
- Cada comando es **una** transacción SERIALIZABLE con reintento; la validación de duplicados va **dentro** de la transacción (Pedernal señaló este hueco en Motor2: H-C1, DOC; y R2 de la auditoría lo confirma en Cliente, V).
- Alta: `INSERT … ON CONFLICT DO NOTHING`, luego lectura por clave de alta (¿éxito previo?) o por documento (¿choque?), como Pedernal (V: `persistencia/repositorios-de-partes.ts:74`). En Prisma: `createMany({ skipDuplicates: true })` o SQL crudo dentro de la transacción (NO VERIFICADO cuál conviene; decide quien implemente, con prueba).
- Edición: control optimista por `version`.

### 5.5 Plan de migración de datos reales (P1)
1. **Antes, en solo lectura:** correr §2.4 y `npm run medir-cuit` contra producción (autorizado: respuesta 5). Con los números, el dueño ve cuántos proveedores quedarán «pendientes de completar».
2. **Ensayo:** copiar la base a una local descartable, aplicar P1, subir–bajar–subir, comparar conteos (proveedores = partes migradas).
3. **Regla de copia** (nunca se inventa):
   | Dato de `Proveedor` | Va a la Parte | Si no pasa la regla de la Parte |
   |---|---|---|
   | `nombre` | `nombre` (ya cumple la lista de permitidos y ≤80) | No puede pasar: la migración se detiene con el detalle |
   | `cuit` canónico y válido | `documentoTipo = 'CUIT'`, número | — |
   | `cuit` inválido o que no normaliza | queda vacío en la Parte | el dato viejo sigue en `Proveedor.cuit`, la pantalla lo muestra como «CUIT anterior, pendiente de corregir» |
   | prefijo del CUIT válido 20/23/24/27 | `naturaleza = 'HUMANA'` | — |
   | prefijo 30/33/34 | `naturaleza = 'JURIDICA'` | — |
   | sin CUIT válido | `naturaleza = NULL`, `migradaDe = 'PROVEEDOR'` | «pendiente de completar» |
   | `email` | `lower(btrim(email))` si queda con la forma de I11 | vacío en la Parte; el viejo sigue visible |
   | `telefono` | `btrim(telefono)` si cumple I12 | ídem |
   | `notas` (≤500) | `nota` (≤2000) si cumple el conjunto de permitidos | ídem |
   | `condicionIva` (3 valores de emisor) | mismos códigos (los tres existen entre los 11) | — |
   | `contacto` (texto) | **no se copia** (no se sabe si es una persona) | queda en `Proveedor.contacto` |
   | `activo` | `Parte.estado = 'ACTIVA'` siempre; el `activo` sigue siendo del rol | — |
   | — | `claveIdempotencia` = UUID nuevo; `creadoPorId` NULL (la migración no es un usuario) | — |

   Que el prefijo del CUIT diga persona o empresa es la regla que ya usa Motor2 (`cuit.ts:5`, «personas (20/23/24/27) y empresas (30/33/34)»): se deduce, no se inventa. **NO VERIFICADO contra una fuente oficial de ARCA**; si el dueño prefiere no deducir, todas quedan «pendientes de completar».
4. **Duplicados posibles:** dos proveedores con el mismo CUIT no pueden existir (único vigente desde 2026-10-08, V). Mismo nombre tampoco (único `lower(nombre)`, V). Por eso P1 no puede generar choques de documento. Los cruces Cliente–Proveedor (§2.4 consulta 5) **no se resuelven en P1**: se listan para P3.
5. **Verificación posterior:** conteo de proveedores sin `parteId` = 0; conteo de partes migradas por naturaleza; ninguna diferencia de nombre entre `Proveedor.nombre` y `Parte.nombre`.

---

## 6. Qué cambia y dónde, y en qué Motor2 daría otro resultado que Pedernal

### 6.1 Clasificación (BD / pantalla / código)
| Cambio | Tipo | Etapa | Toca `prisma/` |
|---|---|---|---|
| Tabla `Parte`, función `cuit_valido`, `Proveedor.parteId`, copia de datos | BD | P1 | **Sí** |
| Validación de la ficha (un validador por campo, todos los errores juntos) | Código | P1 | No |
| Casos de uso alta/edición/desactivar/buscar con idempotencia y versión | Código | P1 | No |
| Auditoría sin valores para datos personales | Código | P1 | No |
| Ficha en la pantalla de proveedor, con «pendiente de completar» y aviso de duplicados; captura a 375 px **con datos reales** (regla de maquetas) | Pantalla | P1 | No |
| `ParteVinculo` | BD | P2 | **Sí** |
| Vincular contacto / agente | Código + pantalla | P2 | No |
| `Cliente.parteId` | BD | P3 | **Sí** |
| Retiro de columnas viejas | BD destructiva + código | P4 | **Sí** |
| Claves de permiso nuevas (si la pregunta clave 2 lo pide) | Código (catálogo de acciones) + datos de la matriz | P1 | Posible (semilla de la matriz) |

### 6.2 Reglas que dan resultados distintos entre Motor2 y Pedernal (⚠ decididas por el dueño: R-1 D16, R-2 D17, R-3 D18, R-4 D19, R-5 D4)
| Id | Entrada | Motor2 con este diseño | Pedernal (V) | Por qué |
|---|---|---|---|---|
| ⚠ **R-1** | Proveedor de hoy sin CUIT | Parte con naturaleza **vacía**, «pendiente de completar» | Imposible: `naturaleza NOT NULL` | No inventar datos al migrar; Pedernal no migró nada |
| ⚠ **R-2** | Nota con un carácter invisible (U+202E) o `<b>` | **Rechaza** (lista de permitidos) | Acepta (solo largo y no vacía) | Regla «todo nace cerrado» de Motor2 |
| ⚠ **R-3** | Marcar a una parte como proveedor | Se crea su ficha de proveedor (con código, condiciones, qué ofrece) | Se tilda el rol `PROVEEDOR` en `parte_rol` | Motor2 ya tiene datos propios del rol en `Proveedor`; un `parte_rol` aparte sería dos verdades para «está activo como proveedor» |
| ⚠ **R-4** | Cambiar el teléfono de un proveedor | Auditoría «teléfono cambió», **sin** el valor | Igual | Hoy Motor2 **no audita** ese cambio (Z6); y donde audita, guarda valores. Cambia lo que se ve en el historial |
| ⚠ **R-5** | Nombre `¿Querés?` / `Panadería!` | Rechaza (D4) | Acepta (`texto_de_catalogo_valido` redefinida en 0043, anexo G §2.3) | Decisión del dueño (D4) |
| R-6 | Dos proveedores «Ana SA» y «ana sa» | Rechaza el segundo mientras exista el único de `Proveedor.nombre` | Acepta (solo el documento es único) | Pregunta clave 3 |
| R-7 | Reintento con la misma clave y otros datos | `CLAVE_REUTILIZADA` | Devuelve la parte creada | Convención de idempotencia de Motor2 (`payloadHash`); diferencia menor |
| R-8 | Contacto nuevo con una parte inactiva | Rechaza | Acepta (solo rechaza anonimizadas) | «Todo nace cerrado»; diferencia menor |
| R-9 | Nombre de 150 caracteres | Acepta en la Parte; hoy el proveedor tope 80 | Acepta (≤200) | Se iguala a Pedernal en la Parte; `Proveedor.nombre` (≤80) se copia… **choque**: un nombre >80 no entra en la copia. Mientras exista la copia (hasta P4), el tope efectivo es 80 (PROPUESTA) |

Iguales en ambos (no hay que tocarlas): documento único por empresa incluso entre inactivas; CUIT/CUIL/CDI del mismo número son la misma clave; DNI y pasaporte; jurídica solo CUIT o ID extranjero; domicilio AR o exterior; nota ≤2000; 11 condiciones IVA; Agente de persona→empresa; nada se borra; aislamiento por empresa.

---

## 7. Preguntas abiertas para el dueño

**Pregunta clave 1 (datos y dinero): ¿dónde queda el porcentaje de descuento, ahora que cada cliente tiene su ficha (D9)?** — RESUELTA por D12 (opción A)
> Decisión del dueño, 2026-11-13: «Acepto recomendaciones» (chat del dueño con el orquestador). La recomendada era A: el % sigue en la fila `Cliente` de cada persona o empresa (que ahora apunta a su ficha), se congela en cada cuenta como hoy (`Cuenta.descuentoPorcentaje`) y «Consumidor final» (00, 0 %) sigue sin ficha. Cambiarle el % a todos los residentes implica editar uno por uno; las categorías de descuento (opción B) **no entran**. Los clientes de hoy se conservan tal cual y quedan «pendiente de completar» hasta cargarles la ficha.

**Pregunta clave 2 (permisos):** RESUELTA por D10: igual que Pedernal. Claves nuevas de empresa (`partes_ver`, `partes_editar`, `partes_desactivar`) en el módulo `proveedores_basico` para P1.

**Pregunta clave 3 (datos):** RESUELTA por D11: el nombre puede repetirse en la Parte (igual que Pedernal, con aviso de «posible duplicado»); el único de `Proveedor.nombre` se retira en P4 (con aviso); hasta entonces sigue el de hoy.

**Pregunta «¿un cliente por ficha?» — RESUELTA por D14:** el dueño eligió «Uno solo por ficha (Recomendada)» (2026-11-13, chat del dueño con el orquestador). Una persona o empresa tiene a lo sumo un cliente; si necesitara dos descuentos distintos, se resuelve cambiando el % de ese cliente, no con un segundo cliente.

**Reglas de §6.2 — RESUELTAS una por una (D15):** el dueño las repasó de a una el 2026-11-13 (chat del dueño con el orquestador (preguntas con opciones)): R-1 «Quedan «pendiente de completar» (Recomendada)» (D16); R-2 «Se rechaza al guardar (Recomendada)» (D17); R-3 «Se crea su ficha de proveedor de Motor2 (Recomendada)» (D18); R-4 «Solo «el teléfono cambió», sin el número (Recomendada)» (D19); R-5 ya estaba decidida el 2026-11-12 con «4.- que sigan sin entrar» (D4). **La ficha de parte queda con todas las decisiones de diseño confirmadas y SIN autorización de migración:** esa se pide aparte, cuando se quiera construir la etapa P1.

**Requisito, no pregunta:** autorización expresa para migrar P1 (toca `prisma/`): **no existe todavía** para ninguna etapa (P1 a P4 en PROPUESTA). La lectura de producción para §2.4 ya está autorizada («5.-Si»), con la producción congelada: solo copia o lectura específica.

**Supuestos S1 a S9 — CONFIRMADOS por el dueño el 2026-11-13 (D13: «Acepto recomendaciones», chat del dueño con el orquestador), tal como el documento los recomienda:**
- **S1** «Anonimizar» no entra: Pedernal lo tiene en la base sin caso de uso; se agrega cuando haya un pedido (punto de extensión §5.3).
- **S2** Consignante no es un rol nuevo: sigue siendo un proveedor marcado desde el producto (D6).
- **S3** Sin «alta rápida» (`es_atajo`): solo naturaleza y nombre son obligatorios, igual alcanza para el mostrador.
- **S4** La naturaleza de lo migrado se deduce del prefijo del CUIT (§5.5); sin CUIT, «pendiente de completar».
- **S5** Teléfono como en el **código** de Pedernal (1–40 caracteres de una línea), no como su documento (6–15 dígitos).
- **S6** Provincias como lista cerrada (CHECK con los 24 códigos ISO), no como tabla: mismo dato, una tabla menos.
- **S7** La condición IVA de la ficha es solo sugerida; lo que vale es la de cada comprobante (Pedernal B.12 punto 4, DOC).
- **S8** El vínculo «Agente de» de la Parte reemplaza el `AgenteDeCliente` del piloto del 2026-10-26 (no construido); la regla D7 no cambia.
- **S9** `Proveedor.contacto` (texto) no se convierte en vínculo automáticamente.

---

## 8. Pruebas previstas y operación

### 8.1 Pruebas (nivel 10)
| Prueba | Qué demuestra |
|---|---|
| Oráculo A–E de §4.2, exhaustivo, contra la **base real** (CHECK y FK) y contra el validador del código | Las dos capas dicen lo mismo en todas las combinaciones |
| Guardián de dimensiones | Una columna o un valor nuevo sin declarar hace fallar el test |
| Paridad `cuit_valido` (SQL) ↔ `esCuitValido` (TS) con miles de casos generados (`fast-check`, ya en las dependencias: `package.json`, `^4.10.2`) | El CHECK y el código no se separan |
| Paridad de `documentoNormalizado`, `nombreBusqueda`, `telefonoDigitos` entre SQL y código | Las columnas de búsqueda no se falsean |
| **Concurrencia:** dos altas del mismo CUIT en paralelo (dos conexiones) → una parte y un `DOCUMENTO_YA_REGISTRADO` con el id de la ganadora; con CUIL del mismo número, igual | I1, I2 bajo carrera |
| **Idempotencia:** misma clave dos veces → una parte, `yaExistia`, una sola auditoría; misma clave con otros datos → `CLAVE_REUTILIZADA` | I16 |
| Dos ediciones con la misma versión → una gana, la otra `VERSION_DESACTUALIZADA` | Control optimista |
| Cambiar la naturaleza de una parte vinculada → rechazo por la base | I8 (P2) |
| Auditoría: ningún valor personal en `RegistroAuditoria` (ni en `descripcion`) | I20 |
| RLS: una parte de otra empresa no se ve ni se vincula (FK compuesta + política) | I17 |
| Migración: subir–bajar–subir sobre una copia; conteos antes/después; el `down.sql` se niega con datos nuevos sin confirmación | Reversibilidad |
| Mutación: quitar cada CHECK nuevo → algún test se pone rojo; volver → verde | Los guardianes muerden |
| e2e (Playwright): alta de la ficha desde proveedor a 375 px; «pendiente de completar» visible | Pantalla |

Gate obligatorio en la misma corrida y todos limpios (AGENTS.md): `npx tsc --noEmit`, `npm run lint`, `npm run arquitectura`, `npm run analizar:muerto`, `npm test`, `npm run build`, `npm run plataforma:build`, `npm run test:e2e`.

### 8.2 Operación: cómo volver atrás
- **Antes de aplicar en producción:** respaldo (snapshot de Neon) y la consulta §2.4 guardada para comparar.
- **Volver atrás en P1 sin datos nuevos:** `down.sql` (quita FK, columna, tabla y función). El código anterior sigue funcionando porque nunca dejó de leer `Proveedor`.
- **Volver atrás con fichas ya cargadas:** el `down.sql` se niega; la salida normal es **hacia adelante** (una migración que corrija). Si igual hay que bajar, se avisa al dueño qué se pierde (las fichas nuevas, los datos completados) y se confirma con `SET LOCAL`.
- **P4 (destructiva):** solo con aviso previo, con los datos a la vista, y con un `down.sql` que recrea las columnas desde la Parte.
- **Monitoreo después de P1:** cuántas partes siguen «pendientes de completar» (consulta de una línea), para saber cuándo se puede retirar `migradaDe`.

---

## 9. Lo que quedó NO VERIFICADO

1. Cantidad de filas de Cliente y Proveedor en producción, cuántos CUIT válidos, cuántos teléfonos/correos no pasarían las reglas (la consulta está en §2.4; no se corrió).
2. Cómo trata Prisma 7.10.0 (la versión del proyecto) una columna `GENERATED ALWAYS … STORED`; Motor2 no tiene ninguna hoy.
3. Que los prefijos 20/23/24/27 = persona y 30/33/34 = empresa sean exactos según ARCA (lo dice el código de Motor2, no una fuente oficial).
4. Cuánto tarda la copia de P1 y si hace falta detener la escritura del catálogo.
5. Si `FORCE ROW LEVEL SECURITY` rompe algún script o trabajo que hoy lee con el rol dueño además de `medir-cuit.ts`.
6. Si `createMany({ skipDuplicates })` de Prisma da el mismo comportamiento que `ON CONFLICT DO NOTHING` dentro de una transacción SERIALIZABLE.
7. Lo que dice el **documento** de Pedernal y no comprobé en su código: orden y límites de la búsqueda (§B.5), «la fusión es futura» (§G.1), la condición IVA como valor sugerido (§B.12), la decisión F2 sobre la auditoría (la confirmé en el código solo en `partes.ts`, no en todo el módulo).
8. Los 24 códigos de provincia: copiados de Pedernal (`0006_fiscal.sql`, ISO 3166-2:AR); el código numérico de ARCA está vacío también allá.

---

Autoría: este documento lo escribió **Opus** (sesión de diseño). No hay código: la regla «Opus no escribe código» (AGENTS.md, 2026-11-04) no se toca. Todo lo que se implemente de acá lo escribe **Sonnet**, después del OK del dueño y de la autorización de migración.
