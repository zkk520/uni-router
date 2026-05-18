FROM node:24-alpine AS frontend

WORKDIR /src/web

ENV NEXT_TELEMETRY_DISABLED=1

RUN corepack enable && corepack prepare pnpm@11.0.8 --activate

COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY web ./

ARG VERSION=dev
ENV NEXT_PUBLIC_APP_VERSION=${VERSION}

RUN pnpm run build

FROM golang:1.24.4-alpine AS backend

WORKDIR /src

RUN apk add --no-cache ca-certificates git tzdata

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN rm -rf static/out
COPY --from=frontend /src/web/out ./static/out

ARG VERSION=dev
ARG COMMIT=unknown
ARG BUILD_TIME=unknown
ARG AUTHOR=zkk520

RUN CGO_ENABLED=0 GOOS=linux go build \
    -tags=jsoniter \
    -ldflags="-X 'github.com/zkk520/uni-router/internal/conf.Version=${VERSION}' \
    -X 'github.com/zkk520/uni-router/internal/conf.BuildTime=${BUILD_TIME}' \
    -X 'github.com/zkk520/uni-router/internal/conf.Author=${AUTHOR}' \
    -X 'github.com/zkk520/uni-router/internal/conf.Commit=${COMMIT}' \
    -s -w" \
    -o /out/uni-router .

FROM alpine:3.22

ENV TZ=Asia/Shanghai

RUN apk add --no-cache ca-certificates su-exec tzdata && \
    mkdir -p /app/data

COPY --from=backend /out/uni-router /app/uni-router
COPY scripts/dockerfiles/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh /app/uni-router

EXPOSE 8080
VOLUME ["/app/data"]

CMD ["/entrypoint.sh"]
