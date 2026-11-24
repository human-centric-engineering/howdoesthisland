'use client';

/**
 * One reader setting's picker, with its help: a project's defaults (t-71) and
 * a review's own settings on `/assess` (t-78) both pick from the version's
 * catalogue this way. Presentational: the project form drives it through
 * react-hook-form, the workbench through plain state.
 *
 * `noneLabel` names the {@link NO_DEFAULT} choice, offered first; `null`
 * offers none, for a setting that must name one of the options.
 */
import { Label } from '@/components/ui/label';
import { FieldHelp } from '@/components/ui/field-help';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { NO_DEFAULT, type PickerOption } from '@/components/app/projects/project-defaults';

export interface SettingPickerProps {
  id: string;
  label: string;
  help: string;
  options: PickerOption[];
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  disabled: boolean;
  noneLabel?: string | null;
  /** Rendered under the picker: a field error. */
  children?: React.ReactNode;
}

export function SettingPicker({
  id,
  label,
  help,
  options,
  value,
  onChange,
  onBlur,
  disabled,
  noneLabel = 'No default',
  children,
}: SettingPickerProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="flex items-center gap-1">
        {label}
        <FieldHelp title={label}>{help}</FieldHelp>
      </Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} onBlur={onBlur}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {noneLabel === null ? null : <SelectItem value={NO_DEFAULT}>{noneLabel}</SelectItem>}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {children}
    </div>
  );
}
