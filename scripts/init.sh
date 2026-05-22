#!/bin/bash
# 服务器首次部署初始化脚本
# 用法：bash scripts/init.sh
set -e

DEPLOY_DIR="/opt/1panel/apps/uni-router"
IMAGE="ghcr.io/zkk520/uni-router:latest"
CONTAINER="uni-router"
PORT=8080

# ─── 检查依赖 ────────────────────────────────────────────────────────────────

check_deps() {
    for cmd in docker curl; do
        if ! command -v "$cmd" &>/dev/null; then
            echo "错误：未找到命令 $cmd，请先安装后再运行此脚本" >&2
            exit 1
        fi
    done

    if ! docker compose version &>/dev/null; then
        echo "错误：未找到 docker compose（需要 Docker Compose V2）" >&2
        exit 1
    fi
}

# ─── 配置 Docker daemon 代理（用于 docker pull）────────────────────────────

setup_daemon_proxy() {
    local proxy_host="127.0.0.1"
    local proxy_port="7890"

    # 检测 mihomo 是否在监听
    if ! curl -sf --max-time 3 --proxy "http://${proxy_host}:${proxy_port}" https://ghcr.io/v2/ -o /dev/null; then
        # 测试失败不代表代理不存在，只要端口开着就配置
        if ! ss -tlnp 2>/dev/null | grep -q ":${proxy_port}"; then
            echo "    未检测到本地代理（${proxy_host}:${proxy_port}），跳过 daemon 代理配置"
            return 0
        fi
    fi

    local override_dir="/etc/systemd/system/docker.service.d"
    local override_file="${override_dir}/http-proxy.conf"

    # 已存在则跳过
    if [ -f "$override_file" ]; then
        echo "    Docker daemon 代理已配置，跳过"
        return 0
    fi

    echo "    配置 Docker daemon 代理 → http://${proxy_host}:${proxy_port}"
    mkdir -p "$override_dir"
    cat > "$override_file" << EOF
[Service]
Environment="HTTP_PROXY=http://${proxy_host}:${proxy_port}"
Environment="HTTPS_PROXY=http://${proxy_host}:${proxy_port}"
Environment="NO_PROXY=localhost,127.0.0.1,::1"
EOF

    systemctl daemon-reload
    systemctl restart docker
    sleep 2
    echo "    Docker daemon 代理配置完成，已重启"
}

# ─── 停止旧容器（幂等）──────────────────────────────────────────────────────

stop_existing() {
    if docker ps -q --filter "name=^${CONTAINER}$" | grep -q .; then
        echo "停止旧容器 ${CONTAINER}..."
        docker compose -f "${DEPLOY_DIR}/docker-compose.yml" down 2>/dev/null || docker stop "$CONTAINER" && docker rm "$CONTAINER" || true
    fi
}

# ─── 写入不含代理的 compose（用于检测网关）──────────────────────────────────

write_compose_plain() {
    cat > "${DEPLOY_DIR}/docker-compose.yml" << 'COMPOSE'
services:
  uni-router:
    image: ghcr.io/zkk520/uni-router:latest
    container_name: uni-router
    ports:
      - "8080:8080"
    volumes:
      - ./data:/app/data
    restart: unless-stopped
COMPOSE
}

# ─── 写入含代理的 compose ────────────────────────────────────────────────────

write_compose_with_proxy() {
    local gw="$1"
    cat > "${DEPLOY_DIR}/docker-compose.yml" << COMPOSE
services:
  uni-router:
    image: ${IMAGE}
    container_name: ${CONTAINER}
    ports:
      - "${PORT}:8080"
    volumes:
      - ./data:/app/data
    restart: unless-stopped
    environment:
      HTTP_PROXY: "http://${gw}:7890"
      HTTPS_PROXY: "http://${gw}:7890"
      http_proxy: "http://${gw}:7890"
      https_proxy: "http://${gw}:7890"
      ALL_PROXY: "socks5://${gw}:7891"
      all_proxy: "socks5://${gw}:7891"
      NO_PROXY: "localhost,127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,100.64.0.0/10"
      no_proxy: "localhost,127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,100.64.0.0/10"
    healthcheck:
      test:
        - CMD-SHELL
        - "env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy wget -qO- http://localhost:8080/ || exit 1"
      interval: 30s
      timeout: 10s
      retries: 3
COMPOSE
}

# ─── 主流程 ──────────────────────────────────────────────────────────────────

main() {
    echo "=== uni-router 服务器初始化 ==="
    echo ""

    check_deps

    # 1. 配置 Docker daemon 代理
    echo "[1/6] 检测并配置 Docker daemon 代理..."
    setup_daemon_proxy

    # 2. 创建部署目录
    echo "[2/6] 创建部署目录 ${DEPLOY_DIR} ..."
    mkdir -p "${DEPLOY_DIR}/data"
    cd "${DEPLOY_DIR}"

    stop_existing

    # 3. 拉取镜像
    echo "[3/6] 拉取镜像 ${IMAGE} ..."
    docker pull "${IMAGE}"

    # 4. 启动临时容器以检测网关 IP
    echo "[4/6] 启动临时容器，检测 Docker 网关..."
    write_compose_plain
    docker compose up -d
    sleep 3

    DOCKER_GATEWAY=$(docker inspect -f \
        '{{range $n,$v := .NetworkSettings.Networks}}{{$v.Gateway}}{{end}}' \
        "${CONTAINER}")

    if [ -z "$DOCKER_GATEWAY" ]; then
        echo "警告：无法自动检测网关 IP，跳过代理配置" >&2
        echo "若需代理，请手动编辑 ${DEPLOY_DIR}/docker-compose.yml" >&2
        echo ""
        echo "=== 初始化完成（无代理模式）==="
        print_summary
        exit 0
    fi

    echo "    检测到 Docker 网关：${DOCKER_GATEWAY}"

    # 5. 重新生成含代理的 compose 并重启
    echo "[5/6] 重新生成代理配置并重启容器..."
    docker compose down
    write_compose_with_proxy "${DOCKER_GATEWAY}"
    docker compose up -d

    # 6. 完成
    echo "[6/6] 完成"
    echo ""
    print_summary
}

print_summary() {
    local server_ip
    server_ip=$(curl -sf --max-time 3 https://api.ipify.org 2>/dev/null || echo "服务器IP")

    echo "┌─────────────────────────────────────────────┐"
    echo "│           uni-router 初始化完成              │"
    echo "├─────────────────────────────────────────────┤"
    printf "│  访问地址：http://%-27s│\n" "${server_ip}:${PORT}"
    echo "│  默认账号：admin                             │"
    echo "│  默认密码：admin                             │"
    echo "│  数据目录：${DEPLOY_DIR}/data"
    echo "├─────────────────────────────────────────────┤"
    echo "│  后续自动部署由 GitHub Actions 负责          │"
    echo "│  每次 push main 分支将自动拉取最新镜像       │"
    echo "└─────────────────────────────────────────────┘"
    echo ""
    echo "常用命令："
    echo "  docker logs ${CONTAINER}          # 查看日志"
    echo "  docker compose -f ${DEPLOY_DIR}/docker-compose.yml ps  # 查看状态"
}

main "$@"
