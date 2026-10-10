import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALCANCE_DE_TABLAS,
  CLASIFICACION_DE_TABLAS,
  TABLAS_CON_POLITICA_DE_SUCURSAL,
  tablasConAlcance,
  type DeclaracionDeAlcance,
} from "../setup/clasificacion-de-tablas";

/**
 * Guardián de la SEGUNDA dimensión de la clasificación de tablas: el ALCANCE POR SUCURSAL (M.3, Fase A, paso A1). Sin base de datos: cruza `ALCANCE_DE_TABLAS`
 * (`test/setup/clasificacion-de-tablas.ts`) con los modelos de `prisma/schema.prisma` y con la primera dimensión (de qué empresa es cada tabla).
 *
 * Por qué existe: la RLS por sucursal (Fase B) se DERIVA de esta declaración (`test/setup/politicas-de-alcance-de-sucursal.ts`). Una tabla que lleva `sucursalId` y quedó
 * declarada «de la empresa entera» sería una tabla sin política: otra sucursal podría leerla y escribirla. Por eso este test falla (a propósito) ante cualquier tabla nueva, cualquier
 * columna de sucursal nueva y cualquier padre que ya no exista, hasta que alguien decida el alcance de esa tabla.
 *
 * La lógica vive en `violaciones(...)`, una función pura sobre el TEXTO del esquema: el test la corre contra el esquema real (tiene que dar vacío) y contra esquemas y declaraciones
 * MUTADOS a propósito (tienen que dar rojo). Así la mutación queda demostrada en el código y no solo en la bitácora.
 */
const ESQUEMA = readFileSync(join(__dirname, "../../prisma/schema.prisma"), "utf8");

interface Columna {
  tipo: string;
  opcional: boolean;
  lista: boolean;
}
interface Relacion {
  destino: string;
  columnas: string[];
}
interface Modelo {
  nombre: string;
  columnas: Map<string, Columna>;
  relaciones: Relacion[];
}

