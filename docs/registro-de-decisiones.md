# Registro de decisiones de los agentes

Regla del dueño «Lo que el dueño no pidió no entra» (2026-11-11, `AGENTS.md`; diseño `docs/diseno-aceptacion-del-dueno-2026-11-11.md`). Acá se anota, en una entrada por decisión, toda elección chica, reversible y necesaria para terminar lo pedido que un agente tomó sin poder frenar y que espera el OK del dueño. Una mejora que suma funcionalidad, campos u opciones NO es una decisión: es una sugerencia y no entra al código.

## Cómo se usa

- Cada entrada es una sección `### DEC-NNNN` (cuatro dígitos, el número siguiente al último) con un renglón por campo: `- **Campo:** valor`. Los campos son: Fecha, Quién, Qué decidió, Por qué, Costo de revertir, Dónde, Estado y, salvo en `PENDIENTE_DE_OK`, Cita del dueño.
- «Dónde» nombra los archivos entre comillas invertidas, con `:línea` si ayuda. Tienen que existir.
- Un supuesto en el código se escribe `SUPUESTO(DEC-NNNN)` y su entrada tiene que estar acá. Una `SUPUESTO` sin eso falla el guardián (`test/arquitectura/registro-de-decisiones.test.ts`).
- Estados: `PENDIENTE_DE_OK` → `ACEPTADA`, `CORREGIDA` o `REVOCADA`. Una pendiente nunca se presenta como definitiva y no desaparece sola. El tope es de 10 pendientes abiertas; con 10 no se agrega una nueva, se le pregunta al dueño.
- La cita del dueño tiene la forma «texto literal» — AAAA-MM-DD — fuente. La transcribe el orquestador; ningún agente acepta en nombre del dueño.
- Si el dueño corrige, el cambio va en un PR propio. Si revoca, el código deja de nombrar la decisión en ese mismo PR (el guardián falla mientras la nombre).
- Cada PR repite las pendientes en su apartado «Decisiones mías que esperan tu OK», la más vieja primero y las de más de 14 días arriba de todo.
- Las decisiones de negocio del dueño con número de dos cifras (`DEC-02`, `DEC-16` en `docs/decisiones-cerradas-ola-precio-y-carta-2026-10-19.md`) son otra cosa: no pertenecen a este registro.

## Decisiones

### DEC-0001
- **Fecha:** 2026-11-04
- **Quién:** un agente, en la auditoría de P6 (hallazgo M.2-A4); la fecha es la del primer commit que contiene el texto (`git log -S`).
- **Qué decidió:** un producto de venta dado de alta sin la clave `producto_campos_sensibles` nace con precio 0 y con la disponibilidad APAGADA en las sucursales que pedía el tilde, así el POS y la carta pública no lo ofrecen hasta que alguien con la clave cargue el precio y alguien con `producto_disponibilidad` lo active.
- **Por qué:** sin eso un producto de venta nacía «disponible en todas las sucursales» a $0 y quedaba a la venta sin precio.
- **Costo de revertir:** un cambio chico en el caso de uso del alta y en su prueba (volver a sembrar la disponibilidad como pedía el tilde); no hay migración ni datos que corregir.
- **Dónde:** `src/server/actions/catalogo/casos-de-uso/dar-de-alta-producto.ts:38`, `test/catalogo/campos-sensibles-del-alta.test.ts:130`
- **Estado:** ACEPTADA
- **Cita del dueño:** «Sí, precio cero del alta de un producto yo lo usé porque el producto de venta como base, si tiene producto, si tiene cero de precio, es porque seguramente el precio vaya a las opciones» — 2026-11-11 — `docs/diseno-aceptacion-del-dueno-2026-11-11.md`, «Decisiones del dueño citadas»

