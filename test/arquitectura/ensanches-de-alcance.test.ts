import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENSANCHES_DEL_ALCANCE, ensancheDespuesDelGate, ensanchesUsados, fuentesDe, funcionesDelArchivo, llamadasAEnsanches } from "./guardas/ensanches";

/**
 * ENSANCHES DEL ALCANCE POR SUCURSAL (M.3-A4; plan `plan-m3-rls-por-sucursal`). El contexto del usuario arranca con alcance = la sucursal activa; lo único que lo agranda son las cinco funciones
 * de `src/server/acceso/alcance.ts` y el ayudante `permisoYAlcanceEnSucursal` de `src/server/actions/con-permiso.ts`. Este guardián fija lo que ninguna de las dos mitades de GT-4 ve sola:
 *  1. el CATÁLOGO de ensanches es cerrado: `alcance.ts` exporta exactamente esas funciones (una nueva sin declarar acá falla, una que ya no existe también);
 *  2. los envoltorios de «Ver» en otra sucursal (`requerirVerEnSucursal`, `requerirVerAlgunaEnSucursal`, forma `SUCURSAL_CON_GATE`) ensanchan la LECTURA y solo DESPUÉS del gate de esa sucursal;
 *  3. `permisoYAlcanceEnSucursal` (forma `GATE_EN_ESA_SUCURSAL`) ensancha lectura y escritura solo si `requierePermiso` en ESA sucursal dio ok;
 *  4. `lecturaEnSucursalesVisibles` se llama siempre con la clave como texto literal (de ella sale qué sucursales se ven);
 *  5. ningún otro archivo de `src/` llama a `conAlcanceEnSucursal` / `permisoYAlcanceEnSucursal` sin estar declarado en su forma de GT-4 (esa dirección la verifica `ids-de-sucursal-declaran-a-que-se-atan.test.ts`)
 *     y ningún archivo llama a los ensanches de escritura de empresa entera sin estar declarado (`escrituras-en-sucursal-desde-empresa.test.ts`).
 * Mutaciones (rojo → revertido editando → verde): mover `conAlcanceEnSucursal` por encima de `exigirVer` en `requerirVerEnSucursal` (ensanche sin gate previo); cambiar `"LECTURA"` por
 * `"LECTURA_Y_ESCRITURA"` en un envoltorio de «Ver»; sacar el `if (!gate.ok)` de `permisoYAlcanceEnSucursal`; agregar una función exportada a `alcance.ts`. Y los casos sintéticos de abajo.
 */
const RAIZ = join(__dirname, "../..");
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");

/** Las funciones que exporta `alcance.ts` y que ensanchan (el tipo `ModoDeAlcance` no cuenta). */
function exportadasComoFunciones(codigo: string): string[] {
  return [...codigo.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]!).sort();
}

describe("ensanches del alcance por sucursal: el catálogo es cerrado", () => {
  it("alcance.ts exporta exactamente cuatro ensanches, y con el ayudante de con-permiso son los cinco del guardián", () => {
    expect(exportadasComoFunciones(leer("src/server/acceso/alcance.ts"))).toEqual(["conAlcanceEnSucursal", "conEscrituraEnLaEmpresa", "incluirSucursalCreadaEnLaTransaccion", "lecturaEnSucursalesVisibles"]);
    expect(exportadasComoFunciones(leer("src/server/actions/con-permiso.ts"))).toContain("permisoYAlcanceEnSucursal");
    expect([...ENSANCHES_DEL_ALCANCE].sort()).toEqual(["conAlcanceEnSucursal", "conEscrituraEnLaEmpresa", "incluirSucursalCreadaEnLaTransaccion", "lecturaEnSucursalesVisibles", "permisoYAlcanceEnSucursal"]);
  });

  it("no hay un valor «todas»: ninguna función de alcance.ts recibe ni arma una lista con comodín", () => {
    const codigo = leer("src/server/acceso/alcance.ts").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(codigo).not.toMatch(/["'`]\*["'`]|["'`]todas["'`]/i);
  });
});

