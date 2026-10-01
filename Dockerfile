FROM node:20-alpine

WORKDIR /app

# Install dependencies untuk Baileys (canvas/sharp optional)
RUN apk add --no-cache python3 make g++ git

COPY package.json .
RUN npm install --omit=dev

COPY src/ ./src/

RUN mkdir -p /app/session

ENV PORT=3001
ENV SESSION_PATH=/app/session

EXPOSE 3001

CMD ["node", "src/index.js"]
