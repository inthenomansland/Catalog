FROM node:18-alpine
WORKDIR /app

COPY backend/package*.json ./
RUN npm install --only=production

COPY backend/server.js ./
COPY data.json ./data-default.json

RUN mkdir -p /app/data

CMD ["node", "server.js"]
