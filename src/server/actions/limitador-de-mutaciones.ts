import { crearLimitadorDeTasa } from "@/core/permisos/limitador-tasa";

/**
 * La INSTANCIA del limitador de mutaciones: una por proceso, con su estado en memoria (las ventanas por usuario). La usan los tres envoltorios de
 * `con-permiso.ts`, que le pasan `(usuarioId, ahora)` con la hora del pedido.
 *
 * Vive acá y no en `core/permisos/limitador-tasa.ts` (O.33, paso L.2 del Hito 3 de `pureza-integracion`): `core` es lógica pura sin estado de módulo, y una
 * instancia con un `Map` que crece con cada pedido es justamente estado del proceso. `core` conserva solo la fábrica pura (`crearLimitadorDeTasa`); que se
 * instancie solo fuera de `core`, y que `core` no declare `let`/`var` de módulo, lo vigila `test/arquitectura/core-sin-estado-de-modulo.test.ts`.
 *
 * Límite alto a propósito (no es antiabuso agresivo): tiene que convivir con flujos legítimos de carga masiva (ej. la grilla de Conteo Físico, que puede
 * disparar decenas de `registrarConteoFisico` seguidos al confirmar). Best effort: cada instancia serverless cuenta por su cuenta (ver la fábrica).
 */
const LIMITE_MUTACIONES_POR_MINUTO = 300;

export const limitadorMutaciones = crearLimitadorDeTasa(LIMITE_MUTACIONES_POR_MINUTO, 60_000);
