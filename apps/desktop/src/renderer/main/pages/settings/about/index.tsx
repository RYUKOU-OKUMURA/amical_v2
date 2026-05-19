import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BookOpen } from "lucide-react";
import { api } from "@/trpc/react";
import { useTranslation } from "react-i18next";

const CHANGELOG_URL = "https://github.com/amicalhq/amical/releases";
const GITHUB_URL = "https://github.com/amicalhq/amical";
const DISCORD_URL = "https://amical.ai/community";
const CONTACT_EMAIL = "contact@amical.ai";

export default function AboutSettingsPage() {
  const { t } = useTranslation();
  const { data: version } = api.settings.getAppVersion.useQuery();

  return (
    <div>
      {/* Header Section */}
      <div className="mb-8">
        <h1 className="text-xl font-bold">{t("settings.about.title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("settings.about.description")}
        </p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardContent className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="text-lg font-semibold">
                {t("settings.about.currentVersion")}
              </div>
              <Badge variant="secondary" className="mt-1">
                v{version || "..."}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <div className="text-lg font-semibold text-foreground">
                {t("settings.about.resources.title")}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("settings.about.resources.description")}
              </p>
            </div>
            <div className="divide-y">
              <ExternalLink href={CHANGELOG_URL}>
                <div className="flex items-center justify-between py-4 group cursor-pointer">
                  <div>
                    <div className="flex items-center gap-2 font-semibold text-base group-hover:underline">
                      <BookOpen className="w-5 h-5 text-muted-foreground" />
                      {t("settings.about.resources.changeLog.title")}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {t("settings.about.resources.changeLog.description")}
                    </div>
                  </div>
                </div>
              </ExternalLink>
              <ExternalLink href={GITHUB_URL}>
                <div className="flex items-center justify-between py-4 group cursor-pointer">
                  <div>
                    <div className="flex items-center gap-2 font-semibold text-base group-hover:underline">
                      {/* GitHub icon as image */}
                      <img
                        src="icons/integrations/github.svg"
                        alt={t("settings.about.resources.github.alt")}
                        className="w-5 h-5 inline-block align-middle"
                      />
                      {t("settings.about.resources.github.title")}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {t("settings.about.resources.github.description")}
                    </div>
                  </div>
                </div>
              </ExternalLink>
              <ExternalLink href={DISCORD_URL}>
                <div className="flex items-center justify-between py-4 group cursor-pointer">
                  <div>
                    <div className="flex items-center gap-2 font-semibold text-base group-hover:underline">
                      {/* Discord icon as image */}
                      <img
                        src="icons/integrations/discord.svg"
                        alt={t("settings.about.resources.discord.alt")}
                        className="w-5 h-5 inline-block align-middle"
                      />
                      {t("settings.about.resources.discord.title")}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {t("settings.about.resources.discord.description")}
                    </div>
                  </div>
                </div>
              </ExternalLink>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <div className="text-lg font-semibold text-foreground">
                {t("settings.about.contact.title")}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("settings.about.contact.description")}
              </p>
            </div>
            <ExternalLink href={`mailto:${CONTACT_EMAIL}`}>
              <div className="flex items-center justify-between group cursor-pointer">
                <div>
                  <div className="font-semibold text-base group-hover:underline">
                    {CONTACT_EMAIL}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {t("settings.about.contact.emailCta")}
                  </div>
                </div>
              </div>
            </ExternalLink>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const ExternalLink = ({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) => {
  const openLink = async () => {
    await window.electronAPI.openExternal(href);
  };

  const handleClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    await openLink();
  };

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLAnchorElement>) => {
    if (e.key !== "Enter" && e.key !== " ") {
      return;
    }

    e.preventDefault();
    await openLink();
  };

  return (
    <a
      href={href}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      style={{ cursor: "pointer" }}
    >
      {children}
    </a>
  );
};
