import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsService } from "../../src/services/settings-service";
import {
  getSettingsSection,
  updateSettingsSection,
} from "../../src/db/app-settings";

vi.mock("../../src/db/app-settings", () => ({
  getSettingsSection: vi.fn(),
  updateSettingsSection: vi.fn(),
  getAppSettings: vi.fn(),
  updateAppSettings: vi.fn(),
}));

const getSettingsSectionMock = vi.mocked(getSettingsSection);
const updateSettingsSectionMock = vi.mocked(updateSettingsSection);

describe("SettingsService preferences cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reuses cached preferences for repeated reads", async () => {
    getSettingsSectionMock.mockResolvedValue({
      preserveClipboard: false,
      muteSystemAudio: false,
    });
    const service = new SettingsService();

    await expect(service.getPreferences()).resolves.toMatchObject({
      preserveClipboard: false,
      muteSystemAudio: false,
    });
    await expect(service.getPreferences()).resolves.toMatchObject({
      preserveClipboard: false,
      muteSystemAudio: false,
    });

    expect(getSettingsSectionMock).toHaveBeenCalledTimes(1);
    expect(getSettingsSectionMock).toHaveBeenCalledWith("preferences");
  });

  it("updates cached preferences after setPreferences succeeds", async () => {
    getSettingsSectionMock.mockResolvedValue({
      preserveClipboard: false,
      muteSystemAudio: false,
    });
    updateSettingsSectionMock.mockResolvedValue(undefined);
    const service = new SettingsService();

    await service.getPreferences();
    await service.setPreferences({ preserveClipboard: true });

    await expect(service.getPreferences()).resolves.toMatchObject({
      preserveClipboard: true,
      muteSystemAudio: false,
    });
    expect(getSettingsSectionMock).toHaveBeenCalledTimes(1);
    expect(updateSettingsSectionMock).toHaveBeenCalledWith(
      "preferences",
      expect.objectContaining({
        preserveClipboard: true,
        muteSystemAudio: false,
      }),
    );
  });
});
