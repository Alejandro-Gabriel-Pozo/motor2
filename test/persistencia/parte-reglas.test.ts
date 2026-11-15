import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { digitoVerificadorDeCuit } from "../../src/core/fiscal/cuit-estricto";
import { dbDeEmpresa } from "../../src/server/sesion/base";
import { EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { EMPRESA_POR_DEFECTO_ID as A, limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";

/**
 * Parte P1 (migración 20261115140000_parte_ficha_unica_p1) contra la base real: la BASE hace cumplir lo que el diseño declara (docs/diseno-parte-2026-11-12.md §4), con el nombre de cada restricción.
 * Oráculo A (naturaleza × documento) recorrido COMPLETO, más los casos de documento, nombre, domicilio, contacto, nota, únicos, FK compuesta, disparador (identidad, versión, columnas calculadas) y privilegios del rol de la app.
 * Mutación demostrada: sacar un CHECK de la migración hace caer su caso «rechaza»; sacar el único del documento hace caer los de choque.
 * Concurrencia e idempotencia del alta: `parte-alta-concurrencia.test.ts`. Paridad con el código: `parte-paridad-con-el-codigo.test.ts`.
 */
const B = EMPRESA_TESTIGO_ID;
afterAll(() => prismaAdmin.$disconnect());
beforeEach(limpiarBaseDeTest);

const cuit = (prefijo: string, medio: string): string => `${prefijo}${medio}${digitoVerificadorDeCuit(`${prefijo}${medio}`)}`;
const CUIT = cuit("20", "12345678");
const CUIT_JURIDICO = cuit("30", "50123456");
const UUIDS = new Set(["id", "idempotenciaAlta"]);
let n = 0;

/** Inserta como dueño (salta RLS y privilegios: se prueban las reglas de la TABLA). `null` = entró; si no, el nombre de la restricción que la rechazó. */
async function insertar(datos: Record<string, string | null | undefined> = {}, empresaId = A): Promise<string | null> {
  n += 1;
  const fila: Record<string, string | null | undefined> = { id: randomUUID(), empresaId, idempotenciaAlta: randomUUID(), payloadHash: "h", naturaleza: "HUMANA", nombre: `Persona ${n}`, ...datos };
  const columnas = Object.keys(fila).filter((c) => fila[c] !== undefined);
  try {
    await prismaAdmin.$executeRawUnsafe(`INSERT INTO "Parte" (${columnas.map((c) => `"${c}"`).join(", ")}) VALUES (${columnas.map((c, i) => `$${i + 1}${UUIDS.has(c) ? "::uuid" : ""}`).join(", ")})`, ...columnas.map((c) => fila[c]));
    return null;
  } catch (e) {
    const m = /violates (?:check|unique|foreign key) constraint "([^"]+)"/.exec(String((e as Error).message));
    return m ? m[1]! : String((e as Error).message);
  }
}
const limpiar = () => prismaAdmin.$executeRawUnsafe(`DELETE FROM "Parte"`);

