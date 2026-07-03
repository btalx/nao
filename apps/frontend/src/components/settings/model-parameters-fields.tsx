import type { ModelInferenceSettings, ParamControl, ParamKey, ReasoningEffort } from '@nao/backend/llm';
import { Input } from '@/components/ui/input';

export type ParamValues = Partial<Record<ParamKey, string>>;
export type ParamErrors = Partial<Record<ParamKey, string>>;

interface ModelParametersFieldsProps {
	controls: ParamControl[];
	values: ParamValues;
	onValueChange: (key: ParamKey, value: string) => void;
	errors?: ParamErrors;
}

export function ModelParametersFields({ controls, values, onValueChange, errors = {} }: ModelParametersFieldsProps) {
	const thinkingActive = isThinkingActive(controls, values);
	const effortControls = controls.filter((c): c is Extract<ParamControl, { kind: 'effort' }> => c.kind === 'effort');
	const numberControls = controls.filter((c): c is Extract<ParamControl, { kind: 'number' }> => c.kind === 'number');

	return (
		<div className='grid gap-4'>
			{effortControls.map((control) => {
				const current = values.reasoningEffort ?? 'off';
				return (
					<div key={control.key} className='grid gap-1.5'>
						<span className='text-sm font-medium text-foreground'>{control.label}</span>
						<div className='flex flex-wrap gap-1.5'>
							{control.options.map((option) => {
								const isActive = current === option;
								return (
									<button
										key={option}
										type='button'
										onClick={() => onValueChange('reasoningEffort', option)}
										className={`
											px-3 py-1.5 rounded-md text-sm capitalize transition-all cursor-pointer
											${isActive ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}
										`}
									>
										{option}
									</button>
								);
							})}
						</div>
					</div>
				);
			})}

			{numberControls.length > 0 && (
				<div className='grid grid-cols-2 gap-3'>
					{numberControls.map((control) => {
						const disabled = control.group === 'sampling' && thinkingActive;
						const error = errors[control.key];
						return (
							<div key={control.key} className='grid gap-1'>
								<label
									htmlFor={`model-param-${control.key}`}
									className='text-xs font-medium text-muted-foreground'
								>
									{control.label}
								</label>
								<Input
									id={`model-param-${control.key}`}
									type='number'
									inputMode='decimal'
									step={control.step}
									min={control.min}
									max={control.max}
									disabled={disabled}
									aria-invalid={!!error}
									className={error ? 'border-destructive focus-visible:ring-destructive' : undefined}
									placeholder={control.placeholder}
									value={values[control.key] ?? ''}
									onChange={(e) => onValueChange(control.key, e.target.value)}
								/>
								{error && <span className='text-xs text-destructive'>{error}</span>}
							</div>
						);
					})}
				</div>
			)}

			<p className='text-xs text-muted-foreground'>
				{thinkingActive
					? 'Temperature, Top P and Top K are ignored by Claude while thinking is on.'
					: 'Leave a field empty to use the model default.'}
			</p>
		</div>
	);
}

export function seedParamValues(controls: ParamControl[], settings: ModelInferenceSettings | undefined): ParamValues {
	const values: ParamValues = {};
	for (const control of controls) {
		if (control.key === 'reasoningEffort') {
			values.reasoningEffort = settings?.reasoningEffort ?? 'off';
			continue;
		}
		const value = settings?.[control.key];
		values[control.key] = value === undefined || Number.isNaN(value) ? '' : String(value);
	}
	return values;
}

export function buildInferenceSettings(controls: ParamControl[], values: ParamValues): ModelInferenceSettings {
	const settings: ModelInferenceSettings = {};
	for (const control of controls) {
		if (control.key === 'reasoningEffort') {
			const effort = values.reasoningEffort;
			if (effort && effort !== 'off') {
				settings.reasoningEffort = effort as ReasoningEffort;
			}
			continue;
		}
		const parsed = parseNumber(values[control.key]);
		if (parsed !== undefined) {
			settings[control.key] = parsed;
		}
	}
	return settings;
}

/** Friendly per-field validation against each control's bounds. Empty fields are valid (= default). */
export function getParamErrors(controls: ParamControl[], values: ParamValues): ParamErrors {
	const errors: ParamErrors = {};
	for (const control of controls) {
		if (control.kind !== 'number') {
			continue;
		}
		const raw = (values[control.key] ?? '').trim();
		if (!raw) {
			continue;
		}
		const parsed = Number(raw);
		if (!Number.isFinite(parsed)) {
			errors[control.key] = 'Enter a valid number.';
			continue;
		}
		const belowMin = control.min !== undefined && parsed < control.min;
		const aboveMax = control.max !== undefined && parsed > control.max;
		if (belowMin || aboveMax) {
			errors[control.key] = boundsMessage(control.min, control.max);
		}
	}
	return errors;
}

function boundsMessage(min: number | undefined, max: number | undefined): string {
	if (min !== undefined && max !== undefined) {
		return `Enter a value between ${min} and ${max}.`;
	}
	if (min !== undefined) {
		return `Enter a value of at least ${min}.`;
	}
	if (max !== undefined) {
		return `Enter a value of at most ${max}.`;
	}
	return 'Enter a valid number.';
}

function isThinkingActive(controls: ParamControl[], values: ParamValues): boolean {
	return controls.some((control) => {
		if (control.key === 'reasoningEffort') {
			const effort = values.reasoningEffort;
			return !!effort && effort !== 'off';
		}
		if (control.key === 'thinkingBudgetTokens') {
			return (values.thinkingBudgetTokens ?? '').trim() !== '';
		}
		return false;
	});
}

function parseNumber(raw: string | undefined): number | undefined {
	const trimmed = (raw ?? '').trim();
	if (!trimmed) {
		return undefined;
	}
	const parsed = Number(trimmed);
	return Number.isFinite(parsed) ? parsed : undefined;
}
