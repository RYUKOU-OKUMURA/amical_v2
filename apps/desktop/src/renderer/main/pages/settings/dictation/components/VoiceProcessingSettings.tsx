import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/trpc/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export function VoiceProcessingSettings() {
  const { t } = useTranslation();
  const settingsQuery = api.settings.getSettings.useQuery();
  const updateRecordingSettingsMutation =
    api.settings.updateRecordingSettings.useMutation({
      onSuccess: () => {
        void settingsQuery.refetch();
      },
    });

  const [audioPreprocessingEnabled, setAudioPreprocessingEnabled] =
    useState(true);

  useEffect(() => {
    if (settingsQuery.data?.recording) {
      setAudioPreprocessingEnabled(
        settingsQuery.data.recording.audioPreprocessingEnabled !== false,
      );
    }
  }, [settingsQuery.data]);

  const handleAudioPreprocessingChange = (checked: boolean) => {
    setAudioPreprocessingEnabled(checked);
    updateRecordingSettingsMutation.mutate(
      { audioPreprocessingEnabled: checked },
      {
        onError: () => {
          setAudioPreprocessingEnabled(!checked);
        },
      },
    );
  };

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <Label className="text-base font-semibold text-foreground">
          {t("settings.dictation.voiceProcessing.label")}
        </Label>
        <p className="text-xs text-muted-foreground">
          {t("settings.dictation.voiceProcessing.description")}
        </p>
      </div>
      <Switch
        checked={audioPreprocessingEnabled}
        onCheckedChange={handleAudioPreprocessingChange}
        disabled={
          settingsQuery.isLoading || updateRecordingSettingsMutation.isPending
        }
      />
    </div>
  );
}
