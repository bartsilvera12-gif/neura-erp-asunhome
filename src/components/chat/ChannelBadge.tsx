"use client";

import type { ReactNode } from "react";
import { Facebook, Instagram, Linkedin, Mail, MessageCircle } from "lucide-react";

const LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  email: "Email",
  linkedin: "LinkedIn",
};

export function channelTypeLabel(type: string | null | undefined): string {
  const raw = typeof type === "string" ? type : "";
  const k = raw.trim().toLowerCase();
  return LABELS[k] ?? (raw.trim() || "Canal");
}

export function ChannelBadge({
  type,
  nombre,
  className = "",
}: {
  type: string | null | undefined;
  nombre: string | null;
  className?: string;
}) {
  const raw = typeof type === "string" ? type : type != null ? String(type) : "";
  const t = raw.trim().toLowerCase() || "whatsapp";
  const label = nombre?.trim() || channelTypeLabel(t);
  const iconClass = "h-3.5 w-3.5 shrink-0 opacity-90";
  let icon: ReactNode;
  switch (t) {
    case "instagram":
      icon = <Instagram className={iconClass} aria-hidden />;
      break;
    case "facebook":
      icon = <Facebook className={iconClass} aria-hidden />;
      break;
    case "email":
      icon = <Mail className={iconClass} aria-hidden />;
      break;
    case "linkedin":
      icon = <Linkedin className={iconClass} aria-hidden />;
      break;
    default:
      icon = <MessageCircle className={iconClass} aria-hidden />;
      break;
  }

  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 ${className}`}
      title={label}
    >
      {icon}
      <span className="truncate">{label}</span>
    </span>
  );
}
