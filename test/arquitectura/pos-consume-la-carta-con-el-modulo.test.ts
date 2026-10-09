import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * GT-12, MITAD DEL POS (S-22 / D2 del dueño, tanda T10 del plan de endurecimiento de seguridad): **el POS no lee la carta ni las promos sin preguntar si la empresa las
 * contrató**. El POS pertenece al módulo Salón y el guard de cada acción `pos_*` lo exige, pero el selector de «agregar al pedido» y la validación de cada promo leen DATOS de
 * los módulos Carta y Promociones, y esas lecturas no pasan por el gate de ninguna acción: son las que tienen que preguntar (`server/lecturas/pos/modulos-del-pos.ts`). Una lectura
 * nueva del POS que toque la carta sin preguntar dejaría a una empresa sin el módulo vendiendo (o mostrando) lo que no pagó, sin que ningún gate lo vea.
 *
 * Cómo lo encuentra (por AST, sin base; fuera de los comentarios), en `server/{lecturas,consultas,actions,persistencia}/pos` y `app/(pos)`: todo archivo que
 *  - importa de `@/server/lecturas/carta/…` (la carta pública, los descuentos), o
 *  - toca un modelo de la carta (`promoCarta`, `seccionCarta`, `contenidoCartaProducto`, `generoCarta`, `itemAgrupadoCarta`, `opcionItemAgrupadoCarta`, …), por acceso `x.modelo` o como clave de un
 *    `select`/`include`.
 * Cada uno figura en la lista cerrada `DECLARADOS`, verificada en las DOS direcciones: un archivo nuevo que consume la carta sin declararse falla, y una declaración que ya no corresponde falla.
 * Los archivos declarados «PREGUNTA» tienen que usar, en código, `modulos.<carta|promociones>` (el resultado de `ModulosDelPos`) para decidir si leen; los «EXENTO» llevan su motivo.
 *
 * Mutaciones (rojo → revertido editando → verde): importar `resolverMenuCarta` en un archivo nuevo del POS (aparece sin declarar), sacar de `promo-para-agregar.ts` la pregunta por
 * `modulos.promociones` (deja de preguntar), y los casos sintéticos de abajo.
 */
const RAIZ = join(__dirname, "../..");
const ZONAS = ["src/server/lecturas/pos", "src/server/consultas/pos", "src/server/actions/pos", "src/server/persistencia/pos", "src/app/(pos)"] as const;
const MODELOS_DE_LA_CARTA = new Set(["promoCarta", "promoCartaCupo", "promoCartaSucursal", "seccionCarta", "contenidoCartaProducto", "generoCarta", "itemAgrupadoCarta", "opcionItemAgrupadoCarta"]);
const PREFIJO_DE_LECTURAS_DE_CARTA = "@/server/lecturas/carta/";

type Modulo = "carta" | "promociones";
type Declaracion = { tipo: "PREGUNTA"; modulos: readonly Modulo[]; motivo: string } | { tipo: "EXENTO"; motivo: string };

const DECLARADOS: Readonly<Record<string, Declaracion>> = {
  "src/server/lecturas/pos/selector-carta.ts": {
    tipo: "PREGUNTA",
    modulos: ["carta", "promociones"],
    motivo: "Arma el selector del POS: sin Carta lee la lista plana de los PV (nada de secciones, géneros ni agrupados) y sin Promociones ninguna promo.",
  },
  "src/server/lecturas/pos/promo-para-agregar.ts": {
    tipo: "PREGUNTA",
    modulos: ["promociones"],
    motivo: "Es la fuente única con la que `agregarItems` valida cada promo: sin Promociones no devuelve ninguna.",
  },
  "src/server/actions/pos/casos-de-uso/agregar-items.ts": {
    tipo: "EXENTO",
    motivo:
      "Solo importa `descuentosDeProductoEnSucursal` (el descuento de PRODUCTO de la sucursal, un precio): lo congela igual que el selector (paridad fijada por test). Que ese descuento siga rigiendo con Carta apagada es A CONFIRMAR con el dueño (cambiarlo cambia precios). Las promos las pregunta por el módulo en el mismo archivo (`modulosDelPosDeEmpresa`), no por esta importación.",
  },
};

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.(ts|tsx)$/.test(nombre) ? [ruta] : [];
  });
}

