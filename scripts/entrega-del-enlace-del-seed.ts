/**
 * Cómo se entrega el enlace de la invitación de vinculación que crea `prisma/seed.ts --gerente` (S-33). El enlace lleva el token que da acceso a la cuenta del gerente: imprimirlo por
 * defecto lo deja en los logs de un CI o en el historial de una terminal compartida. Por eso NO se imprime salvo con `--mostrar-enlace`; por defecto sale por el canal de correo, como lo
 * hace la app, y si el canal no está configurado no se entrega por ningún lado (la invitación queda pendiente: se reenvía desde la app, o se vuelve a correr el seed con el flag, que rota el
 * token). Puro e inyectable (`imprimir`, `enviarPorCorreo`) para poder probar que el token no sale a ninguna línea impresa por defecto.
 */
export type EntregaDelEnlace = "mostrar" | "enviar-por-correo" | "no-entregar";

export function decidirEntregaDelEnlace(opciones: { mostrarEnlace: boolean; correoConfigurado: boolean }): EntregaDelEnlace {
  if (opciones.mostrarEnlace) return "mostrar";
  return opciones.correoConfigurado ? "enviar-por-correo" : "no-entregar";
}

export async function entregarEnlaceDelSeed(entrada: {
  entrega: EntregaDelEnlace;
  email: string;
  /** El enlace completo (lleva el token). SOLO se lee en la rama «mostrar». */
  enlace: string;
  enviarPorCorreo: () => Promise<{ enviado: boolean; motivo?: string | undefined }>;
  imprimir: (linea: string) => void;
}): Promise<void> {
  if (entrada.entrega === "mostrar") {
    entrada.imprimir(`Para entrar con Google la primera vez, abrí: ${entrada.enlace}`);
    return;
  }
  if (entrada.entrega === "enviar-por-correo") {
    const resultado = await entrada.enviarPorCorreo();
    entrada.imprimir(
      resultado.enviado
        ? `La invitación para entrar con Google salió por correo a ${entrada.email}.`
        : `No se pudo mandar la invitación por correo (${resultado.motivo ?? "motivo desconocido"}). Volvé a correr con --mostrar-enlace para imprimir el enlace, o reenviala desde la app.`,
    );
    return;
  }
  entrada.imprimir(
    `No se entregó el enlace de la invitación para entrar con Google: el canal de correo de avisos no está configurado en este entorno y el enlace no se imprime por defecto. Volvé a correr con --mostrar-enlace para imprimirlo (renueva el enlace), o reenviá la invitación desde la app.`,
  );
}
