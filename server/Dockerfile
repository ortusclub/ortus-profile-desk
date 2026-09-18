FROM node:24-bookworm-slim
WORKDIR /app
COPY server ./server
COPY src/migration.cjs src/sheet-profiles.cjs ./src/
USER node
EXPOSE 3000
CMD ["node", "server/index.cjs"]
