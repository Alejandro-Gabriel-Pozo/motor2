import "dotenv/config";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { prisma } from "../src/lib/db";
import { dbDeEmpresa, transaccionDeEmpresa } from "../src/core/auth/base";
import { asegurarInvitacionDeVinculacion, rotarInvitacionPendiente } from "../src/server/actions/auth/casos-de-uso/invitaciones-de-usuario-en-tx";
import { enviarInvitacionYAnotar } from "../src/server/actions/auth/casos-de-uso/enviar-invitacion-y-anotar";
import { enlaceDeInvitacion, urlPublicaDeLaApp } from "../src/core/features/empresa/invitacion";
import { configuracionDelCanal } from "../src/core/correo/configuracion";
import { incorporarPrimerGerente } from "../src/server/actions/auth/casos-de-uso/incorporar-primer-gerente-en-tx";
import { ACCIONES } from "../src/core/permisos/acciones";
import { azarDelProceso } from "../src/lib/azar";
import { confirmarDestinoRemoto, resolverDestinoDelSeedBase } from "../scripts/demo-seed/guardas-destino";
import { decidirEntregaDelEnlace, entregarEnlaceDelSeed } from "../scripts/entrega-del-enlace-del-seed";

/** Lee una línea de la terminal (la confirmación de una base remota). */
async function preguntar(texto: string): Promise<string> {
  const lector = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await lector.question(texto);
  } finally {
    lector.close();
  }
}

