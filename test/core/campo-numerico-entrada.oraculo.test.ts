import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { aplicarEdicion, formatearNumeroDelCampo, origenDeLaEdicion, textoParaVer, valorAEmitir } from "@/core/datos/campo-numero-logica";
import { contextoDeCantidad, interpretarNumeroTecleado, leerNumeroCanonico, numeroDeEntrada, pistaDeMiles, type ContextoNumerico } from "@/core/datos/numero-tecleado";
import { CODIGOS_AJENOS_A_LOS_NUMEROS, CODIGOS_DE_RECHAZO_DE_NUMEROS, CONTEXTOS, EDICIONES, FILAS, FILAS_DEL_SERVIDOR, TIPOS, VISTAS, type Esperado } from "./oraculo-numero-entrada";

/**
 * Recorre el oráculo de la regla de números de entrada (`oraculo-numero-entrada.ts`, escrito aparte del código) contra el parser del campo, la edición del campo y la lectura del servidor, en TODAS las
 * combinaciones: texto × contexto (0, 2, 3 y 4 decimales) × lado. Más un guardián: un tipo de campo o un código de rechazo nuevo sin declarar en el oráculo falla.
 */
const contexto = (decimales: number): ContextoNumerico => contextoDeCantidad(decimales);

function comoEsperado(r: ReturnType<typeof interpretarNumeroTecleado>): Esperado {
  return r.ok ? { valor: r.valor } : { rechazo: r.codigo as "punto" | "formato" | "decimales" | "notacion" };
}

describe("oráculo · el campo (lo que escribe o pega una persona)", () => {
  for (const c of CONTEXTOS) {
    for (const f of FILAS) {
      it(`${c.nombre} · ${JSON.stringify(f.texto)} → ${JSON.stringify(f.campo[c.decimales])}`, () => {
        expect(comoEsperado(interpretarNumeroTecleado(f.texto, contexto(c.decimales)))).toEqual(f.campo[c.decimales]);
      });
    }
  }

  it("una fila con «.» se rechaza en TODOS los contextos y una sin «.» nunca se rechaza por el punto (las dos marcas de la fila dicen la verdad)", () => {
    for (const f of FILAS) {
      expect(f.tienePunto, f.texto).toBe(f.texto.includes("."));
      expect(f.tieneComa, f.texto).toBe(f.texto.includes(","));
      for (const c of CONTEXTOS) {
        const e = f.campo[c.decimales];
        expect("rechazo" in e && e.rechazo === "punto", `${f.texto} en ${c.nombre}`).toBe(f.tienePunto);
      }
    }
  });

  it("lo que el campo EMITE hacia el formulario es siempre canónico (dígitos y un punto) cuando el texto se entiende, y nunca un número cuando no", () => {
    for (const c of CONTEXTOS) {
      for (const f of FILAS) {
        const e = f.campo[c.decimales];
        const emitido = valorAEmitir(f.texto, contexto(c.decimales));
        if ("valor" in e) expect(emitido, `${f.texto} en ${c.nombre}`).toBe(e.valor === null ? "" : String(e.valor));
        else expect(leerNumeroCanonico(emitido).ok, `${f.texto} en ${c.nombre} no puede emitir un número canónico`).toBe(false);
      }
    }
  });
});

describe("oráculo · la edición del campo (tecla «.», pegado, arrastrado)", () => {
  for (const e of EDICIONES) {
    it(`${e.origen}: ${e.caso}`, () => {
      expect(aplicarEdicion(e.anterior, e.nuevo, e.origen, e.cursor)).toEqual({ texto: e.texto, cursor: e.cursorFinal, avisoDelPunto: e.aviso });
    });
  }
});

describe("oráculo · el servidor (solo el formato canónico estricto)", () => {
  for (const c of CONTEXTOS) {
    for (const f of FILAS_DEL_SERVIDOR) {
      it(`${c.nombre} · ${JSON.stringify(f.texto)} → ${JSON.stringify(f.esperado[c.decimales])}`, () => {
        expect(comoEsperado(numeroDeEntrada(f.texto, contexto(c.decimales)))).toEqual(f.esperado[c.decimales]);
      });
    }
  }

  it("lo que manda el campo (su valor canónico) lo acepta el servidor y da el mismo número que leyó el campo (nunca dos lecturas distintas)", () => {
    for (const c of CONTEXTOS) {
      for (const f of FILAS) {
        const e = f.campo[c.decimales];
        if (!("valor" in e)) continue;
        const emitido = valorAEmitir(f.texto, contexto(c.decimales));
        expect(comoEsperado(numeroDeEntrada(emitido, contexto(c.decimales))), `${f.texto} en ${c.nombre}`).toEqual(e);
      }
    }
  });
});

