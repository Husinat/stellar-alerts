import { PrismaClient, Prisma } from '../../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env';

// Read-only query patterns that should be routed to replica
const READ_OPERATIONS = [
  'findMany',
  'findUnique',
  'findFirst',
  'count',
  'aggregate',
  'groupBy',
] as const;

// Models that are read-heavy and should use replica
// Note: Prisma model names are PascalCase (e.g. Payment, WebhookLog)
const READ_HEAVY_MODELS = [
  'payment',
  'wallet',
  'webhooklog',
  'sorobaneventsnapshot',
] as const;

export interface ReadReplicaConfig {
  primaryUrl: string;
  replicaUrl?: string;
  fallbackToPrimary: boolean;
}

export class ReadReplicaRouter {
  private primaryClient: PrismaClient;
  private replicaClient: PrismaClient | null = null;
  private config: ReadReplicaConfig;

  constructor(config: ReadReplicaConfig) {
    this.config = config;

    // Create primary client
    const primaryAdapter = new PrismaPg({
      connectionString: config.primaryUrl,
    });
    this.primaryClient = new PrismaClient({ adapter: primaryAdapter });

    // Create replica client if URL provided
    if (config.replicaUrl) {
      try {
        const replicaAdapter = new PrismaPg({
          connectionString: config.replicaUrl,
        });
        this.replicaClient = new PrismaClient({ adapter: replicaAdapter });
        console.log('✅ Read replica client initialized');
      } catch (error) {
        console.warn('⚠️ Failed to initialize read replica client:', error);
        if (!config.fallbackToPrimary) {
          throw error;
        }
      }
    }
  }

  /**
   * Get the appropriate client for a given operation
   */
  getClient(
    model: string,
    operation: string
  ): PrismaClient {
    // If no replica or model is write-heavy, use primary
    if (!this.replicaClient) {
      return this.primaryClient;
    }

    // Check if this is a read operation on a read-heavy model
    const isReadOperation = READ_OPERATIONS.includes(
      operation as typeof READ_OPERATIONS[number]
    );
    const isReadHeavyModel = READ_HEAVY_MODELS.includes(
      model.toLowerCase() as typeof READ_HEAVY_MODELS[number]
    );

    if (isReadOperation && isReadHeavyModel) {
      return this.replicaClient;
    }

    return this.primaryClient;
  }

  /**
   * Connect both clients
   */
  async connect(): Promise<void> {
    await this.primaryClient.$connect();
    console.log('✅ Primary database connected');

    if (this.replicaClient) {
      try {
        await this.replicaClient.$connect();
        console.log('✅ Read replica connected');
      } catch (error) {
        console.warn('⚠️ Read replica connection failed:', error);
        if (!this.config.fallbackToPrimary) {
          throw error;
        }
        console.log('ℹ️ Falling back to primary for all queries');
        this.replicaClient = null;
      }
    }
  }

  /**
   * Disconnect both clients
   */
  async disconnect(): Promise<void> {
    await this.primaryClient.$disconnect();
    if (this.replicaClient) {
      await this.replicaClient.$disconnect();
    }
  }

  /**
   * Health check for both databases
   */
  async healthCheck(): Promise<{
    primary: boolean;
    replica: boolean;
  }> {
    const primary = await this.checkHealth(this.primaryClient);
    let replica = false;

    if (this.replicaClient) {
      replica = await this.checkHealth(this.replicaClient);
    }

    return { primary, replica };
  }

  private async checkHealth(client: PrismaClient): Promise<boolean> {
    try {
      await client.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the primary client (for writes)
   */
  getPrimaryClient(): PrismaClient {
    return this.primaryClient;
  }

  /**
   * Get the replica client (for reads, if available)
   */
  getReplicaClient(): PrismaClient | null {
    return this.replicaClient;
  }
}

// Create and export the router instance
let router: ReadReplicaRouter | null = null;

export function createReadReplicaRouter(
  config?: Partial<ReadReplicaConfig>
): ReadReplicaRouter {
  const fullConfig: ReadReplicaConfig = {
    primaryUrl: config?.primaryUrl || env.DATABASE_URL,
    replicaUrl: config?.replicaUrl || env.READ_REPLICA_URL,
    fallbackToPrimary: config?.fallbackToPrimary ?? true,
  };

  router = new ReadReplicaRouter(fullConfig);
  return router;
}

export function getReadReplicaRouter(): ReadReplicaRouter | null {
  return router;
}
