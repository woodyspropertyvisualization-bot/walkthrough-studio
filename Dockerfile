FROM node:20-slim

# ffmpeg is needed to extract keyframes and stitch the final video together
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

RUN mkdir -p uploads generated

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