describe("oráculo · cómo se ve un valor guardado", () => {
  for (const v of VISTAS) {
    it(`${v.tipo} ${JSON.stringify(v.valor)} se ve ${JSON.stringify(v.se_ve)}`, () => {
      expect(textoParaVer(v.valor, v.tipo)).toBe(v.se_ve);
    });
  }

  it("lo que se ve nunca contiene un «.» que no sea de miles, y si el número tiene 4 cifras o más lleva punto de miles", () => {
    expect(formatearNumeroDelCampo(1000, "entero")).toBe("1.000");
    expect(formatearNumeroDelCampo(999, "entero")).toBe("999");
    expect(formatearNumeroDelCampo(1e21, "entero")).toBe("1.000.000.000.000.000.000.000");
  });
});

describe("guardián · una dimensión nueva sin declarar hace fallar el test", () => {
  it("los tipos de campo del código son exactamente los declarados en el oráculo", () => {
    const fuente = readFileSync(join(__dirname, "../../src/core/datos/campo-numero-logica.ts"), "utf8");
    const declaracion = /export type TipoDeCampoNumerico = ([^;]+);/.exec(fuente);
    expect(declaracion, "no se encontró `TipoDeCampoNumerico`").not.toBeNull();
    const delCodigo = [...(declaracion?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]).sort();
    expect(delCodigo).toEqual(Object.keys(TIPOS).sort());
  });

  it("los códigos de rechazo de `CodigoDato` son los de números declarados más los ajenos declarados", () => {
    const fuente = readFileSync(join(__dirname, "../../src/core/datos/resultado.ts"), "utf8");
    const declaracion = /export type CodigoDato = ([^;]+);/.exec(fuente);
    expect(declaracion, "no se encontró `CodigoDato`").not.toBeNull();
    const delCodigo = [...(declaracion?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]).sort();
    expect(delCodigo).toEqual([...Object.keys(CODIGOS_DE_RECHAZO_DE_NUMEROS), ...CODIGOS_AJENOS_A_LOS_NUMEROS].sort());
  });

  it("las propiedades de `CampoNumero` que cambian lo que se escribe están declaradas (una opción nueva obliga a decidir si cambia la regla)", () => {
    const fuente = readFileSync(join(__dirname, "../../src/components/campo-numero.tsx"), "utf8");
    const props = /interface Props \{([\s\S]*?)\n\}/.exec(fuente)?.[1] ?? "";
    const nombres = [...props.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]).sort();
    // Cada una, con su efecto sobre la regla: ninguna cambia qué se acepta salvo `tipo`, `decimales` y `permitirNegativo`.
    const AFECTAN = ["decimales", "permitirNegativo", "tipo"];
    const NO_AFECTAN = ["ariaLabel", "autoFocus", "ayuda", "className", "defaultValue", "errorDeRegla", "etiqueta", "id", "name", "onChange", "placeholder", "prefijo", "required", "sinEntendido", "tamano", "unidad", "value"];
    expect(nombres).toEqual([...AFECTAN, ...NO_AFECTAN].sort());
  });
});

describe("oráculo · el origen de una edición según lo que manda el navegador (Android manda keyCode 229: la regla mira el texto, no las teclas)", () => {
  it.each([
    ["insertText", ".", "tecleado"], // teclado de escritorio y la mayoría de los de celular
    ["insertCompositionText", ".", "tecleado"], // Gboard: una tecla como composición
    ["insertText", "1.5", "pegado"], // varios caracteres de golpe
    ["insertCompositionText", "12.", "pegado"], // composición de varios caracteres (se rechaza entero: queda lo que había, que es igual que ignorar la tecla al final)
    ["insertFromPaste", "1.5", "pegado"],
    ["insertFromDrop", "1.5", "pegado"],
    ["insertReplacementText", "1.5", "pegado"], // autocompletado / sugerencia del teclado
    [undefined, null, "pegado"], // un cambio sin InputEvent (relleno automático del navegador)
  ] as const)("inputType %j con data %j → %s", (inputType, data, esperado) => {
    expect(origenDeLaEdicion(inputType, data)).toBe(esperado);
  });
});

describe("oráculo · textos largos (sin regex cuadráticas: ReDoS)", () => {
  it("agrupar miles de un número larguísimo y leer una pista sobre un texto largo es instantáneo", () => {
    const inicio = Date.now();
    const largo = "9".repeat(200_000);
    expect(formatearNumeroDelCampo(Number("1" + "0".repeat(20)), "entero")).toBe("100.000.000.000.000.000.000");
    expect(textoParaVer(largo, "cantidad").length).toBeGreaterThan(0); // no es un número finito representable: se ve tal cual, sin colgarse
    expect(pistaDeMiles(" ".repeat(200_000) + "x," + " ".repeat(200_000))).toBeNull();
    expect(interpretarNumeroTecleado("1".repeat(200_000) + ".", contexto(2))).toMatchObject({ ok: false, codigo: "punto" });
    expect(Date.now() - inicio).toBeLessThan(2000);
  });
});