describe("oráculo A: naturaleza × documento (recorrido completo)", () => {
  const DOCUMENTOS: Record<string, Record<string, string | null>> = {
    ninguno: {},
    CUIT: { documentoTipo: "CUIT", documentoNumero: CUIT },
    CUIL: { documentoTipo: "CUIL", documentoNumero: CUIT },
    CDI: { documentoTipo: "CDI", documentoNumero: CUIT },
    DNI: { documentoTipo: "DNI", documentoNumero: "12345678" },
    PASAPORTE: { documentoTipo: "PASAPORTE", documentoPais: "AR", documentoNumero: "AB123456" },
    ID_EXTRANJERO: { documentoTipo: "ID_EXTRANJERO", documentoPais: "BR", documentoNumero: "X1234567" },
  };
  // ✔ true / ✘ false, como la tabla de §4.2 del diseño (la fila «sin declarar» solo existe en lo migrado).
  const ORACULO: Record<string, Record<string, boolean>> = {
    HUMANA: { ninguno: true, CUIT: true, CUIL: true, CDI: true, DNI: true, PASAPORTE: true, ID_EXTRANJERO: true },
    JURIDICA: { ninguno: true, CUIT: true, CUIL: false, CDI: false, DNI: false, PASAPORTE: false, ID_EXTRANJERO: true },
    "sin declarar": { ninguno: true, CUIT: true, CUIL: false, CDI: false, DNI: false, PASAPORTE: false, ID_EXTRANJERO: false },
  };
  for (const [naturaleza, fila] of Object.entries(ORACULO)) {
    for (const [documento, entra] of Object.entries(fila)) {
      it(`${naturaleza} con ${documento}: ${entra ? "entra" : "se rechaza"}`, async () => {
        const base = naturaleza === "sin declarar" ? { naturaleza: null, migradaDe: "PROVEEDOR" } : { naturaleza };
        const r = await insertar({ ...base, ...DOCUMENTOS[documento]! });
        if (entra) expect(r).toBeNull();
        else expect(r).toBe("Parte_naturaleza_documento_chk");
      });
    }
  }
  it("el oráculo cubre todas las columnas del tipo de documento (guardián de dimensiones: un tipo nuevo sin declarar acá rompe este caso)", async () => {
    const [{ definicion }] = await prismaAdmin.$queryRawUnsafe<Array<{ definicion: string }>>(`SELECT pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conname = 'Parte_documentoTipo_chk'`);
    expect([...definicion.matchAll(/'([A-Z_]+)'::text/g)].map((m) => m[1]).sort()).toEqual(Object.keys(DOCUMENTOS).filter((k) => k !== "ninguno").sort());
    const [{ definicion: naturalezas }] = await prismaAdmin.$queryRawUnsafe<Array<{ definicion: string }>>(`SELECT pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conname = 'Parte_naturaleza_chk'`);
    expect([...naturalezas.matchAll(/'([A-Z_]+)'::text/g)].map((m) => m[1]).sort()).toEqual(["HUMANA", "JURIDICA"]);
  });
});

