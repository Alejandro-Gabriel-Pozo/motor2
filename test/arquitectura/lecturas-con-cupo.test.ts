import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { REPORTES_PESADOS } from "../../src/server/actions/limitador-de-lecturas";

/**
 * Las lecturas llevan cupo por usuario (S-28, T11 del endurecimiento; GT-15 en su parte del limitador). El comportamiento lo prueba `test/seguridad/limitador-de-lecturas.test.ts`;
 * esto fija la FORMA, para que un arreglo «de prolijidad» no lo deshaga sin que nadie lo vea:
 *  - `requerirSesion` (el primer paso de TODO `requerirVer*`) cuenta la lectura con `lecturaSinCupo` DESPUÉS de resolver al usuario y ANTES de devolver el contexto: ninguna guarda
 *    de lectura lo esquiva;
 *  - cada reporte pesado (`REPORTES_PESADOS`) lo cuenta su página con `reportePesadoSinCupo(ctx.usuarioId, "<reporte>", …)` ANTES de pedirle los datos a su consulta, y no queda
 *    ningún reporte en la lista sin página ni página sin reporte. Desde I-3 (auditoría intermedia) una consulta pesada puede tener MÁS de una página (el Resumen operativo corre la
 *    misma `obtenerReportePorPeriodo` que Período y cuenta en el cupo de "periodo"), y los archivos que llaman a una consulta pesada son EXACTAMENTE esas páginas;
 *  - (I-3 y B31) las páginas de servidor no pasaban por `requerirSesion`: TODA página que resuelve al usuario (`obtenerContextoUsuario`) cuenta con `lecturaSinCupo(ctx.usuarioId, …)`
 *    justo después de resolverlo y antes de cualquier otra llamada (el gate lee la base). I-3 lo hizo con las 27 de `reportes/`; B31 (T14) con las otras 50 (administración, carta,
 *    catálogo, movimientos, stock, traspasos, POS, inicio y la raíz). Las que no deban contar van a `SIN_CUPO_DE_LECTURAS`, con su motivo (hoy ninguna).
 *
 * Mutaciones (cada una pone un caso en rojo): sacar el conteo de `requerirSesion`; ponerlo después de devolver; sacarlo de una página; ponerlo después de la consulta; un reporte
 * pesado nuevo en la lista sin su página; sacar `lecturaSinCupo` de una página (de reportes o no); ponerlo después del gate; sacar el cupo del Resumen operativo; una página nueva
 * sin cupo y sin anotar; una página que llama a una consulta pesada y no está en la lista.
 */
