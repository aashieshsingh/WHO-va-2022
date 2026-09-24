import { Picker } from "@react-native-picker/picker";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, TextInput, View } from "react-native";

import { CaseDateField } from "../components/CaseDateField";
import { ActionButton, DemoChrome, ScreenHeader, ScreenScroll, styles } from "../components/DemoLayout";
import { emptyCaseEntry, type CaseEntryData, useDemoState } from "../components/DemoState";
import { validateCaseEntryData } from "../components/LocalDatabase";

type CaseEntryField = Exclude<keyof CaseEntryData, "ageAtDeath" | "deathPlace" | "deceasedSex">;

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

export default function CaseEntryRoute() {
  const router = useRouter();
  const { currentUser, saveCase } = useDemoState();
  const [entry, setEntry] = useState<CaseEntryData>(() => emptyCaseEntry());
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const isAdmin = currentUser?.role === "admin";

  const updateText = (field: CaseEntryField, value: string) => {
    setEntry((current) => ({ ...current, [field]: value }));
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
          {textFields
            .filter(([field]) => field !== "uid" || isAdmin)
            .map(([field, label, keyboardType]) => (
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
          {isAdmin ? (
            <>
              <Text style={styles.fieldLabel}>Entry date</Text>
              <CaseDateField
                accessibilityLabel="Entry date"
                onChange={(date) => updateText("date", date)}
                placeholder="Select entry date"
                value={entry.date}
              />
            </>
          ) : null}
          <Text style={styles.fieldLabel}>Death date</Text>
          <CaseDateField
            accessibilityLabel="Death date"
            onChange={(deathDate) => updateText("deathDate", deathDate)}
            placeholder="Select death date"
            value={entry.deathDate}
          />
          <Text style={styles.fieldLabel}>Place of death</Text>
          <View style={styles.selectInput}>
            <Picker
              accessibilityLabel="Place of death"
              mode="dropdown"
              onValueChange={(deathPlace: CaseEntryData["deathPlace"]) =>
                setEntry((current) => ({ ...current, deathPlace }))
              }
              selectedValue={entry.deathPlace}
              style={styles.selectPicker}
            >
              <Picker.Item enabled={false} label="Select place of death" value="" />
              <Picker.Item label="Hospital death" value="hospital-death" />
              <Picker.Item label="Home death" value="home-death" />
              <Picker.Item label="On the way to hospital" value="on-the-way-to-hospital" />
              <Picker.Item label="Other place" value="other" />
            </Picker>
          </View>
          <Text style={styles.fieldLabel}>Sex of the deceased</Text>
          <View style={styles.selectInput}>
            <Picker
              accessibilityLabel="Sex of the deceased"
              mode="dropdown"
              onValueChange={(deceasedSex: CaseEntryData["deceasedSex"]) =>
                setEntry((current) => ({ ...current, deceasedSex }))
              }
              selectedValue={entry.deceasedSex}
              style={styles.selectPicker}
            >
              <Picker.Item enabled={false} label="Select sex" value="" />
              <Picker.Item label="Female" value="female" />
              <Picker.Item label="Male" value="male" />
              <Picker.Item label="Undetermined" value="undetermined" />
            </Picker>
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
              disabled={isSaving}
              label="Save Case and Start WHO VA"
              onPress={() => {
                if (isSaving) return;
                setMessage("");
                const validationError = validateCaseEntryData(entry);
                if (validationError) {
                  setMessage(validationError);
                  return;
                }
                setIsSaving(true);
                void saveCase(entry)
                  .then((saved) => {
                    router.push({ pathname: "/start", params: { caseUid: saved.uid } });
                  })
                  .catch((error: unknown) => {
                    setMessage((error as Error).message);
                  })
                  .finally(() => {
                    setIsSaving(false);
                  });
              }}
            />
          </View>
        </View>
      </ScreenScroll>
    </DemoChrome>
  );
}
