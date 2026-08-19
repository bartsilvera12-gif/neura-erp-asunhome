/**
 * Envío de email vía SMTP (nodemailer). Config 100% por variables de entorno,
 * sin credenciales hardcodeadas. Si falta configuración, `sendMail` NO lanza:
 * devuelve { skipped: true } para no romper el flujo que lo invoca.
 *
 * Variables de entorno:
 *   SMTP_HOST       host del servidor SMTP           (obligatoria)
 *   SMTP_PORT       puerto (default 587)
 *   SMTP_SECURE     "true" para TLS directo (465)    (default false)
 *   SMTP_USER       usuario / cuenta                 (obligatoria)
 *   SMTP_PASS       contraseña / app password        (obligatoria)
 *   SMTP_FROM       remitente (default info@neura.com.py)
 */
import nodemailer, { type Transporter } from "nodemailer";

export const EMAIL_FROM_DEFAULT = "info@neura.com.py";

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function isEmailConfigured(): boolean {
  return !!env("SMTP_HOST") && !!env("SMTP_USER") && !!env("SMTP_PASS");
}

let cached: Transporter | null = null;
function transporter(): Transporter {
  if (cached) return cached;
  cached = nodemailer.createTransport({
    host: env("SMTP_HOST"),
    port: Number(env("SMTP_PORT")) || 587,
    secure: env("SMTP_SECURE") === "true",
    auth: { user: env("SMTP_USER"), pass: env("SMTP_PASS") },
  });
  return cached;
}

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export type SendMailResult =
  | { ok: true; skipped?: false; messageId: string }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped?: false; error: string };

/** Envía un email. Nunca lanza: reporta el resultado. */
export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  if (!isEmailConfigured()) {
    return { ok: false, skipped: true, reason: "SMTP no configurado (faltan SMTP_HOST/SMTP_USER/SMTP_PASS)." };
  }
  try {
    const info = await transporter().sendMail({
      from: input.from || env("SMTP_FROM") || EMAIL_FROM_DEFAULT,
      to: input.to,
      subject: input.subject,
      html: input.html,
    });
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error al enviar email." };
  }
}
