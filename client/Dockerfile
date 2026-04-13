FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN if [ -f package.json ]; then npm install; fi
COPY . .
ENV VITE_API_TARGET=http://server:3100
EXPOSE 5174
CMD ["sh", "-c", "if [ -f package.json ]; then npm run dev; else echo 'No package.json found' && tail -f /dev/null; fi"]