interface Hallazgos {
  /** Qué consume: `import:<archivo>` o `modelo:<nombre>`. */
  consume: Set<string>;
  /** Los `modulos.<x>` que el código usa para decidir. */
  pregunta: Set<string>;
}

/** Lee un archivo (su texto, sin comentarios: el AST no los visita) y dice qué consume de la carta y por qué módulos pregunta. */
function hallazgosDe(texto: string, nombre = "x.ts"): Hallazgos {
  const sf = ts.createSourceFile(nombre, texto, ts.ScriptTarget.Latest, true, nombre.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const consume = new Set<string>();
  const pregunta = new Set<string>();
  const visitar = (nodo: ts.Node): void => {
    if (ts.isImportDeclaration(nodo) && ts.isStringLiteral(nodo.moduleSpecifier) && nodo.moduleSpecifier.text.startsWith(PREFIJO_DE_LECTURAS_DE_CARTA)) {
      consume.add(`import:${nodo.moduleSpecifier.text.slice(PREFIJO_DE_LECTURAS_DE_CARTA.length)}`);
    }
    if (ts.isPropertyAccessExpression(nodo)) {
      if (MODELOS_DE_LA_CARTA.has(nodo.name.text)) consume.add(`modelo:${nodo.name.text}`);
      if (ts.isIdentifier(nodo.expression) && nodo.expression.text === "modulos") pregunta.add(nodo.name.text);
    }
    if (ts.isPropertyAssignment(nodo) && (ts.isIdentifier(nodo.name) || ts.isStringLiteral(nodo.name)) && MODELOS_DE_LA_CARTA.has(nodo.name.text)) consume.add(`modelo:${nodo.name.text}`);
    ts.forEachChild(nodo, visitar);
  };
  visitar(sf);
  return { consume, pregunta };
}

describe("GT-12 · el POS no lee la carta ni las promos sin preguntar el módulo", () => {
  const reales = ZONAS.flatMap((z) => archivos(join(RAIZ, z)))
    .map((ruta) => ({ archivo: relative(RAIZ, ruta).split(sep).join("/"), ...hallazgosDe(readFileSync(ruta, "utf8"), ruta) }))
    .filter((h) => h.consume.size > 0);

  it("los archivos del POS que consumen la carta son exactamente los declarados (ni uno más, ni uno menos)", () => {
    expect(reales.map((h) => h.archivo).sort()).toEqual(Object.keys(DECLARADOS).sort());
  });

  it.each(Object.entries(DECLARADOS).filter(([, d]) => d.tipo === "PREGUNTA"))("%s pregunta por los módulos que declara", (archivo, declaracion) => {
    const hallado = reales.find((h) => h.archivo === archivo);
    expect(hallado, `${archivo} ya no consume la carta: sacalo de DECLARADOS`).toBeDefined();
    if (declaracion.tipo !== "PREGUNTA") return;
    for (const modulo of declaracion.modulos) expect(hallado!.pregunta.has(modulo), `${archivo} consume la carta pero no usa \`modulos.${modulo}\``).toBe(true);
  });

  it("toda declaración tiene su motivo escrito", () => {
    for (const [archivo, d] of Object.entries(DECLARADOS)) expect(d.motivo.trim().length, archivo).toBeGreaterThan(30);
  });

  describe("el propio guardián (casos sintéticos)", () => {
    it("ve una importación de las lecturas de la carta", () => {
      expect([...hallazgosDe(`import { resolverMenuCarta } from "@/server/lecturas/carta/menu";\nexport const x = 1;`).consume]).toEqual(["import:menu"]);
    });
    it("ve un modelo de la carta por acceso y por clave de un select", () => {
      const h = hallazgosDe(`export const f = (db: any) => db.promoCarta.findMany({ select: { seccionCarta: { select: { nombre: true } } } });`);
      expect([...h.consume].sort()).toEqual(["modelo:promoCarta", "modelo:seccionCarta"]);
    });
    it("no ve lo que está en un comentario ni un archivo que no toca la carta", () => {
      expect(hallazgosDe(`// db.promoCarta.findMany y @/server/lecturas/carta/menu\n/* generoCarta */\nexport const x = 1;`).consume.size).toBe(0);
    });
    it("ve cuando el código pregunta por un módulo", () => {
      expect([...hallazgosDe(`export const f = (modulos: { carta: boolean }) => (modulos.carta ? 1 : 2);`).pregunta]).toEqual(["carta"]);
    });
  });
});
