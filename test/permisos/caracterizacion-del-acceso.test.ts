import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { crearMembresia } from "../setup/membresia";
import { MODULOS_VENDIBLES, fijarModulosActivos } from "../setup/modulos";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { ACCIONES, contextoDeAccion, type AccionClave, type AccionDeEmpresa, type AccionDeSucursal } from "../../src/core/permisos/acciones";
import {
  accionesDelMenuQueElUsuarioPuedeVer,
  accionesQueElUsuarioPuedeVer,
  obtenerMiNivelPermiso,
  obtenerMiNivelPermisoDeEmpresa,
  requierePermiso,
  requierePermisoDeEmpresa,
  requierePermisoVer,
  requierePermisoVerDeEmpresa,
  sucursalesDondeElUsuarioPuedeVer,
  type ResultadoGate,
} from "../../src/server/acceso/gate";
import { situacionDelRegistroDeModulos } from "../../src/server/acceso/modulos-de-empresa";

/**
 * CARACTERIZACIÓN DEL ACCESO (Pureza Fase 3, tramo B). Congela, contra Postgres real, TODO lo que el guard decide hoy: para cada acción del sistema, cada
 * usuario/rol de un escenario con casos borde y cada registro de módulos, qué responden las funciones del gate (editar, ver, nivel, y las de lista/menú) y
 * cuántas consultas hacen. El resultado va a `caracterizacion/matriz-de-acceso.txt`, que está versionado.
 *
 * El acceso es lo más sensible del sistema: mover el guard de carpeta (`core/permisos` → `server/acceso`) y separar su decisión pura de sus lecturas NO puede
 * cambiar una sola respuesta. Por eso este archivo se escribe ANTES de mover nada y NO se regenera: si un paso lo hace cambiar, el paso está mal. Para
 * regenerarlo a propósito (una decisión de producto, nunca una mudanza): `REGENERAR_CARACTERIZACION_DE_ACCESO=1 npx vitest run test/permisos/caracterizacion-del-acceso.test.ts`.
 * Se usa un archivo propio y no los snapshots de Vitest para que `-u` no lo pueda regenerar en silencio.
 */
const ARCHIVO = join(__dirname, "caracterizacion/matriz-de-acceso.txt");

const REGISTROS: Record<string, readonly string[]> = {
  vacio: [],
  "solo stock": ["stock"],
  "solo salon": ["salon"],
  todos: MODULOS_VENDIBLES,
};

type Escenario = {
  s1: string;
  s2: string;
  s3: string;
  usuarios: { nombre: string; id: string }[];
  accionConCapacidadApagada: AccionDeSucursal;
};

let E: Escenario;

const DE_SUCURSAL = ACCIONES.filter((a) => contextoDeAccion(a.clave) === "sucursal").map((a) => a.clave as AccionDeSucursal);
const DE_EMPRESA = ACCIONES.filter((a) => contextoDeAccion(a.clave) === "empresa").map((a) => a.clave as AccionDeEmpresa);

/** Una respuesta del gate como texto estable: `ok` o `motivo/caso/modulo/para` (el mensaje completo va aparte, una vez por firma). */
const firma = (r: ResultadoGate): string => (r.ok ? "ok" : [r.motivo, "caso" in r ? r.caso : "", "modulo" in r ? r.modulo : "", "para" in r ? r.para : "", "alcance" in r ? r.alcance : ""].join("/"));

const mensajes = new Map<string, string>();
const recordar = (r: ResultadoGate) => {
  if (!r.ok) mensajes.set(firma(r), r.mensaje);
};

/** Agrupa acciones por resultado: una línea por resultado distinto, con las acciones que lo dan (en el orden de ACCIONES). */
function agrupar<T extends string>(acciones: readonly T[], resultado: (a: T) => string): string[] {
  const grupos = new Map<string, T[]>();
  for (const a of acciones) {
    const k = resultado(a);
    grupos.set(k, [...(grupos.get(k) ?? []), a]);
  }
  return [...grupos].sort(([a], [b]) => a.localeCompare(b)).map(([k, as]) => `    ${k}: ${as.join(", ")}`);
}

