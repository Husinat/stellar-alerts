import { Queue, QueueEvents, Job, Worker } from 'bullmq';
import { Resend } from 'resend';
import { prisma } from './prisma';
import { createLogger } from './logger';
import { dispatchWhatsAppAlert, WhatsAppInvalidNumberError } from '../utils/whatsapp';

const queueLog = createLogger({ module: 'Queue' });

export interface AlertJobData {
  paymentId: string;
  txHash: string;
  walletId: string;
  amount: string;
  asset: string;
  assetIssuer?: string | null;
  fromAddress: string;
  receivedAt: string;
  /** Correlation ID propagated from the originating HTTP request, if any. */
  requestId?: string;
}

const redisHost = process.env.REDIS_HOST || "localhost";
const redisPort = parseInt(process.env.REDIS_PORT || "6379", 10);
const WEBHOOK_TIMEOUT_MS = 10000;
const CIRCUIT_BREAKER_THRESHOLD = 10; // 10 consecutive 5xx failures opens circuit
const CIRCUIT_BREAKER_TIMEOUT = 60000; // 60 second timeout before half-open

export let alertQueue: Queue<AlertJobData> | null = null;
export let dlqQueue: Queue<AlertJobData> | null = null;
export let alertQueueEvents: QueueEvents | null = null;
export let alertWorker: Worker<AlertJobData> | null = null;

const resend = new Resend(process.env.RESEND_API_KEY || "re_123");
const circuitBreakers = new Map<string, CircuitBreaker<any>>();

export function buildTelegramPaymentCard(data: AlertJobData): string {
  const escapeHtml = (value: string) => value.replace(/[&<>\"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char] ?? char);
  return [
    '<b>Stellar Payment Received</b>',
    `<b>Amount:</b> ${escapeHtml(data.amount)} ${escapeHtml(data.asset)}`,
    `<b>From:</b> <code>${escapeHtml(data.fromAddress)}</code>`,
    `<b>Transaction:</b> <code>${escapeHtml(data.txHash)}</code>`,
    `<b>Received:</b> ${escapeHtml(data.receivedAt)}`,
  ].join('\n');
}

function isPublicChannel(chatId: string): boolean {
  return chatId.startsWith('@') || chatId.startsWith('-100');
}

async function assertBotIsChannelAdmin(botToken: string, chatId: string): Promise<void> {
  const me = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
  if (!me.ok) throw new Error('Telegram bot identity check failed');
  const bot = await me.json() as { result?: { id?: number } };
  if (!bot.result?.id) throw new Error('Telegram bot identity was not returned');
  const membership = await fetch(
    `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${bot.result.id}`,
  );
  if (!membership.ok) throw new Error('Telegram channel permission check failed');
  const result = await membership.json() as { result?: { status?: string } };
  if (!['administrator', 'creator'].includes(result.result?.status ?? '')) {
    throw new Error('Telegram bot must be an administrator of the channel');
  }
}

async function getOrCreateCircuitBreaker(
  webhookId: string,
): Promise<CircuitBreaker<any>> {
  if (circuitBreakers.has(webhookId)) {
    return circuitBreakers.get(webhookId)!;
  }

  const breaker = new CircuitBreaker(
    async (url: string, payload: string, headers: Record<string, string>) => {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: payload,
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });

      if (response.status === 429) {
        const error = new Error(`Rate limited: ${response.status}`) as Error & {
          statusCode?: number;
          headers?: Headers;
        };
        error.statusCode = 429;
        error.headers = response.headers;
        throw error;
      }

      if (response.status >= 500) {
        throw new Error(`Server error: ${response.status}`);
      }

      return response;
    },
    {
      timeout: WEBHOOK_TIMEOUT_MS,
      errorThresholdPercentage: 100,
      volumeThreshold: CIRCUIT_BREAKER_THRESHOLD,
      rollingCountTimeout: 60000,
      name: `webhook-${webhookId}`,
    },
  );

  circuitBreakers.set(webhookId, breaker);
  return breaker;
}

