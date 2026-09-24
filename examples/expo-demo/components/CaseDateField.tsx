import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { Pressable, Text } from "react-native";

import { styles } from "./DemoLayout";

export interface CaseDateFieldProps {
  accessibilityLabel: string;
  maximumDate?: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}

function dateFromIso(value: string | undefined): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value ?? "");
  if (!match) return new Date();
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function isoFromDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function CaseDateField({
  accessibilityLabel,
  maximumDate,
  onChange,
  placeholder,
  value
}: CaseDateFieldProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={() => {
        DateTimePickerAndroid.open({
          mode: "date",
          maximumDate: maximumDate ? dateFromIso(maximumDate) : new Date(),
          value: dateFromIso(value),
          onValueChange: (_event, selectedDate) => {
            if (selectedDate) onChange(isoFromDate(selectedDate));
          }
        });
      }}
      style={styles.textInput}
    >
      <Text>{value || placeholder}</Text>
    </Pressable>
  );
}
