FROM node:18-alpine
WORKDIR /app

COPY backend/package*.json ./
RUN npm install --only=production

COPY backend/server.js ./
COPY data.json ./data-default.json

# Copy frontend static files so the backend can serve them
COPY index.html style.css app.js admin.html admin.js logo-header.svg logo-email.png ./public/

# Copy manufacturer logos (served at /logos/<slug>.png)
COPY logos/ ./public/logos/

RUN mkdir -p /app/data

CMD ["node", "server.js"]