async function usuario(email: string) {
  return prismaAdmin.user.create({ data: { email: `${email}@caracterizacion.test` } });
}

beforeAll(async () => {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  const s1 = base.sucursal.id;
  const s2 = (await prismaAdmin.sucursal.create({ data: { nombre: "Norte", empresaId: EMPRESA_POR_DEFECTO_ID } })).id;
  const s3 = (await prismaAdmin.sucursal.create({ data: { nombre: "Cerrada", empresaId: EMPRESA_POR_DEFECTO_ID, activo: false } })).id;

  // Un rol «especial» (no es admin): sus filas de PermisoRol son las que decide la matriz, y UNA está por encima de su piso (una acción de administrador).
  const especial = await prismaAdmin.rol.create({ data: { nombre: "especial", clave: null } });
  const inactivo = await prismaAdmin.rol.create({ data: { nombre: "rol apagado", clave: null, activo: false } });
  const deOperario = DE_SUCURSAL.filter((c) => ACCIONES.find((a) => a.clave === c)!.nivelMinimo === "operario");
  const deAdministrador = DE_SUCURSAL.filter((c) => ACCIONES.find((a) => a.clave === c)!.nivelMinimo === "administrador");
  const filas = [
    ...deOperario.slice(0, 12).map((accionClave, i) => ({ rolId: especial.id, accionClave, puedeVer: true, puedeEditar: i % 2 === 0 })),
    { rolId: especial.id, accionClave: deAdministrador[0]!, puedeVer: true, puedeEditar: true }, // por encima del piso: el gate la ignora
    ...DE_EMPRESA.slice(0, 6).map((accionClave) => ({ rolId: especial.id, accionClave, puedeVer: true, puedeEditar: false })),
    ...deOperario.slice(0, 3).map((accionClave) => ({ rolId: inactivo.id, accionClave, puedeVer: true, puedeEditar: true })),
  ];
  await prismaAdmin.permisoRol.createMany({ data: filas, skipDuplicates: true });

  const admin = await usuario("admin");
  const gerente = await usuario("gerente");
  const operador = await usuario("operador");
  const esp = await usuario("especial");
  const sinMembresiaActiva = await usuario("membresia-apagada");
  const conRolInactivo = await usuario("rol-apagado");
  const sinNada = await usuario("sin-membresia");
  const enSucursalCerrada = await usuario("sucursal-cerrada");
  const dosSucursales = await usuario("dos-sucursales");

  await crearMembresia({ usuarioId: admin.id, sucursalId: s1, rolId: base.admin.id });
  await crearMembresia({ usuarioId: gerente.id, sucursalId: s1, rolId: base.admin.id });
  await prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: gerente.id, empresaId: EMPRESA_POR_DEFECTO_ID } }, data: { rolEmpresa: "gerente" } });
  await crearMembresia({ usuarioId: operador.id, sucursalId: s1, rolId: base.operador.id });
  await crearMembresia({ usuarioId: esp.id, sucursalId: s1, rolId: especial.id });
  await crearMembresia({ usuarioId: sinMembresiaActiva.id, sucursalId: s1, rolId: base.operador.id, activo: false });
  await crearMembresia({ usuarioId: conRolInactivo.id, sucursalId: s1, rolId: inactivo.id });
  await crearMembresia({ usuarioId: enSucursalCerrada.id, sucursalId: s3, rolId: base.operador.id });
  await crearMembresia({ usuarioId: dosSucursales.id, sucursalId: s1, rolId: base.operador.id });
  await crearMembresia({ usuarioId: dosSucursales.id, sucursalId: s2, rolId: especial.id });

  // Capacidades: una acción apagada en S1 (y prendida en S2); y una de «siempre habilitada» que NO se puede apagar (la fila se ignora).
  const accionConCapacidadApagada = deOperario[0]!;
  await prismaAdmin.capacidadSucursal.create({ data: { accionClave: accionConCapacidadApagada, sucursalId: s1, habilitado: false } });
  await prismaAdmin.capacidadSucursal.create({ data: { accionClave: accionConCapacidadApagada, sucursalId: s2, habilitado: true } });
  await prismaAdmin.capacidadSucursal.create({ data: { accionClave: "gestion_usuarios", sucursalId: s1, habilitado: false } });
  await prismaAdmin.capacidadSucursal.create({ data: { accionClave: deOperario[3]!, sucursalId: s2, habilitado: false } });

  E = {
    s1,
    s2,
    s3,
    accionConCapacidadApagada,
    usuarios: [
      { nombre: "admin", id: admin.id },
      { nombre: "gerente", id: gerente.id },
      { nombre: "operador", id: operador.id },
      { nombre: "especial", id: esp.id },
      { nombre: "membresia apagada", id: sinMembresiaActiva.id },
      { nombre: "rol apagado", id: conRolInactivo.id },
      { nombre: "sin membresia", id: sinNada.id },
      { nombre: "solo sucursal cerrada", id: enSucursalCerrada.id },
      { nombre: "dos sucursales", id: dosSucursales.id },
    ],
  };
}, 120_000);

