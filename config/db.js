const { PrismaClient } = require('@prisma/client');

// Retry helper for connection pool timeout errors
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const RETRYABLE_CODES = ['P2024', 'P1017', 'P1001', 'P1008'];

async function withRetry(fn, context = '') {
  let retries = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      const isRetryable = RETRYABLE_CODES.includes(error.code) ||
        (error.message && error.message.includes('Timed out fetching a new connection'));

      if (isRetryable && retries < MAX_RETRIES) {
        retries++;
        const delay = RETRY_DELAY_MS * retries;
        console.warn(`[Prisma Retry] ${context} failed (${error.code || 'pool timeout'}), retry ${retries}/${MAX_RETRIES} in ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
}

let prisma;

if (global.prisma) {
  prisma = global.prisma;
} else {
  const basePrisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

  // Extend Prisma with retry logic on all query operations
  prisma = basePrisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return withRetry(() => query(args), `${model}.${operation}`);
        },
      },
    },
  });

  global.prisma = prisma;
}

// Graceful shutdown for Railway
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing Prisma connection...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing Prisma connection...');
  await prisma.$disconnect();
  process.exit(0);
});

module.exports = prisma;
