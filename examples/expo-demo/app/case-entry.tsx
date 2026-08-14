import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { ActionButton, DemoChrome, ScreenHeader, ScreenScroll, styles } from "../components/DemoLayout";
import { emptyCaseEntry, type CaseEntryData, useDemoState } from "../components/DemoState";
import { validateCaseEntryData } from "../components/LocalDatabase";

type CaseEntryField = Exclude<keyof CaseEntryData, "ageAtDeath" | "deceasedSex">;

const textFields: Array<[CaseEntryField, string, "default" | "numeric"]> = [
  ["district", "District", "default"],
  ["block", "Block", "default"],
  ["villages", "Villages", "default"],
  ["phc", "PHC", "default"],
  ["subcentre", "Subcentre", "default"],
  ["uid", "UID", "default"],
  ["householdHeadName", "Name of head of the Household", "default"],
  ["deceasedFullName", "Full name of the deceased", "default"],
  ["deceasedHouseAddress", "House address", "default"],
  ["pinCode", "PIN code", "numeric"]
];

function dateFromIso(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return new Date();
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function isoFromDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function CaseEntryRoute() {
  const router = useRouter();
  const { currentUser, saveCase } = useDemoState();
  const [entry, setEntry] = useState<CaseEntryData>(() => emptyCaseEntry());
  const [message, setMessage] = useState("");

  const updateText = (field: CaseEntryField, value: string) => {
    setEntry((current) => ({ ...current, [field]: value }));
  };
  const pickDate = (field: "date" | "deathDate") => {
    DateTimePickerAndroid.open({
      mode: "date",
      value: dateFromIso(entry[field]),
      onChange: (event, selectedDate) => {
        if (event.type === "set" && selectedDate) updateText(field, isoFromDate(selectedDate));
      }
    });
  };

  if (!currentUser) {
    return (
      <DemoChrome>
        <ScreenScroll>
          <ScreenHeader title="Case Entry" />
          <Text style={styles.invalidText}>Login before entering case data.</Text>
        </ScreenScroll>
      </DemoChrome>
    );
  }

  return (
    <DemoChrome>
      <ScreenScroll>
        <ScreenHeader title="Case Entry" />
        <View style={styles.formPanel}>
          {textFields.map(([field, label, keyboardType]) => (
            <View key={field}>
              <Text style={styles.fieldLabel}>{label}</Text>
              <TextInput
                keyboardType={keyboardType}
                maxLength={field === "pinCode" ? 6 : undefined}
                onChangeText={(value) => updateText(field, value)}
                style={styles.textInput}
                value={String(entry[field])}
              />
            </View>
          ))}
          <Text style={styles.fieldLabel}>Entry date</Text>
          <Pressable accessibilityRole="button" onPress={() => pickDate("date")} style={styles.textInput}>
            <Text>{entry.date || "Select entry date"}</Text>
          </Pressable>
          <Text style={styles.fieldLabel}>Death date</Text>
          <Pressable accessibilityRole="button" onPress={() => pickDate("deathDate")} style={styles.textInput}>
            <Text>{entry.deathDate || "Select death date"}</Text>
          </Pressable>
          <Text style={styles.fieldLabel}>Sex of the deceased</Text>
          <View style={styles.actionStack}>
            {(["female", "male", "undetermined"] as const).map((sex) => (
              <ActionButton
                key={sex}
                label={sex === entry.deceasedSex ? `${sex} selected` : sex}
                onPress={() => setEntry((current) => ({ ...current, deceasedSex: sex }))}
                variant={sex === entry.deceasedSex ? "primary" : "secondary"}
              />
            ))}
          </View>
          <Text style={styles.fieldLabel}>Age at death</Text>
          <TextInput
            keyboardType="numeric"
            onChangeText={(value) => setEntry((current) => ({ ...current, ageAtDeath: Number(value) }))}
            style={styles.textInput}
            value={String(entry.ageAtDeath)}
          />
          {message ? <Text style={styles.invalidText}>{message}</Text> : null}
          <View style={styles.actionStack}>
            <ActionButton
              label="Save Case and Start WHO VA"
              onPress={() => {
                setMessage("");
                const validationError = validateCaseEntryData(entry);
                if (validationError) {
                  setMessage(validationError);
                  return;
                }
                void saveCase(entry)
                  .then((saved) => {
                    router.push({ pathname: "/start", params: { caseUid: saved.uid } });
                  })
                  .catch((error: unknown) => {
                    setMessage((error as Error).message);
                  });
              }}
            />
          </View>
        </View>
      </ScreenScroll>
    </DemoChrome>
  );
}
