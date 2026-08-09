# Cloud Run image for the L2 metering proxy PoC.
#
# ★ Cloud Run, not Cloud Functions: our functions package is gen1
# (firebase-functions@^5, functions.https.onRequest) and gen1 cannot stream a
# response. /v1/messages is SSE, so gen1 is structurally disqualified — design
# doc §5-A. Nothing in this image belongs in v3/functions.
#
# The runtime stage has zero npm dependencies: the proxy is built on node:http
# and global fetch only. That is deliberate — every framework in this position
# parses and re-serializes JSON bodies by default, which is exactly the thing
# that breaks the prompt cache.

FROM node:20-slim AS build
WORKDIR /build
COPY package.json tsconfig.json ./
RUN npm install --no-audit --no-fund
COPY src ./src
RUN npx tsc -p tsconfig.json

FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /build/dist ./dist
COPY package.json ./
USER node
# Cloud Run injects PORT; ANTHROPIC_API_KEY must come from Secret Manager,
# never from the image or a committed env file.
EXPOSE 8080
CMD ["node", "dist/index.js"]