async function updateCircuitBreakerState(
  webhookId: string,
  state: "closed" | "open" | "half-open",
  failureCount: number = 0,
) {
  await prisma.webhookCircuitBreaker.upsert({
    where: { webhookId },
    create: {
      webhookId,
      state,
      failureCount,
      openedAt: state === "open" ? new Date() : null,
    },
    update: {
      state,
      failureCount,
      lastFailureAt: state === "open" ? new Date() : undefined,
      openedAt: state === "open" ? new Date() : undefined,
    },
  });
}

export async function dispatchWebhookAndLog(webhookId: string, payload: any, retryAfterBackoff = false) {
  let targetUrl: string | undefined;

  try {
    const webhook = await prisma.webhook.findUnique({
      where: { id: webhookId },
      include: { circuitBreaker: true },
    });

    if (!webhook) {
      console.warn(`[WebhookDispatch] Webhook ${webhookId} not found`);
      return;
    }

    targetUrl = webhook.url;

    // Check circuit breaker state
    if (webhook.circuitBreaker?.state === "open") {
      const openedAt = webhook.circuitBreaker.openedAt?.getTime() || 0;
      const now = Date.now();

      if (now - openedAt < CIRCUIT_BREAKER_TIMEOUT) {
        console.warn(
          `[WebhookDispatch] Circuit breaker OPEN for webhook ${webhookId}, skipping dispatch`,
        );
        await prisma.webhookLog.create({
          data: {
            webhookId,
            error: "Circuit breaker is open, endpoint temporarily disabled",
          },
        });
        return;
      } else {
        // Transition to half-open
        await updateCircuitBreakerState(webhookId, "half-open");
        console.log(
          `[WebhookDispatch] Circuit breaker HALF-OPEN for webhook ${webhookId}, attempting recovery`,
        );
      }
    }

    const adaptiveDelayMs = adaptiveWebhookRateLimiter.getDelayMs(webhook.url);
    if (adaptiveDelayMs > 0) {
      console.warn(`[WebhookDispatch] Pausing webhook domain for ${adaptiveDelayMs}ms before retry`);
      await waitForAdaptiveBackoff(adaptiveDelayMs);
    }

    const templateResult = applyWebhookPayloadTemplate(payload, webhook.payloadTemplate);
    if (!templateResult.ok) {
      console.warn(
        `[WebhookDispatch] Payload template error for webhook ${webhookId}: ${templateResult.error}`,
      );
      await prisma.webhookLog.create({
        data: {
          webhookId,
          error: `Payload template ${templateResult.phase} error: ${templateResult.error}`,
        },
      });
      return;
    }

    const payloadString = templateResult.body;
    const signature = generateWebhookSignature(payloadString, webhook.secret);

    const breaker = await getOrCreateCircuitBreaker(webhookId);
    const response = await breaker.fire(webhook.url, payloadString, {
      "Content-Type": "application/json",
      "X-Stellar-Signature": signature.headerValue,
    });

    const responseBody = await response.text();

    await prisma.webhookLog.create({
      data: {
        webhookId,
        statusCode: response.status,
        responseBody: responseBody.substring(0, 5000),
      },
    });
    adaptiveWebhookRateLimiter.clear(webhook.url);

    // Reset circuit breaker to closed on success
    if (webhook.circuitBreaker?.state === "half-open") {
      await updateCircuitBreakerState(webhookId, "closed", 0);
      console.log(
        `[WebhookDispatch] Circuit breaker CLOSED for webhook ${webhookId}, service recovered`,
      );
    }

    console.log(
      `[WebhookDispatch] Webhook ${webhookId} dispatched, status: ${response.status}`,
    );
  } catch (error: any) {
    // Handle circuit breaker open error
    if (error.message && error.message.includes("breaker is open")) {
      console.warn(
        `[WebhookDispatch] Circuit breaker prevented request for webhook ${webhookId}`,
      );
      await prisma.webhookLog.create({
        data: {
          webhookId,
          error: "Circuit breaker is open",
        },
      });
      return;
    }

    if ((error.statusCode === 429 || error.message?.includes("Rate limited")) && targetUrl) {
      const delayMs = adaptiveWebhookRateLimiter.recordRateLimit(targetUrl, error.headers);
      await prisma.webhookLog.create({
        data: {
          webhookId,
          statusCode: 429,
          error: `Endpoint rate limited webhook delivery; retrying after ${delayMs}ms`,
        },
      });

      if (!retryAfterBackoff) {
        console.warn(`[WebhookDispatch] Rate limited by ${targetUrl}; retrying after ${delayMs}ms`);
        await waitForAdaptiveBackoff(delayMs);
        return dispatchWebhookAndLog(webhookId, payload, true);
      }

      console.warn(`[WebhookDispatch] Endpoint still rate limited after adaptive retry for ${webhookId}`);
      return;
    }

    // Track consecutive failures
    const breaker = circuitBreakers.get(webhookId);
    let failureCount = 1;

    if (breaker && typeof breaker.stats === "object") {
      const stats = breaker.stats();
      failureCount = stats?.failures || 1;
    }

    // Open circuit if threshold reached
    if (failureCount >= CIRCUIT_BREAKER_THRESHOLD) {
      await updateCircuitBreakerState(webhookId, "open", failureCount);
      console.error(
        `[WebhookDispatch] Circuit breaker OPENED for webhook ${webhookId} after ${failureCount} failures`,
      );
    } else {
      await updateCircuitBreakerState(webhookId, "closed", failureCount);
    }

    await prisma.webhookLog.create({
      data: {
        webhookId,
        error: error.message.substring(0, 1000),
      },
    });

    console.error(
      `[WebhookDispatch] Failed to dispatch webhook ${webhookId}: ${error.message}`,
    );
  }
}

