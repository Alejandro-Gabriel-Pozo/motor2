import { describe, expect, it } from "vitest";
import { esUrlHttpsPermitida } from "../../src/core/datos/url";
import { urlImagenSegura } from "../../src/core/carta/armar-menu";
import { imagenParaCompartir } from "../../src/core/carta/metadatos";

/**
 * Oráculo del validador único de direcciones `https://` (paso 4 de la auditoría 2026-11-12; «todo nace cerrado»). La carta mete la imagen en un `url(...)` de CSS sin escapar, así que lo que
 * puede romper ese CSS o disfrazar el destino no entra.
 */
describe("esUrlHttpsPermitida: lo que se permite", () => {
  const validas = [
    "https://ejemplo.com",
    "https://ejemplo.com/",
    "https://sub.ejemplo.com.ar/imagenes/pizza-1.jpg",
    "HTTPS://EJEMPLO.COM/A.PNG",
    "https://ejemplo.com:8443/a.png?v=2&w=100#parte",
    "https://cdn.ejemplo.com/a%20b/%C3%B1.png",
    "https://ejemplo.com/a_b~c-d.webp?x=1+2,3;4=5",
    "https://instagram.com/mi_local",
    "https://ejemplo.com/@usuario",
    "https://1.2.3.4/a.png",
  ];
  it.each(validas)("acepta %s", (v) => expect(esUrlHttpsPermitida(v)).toBe(true));

  const invalidas: Array<[string, string]> = [
    ["http sin la s", "http://ejemplo.com/a.png"],
    ["otro protocolo", "javascript:alert(1)"],
    ["datos incrustados", "data:image/png;base64,AAAA"],
    ["sin protocolo", "ejemplo.com/a.png"],
    ["protocolo relativo", "//ejemplo.com/a.png"],
    ["usuario y contraseña delante del dominio (disfraza el destino)", "https://banco.com@otro.com/a.png"],
    ["usuario con dos puntos", "https://usuario:clave@ejemplo.com/"],
    ["sin dominio", "https:///a.png"],
    ["dominio que empieza con guion", "https://-ejemplo.com/"],
    ["dominio con guion bajo", "https://eje_mplo.com/"],
    ["dominio con letras no ASCII (va en punycode)", "https://añadir.com/a.png"],
    ["espacio", "https://ejemplo.com/a b.png"],
    ["salto de línea", "https://ejemplo.com/a.png\nhttps://otro.com"],
    ["comilla simple (rompe el url('…') de CSS)", "https://ejemplo.com/a'b.png"],
    ["comilla doble", 'https://ejemplo.com/a"b.png'],
    ["paréntesis de cierre (cierra el url(…) de CSS)", "https://ejemplo.com/a).png"],
    ["paréntesis de apertura", "https://ejemplo.com/a(.png"],
    ["barra invertida", "https://ejemplo.com/a\\b.png"],
    ["signo menor y mayor", "https://ejemplo.com/<script>"],
    ["acento grave", "https://ejemplo.com/a`b.png"],
    ["llave", "https://ejemplo.com/a{b}.png"],
    ["barra vertical", "https://ejemplo.com/a|b.png"],
    ["carácter de ancho cero", "https://ejemplo.com/a​.png"],
    ["NUL", "https://ejemplo.com/a\u0000.png"],
    ["puerto con letras", "https://ejemplo.com:abc/a.png"],
    ["puerto de seis dígitos", "https://ejemplo.com:123456/a.png"],
    ["vacío", ""],
    ["solo el protocolo", "https://"],
  ];
  it.each(invalidas)("rechaza %s", (_motivo, v) => expect(esUrlHttpsPermitida(v)).toBe(false));
});

describe("los tres lugares usan el mismo criterio", () => {
  it("imagen de una sección de la carta (urlImagenSegura): recorta y devuelve la dirección o null", () => {
    expect(urlImagenSegura("  https://cdn.ejemplo.com/a.png ")).toBe("https://cdn.ejemplo.com/a.png");
    expect(urlImagenSegura("https://cdn.ejemplo.com/a).png")).toBeNull();
    expect(urlImagenSegura("https://banco.com@otro.com/a.png")).toBeNull();
    expect(urlImagenSegura(null)).toBeNull();
    expect(urlImagenSegura("")).toBeNull();
  });

  it("imagen para compartir (imagenParaCompartir): solo https permitida", () => {
    expect(imagenParaCompartir("https://cdn.ejemplo.com/a.png")).toBe("https://cdn.ejemplo.com/a.png");
    expect(imagenParaCompartir("https://cdn.ejemplo.com/a b.png")).toBeNull();
    expect(imagenParaCompartir("https://cdn.ejemplo.com/a'b.png")).toBeNull();
    expect(imagenParaCompartir("javascript:alert(1)")).toBeNull();
    expect(imagenParaCompartir(undefined)).toBeNull();
  });
});
