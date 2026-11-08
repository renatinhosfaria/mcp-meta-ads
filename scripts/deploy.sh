#!/usr/bin/env bash
# Deploy do mcp-meta-ads: build da imagem, recria o container e faz rollback se /health falhar.
# Rodar a partir da raiz do repositório: scripts/deploy.sh
set -euo pipefail

NAME=mcp-meta-ads
PREV_NAME=${NAME}-prev
VOLUME=mcp-meta-ads-data
HEALTH_URL=http://127.0.0.1:3200/health

cd "$(dirname "$0")/.."

[ -f .env ] || { echo "ERRO: .env nao encontrado." >&2; exit 1; }
if [ -n "$(git status --porcelain -- src package.json package-lock.json Dockerfile tsconfig.json)" ]; then
  echo "ERRO: ha alteracoes sem commit em src/, package*.json, Dockerfile ou tsconfig.json." >&2
  exit 1
fi

run_container() {
  docker run -d --name "$NAME" --restart unless-stopped --env-file .env \
    -e DATA_DIR=/app/data --memory 512m -p 127.0.0.1:3200:3200 -v "$VOLUME:/app/data" "$1"
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
if docker inspect "$PREV_NAME" >/dev/null 2>&1; then
  echo "ERRO: o container $PREV_NAME já existe. Remova-o ou conclua o deploy anterior antes de continuar." >&2
  exit 1
fi
if ! docker image inspect "$PREV_IMAGE" >/dev/null 2>&1; then
  echo "ERRO: imagem de rollback $PREV_IMAGE nao existe mais; abortando antes de parar o container." >&2
  exit 1
fi

docker build \
  --build-arg GIT_SHA="$SHA" \
  --build-arg BUILD_TIME="$(date -u +%FT%TZ)" \
  --build-arg DEPLOYMENT_ID="$SHA-$(date +%s)" \
  -t "$IMAGE" .

docker volume create "$VOLUME" >/dev/null

if ! docker stop "$NAME"; then
  echo "ERRO: não foi possível parar $NAME; nada foi renomeado." >&2
  exit 1
fi
if ! docker rename "$NAME" "$PREV_NAME"; then
  echo "ERRO CRÍTICO: $NAME foi parado, mas não pôde ser renomeado; tentando restaurá-lo." >&2
  if docker start "$NAME" >/dev/null 2>&1; then
    echo "ERRO: $NAME foi restaurado e continua com a imagem antiga." >&2
    exit 1
  fi
  echo "ERRO CRÍTICO: não foi possível restaurar $NAME; o serviço pode estar fora do ar." >&2
  exit 2
fi

if run_container "$IMAGE" && wait_healthy; then
  docker rm "$PREV_NAME"
  echo "OK: $NAME rodando em $IMAGE"
  exit 0
fi

echo "ERRO: o novo container nao subiu ou /health nao respondeu em 60 s. Ultimas linhas do log:" >&2
docker logs --tail 50 "$NAME" >&2 || true
docker rm -f "$NAME" >/dev/null 2>&1 || true
if ! docker rename "$PREV_NAME" "$NAME" >/dev/null 2>&1; then
  echo "ERRO CRÍTICO: não foi possível restaurar o container anterior; o serviço está fora do ar." >&2
  exit 2
fi
if ! docker start "$NAME" >/dev/null 2>&1; then
  echo "ERRO CRÍTICO: não foi possível iniciar o container anterior; o serviço está fora do ar." >&2
  exit 2
fi
if ! wait_healthy; then
  echo "ERRO CRÍTICO: o container anterior iniciou, mas /health não respondeu; o serviço está fora do ar." >&2
  exit 2
fi
echo "ERRO: o novo container falhou; o container anterior foi restaurado e está saudável." >&2
exit 1
