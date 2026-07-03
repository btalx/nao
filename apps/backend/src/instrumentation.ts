import { LangfuseSpanProcessor } from '@langfuse/otel';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

/**
 * Langfuse tracing is opt-in: it only activates when credentials are present so
 * self-hosted deployments without Langfuse keys keep running untouched. The
 * processor reads LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_BASE_URL
 * from the environment, so this module must be imported after `./env` (which
 * loads the .env file) and before any AI SDK call is made.
 */
const credentialsPresent = Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);

export const langfuseSpanProcessor = credentialsPresent ? new LangfuseSpanProcessor() : undefined;

if (langfuseSpanProcessor) {
	const tracerProvider = new NodeTracerProvider({
		spanProcessors: [langfuseSpanProcessor],
	});
	tracerProvider.register();

	// The processor batches and flushes on its own interval; this only guards
	// the final buffer on a clean shutdown so the last traces are not dropped.
	process.once('beforeExit', () => {
		void langfuseSpanProcessor?.forceFlush();
	});

	console.log('✓ Langfuse tracing enabled');
}
