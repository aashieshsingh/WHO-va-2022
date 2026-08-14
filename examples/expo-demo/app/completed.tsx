import { useRouter } from "expo-router";
import { Text, View } from "react-native";

import { DemoChrome, EmptyState, ScreenHeader, ScreenScroll, styles } from "../components/DemoLayout";
import { formatDateTime, useDemoState } from "../components/DemoState";

export default function CompletedRoute() {
  const router = useRouter();
  const { beginNewInterview, completed } = useDemoState();

  return (
    <DemoChrome>
      <ScreenScroll>
        <ScreenHeader
          actionLabel="Start New"
          onAction={() => {
            beginNewInterview();
            router.push("/start");
          }}
          title="Completed"
        />
        {completed.length === 0 ? (
          <EmptyState message="Completed submissions will appear here after the final section validates." />
        ) : (
          completed.map((submission) => (
            <View key={submission.id} style={styles.listItem}>
              <View style={styles.listItemText}>
                <Text style={styles.listItemTitle}>{Object.keys(submission.result.data).length} answers</Text>
                <Text style={styles.listItemMeta}>Completed {formatDateTime(submission.completedAt)}</Text>
                <Text style={submission.result.valid ? styles.validText : styles.invalidText}>
                  {submission.result.valid ? "Valid submission" : `${submission.result.issues.length} issues`}
                </Text>
                <Text style={submission.syncStatus === "pending" ? styles.pendingText : styles.validText}>
                  {submission.syncStatus === "pending" ? "Pending server push" : "Pushed to server"}
                </Text>
              </View>
            </View>
          ))
        )}
      </ScreenScroll>
    </DemoChrome>
  );
}
