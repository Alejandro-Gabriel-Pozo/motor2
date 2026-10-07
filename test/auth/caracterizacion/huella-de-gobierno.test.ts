import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prismaAdmin } from "../../setup/test-db";
import { aceptarInvitacionDelToken, aceptarInvitacionDeUsuarioDelToken } from "../../../src/core/auth/invitacion";
import { requierePermiso } from "../../../src/server/acceso/gate";
import { asegurarInvitacionDeUsuario, revocarInvitacionPendiente, rotarInvitacionPendiente } from "../../../src/core/features/empresa/invitacion-de-usuario";
import { cambiarModulosDeEmpresa } from "../../../src/core/features/empresa/cambiar-modulos-de-empresa";
import { cambiarPoliticaDeEmpresa } from "../../../src/core/features/empresa/cambiar-politica-empresa";
import { sembrarEmpresa } from "../../../plataforma/src/servidor/sembrar-empresa";
import { incorporarPrimerGerente, transferirGerenciaDeEmpresa } from "../../../src/core/permisos/gerencia";
import { registrarCambioAuditado } from "../../../src/core/permisos/auditoria";
import { hashDeToken } from "../../../src/core/seguridad/tokens";
import { azarDelProceso } from "../../../src/lib/azar";

/**
 * HUELLA del gobierno de empresa y usuarios (Fase 4 del plan de pureza, tramo B: las escrituras de invitaciones, gerencia, módulos, política, siembra y auditoría salen de
 * `core`). Se escribe ANTES de mover nada y NO se edita en ningún paso posterior: si una mudanza cambia una fila, un mensaje o su orden, este archivo lo tiene que
 * detectar en rojo. Para regenerarlo A PROPÓSITO (una decisión de producto, nunca una mudanza):
 * `REGENERAR_HUELLA_DE_GOBIERNO=1 npx vitest run test/auth/caracterizacion/huella-de-gobierno.test.ts`. Archivo propio y no snapshots de Vitest, para que `-u` no lo regenere en silencio.
 *
 * Es UNA secuencia con estado (un recorrido de la vida de una empresa): siembra, invitar a una persona a dos sucursales, rotar y revocar invitaciones, aceptar (y no poder
 * aceptar dos veces), traspasar la gerencia (y los rechazos), el alta del primer gerente por invitación de la plataforma (con CUIT inválido y válido), cambiar módulos y política desde la
 * plataforma, y las reglas de `registrarCambioAuditado`. Después de cada paso se vuelcan el resultado y TODAS las filas de las tablas que tocan, con todas sus columnas, ids
 * reemplazados por nombres simbólicos y lo que cambia por corrida (horas, hashes de tokens) enmascarado.
 */
const ARCHIVO = join(__dirname, "huella-de-gobierno.golden.txt");
const E = "empresa-huella";
const F = "empresa-en-alta";
const AHORA = new Date();
const TOKEN = (n: number) => `T${String(n).padStart(2, "0")}${"h".repeat(40)}`;

afterAll(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.$disconnect();
});

