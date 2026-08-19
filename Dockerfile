# syntax=docker/dockerfile:1
# =============================================================================
# ASUNHOME ERP — imagen de producción (alternativa a Nixpacks)
#
# El deploy por defecto de estos ERP es Nixpacks, igual que Ferrecolor.
# Este Dockerfile existe solo como respaldo si Nixpacks falla en el server.
# Corre `next start` sobre .next/ regular: next.config.ts NO usa
# output:"standalone" a propósito (ver el comentario ahí).
# =============================================================================

FROM node:22-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Las NEXT_PUBLIC_* se inlinean en `next build`: deben llegar como build args.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SUPER_ADMIN_EMAILS
ARG NEXT_PUBLIC_WHATSAPP_LINK_PHONE_NUMBER
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SUPER_ADMIN_EMAILS=$NEXT_PUBLIC_SUPER_ADMIN_EMAILS \
    NEXT_PUBLIC_WHATSAPP_LINK_PHONE_NUMBER=$NEXT_PUBLIC_WHATSAPP_LINK_PHONE_NUMBER

RUN npm run build && npm prune --omit=dev

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts

EXPOSE 3000
CMD ["npm", "run", "start"]
