# billion-context proxy in a container (#3389).
#
# Builds the checked-out source and copies the runtime package into the image.
#
#   docker build -t billion-context .
#   docker run -d --name bili -p 127.0.0.1:8787:8787 \
#     -v bili-config:/root/.config/billion-context \
#     -v bili-data:/root/.local/share/billion-context \
#     -v bili-cache:/root/.cache/billion-context \
#     -v bili-state:/root/.local/state/billion-context \
#     billion-context
#
# Rebuild from the desired fork commit to update the container.
FROM node:24-slim AS build
WORKDIR /build
COPY . .
RUN npm ci --ignore-scripts --no-audit --no-fund && npm run build
RUN npm pack --ignore-scripts --pack-destination /tmp \
    && mkdir /opt/bili \
    && tar -xzf /tmp/billion-context-*.tgz --strip-components=1 -C /opt/bili \
    && npm prune --omit=dev --ignore-scripts --no-audit --no-fund \
    && mv node_modules /opt/bili/

FROM node:24-slim
COPY --from=build /opt/bili /opt/bili
RUN chmod +x /opt/bili/dist/index.js \
    && ln -s /opt/bili/dist/index.js /usr/local/bin/bili \
    && ln -s /opt/bili/dist/index.js /usr/local/bin/bili-proxy

ENV ACP_AUTO_UPDATE=0

EXPOSE 8787

VOLUME ["/root/.config/billion-context", "/root/.local/share/billion-context", "/root/.cache/billion-context", "/root/.local/state/billion-context"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/__bili/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bili", "--host", "0.0.0.0", "--port", "8787"]
