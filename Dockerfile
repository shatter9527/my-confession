FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

WORKDIR /app
COPY --chown=node:node . .

# Preserve access to legacy config for one-time import; administrators now live in SQLite.
RUN mkdir -p /app/data \
    && ln -s /app/data/config.json /app/config.json \
    && chown node:node /app/data

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/people').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
