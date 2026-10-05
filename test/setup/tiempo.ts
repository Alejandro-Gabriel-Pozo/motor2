/**
 * El tiempo en los tests CON BASE DE DATOS: una convención y sus ayudantes.
 *
 * El problema: una fila que crea la base (`@default(now())`: `creadaEn`, `creadoEn`, …) o un `new Date()` del código bajo prueba usan el reloj REAL. Si el test compara eso con una fecha escrita a
 * mano («2026-10-05T12:00Z» era «casi ahora» el día que se escribió), pasado ese instante el test se rompe solo, sin que nadie toque nada (un test de `consola-varias-instalaciones` falló así en CI).
 *
 * La convención (la vigila `test/arquitectura/fechas-fijas-en-tests-con-base.test.ts`):
 *  - un test con base NO escribe fechas absolutas recientes ni futuras: usa estos ayudantes, que parten del reloj real;
 *  - una fecha absoluta PASADA desde hace más de un día es segura para siempre: sirve para datos históricos, vencimientos ya cumplidos o fixtures de reportes;
 *  - si de verdad hace falta un «ahora» fijo y el código bajo prueba recibe el reloj por parámetro (sin tocar la base), se declara en la lista de excepciones de ese test, con el motivo.
 *
 * Los tests de funciones PURAS (sin base) no tienen este problema: el reloj entra por parámetro y el resultado no cambia.
 */
export const MINUTO_MS = 60_000;
export const HORA_MS = 60 * MINUTO_MS;
export const DIA_MS = 24 * HORA_MS;

/** El «ahora» de esta corrida: una sola lectura del reloj real por proceso, redondeada al segundo, para pasarlo como `ahora` a funciones que lo reciben por parámetro. */
export const AHORA_DE_LA_CORRIDA = new Date(Math.floor(Date.now() / 1000) * 1000);

/** Un instante que está `ms` DESPUÉS de ahora (el reloj real): lo que no venció todavía. */
export const enElFuturo = (ms: number): Date => new Date(Date.now() + ms);

/** Un instante que está `ms` ANTES de ahora (el reloj real): lo que ya venció. */
export const enElPasado = (ms: number): Date => new Date(Date.now() - ms);