export const paymentAlertWorkerProcessor = async (job: { data: AlertJobData }) => processAlertDispatch(job.data);

export function createRedisConnectionConfig() {
  const sentinelsRaw = process.env.REDIS_SENTINELS;
  const masterName = process.env.REDIS_SENTINEL_MASTER_NAME || "mymaster";
  const sentinelPassword = process.env.REDIS_SENTINEL_PASSWORD;

  if (sentinelsRaw) {
    const sentinels = sentinelsRaw.split(',').map((s) => {
      const parts = s.trim().split(':');
      return { host: parts[0] || 'localhost', port: parseInt(parts[1] || '26379', 10) };
    });

    console.log(`[Queue] 🛡️ Configuring Redis Sentinel failover with master "${masterName}" across ${sentinels.length} sentinel(s)`);

    return {
      sentinels,
      name: masterName,
      sentinelPassword,
      role: 'master',
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
      retryStrategy: (times: number) => Math.min(times * 100, 3000),
      reconnectOnError: (err: Error) => {
        if (err.message && err.message.includes('READONLY')) {
          console.warn('[Queue] ⚡ Master promoted during Sentinel failover (READONLY received), reconnecting...');
          return true;
        }
        return false;
      },
    };
  }

  const redisHost = process.env.REDIS_HOST || "localhost";
  const redisPort = parseInt(process.env.REDIS_PORT || "6379", 10);
  return {
    host: redisHost,
    port: redisPort,
    lazyConnect: true,
    maxRetriesPerRequest: null,
  };
}

try {
  const connection = createRedisConnectionConfig() as any;

  alertQueue = new Queue<AlertJobData>("payment-alerts", {
    connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 2000,
      },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  });

  dlqQueue = new Queue<AlertJobData>('payment-alerts-dlq', { connection });
  alertQueueEvents = new QueueEvents('payment-alerts', { connection });

  alertWorker = new Worker<AlertJobData>('payment-alerts', async (job) => {
    return processAlertDispatch(job.data);
  }, { connection });

  alertQueueEvents.on("failed", async ({ jobId, failedReason }) => {
    if (!jobId || !alertQueue || !dlqQueue) return;
    try {
      const job = await Job.fromId(alertQueue, jobId);
      if (job && job.attemptsMade >= (job.opts.attempts || 5)) {
        await dlqQueue.add("dispatch-alert-failed", job.data, {
          jobId: `dlq-${jobId}`,
        });
        queueLog.warn({ jobId, failedReason }, 'Moved failed job to DLQ');
      }
    } catch (e: any) {
      queueLog.warn({ jobId, err: e.message }, 'Could not route job to DLQ');
    }
  });

  queueLog.info({ host: redisHost, port: redisPort }, '📡 BullMQ payment-alerts queue initialized');
} catch (err: any) {
  queueLog.warn({ err: err.message }, 'Could not initialize BullMQ queue');
}

