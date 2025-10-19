FROM node:20-slim

# Chrome deps
RUN apt-get update && apt-get install -y \
    ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libcups2 libdbus-1-3 libdrm2 libxkbcommon0 libxcomposite1 libxrandr2 libxdamage1 \
    libgbm1 libgtk-3-0 libnss3 libxshmfence1 libwayland-client0 libwayland-egl1 \
    libwayland-server0 wget gnupg --no-install-recommends \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "run", "start"]