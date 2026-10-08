FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

# The verdict cache and settings live in /app/data; mount a volume there so they survive restarts
RUN mkdir -p data && chown node:node data
USER node
VOLUME /app/data

CMD ["node", "src/index.js"]
