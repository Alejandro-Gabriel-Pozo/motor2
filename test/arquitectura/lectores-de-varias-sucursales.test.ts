import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ensanchesUsados, fuentesDe } from "./guardas/ensanches";

/**
 * LECTORES DE VARIAS SUCURSALES (M.3-A5; plan `plan-m3-rls-por-sucursal`, §3 paso A5): las pantallas que juntan o comparan datos de más de una sucursal (el consolidado, el rendimiento
 * de recetas por sucursal, la auditoría, el origen de una copia de carta o de receta). Con la RLS por sucursal de la Fase B la base solo devuelve filas de las sucursales del ALCANCE del
 * pedido, y el alcance arranca en la sucursal activa: para MIRAR las otras, la pantalla ensancha la LECTURA con `lecturaEnSucursalesVisibles(ctx, "<clave>")` (la intersección de las
 * membresías del usuario con las sucursales donde su rol tiene el «Ver» de la clave: `sucursalesVisiblesPara`) y le pasa a la consulta que cruza sucursales la base de ESE contexto.
 * Reglas, verificadas por AST sobre una lista CERRADA (`LECTORES`):
 *  1. el archivo llama a `lecturaEnSucursalesVisibles(ctx, "<clave>")` con la clave declarada, y guarda el contexto ampliado en una variable;
 *  2. cada consulta que cruza sucursales recibe, como su argumento de base, `<esa variable>.db` y nunca `ctx.db` a secas (con `ctx.db` la consulta vería solo la activa);
 *  3. un lector NUNCA ensancha la escritura: el único ensanche que el archivo usa es `lecturaEnSucursalesVisibles` (ni `conAlcanceEnSucursal`, ni `permisoYAlcanceEnSucursal`, ni los de empresa entera);
 *  4. en la otra dirección: ningún archivo de `src/` fuera de `acceso/alcance.ts` llama a `lecturaEnSucursalesVisibles` sin figurar acá;
 *  5. `PENDIENTE` = el archivo todavía NO la llama (el estado no puede mentir); `PENDIENTES_MAXIMOS` solo baja.
 * Mutaciones (rojo → revertido editando): `ctx.db` en lugar de `<variable>.db` en una consulta; otra clave; sacar la llamada; pedir un ensanche de escritura en el lector; agregar una llamada en un
 * archivo no declarado. Y los casos sintéticos de abajo.
 */
const RAIZ = join(__dirname, "../..");

interface Lector {
  /** La clave literal con que se llama a `lecturaEnSucursalesVisibles` (de ella sale qué sucursales se ven). */
  clave: string;
  /** Cada consulta que cruza sucursales → la posición de su argumento de base (`db`), empezando en 0. */
  consultas: Readonly<Record<string, number>>;
  /** `CABLEADO`: el archivo ya lo hace; `PENDIENTE`: lo cablea un commit siguiente de A5 y el archivo todavía NO llama a `lecturaEnSucursalesVisibles`. */
  estado: "CABLEADO" | "PENDIENTE";
  motivo: string;
}

/** Cuántos lectores pueden estar `PENDIENTE`. Solo baja: cada uno que se cablea, baja este número en el mismo commit. */
const PENDIENTES_MAXIMOS = 0;

