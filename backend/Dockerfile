FROM node:12-buster-slim AS builder

WORKDIR /build
COPY . .

RUN sed -i "s!../.git/refs/heads/master!master!g" ./src/api/backend-info.ts

RUN apt-get update
RUN apt-get install -y build-essential python3 pkg-config
RUN npm ci --production
RUN npm i typescript
RUN npm run build

RUN mv ./docker/* .
RUN mv ./mempool-config-docker.json ./mempool-config.json

FROM node:12-buster-slim

WORKDIR /backend

COPY --from=builder /build/ .

RUN chmod +x /backend/start.sh
RUN chmod +x /backend/wait-for-it.sh

RUN chown -R 1000:1000 /backend && chmod -R 755 /backend

USER 1000

EXPOSE 8999

CMD ["/backend/start.sh"]
