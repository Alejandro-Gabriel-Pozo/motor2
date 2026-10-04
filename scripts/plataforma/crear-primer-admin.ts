/**
 * Alta de un administrador de plataforma (ADR-012 §2, ADR-019): se corre UNA vez por instalación, a mano, por el dueño. No existe una pantalla para esto.
 *
 * Uso: DOTENV_CONFIG_PATH=.env.plataforma.<despliegue> npm run plataforma:crear-admin -- --email dueno@ejemplo.com --nombre "Nombre Apellido"
 *
 * Necesita, en ese archivo FUERA del repositorio (nunca en Git ni en un chat), las mismas tres variables que el proyecto de Vercel de la consola:
 *   PLATAFORMA_DATABASE_URL (rol `motor2_plataforma`), PLATAFORMA_SECRETO_CODIGOS y PLATAFORMA_CLAVE_TOTP (ver .env.example). Si el secreto o la clave no son
 *   exactamente los de la consola, el administrador se crea pero no podría ingresar: por eso se leen con las mismas validaciones que la consola.
 *
 * Imprime UNA sola vez el secreto TOTP (para escanear con la app autenticadora) y los códigos de recuperación; la base guarda el secreto cifrado y solo el
 * hash de cada código, así que no se pueden volver a ver. No es idempotente: si el email ya existe, falla sin tocar nada.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { prismaPlataforma as prisma } from "../cliente-plataforma";
import { leerEntornoDePlataforma } from "../../plataforma/src/entorno";
import { AdminDePlataformaInvalidoError, crearAdminDePlataforma } from "../../src/core/plataforma/primer-admin";

async function main() {
  const { values } = parseArgs({ options: { email: { type: "string" }, nombre: { type: "string" } }, strict: true });
  // Mismas validaciones que la consola (variables presentes, secreto ≥ 32 caracteres, clave de 32 bytes, usuario de la conexión = rol de plataforma).
  const entorno = leerEntornoDePlataforma(process.env);
  const creado = await crearAdminDePlataforma(
    prisma,
    { email: values.email ?? "", nombre: values.nombre ?? "" },
    { claveTotp: entorno.PLATAFORMA_CLAVE_TOTP, secretoCodigos: entorno.PLATAFORMA_SECRETO_CODIGOS },
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
}

main()
  .catch((error: unknown) => {
    if (error instanceof AdminDePlataformaInvalidoError) console.error(`Error: ${error.message}`);
    else console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
