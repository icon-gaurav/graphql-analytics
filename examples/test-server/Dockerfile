# Build stage
FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/sdk-core/package.json ./packages/sdk-core/
COPY packages/sdk-apollo/package.json ./packages/sdk-apollo/
COPY packages/sdk-express/package.json ./packages/sdk-express/
COPY packages/sdk-fastify/package.json ./packages/sdk-fastify/
COPY apps/dashboard/package.json ./apps/dashboard/
COPY examples/test-server/package.json ./examples/test-server/

RUN npm ci --ignore-scripts

# Builder stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/package-lock.json ./package-lock.json

COPY packages ./packages
COPY apps ./apps
COPY examples ./examples
COPY tsconfig.json ./

RUN npm run build --workspace=packages/sdk-core
RUN npm run build --workspace=packages/sdk-apollo
RUN npm run build --workspace=examples/test-server

# Runtime stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/examples/test-server ./examples/test-server
COPY --from=builder /app/packages/sdk-core ./packages/sdk-core
COPY --from=builder /app/packages/sdk-apollo ./packages/sdk-apollo

EXPOSE 4000

CMD ["node", "examples/test-server/dist/server.js"]

