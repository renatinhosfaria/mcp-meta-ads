# Stage 1: Build
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Stage 2: Production
FROM node:20-alpine
WORKDIR /app
ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown
ARG DEPLOYMENT_ID=unknown
ENV GIT_SHA=${GIT_SHA} \
    BUILD_TIME=${BUILD_TIME} \
    DEPLOYMENT_ID=${DEPLOYMENT_ID}
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3200
CMD ["node", "--max-old-space-size=384", "dist/index.js"]
