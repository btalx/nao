import type { ModelInferenceSettings, ReasoningEffort } from '@nao/backend/llm';
import { Input } from '@/components/ui/input';

export type ParamFieldKey = 'temperature' | 'topP' | 'topK' | 'maxOutputTokens';

const REASONING_OPTIONS: { value: ReasoningEffort; label: string }[] = [
	{ value: 'off', label: 'Off' },
	{ value: 'low', label: 'Low' },
	{ value: 'medium', label: 'Medium' },
	{ value: 'high', label: 'High' },
];

const SAMPLING_FIELDS: {
	key: Exclude<ParamFieldKey, 'maxOutputTokens'>;
	label: string;
	placeholder: string;
	step: string;
	min?: number;
	max?: number;
}[] = [
	{ key: 'temperature', label: 'Temperature', placeholder: '0 – 2', step: '0.1', min: 0, max: 2 },
	{ key: 'topP', label: 'Top P', placeholder: '0 – 1', step: '0.05', min: 0, max: 1 },
	{ key: 'topK', label: 'Top K', placeholder: 'e.g. 40', step: '1', min: 1 },
];

interface ModelParametersFieldsProps {
	reasoningEffort: ReasoningEffort;
	onReasoningEffortChange: (effort: ReasoningEffort) => void;
	fields: Record<ParamFieldKey, string>;
	onFieldChange: (key: ParamFieldKey, value: string) => void;
}

export function ModelParametersFields({
	reasoningEffort,
	onReasoningEffortChange,
	fields,
	onFieldChange,
}: ModelParametersFieldsProps) {
	const reasoningOn = reasoningEffort !== 'off';

	return (
		<div className='grid gap-4'>
			<div className='grid gap-1.5'>
				<span className='text-sm font-medium text-foreground'>Thinking effort</span>
				<div className='flex flex-wrap gap-1.5'>
					{REASONING_OPTIONS.map((option) => {
						const isActive = reasoningEffort === option.value;
						return (
							<button
								key={option.value}
								type='button'
								onClick={() => onReasoningEffortChange(option.value)}
								className={`
									px-3 py-1.5 rounded-md text-sm transition-all cursor-pointer
									${isActive ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}
								`}
							>
								{option.label}
							</button>
						);
					})}
				</div>
			</div>

			<div className='grid grid-cols-2 gap-3'>
				{SAMPLING_FIELDS.map((field) => (
					<div key={field.key} className='grid gap-1'>
						<label
							htmlFor={`model-param-${field.key}`}
							className='text-xs font-medium text-muted-foreground'
						>
							{field.label}
						</label>
						<Input
							id={`model-param-${field.key}`}
							type='number'
							inputMode='decimal'
							step={field.step}
							min={field.min}
							max={field.max}
							disabled={reasoningOn}
							placeholder={field.placeholder}
							value={fields[field.key]}
							onChange={(e) => onFieldChange(field.key, e.target.value)}
						/>
					</div>
				))}
				<div className='grid gap-1'>
					<label htmlFor='model-param-maxOutputTokens' className='text-xs font-medium text-muted-foreground'>
						Max output tokens
					</label>
					<Input
						id='model-param-maxOutputTokens'
						type='number'
						inputMode='numeric'
						step='1'
						min={1}
						placeholder='e.g. 16000'
						value={fields.maxOutputTokens}
						onChange={(e) => onFieldChange('maxOutputTokens', e.target.value)}
					/>
				</div>
			</div>

			<p className='text-xs text-muted-foreground'>
				{reasoningOn
					? 'Temperature, Top P and Top K are ignored by Claude while thinking is on.'
					: 'Leave a field empty to use the model default.'}
			</p>
		</div>
	);
}

export function seedParamFields(value: ModelInferenceSettings | undefined): Record<ParamFieldKey, string> {
	return {
		temperature: formatNumber(value?.temperature),
		topP: formatNumber(value?.topP),
		topK: formatNumber(value?.topK),
		maxOutputTokens: formatNumber(value?.maxOutputTokens),
	};
}

export function buildInferenceSettings(
	reasoningEffort: ReasoningEffort,
	fields: Record<ParamFieldKey, string>,
): ModelInferenceSettings {
	const settings: ModelInferenceSettings = {};
	if (reasoningEffort !== 'off') {
		settings.reasoningEffort = reasoningEffort;
	}
	const temperature = parseNumber(fields.temperature);
	const topP = parseNumber(fields.topP);
	const topK = parseNumber(fields.topK);
	const maxOutputTokens = parseNumber(fields.maxOutputTokens);
	if (temperature !== undefined) {
		settings.temperature = temperature;
	}
	if (topP !== undefined) {
		settings.topP = topP;
	}
	if (topK !== undefined) {
		settings.topK = topK;
	}
	if (maxOutputTokens !== undefined) {
		settings.maxOutputTokens = maxOutputTokens;
	}
	return settings;
}

function formatNumber(value: number | undefined): string {
	if (value === undefined || Number.isNaN(value)) {
		return '';
	}
	return String(value);
}

function parseNumber(raw: string): number | undefined {
	const trimmed = raw.trim();
	if (!trimmed) {
		return undefined;
	}
	const parsed = Number(trimmed);
	return Number.isFinite(parsed) ? parsed : undefined;
}
