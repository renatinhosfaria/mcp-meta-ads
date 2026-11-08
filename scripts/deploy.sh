#!/usr/bin/env bash
# Deploy do mcp-meta-ads: build da imagem, recria o container e faz rollback se /health falhar.
# Rodar a partir da raiz do repositório: scripts/deploy.sh
set -euo pipefail

NAME=mcp-meta-ads
VOLUME=mcp-meta-ads-data
HEALTH_URL=http://127.0.0.1:3200/health

cd "$(dirname "$0")/.."

[ -f .env ] || { echo "ERRO: .env nao encontrado." >&2; exit 1; }
if [ -n "$(git status --porcelain -- src package.json package-lock.json Dockerfile)" ]; then
  echo "ERRO: ha alteracoes sem commit em src/, package*.json ou Dockerfile." >&2
  exit 1
fi

run_container() {
  docker run -d --name "$NAME" --restart unless-stopped --env-file .env \
    -e DATA_DIR=/app/data -p 127.0.0.1:3200:3200 -v "$VOLUME:/app/data" "$1"
}

wait_healthy() {
  for _ in $(seq 1 30); do
    curl -fsS "$HEALTH_URL" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

SHA=$(git rev-parse --short HEAD)
IMAGE="mcp-meta-ads:$SHA"
PREV_IMAGE=$(docker inspect -f '{{.Config.Image}}' "$NAME")
echo "Imagem atual: $PREV_IMAGE -> nova: $IMAGE"

docker build \
  --build-arg GIT_SHA="$SHA" \
  --build-arg BUILD_TIME="$(date -u +%FT%TZ)" \
  --build-arg DEPLOYMENT_ID="$SHA-$(date +%s)" \
  -t "$IMAGE" .

docker volume create "$VOLUME" >/dev/null

docker stop "$NAME" && docker rm "$NAME"
run_container "$IMAGE"

if wait_healthy; then
  echo "OK: $NAME rodando em $IMAGE"
  exit 0
fi

echo "ERRO: /health nao respondeu em 60 s. Ultimas linhas do log:" >&2
docker logs --tail 50 "$NAME" >&2 || true
docker rm -f "$NAME" >/dev/null
run_container "$PREV_IMAGE"
echo "Rollback feito para $PREV_IMAGE." >&2
exit 1
