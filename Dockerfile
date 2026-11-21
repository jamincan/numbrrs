# Pinned by digest so a rebuild gets the same base until the pin is moved on
# purpose (Dependabot proposes the move). The digest is the multi-arch index's,
# not one platform's. Named once here so every stage shares the one pin.
FROM node:26-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS runtime
WORKDIR /app

FROM runtime AS base
# Node 25 stopped shipping corepack, so pnpm is installed directly. Keep the
# version in step with `packageManager` in package.json.
RUN npm install -g pnpm@11.3.0

# All dependencies, for building
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Only what the built server imports at runtime: package.json's `dependencies`.
# Anything used only while building (Tailwind, the fonts, Vite) belongs in
# `devDependencies`, or it and everything under it ships in the image.
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

# Build the app
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build

# Production image, from the bare Node image rather than `base`: nothing at
# runtime installs anything, so pnpm stays out of it. The drizzle folder is the
# compiled migrations the server applies at boot; the drizzle-kit config and TS
# schema are dev-only.
FROM runtime
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/drizzle ./drizzle

EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

CMD ["node", "build"]