describe("SUCURSAL_CON_GATE: los envoltorios de «Ver» en otra sucursal ensanchan la lectura, y solo después del gate", () => {
  const conSesion = leer("src/server/actions/con-sesion.ts");
  const ENVOLTORIOS: Array<[string, string]> = [
    ["requerirVerEnSucursal", "exigirVer"],
    ["requerirVerAlgunaEnSucursal", "exigirVerAlguna"],
  ];

  it.each(ENVOLTORIOS)("%s llama a conAlcanceEnSucursal(ctx, sucursalId, \"LECTURA\") DESPUÉS de %s", (funcion, gate) => {
    expect(ensancheDespuesDelGate(conSesion, funcion, "conAlcanceEnSucursal", [gate])).toBe(true);
    const propias = llamadasAEnsanches(conSesion).filter((l) => l.funcion === funcion);
    expect(propias.map((l) => [l.ensanche, ...l.argumentos])).toEqual([["conAlcanceEnSucursal", "ctx", "sucursalId", '"LECTURA"']]);
  });

  it("ninguna otra función de con-sesion.ts ensancha nada (las lecturas de la sucursal activa no tocan el alcance)", () => {
    const ajenas = llamadasAEnsanches(conSesion).filter((l) => !ENVOLTORIOS.some(([f]) => f === l.funcion));
    expect(ajenas).toEqual([]);
  });
});

