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
