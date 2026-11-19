import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ACCOUNT_SIGNATURE, NO_SIGNATURE, type SavedSignature } from '@/lib/signature';

export function SignatureSelect({
  value,
  onChange,
  signatures,
  label,
  accountLabel = 'Account signature',
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  signatures: SavedSignature[];
  label: string;
  accountLabel?: string;
  disabled?: boolean;
}) {
  const items = [
    { value: ACCOUNT_SIGNATURE, label: accountLabel },
    { value: NO_SIGNATURE, label: 'No signature' },
    ...signatures.map((signature) => ({ value: signature.id, label: signature.name })),
  ];
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => {
        if (next !== null) {
          onChange(next);
        }
      }}
      disabled={disabled}
    >
      <SelectTrigger aria-label={label} className="w-full min-w-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