async function main() {
  // La empresa a sembrar se indica (ADR-022: ya no existe «la única empresa activa» como respaldo): `--empresa <slug>`, o, sin argumento, la empresa por defecto que crea
  // la migración multiempresa_estructura (ADR-007, A2; id `empresa_principal`). `Empresa` no tiene RLS: se la busca con el cliente global.
  // S-33: `--permitir-remoto` (sembrar una base que no es local, con confirmación interactiva) y `--mostrar-enlace` (imprimir el enlace con el token, que por defecto NO se imprime).
  const { values } = parseArgs({
    options: { empresa: { type: "string" }, gerente: { type: "string" }, "permitir-remoto": { type: "boolean" }, "mostrar-enlace": { type: "boolean" } },
    strict: true,
  });

  // S-33: ANTES de tocar la base. Este seed escribe en la `DATABASE_URL` del `.env` (la de la app, o la que haya quedado cargada en la terminal): solo un Postgres local, nunca producción/Vercel,
  // y una base real únicamente con `--permitir-remoto` más una confirmación interactiva que muestra el host y la base (nunca la clave).
  const destino = resolverDestinoDelSeedBase(process.env, { permitirRemoto: values["permitir-remoto"] === true });
  console.log(`Destino: ${destino.host}, base "${destino.nombre}"${destino.remoto ? " (REMOTA)" : ""}.`);
  await confirmarDestinoRemoto(destino, preguntar, Boolean(process.stdin.isTTY && process.stdout.isTTY));

  const { id: empresaId } = await prisma.empresa.findFirstOrThrow({ where: values.empresa ? { slug: values.empresa } : { id: "empresa_principal" } });
  // Todo lo que sigue es de esa empresa: cada operación corre con `app.empresa_id` fijado (el DEFAULT de `empresaId` y el RLS la ven).
  const db = dbDeEmpresa(empresaId);

  // Roles: catálogo único compartido por todo el negocio (ver plan,
  // "Roles/permisos" — decisión confirmada con el dueño tras investigar
  // ERPNext/Dolibarr).
  const [admin, operador] = await Promise.all([
    db.rol.upsert({ where: { empresaId_clave: { empresaId, clave: "admin" } }, update: {}, create: { nombre: "admin", clave: "admin" } }),
    db.rol.upsert({ where: { empresaId_clave: { empresaId, clave: "operador" } }, update: {}, create: { nombre: "operador", clave: "operador" } }),
  ]);
  const rolesPorNombre = { admin, operador } as const;

  for (const accion of ACCIONES) {
    await db.accion.upsert({
      where: { clave: accion.clave },
      update: { descripcion: accion.descripcion },
      create: { clave: accion.clave, descripcion: accion.descripcion },
    });

    for (const nombreRol of ["admin", "operador"] as const) {
      const puedeEditar = (accion.rolesEditarSemilla as readonly string[]).includes(nombreRol);
      // Ver arranca igual a Editar — mismo estado que "Roles Ver" vacío en
      // Apps Script (Core.js:1283-1287).
      await db.permisoRol.upsert({
        where: {
          rolId_accionClave: { rolId: rolesPorNombre[nombreRol].id, accionClave: accion.clave },
        },
        update: {},
        create: {
          rolId: rolesPorNombre[nombreRol].id,
          accionClave: accion.clave,
          puedeEditar,
          puedeVer: puedeEditar,
        },
      });
    }
  }

  // Sucursal inicial — punto de anclaje para el bootstrap del primer admin
  // (ver src/core/auth/bootstrap.ts).
  await db.sucursal.upsert({
    where: { empresaId_nombre: { empresaId, nombre: "Central" } },
    update: {},
    create: { nombre: "Central" },
  });

  // Unidades base — semilla mínima para poder cargar el primer producto sin
  // pasar antes por la pantalla de Unidades. Decimales por defecto según
  // magnitud, mismo criterio que DECIMALES_DEFAULT_POR_CATEGORIA_
  // (Catalogo.js:2671).
  const unidadesBase: Array<{ nombre: string; magnitud: "PESO" | "VOLUMEN" | "CANTIDAD"; decimales: number }> = [
    { nombre: "kg", magnitud: "PESO", decimales: 2 },
    { nombre: "g", magnitud: "PESO", decimales: 0 },
    { nombre: "l", magnitud: "VOLUMEN", decimales: 2 },
    { nombre: "ml", magnitud: "VOLUMEN", decimales: 0 },
    { nombre: "unidad", magnitud: "CANTIDAD", decimales: 0 },
  ];
  for (const u of unidadesBase) {
    await db.unidad.upsert({ where: { empresaId_nombre: { empresaId, nombre: u.nombre } }, update: {}, create: u });
  }

  // Primer gerente de una instalación LOCAL: reemplaza al viejo BOOTSTRAP_ADMIN_EMAILS (ADR-022). En producción el primer gerente llega por la invitación de la consola de plataforma.
  if (values.gerente) {
    const email = values.gerente.trim().toLowerCase();
    const usuario = await prisma.user.upsert({ where: { email }, update: {}, create: { email } });
    const r = await incorporarPrimerGerente(db, { empresaId, usuarioId: usuario.id });
    console.log(r.ok ? `Gerente: ${email} (admin de "${r.sucursalNombre}").` : `Gerente NO asignado: ${r.mensaje}`);

    // E8 (ADR-024): sin el enlace automático de cuentas por email, un usuario que ya existe solo entra con Google si vincula su cuenta con una invitación. Para poder entrar se crea la
    // invitación de vinculación del gerente (a su propio nombre). Si ya había una pendiente, se renueva (el token no se puede recuperar de la base). S-33: el enlace lleva el token y NO se
    // imprime por defecto (iría a los logs de un CI o al historial de una terminal compartida): sale por el canal de correo como lo hace la app, o se imprime con `--mostrar-enlace`.
    const conGoogle = await prisma.account.count({ where: { userId: usuario.id, provider: "google" } });
    if (r.ok && conGoogle === 0) {
      const ahora = new Date();
      const invitacion = await transaccionDeEmpresa(empresaId, async (tx) => {
        const previa = await tx.invitacion.findFirst({ where: { empresaId, email, estado: "PENDIENTE", rolEmpresa: "vinculacion" }, select: { id: true } });
        return previa
          ? rotarInvitacionPendiente(tx, { empresaId, invitacionId: previa.id, actorId: usuario.id, ahora, azar: azarDelProceso })
          : asegurarInvitacionDeVinculacion(tx, { empresaId, email, invitadoPorId: usuario.id, ahora, azar: azarDelProceso });
      });
      if (!invitacion.ok || !invitacion.token) {
        console.log("No se pudo crear la invitación de vinculación del gerente.");
      } else {
        const { invitacionId, token } = invitacion;
        const base = urlPublicaDeLaApp(process.env.AUTH_URL) ?? "http://localhost:3000";
        await entregarEnlaceDelSeed({
          entrega: decidirEntregaDelEnlace({ mostrarEnlace: values["mostrar-enlace"] === true, correoConfigurado: configuracionDelCanal("avisos", process.env) !== null }),
          email,
          enlace: enlaceDeInvitacion(base, token),
          enviarPorCorreo: () => enviarInvitacionYAnotar(db, { empresaId, emailDeQuienInvita: email, ahora, invitacionId, token, tipo: "vinculacion" }),
          imprimir: (linea) => console.log(linea),
        });
      }
    }
  }

  console.log(
    `Seed OK: ${ACCIONES.length} acciones, roles admin/operador, sucursal "Central", ${unidadesBase.length} unidades base.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