describe("documento, nombre y datos de contacto", () => {
  it("documento por tipo: CUIT con dígito verificador malo, DNI mal formado, pasaporte de 5 o 10 caracteres, pasaporte sin país o CUIT con país se rechazan; el de 6 a 9 entra", async () => {
    const mal = `${CUIT.slice(0, 10)}${(Number(CUIT[10]) + 1) % 10}`;
    for (const d of [
      { documentoTipo: "CUIT", documentoNumero: mal },
      { documentoTipo: "CUIT", documentoNumero: "2012345678" },
      { documentoTipo: "CUIT", documentoNumero: CUIT, documentoPais: "AR" },
      { documentoTipo: "DNI", documentoNumero: "0123456" },
      { documentoTipo: "DNI", documentoNumero: "12345" },
      { documentoTipo: "PASAPORTE", documentoPais: "AR", documentoNumero: "AB123" },
      { documentoTipo: "PASAPORTE", documentoPais: "AR", documentoNumero: "AB12345678" },
      { documentoTipo: "PASAPORTE", documentoNumero: "AB123456" },
      { documentoTipo: "PASAPORTE", documentoPais: "AR", documentoNumero: "ab123456" },
      { documentoNumero: "12345678" },
    ]) expect(await insertar(d), JSON.stringify(d)).toBe("Parte_documento_chk");
    expect(await insertar({ documentoTipo: "PASAPORTE", documentoPais: "AR", documentoNumero: "AB123456" })).toBeNull();
    await limpiar();
    expect(await insertar({ documentoTipo: "PASAPORTE", documentoPais: "AR", documentoNumero: "AB1234567" })).toBeNull();
  });

  it("nombre: lista de PERMITIDOS (con al menos una letra, sin `¿ ¡ ? ! $ %`, `_`, invisibles ni etiquetas, sin blancos en los extremos, hasta 200)", async () => {
    for (const nombre of ["12345", "Quesos_del_Sur", "¿Querés?", "Panadería!", "Combo $500", "-Sur SA", "+Sur SA", " Sur SA", "Sur SA ", "Sur‮ SA", "<b>Sur</b>", "Sur\nSA", "Ä".repeat(201), "", "😀 Sur"])
      expect(await insertar({ nombre }), JSON.stringify(nombre)).toBe("Parte_nombre_chk");
    for (const nombre of ["Pérez & Hijos S.R.L.", "Ñandú (Sur) 2x1", "Ä".repeat(200), "D'Angelo Hnos."]) expect(await insertar({ nombre }), nombre).toBeNull();
  });

  it("apellido solo en una persona; alias hasta 100; correo, teléfono, condición de IVA, provincia y estado de lista cerrada", async () => {
    expect(await insertar({ naturaleza: "JURIDICA", apellido: "Gómez" })).toBe("Parte_apellido_chk");
    expect(await insertar({ apellido: "Gómez", alias: "Gómez" })).toBeNull();
    expect(await insertar({ alias: "A".repeat(101) })).toBe("Parte_alias_chk");
    for (const email of ["Ana@x.com", " ana@x.com", "ana@@", "ana x@x.com", "@x.com", `${"a".repeat(250)}@x.com`]) expect(await insertar({ email }), email).toBe("Parte_email_chk");
    expect(await insertar({ email: "ana@x.com" })).toBeNull();
    for (const telefono of ["", " 299 4000000", "299\n4000000", "1".repeat(41)]) expect(await insertar({ telefono }), JSON.stringify(telefono)).toBe("Parte_telefono_chk");
    expect(await insertar({ telefono: "+54 299 400-0000" })).toBeNull();
    expect(await insertar({ condicionIva: "INVENTADA" })).toBe("Parte_condicionIva_chk");
    expect(await insertar({ condicionIva: "MONOTRIBUTO_TRABAJADOR_INDEPENDIENTE_PROMOVIDO" })).toBeNull();
    expect(await insertar({ estado: "ANONIMIZADA" })).toBe("Parte_estado_chk");
    expect(await insertar({ estado: "INACTIVA" })).toBeNull();
  });

  it("nota: hasta 2.000, no vacía, con salto de línea permitido y sin caracteres de control ni invisibles", async () => {
    for (const nota of ["", "x".repeat(2001), "con ‮ invisible", "con ​ ancho cero", "con ­ guion blando"]) expect(await insertar({ nota }), JSON.stringify(nota)).toBe("Parte_nota_chk");
    expect(await insertar({ nota: "Línea uno\nLínea dos <entre llaves> con ñ" })).toBeNull();
    expect(await insertar({ nota: "x".repeat(2000) })).toBeNull();
  });

  it("sin naturaleza solo si la ficha vino de la migración (I19)", async () => {
    expect(await insertar({ naturaleza: null })).toBe("Parte_naturaleza_o_migrada_chk");
    expect(await insertar({ naturaleza: null, migradaDe: "PROVEEDOR" })).toBeNull();
    expect(await insertar({ migradaDe: "OTRO" })).toBe("Parte_migradaDe_chk");
  });
});

describe("oráculo D: domicilio", () => {
  const AR = { domPais: "AR", domCalle: "Belgrano", domNumero: "123", domLocalidad: "Neuquén", domProvincia: "AR-Q" };
  const casos: Array<[string, Record<string, string | null>, boolean]> = [
    ["ninguno", {}, true],
    ["AR completo", AR, true],
    ["AR completo con piso, depto y CP", { ...AR, domPiso: "3", domDepartamento: "B", domCodigoPostal: "Q8300" }, true],
    ["AR con S/N", { ...AR, domNumero: "S/N" }, true],
    ["AR sin provincia", { ...AR, domProvincia: null }, false],
    ["AR sin localidad", { ...AR, domLocalidad: null }, false],
    ["AR con provincia que no existe", { ...AR, domProvincia: "AR-9" }, false],
    ["AR con línea de exterior", { ...AR, domTexto: "Calle 1" }, false],
    ["AR con número inválido", { ...AR, domNumero: "12a" }, false],
    ["exterior en una línea", { domPais: "BR", domTexto: "Rua das Flores 10, São Paulo" }, true],
    ["exterior con país AR", { domPais: "AR", domTexto: "Calle 1" }, false],
    ["exterior con columna estructurada", { domPais: "BR", domTexto: "Rua 1", domCalle: "Rua" }, false],
    ["exterior de más de 300", { domPais: "BR", domTexto: "R".repeat(301) }, false],
    ["columnas sueltas sin país", { domCalle: "Belgrano" }, false],
  ];
  for (const [nombre, datos, entra] of casos) {
    it(`${nombre}: ${entra ? "entra" : "se rechaza"}`, async () => {
      const r = await insertar(datos);
      if (entra) expect(r).toBeNull();
      else expect(["Parte_domicilio_chk", "Parte_domProvincia_chk"]).toContain(r);
    });
  }
});