const LECTORES: Readonly<Record<string, Lector>> = {
  "src/app/(app)/reportes/consolidado/page.tsx": {
    clave: "reporte_consolidado",
    consultas: { obtenerResumenConsolidado: 1 },
    estado: "CABLEADO",
    motivo: "una fila por cada sucursal donde el rol ve el dinero: lee ventas, compras y márgenes de todas ellas",
  },
  "src/app/(app)/reportes/rendimiento-recetas/por-sucursal/page.tsx": {
    clave: "reporte_rendimiento_sucursal",
    consultas: { compararRendimientosDeSucursales: 2 },
    estado: "CABLEADO",
    motivo: "compara la calibración de cada línea de receta entre las sucursales donde el rol ve el dinero (lee `RendimientoLocalIngrediente` y las recetas propias de cada una)",
  },
  "src/app/(app)/administracion/auditoria/page.tsx": {
    clave: "ver_auditoria",
    consultas: { listarRegistrosAuditoria: 1 },
    estado: "CABLEADO",
    motivo: "el registro de cambios de todas las sucursales donde el rol ve la auditoría, más las filas sin sucursal si tiene `ver_auditoria_empresa`",
  },
  "src/app/(app)/carta/page.tsx": {
    clave: "carta_ver",
    consultas: { cargarAdminCarta: 1 },
    estado: "CABLEADO",
    motivo: "el origen de la copia de carta: cuenta la carta propia de las otras sucursales para ofrecer de dónde copiar (solo a quien puede copiar)",
  },
  "src/app/(app)/catalogo/recetas/[productoId]/page.tsx": {
    clave: "receta_sucursal_copiar",
    consultas: { listarSucursalesConRecetaPropia: 3 },
    estado: "CABLEADO",
    motivo: "el origen de la copia de receta: qué otras sucursales tienen receta propia habilitada de este producto",
  },
};

interface Hallazgo {
  /** Las variables a las que se asignó (en su inicializador) una llamada a `lecturaEnSucursalesVisibles`, y los argumentos de esa llamada. */
  ampliados: Array<{ variable: string; argumentos: string[] }>;
  /** Todas las llamadas a `lecturaEnSucursalesVisibles`, con sus argumentos. */
  llamadas: string[][];
  /** Llamadas por nombre de función → argumentos de cada una. */
  porNombre: Map<string, string[][]>;
}