### DEC-0002
- **Fecha:** 2026-11-11
- **Quién:** la sesión Sonnet que armó la etapa E1 de la regla (PR #231); el orquestador pidió dejarla registrada.
- **Qué decidió:** la plantilla de PR vive en `docs/pull_request_template.md` y no en `.github/pull_request_template.md`.
- **Por qué:** un `.md` dentro de `.github/` hace fallar la clasificación de rutas (`test/arquitectura/contratos/gobernanza/clasificacion.test.ts`, la regla `ci` solo admite `.yml`); moverlo exige tocar `clasificacion.ts` y registrar una aprobación del dueño en `aprobaciones.ts`. GitHub también lee la plantilla desde `docs/`.
- **Costo de revertir:** mover un archivo a `.github/`, cambiar su ruta en `AGENTS.md` y, para que el guardián de clasificación pase, ampliar esa regla en `clasificacion.ts` con la aprobación del dueño en `aprobaciones.ts`.
- **Dónde:** `docs/pull_request_template.md`
- **Estado:** PENDIENTE_DE_OK

### DEC-0003
- **Fecha:** 2026-11-12
- **Quién:** la sesión Sonnet que armó la etapa E1b de partes de promo con opciones (PR #237).
- **Qué decidió:** el servidor arma con `armarComponenteDeSeccion` solo los platos de una parte de sección que llevan opciones; los platos sin opciones conservan el chequeo de hoy (peso = precio de carta, `sinReceta`, `PROMO_CON_OPCIONES`), así un precio guardado en 0 sigue pasando y pesando $0 como hasta ahora.
- **Por qué:** la función entera exigiría además precio de referencia de $0,01 o más y producto de venta al plato sin opciones, y eso cambiaría en silencio lo que hoy se acepta sin que el dueño lo haya pedido.
- **Costo de revertir:** ninguno para lo de hoy; adoptar la función para todos los platos es cambiar una condición del bucle de componentes de sección (un cambio chico y su prueba).
- **Dónde:** `src/server/actions/pos/casos-de-uso/agregar-items.ts`, `src/server/actions/pos/casos-de-uso/promo-seccion-con-opciones.ts`
- **Estado:** PENDIENTE_DE_OK

### DEC-0004
- **Fecha:** 2026-11-12
- **Quién:** la sesión Sonnet que armó la etapa E1b de partes de promo con opciones (PR #237).
- **Qué decidió:** qué platos de una parte de sección llevan opciones se calcula en el caso de uso de agregar ítems con las opciones que ya se leen para el pedido, sin una lectura nueva en la carga de la promo.
- **Por qué:** `test/pos/agregar-items-consultas.test.ts` fija la cantidad de consultas y no se edita; la misma función pura (`conOpcionesDeLasSecciones`) es la que usará el selector en la etapa de pantalla.
- **Costo de revertir:** bajo: mover el cálculo a `cargarPromoCartaParaAgregar`, lo que obliga a cambiar el conteo congelado de consultas.
- **Dónde:** `src/server/actions/pos/casos-de-uso/agregar-items.ts`, `src/core/pos/plato-de-seccion.ts`
- **Estado:** PENDIENTE_DE_OK

### DEC-0005
- **Fecha:** 2026-11-12
- **Quién:** la sesión Sonnet que armó la etapa E1b de partes de promo con opciones (PR #237).
- **Qué decidió:** un plato de sección que no se puede armar (adicional obligatorio, o grupo obligatorio sin opciones activas) elegido CON opciones se rechaza como `PROMO_INVALIDA` (no se ofrece con opciones) y elegido sin ellas como `PROMO_CON_OPCIONES` («pedilo suelto»).
- **Por qué:** el diseño dice que ese plato no se ofrece y que `PROMO_CON_OPCIONES` queda solo para lo no armable; no fija el código de rechazo cuando igual llegan opciones.
- **Costo de revertir:** bajo: cambiar el código o el mensaje de ese rechazo y su prueba.
- **Dónde:** `src/core/pos/promo-combo.ts`, `test/pos/promo-seccion-con-opciones.test.ts`
- **Estado:** PENDIENTE_DE_OK

### DEC-0006
- **Fecha:** 2026-11-12
- **Quién:** la sesión Sonnet que armó la etapa E1b de partes de promo con opciones (PR #237).
- **Qué decidió:** el rechazo de un plato de sección con opciones por falta de origen de stock en la configuración elegida sale como `ENTRADA_NO_DISPONIBLE`, igual que en una lista «el mozo elige», y no como `PRODUCTO_SIN_RECETA`.
- **Por qué:** se reutiliza `armarConfiguracionDeEntradaAElegir`, que ya devuelve ese código; la pantalla ya lo entiende para las listas.
- **Costo de revertir:** bajo: mapear ese código a `PRODUCTO_SIN_RECETA` en el armado de los platos de sección y ajustar su prueba.
- **Dónde:** `src/core/pos/plato-de-seccion.ts`, `src/server/actions/pos/casos-de-uso/promo-seccion-con-opciones.ts`
- **Estado:** PENDIENTE_DE_OK

### DEC-0007
- **Fecha:** 2026-11-12
- **Quién:** la sesión Sonnet que armó la etapa E4 «Duplicar producto» (PR #257).
- **Qué decidió:** el producto duplicado nace disponible en todas las sucursales de la empresa si quien duplica tiene `producto_campos_sensibles` (o si es materia prima) y APAGADO en todas si no la tiene; el diálogo no ofrece el tilde de disponibilidad del alta.
- **Por qué:** sigue la regla M.2-A4 del alta (DEC-0001) con el tilde por defecto, y evita sumar una opción que el dueño no pidió; sin la clave el producto nacería a $0 y a la venta.
- **Costo de revertir:** bajo: agregar al diálogo el tilde del alta y pasarlo al caso de uso, con su prueba; no hay migración ni datos que corregir.
- **Dónde:** `src/server/actions/catalogo/casos-de-uso/duplicar-producto.ts:208`
- **Estado:** PENDIENTE_DE_OK

### DEC-0008
- **Fecha:** 2026-11-12
- **Quién:** la sesión Sonnet que armó la etapa E4 «Duplicar producto» (PR #257).
- **Qué decidió:** un original que se vende por opción se duplica con precio guardado en $0 (el modo «por opción» se aplica al final, ya validadas las opciones) y exige `producto_campos_sensibles` y copiar sus opciones.
- **Por qué:** en un producto por opción el precio guardado no se cobra (rige el de cada opción), y el control del precio de lista de cada grupo se hace contra ese precio guardado: copiarlo juzgaría las opciones contra un número que nunca se cobra.
- **Costo de revertir:** bajo: copiar el precio guardado del original y ajustar su prueba; no hay migración.
- **Dónde:** `src/server/actions/catalogo/casos-de-uso/duplicar-producto.ts:178`
- **Estado:** PENDIENTE_DE_OK

### DEC-0009
- **Fecha:** 2026-11-12
- **Quién:** la sesión Sonnet que armó la etapa E4 «Duplicar producto» (PR #257).
- **Qué decidió:** el selector «Sacar la receta de» arranca en «Central» y no en la sucursal activa.
- **Por qué:** el dueño dijo que la central funciona como una sucursal más y que se elige de cuál copiar; no dijo cuál va por defecto, y elegir una sucursal pide además el permiso `receta_sucursal_copiar` allí (S-07), que no todos tienen.
- **Costo de revertir:** muy bajo: cambiar el valor por defecto del selector y su prueba e2e.
- **Dónde:** `src/components/catalogo/duplicar-producto.tsx:43`
- **Estado:** PENDIENTE_DE_OK