describe("GATE_EN_ESA_SUCURSAL: permisoYAlcanceEnSucursal ensancha lectura y escritura solo si el permiso EN esa sucursal dio ok", () => {
  const conPermiso = leer("src/server/actions/con-permiso.ts");

  it("pide requierePermiso antes, devuelve el rechazo del gate sin ensanchar y ensancha en modo LECTURA_Y_ESCRITURA", () => {
    expect(ensancheDespuesDelGate(conPermiso, "permisoYAlcanceEnSucursal", "conAlcanceEnSucursal", ["requierePermiso"])).toBe(true);
    const texto = funcionesDelArchivo(conPermiso).get("permisoYAlcanceEnSucursal")!.getText();
    expect(texto).toMatch(/requierePermiso\(\s*ctx\.usuarioId\s*,\s*sucursalId\s*,\s*accionClave\s*,/);
    // el rechazo del gate sale ANTES de la línea que ensancha
    expect(texto.indexOf("if (!gate.ok)")).toBeGreaterThan(-1);
    expect(texto.indexOf("if (!gate.ok)")).toBeLessThan(texto.indexOf("conAlcanceEnSucursal("));
    const propias = llamadasAEnsanches(conPermiso).filter((l) => l.funcion === "permisoYAlcanceEnSucursal");
    expect(propias.map((l) => [l.ensanche, ...l.argumentos])).toEqual([["conAlcanceEnSucursal", "ctx", "sucursalId", '"LECTURA_Y_ESCRITURA"']]);
  });

  it("ninguna otra función de con-permiso.ts ensancha nada (las acciones de la sucursal activa y de empresa no tocan el alcance)", () => {
    expect(llamadasAEnsanches(conPermiso).filter((l) => l.funcion !== "permisoYAlcanceEnSucursal")).toEqual([]);
  });
});

describe("lecturaEnSucursalesVisibles: la clave va como texto literal", () => {
  it("toda llamada de src/ le pasa la clave como literal (de ella sale qué sucursales se ven)", () => {
    const problemas: string[] = [];
    for (const [ruta, codigo] of fuentesDe(RAIZ, "src")) {
      if (ruta === "src/server/acceso/alcance.ts") continue;
      for (const l of llamadasAEnsanches(codigo, ["lecturaEnSucursalesVisibles"])) {
        if (!/^["'`][a-z_]+["'`]$/.test(l.argumentos[1] ?? "")) problemas.push(`${ruta}: lecturaEnSucursalesVisibles(${l.argumentos.join(", ")}) no lleva la clave como texto literal`);
      }
    }
    expect(problemas).toEqual([]);
  });
});

describe("ningún ensanche se esconde detrás de un alias ni de un reexport", () => {
  it("todo archivo que importa un ensanche lo llama con su nombre (sin `as`, sin `export { … } from`, sin `import * as alcance`)", () => {
    const problemas: string[] = [];
    for (const [ruta, codigo] of fuentesDe(RAIZ, "src")) {
      if (ruta === "src/server/acceso/alcance.ts") continue;
      const llamados = new Set(llamadasAEnsanches(codigo).map((l) => l.ensanche as string));
      for (const usado of ensanchesUsados(codigo)) if (!llamados.has(usado)) problemas.push(`${ruta}: trae \`${usado}\` sin llamarlo con ese nombre (alias, reexport o import de espacio de nombres): los guardianes de GT-4 solo ven las llamadas directas`);
    }
    expect(problemas).toEqual([]);
  });

  it("el detector ve el alias, el reexport y el import de espacio de nombres (caso sintético)", () => {
    expect(ensanchesUsados('import { conEscrituraEnLaEmpresa as zz } from "@/server/acceso/alcance";\nexport const f = (c) => zz(c);')).toEqual(["conEscrituraEnLaEmpresa"]);
    expect(ensanchesUsados('export { conAlcanceEnSucursal } from "@/server/acceso/alcance";')).toEqual(["conAlcanceEnSucursal"]);
    expect(ensanchesUsados('import * as alcance from "@/server/acceso/alcance";\nexport const f = (c) => alcance.conEscrituraEnLaEmpresa(c);')).toEqual(["alcance(*)"]);
    expect(ensanchesUsados('import { gate } from "@/server/acceso/gate";')).toEqual([]);
  });
});

describe("el guardián en sí (casos sintéticos)", () => {
  const ENVOLTORIO = (cuerpo: string) => `export async function requerirVerEnSucursal(sucursalId: string, accion: string) {\n${cuerpo}\n}\n`;

  it("el ensanche DESPUÉS del gate pasa; antes del gate (la mutación), sin gate o sin ensanche, falla", () => {
    const bien = ENVOLTORIO('const ctx = await requerirSesionEnSucursal(sucursalId);\nawait exigirVer(ctx, sucursalId, accion);\nreturn conAlcanceEnSucursal(ctx, sucursalId, "LECTURA");');
    const antes = ENVOLTORIO('const ctx = await requerirSesionEnSucursal(sucursalId);\nconst ampliado = conAlcanceEnSucursal(ctx, sucursalId, "LECTURA");\nawait exigirVer(ctx, sucursalId, accion);\nreturn ampliado;');
    const sinGate = ENVOLTORIO('const ctx = await requerirSesionEnSucursal(sucursalId);\nreturn conAlcanceEnSucursal(ctx, sucursalId, "LECTURA");');
    const sinEnsanche = ENVOLTORIO("const ctx = await requerirSesionEnSucursal(sucursalId);\nawait exigirVer(ctx, sucursalId, accion);\nreturn ctx;");
    expect(ensancheDespuesDelGate(bien, "requerirVerEnSucursal", "conAlcanceEnSucursal", ["exigirVer"])).toBe(true);
    expect(ensancheDespuesDelGate(antes, "requerirVerEnSucursal", "conAlcanceEnSucursal", ["exigirVer"])).toBe(false);
    expect(ensancheDespuesDelGate(sinGate, "requerirVerEnSucursal", "conAlcanceEnSucursal", ["exigirVer"])).toBe(false);
    expect(ensancheDespuesDelGate(sinEnsanche, "requerirVerEnSucursal", "conAlcanceEnSucursal", ["exigirVer"])).toBe(false);
    expect(ensancheDespuesDelGate(bien, "otraFuncion", "conAlcanceEnSucursal", ["exigirVer"])).toBe(false);
  });

  it("encuentra las llamadas con su función, argumentos y sentencia; ignora comentarios y cadenas", () => {
    const codigo = `// conEscrituraEnLaEmpresa(ctx)\nconst nota = "conEscrituraEnLaEmpresa(ctx)";\nexport async function f(ctx) {\n  const a = 1;\n  const b = await conEscrituraEnLaEmpresa(ctx);\n  return b;\n}\nexport const g = async (tx) => {\n  await incluirSucursalCreadaEnLaTransaccion(tx, id);\n};\n`;
    expect(llamadasAEnsanches(codigo)).toEqual([
      { ensanche: "conEscrituraEnLaEmpresa", funcion: "f", argumentos: ["ctx"], sentencia: 1 },
      { ensanche: "incluirSucursalCreadaEnLaTransaccion", funcion: "g", argumentos: ["tx", "id"], sentencia: 0 },
    ]);
  });
});