/** Lee por AST (los comentarios y las cadenas no cuentan) las llamadas a `lecturaEnSucursalesVisibles`, a qué variable van y las llamadas a `nombres`. */
function leer(codigo: string, nombres: readonly string[]): Hallazgo {
  const sf = ts.createSourceFile("x.tsx", codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hallazgo: Hallazgo = { ampliados: [], llamadas: [], porNombre: new Map() };
  const llamaAlEnsanche = (n: ts.Node): ts.CallExpression | null => {
    let hallada: ts.CallExpression | null = null;
    const visitar = (m: ts.Node): void => {
      if (hallada) return;
      if (ts.isCallExpression(m) && ts.isIdentifier(m.expression) && m.expression.text === "lecturaEnSucursalesVisibles") hallada = m;
      else ts.forEachChild(m, visitar);
    };
    visitar(n);
    return hallada;
  };
  const visitar = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const llamada = llamaAlEnsanche(n.initializer);
      if (llamada) hallazgo.ampliados.push({ variable: n.name.text, argumentos: llamada.arguments.map((a) => a.getText(sf)) });
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const argumentos = n.arguments.map((a) => a.getText(sf));
      if (n.expression.text === "lecturaEnSucursalesVisibles") hallazgo.llamadas.push(argumentos);
      if (nombres.includes(n.expression.text)) hallazgo.porNombre.set(n.expression.text, [...(hallazgo.porNombre.get(n.expression.text) ?? []), argumentos]);
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return hallazgo;
}

/** Un problema por cada regla que el archivo del lector no cumple. */
function problemasDeUnLector(ruta: string, lector: Lector, codigo: string): string[] {
  const h = leer(codigo, Object.keys(lector.consultas));
  if (lector.estado === "PENDIENTE") return h.llamadas.length ? [`${ruta}: declara PENDIENTE y ya llama a lecturaEnSucursalesVisibles: marcalo CABLEADO (y bajá PENDIENTES_MAXIMOS)`] : [];
  const problemas: string[] = [];
  const ampliado = h.ampliados.find((a) => a.argumentos[0] === "ctx" && a.argumentos[1] === `"${lector.clave}"`);
  if (!ampliado) {
    problemas.push(`${ruta}: declara CABLEADO y no guarda el resultado de lecturaEnSucursalesVisibles(ctx, "${lector.clave}") en una variable`);
    return problemas;
  }
  if (h.llamadas.length !== 1) problemas.push(`${ruta}: llama ${h.llamadas.length} veces a lecturaEnSucursalesVisibles (tiene que ser una, con la clave declarada "${lector.clave}")`);
  for (const [consulta, posicion] of Object.entries(lector.consultas)) {
    const llamadas = h.porNombre.get(consulta) ?? [];
    if (!llamadas.length) problemas.push(`${ruta}: ya no llama a ${consulta} (sacala de LECTORES o corregí la declaración)`);
    for (const argumentos of llamadas) {
      if (argumentos[posicion] !== `${ampliado.variable}.db`) problemas.push(`${ruta}: ${consulta} recibe \`${argumentos[posicion] ?? "(nada)"}\` como base y tiene que recibir \`${ampliado.variable}.db\` (la del contexto ampliado): con otra base cruza sucursales sin alcance`);
    }
  }
  const usados = ensanchesUsados(codigo).filter((e) => e !== "lecturaEnSucursalesVisibles");
  if (usados.length) problemas.push(`${ruta}: un lector de varias sucursales nunca ensancha la escritura y usa \`${usados.join(", ")}\``);
  return problemas;
}

/** La otra dirección: toda llamada a `lecturaEnSucursalesVisibles` de `src/` (fuera de `alcance.ts`) está en un archivo declarado. */
function llamadasSinDeclarar(fuentes: ReadonlyMap<string, string>, lectores: Readonly<Record<string, Lector>>): string[] {
  const problemas: string[] = [];
  for (const [ruta, codigo] of fuentes) {
    if (ruta === "src/server/acceso/alcance.ts" || !codigo.includes("lecturaEnSucursalesVisibles")) continue;
    if (leer(codigo, []).llamadas.length && !(ruta in lectores)) problemas.push(`${ruta}: llama a lecturaEnSucursalesVisibles y no figura en LECTORES (declaralo con su clave, sus consultas y el motivo)`);
  }
  return problemas;
}

const fuentes = fuentesDe(RAIZ, "src");

describe("lectores de varias sucursales (M.3-A5): la lectura se ensancha por la puerta de «Ver» y la consulta usa esa base", () => {
  it("cada lector declarado cumple su forma (clave literal, base ampliada en la consulta, sin ensanche de escritura)", () => {
    const problemas = Object.entries(LECTORES).flatMap(([ruta, lector]) => {
      const codigo = fuentes.get(ruta);
      return codigo === undefined ? [`${ruta}: no existe (actualizá LECTORES)`] : problemasDeUnLector(ruta, lector, codigo);
    });
    expect(problemas).toEqual([]);
  });

  it("todos los lectores declarados tienen motivo y clave", () => {
    for (const [ruta, l] of Object.entries(LECTORES)) {
      expect(l.motivo.trim(), ruta).not.toBe("");
      expect(l.clave, ruta).toMatch(/^[a-z_]+$/);
      expect(Object.keys(l.consultas).length, ruta).toBeGreaterThan(0);
    }
  });

  it("la otra dirección: ninguna llamada a lecturaEnSucursalesVisibles en un archivo que LECTORES no declare", () => {
    expect(llamadasSinDeclarar(fuentes, LECTORES)).toEqual([]);
  });

  it("los pendientes de cablear no aumentan (y baja cuando se cablea el siguiente)", () => {
    const pendientes = Object.entries(LECTORES).filter(([, l]) => l.estado === "PENDIENTE").map(([r]) => r);
    expect(pendientes.length, `lectores PENDIENTES: ${pendientes.join(", ")}`).toBeLessThanOrEqual(PENDIENTES_MAXIMOS);
  });
});

describe("el guardián en sí (casos sintéticos)", () => {
  const lector: Lector = { clave: "reporte_consolidado", consultas: { obtenerResumenConsolidado: 1 }, estado: "CABLEADO", motivo: "x" };
  const pagina = (cuerpo: string) => `export default async function P() {\n  const ctx = await obtenerContextoUsuario();\n${cuerpo}\n}\n`;
  const BIEN = pagina('  const lectura = await lecturaEnSucursalesVisibles(ctx, "reporte_consolidado");\n  const filas = await obtenerResumenConsolidado(sucursales, lectura.db, ahora);');

  it("la base del contexto ampliado, con la clave declarada, pasa", () => {
    expect(problemasDeUnLector("p.tsx", lector, BIEN)).toEqual([]);
  });

  it("la mutación `ctx.db` en la consulta falla: cruzaría sucursales sin alcance", () => {
    const mutado = BIEN.replace("lectura.db", "ctx.db");
    expect(problemasDeUnLector("p.tsx", lector, mutado)).toHaveLength(1);
  });

  it("otra clave, sin la llamada, o dos llamadas, fallan", () => {
    expect(problemasDeUnLector("p.tsx", lector, BIEN.replace('"reporte_consolidado"', '"reporte_ventas"'))).not.toEqual([]);
    expect(problemasDeUnLector("p.tsx", lector, pagina("  const filas = await obtenerResumenConsolidado(sucursales, ctx.db, ahora);"))).not.toEqual([]);
    expect(problemasDeUnLector("p.tsx", lector, BIEN.replace("  const filas", '  await lecturaEnSucursalesVisibles(ctx, "reporte_consolidado");\n  const filas'))).toHaveLength(1);
  });

  it("un lector que además ensancha la escritura falla (en cualquiera de sus formas)", () => {
    const conEscritura = `import { conEscrituraEnLaEmpresa } from "@/server/acceso/alcance";\n${BIEN.replace("export default", "export const otra = (c) => conEscrituraEnLaEmpresa(c);\nexport default")}`;
    expect(problemasDeUnLector("p.tsx", lector, conEscritura)).toHaveLength(1);
    const conModo = `import { conAlcanceEnSucursal } from "@/server/acceso/alcance";\n${BIEN.replace("  const filas", '  const x = conAlcanceEnSucursal(ctx, "s", "LECTURA_Y_ESCRITURA");\n  const filas')}`;
    expect(problemasDeUnLector("p.tsx", lector, conModo)).toHaveLength(1);
  });

  it("el contexto ampliado también se reconoce dentro de una condición (`cond ? await … : ctx`)", () => {
    const condicional = pagina('  const origenes = puede ? await lecturaEnSucursalesVisibles(ctx, "reporte_consolidado") : ctx;\n  const filas = await obtenerResumenConsolidado(sucursales, origenes.db, ahora);');
    expect(problemasDeUnLector("p.tsx", lector, condicional)).toEqual([]);
  });

  it("PENDIENTE no puede tener ya la llamada (el estado no miente)", () => {
    expect(problemasDeUnLector("p.tsx", { ...lector, estado: "PENDIENTE" }, pagina("  const f = obtenerResumenConsolidado(s, ctx.db, a);"))).toEqual([]);
    expect(problemasDeUnLector("p.tsx", { ...lector, estado: "PENDIENTE" }, BIEN)).toHaveLength(1);
  });

  it("la otra dirección: una llamada en un archivo no declarado falla; en alcance.ts o en un comentario, no", () => {
    const fuente = new Map([["src/app/otra/page.tsx", BIEN]]);
    expect(llamadasSinDeclarar(fuente, {})).toHaveLength(1);
    expect(llamadasSinDeclarar(fuente, { "src/app/otra/page.tsx": lector })).toEqual([]);
    expect(llamadasSinDeclarar(new Map([["src/server/acceso/alcance.ts", BIEN]]), {})).toEqual([]);
    expect(llamadasSinDeclarar(new Map([["src/app/x.tsx", "// lecturaEnSucursalesVisibles(ctx, 'a')\nexport const a = 1;"]]), {})).toEqual([]);
  });
});
