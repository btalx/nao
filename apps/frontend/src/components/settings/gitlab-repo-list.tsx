import { useQuery } from '@tanstack/react-query';
import { Globe, Loader2, Lock, Search } from 'lucide-react';
import { useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';

import type { TrpcRouter } from '@nao/backend/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { formatRelativeDate } from '@/lib/time-ago';
import { trpc } from '@/main';

export type GitlabProject = inferRouterOutputs<TrpcRouter>['gitlab']['listProjects']['projects'][number];

interface GitlabRepoListProps {
	selected: string | null;
	onSelect: (projectPathWithNamespace: string) => void;
	onSearchChange?: () => void;
}

/** Searchable, paginated list of the connected user's GitLab projects. */
export function GitlabRepoList({ selected, onSelect, onSearchChange }: GitlabRepoListProps) {
	const [search, setSearch] = useState('');
	const [page, setPage] = useState(1);
	const debouncedSearch = useDebouncedValue(search, 300);

	const projects = useQuery({
		...trpc.gitlab.listProjects.queryOptions({ page, search: debouncedSearch || undefined }),
		placeholderData: (prev) => prev,
	});

	const handleSearchChange = (value: string) => {
		onSearchChange?.();
		setSearch(value);
		setPage(1);
	};

	return (
		<>
			<div className='relative'>
				<Search className='absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
				<Input
					placeholder='Search projects...'
					value={search}
					onChange={(e) => handleSearchChange(e.target.value)}
					className='pl-9'
				/>
			</div>

			<div className='flex flex-col gap-1 max-h-[340px] overflow-y-auto -mx-1 px-1'>
				{projects.isLoading && !projects.data ? (
					<div className='flex items-center justify-center py-8 text-muted-foreground'>
						<Loader2 className='size-5 animate-spin' />
					</div>
				) : projects.data?.projects.length === 0 ? (
					<div className='py-8 text-center text-sm text-muted-foreground'>
						{debouncedSearch ? 'No projects found.' : 'No projects available.'}
					</div>
				) : (
					projects.data?.projects.map((project) => (
						<button
							key={project.id}
							type='button'
							onClick={() => onSelect(project.path_with_namespace)}
							className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
								selected === project.path_with_namespace
									? 'border-primary bg-primary/5'
									: 'border-transparent hover:bg-muted/50'
							}`}
						>
							<div className='mt-0.5'>
								{project.visibility === 'private' ? (
									<Lock className='size-4 text-muted-foreground' />
								) : (
									<Globe className='size-4 text-muted-foreground' />
								)}
							</div>
							<div className='min-w-0 flex-1'>
								<div className='text-sm font-medium truncate'>{project.path_with_namespace}</div>
								{project.description && (
									<div className='text-xs text-muted-foreground truncate mt-0.5'>
										{project.description}
									</div>
								)}
								<div className='text-xs text-muted-foreground mt-1'>
									Updated {formatRelativeDate(new Date(project.last_activity_at))}
								</div>
							</div>
						</button>
					))
				)}
			</div>

			{projects.data && (projects.data.hasMore || page > 1) && (
				<div className='flex items-center justify-between border-t pt-3'>
					<Button variant='outline' size='sm' disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
						Previous
					</Button>
					<span className='text-xs text-muted-foreground'>Page {page}</span>
					<Button
						variant='outline'
						size='sm'
						disabled={!projects.data.hasMore}
						onClick={() => setPage((p) => p + 1)}
					>
						Next
					</Button>
				</div>
			)}
		</>
	);
}
