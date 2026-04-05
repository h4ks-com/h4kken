FROM node:22-alpine

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy application code
COPY server.js ./
COPY public/ ./public/

EXPOSE 3000

CMD ["node", "server.js"]
