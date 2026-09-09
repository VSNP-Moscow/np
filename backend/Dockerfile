FROM node:22-alpine
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev
COPY backend/src ./src
COPY frontend ./../frontend
RUN mkdir -p src/data
ENV PORT=4000
EXPOSE 4000
CMD ["node", "src/index.js"]
