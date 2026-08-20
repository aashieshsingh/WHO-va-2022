import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { DemoChrome, EmptyState, ScreenHeader, ScreenScroll, styles } from "../components/DemoLayout";
import { countAnswers, formatDateTime, useDemoState, type RegisteredUser } from "../components/DemoState";

type DashboardStatus = "pending" | "drafted" | "final";

interface DashboardEntry {
  id: string;
  title: string;
  userId: string;
  status: DashboardStatus;
  updatedAt: string;
  answers: number;
  route?: Href;
}

interface UserDashboard {
  user: RegisteredUser | { userId: string; name: string; email: string };
  entries: DashboardEntry[];
  pending: number;
  drafted: number;
  final: number;
}

const statusLabel: Record<DashboardStatus, string> = {
  pending: "Pending",
  drafted: "Drafted",
  final: "Final"
};

function userLabel(user: UserDashboard["user"]): string {
  return user.name || user.email || user.userId;
}

export default function DashboardRoute() {
  const router = useRouter();
  const { cases, completed, currentUser, drafts, pushToServer, users } = useDemoState();
  const [pushMessage, setPushMessage] = useState("");
  const [pushFailed, setPushFailed] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [pushApiBaseUrl, setPushApiBaseUrl] = useState("");
  const userMap = new Map<string, UserDashboard["user"]>();
  for (const user of users) userMap.set(user.userId, user);
  if (currentUser) userMap.set(currentUser.userId, currentUser);

  const finalCaseUids = new Set(
    completed
      .map((submission) => {
        const caseUid = submission.result.data.__caseUid;
        return typeof caseUid === "string" ? caseUid : submission.caseEntry?.uid;
      })
      .filter((uid): uid is string => Boolean(uid))
  );
  const draftById = new Map(drafts.map((draft) => [draft.id, draft]));
  const caseUids = new Set(cases.map((entry) => entry.uid));
  const entries: DashboardEntry[] = [];

  for (const entry of cases) {
    const matchingDraft = draftById.get(entry.uid);
    const isFinal = finalCaseUids.has(entry.uid);
    entries.push({
      id: entry.uid,
      title: entry.caseEntry.deceasedFullName || entry.uid,
      userId: entry.userId,
      status: isFinal ? "final" : matchingDraft ? "drafted" : "pending",
      updatedAt: isFinal
        ? (completed.find((submission) => submission.caseEntry?.uid === entry.uid || submission.result.data.__caseUid === entry.uid)
            ?.completedAt ?? entry.updatedAt)
        : (matchingDraft?.updatedAt ?? entry.updatedAt),
      answers: matchingDraft ? countAnswers(matchingDraft) : 0,
      route: { pathname: "/start", params: { caseUid: entry.uid } }
    });
  }

  for (const draft of drafts) {
    if (caseUids.has(draft.id)) continue;
    const fallbackUserId = currentUser?.userId ?? "unknown-user";
    entries.push({
      id: draft.id,
      title: `Draft ${draft.id}`,
      userId: fallbackUserId,
      status: "drafted",
      updatedAt: draft.updatedAt,
      answers: countAnswers(draft),
      route: { pathname: "/continue", params: { draftId: draft.id } }
    });
  }

  for (const submission of completed) {
    const caseUid = typeof submission.result.data.__caseUid === "string" ? submission.result.data.__caseUid : submission.caseEntry?.uid;
    if (caseUid && caseUids.has(caseUid)) continue;
    entries.push({
      id: submission.id,
      title: submission.caseEntry?.deceasedFullName || `Final ${submission.id}`,
      userId: submission.userId ?? currentUser?.userId ?? "unknown-user",
      status: "final",
      updatedAt: submission.completedAt,
      answers: Object.keys(submission.result.data).length
    });
  }

  const dashboards = [...entries]
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .reduce<UserDashboard[]>((groups, entry) => {
      let group = groups.find((candidate) => candidate.user.userId === entry.userId);
      if (!group) {
        const user = userMap.get(entry.userId) ?? {
          userId: entry.userId,
          name: entry.userId === "unknown-user" ? "Unknown user" : entry.userId,
          email: ""
        };
        group = { user, entries: [], pending: 0, drafted: 0, final: 0 };
        groups.push(group);
      }
      group.entries.push(entry);
      group[entry.status] += 1;
      return groups;
    }, []);

  return (
    <DemoChrome>
      <ScreenScroll>
        <ScreenHeader title="Dashboard" />
        <View style={styles.actionStack}>
          <Text style={styles.fieldLabel}>Server URL</Text>
          <TextInput
            autoCapitalize="none"
            keyboardType="url"
            onChangeText={setPushApiBaseUrl}
            placeholder="http://192.168.0.178:5173"
            style={styles.textInput}
            value={pushApiBaseUrl}
          />
          <Pressable
            accessibilityRole="button"
            disabled={isPushing}
            onPress={() => {
              setIsPushing(true);
              setPushFailed(false);
              setPushMessage("Pushing final mobile data to server...");
              void pushToServer(pushApiBaseUrl)
                .then((result) => {
                  setPushFailed(result.failed > 0);
                  setPushMessage(
                    `Pushed ${result.pushed} entries. ${result.skipped} skipped. ${result.failed} failed.`
                  );
                })
                .catch((error: unknown) => {
                  setPushFailed(true);
                  setPushMessage((error as Error).message);
                })
                .finally(() => {
                  setIsPushing(false);
                });
            }}
            style={[styles.actionButton, isPushing && styles.disabledButton]}
          >
            <Text style={styles.actionButtonText}>{isPushing ? "Pushing..." : "Push Final Data"}</Text>
          </Pressable>
          {pushMessage ? <Text style={pushFailed ? styles.pendingText : styles.validText}>{pushMessage}</Text> : null}
        </View>
        {dashboards.length === 0 ? (
          <EmptyState message="No WHO form entries are saved on this device yet." />
        ) : (
          dashboards.map((dashboard) => (
            <View key={dashboard.user.userId} style={styles.dashboardGroup}>
              <Text style={styles.listItemTitle}>{userLabel(dashboard.user)}</Text>
              <Text style={styles.listItemMeta}>{dashboard.user.email || dashboard.user.userId}</Text>
              <View style={styles.metricRow}>
                <View style={styles.metricBox}>
                  <Text style={styles.metricValue}>{dashboard.pending}</Text>
                  <Text style={styles.metricLabel}>Pending</Text>
                </View>
                <View style={styles.metricBox}>
                  <Text style={styles.metricValue}>{dashboard.drafted}</Text>
                  <Text style={styles.metricLabel}>Drafted</Text>
                </View>
                <View style={styles.metricBox}>
                  <Text style={styles.metricValue}>{dashboard.final}</Text>
                  <Text style={styles.metricLabel}>Final</Text>
                </View>
              </View>
              {dashboard.entries.map((entry) => {
                const content = (
                  <>
                    <View style={styles.listItemText}>
                      <Text style={styles.listItemTitle}>{entry.title}</Text>
                      <Text style={styles.listItemMeta}>
                        {statusLabel[entry.status]} - Updated {formatDateTime(entry.updatedAt)}
                      </Text>
                      <Text style={styles.listItemId}>
                        {entry.answers ? `${entry.answers} answers - ` : ""}
                        {entry.id}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.statusPill,
                        entry.status === "pending" && styles.statusPillPending,
                        entry.status === "final" && styles.statusPillFinal
                      ]}
                    >
                      {statusLabel[entry.status]}
                    </Text>
                  </>
                );
                return entry.route ? (
                  <Pressable
                    accessibilityRole="button"
                    key={entry.id}
                    onPress={() => router.push(entry.route!)}
                    style={styles.listItem}
                  >
                    {content}
                  </Pressable>
                ) : (
                  <View key={entry.id} style={styles.listItem}>
                    {content}
                  </View>
                );
              })}
            </View>
          ))
        )}
      </ScreenScroll>
    </DemoChrome>
  );
}
