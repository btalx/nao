import { useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import type { ErrorComponentProps } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';

export function RouterError({ error, reset }: ErrorComponentProps) {
	const router = useRouter();

	useEffect(() => {
		if (!isChunkLoadError(error)) {
			return;
		}
		if (hasReloadedForChunkError()) {
			return;
		}
		markReloadedForChunkError();
		window.location.reload();
	}, [error]);

	if (isChunkLoadError(error) && !hasReloadedForChunkError()) {
		return null;
	}

	return (
		<div className='flex h-full flex-1 flex-col items-center justify-center gap-4 p-6 text-center'>
			<div className='max-w-md space-y-2'>
				<h2 className='text-lg font-medium'>Something went wrong</h2>
				<p className='text-sm text-muted-foreground'>{error.message}</p>
			</div>
			<div className='flex gap-2'>
				<Button variant='outline' onClick={() => window.location.reload()}>
					Reload page
				</Button>
				<Button
					onClick={() => {
						clearReloadedForChunkError();
						reset();
						router.invalidate();
					}}
				>
					Try again
				</Button>
			</div>
		</div>
	);
}

const RELOAD_FLAG = 'nao:chunk-error-reloaded';

const CHUNK_ERROR_PATTERNS = [
	'dynamically imported module',
	'Failed to fetch dynamically imported module',
	'error loading dynamically imported module',
	'Importing a module script failed',
	'Unable to preload CSS',
];

function isChunkLoadError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return CHUNK_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

function hasReloadedForChunkError(): boolean {
	try {
		return sessionStorage.getItem(RELOAD_FLAG) === '1';
	} catch {
		return false;
	}
}

function markReloadedForChunkError(): void {
	try {
		sessionStorage.setItem(RELOAD_FLAG, '1');
	} catch {
		return;
	}
}

function clearReloadedForChunkError(): void {
	try {
		sessionStorage.removeItem(RELOAD_FLAG);
	} catch {
		return;
	}
}
