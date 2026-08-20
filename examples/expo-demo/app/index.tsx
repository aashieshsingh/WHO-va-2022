import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, TextInput, View } from "react-native";

import { ActionButton, DemoChrome, ScreenScroll, styles } from "../components/DemoLayout";
import { useDemoState } from "../components/DemoState";

export default function HomeRoute() {
  const router = useRouter();
  const { cases, completed, currentUser, drafts, isDatabaseReady, latestDraft, login, logout } = useDemoState();
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginMessage, setLoginMessage] = useState("");

  if (!currentUser) {
    return (
      <DemoChrome>
        <ScreenScroll>
          <Text style={styles.screenTitle}>Login</Text>
          <Text style={styles.screenCopy}>
            First login needs the server. After the auth key is cached, the same email and password can open the app offline.
          </Text>
          <View style={styles.formPanel}>
            <Text style={styles.fieldLabel}>Server URL</Text>
            <TextInput
              autoCapitalize="none"
              keyboardType="url"
              onChangeText={setApiBaseUrl}
              placeholder="http://192.168.1.25:5173"
              style={styles.textInput}
              value={apiBaseUrl}
            />
            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput
              autoCapitalize="none"
              keyboardType="email-address"
              onChangeText={setEmail}
              style={styles.textInput}
              value={email}
            />
            <Text style={styles.fieldLabel}>Password</Text>
            <TextInput onChangeText={setPassword} secureTextEntry style={styles.textInput} value={password} />
            {loginMessage ? <Text style={styles.invalidText}>{loginMessage}</Text> : null}
            <View style={styles.actionStack}>
              <ActionButton
                disabled={!isDatabaseReady}
                label="Login"
                onPress={() => {
                  setLoginMessage("");
                  void login({ email, password }, apiBaseUrl).catch((error: unknown) => {
                    setLoginMessage((error as Error).message);
                  });
                }}
              />
            </View>
          </View>
        </ScreenScroll>
      </DemoChrome>
    );
  }

  return (
    <DemoChrome>
      <ScreenScroll>
        <Text style={styles.screenTitle}>Home</Text>
        <Text style={styles.screenCopy}>
          Signed in as {currentUser.name}. Local key: {currentUser.authKey}
        </Text>
        <Text style={styles.screenCopy}>Case entries, drafts, and completed submissions are stored in SQLite.</Text>
        <View style={styles.actionStack}>
          <ActionButton
            disabled={!isDatabaseReady}
            label="Dashboard"
            onPress={() => router.push("/dashboard")}
          />
          <ActionButton
            disabled={!isDatabaseReady}
            label="Case Data Entry"
            onPress={() => router.push("/case-entry")}
          />
          <ActionButton
            disabled={!isDatabaseReady || !latestDraft}
            label="Continue Last"
            onPress={() => router.push("/continue")}
          />
          <ActionButton
            disabled={!isDatabaseReady}
            label={`Cases (${cases.length}) / Drafts (${drafts.length})`}
            onPress={() => router.push("/drafts")}
            variant="secondary"
          />
          <ActionButton
            disabled={!isDatabaseReady}
            label={`Completed (${completed.length})`}
            onPress={() => router.push("/completed")}
            variant="secondary"
          />
          <ActionButton
            disabled={!isDatabaseReady}
            label="Logout"
            onPress={() => void logout()}
            variant="secondary"
          />
        </View>
      </ScreenScroll>
    </DemoChrome>
  );
}
