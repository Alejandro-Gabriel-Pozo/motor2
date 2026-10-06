import * as Sentry from "@sentry/nextjs";
import { limpiarEventoSentry } from "@/lib/sentry-limpiar";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  beforeSend: limpiarEventoSentry,
  beforeSendTransaction: limpiarEventoSentry,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
