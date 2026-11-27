# Single-instance processing with restart-safe receipts on a private data volume.
FROM node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN --mount=type=secret,id=build_ca \
    if [ -f /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node bench/package.json bench/package-lock.json ./bench/
RUN --mount=type=secret,id=build_ca \
    if [ -f /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    npm ci --prefix bench --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node *.js *.css index.html pdf-import.mjs ./
COPY --chown=node:node vendor/ ./vendor/
COPY --chown=node:node assets/ ./assets/
COPY --chown=node:node server/ ./server/
RUN mkdir -p /var/lib/roof-measure && chown node:node /var/lib/roof-measure && chmod 700 /var/lib/roof-measure
VOLUME ["/var/lib/roof-measure"]
USER node
ARG ROOF_REVISION
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 ROOF_STATE_DB=/var/lib/roof-measure/jobs.sqlite ROOF_REVISION=${ROOF_REVISION}
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","--use-env-proxy","server/preview.mjs"]