describe("Huella del gobierno de empresa y usuarios", () => {
  const nombres = new Map<string, string>();
  const desconocidos = new Map<string, string>();
  const lineas: string[] = [];
  let ids: Record<string, string>;
  let tokens = 0;
  const generarToken = () => TOKEN(++tokens);

  const simbolo = (valor: string): string => {
    const conocido = nombres.get(valor);
    if (conocido) return conocido;
    if (!/^c[a-z0-9]{20,}$/.test(valor)) return valor;
    if (!desconocidos.has(valor)) desconocidos.set(valor, `id#${desconocidos.size + 1}`);
    return desconocidos.get(valor)!;
  };

  const MASCARAS = new Set(["creadoEn", "creadaEn", "actualizadoEn", "venceEn", "aceptadaEn", "revocadaEn", "hashToken", "ultimoEnvioEn", "enviadaEn"]);
  const fila = (f: Record<string, unknown>): string =>
    Object.keys(f)
      .sort()
      .map((columna) => {
        const v = f[columna];
        if (MASCARAS.has(columna)) return `${columna}=${v === null || v === undefined ? "null" : "<enmascarado>"}`;
        if (v === null || v === undefined) return `${columna}=null`;
        if (v instanceof Date) return `${columna}=<fecha>`;
        if (v instanceof Prisma.Decimal) return `${columna}=${v.toString()}`;
        if (typeof v === "string") return `${columna}=${simbolo(v).replace(/c[a-z0-9]{20,}/g, (id) => simbolo(id))}`;
        return `${columna}=${String(v)}`;
      })
      .join(" ");

  /** Vuelca las tablas de gobierno de las dos empresas, con todas sus columnas. */
  async function volcado(): Promise<string[]> {
    const donde = { empresaId: { in: [E, F] } };
    const filas = async (titulo: string, datos: Record<string, unknown>[]) => datos.map((d) => `  ${titulo} ${fila({ ...d })}`);
    const uemp = await prismaAdmin.usuarioEmpresa.findMany({ where: donde, orderBy: [{ empresaId: "asc" }, { creadoEn: "asc" }, { id: "asc" }] });
    uemp.forEach((u, i) => nombres.set(u.id, `uemp${i + 1}`));
    const usuc = await prismaAdmin.usuarioSucursal.findMany({ where: donde, orderBy: [{ empresaId: "asc" }, { creadoEn: "asc" }, { id: "asc" }] });
    usuc.forEach((u, i) => nombres.set(u.id, `usuc${i + 1}`));
    const invs = await prismaAdmin.invitacion.findMany({ where: donde, orderBy: [{ empresaId: "asc" }, { creadaEn: "asc" }, { id: "asc" }] });
    invs.forEach((u, i) => nombres.set(u.id, `inv${i + 1}`));
    return [
      ...(await filas("EMPRESA", (await prismaAdmin.empresa.findMany({ where: { id: { in: [E, F] } }, orderBy: { id: "asc" } })) as unknown as Record<string, unknown>[])),
      ...(await filas("INVITACION", invs as unknown as Record<string, unknown>[])),
      ...(await filas("INVITACION_SUCURSAL", (await prismaAdmin.invitacionSucursal.findMany({ where: donde, orderBy: [{ invitacionId: "asc" }, { sucursalId: "asc" }] })) as unknown as Record<string, unknown>[])),
      ...(await filas("USUARIO_EMPRESA", uemp as unknown as Record<string, unknown>[])),
      ...(await filas("USUARIO_SUCURSAL", usuc as unknown as Record<string, unknown>[])),
      ...(await filas("MODULO", (await prismaAdmin.moduloEmpresa.findMany({ where: donde, orderBy: [{ empresaId: "asc" }, { modulo: "asc" }] })) as unknown as Record<string, unknown>[])),
      ...(await filas("AUDITORIA", (await prismaAdmin.registroAuditoria.findMany({ where: donde, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] })) as unknown as Record<string, unknown>[])),
    ];
  }

  /** La siembra de una empresa: las claves de lo que crea (roles, permisos por rol, unidades, motivos, destinos, sucursal). */
  async function siembra(empresaId: string, titulo: string): Promise<string[]> {
    const roles = await prismaAdmin.rol.findMany({ where: { empresaId }, orderBy: { clave: "asc" } });
    const permisos = await prismaAdmin.permisoRol.findMany({ where: { rol: { empresaId } }, include: { rol: true }, orderBy: [{ rol: { clave: "asc" } }, { accionClave: "asc" }] });
    return [
      `### ${titulo}`,
      ...roles.map((r) => `  ROL ${fila({ clave: r.clave, nombre: r.nombre, activo: r.activo })}`),
      ...permisos.map((p) => `  PERMISO ${p.rol.clave}:${p.accionClave} ver=${p.puedeVer} editar=${p.puedeEditar}`),
      `  UNIDADES ${(await prismaAdmin.unidad.findMany({ where: { empresaId }, orderBy: { nombre: "asc" } })).map((u) => `${u.nombre}/${u.magnitud}/${u.decimales}`).join(", ")}`,
      `  MOTIVOS ${(await prismaAdmin.motivoMerma.findMany({ where: { empresaId }, orderBy: { nombre: "asc" } })).map((m) => m.nombre).join(", ")}`,
      `  DESTINOS ${(await prismaAdmin.destinoConsumo.findMany({ where: { empresaId }, orderBy: { nombre: "asc" } })).map((d) => d.nombre).join(", ")}`,
      `  SUCURSALES ${(await prismaAdmin.sucursal.findMany({ where: { empresaId }, orderBy: { nombre: "asc" } })).map((s) => `${s.nombre}/${s.activo}`).join(", ")}`,
      `  ACCIONES ${await prismaAdmin.accion.count()}`,
    ];
  }

  beforeEach(async () => {
    nombres.clear();
    desconocidos.clear();
    lineas.length = 0;
    tokens = 0;
    await limpiarBaseDeTest();
  });

  const paso = async (titulo: string, resultado: unknown) => {
    lineas.push(`### ${titulo}`, `  resultado: ${JSON.stringify(resultado, (_, v) => (typeof v === "string" ? simbolo(v).replace(/c[a-z0-9]{20,}/g, (id) => simbolo(id)) : v))}`, ...(await volcado()));
  };

  it("la secuencia entera coincide con lo guardado", async () => {
    // Empresa E activa, sembrada, con su gerente y una segunda sucursal.
    await prismaAdmin.empresa.create({ data: { id: E, nombre: "Empresa huella", slug: "empresa-huella", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
    await prismaAdmin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.empresa_id', ${E}, true)`;
      await sembrarEmpresa(tx, E, "Central");
    });
    const gerente = await prismaAdmin.user.create({ data: { email: "gerente@gmail.com" } });
    const primer = await prismaAdmin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.empresa_id', ${E}, true)`;
      return incorporarPrimerGerente(tx, { empresaId: E, usuarioId: gerente.id });
    });
    const sucursal1 = (await prismaAdmin.sucursal.findFirstOrThrow({ where: { empresaId: E } })).id;
    const rolAdmin = (await prismaAdmin.rol.findFirstOrThrow({ where: { empresaId: E, clave: "admin" } })).id;
    const rolOperador = (await prismaAdmin.rol.findFirstOrThrow({ where: { empresaId: E, clave: "operador" } })).id;
    const sucursal2 = (await prismaAdmin.sucursal.create({ data: { empresaId: E, nombre: "Norte" } })).id;
    await prismaAdmin.usuarioSucursal.create({ data: { usuarioId: gerente.id, sucursalId: sucursal2, empresaId: E, rolId: rolAdmin } });
    const operador = await prismaAdmin.user.create({ data: { email: "plataforma@operador.com" } });
    ids = { E, F, gerente: gerente.id, sucursal1, sucursal2, rolAdmin, rolOperador, operador: operador.id };
    for (const [nombre, id] of Object.entries(ids)) nombres.set(id, nombre);

    lineas.push(...(await siembra(E, "0. Siembra de la empresa (roles, matriz de permisos, unidades, motivos, destinos, sucursal)")));
    await paso("0b. Primer gerente incorporado", primer);

    // 1. Invitar a una persona a dos sucursales (la segunda llamada EXTIENDE la misma invitación).
    const email = "nueva-persona@gmail.com";
    const accesos = [{ sucursalId: sucursal1, rolId: rolOperador }, { sucursalId: sucursal2, rolId: rolAdmin }];
    let ultima: Awaited<ReturnType<typeof asegurarInvitacionDeUsuario>> | undefined;
    for (const acceso of accesos) {
      ultima = await prismaAdmin.$transaction((tx) => asegurarInvitacionDeUsuario(tx, { azar: azarDelProceso, empresaId: E, email, invitadoPorId: gerente.id, acceso, ahora: AHORA, generarToken }));
    }
    await paso("1. Invitar a una persona a dos sucursales", { ...ultima, token: ultima && "token" in ultima && ultima.token ? "<token>" : null });
    const pendiente = await prismaAdmin.invitacion.findFirstOrThrow({ where: { email, estado: "PENDIENTE" } });

    // 2. Rotar el enlace de la pendiente y volver a invitar al mismo acceso (sin cambios).
    const rotada = await prismaAdmin.$transaction((tx) => rotarInvitacionPendiente(tx, { azar: azarDelProceso, empresaId: E, invitacionId: pendiente.id, actorId: gerente.id, ahora: AHORA, generarToken }));
    await paso("2. Rotar el enlace de la invitación pendiente", { ...rotada, token: rotada.ok && rotada.token ? "<token>" : null });
    const tokenVigente = rotada.ok && rotada.token ? rotada.token : TOKEN(1);

    // 3. Aceptar: crea la cuenta en la empresa, una membresía por sucursal y audita con quien otorgó como actor.
    const persona = await prismaAdmin.user.create({ data: { email } });
    nombres.set(persona.id, "persona");
    const aceptada = await aceptarInvitacionDeUsuarioDelToken({ token: tokenVigente, usuario: { id: persona.id, email } }, requierePermiso);
    await paso("3. Aceptar la invitación de usuario", aceptada);

    // 4. El enlace es de un solo uso.
    await paso("4. Aceptar de nuevo el mismo enlace", await aceptarInvitacionDeUsuarioDelToken({ token: tokenVigente, usuario: { id: persona.id, email } }, requierePermiso));
    await paso("4b. Un enlace que no existe", await aceptarInvitacionDeUsuarioDelToken({ token: `nada${"x".repeat(40)}`, usuario: { id: persona.id, email } }, requierePermiso));

    // 5. Invitar a otra persona y revocar su invitación.
    const otra = await prismaAdmin.$transaction((tx) => asegurarInvitacionDeUsuario(tx, { azar: azarDelProceso, empresaId: E, email: "otra@gmail.com", invitadoPorId: gerente.id, acceso: { sucursalId: sucursal1, rolId: rolOperador }, ahora: AHORA, generarToken }));
    const otraInv = await prismaAdmin.invitacion.findFirstOrThrow({ where: { email: "otra@gmail.com", estado: "PENDIENTE" } });
    const revocada = await prismaAdmin.$transaction((tx) => revocarInvitacionPendiente(tx, { empresaId: E, invitacionId: otraInv.id, actorId: gerente.id, ahora: AHORA }));
    await paso("5. Invitar a otra persona y revocar su invitación", { invitada: { ...otra, token: otra.ok && otra.token ? "<token>" : null }, revocada });

    // 6. Traspasar la gerencia: rechazos y éxito.
    const traspaso = (usuarioDestinoId: string) => prismaAdmin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.empresa_id', ${E}, true)`;
      return transferirGerenciaDeEmpresa(tx, { empresaId: E, usuarioDestinoId });
    });
    const extraño = await prismaAdmin.user.create({ data: { email: "extrano@gmail.com" } });
    nombres.set(extraño.id, "extraño");
    await paso("6a. Traspaso a alguien que no es de la empresa", await traspaso(extraño.id));
    await paso("6b. Traspaso a quien ya es el gerente", await traspaso(gerente.id));
    await paso("6c. Traspaso a la persona nueva (admin en Norte)", await traspaso(persona.id));

    // 7. El primer gerente de una empresa en alta, por invitación de la plataforma.
    await prismaAdmin.empresa.create({ data: { id: F, nombre: "Empresa en alta", slug: "empresa-en-alta", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "PROVISIONING" } });
    await prismaAdmin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.empresa_id', ${F}, true)`;
      await sembrarEmpresa(tx, F, "Casa central");
    });
    lineas.push(...(await siembra(F, "7. Siembra de una empresa en alta")));
    const dueño = await prismaAdmin.user.create({ data: { email: "dueno@gmail.com" } });
    nombres.set(dueño.id, "dueño");
    const tokenGerente = `G01${"g".repeat(40)}`;
    await prismaAdmin.invitacion.create({ data: { empresaId: F, email: "dueno@gmail.com", rolEmpresa: "gerente", hashToken: hashDeToken(tokenGerente), venceEn: new Date(Date.now() + 3_600_000) } });
    await paso("7a. Aceptar con un CUIT inválido", await aceptarInvitacionDelToken({ token: tokenGerente, usuario: { id: dueño.id, email: "dueno@gmail.com" }, cuit: "123" }));
    await paso("7b. Aceptar con un CUIT válido", await aceptarInvitacionDelToken({ token: tokenGerente, usuario: { id: dueño.id, email: "dueno@gmail.com" }, cuit: "30-71234567-1" }));
    await paso("7c. Aceptar otra vez el mismo enlace", await aceptarInvitacionDelToken({ token: tokenGerente, usuario: { id: dueño.id, email: "dueno@gmail.com" }, cuit: "30-71234567-1" }));

    // 8. La plataforma cambia módulos y política (por script).
    await paso("8a. Activar módulos", await cambiarModulosDeEmpresa(prismaAdmin, { slug: "empresa-huella", actorEmail: "plataforma@operador.com", activar: ["stock", "salon"] }));
    await paso("8b. Desactivar un módulo y activar otro", await cambiarModulosDeEmpresa(prismaAdmin, { slug: "empresa-huella", actorEmail: "plataforma@operador.com", activar: ["carta"], desactivar: ["salon"] }));
    await paso("8c. Repetir el mismo pedido (sin cambios)", await cambiarModulosDeEmpresa(prismaAdmin, { slug: "empresa-huella", actorEmail: "plataforma@operador.com", activar: ["carta"] }));
    await paso("8d. Perfil lite de política", await cambiarPoliticaDeEmpresa(prismaAdmin, { slug: "empresa-huella", actorEmail: "plataforma@operador.com", perfil: "lite" }));
    await paso("8e. Una perilla suelta que pisa el perfil", await cambiarPoliticaDeEmpresa(prismaAdmin, { slug: "empresa-huella", actorEmail: "plataforma@operador.com", dosPaneles: true }));

    // 9. Las reglas de registrarCambioAuditado: no escribe si no cambió nada, y convierte todo a texto.
    await prismaAdmin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.empresa_id', ${E}, true)`;
      const base = { entidad: "Empresa" as const, entidadId: E, descripcion: "Prueba", actorId: gerente.id };
      await registrarCambioAuditado(tx, { ...base, campo: "igual", valorAnterior: 5, valorNuevo: "5" }); // mismo texto: no escribe
      await registrarCambioAuditado(tx, { ...base, campo: "nulos", valorAnterior: null, valorNuevo: undefined }); // ambos vacíos: no escribe
      await registrarCambioAuditado(tx, { ...base, campo: "numero", valorAnterior: 5, valorNuevo: 7.5 });
      await registrarCambioAuditado(tx, { ...base, campo: "booleano", valorAnterior: true, valorNuevo: false });
      await registrarCambioAuditado(tx, { ...base, campo: "alta", valorAnterior: null, valorNuevo: "algo", sucursalId: sucursal1 });
      await registrarCambioAuditado(tx, { ...base, campo: "baja", valorAnterior: "algo", valorNuevo: null });
    });
    await paso("9. registrarCambioAuditado: no-op, número, booleano, alta y baja", "ver filas AUDITORIA");

    const actual = lineas.join("\n") + "\n";
    expect(actual.length).toBeGreaterThan(8_000); // si el escenario no armó nada, esto no está mirando nada

    if (process.env.REGENERAR_HUELLA_DE_GOBIERNO === "1") {
      mkdirSync(__dirname, { recursive: true });
      writeFileSync(ARCHIVO, actual, "utf8");
      return;
    }
    expect(existsSync(ARCHIVO), "falta huella-de-gobierno.golden.txt: generalo contra el código ANTERIOR a la mudanza").toBe(true);
    expect(actual.replace(/\r\n/g, "\n")).toBe(readFileSync(ARCHIVO, "utf8").replace(/\r\n/g, "\n"));
  }, 120_000);
});