/** Cuenta las operaciones sobre la base de una llamada: `Modelo.operacion` en el orden en que ocurren. */
async function contarConsultas<T>(f: (db: PrismaClient) => Promise<T>): Promise<string[]> {
  const operaciones: string[] = [];
  const db = prisma.$extends({
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          operaciones.push(`${model}.${operation}`);
          return query(args);
        },
      },
    },
  }) as unknown as PrismaClient;
  await f(db);
  return operaciones.sort();
}

async function generar(): Promise<string> {
  const salida: string[] = [];
  const nombreSucursal = (id: string) => (id === E.s1 ? "S1" : id === E.s2 ? "S2" : "S3");

  for (const [nombreRegistro, modulos] of Object.entries(REGISTROS)) {
    await fijarModulosActivos(EMPRESA_POR_DEFECTO_ID, modulos);
    const situacion = await situacionDelRegistroDeModulos(EMPRESA_POR_DEFECTO_ID, prisma);
    salida.push(`# REGISTRO ${nombreRegistro} (situación: ${JSON.stringify(situacion)})`);

    for (const u of E.usuarios) {
      salida.push(`## usuario ${u.nombre}`);
      for (const [sucursalId, etiqueta] of [[E.s1, "S1"], [E.s2, "S2"]] as const) {
        // Acciones de SUCURSAL: editar, ver y nivel.
        salida.push(`  [${etiqueta}] requierePermiso (editar)`);
        const editar = new Map<AccionDeSucursal, ResultadoGate>();
        const verMap = new Map<AccionDeSucursal, ResultadoGate>();
        const nivel = new Map<AccionDeSucursal, { ver: boolean; editar: boolean }>();
        for (const a of DE_SUCURSAL) {
          editar.set(a, await requierePermiso(u.id, sucursalId, a, prisma));
          verMap.set(a, await requierePermisoVer(u.id, sucursalId, a, prisma));
          nivel.set(a, await obtenerMiNivelPermiso(u.id, sucursalId, a, prisma));
          recordar(editar.get(a)!);
          recordar(verMap.get(a)!);
        }
        salida.push(...agrupar(DE_SUCURSAL, (a) => firma(editar.get(a)!)));
        salida.push(`  [${etiqueta}] requierePermisoVer`);
        salida.push(...agrupar(DE_SUCURSAL, (a) => firma(verMap.get(a)!)));
        salida.push(`  [${etiqueta}] obtenerMiNivelPermiso`);
        salida.push(...agrupar(DE_SUCURSAL, (a) => `ver=${nivel.get(a)!.ver} editar=${nivel.get(a)!.editar}`));
        salida.push(`  [${etiqueta}] accionesQueElUsuarioPuedeVer(todas las de sucursal)`);
        salida.push(`    ${[...(await accionesQueElUsuarioPuedeVer(u.id, sucursalId, DE_SUCURSAL, prisma))].sort().join(", ")}`);
        salida.push(`  [${etiqueta}] accionesDelMenuQueElUsuarioPuedeVer(todas)`);
        salida.push(`    ${[...(await accionesDelMenuQueElUsuarioPuedeVer(u.id, EMPRESA_POR_DEFECTO_ID, sucursalId, ACCIONES.map((a) => a.clave as AccionClave), prisma))].sort().join(", ")}`);
      }

      // Acciones de EMPRESA (no dependen de la sucursal activa).
      const eEdit = new Map<AccionDeEmpresa, ResultadoGate>();
      const eVer = new Map<AccionDeEmpresa, ResultadoGate>();
      const eNivel = new Map<AccionDeEmpresa, { ver: boolean; editar: boolean }>();
      for (const a of DE_EMPRESA) {
        eEdit.set(a, await requierePermisoDeEmpresa(u.id, EMPRESA_POR_DEFECTO_ID, a, prisma));
        eVer.set(a, await requierePermisoVerDeEmpresa(u.id, EMPRESA_POR_DEFECTO_ID, a, prisma));
        eNivel.set(a, await obtenerMiNivelPermisoDeEmpresa(u.id, EMPRESA_POR_DEFECTO_ID, a, prisma));
        recordar(eEdit.get(a)!);
        recordar(eVer.get(a)!);
      }
      salida.push("  [empresa] requierePermisoDeEmpresa (editar)");
      salida.push(...agrupar(DE_EMPRESA, (a) => firma(eEdit.get(a)!)));
      salida.push("  [empresa] requierePermisoVerDeEmpresa");
      salida.push(...agrupar(DE_EMPRESA, (a) => firma(eVer.get(a)!)));
      salida.push("  [empresa] obtenerMiNivelPermisoDeEmpresa");
      salida.push(...agrupar(DE_EMPRESA, (a) => `ver=${eNivel.get(a)!.ver} editar=${eNivel.get(a)!.editar}`));

      // Varias sucursales a la vez (incluida una inactiva): en cuáles puede ver cada una de seis acciones.
      for (const a of [DE_SUCURSAL[0]!, DE_SUCURSAL[3]!, E.accionConCapacidadApagada, "gestion_usuarios" as AccionDeSucursal, DE_SUCURSAL[20]!, DE_SUCURSAL[40]!]) {
        const donde = await sucursalesDondeElUsuarioPuedeVer(u.id, [E.s1, E.s2, E.s3], a, prisma);
        salida.push(`  sucursalesDondeElUsuarioPuedeVer(${a}): ${[...donde].map(nombreSucursal).sort().join(",") || "(ninguna)"}`);
      }
    }
  }

  // Cuántas consultas hace cada llamada representativa (cambiar de carpeta no puede cambiarlo).
  await fijarModulosActivos(EMPRESA_POR_DEFECTO_ID, REGISTROS.todos!);
  const admin = E.usuarios.find((u) => u.nombre === "admin")!.id;
  const gerente = E.usuarios.find((u) => u.nombre === "gerente")!.id;
  const operador = E.usuarios.find((u) => u.nombre === "operador")!.id;
  const pisoGerente = DE_EMPRESA.find((a) => ACCIONES.find((x) => x.clave === a)!.nivelMinimo === "gerente")!;
  salida.push("# CONSULTAS POR LLAMADA (registro: todos)");
  const casos: [string, (db: PrismaClient) => Promise<unknown>][] = [
    [`requierePermiso(admin, S1, ${DE_SUCURSAL[0]})`, (db) => requierePermiso(admin, E.s1, DE_SUCURSAL[0]!, db)],
    [`requierePermisoVer(operador, S1, ${DE_SUCURSAL[0]})`, (db) => requierePermisoVer(operador, E.s1, DE_SUCURSAL[0]!, db)],
    ["requierePermiso(admin, S1, gestion_usuarios)  (Administración: no lee ModuloEmpresa)", (db) => requierePermiso(admin, E.s1, "gestion_usuarios", db)],
    [`obtenerMiNivelPermisoDeEmpresa(admin, ${DE_EMPRESA[0]})`, (db) => obtenerMiNivelPermisoDeEmpresa(admin, EMPRESA_POR_DEFECTO_ID, DE_EMPRESA[0]!, db)],
    [`requierePermisoDeEmpresa(gerente, ${pisoGerente})  (piso gerente: lee UsuarioEmpresa)`, (db) => requierePermisoDeEmpresa(gerente, EMPRESA_POR_DEFECTO_ID, pisoGerente, db)],
    [`requierePermisoDeEmpresa(admin, ${pisoGerente})`, (db) => requierePermisoDeEmpresa(admin, EMPRESA_POR_DEFECTO_ID, pisoGerente, db)],
    ["accionesQueElUsuarioPuedeVer(operador, S1, todas las de sucursal)", (db) => accionesQueElUsuarioPuedeVer(operador, E.s1, DE_SUCURSAL, db)],
    ["accionesQueElUsuarioPuedeVer(admin, S1, solo Administración: no lee ModuloEmpresa)", (db) => accionesQueElUsuarioPuedeVer(admin, E.s1, ["gestion_usuarios"], db)],
    ["accionesDelMenuQueElUsuarioPuedeVer(admin, todas)", (db) => accionesDelMenuQueElUsuarioPuedeVer(admin, EMPRESA_POR_DEFECTO_ID, E.s1, ACCIONES.map((a) => a.clave as AccionClave), db)],
    ["sucursalesDondeElUsuarioPuedeVer(operador, [S1,S2,S3])", (db) => sucursalesDondeElUsuarioPuedeVer(operador, [E.s1, E.s2, E.s3], DE_SUCURSAL[0]!, db)],
  ];
  for (const [nombre, f] of casos) {
    const ops = await contarConsultas(f);
    const resumen = new Map<string, number>();
    for (const o of ops) resumen.set(o, (resumen.get(o) ?? 0) + 1);
    salida.push(`  ${nombre}: ${ops.length} consultas — ${[...resumen].map(([o, n]) => `${o}×${n}`).join(", ")}`);
  }

  salida.push("# MENSAJES DE DENEGACIÓN (uno por firma distinta)");
  for (const [k, m] of [...mensajes].sort(([a], [b]) => a.localeCompare(b))) salida.push(`  ${k}\n    ${m}`);
  return salida.join("\n") + "\n";
}

