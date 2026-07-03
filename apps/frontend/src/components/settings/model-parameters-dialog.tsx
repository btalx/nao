import { useEffect, useMemo, useState } from 'react';
import { getModelParameterSpec } from '@nao/backend/provider-meta';
import {
	buildInferenceSettings,
	getParamErrors,
	ModelParametersFields,
	seedParamValues,
} from './model-parameters-fields';
import type { ParamValues } from './model-parameters-fields';
import type { ModelInferenceSettings, ParamKey } from '@nao/backend/llm';
import type { LlmProvider } from '@nao/shared/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface ModelParametersDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	provider: LlmProvider;
	model: { id: string; name: string };
	value: ModelInferenceSettings | undefined;
	onSave: (settings: ModelInferenceSettings) => void;
}

export function ModelParametersDialog({
	open,
	onOpenChange,
	provider,
	model,
	value,
	onSave,
}: ModelParametersDialogProps) {
	const controls = useMemo(() => getModelParameterSpec(provider, model.id), [provider, model.id]);
	const [values, setValues] = useState<ParamValues>({});

	useEffect(() => {
		if (open) {
			setValues(seedParamValues(controls, value));
		}
	}, [open, controls, value]);

	const errors = getParamErrors(controls, values);
	const hasErrors = Object.keys(errors).length > 0;

	const handleSave = () => {
		if (hasErrors) {
			return;
		}
		onSave(buildInferenceSettings(controls, values));
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='sm:max-w-md'>
				<DialogHeader>
					<DialogTitle>Model parameters</DialogTitle>
					<DialogDescription className='font-mono text-xs break-all'>{model.name}</DialogDescription>
				</DialogHeader>

				<ModelParametersFields
					controls={controls}
					values={values}
					errors={errors}
					onValueChange={(key: ParamKey, val: string) => setValues((prev) => ({ ...prev, [key]: val }))}
				/>

				<div className='flex justify-end gap-2 pt-2'>
					<Button variant='ghost' size='sm' onClick={() => onOpenChange(false)} type='button'>
						Cancel
					</Button>
					<Button size='sm' onClick={handleSave} type='button' disabled={hasErrors}>
						Save
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
