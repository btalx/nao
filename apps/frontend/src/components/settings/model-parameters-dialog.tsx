import { useEffect, useState } from 'react';
import { buildInferenceSettings, ModelParametersFields, seedParamFields } from './model-parameters-fields';
import type { ParamFieldKey } from './model-parameters-fields';
import type { ModelInferenceSettings, ReasoningEffort } from '@nao/backend/llm';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface ModelParametersDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	model: { id: string; name: string };
	value: ModelInferenceSettings | undefined;
	onSave: (settings: ModelInferenceSettings) => void;
}

export function ModelParametersDialog({ open, onOpenChange, model, value, onSave }: ModelParametersDialogProps) {
	const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('off');
	const [fields, setFields] = useState<Record<ParamFieldKey, string>>(seedParamFields(undefined));

	useEffect(() => {
		if (!open) {
			return;
		}
		setReasoningEffort(value?.reasoningEffort ?? 'off');
		setFields(seedParamFields(value));
	}, [open, value]);

	const handleSave = () => {
		onSave(buildInferenceSettings(reasoningEffort, fields));
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
					reasoningEffort={reasoningEffort}
					onReasoningEffortChange={setReasoningEffort}
					fields={fields}
					onFieldChange={(key, val) => setFields((prev) => ({ ...prev, [key]: val }))}
				/>

				<div className='flex justify-end gap-2 pt-2'>
					<Button variant='ghost' size='sm' onClick={() => onOpenChange(false)} type='button'>
						Cancel
					</Button>
					<Button size='sm' onClick={handleSave} type='button'>
						Save
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
