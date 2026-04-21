FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

COPY . .

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app .

EXPOSE 1997
CMD ["sh", "-c", "node migrate.js && node src/index.js"]
