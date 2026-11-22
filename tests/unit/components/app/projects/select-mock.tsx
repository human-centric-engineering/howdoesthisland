/**
 * A native `<select>` in place of the Radix one, which happy-dom cannot open.
 * It takes the trigger's `id`, so a field is found by its label as on the page.
 */
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';

export function SelectTrigger(_props: { id?: string; children?: ReactNode }) {
  return null;
}

export const selectMock = {
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    disabled?: boolean;
    children: ReactNode;
  }) => {
    const kids = Children.toArray(children);
    const trigger = kids.find(
      (k): k is ReactElement<{ id?: string }> => isValidElement(k) && k.type === SelectTrigger
    );
    return (
      <select
        id={trigger?.props.id}
        value={value}
        disabled={disabled}
        onChange={(e) => onValueChange(e.target.value)}
      >
        {kids.filter((k) => k !== trigger)}
      </select>
    );
  },
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger,
  SelectValue: () => null,
};
