# ---------- 1) budowa strony (React) ----------
FROM node:20 AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm install
COPY web/ ./
RUN npm run build

# ---------- 2) budowa serwera (C++) ----------
FROM ubuntu:24.04 AS server
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake git libssl-dev ca-certificates xz-utils \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/ ./
RUN cmake -B build -S . && cmake --build build -j2

# ---------- 3) gotowa aplikacja ----------
FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends \
    libssl3t64 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server/build
COPY --from=server /app/server/build/kirsche ./kirsche
COPY --from=web /app/web/dist /app/web/dist
CMD ["./kirsche"]
