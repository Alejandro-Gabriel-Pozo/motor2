import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analizarFuente, delegadosDeModelos, llamadasALaBase, type SenalesDeFuente } from "../../scripts/arquitectura/analizar-fuente";

/**
 * `src/server/auditoria/` es una lista CERRADA de archivos (Hito 5, pieza 5.4, B5 de `docs/plan-hito-5-pureza.md`; la capa del ESCRITOR de la auditoría, `registrarCambioAuditado`, que salió
 * de `core/permisos/auditoria.ts` en B3). La auditoría es sensible —quién cambió qué y cuándo— y su único punto de escritura no puede crecer sin que alguien lo decida. Cuatro reglas:
 *  1. son exactamente los archivos de `PERMITIDOS`;
 *  2. NINGUNO abre con `import "server-only"`, y está dicho por qué: los cargan scripts que corren con `tsx` fuera de Next (`scripts/modulos-empresa.ts` y `scripts/politica-empresa.ts`,
 *     vía las operaciones de plataforma), donde ese paquete tira al importarse; ponerlo obligaría a correr esos scripts con `--conditions=react-server` y a editar `package.json`. El
 *     motivo vive en la cabecera del archivo (se exige que la mencione) y la decisión es «Permanente» en `escrituras-fuera-de-persistencia.ts`;
 *  3. no leen el reloj, el azar, el entorno, la red ni el disco: la fecha de una fila la pone la base (`creadoEn`), la hora que importa viaja en la descripción que arma el caso de uso;
 *  4. lo único que escriben en la base es `registroAuditoria.create` (una fila por cambio; la tabla solo agrega, ver `kardex-solo-agrega.test.ts`).
 * Lo que la capa no puede importar y quién no puede importarla lo fija la regla `auditoria-capa` de `.dependency-cruiser.cjs` (dos entradas; `dependencias.test.ts` las exige).
 */
const RAIZ = join(__dirname, "../..");
const CARPETA = join(RAIZ, "src/server/auditoria");
const PERMITIDOS = ["registrar-cambio-auditado.ts"];
const ESCRITURAS_ESPERADAS = ["registroAuditoria.create"];
const IMPUREZAS: Array<keyof Pick<SenalesDeFuente, "reloj" | "azar" | "entorno" | "red" | "disco">> = ["reloj", "azar", "entorno", "red", "disco"];

/** Las impurezas que el fuente tiene (el escritor de la auditoría no puede tener ninguna). */
function impurezasDe(senales: Pick<SenalesDeFuente, "reloj" | "azar" | "entorno" | "red" | "disco">): string[] {
  return IMPUREZAS.filter((i) => senales[i]);
}

/** ¿Abre con `import "server-only"`? */
const abreConServerOnly = (codigo: string) => /^import "server-only";/m.test(codigo);

/** ¿La cabecera explica por qué NO lleva `server-only`? (menciona el paquete, los scripts de `tsx` y el motivo). */
const explicaLaFaltaDeServerOnly = (codigo: string) => /SIN `import "server-only"` a propósito/.test(codigo) && /tsx/.test(codigo) && /scripts\/modulos-empresa\.ts/.test(codigo);

const archivos = readdirSync(CARPETA).filter((f) => /\.tsx?$/.test(f)).sort();
const delegados = delegadosDeModelos(readFileSync(join(RAIZ, "prisma", "schema.prisma"), "utf8"));
const leer = (f: string) => readFileSync(join(CARPETA, f), "utf8");

describe("server/auditoria: lista cerrada, sin server-only (con motivo), sin impurezas y una sola escritura", () => {
  it("son exactamente los archivos permitidos (ni uno más, ni uno menos)", () => {
    expect(archivos).toEqual([...PERMITIDOS].sort());
  });

  it('ninguno abre con import "server-only", y la cabecera dice por qué (lo cargan scripts por tsx)', () => {
    const conMarca = archivos.filter((f) => abreConServerOnly(leer(f)));
    expect(conMarca, "un import \"server-only\" rompe scripts/modulos-empresa.ts y politica-empresa.ts (tsx sin la condición react-server)").toEqual([]);
    const sinMotivo = archivos.filter((f) => !explicaLaFaltaDeServerOnly(leer(f)));
    expect(sinMotivo, "la cabecera tiene que explicar por qué no lleva server-only").toEqual([]);
  });

  it("no leen el reloj, el azar, el entorno, la red ni el disco", () => {
    const problemas = archivos.flatMap((f) => impurezasDe(analizarFuente(leer(f), `src/server/auditoria/${f}`, delegados)).map((i) => `${f}: lee ${i}`));
    expect(problemas, "el escritor de la auditoría recibe todo por parámetro").toEqual([]);
  });

  it("lo único que escriben en la base es registroAuditoria.create", () => {
    const escrituras = archivos.flatMap((f) =>
      llamadasALaBase(leer(f), `src/server/auditoria/${f}`, delegados)
        .filter((l) => l.clase === "escritura" && l.nombre !== "$transaction")
        .map((l) => l.nombre)
    );
    expect(escrituras.sort()).toEqual(ESCRITURAS_ESPERADAS);
  });

  it("los detectores ven lo que dicen ver (fuentes sintéticas)", () => {
    expect(abreConServerOnly('import "server-only";\nexport const x = 1;')).toBe(true);
    expect(abreConServerOnly('// import "server-only";\nexport const x = 1;')).toBe(false);
    expect(explicaLaFaltaDeServerOnly("/** SIN `import \"server-only\"` a propósito: lo cargan scripts con tsx (scripts/modulos-empresa.ts) */")).toBe(true);
    expect(explicaLaFaltaDeServerOnly("export const x = 1;")).toBe(false);
    const sin = { reloj: false, azar: false, entorno: false, red: false, disco: false };
    expect(impurezasDe({ ...sin, reloj: true, entorno: true })).toEqual(["reloj", "entorno"]);
    const conReloj = analizarFuente("export const f = () => new Date();", "x.ts", delegados);
    const conAzar = analizarFuente("export const g = () => Math.random();", "x.ts", delegados);
    const conEntorno = analizarFuente("export const h = () => process.env.X;", "x.ts", delegados);
    expect([conReloj.reloj, conAzar.azar, conEntorno.entorno]).toEqual([true, true, true]);
    const escrituras = llamadasALaBase("export const f = (db: any) => db.registroAuditoria.create({}) && db.operacion.update({}) && db.registroAuditoria.findMany({});", "x.ts", delegados)
      .filter((l) => l.clase === "escritura")
      .map((l) => l.nombre);
    expect(escrituras.sort()).toEqual(["operacion.update", "registroAuditoria.create"]);
  });
});
