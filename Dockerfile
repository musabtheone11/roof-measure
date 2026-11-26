# Single-instance preview only: jobs deliberately live in this Node process.
FROM node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node bench/package.json bench/package-lock.json ./bench/
RUN npm ci --prefix bench --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node *.js *.css index.html pdf-import.mjs ./
COPY --chown=node:node vendor/ ./vendor/
COPY --chown=node:node assets/ ./assets/
COPY --chown=node:node server/ ./server/
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","--use-env-proxy","server/preview.mjs"]
