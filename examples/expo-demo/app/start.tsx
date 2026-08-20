import { useLocalSearchParams } from "expo-router";

import { FormRouteScreen } from "../components/FormRouteScreen";
import { useDemoState } from "../components/DemoState";

export default function StartRoute() {
  const { caseUid } = useLocalSearchParams<{ caseUid?: string }>();
  const { cases, getDraft, newFormKey } = useDemoState();
  const requestedCaseUid = Array.isArray(caseUid) ? caseUid[0] : caseUid;
  const selectedCase = requestedCaseUid ? cases.find((entry) => entry.uid === requestedCaseUid) : undefined;
  const savedDraft = selectedCase ? getDraft(selectedCase.uid) : undefined;

  return (
    <FormRouteScreen
      draft={savedDraft}
      draftId={selectedCase?.uid}
      emptyMessage={selectedCase ? undefined : "Save case data before starting the WHO VA form."}
      formKey={selectedCase ? `case-${selectedCase.uid}-${newFormKey}` : "start-empty"}
      initialData={selectedCase?.whoVaData}
      lockedQuestionNames={selectedCase ? Object.keys(selectedCase.whoVaData) : undefined}
      title={selectedCase ? `WHO VA: ${selectedCase.caseEntry.deceasedFullName}` : "Start New"}
    />
  );
}
