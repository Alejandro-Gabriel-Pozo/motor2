import { describe, expect, it } from "vitest";
import { MAXIMO_DE_CODIGOS_PEDIDOS_POR_HORA, MAXIMO_DE_PEDIDOS_DE_CODIGO_POR_ORIGEN, VENTANA_DE_PEDIDOS_MS } from "../../src/core/plataforma/limites";
import { origenSinCupoDeCodigos } from "../../plataforma/src/servidor/limitador-de-pedidos";

/**
 * I-1 de la auditoría intermedia (corrección de T4): el cupo por origen y el techo del administrador NO son dos números que se elijan por separado. El techo se
 * cuenta sobre todos los códigos de la hora, vengan de quien vengan; si lo que acepta UNA IP en una hora llega al techo, un anónimo le deja sin código al
 * administrador (con 6 cada 10 minutos eran 36 por hora contra 10). Este archivo fija la relación, contra el limitador REAL de la consola, para que ninguna de las
 * dos constantes vuelva a desfasarse; el ataque contra Postgres está en `test/persistencia/ingreso-de-plataforma.test.ts`.
 */
describe("el cupo por origen de los pedidos de código está derivado del techo del administrador", () => {
  const MINUTO = 60 * 1000;
  /** Cuántos de `intentos` pedidos desde ese origen, a ese instante, deja pasar el limitador real de `pedirCodigo`. */
  const pasan = (origen: string, cuando: number, intentos: number) => Array.from({ length: intentos }, () => origenSinCupoDeCodigos(origen, cuando)).filter((sinCupo) => !sinCupo).length;

  it("lo que una sola IP escribe en el peor caso de una hora móvil (dos ráfagas, cada una en una ventana fija distinta) deja al menos un lugar al administrador", () => {
    expect(2 * MAXIMO_DE_PEDIDOS_DE_CODIGO_POR_ORIGEN).toBeLessThan(MAXIMO_DE_CODIGOS_PEDIDOS_POR_HORA);
  });

  it("el limitador real deja pasar el tope entero al final de una ventana y otra vez al principio de la siguiente, y nunca más que el tope por ventana", () => {
    // Si dejara pasar más que eso (o ventanas más cortas que la hora del techo), la cuenta de arriba (2 × tope) estaría subestimada y el caso anterior no probaría nada.
    const origen = "203.0.113.200";
    const alFinalDeLaPrimera = pasan(origen, VENTANA_DE_PEDIDOS_MS - MINUTO, MAXIMO_DE_PEDIDOS_DE_CODIGO_POR_ORIGEN * 3);
    expect(alFinalDeLaPrimera).toBe(MAXIMO_DE_PEDIDOS_DE_CODIGO_POR_ORIGEN);
    // Dentro de la misma ventana no hay más lugar (si la ventana fuera de 10 minutos, acá ya habría una nueva).
    expect(pasan(origen, VENTANA_DE_PEDIDOS_MS - MINUTO + 30 * MINUTO, 3)).toBe(0);
    // Vencida la ventana (`ahora > venceEn`), la segunda ráfaga abre una nueva.
    const alPrincipioDeLaSegunda = pasan(origen, 2 * VENTANA_DE_PEDIDOS_MS, MAXIMO_DE_PEDIDOS_DE_CODIGO_POR_ORIGEN * 3);
    expect(alPrincipioDeLaSegunda).toBe(MAXIMO_DE_PEDIDOS_DE_CODIGO_POR_ORIGEN);
    expect(alFinalDeLaPrimera + alPrincipioDeLaSegunda).toBeLessThan(MAXIMO_DE_CODIGOS_PEDIDOS_POR_HORA);
  });

  it("los números, escritos a mano (techo 10 por hora → cupo 4 por origen y hora)", () => {
    // Los casos de arriba usan las constantes y seguirían verdes con cualquier par coherente; este fija el par vigente. Cambiar uno exige tocar este número a propósito.
    expect(MAXIMO_DE_CODIGOS_PEDIDOS_POR_HORA).toBe(10);
    expect(MAXIMO_DE_PEDIDOS_DE_CODIGO_POR_ORIGEN).toBe(4);
    expect(VENTANA_DE_PEDIDOS_MS).toBe(60 * 60 * 1000);
  });
});