describe("únicos, clave foránea y disparador", () => {
  it("un documento, una parte por empresa: CUIT y CUIL del mismo número chocan, también contra una inactiva; en otra empresa entra", async () => {
    expect(await insertar({ documentoTipo: "CUIT", documentoNumero: CUIT, estado: "INACTIVA" })).toBeNull();
    expect(await insertar({ documentoTipo: "CUIL", documentoNumero: CUIT })).toBe("Parte_documento_uk");
    expect(await insertar({ documentoTipo: "CUIT", documentoNumero: CUIT })).toBe("Parte_documento_uk");
    expect(await insertar({ documentoTipo: "CUIT", documentoNumero: CUIT }, B), "otra empresa: sin oráculo de existencia entre empresas").toBeNull();
    expect(await insertar({ naturaleza: "JURIDICA", documentoTipo: "CUIT", documentoNumero: CUIT_JURIDICO })).toBeNull();
  });

  it("la clave de alta es única por empresa y se puede repetir en otra", async () => {
    const clave = randomUUID();
    expect(await insertar({ idempotenciaAlta: clave })).toBeNull();
    expect(await insertar({ idempotenciaAlta: clave })).toBe("Parte_idempotenciaAlta_uk");
    expect(await insertar({ idempotenciaAlta: clave }, B)).toBeNull();
  });

  it("Proveedor → Parte: FK compuesta con la empresa (una ficha ajena no se liga) y un proveedor por ficha", async () => {
    const ajena = randomUUID();
    const propia = randomUUID();
    await insertar({ id: ajena }, B);
    await insertar({ id: propia });
    const prov = (id: string) => prismaAdmin.proveedor.create({ data: { id, empresaId: A, codigo: `PRV_${id}`, nombre: `Prov ${id}` } });
    const [p1, p2] = [await prov("pr_1"), await prov("pr_2")];
    const ligar = (id: string, parteId: string) => prismaAdmin.$executeRawUnsafe(`UPDATE "Proveedor" SET "parteId" = $2::uuid WHERE id = $1`, id, parteId).then(() => null, (e: Error) => /constraint "([^"]+)"/.exec(e.message)?.[1] ?? e.message);
    expect(await ligar(p1.id, ajena)).toBe("Proveedor_parte_fkey");
    expect(await ligar(p1.id, propia)).toBeNull();
    expect(await ligar(p2.id, propia)).toBe("Proveedor_empresaId_parteId_key");
  });

  it("el disparador: la versión sube y la fecha avanza en cada cambio; la identidad no cambia; la naturaleza declarada no se borra; las calculadas las pone la base", async () => {
    const id = randomUUID();
    await insertar({ id, nombre: "Árbol Ñandú", alias: "Los Pájaros", telefono: "(299) 400-0000", documentoTipo: "DNI", documentoNumero: "12345678" });
    const leer = () => prismaAdmin.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT version, "actualizadoEn", "nombreBusqueda", "documentoNormalizado", "telefonoDigitos" FROM "Parte" WHERE id = $1::uuid`, id).then((r) => r[0]!);
    const antes = await leer();
    expect(antes).toMatchObject({ version: 1, nombreBusqueda: "arbol nandu los pajaros", documentoNormalizado: "D12345678", telefonoDigitos: "2994000000" });
    await prismaAdmin.$executeRawUnsafe(`UPDATE "Parte" SET nombre = 'Otro Nombre' WHERE id = $1::uuid`, id);
    const despues = await leer();
    expect(despues.version).toBe(2);
    expect((despues.actualizadoEn as Date).getTime()).toBeGreaterThanOrEqual((antes.actualizadoEn as Date).getTime());
    for (const cambio of [`id = gen_random_uuid()`, `"empresaId" = '${B}'`, `"idempotenciaAlta" = gen_random_uuid()`, `"migradaDe" = 'PROVEEDOR'`, `"creadoEn" = now() - interval '1 day'`, `"payloadHash" = 'otro'`])
      await expect(prismaAdmin.$executeRawUnsafe(`UPDATE "Parte" SET ${cambio} WHERE id = $1::uuid`, id), cambio).rejects.toThrow(/Parte_identidad_inmutable|identidad de una parte/);
    await expect(prismaAdmin.$executeRawUnsafe(`UPDATE "Parte" SET naturaleza = NULL WHERE id = $1::uuid`, id)).rejects.toThrow(/no vuelve a quedar sin ella/);
    await expect(prismaAdmin.$executeRawUnsafe(`UPDATE "Parte" SET "nombreBusqueda" = 'x' WHERE id = $1::uuid`, id)).rejects.toThrow(/only be updated to DEFAULT/);
    expect((await leer()).version, "los rechazos no suben la versión").toBe(2);
  });
});

describe("privilegios del rol de la app (motor2_app) y aislamiento por empresa", () => {
  const alta = (empresaId: string, extra: Record<string, unknown> = {}) =>
    dbDeEmpresa(empresaId).parte.create({ data: { id: randomUUID(), idempotenciaAlta: randomUUID(), payloadHash: "h", naturaleza: "HUMANA", nombre: "Ana Pérez", ...extra } });

  it("puede dar de alta (nace ACTIVA, versión 1, de su empresa) y editar con la versión; no puede escribir lo que fija la base, ni borrar", async () => {
    const parte = await alta(A);
    expect(parte).toMatchObject({ empresaId: A, estado: "ACTIVA", version: 1, migradaDe: null });
    expect((await dbDeEmpresa(A).parte.updateMany({ where: { id: parte.id, version: 1 }, data: { nombre: "Ana P." } })).count).toBe(1);
    expect((await dbDeEmpresa(A).parte.updateMany({ where: { id: parte.id, version: 1 }, data: { nombre: "Otra" } })).count, "la versión leída ya no es la actual").toBe(0);
    await expect(alta(A, { migradaDe: "PROVEEDOR" })).rejects.toThrow(/permission denied/i);
    await expect(alta(A, { estado: "INACTIVA" })).rejects.toThrow(/permission denied/i);
    await expect(dbDeEmpresa(A).parte.update({ where: { id: parte.id }, data: { version: 99 } })).rejects.toThrow(/permission denied/i);
    await expect(dbDeEmpresa(A).parte.update({ where: { id: parte.id }, data: { migradaDe: "PROVEEDOR" } })).rejects.toThrow(/permission denied/i);
    await expect(dbDeEmpresa(A).parte.update({ where: { id: parte.id }, data: { idempotenciaAlta: randomUUID() } })).rejects.toThrow(/permission denied/i);
    await expect(dbDeEmpresa(A).parte.deleteMany({})).rejects.toThrow(/permission denied/i);
    await expect(dbDeEmpresa(A).$executeRawUnsafe(`TRUNCATE "Parte"`)).rejects.toThrow(/permission denied/i);
  });

  it("aislamiento: una empresa no ve, no edita y no crea fichas de otra", async () => {
    const deA = await alta(A, { documentoTipo: "CUIT", documentoNumero: CUIT });
    expect(await dbDeEmpresa(B).parte.findMany()).toEqual([]);
    expect(await dbDeEmpresa(B).parte.findUnique({ where: { id: deA.id } })).toBeNull();
    expect((await dbDeEmpresa(B).parte.updateMany({ where: { id: deA.id }, data: { nombre: "Intruso" } })).count).toBe(0);
    await expect(alta(B, { empresaId: A })).rejects.toThrow();
    // El mismo CUIT en la otra empresa es otra ficha (el único es por empresa).
    await expect(alta(B, { documentoTipo: "CUIT", documentoNumero: CUIT })).resolves.toMatchObject({ empresaId: B });
    expect(await dbDeEmpresa(A).parte.count()).toBe(1);
  });
});
