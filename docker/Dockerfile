FROM oven/bun:latest
WORKDIR /app

# Copy package files and install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Copy the entire application code
COPY . .

# Railway injects PORT as env var (default 3000)
ENV PORT=3000
EXPOSE ${PORT}

CMD ["bun", "src/index.ts"]
