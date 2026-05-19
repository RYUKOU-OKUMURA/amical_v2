import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/trpc/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export function PunctuationSettings() {
  const { t } = useTranslation();
  const settingsQuery = api.settings.getSettings.useQuery();
  const updateTranscriptionSettingsMutation =
    api.settings.updateTranscriptionSettings.useMutation({
      onSuccess: () => {
        void settingsQuery.refetch();
      },
    });

  const [enablePunctuation, setEnablePunctuation] = useState(true);

  useEffect(() => {
    if (settingsQuery.data?.transcription) {
      setEnablePunctuation(
        settingsQuery.data.transcription.enablePunctuation !== false,
      );
    }
  }, [settingsQuery.data]);

  const handleEnablePunctuationChange = (checked: boolean) => {
    setEnablePunctuation(checked);
    updateTranscriptionSettingsMutation.mutate(
      { enablePunctuation: checked },
      {
        onError: () => {
          setEnablePunctuation(!checked);
        },
      },
    );
  };

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <Label className="text-base font-semibold text-foreground">
          {t("settings.dictation.punctuation.label")}
        </Label>
        <p className="text-xs text-muted-foreground mb-2">
          {t("settings.dictation.punctuation.description")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("settings.dictation.punctuation.formattingNote")}
        </p>
      </div>
      <Switch
        checked={enablePunctuation}
        onCheckedChange={handleEnablePunctuationChange}
        disabled={
          settingsQuery.isLoading ||
          updateTranscriptionSettingsMutation.isPending
        }
      />
    </div>
  );
}
