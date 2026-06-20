import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import * as ReactDOM from 'react-dom/client';
import * as Recharts from 'recharts';
import { DEFAULT_COLORS } from '@nao/shared';
import type { ChartPluginCleanup, ChartPluginConfig, ChartPluginRenderContext } from '@nao/shared';

import { useTheme } from '@/contexts/theme.provider';
import { loadChartPlugin, useChartPluginVersion } from '@/lib/chart-plugins';

interface CustomChartProps {
	type: string;
	data: Record<string, unknown>[];
	config: ChartPluginConfig;
}

function resolveTheme(theme: 'light' | 'dark' | 'system'): 'light' | 'dark' {
	if (theme === 'system') {
		return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
	}
	return theme;
}

/**
 * Renders a custom chart plugin ("vibe coded chart").
 *
 * Dynamically imports the plugin module for `type`, then hands it a container
 * element plus the data, config and the injected libraries (React, ReactDOM,
 * Recharts). Re-renders when the data/config/theme change or when the plugin
 * file is hot reloaded.
 */
export function CustomChart({ type, data, config }: CustomChartProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const version = useChartPluginVersion();
	const { theme } = useTheme();
	const resolvedTheme = resolveTheme(theme);
	const [error, setError] = useState<string | null>(null);
	const configKey = JSON.stringify(config);

	// Keep the latest config without making it a reactive effect dependency —
	// `configKey` already captures content changes, so this avoids re-importing
	// the plugin on every render when callers pass a fresh config object.
	const configRef = useRef(config);
	configRef.current = config;

	useEffect(() => {
		const element = containerRef.current;
		if (!element) {
			return;
		}

		let cancelled = false;
		let cleanup: ChartPluginCleanup;
		setError(null);

		const context: ChartPluginRenderContext = {
			data,
			config: configRef.current,
			libs: { React, ReactDOM, Recharts },
			theme: resolvedTheme,
			colors: DEFAULT_COLORS,
		};

		loadChartPlugin(type, version)
			.then(async (module) => {
				if (cancelled || !containerRef.current) {
					return;
				}
				cleanup = await module.render(containerRef.current, context);
			})
			.catch((err: unknown) => {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : String(err));
				}
			});

		return () => {
			cancelled = true;
			if (typeof cleanup === 'function') {
				try {
					cleanup();
				} catch (err) {
					console.error(`Error cleaning up chart plugin "${type}":`, err);
				}
			}
			element.replaceChildren();
		};
	}, [type, version, data, configKey, resolvedTheme]);

	if (error) {
		return (
			<div className='my-2 rounded-lg border border-dashed border-red-400/50 p-4 text-center text-sm text-red-400'>
				Could not render custom chart "{type}": {error}
			</div>
		);
	}

	return <div ref={containerRef} className='w-full h-full min-h-[280px]' data-custom-chart={type} />;
}
