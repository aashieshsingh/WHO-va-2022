import type { CSSProperties, MouseEvent } from "react";

export interface CaseDateFieldProps {
  accessibilityLabel: string;
  maximumDate?: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}

const dateInputStyle: CSSProperties = {
  backgroundColor: "#ffffff",
  border: "1px solid #9fb4ad",
  borderRadius: 8,
  boxSizing: "border-box",
  color: "#142a24",
  fontFamily: "system-ui, sans-serif",
  fontSize: 16,
  minHeight: 46,
  marginTop: 6,
  padding: "9px 12px",
  width: "100%"
};

function todayIso(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function openPicker(event: MouseEvent<HTMLInputElement>): void {
  try {
    event.currentTarget.showPicker?.();
  } catch {
    return;
  }
}

export function CaseDateField({
  accessibilityLabel,
  maximumDate,
  onChange,
  value
}: CaseDateFieldProps) {
  return (
    <input
      aria-label={accessibilityLabel}
      max={maximumDate ?? todayIso()}
      onChange={(event) => onChange(event.currentTarget.value)}
      onClick={openPicker}
      style={dateInputStyle}
      type="date"
      value={value}
    />
  );
}
