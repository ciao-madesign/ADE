FROM node:20-alpine

# git serve per l'autocommit opzionale (GIT_AUTOCOMMIT=1)
RUN apk add --no-cache git

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

ENV PORT=8080 RUN_CYCLES=1 CYCLE_INTERVAL_HOURS=6
EXPOSE 8080

CMD ["node", "server/server.mjs"]