const RAIZ = join(__dirname, "../..");
const arbol = (ruta: string) => ts.createSourceFile(ruta, readFileSync(join(RAIZ, ruta), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function llamadas(nodo: ts.Node, fuente: ts.SourceFile, nombre: string): ts.CallExpression[] {
  const salida: ts.CallExpression[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === nombre) salida.push(n);
    ts.forEachChild(n, visitar);
  };
  visitar(nodo);
  void fuente;
  return salida;
}

describe("S-28 — requerirSesion cuenta toda lectura", () => {
  const ruta = "src/server/actions/con-sesion.ts";
  const fuente = arbol(ruta);
  const requerirSesion = fuente.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === "requerirSesion");

  it("sanidad: encuentra la función", () => {
    expect(requerirSesion?.body).toBeDefined();
  });

  it("cuenta con `lecturaSinCupo(ctx.usuarioId, …)` después de obtener el contexto y antes de devolverlo", () => {
    const contexto = llamadas(requerirSesion!, fuente, "obtenerContextoUsuario");
    const cupo = llamadas(requerirSesion!, fuente, "lecturaSinCupo");
    expect(contexto, "resuelve al usuario").toHaveLength(1);
    expect(cupo, "cuenta la lectura una vez").toHaveLength(1);
    expect(cupo[0]!.arguments[0]?.getText(fuente), "por usuario").toBe("ctx.usuarioId");
    expect(cupo[0]!.pos, "después de resolver al usuario").toBeGreaterThan(contexto[0]!.pos);
    const retorno = requerirSesion!.body!.statements.find((s): s is ts.ReturnStatement => ts.isReturnStatement(s));
    expect(retorno, "devuelve el contexto").toBeDefined();
    expect(cupo[0]!.end, "antes de devolver el contexto").toBeLessThanOrEqual(retorno!.pos);
  });

  it("las guardas de lectura exportadas pasan por `requerirSesion` (directo o por `requerirSesionEnSucursal`)", () => {
    const exportadas = fuente.statements.filter((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && !!s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
    expect(exportadas.map((f) => f.name!.text).sort()).toEqual(["requerirVer", "requerirVerAlguna", "requerirVerAlgunaEnSucursal", "requerirVerDeEmpresa", "requerirVerEnSucursal"]);
    for (const f of exportadas) {
      const pasa = llamadas(f, fuente, "requerirSesion").length + llamadas(f, fuente, "requerirSesionEnSucursal").length;
      expect(pasa, `${f.name!.text} tiene que abrir con la sesión (y su cupo)`).toBe(1);
    }
  });
});

describe("S-28 — cada reporte pesado cuenta su pedido antes de consultar", () => {
  /**
   * Reporte → sus páginas y la consulta pesada a la que cada una le pide los datos. El Resumen operativo (`/reportes`) corre `obtenerResumenOperativo`, que llama a la MISMA
   * `obtenerReportePorPeriodo` que Período sobre un rango del usuario de hasta 366 días (I-3): cuenta en el cupo de "periodo", el de esa consulta.
   */
  const PAGINAS: Record<(typeof REPORTES_PESADOS)[number], Array<{ pagina: string; consulta: string }>> = {
    periodo: [
      { pagina: "src/app/(app)/reportes/periodo/page.tsx", consulta: "obtenerReportePorPeriodo" },
      { pagina: "src/app/(app)/reportes/page.tsx", consulta: "obtenerResumenOperativo" },
    ],
    "rendimiento-recetas": [{ pagina: "src/app/(app)/reportes/rendimiento-recetas/page.tsx", consulta: "calcularRendimientoRecetas" }],
    "resumen-consolidado": [{ pagina: "src/app/(app)/reportes/consolidado/page.tsx", consulta: "obtenerResumenConsolidado" }],
  };

  it("hay una página para cada reporte pesado y ninguna de más", () => {
    expect(Object.keys(PAGINAS).sort()).toEqual([...REPORTES_PESADOS].sort());
  });

  for (const [reporte, paginas] of Object.entries(PAGINAS)) {
    for (const { pagina, consulta } of paginas) {
      it(`${reporte} (${pagina}): \`reportePesadoSinCupo(ctx.usuarioId, "${reporte}", …)\` va antes de ${consulta}`, () => {
        const fuente = arbol(pagina);
        const cupos = llamadas(fuente, fuente, "reportePesadoSinCupo");
        expect(cupos, "una sola cuenta por página").toHaveLength(1);
        expect(cupos[0]!.arguments[0]?.getText(fuente)).toBe("ctx.usuarioId");
        expect(cupos[0]!.arguments[1]?.getText(fuente), "la clave del reporte, literal").toBe(JSON.stringify(reporte));
        const consultas = llamadas(fuente, fuente, consulta);
        expect(consultas, "la consulta pesada").toHaveLength(1);
        expect(cupos[0]!.end, "se cuenta ANTES de consultar").toBeLessThanOrEqual(consultas[0]!.pos);
      });
    }
  }

  it("los archivos de src que llaman a una consulta pesada son exactamente esas páginas (nadie más la corre sin pasar por el cupo)", () => {
    const pesadas = new Set(Object.values(PAGINAS).flatMap((ps) => ps.map((p) => p.consulta)));
    const llaman = archivosDe(join(RAIZ, "src"))
      .filter((ruta) => {
        const fuente = ts.createSourceFile(ruta, readFileSync(ruta, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        return [...pesadas].some((consulta) => llamadas(fuente, fuente, consulta).length > 0);
      })
      .map((ruta) => relative(RAIZ, ruta).split(sep).join("/"))
      .sort();
    const esperados = Object.values(PAGINAS)
      .flatMap((ps) => ps.map((p) => p.pagina))
      // `obtenerResumenOperativo` llama a `obtenerReportePorPeriodo` desde su propio archivo (la consulta del Resumen): es una consulta, no una puerta.
      .concat("src/server/consultas/reportes/resumen-operativo.ts")
      .sort();
    expect(llaman, "una consulta pesada nueva, o un llamador nuevo, cuenta su pedido en el cupo de reportes pesados ANTES de consultar (y se anota acá)").toEqual(esperados);
  });
});

/** Todos los .ts/.tsx bajo `dir`. */
function archivosDe(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = join(dir, e.name);
    return e.isDirectory() ? archivosDe(ruta) : /\.tsx?$/.test(e.name) ? [ruta] : [];
  });
}

describe("S-28 (I-3, B31) — toda página de servidor cuenta su pedido en el cupo general de lecturas", () => {
  const rutaRelativa = (ruta: string) => relative(RAIZ, ruta).split(sep).join("/");
  const paginas = archivosDe(join(RAIZ, "src/app"))
    .filter((ruta) => ruta.endsWith(`${sep}page.tsx`))
    .map((ruta) => ({ ruta: rutaRelativa(ruta), fuente: arbol(rutaRelativa(ruta)) }))
    .filter(({ fuente }) => llamadas(fuente, fuente, "obtenerContextoUsuario").length > 0);
  const esDeReportes = (ruta: string) => ruta.startsWith("src/app/(app)/reportes/");

  /**
   * Las páginas que resuelven al usuario y NO cuentan su pedido, cada una con su MOTIVO. B31 (T14) extendió el conteo a las 50 páginas que I-3 había dejado en una lista (administración, carta,
   * catálogo, movimientos, stock, traspasos, POS, inicio y la raíz), con las mismas dos líneas que las de reportes y sin ninguna consulta nueva; HOY NO QUEDA NINGUNA. La lista sigue acá, vacía,
   * para que una excepción futura sea una decisión a la vista y no un olvido: una página que no cuenta falla hasta que cuente o se anote acá con su motivo; una entrada de una página que
   * ya cuenta (o que ya no existe) también falla. Las páginas ANÓNIMAS (login, invitación, carta pública) no resuelven al usuario: las cubre `puertas-anonimas-con-cupo`.
   */
  const SIN_CUPO_DE_LECTURAS: Readonly<Record<string, string>> = {};

  it("sanidad: encuentra las páginas de reportes y las demás (no pasa en vacío)", () => {
    expect(paginas.filter((p) => esDeReportes(p.ruta)).length).toBeGreaterThanOrEqual(25);
    expect(paginas.filter((p) => !esDeReportes(p.ruta)).length).toBeGreaterThanOrEqual(40);
  });

  it("toda página cuenta `lecturaSinCupo(ctx.usuarioId, …)` justo después de resolver al usuario y antes de cualquier otra llamada (el gate lee la base)", () => {
    const problemas: string[] = [];
    for (const { ruta, fuente } of paginas.filter((p) => !(p.ruta in SIN_CUPO_DE_LECTURAS))) {
      const cupos = llamadas(fuente, fuente, "lecturaSinCupo");
      const contexto = llamadas(fuente, fuente, "obtenerContextoUsuario");
      if (cupos.length !== 1) {
        problemas.push(`${ruta}: tiene que contar el pedido una vez con lecturaSinCupo (cuenta ${cupos.length})`);
        continue;
      }
      if (cupos[0]!.arguments[0]?.getText(fuente) !== "ctx.usuarioId") problemas.push(`${ruta}: lecturaSinCupo cuenta por ctx.usuarioId`);
      if (cupos[0]!.pos < contexto[0]!.pos) problemas.push(`${ruta}: el cupo va DESPUÉS de resolver al usuario`);
      // Antes de cualquier otra llamada que lea la base: los gates (`requierePermiso*`, `sucursalesVisiblesPara`, `obtenerMiNivelPermiso`) y las consultas.
      const lecturas = ["requierePermisoVer", "requierePermisoVerDeEmpresa", "sucursalesVisiblesPara", "obtenerMiNivelPermiso", "obtenerMiNivelPermisoDeEmpresa", "pantallaDeInicio", "tarjetasDelUsuario"].flatMap((nombre) =>
        llamadas(fuente, fuente, nombre),
      );
      for (const lectura of lecturas) if (lectura.pos < cupos[0]!.pos) problemas.push(`${ruta}: el cupo va ANTES de ${lectura.expression.getText(fuente)} (que lee la base)`);
    }
    expect(problemas).toEqual([]);
  });

  it("las páginas sin cupo son exactamente las de SIN_CUPO_DE_LECTURAS (hoy ninguna), cada una con su motivo", () => {
    const sinCupo = paginas
      .filter((p) => llamadas(p.fuente, p.fuente, "lecturaSinCupo").length === 0)
      .map((p) => p.ruta)
      .sort();
    expect(sinCupo, "una página nueva cuenta su pedido con lecturaSinCupo o se anota en la lista con su motivo; una que ya cuenta sale de la lista").toEqual(Object.keys(SIN_CUPO_DE_LECTURAS).sort());
    for (const [ruta, motivo] of Object.entries(SIN_CUPO_DE_LECTURAS)) expect(motivo.length, ruta).toBeGreaterThan(40);
  });

  it("el cupo se cuenta en las 77 páginas (27 de reportes y 50 más), no solo en las de reportes", () => {
    const cuentan = paginas.filter((p) => llamadas(p.fuente, p.fuente, "lecturaSinCupo").length === 1);
    expect(cuentan.length).toBe(paginas.length);
    expect(paginas.length).toBeGreaterThanOrEqual(77);
  });
});
