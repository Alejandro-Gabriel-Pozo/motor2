/**
 * Un tope de tiempo para no colgar el inicio ni una pantalla por una base ajena caída o lenta (ADR-025 §4): una instalación que no responde a tiempo
 * se da por caída, nunca cuelga el pedido a las demás.
 */
export const TOPE_DE_LECTURA_DE_OTRA_BASE_MS = 5_000;

/** Rechaza si la promesa no termina antes de `ms`. El temporizador se limpia siempre (no deja el proceso colgado). */
export function conTiempoLimite<T>(promesa: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolver, rechazar) => {
    const temporizador = setTimeout(() => rechazar(new Error("tiempo agotado")), ms);
    promesa.then(
      (valor) => {
        clearTimeout(temporizador);
        resolver(valor);
      },
      (error) => {
        clearTimeout(temporizador);
        rechazar(error);
      },
    );
  });
}
