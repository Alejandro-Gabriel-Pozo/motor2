import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { validarDatosDeParte, type DatosDeParte, type EntradaDeParte } from "../../src/core/datos/datos-de-parte";
import { digitoVerificadorDeCuit } from "../../src/core/fiscal/cuit-estricto";
import { azarDelProceso } from "../../src/lib/azar";
import { altaDeParteCasoDeUso } from "../../src/server/actions/partes/casos-de-uso/alta-de-parte";
import { cambiarEstadoDeParteCasoDeUso } from "../../src/server/actions/partes/casos-de-uso/cambiar-estado-de-parte";
import { editarParteCasoDeUso } from "../../src/server/actions/partes/casos-de-uso/editar-parte";
import { buscarPartes } from "../../src/server/consultas/partes/buscar-partes";
import { baseDeEmpresa } from "../../src/server/sesion/base";
import { EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { EMPRESA_POR_DEFECTO_ID as A, crearUsuarioConMembresia, limpiarBaseDeTest, prismaAdmin, sembrarBase } from "../setup/test-db";

/**
 * Casos de uso de la ficha de parte (Parte P1 (b); docs/diseno-parte-2026-11-12.md §3), contra Postgres real: alta (idempotente, un documento = una ficha, aviso de duplicados), edición (versión), desactivar y reactivar,
 * búsqueda y auditoría SIN datos personales. Las carreras son de verdad (`Promise.allSettled` desde conexiones distintas).
 * Mutación: sacar el `true` final de `conTransaccionSerializable` en el alta deja en rojo «ocho altas a la vez»; escribir el valor en la auditoría deja en rojo «sin datos personales».
 */
afterAll(() => prismaAdmin.$disconnect());

const cuit = (medio: string, prefijo = "20"): string => `${prefijo}${medio}${digitoVerificadorDeCuit(`${prefijo}${medio}`)}`;
let usuarioId: string;
let otroUsuarioId: string;
let sucursalId: string;

/** El actor con el alcance que le da la producción (su sucursal activa para leer y escribir): la auditoría de la empresa (sucursal nula) exige un alcance de escritura. */
const actorDe = (empresaId: string, uid = usuarioId) => ({ usuarioId: uid, empresaId, sucursalId, ...baseDeEmpresa(empresaId, { lectura: [sucursalId], escritura: [sucursalId] }) });
const datos = (extra: Partial<EntradaDeParte> = {}): DatosDeParte => {
  const r = validarDatosDeParte({ naturaleza: "HUMANA", nombre: "Ana Pérez", ...extra });
  if (!r.ok) throw new Error(JSON.stringify(r.errores));
  return r.valor;
};
const altaDeParte = (d: DatosDeParte, clave: string = randomUUID(), empresaId = A) => altaDeParteCasoDeUso(actorDe(empresaId), { claveIdempotencia: clave, datos: d }, azarDelProceso);
const filas = () => prismaAdmin.parte.count();
const auditoria = () => prismaAdmin.registroAuditoria.findMany({ where: { entidad: "Parte" }, orderBy: { creadoEn: "asc" } });

beforeEach(async () => {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  sucursalId = base.sucursal.id;
  usuarioId = (await crearUsuarioConMembresia({ email: "operario@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id })).id;
  otroUsuarioId = (await crearUsuarioConMembresia({ email: "otro@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id })).id;
});

describe("alta de una ficha", () => {
  it("crea la ficha (ACTIVA, versión 1, con quien la creó) y la repetición con la misma clave y los mismos datos devuelve la misma, sin escribir ni auditar de nuevo", async () => {
    const clave = randomUUID();
    const d = datos({ documento: { tipo: "CUIT", numero: cuit("12345678") } });
    const primera = await altaDeParte(d, clave);
    expect(primera).toMatchObject({ ok: true, datos: { yaExistia: false, posiblesDuplicados: [] } });
    if (!primera.ok) return;
    const repetida = await altaDeParte(d, clave);
    expect(repetida).toMatchObject({ ok: true, datos: { yaExistia: true, parteId: primera.datos.parteId } });
    expect(await filas()).toBe(1);
    expect(await auditoria()).toHaveLength(1);
    expect(await prismaAdmin.parte.findUniqueOrThrow({ where: { id: primera.datos.parteId } })).toMatchObject({ estado: "ACTIVA", version: 1, creadoPorId: usuarioId, empresaId: A, migradaDe: null });
  });

  it("la misma clave con OTROS datos es CLAVE_REUTILIZADA y no cambia nada", async () => {
    const clave = randomUUID();
    await altaDeParte(datos(), clave);
    expect(await altaDeParte(datos({ nombre: "Otra Persona" }), clave)).toMatchObject({ ok: false, codigo: "CLAVE_REUTILIZADA" });
    expect(await filas()).toBe(1);
  });

  it("un documento ya registrado devuelve la ficha dueña (activa: DOCUMENTO_YA_REGISTRADO; inactiva: PARTE_INACTIVA_CON_ESE_DOCUMENTO) y no crea otra; CUIL del mismo número también choca", async () => {
    const numero = cuit("22222222");
    const primera = await altaDeParte(datos({ documento: { tipo: "CUIT", numero } }));
    if (!primera.ok) throw new Error("no creó");
    expect(await altaDeParte(datos({ nombre: "Otra", documento: { tipo: "CUIL", numero } }))).toMatchObject({ ok: false, codigo: "DOCUMENTO_YA_REGISTRADO", parteId: primera.datos.parteId });
    await cambiarEstadoDeParteCasoDeUso(actorDe(A), { parteId: primera.datos.parteId, activa: false });
    expect(await altaDeParte(datos({ nombre: "Otra", documento: { tipo: "CUIT", numero } }))).toMatchObject({ ok: false, codigo: "PARTE_INACTIVA_CON_ESE_DOCUMENTO", parteId: primera.datos.parteId });
    expect(await filas()).toBe(1);
  });

  it("avisa las fichas que podrían ser la misma (mismo nombre sin acentos ni mayúsculas, correo o teléfono) sin bloquear el alta", async () => {
    const a = await altaDeParte(datos({ nombre: "José Núñez", email: "jose@x.com", telefono: "299 400-0000" }));
    const b = await altaDeParte(datos({ nombre: "JOSE NUNEZ" }));
    const c = await altaDeParte(datos({ nombre: "Otro Nombre", email: "jose@x.com" }));
    const d = await altaDeParte(datos({ nombre: "Tercero", telefono: "(299) 4000000" }));
    if (!a.ok || !b.ok || !c.ok || !d.ok) throw new Error("no crearon");
    expect([b.datos.posiblesDuplicados, c.datos.posiblesDuplicados, d.datos.posiblesDuplicados]).toEqual([[a.datos.parteId], [a.datos.parteId], [a.datos.parteId]]);
    expect(await filas()).toBe(4);
  });

  it("ocho altas a la vez del mismo documento dejan UNA ficha: una gana y las demás reciben DOCUMENTO_YA_REGISTRADO con la ganadora (nunca un error crudo)", async () => {
    const numero = cuit("33333333");
    const r = await Promise.allSettled(Array.from({ length: 8 }, () => altaDeParte(datos({ documento: { tipo: "CUIT", numero } }))));
    expect(r.every((x) => x.status === "fulfilled")).toBe(true);
    const ok = r.filter((x) => x.status === "fulfilled" && x.value.ok);
    const choques = r.filter((x) => x.status === "fulfilled" && !x.value.ok);
    expect(ok).toHaveLength(1);
    expect(choques.every((x) => x.status === "fulfilled" && !x.value.ok && x.value.codigo === "DOCUMENTO_YA_REGISTRADO" && x.value.parteId === (ok[0] as { value: { datos: { parteId: string } } }).value.datos.parteId)).toBe(true);
    expect(await filas()).toBe(1);
    expect(await auditoria()).toHaveLength(1);
  });

  it("seis reintentos a la vez con la misma clave dejan UNA ficha y una sola auditoría; todos devuelven la misma ficha", async () => {
    const clave = randomUUID();
    const d = datos({ nombre: "Clic Doble" });
    const r = await Promise.allSettled(Array.from({ length: 6 }, () => altaDeParte(d, clave)));
    const exitos = r.flatMap((x) => (x.status === "fulfilled" && x.value.ok ? [x.value.datos.parteId] : []));
    expect(r.every((x) => x.status === "fulfilled" && x.value.ok)).toBe(true);
    expect(new Set(exitos).size).toBe(1);
    expect(await filas()).toBe(1);
    expect(await auditoria()).toHaveLength(1);
  });

  it("la auditoría dice QUÉ pasó y QUIÉN, nunca los datos personales", async () => {
    await altaDeParte(datos({ nombre: "Persona Secreta", email: "secreto@x.com", telefono: "299 1112233", documento: { tipo: "CUIT", numero: cuit("44444444") }, nota: "nota privada" }));
    const filasDeAuditoria = await auditoria();
    expect(filasDeAuditoria).toHaveLength(1);
    expect(filasDeAuditoria[0]).toMatchObject({ entidad: "Parte", campo: "alta", actorId: usuarioId, valorAnterior: null, valorNuevo: "creada" });
    expect(JSON.stringify(filasDeAuditoria)).not.toMatch(/Secreta|secreto@|1112233|44444444|nota privada/);
  });

  it("aislamiento: el mismo documento en otra empresa es otra ficha; cada empresa ve solo las suyas", async () => {
    const numero = cuit("55555555");
    expect(await altaDeParte(datos({ documento: { tipo: "CUIT", numero } }))).toMatchObject({ ok: true });
    expect(await altaDeParte(datos({ documento: { tipo: "CUIT", numero } }), randomUUID(), EMPRESA_TESTIGO_ID)).toMatchObject({ ok: true });
    expect(await filas()).toBe(2);
    expect(await buscarPartes({ empresaId: A, texto: "" }, actorDe(A).db)).toHaveLength(1);
  });
});

describe("edición de una ficha", () => {
  const crear = async (extra: Partial<EntradaDeParte> = {}) => {
    const r = await altaDeParte(datos(extra));
    if (!r.ok) throw new Error("no creó");
    return r.datos.parteId;
  };

  it("cambia los datos con la versión leída, sube la versión y audita el NOMBRE de cada campo que cambió (no los valores)", async () => {
    const id = await crear({ nombre: "Ana Pérez" });
    const r = await editarParteCasoDeUso(actorDe(A, otroUsuarioId), { parteId: id, versionEsperada: 1, datos: datos({ nombre: "Ana Gómez", email: "ana@x.com", alias: "Anita" }) });
    expect(r).toMatchObject({ ok: true, datos: { cambio: true, version: 2 } });
    expect(await prismaAdmin.parte.findUniqueOrThrow({ where: { id } })).toMatchObject({ nombre: "Ana Gómez", email: "ana@x.com", alias: "Anita", version: 2 });
    const cambios = (await auditoria()).filter((f) => f.campo !== "alta");
    expect(cambios.map((f) => f.campo).sort()).toEqual(["alias", "email", "nombre"]);
    expect(cambios.every((f) => f.actorId === otroUsuarioId && f.valorNuevo === "cambió")).toBe(true);
    expect(JSON.stringify(cambios)).not.toMatch(/Gómez|ana@x\.com|Anita/);
  });

  it("repetir los mismos datos no escribe ni audita; con una versión vieja y datos distintos es VERSION_DESACTUALIZADA; una ficha ajena o inexistente es PARTE_NO_ENCONTRADA", async () => {
    const id = await crear();
    const nuevos = datos({ nombre: "Ana Gómez" });
    expect(await editarParteCasoDeUso(actorDe(A), { parteId: id, versionEsperada: 1, datos: nuevos })).toMatchObject({ ok: true, datos: { cambio: true } });
    expect(await editarParteCasoDeUso(actorDe(A), { parteId: id, versionEsperada: 2, datos: nuevos })).toMatchObject({ ok: true, datos: { cambio: false, version: 2 } });
    expect(await editarParteCasoDeUso(actorDe(A), { parteId: id, versionEsperada: 1, datos: datos({ nombre: "Otro" }) })).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
    expect(await editarParteCasoDeUso(actorDe(EMPRESA_TESTIGO_ID), { parteId: id, versionEsperada: 2, datos: datos({ nombre: "Intruso" }) })).toMatchObject({ ok: false, codigo: "PARTE_NO_ENCONTRADA" });
    expect(await editarParteCasoDeUso(actorDe(A), { parteId: randomUUID(), versionEsperada: 1, datos: nuevos })).toMatchObject({ ok: false, codigo: "PARTE_NO_ENCONTRADA" });
    expect((await prismaAdmin.parte.findUniqueOrThrow({ where: { id } })).nombre).toBe("Ana Gómez");
  });

  it("cambiar el documento a uno de OTRA ficha es DOCUMENTO_YA_REGISTRADO con esa ficha; completar el documento propio o una naturaleza pendiente anda", async () => {
    const numero = cuit("66666666");
    const duenia = await crear({ nombre: "Dueña", documento: { tipo: "CUIT", numero } });
    const id = await crear({ nombre: "Otra" });
    expect(await editarParteCasoDeUso(actorDe(A), { parteId: id, versionEsperada: 1, datos: datos({ nombre: "Otra", documento: { tipo: "CUIL", numero } }) })).toMatchObject({ ok: false, codigo: "DOCUMENTO_YA_REGISTRADO", parteId: duenia });
    expect(await editarParteCasoDeUso(actorDe(A), { parteId: id, versionEsperada: 1, datos: datos({ nombre: "Otra", documento: { tipo: "DNI", numero: "12345678" } }) })).toMatchObject({ ok: true, datos: { cambio: true } });
  });

  it("dos ediciones a la vez con la misma versión: gana una, la otra recibe VERSION_DESACTUALIZADA; una sola versión nueva", async () => {
    const id = await crear();
    const r = await Promise.all([
      editarParteCasoDeUso(actorDe(A), { parteId: id, versionEsperada: 1, datos: datos({ nombre: "Primera" }) }),
      editarParteCasoDeUso(actorDe(A), { parteId: id, versionEsperada: 1, datos: datos({ nombre: "Segunda" }) }),
    ]);
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    expect(r.filter((x) => !x.ok).map((x) => (x.ok ? "" : x.codigo))).toEqual(["VERSION_DESACTUALIZADA"]);
    expect((await prismaAdmin.parte.findUniqueOrThrow({ where: { id } })).version).toBe(2);
  });
});

describe("desactivar y reactivar", () => {
  it("desactiva, repite sin cambio, reactiva; audita solo los cambios reales; una ficha ajena es PARTE_NO_ENCONTRADA", async () => {
    const creada = await altaDeParte(datos());
    if (!creada.ok) throw new Error("no creó");
    const id = creada.datos.parteId;
    expect(await cambiarEstadoDeParteCasoDeUso(actorDe(A), { parteId: id, activa: false })).toMatchObject({ ok: true, datos: { activa: false, yaEstaba: false } });
    expect(await cambiarEstadoDeParteCasoDeUso(actorDe(A), { parteId: id, activa: false })).toMatchObject({ ok: true, datos: { yaEstaba: true } });
    expect(await cambiarEstadoDeParteCasoDeUso(actorDe(EMPRESA_TESTIGO_ID), { parteId: id, activa: true })).toMatchObject({ ok: false, codigo: "PARTE_NO_ENCONTRADA" });
    expect(await cambiarEstadoDeParteCasoDeUso(actorDe(A), { parteId: id, activa: true })).toMatchObject({ ok: true, datos: { activa: true, yaEstaba: false } });
    expect((await auditoria()).filter((f) => f.campo === "estado").map((f) => [f.valorAnterior, f.valorNuevo])).toEqual([["ACTIVA", "INACTIVA"], ["INACTIVA", "ACTIVA"]]);
  });

  it("cinco desactivaciones a la vez: una sola escribe y una sola auditoría", async () => {
    const creada = await altaDeParte(datos());
    if (!creada.ok) throw new Error("no creó");
    const r = await Promise.all(Array.from({ length: 5 }, () => cambiarEstadoDeParteCasoDeUso(actorDe(A), { parteId: creada.datos.parteId, activa: false })));
    expect(r.every((x) => x.ok)).toBe(true);
    expect(r.filter((x) => x.ok && !x.datos.yaEstaba)).toHaveLength(1);
    expect((await auditoria()).filter((f) => f.campo === "estado")).toHaveLength(1);
  });
});

describe("búsqueda", () => {
  it("por nombre (sin acentos ni mayúsculas), por documento y por documento con formato; las inactivas solo si se piden; solo nombre, documento y estado; orden: documento idéntico, empieza con, contiene", async () => {
    const numero = cuit("77777777");
    await altaDeParte(datos({ nombre: "Panadería Sur", documento: { tipo: "CUIT", numero } }));
    await altaDeParte(datos({ nombre: "La Panadería del Norte", email: "dato@personal.com" }));
    const inactiva = await altaDeParte(datos({ nombre: "Panadería Vieja" }));
    if (!inactiva.ok) throw new Error("no creó");
    await cambiarEstadoDeParteCasoDeUso(actorDe(A), { parteId: inactiva.datos.parteId, activa: false });
    const db = actorDe(A).db;
    const buscar = (texto: string, incluirInactivas = false) => buscarPartes({ empresaId: A, texto, incluirInactivas }, db);
    expect((await buscar("panaderia")).map((f) => f.nombre)).toEqual(["Panadería Sur", "La Panadería del Norte"]);
    expect((await buscar("panaderia", true)).map((f) => f.nombre)).toEqual(["Panadería Sur", "Panadería Vieja", "La Panadería del Norte"]);
    expect((await buscar(`${numero.slice(0, 2)}-${numero.slice(2, 10)}-${numero.slice(10)}`)).map((f) => f.nombre)).toEqual(["Panadería Sur"]);
    expect(await buscar("no existe")).toEqual([]);
    expect(Object.keys((await buscar("norte"))[0]!).sort()).toEqual(["alias", "apellido", "documentoNumero", "documentoTipo", "estado", "id", "nombre", "pendienteDeCompletar"]);
    expect(await buscar("100%")).toEqual([]); // el comodín no se interpreta
  });
});
