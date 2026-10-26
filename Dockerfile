FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
# SQLite file lives in /data — mount a volume there so it survives restarts
ENV DB_PATH=/data/quizarena.db
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3000
CMD ["sh", "-c", "npm run seed && npm start"]