describe("caracterización del acceso: el guard responde exactamente lo mismo que antes de moverlo", () => {
  it("la matriz completa (todas las acciones × usuarios × registros de módulos) coincide con la versionada", async () => {
    const actual = await generar();
    expect(actual.length).toBeGreaterThan(5_000); // si el escenario no armó nada, esto no está mirando nada

    if (process.env.REGENERAR_CARACTERIZACION_DE_ACCESO === "1") {
      mkdirSync(join(__dirname, "caracterizacion"), { recursive: true });
      writeFileSync(ARCHIVO, actual, "utf8");
      return;
    }
    expect(existsSync(ARCHIVO), "falta test/permisos/caracterizacion/matriz-de-acceso.txt: generalo contra el código ANTERIOR a la mudanza").toBe(true);
    expect(actual.replace(/\r\n/g, "\n")).toBe(readFileSync(ARCHIVO, "utf8").replace(/\r\n/g, "\n"));
  }, 240_000);

  it("las invariantes del guard valen en toda la matriz: ver ⊇ editar, el menú coincide con ver, y sin módulo todo se niega", async () => {
    for (const modulos of [REGISTROS.vacio!, REGISTROS.todos!]) {
      await fijarModulosActivos(EMPRESA_POR_DEFECTO_ID, modulos);
      for (const u of E.usuarios) {
        const menu = await accionesDelMenuQueElUsuarioPuedeVer(u.id, EMPRESA_POR_DEFECTO_ID, E.s1, ACCIONES.map((a) => a.clave as AccionClave), prisma);
        for (const a of DE_SUCURSAL) {
          const [ed, ve, nv] = [await requierePermiso(u.id, E.s1, a, prisma), await requierePermisoVer(u.id, E.s1, a, prisma), await obtenerMiNivelPermiso(u.id, E.s1, a, prisma)];
          expect(nv.editar, `${u.nombre}/${a}`).toBe(ed.ok);
          expect(nv.ver, `${u.nombre}/${a}`).toBe(ve.ok);
          expect(menu.has(a), `${u.nombre}/${a}: el menú tiene que coincidir con «ver»`).toBe(ve.ok);
          if (ed.ok) expect(ve.ok, `${u.nombre}/${a}: quien puede editar puede ver`).toBe(true);
        }
      }
    }
  }, 240_000);
});