function leerModelos(esquema: string): Modelo[] {
  return [...esquema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map(([, nombre, cuerpo]) => {
    const columnas = new Map<string, Columna>();
    const relaciones: Relacion[] = [];
    for (const linea of cuerpo.split(/\r?\n/)) {
      const campo = /^\s+(\w+)\s+(\w+)(\?|\[\])?/.exec(linea);
      if (!campo || linea.trim().startsWith("//") || linea.trim().startsWith("@@")) continue;
      columnas.set(campo[1], { tipo: campo[2], opcional: campo[3] === "?", lista: campo[3] === "[]" });
      const relacion = /@relation\((?:"[^"]*",\s*)?fields:\s*\[([^\]]*)\]/.exec(linea);
      if (relacion) relaciones.push({ destino: campo[2], columnas: relacion[1].split(",").map((c) => c.trim()) });
    }
    return { nombre, columnas, relaciones };
  });
}

const CON_ALCANCE_DE_SUCURSAL = ["PROPIA", "PROPIA_O_EMPRESA", "HEREDADA", "ENTRE_SUCURSALES"] as const;
const PUEDE_SER_PADRE = ["PROPIA", "PROPIA_O_EMPRESA", "HEREDADA"] as const;
const SIN_EMPRESA_EN_LA_PRIMERA_DIMENSION = ["GLOBAL", "EMPRESA", "CONSOLA"];

/** Todo lo que está mal entre `alcance` y el esquema (vacío = coherente). Cada mensaje nombra la tabla y la regla. */
function violaciones(
  esquema: string,
  alcance: Readonly<Record<string, DeclaracionDeAlcance>>,
  primeraDimension: Readonly<Record<string, string>> = CLASIFICACION_DE_TABLAS,
): string[] {
  const modelos = leerModelos(esquema);
  const porNombre = new Map(modelos.map((m) => [m.nombre, m]));
  const mensajes: string[] = [];
  const mal = (tabla: string, regla: string) => mensajes.push(`${tabla}: ${regla}`);
  const tieneFkASucursal = (m: Modelo, columna: string) => m.relaciones.some((r) => r.destino === "Sucursal" && r.columnas.includes(columna));
  const alcanceDe = (tabla: string) => alcance[tabla]?.alcance;

  // R1: toda tabla del esquema tiene alcance y toda declaración es de una tabla que existe.
  for (const m of modelos) if (!alcance[m.nombre]) mal(m.nombre, "el modelo no tiene alcance por sucursal declarado");
  for (const tabla of Object.keys(alcance)) if (!porNombre.has(tabla)) mal(tabla, "tiene alcance declarado pero no es un modelo del esquema");

  for (const m of modelos) {
    const d = alcance[m.nombre];
    if (!d) continue;
    const conEmpresaId = m.columnas.has("empresaId");

    // R2: «sin empresa» coincide con la primera dimensión (global, empresa, consola) y con la ausencia de `empresaId`.
    const sinEmpresaPorClase = SIN_EMPRESA_EN_LA_PRIMERA_DIMENSION.includes(primeraDimension[m.nombre] ?? "");
    if (d.alcance === "SIN_EMPRESA" && !sinEmpresaPorClase) mal(m.nombre, "es SIN_EMPRESA pero la clasificación por empresa la declara con empresa");
    if (d.alcance !== "SIN_EMPRESA" && sinEmpresaPorClase) mal(m.nombre, `la clasificación por empresa la declara sin empresa y acá figura como ${d.alcance}`);
    if (d.alcance === "SIN_EMPRESA" && conEmpresaId) mal(m.nombre, "es SIN_EMPRESA pero el modelo lleva `empresaId`");
    if (d.alcance !== "SIN_EMPRESA" && !conEmpresaId) mal(m.nombre, `figura como ${d.alcance} pero el modelo no lleva \`empresaId\``);

    // R3: `sucursalId` obligatorio ⇒ PROPIA o GOBIERNO; opcional ⇒ PROPIA_O_EMPRESA o GOBIERNO.
    const sucursalId = m.columnas.get("sucursalId");
    if (sucursalId && !sucursalId.opcional && d.alcance !== "PROPIA" && d.alcance !== "GOBIERNO") mal(m.nombre, `lleva \`sucursalId\` NOT NULL y figura como ${d.alcance} (tiene que ser PROPIA o GOBIERNO con motivo)`);
    if (sucursalId?.opcional && d.alcance !== "PROPIA_O_EMPRESA" && d.alcance !== "GOBIERNO") mal(m.nombre, `lleva \`sucursalId\` NULLABLE y figura como ${d.alcance} (tiene que ser PROPIA_O_EMPRESA o GOBIERNO con motivo)`);
    if (d.alcance === "PROPIA" && !(sucursalId && !sucursalId.opcional && tieneFkASucursal(m, "sucursalId"))) mal(m.nombre, "PROPIA exige `sucursalId` NOT NULL con FK a Sucursal");
    if (d.alcance === "PROPIA_O_EMPRESA" && !(sucursalId?.opcional && tieneFkASucursal(m, "sucursalId"))) mal(m.nombre, "PROPIA_O_EMPRESA exige `sucursalId` NULLABLE con FK a Sucursal");

    // R4: cualquier FK a Sucursal (`origenSucursalId`, etc.) vuelve a la tabla «de sucursal»: no puede quedar como HEREDADA ni de la empresa entera.
    if (m.nombre !== "Sucursal" && m.relaciones.some((r) => r.destino === "Sucursal") && !["PROPIA", "PROPIA_O_EMPRESA", "ENTRE_SUCURSALES", "GOBIERNO"].includes(d.alcance)) {
      mal(m.nombre, `tiene una FK a Sucursal y figura como ${d.alcance}`);
    }

    // R5: HEREDADA — el padre existe como FK obligatoria, es una tabla con alcance por sucursal y la cadena termina.
    if (d.alcance === "HEREDADA") {
      if (!porNombre.has(d.padre)) mal(m.nombre, `HEREDADA de ${d.padre}, que no es un modelo del esquema`);
      const columna = m.columnas.get(d.columna);
      if (!columna) mal(m.nombre, `HEREDADA por la columna \`${d.columna}\`, que no existe`);
      else if (columna.opcional) mal(m.nombre, `HEREDADA por \`${d.columna}\`, que es opcional: una fila sin padre quedaría invisible e inescribible`);
      if (!m.relaciones.some((r) => r.destino === d.padre && r.columnas.includes(d.columna))) mal(m.nombre, `no hay FK de \`${d.columna}\` hacia ${d.padre} en el esquema`);
      const alcancePadre = alcanceDe(d.padre);
      if (!alcancePadre || !(PUEDE_SER_PADRE as readonly string[]).includes(alcancePadre)) mal(m.nombre, `su padre ${d.padre} figura como ${alcancePadre ?? "sin declarar"}: un padre tiene que ser PROPIA, PROPIA_O_EMPRESA o HEREDADA`);
      let actual: string | undefined = d.padre;
      for (let paso = 0; actual && paso < 8; paso++) {
        const declaracion: DeclaracionDeAlcance | undefined = alcance[actual];
        actual = declaracion?.alcance === "HEREDADA" ? declaracion.padre : undefined;
        if (actual === m.nombre) mal(m.nombre, "la cadena de padres da una vuelta (ciclo)");
      }
    }

    // R6: ENTRE_SUCURSALES — las dos puntas son columnas obligatorias con FK a Sucursal.
    if (d.alcance === "ENTRE_SUCURSALES") {
      for (const c of [d.columnaOrigen, d.columnaDestino]) {
        const columna = m.columnas.get(c);
        if (!columna || columna.opcional || !tieneFkASucursal(m, c)) mal(m.nombre, `ENTRE_SUCURSALES exige \`${c}\` NOT NULL con FK a Sucursal`);
      }
      if (d.columnaOrigen === d.columnaDestino) mal(m.nombre, "ENTRE_SUCURSALES con la misma columna de origen y de destino");
    }

    // R7: GOBIERNO es una excepción a la regla: lleva su motivo escrito.
    if (d.alcance === "GOBIERNO" && d.motivo.trim().length < 20) mal(m.nombre, "GOBIERNO sin motivo (al menos una frase): es una excepción a la RLS por sucursal y tiene que justificarse");

    // R8: una tabla de la empresa entera que apunta por FK a una tabla con alcance de sucursal casi seguro es una HEREDADA que nadie declaró.
    if (d.alcance === "DE_EMPRESA") {
      for (const r of m.relaciones) {
        const destino = alcanceDe(r.destino);
        if (destino && (CON_ALCANCE_DE_SUCURSAL as readonly string[]).includes(destino)) mal(m.nombre, `figura DE_EMPRESA pero tiene una FK a ${r.destino} (${destino}): ¿es HEREDADA?`);
      }
    }
  }
  return mensajes;
}

describe("el alcance por sucursal declarado coincide con el esquema de Prisma", () => {
  it("el esquema real y la declaración no tienen ninguna violación", () => {
    expect(leerModelos(ESQUEMA).length, "se leyeron los modelos del esquema").toBeGreaterThan(60);
    expect(violaciones(ESQUEMA, ALCANCE_DE_TABLAS)).toEqual([]);
  });

  it("toda tabla del esquema tiene alcance, y las tablas sin empresa son exactamente las globales, `Empresa` y la consola de la primera dimensión", () => {
    expect(Object.keys(ALCANCE_DE_TABLAS).sort()).toEqual(leerModelos(ESQUEMA).map((m) => m.nombre).sort());
    const sinEmpresaPorClase = Object.entries(CLASIFICACION_DE_TABLAS)
      .filter(([, clase]) => SIN_EMPRESA_EN_LA_PRIMERA_DIMENSION.includes(clase))
      .map(([tabla]) => tabla)
      .sort();
    expect(tablasConAlcance("SIN_EMPRESA")).toEqual(sinEmpresaPorClase);
  });

  it("las tablas con política de sucursal son las de las cuatro formas con alcance, sin repetidas, y ninguna es de gobierno, de la empresa ni sin empresa", () => {
    const esperadas = CON_ALCANCE_DE_SUCURSAL.flatMap((a) => tablasConAlcance(a)).sort();
    expect([...TABLAS_CON_POLITICA_DE_SUCURSAL].sort()).toEqual(esperadas);
    expect(new Set(esperadas).size).toBe(esperadas.length);
    for (const t of TABLAS_CON_POLITICA_DE_SUCURSAL) expect(["GOBIERNO", "DE_EMPRESA", "SIN_EMPRESA"], t).not.toContain(ALCANCE_DE_TABLAS[t]?.alcance);
  });

  it("toda tabla con `sucursalId` NOT NULL es PROPIA o GOBIERNO (y GOBIERNO con motivo)", () => {
    const conSucursalId = leerModelos(ESQUEMA).filter((m) => m.columnas.get("sucursalId") && !m.columnas.get("sucursalId")!.opcional);
    expect(conSucursalId.length, "se leyeron las tablas con sucursalId").toBeGreaterThan(15);
    for (const m of conSucursalId) {
      const d = ALCANCE_DE_TABLAS[m.nombre]!;
      expect(["PROPIA", "GOBIERNO"], m.nombre).toContain(d.alcance);
      if (d.alcance === "GOBIERNO") expect(d.motivo.length, `${m.nombre}: motivo`).toBeGreaterThanOrEqual(20);
    }
  });

  it("el padre de cada HEREDADA existe como FK obligatoria en el esquema", () => {
    const heredadas = tablasConAlcance("HEREDADA");
    expect(heredadas.length).toBeGreaterThan(5);
    const modelos = new Map(leerModelos(ESQUEMA).map((m) => [m.nombre, m]));
    for (const tabla of heredadas) {
      const d = ALCANCE_DE_TABLAS[tabla]!;
      if (d.alcance !== "HEREDADA") throw new Error("tablasConAlcance devolvió una tabla de otro alcance");
      const m = modelos.get(tabla)!;
      expect(m.relaciones.some((r) => r.destino === d.padre && r.columnas.includes(d.columna)), `${tabla} -> ${d.padre} por ${d.columna}`).toBe(true);
      expect(m.columnas.get(d.columna)?.opcional, `${tabla}.${d.columna}`).toBe(false);
    }
  });
});

describe("mutaciones: el guardián se pone en rojo ante cada cambio que la RLS por sucursal no vería", () => {
  it("agregar `sucursalId` a un modelo de la empresa entera (Producto) da rojo", () => {
    const mutado = ESQUEMA.replace(/^(model Producto \{\r?\n)/m, "$1  sucursalId String\n");
    expect(mutado).not.toBe(ESQUEMA);
    expect(violaciones(mutado, ALCANCE_DE_TABLAS)).toEqual([expect.stringContaining("Producto: lleva `sucursalId` NOT NULL y figura como DE_EMPRESA")]);
  });

  it("un modelo sintético nuevo (con y sin `sucursalId`) da rojo hasta que se le declare el alcance", () => {
    const sintetico = `${ESQUEMA}\nmodel TablaSintetica {\n  id String @id\n  empresaId String\n  sucursalId String\n}\n`;
    expect(violaciones(sintetico, ALCANCE_DE_TABLAS)).toContain("TablaSintetica: el modelo no tiene alcance por sucursal declarado");
    const declarada = { ...ALCANCE_DE_TABLAS, TablaSintetica: { alcance: "DE_EMPRESA" } as const };
    expect(violaciones(sintetico, declarada).join("\n")).toContain("TablaSintetica: lleva `sucursalId` NOT NULL y figura como DE_EMPRESA");
  });

  it("quitar una tabla de la declaración da rojo, y declarar una tabla que no existe también", () => {
    const sinMesa = Object.fromEntries(Object.entries(ALCANCE_DE_TABLAS).filter(([tabla]) => tabla !== "Mesa"));
    expect(violaciones(ESQUEMA, sinMesa)).toContain("Mesa: el modelo no tiene alcance por sucursal declarado");
    expect(violaciones(ESQUEMA, { ...ALCANCE_DE_TABLAS, Fantasma: { alcance: "DE_EMPRESA" } })).toEqual(["Fantasma: tiene alcance declarado pero no es un modelo del esquema"]);
  });

  it("declarar PROPIA a una tabla que no tiene `sucursalId`, o sacarle el alcance de sucursal a una que lo tiene, da rojo", () => {
    expect(violaciones(ESQUEMA, { ...ALCANCE_DE_TABLAS, Producto: { alcance: "PROPIA" } }).join("\n")).toContain("Producto: PROPIA exige `sucursalId` NOT NULL con FK a Sucursal");
    expect(violaciones(ESQUEMA, { ...ALCANCE_DE_TABLAS, Mesa: { alcance: "DE_EMPRESA" } }).join("\n")).toContain("Mesa: lleva `sucursalId` NOT NULL y figura como DE_EMPRESA");
    expect(violaciones(ESQUEMA, { ...ALCANCE_DE_TABLAS, RegistroAuditoria: { alcance: "PROPIA" } }).join("\n")).toContain("RegistroAuditoria: lleva `sucursalId` NULLABLE y figura como PROPIA");
  });

  it("una HEREDADA con un padre sin FK, con la columna equivocada, con un padre de la empresa entera o con un ciclo da rojo", () => {
    const heredada = (padre: string, columna: string): DeclaracionDeAlcance => ({ alcance: "HEREDADA", padre, columna });
    expect(violaciones(ESQUEMA, { ...ALCANCE_DE_TABLAS, Cuenta: heredada("Operacion", "mesaId") }).join("\n")).toContain("Cuenta: no hay FK de `mesaId` hacia Operacion en el esquema");
    expect(violaciones(ESQUEMA, { ...ALCANCE_DE_TABLAS, Cuenta: heredada("Mesa", "clienteId") }).join("\n")).toContain("Cuenta: HEREDADA por `clienteId`, que es opcional");
    expect(violaciones(ESQUEMA, { ...ALCANCE_DE_TABLAS, CuentaItem: heredada("Producto", "productoId") }).join("\n")).toContain("CuentaItem: su padre Producto figura como DE_EMPRESA");
    expect(violaciones(ESQUEMA, { ...ALCANCE_DE_TABLAS, CuentaItem: heredada("Fantasma", "cuentaId") }).join("\n")).toContain("CuentaItem: HEREDADA de Fantasma, que no es un modelo del esquema");
    const ciclo = { ...ALCANCE_DE_TABLAS, Cuenta: heredada("CuentaItem", "mesaId"), CuentaItem: heredada("Cuenta", "cuentaId") };
    expect(violaciones(ESQUEMA, ciclo).join("\n")).toContain("la cadena de padres da una vuelta (ciclo)");
  });

  it("una tabla de la empresa entera con una FK a una tabla de sucursal (una HEREDADA sin declarar) da rojo", () => {
    expect(violaciones(ESQUEMA, { ...ALCANCE_DE_TABLAS, Cuenta: { alcance: "DE_EMPRESA" } }).join("\n")).toContain("Cuenta: figura DE_EMPRESA pero tiene una FK a Mesa (PROPIA): ¿es HEREDADA?");
  });

  it("GOBIERNO sin motivo da rojo", () => {
    expect(violaciones(ESQUEMA, { ...ALCANCE_DE_TABLAS, Sucursal: { alcance: "GOBIERNO", motivo: "" } }).join("\n")).toContain("Sucursal: GOBIERNO sin motivo");
  });

  it("las tablas sin empresa tienen que coincidir con la primera dimensión: una global marcada de la empresa, o una de la empresa marcada sin empresa, da rojo", () => {
    expect(violaciones(ESQUEMA, { ...ALCANCE_DE_TABLAS, User: { alcance: "DE_EMPRESA" } }).join("\n")).toContain("User: la clasificación por empresa la declara sin empresa");
    expect(violaciones(ESQUEMA, { ...ALCANCE_DE_TABLAS, Producto: { alcance: "SIN_EMPRESA" } }).join("\n")).toContain("Producto: es SIN_EMPRESA pero la clasificación por empresa la declara con empresa");
  });

  it("TraspasoSucursal: si pierde una de sus dos puntas (columna opcional o inexistente), da rojo", () => {
    expect(violaciones(ESQUEMA, { ...ALCANCE_DE_TABLAS, TraspasoSucursal: { alcance: "ENTRE_SUCURSALES", columnaOrigen: "origenSucursalId", columnaDestino: "sucursalDestinoId" } }).join("\n")).toContain(
      "ENTRE_SUCURSALES exige `sucursalDestinoId`",
    );
    expect(violaciones(ESQUEMA, { ...ALCANCE_DE_TABLAS, TraspasoSucursal: { alcance: "DE_EMPRESA" } }).join("\n")).toContain("TraspasoSucursal: tiene una FK a Sucursal y figura como DE_EMPRESA");
  });
});
