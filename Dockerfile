# Signaling service image (Railway). Context = repo root.
FROM node:20-alpine

WORKDIR /app

# Install workspace deps (lockfile-faithful). Only the manifests are needed for the install layer.
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/signaling/package.json ./packages/signaling/
COPY packages/web/package.json ./packages/web/
RUN npm ci

# Build the shared package the signaling service imports; copy only what the service needs.
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/signaling ./packages/signaling
RUN npm run build --workspace @shareit/shared

ENV NODE_ENV=production
# Railway injects PORT; the service reads it (defaults to 8080 locally).
EXPOSE 8080

CMD ["npm", "run", "start", "--workspace", "@shareit/signaling"]
