# Build stage
FROM node:20-alpine AS deps

WORKDIR /app

# Copy root workspace manifest
COPY package.json package-lock.json ./

# Copy package.json files for workspaces
COPY packages/sdk/package.json ./packages/sdk/
COPY apps/dashboard/package.json ./apps/dashboard/

# Install all workspace deps
RUN npm ci --ignore-scripts

# Builder stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/package-lock.json ./package-lock.json

# Copy source
COPY packages/sdk ./packages/sdk
COPY apps/dashboard ./apps/dashboard
COPY tsconfig.json ./

# Build SDK first
RUN npm run build --workspace=packages/sdk

# Build Next.js
RUN npm run build --workspace=apps/dashboard

# Runtime stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/dashboard/public ./apps/dashboard/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/dashboard/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/dashboard/.next/static ./apps/dashboard/.next/static

USER nextjs

EXPOSE 3000

ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

CMD ["node", "apps/dashboard/server.js"]


