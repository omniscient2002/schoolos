# SchoolOS API — production image
# Base images digest-pinned (backlog: image digest pinning) — bump deliberately.
FROM node:26-alpine@sha256:dbaa92e5758cbbcf85d65d5403fdb530fe3442cbe8c6dbfb7ef23365450d5070 AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:26-alpine@sha256:dbaa92e5758cbbcf85d65d5403fdb530fe3442cbe8c6dbfb7ef23365450d5070
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules node_modules
# OPS-18: COPY runs as root, and COPY preserves the source file modes. On a checkout where sources are
# mode 600 (15 of 19 files in scripts/, plus src/index.js and src/config.js on some worktrees), the
# subsequent `USER node` cannot read its own entry script — the container fails with EACCES before any
# OPS-1 ordering matters. `--chown=node:node` makes the runtime user the OWNER, so mode 600 is readable
# regardless of how the build context was checked out. This is deliberately ownership-based rather than
# `chmod`: read bits are not tracked by version control (git records only the executable bit), so a
# permission normalisation in the repo would not survive a fresh clone, while --chown is enforced here.
COPY --chown=node:node src src
COPY --chown=node:node migrations migrations
COPY --chown=node:node scripts scripts
COPY --chown=node:node package.json ./
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/ready || exit 1
USER node
CMD ["node", "src/index.js"]