export async function failedJobHandler({ jobId, failedReason }: { jobId?: string; failedReason?: string }) {
  if (!jobId || !alertQueue || !dlqQueue) return;
  try {
    const job = await Job.fromId(alertQueue, jobId);
    if (job && job.attemptsMade >= (job.opts.attempts || 5)) {
      await dlqQueue.add("dispatch-alert-failed", job.data, {
        jobId: `dlq-${jobId}`,
      });
      console.log(
        `[Queue] 📨 Moved failed job ${jobId} to DLQ. Reason: ${failedReason}`,
      );
    }
  } catch (err: any) {
    console.warn(`[Queue] Failed to process DLQ routing for ${jobId}: ${err.message}`);
  }
}

export async function processAlertDispatch(data: AlertJobData) {
  // Get user's active webhooks
  let wallet = await prisma.wallet.findUnique({
    where: { id: data.walletId },
    include: {
      user: {
        include: {
          webhooks: {
            where: { isActive: true },
          },
          notifyPrefs: true,
        },
      },
    },
  });

  if (!wallet && data.paymentId) {
    const payment: any = await prisma.payment.findUnique({
      where: { id: data.paymentId },
      include: {
        wallet: {
          include: {
            user: {
              include: {
                webhooks: {
                  where: { isActive: true },
                },
                notifyPrefs: true,
              },
            },
          },
        },
      },
    });
    if (payment?.wallet) {
      wallet = payment.wallet;
    }
  }

  // Prepare webhook payload
  const webhookPayload = {
    event: "payment.received",
    timestamp: new Date().toISOString(),
    data: {
      paymentId: data.paymentId,
      txHash: data.txHash,
      amount: data.amount,
      asset: data.asset,
      assetIssuer: data.assetIssuer,
      fromAddress: data.fromAddress,
      receivedAt: data.receivedAt,
    },
  };

  // Dispatch to all user webhooks (non-blocking)
  if (wallet?.user?.webhooks && wallet.user.webhooks.length > 0) {
    await Promise.all(
      wallet.user.webhooks.map((webhook) =>
        dispatchWebhookAndLog(webhook.id, webhookPayload),
      ),
    ).catch((err) => {
      console.warn(`[Worker] Webhook dispatch had errors: ${err.message}`);
    });
  }

  // Dispatch Telegram alert if configured
  if (wallet?.user?.notifyPrefs?.telegramEnabled && wallet.user.notifyPrefs.telegramChatId) {
    try {
      const chatId = wallet.user.notifyPrefs.telegramChatId;
      const botToken = process.env.TELEGRAM_BOT_TOKEN || 'mock_token';
      if (isPublicChannel(chatId)) {
        await assertBotIsChannelAdmin(botToken, chatId);
      }
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: isPublicChannel(chatId) ? buildTelegramPaymentCard(data) : `Payment Receipt:\nAmount: ${data.amount} ${data.asset}\nFrom: ${data.fromAddress}`,
          ...(isPublicChannel(chatId) ? { parse_mode: 'HTML' } : {}),
        })
      });

      if (!response.ok) {
        console.warn(`[Worker] Failed to send Telegram message for ${data.paymentId}`);
      } else {
        console.log(`[Worker] Sent Telegram receipt for ${data.paymentId}`);
      }
    } catch (dbErr: any) {
      console.warn(`[Worker] Failed to send Telegram notification for ${data.paymentId}: ${dbErr.message}`);
    }
  }

  // Dispatch WhatsApp alert if configured (opt-in via notifyPrefs.whatsappEnabled)
  if (wallet?.user?.notifyPrefs?.whatsappEnabled && wallet.user.notifyPrefs.whatsappNumber) {
    const toNumber = wallet.user.notifyPrefs.whatsappNumber;
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_WHATSAPP_FROM;

    if (!accountSid || !authToken || !fromNumber) {
      console.warn(`[Worker] WhatsApp alert skipped for ${data.paymentId}: Twilio is not configured`);
    } else {
      // Idempotency guard: skip if this payment already has a successful
      // WhatsApp delivery logged (duplicate/retried job dispatch).
      const alreadyDelivered = await prisma.whatsAppDeliveryLog.findFirst({
        where: { paymentId: data.paymentId, toNumber, success: true },
      });

      if (alreadyDelivered) {
        console.log(`[Worker] WhatsApp alert already delivered for ${data.paymentId}, skipping`);
      } else {
        try {
          const result = await dispatchWhatsAppAlert(toNumber, data, { accountSid, authToken, fromNumber });
          await prisma.whatsAppDeliveryLog.create({
            data: {
              paymentId: data.paymentId,
              toNumber,
              success: result.success,
              messageSid: result.messageSid,
              status: result.status,
              error: result.error,
              attempts: result.attempts,
            },
          });

          if (result.success) {
            console.log(`[Worker] Sent WhatsApp receipt for ${data.paymentId} (sid: ${result.messageSid})`);
          } else {
            console.warn(`[Worker] Failed to send WhatsApp message for ${data.paymentId}: ${result.error}`);
          }
        } catch (err: any) {
          if (err instanceof WhatsAppInvalidNumberError) {
            await prisma.whatsAppDeliveryLog.create({
              data: { paymentId: data.paymentId, toNumber, success: false, error: err.message, attempts: 0 },
            });
            console.warn(`[Worker] WhatsApp alert skipped for ${data.paymentId}: ${err.message}`);
          } else {
            console.warn(`[Worker] WhatsApp dispatch error for ${data.paymentId}: ${err.message}`);
          }
        }
      }
    }
  }

  // Send email alert
  try {
    const { data: resendData, error } = await resend.emails.send({
      from: "Stellar Alerts <alerts@resend.dev>",
      to: [data.fromAddress],
      subject: `Payment Receipt: ${data.amount} ${data.asset}`,
      html: `
      <h1>Payment Receipt</h1>
      <p><strong>Payment ID:</strong> ${data.paymentId}</p>
      <p><strong>Transaction Hash:</strong> ${data.txHash}</p>
      <p><strong>Amount:</strong> ${data.amount} ${data.asset}</p>
      <p><strong>From Address:</strong> ${data.fromAddress}</p>
      <p><strong>Received At:</strong> ${data.receivedAt}</p>
    `,
    });

    if (error) {
      console.warn(`[Worker] Resend Email Notice: ${error.message}`);
    } else {
      console.log(`[Worker] Sent email receipt for ${data.paymentId}`);
    }
    return resendData;
  } catch (err: any) {
    console.warn(`[Worker] Email dispatch error: ${err.message}`);
    return null;
  }
}

export async function enqueuePaymentAlert(data: AlertJobData) {
  if (!alertQueue) {
    queueLog.info({ txHash: data.txHash }, 'Queue not connected for payment. Dispatching alert directly in-process...');
    return processAlertDispatch(data);
  }

  try {
    const job = await alertQueue.add("dispatch-alert", data, {
      jobId: `payment-${data.txHash}`,
    });
    queueLog.info({ jobId: job.id, txHash: data.txHash, requestId: data.requestId }, '📨 Enqueued payment alert job');
    return job;
  } catch (err: any) {
    queueLog.warn(
      { txHash: data.txHash, err: err.message },
      'Failed to enqueue alert. Falling back to direct dispatch...',
    );
    return processAlertDispatch(data);
  }
}

export { dispatchPushNotification } from "../utils/push-protocol";
