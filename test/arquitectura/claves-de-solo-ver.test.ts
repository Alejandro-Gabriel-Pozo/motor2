import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCIONES, esAccionReservada, esAccionSoloVer } from "../../src/core/permisos/acciones";
import { clavesUsadas, inventariarDirectorio } from "./guardas/inventario";

/**
 * Guardián de la poda de la matriz de permisos (dueño, 2026-11-06): la casilla «Editar» se oculta en las claves de SOLO VER, y esa decisión vive en UNA marca del catálogo (`soloVer`).
 *
 * - Toda clave que PARECE de solo ver (`reporte_*`, `ver_*`, `*_ver`, `*_ver_*`) tiene que declarar si lleva «Editar»: o está marcada `soloVer`, o figura acá en `CON_EDITAR_O_A_DECIDIR` con el motivo.
 *   Una clave nueva de ese estilo sin declarar rompe este test.
 * - Ninguna clave `soloVer` se comprueba con una guarda de EDITAR (`conPermiso`, `requierePermiso`, …) ni se lee su `editar` desde `obtenerMiNivelPermiso*`: si alguien la usa para
 *   editar, la marca miente y hay que quitarla.
 * - `reservada` y «sin consumidores» son lo mismo: una clave reservada no tiene ninguna guarda; una sin guardas tiene que estar marcada.
 */
const SRC = join(__dirname, "../../src");

const PARECE_DE_SOLO_VER = /^reporte_|^ver_|_ver$|_ver_/;

/** Claves que parecen de solo ver pero NO se marcan (todavía): `a decidir` = el dueño no resolvió si llevan «Editar». Cada una con su evidencia (auditoría de parámetros, 2026-11-06). */
const CON_EDITAR_O_A_DECIDIR: Readonly<Record<string, string>> = {
  ver_stock: "A DECIDIR: solo se consulta con `requierePermisoVer` en las 3 pantallas de /stock; ningún caso de uso comprueba «Editar». Candidata a `soloVer`; la semilla le da Editar al operador.",
  carta_ver: "A DECIDIR: se consulta con `requierePermisoVer`/`obtenerMiNivelPermiso(...).ver`; ningún caso de uso comprueba su «Editar». Candidata a `soloVer`.",
  traspaso_ver_bandeja: "A DECIDIR: solo `requierePermisoVer`/`requerirVerEnSucursal`; ningún caso de uso comprueba su «Editar». Candidata a `soloVer`.",
  producto_ver_catalogo: "A DECIDIR: solo `requierePermisoVerDeEmpresa`/`requerirVerAlguna`/`obtenerMiNivelPermisoDeEmpresa(...)` como ficha de lectura. Candidata a `soloVer`.",
  ver_auditoria: "A DECIDIR: solo `requierePermisoVer` y `sucursalesDondeElUsuarioPuedeVer`. Candidata a `soloVer`.",
  ver_auditoria_empresa: "A DECIDIR: solo `obtenerMiNivelPermisoDeEmpresa(...).ver` (piso gerente, sin matriz). Candidata a `soloVer`.",
};

/** Guardas que exigen «Editar» (las que devuelven los dos niveles, `obtenerMiNivelPermiso*`, se miran aparte por la línea). */
const GUARDAS_DE_EDITAR = new Set(["conPermiso", "conPermisoDeEmpresa", "conEdicionDePermisos", "requierePermiso", "requierePermisoDeEmpresa"]);

const claves = ACCIONES.map((a) => a.clave as string);

describe("claves de solo ver: la casilla «Editar» se oculta por UNA marca del catálogo", () => {
  it("toda clave que parece de solo ver está marcada `soloVer` o declarada en CON_EDITAR_O_A_DECIDIR", () => {
    const sinDeclarar = claves.filter((c) => PARECE_DE_SOLO_VER.test(c) && !esAccionSoloVer(c) && !(c in CON_EDITAR_O_A_DECIDIR));
    expect(sinDeclarar, `Claves que parecen de solo ver y no declaran si llevan «Editar» (marcalas \`soloVer: true\` en acciones.ts o declaralas en CON_EDITAR_O_A_DECIDIR):\n${sinDeclarar.join("\n")}`).toEqual([]);
  });

  it("CON_EDITAR_O_A_DECIDIR no tiene sobrantes: cada una existe, no está marcada y todavía parece de solo ver", () => {
    const sobrantes = Object.keys(CON_EDITAR_O_A_DECIDIR).filter((c) => !claves.includes(c) || esAccionSoloVer(c) || !PARECE_DE_SOLO_VER.test(c));
    expect(sobrantes, `Sacalas de CON_EDITAR_O_A_DECIDIR:\n${sobrantes.join("\n")}`).toEqual([]);
  });

  it("los 27 reportes (`reporte_*`) están todos marcados `soloVer`", () => {
    const reportes = claves.filter((c) => c.startsWith("reporte_"));
    expect(reportes.length).toBe(27);
    expect(reportes.filter((c) => !esAccionSoloVer(c))).toEqual([]);
  });

  it("ninguna clave `soloVer` se usa con una guarda de EDITAR", () => {
    const usos = inventariarDirectorio(SRC).usos.filter((u) => esAccionSoloVer(u.clave) && GUARDAS_DE_EDITAR.has(u.funcion));
    expect(usos.map((u) => `${u.clave} · ${u.funcion} · ${u.archivo}:${u.linea}`), "La marca `soloVer` miente: esa clave sí se edita").toEqual([]);
  });

  it("ninguna lectura de nivel (`obtenerMiNivelPermiso*`) de una clave `soloVer` usa su `editar` en la misma línea", () => {
    const sospechosos = inventariarDirectorio(SRC)
      .usos.filter((u) => esAccionSoloVer(u.clave) && u.funcion.startsWith("obtenerMiNivelPermiso"))
      .filter((u) => /\beditar\b/.test(readFileSync(join(SRC, u.archivo), "utf8").split("\n")[u.linea - 1] ?? ""));
    expect(sospechosos.map((u) => `${u.clave} · ${u.archivo}:${u.linea}`)).toEqual([]);
  });

  it("las claves RESERVADAS son exactamente las que ninguna guarda usa (marca y realidad coinciden)", () => {
    const usadas = clavesUsadas(inventariarDirectorio(SRC));
    const reservadas = claves.filter(esAccionReservada);
    expect(reservadas).toEqual(["compra_recibir"]);
    expect(reservadas.filter((c) => usadas.has(c)), "Ya tiene consumidor: quitale `reservada: true`").toEqual([]);
  });
});
