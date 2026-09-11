import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PrismaInstrumentation } from '@prisma/instrumentation';
import { env } from '../config/env';

let sdk: NodeSDK | null = null;
let initialized = false;

export async function startTelemetry(): Promise<void> {
  if (initialized) return;

  const traceExporter = new OTLPTraceExporter({
    url: env.OTEL_EXPORTER_OTLP_ENDPOINT,
  });

  sdk = new NodeSDK({
    serviceName: env.OTEL_SERVICE_NAME,
    traceExporter,
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (request) => {
          return request.url === '/metrics';
        },
      }),
      new PrismaInstrumentation(),
    ],
  });

  sdk.start();
  initialized = true;
  console.log(`[Telemetry] OpenTelemetry initialized for service: ${env.OTEL_SERVICE_NAME}`);
}

export async function shutdownTelemetry(): Promise<void> {
  if (!initialized || !sdk) return;
  await sdk.shutdown();
  initialized = false;
  sdk = null;
  console.log('[Telemetry] OpenTelemetry shut down');
}

