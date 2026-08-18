"use client";

import type { LucideIcon } from "lucide-react";
import { Facebook, Instagram, Linkedin, Mail, MessageCircle } from "lucide-react";

/** Tipos de canal mostrados fijos en Configuración > Canales (Etapa 1). */
export const OMNICHANNEL_CARD_TYPES = ["whatsapp", "facebook", "instagram", "linkedin", "email"] as const;
export type OmnichannelCardType = (typeof OMNICHANNEL_CARD_TYPES)[number];

export type OmnichannelCardDefinition = {
  type: OmnichannelCardType;
  label: string;
  defaultProvider: string;
  icon: LucideIcon;
};

export const OMNICHANNEL_CARD_DEFINITIONS: OmnichannelCardDefinition[] = [
  { type: "whatsapp", label: "WhatsApp", defaultProvider: "meta", icon: MessageCircle },
  { type: "facebook", label: "Facebook Messenger", defaultProvider: "meta", icon: Facebook },
  { type: "instagram", label: "Instagram", defaultProvider: "meta", icon: Instagram },
  { type: "linkedin", label: "LinkedIn", defaultProvider: "oauth", icon: Linkedin },
  { type: "email", label: "Email", defaultProvider: "smtp", icon: Mail },
];

export function isOmnichannelCardType(s: string): s is OmnichannelCardType {
  return (OMNICHANNEL_CARD_TYPES as readonly string[]).includes(s);
}
