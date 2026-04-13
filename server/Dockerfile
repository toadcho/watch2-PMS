FROM node:20-alpine
# postgresql-client: pg_dump/pg_restore (백업 기능용)
RUN apk add --no-cache postgresql16-client tar gzip
WORKDIR /app
COPY package*.json ./
RUN if [ -f package.json ]; then npm install; fi
COPY . .
RUN npx prisma generate
EXPOSE 3100
CMD ["sh", "-c", "if [ -f package.json ]; then npm run dev; else echo 'No package.json found' && tail -f /dev/null; fi"]
