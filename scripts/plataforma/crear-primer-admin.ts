/**
 * Alta de un administrador de plataforma (ADR-012 §2, ADR-019): se corre UNA vez por instalación, a mano, por el dueño. No existe una pantalla para esto.
 *
 * Uso: DOTENV_CONFIG_PATH=.env.plataforma.<despliegue> npm run plataforma:crear-admin -- --email dueno@ejemplo.com --nombre "Nombre Apellido"
 *
 * Necesita, en ese archivo FUERA del repositorio (nunca en Git ni en un chat), las mismas variables que el proyecto de Vercel de la consola:
 *   PLATAFORMA_DATABASE_URL (rol `motor2_plataforma`), PLATAFORMA_SECRETO_CODIGOS, PLATAFORMA_CLAVE_TOTP y, si la consola administra más de una
 *   instalación (ADR-025), también PLATAFORMA_INSTALACIONES_ADICIONALES y cada PLATAFORMA_DATABASE_URL_<ID> — SIN ELLAS el alta revisa solo la
 *   instalación principal y un usuario (o una invitación pendiente) de otra instalación podría quedar, además, como administrador de plataforma. Si
 *   el secreto o la clave no son exactamente los de la consola, el administrador se crea pero no podría ingresar: por eso se leen con las mismas
 *   validaciones que la consola.
 *
 * Antes de crear nada imprime qué instalaciones revisó (nunca una URL): confirmá que la lista incluye todas las que esperás. Si alguna adicional no
 * responde, el alta se ABORTA SIN CREAR NADA — a diferencia de las pantallas de la consola, que toleran una instalación caída (ADR-025 §4): acá el
 * alta es irreversible en la práctica (el TOTP y los códigos se muestran una sola vez) y crea un sujeto con poder sobre TODAS las instalaciones, así
 * que sin poder revisar una no hay forma de saber si el email ya es un usuario ahí. Reintentar es gratis.
 *
 * Imprime UNA sola vez el secreto TOTP (para escanear con la app autenticadora) y los códigos de recuperación; la base guarda el secreto cifrado y solo el
 * hash de cada código, así que no se pueden volver a ver. No es idempotente: si el email ya existe, falla sin tocar nada.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { clienteDePlataforma, prismaPlataforma as prisma } from "../cliente-plataforma";
import { leerEntornoDePlataforma, leerInstalaciones, variableDeConexionDe } from "../../plataforma/src/entorno";
import {
  AdminDePlataformaInvalidoError,
  crearAdminDePlataforma,
  InstalacionNoRevisableError,
  type InstalacionARevisar,
} from "../../src/core/plataforma/primer-admin";

async function main() {
  const { values } = parseArgs({ options: { email: { type: "string" }, nombre: { type: "string" } }, strict: true });
  // Mismas validaciones que la consola (variables presentes, secreto ≥ 32 caracteres, clave de 32 bytes, usuario de la conexión = rol de plataforma).
  const entorno = leerEntornoDePlataforma(process.env);
  const instalaciones = leerInstalaciones(process.env);
  // La principal no abre un segundo cliente: `prisma` (PLATAFORMA_DATABASE_URL) ya apunta a esa base.
  const otrasBases: InstalacionARevisar[] = instalaciones
    .filter((i) => !i.principal)
    .map((i) => ({ id: i.id, nombre: i.nombre, db: clienteDePlataforma(i.databaseUrl) }));

  console.log(`Instalaciones que se revisan: ${instalaciones.map((i) => (i.principal ? `${i.id} (principal)` : i.id)).join(", ")}.`);

  try {
    const creado = await crearAdminDePlataforma(
      prisma,
      { email: values.email ?? "", nombre: values.nombre ?? "" },
      { claveTotp: entorno.PLATAFORMA_CLAVE_TOTP, secretoCodigos: entorno.PLATAFORMA_SECRETO_CODIGOS },
      { otrasBases },
    );

    console.log(`Administrador de plataforma creado: ${creado.email} (id ${creado.id}).`);
    console.log("");
    console.log("GUARDÁ ESTO AHORA: no se vuelve a mostrar.");
    console.log("");
    console.log("Segundo factor (app autenticadora): agregá una cuenta con esta clave o con este enlace.");
    console.log(`  Clave:  ${creado.secretoTotp}`);
    console.log(`  Enlace: ${creado.uriOtpauth}`);
    console.log("");
    console.log("Códigos de recuperación (cada uno sirve una sola vez, en lugar del código de la app):");
    for (const codigo of creado.codigosDeRecuperacion) console.log(`  ${codigo}`);
  } finally {
    await Promise.allSettled([prisma.$disconnect(), ...otrasBases.map((b) => b.db.$disconnect())]);
  }
}

main().catch((error: unknown) => {
  if (error instanceof InstalacionNoRevisableError) {
    console.error(`Error: ${error.message}`);
    console.error(`No se creó ningún administrador. Revisá ${variableDeConexionDe(error.instalacionId)} y volvé a intentar.`);
  } else if (error instanceof AdminDePlataformaInvalidoError) {
    console.error(`Error: ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});
