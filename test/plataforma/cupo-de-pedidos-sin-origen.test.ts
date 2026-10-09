import { describe, expect, it } from "vitest";
import { MAXIMO_DE_PEDIDOS_DE_CODIGO_POR_ORIGEN } from "../../src/core/plataforma/limites";
import { ORIGEN_DESCONOCIDO, origenDeLasCabeceras } from "../../src/core/seguridad/origen-del-pedido";
import { origenDelPedido, origenSinCupoDeCodigos } from "../../plataforma/src/servidor/limitador-de-pedidos";

/**
 * M-18 (T16; CAMBIA COMPORTAMIENTO donde antes no había cupo): `origenDelPedido` devolvía `null` sin `x-forwarded-for` y el cupo decía «sin origen, nunca»: esa puerta quedaba SIN freno
 * (detrás de otro proxy, o con un pedido que llega sin la cabecera). Denegar por defecto: un balde común «desconocido», con el mismo cupo que cualquier otro origen.
 */
describe("origen del pedido sin x-forwarded-for (M-18)", () => {
  it("el origen sale de la primera IP de la cabecera; sin cabecera, vacía o con la coma suelta, es el balde común y nunca null", () => {
    expect(origenDeLasCabeceras(new Headers({ "x-forwarded-for": " 198.51.100.7 , 10.0.0.1" }))).toBe("198.51.100.7");
    for (const cabeceras of [new Headers(), new Headers({ "x-forwarded-for": "" }), new Headers({ "x-forwarded-for": " , 10.0.0.1" })]) {
      expect(origenDeLasCabeceras(cabeceras)).toBe(ORIGEN_DESCONOCIDO);
      expect(origenDelPedido(cabeceras)).toBe(ORIGEN_DESCONOCIDO);
    }
  });

  it("la clave del balde no puede ser una IP, así que una cabecera mentirosa no la pisa", () => {
    expect(ORIGEN_DESCONOCIDO).toMatch(/[()]/);
  });

  it("EL ATAQUE: pedidos de código de la consola sin origen comparten UN cupo (el de cualquier origen), no entran ilimitados", () => {
    const origen = origenDelPedido(new Headers());
    const ahora = 1_000_000;
    const pasan = Array.from({ length: MAXIMO_DE_PEDIDOS_DE_CODIGO_POR_ORIGEN * 3 }, () => origenSinCupoDeCodigos(origen, ahora)).filter((sinCupo) => !sinCupo).length;
    expect(pasan).toBe(MAXIMO_DE_PEDIDOS_DE_CODIGO_POR_ORIGEN);
  });

  it("un `null` que llegue directo al cupo (un llamador que no pasó por origenDelPedido) también cuenta en el balde común", () => {
    const ahora = 50_000_000;
    const pasan = Array.from({ length: MAXIMO_DE_PEDIDOS_DE_CODIGO_POR_ORIGEN * 3 }, () => origenSinCupoDeCodigos(null, ahora)).filter((sinCupo) => !sinCupo).length;
    // El balde ya se usó en otro caso de este archivo, en otra hora: acá empieza una ventana nueva.
    expect(pasan).toBe(MAXIMO_DE_PEDIDOS_DE_CODIGO_POR_ORIGEN);
  });
});
