# Step 1: Build Stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files & prisma schema
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm install --legacy-peer-deps

# Copy source code
COPY . .

# Generate Prisma Client & Build TypeScript code
RUN npx prisma@5.10.0 generate
RUN npm run build

# Step 2: Production Runner Stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy package files & install production dependencies
COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps

# Copy built dist folder and Prisma assets from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

CMD ["sh", "-c", "npx prisma@5.10.0 migrate deploy && node dist/main.js"]
