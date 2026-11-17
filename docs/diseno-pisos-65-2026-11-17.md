# Diseño — las 65 acciones de piso administrador bajan a piso operario (PISOS-65)

Fecha: 2026-11-17. Estado: implementado en la rama `claude/pisos-65-operario`. Documento de diseño según la regla del dueño del 2026-10-26 (escalera de 10 niveles, versión corta: es un cambio de configuración del catálogo más una regla de guardado).

## 1. Propósito, alcance y necesidad

**Necesidad (dueño, 2026-11-17, chat con el orquestador general):** «Si asi: decisiones 2 y 3 de la lista anterior. Si bajamos las 65 acciones de piso administrador a operador, esas celdas dejan de estar cerradas y la empresa decide fila por fila. Quedan cerradas de verdad solo las 14 de gobierno y de gerente, y ahí el mensaje debería decir claro por qué: «esta acción es de gobierno de la empresa y no se delega». // Creo q es mas barato».

**Regla de quién otorga (DEC-0025, CONFIRMADA):** «Así me refería a que se baje el piso y después el gerente edite.» (2026-11-17, chat del dueño). Solo el gerente le da una de las 65 a un rol de nivel operario.

Qué entra: (1) las 65 acciones pasan de `nivelMinimo: "administrador"` a `"operario"`, sin tocar `rolesEditarSemilla` (todo sigue naciendo cerrado: solo `admin` las tiene de fábrica); (2) las 14 de gobierno y de gerente no se bajan, y su celda cerrada y su rechazo dicen «Esta acción es de gobierno de la empresa y no se delega.» (DEC-0024); (3) solo el gerente otorga las 65 a un rol de nivel operario; quitar sigue permitido a quien hoy puede; (4) oráculo de combinaciones y pruebas de denegación.

Qué NO entra: ninguna pantalla ni opción nueva; ninguna migración; no se extiende la regla (3) a las 24 claves de clase O (sugerencia F8 del PR, no implementada).

## 2. Cuenta del catálogo

Antes: 61 operario, 65 administrador, 12 administrador de sistema, 2 gerente (140). Después: 126, 0, 12, 2. Después del cambio, `esCeldaFueraDeNivel` significa exactamente una de las 14.

## 3. Regla (3) en el código

`ACCIONES_QUE_DA_SOLO_EL_GERENTE` (lista en `src/core/permisos/acciones.ts`, en el orden de `ACCIONES`) y `otorgaUnaAccionQueDaSoloElGerente` / `mensajeSiNoPuedeOtorgarLaAccion` (`src/core/permisos/matriz.ts`, puras). `guardarPermisosCasoDeUso` mide a quien actúa una sola vez dentro de la transacción y rechaza todo el lote antes del chequeo de concurrencia y de escribir. Mensaje (literal en `matriz.ts`, no dictado por el dueño): «Solo el gerente de la empresa puede darle esta acción a un rol de nivel operario. No se guardó nada.»

La lista es propia (no «piso operario y semilla solo admin»): eso incluiría 24 claves de clase O (`pos_*`, `compra_repartir`, `declarar_pago_compra`…) que hoy un administrador con `gestion_permisos` sí puede dar y que este cambio no toca.

## 4. ¿Qué pasa si…? (comando: guardar la matriz de permisos)

| Situación | Qué pasa |
|---|---|
| Repetición | El segundo guardado trae un `anterior` que ya no coincide: «Otra persona cambió…» o «No hay cambios»; sin doble escritura ni auditoría. |
| Concurrencia | Transacción SERIALIZABLE con reintento. Administrador y gerente a la vez sobre la misma celda: el administrador se rechaza por la regla (3) antes de escribir; si la gerencia cambia en el medio, aborta (40001), reintenta y vuelve a medir. |
| Tiempo | Sin dimensión de tiempo; el gate lee las filas en cada pedido. |
| Incertidumbre | Un `anterior` que miente esquiva la regla (3) en el bucle, pero el chequeo de concurrencia lo compara con la base y rechaza todo (hay prueba). |
| Error parcial | Todo o nada: un rechazo en cualquier celda corta el lote sin auditoría. |
| Datos faltantes | Sin fila no hay acceso (las 65 nacen cerradas). |
| Cambio de permisos | Toda fila vieja de un rol que no es `admin` sobre las 65 da acceso desde el despliegue. Medido el 2026-11-17 en la base real: 0 filas; en otras instalaciones repetir la consulta de riesgos del PR antes de desplegar y frenar si da más de 0. Quitar: un administrador que no es gerente PUEDE quitar una de las 65 (la regla solo restringe dar; declarado en DEC-0025). Revertir PISOS-65 deja inertes las filas dadas (falla cerrado). |

## 5. Pruebas (nivel 10)

Oráculo `docs/oraculo-combinaciones-pisos-65-2026-11-17.md` (dimensiones R, C, Q, M, F; 40 combinaciones de guardar y 20 de acceso) recorrido por `test/permisos/combinaciones-pisos-65.test.ts` con Postgres real; guardián `test/arquitectura/combinaciones-pisos-65-declaradas.test.ts`; denegación y concurrencia en `test/permisos/pisos-65-denegacion.test.ts` y `guardar-permisos-concurrencia.test.ts`. Los guardianes que usaban el «piso administrador» como protección de datos de dinero y de proveedores pasan a exigir «la da solo el gerente» (`test/arquitectura/guardas/resguardo-de-clave.ts`: libre < delegable < la_da_solo_el_gerente < gobierno).

## 6. Diferencia con Pedernal (declarada)

En Pedernal solo el gerente edita roles; las 65 quedan «sin piso» como en Pedernal y cerradas por semilla. En Motor2 el administrador con `gestion_permisos` sigue editando los roles de nivel operario, así que la regla (3) acota solo el DAR de estas 65 al gerente (DEC-0025). Motivo: decisión del dueño del 2026-11-17 (cita arriba).

## 7. Riesgos declarados

F1 filas dormidas (consulta de verificación en el PR); F2 el dinero (anular, corregir, pagar, caja, recibir, ajustes) pasa a ser delegable por el gerente: es lo que pidió el dueño, y lo protegen la semilla solo admin, la regla (3), el resumen «Revisar y guardar» y la auditoría por celda; F3 los datos sensibles (costos, N.º de factura, proveedor, costo de consignación) los ve quien tenga la clave que dio el gerente; F4 `compra_recibir` tenía su piso por cita del dueño del 2026-11-16, y la decisión del 2026-11-17 la incluye; F6 el rango 2 de ADR-027 pierde razón de ser en estas 65 (nota en el ADR); F7 la rama EB-1 deberá ajustar su guardián de dimensiones. F8 (sugerencia, no implementada): extender la regla (3) a las 24 claves de clase O.
