/**
 * El administrador de la demo (el usuario que los seeds de la demo dan de alta como primer admin de «La Cuadra» y con el que entra la sesión del e2e de la demo). Antes era un correo fijo en
 * cuatro archivos; ahora sale de la variable de entorno `MOTOR2_DEMO_ADMIN_EMAIL` (por ejemplo en el `.env` local de quien siembra la demo), con un valor genérico por defecto.
 *
 * Todo nace cerrado: sin la variable se usa un correo genérico que NO existe en la base de la demo, y los seeds y el e2e piden que ese usuario YA exista (`findUniqueOrThrow`), así que quien no la
 * declara ve un error claro y no entra nadie por accidente. Una variable declarada pero con forma rara se RECHAZA (lista de permitidos: letras, números y `._%+-` antes de la arroba; dominio con
 * puntos y un sufijo de letras), no se «arregla». Los seeds solo corren contra una base local `_demo` (`guardas-destino.ts`): la variable no hace falta en el CI ni en Vercel.
 */
type Entorno = Record<string, string | undefined>;

export const VARIABLE_DEL_ADMIN_DE_LA_DEMO = "MOTOR2_DEMO_ADMIN_EMAIL";
export const EMAIL_ADMIN_DE_LA_DEMO_POR_DEFECTO = "admin-demo@ejemplo.test";

const LARGO_MAXIMO = 254;
const FORMA_DE_CORREO = /^[a-z0-9._%+-]{1,64}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/;

/** El correo del administrador de la demo: el de `MOTOR2_DEMO_ADMIN_EMAIL` (recortado y en minúsculas) o el genérico si no está (o está vacío). Lanza si la variable tiene una forma que no se admite. */
export function emailAdminDeLaDemo(env: Entorno): string {
  const crudo = env[VARIABLE_DEL_ADMIN_DE_LA_DEMO];
  if (crudo === undefined || crudo.trim() === "") return EMAIL_ADMIN_DE_LA_DEMO_POR_DEFECTO;
  const correo = crudo.trim().toLowerCase();
  if (correo.length > LARGO_MAXIMO || !FORMA_DE_CORREO.test(correo)) {
    throw new Error(`${VARIABLE_DEL_ADMIN_DE_LA_DEMO} no tiene forma de correo (usuario@dominio.ext, en minúsculas, sin espacios).`);
  }
  return correo;
}
