import React, { useState } from "react";
import {
  Settings,
  User,
  Shield,
  Globe,
  Palette,
  Save,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";

export interface WizardConfig {
  profile: {
    displayName: string;
    email: string;
    role: string;
    timezone: string;
  };
  preferences: {
    theme: "light" | "dark" | "system";
    notifications: {
      email: boolean;
      push: boolean;
      sound: boolean;
    };
    language: string;
    autoSave: boolean;
  };
  workspace: {
    name: string;
    type: string;
    size: string;
  };
  security: {
    twoFactorAuth: boolean;
    sessionTimeout: number;
    ipWhitelist: boolean;
  };
}

interface SetupWizardProps {
  initialConfig?: Partial<WizardConfig>;
  onSave: (config: WizardConfig) => Promise<void>;
  onSkip?: () => void;
}

const defaultConfig: WizardConfig = {
  profile: {
    displayName: "",
    email: "",
    role: "member",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  },
  preferences: {
    theme: "system",
    notifications: {
      email: true,
      push: true,
      sound: false,
    },
    language: "en",
    autoSave: true,
  },
  workspace: {
    name: "",
    type: "team",
    size: "1-10",
  },
  security: {
    twoFactorAuth: false,
    sessionTimeout: 30,
    ipWhitelist: false,
  },
};

export const SetupWizard: React.FC<SetupWizardProps> = ({
  initialConfig,
  onSave,
  onSkip,
}) => {
  const { t } = useTranslation();
  const [config, setConfig] = useState<WizardConfig>({
    ...defaultConfig,
    ...initialConfig,
  });
  const [activeSection, setActiveSection] = useState<
    "profile" | "preferences" | "workspace" | "security"
  >("profile");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(config);
    } catch (error) {
      console.error("Failed to save configuration:", error);
    } finally {
      setSaving(false);
    }
  };

  const updateConfig = <K extends keyof WizardConfig>(
    section: K,
    updates: Partial<WizardConfig[K]>
  ) => {
    setConfig((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        ...updates,
      },
    }));
  };

  const sections = [
    {
      id: "profile",
      label: t("onboarding.wizard.section.profile"),
      icon: User,
    },
    {
      id: "preferences",
      label: t("onboarding.wizard.section.preferences"),
      icon: Settings,
    },
    {
      id: "workspace",
      label: t("onboarding.wizard.section.workspace"),
      icon: Globe,
    },
    {
      id: "security",
      label: t("onboarding.wizard.section.security"),
      icon: Shield,
    },
  ];

  const notifLabels: Record<string, MessageKey> = {
    email: "onboarding.wizard.notif.email",
    push: "onboarding.wizard.notif.push",
    sound: "onboarding.wizard.notif.sound",
  };

  return (
    <div className="flex h-full">
      <div className="w-64 border-r dark:border-gray-700 p-4">
        <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
          {t("onboarding.wizard.sectionsTitle")}
        </h3>
        <nav className="space-y-1">
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveSection(id as keyof WizardConfig)}
              className={`
                w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors
                ${
                  activeSection === id
                    ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                    : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                }
              `}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex-1 p-6 overflow-y-auto">
        {activeSection === "profile" && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                {t("onboarding.wizard.profileInfo")}
              </h3>
              <div className="grid gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t("onboarding.wizard.displayName")}
                  </label>
                  <input
                    type="text"
                    value={config.profile.displayName}
                    onChange={(e) =>
                      updateConfig("profile", { displayName: e.target.value })
                    }
                    placeholder={t("onboarding.wizard.displayNamePlaceholder")}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t("onboarding.wizard.email")}
                  </label>
                  <input
                    type="email"
                    value={config.profile.email}
                    onChange={(e) =>
                      updateConfig("profile", { email: e.target.value })
                    }
                    placeholder="your@email.com"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t("onboarding.wizard.role")}
                  </label>
                  <select
                    value={config.profile.role}
                    onChange={(e) =>
                      updateConfig("profile", { role: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="member">
                      {t("onboarding.wizard.role.member")}
                    </option>
                    <option value="lead">
                      {t("onboarding.wizard.role.lead")}
                    </option>
                    <option value="admin">
                      {t("onboarding.wizard.role.admin")}
                    </option>
                    <option value="owner">
                      {t("onboarding.wizard.role.owner")}
                    </option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t("onboarding.wizard.timezone")}
                  </label>
                  <input
                    type="text"
                    value={config.profile.timezone}
                    onChange={(e) =>
                      updateConfig("profile", { timezone: e.target.value })
                    }
                    placeholder="America/New_York"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSection === "preferences" && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                {t("onboarding.wizard.section.preferences")}
              </h3>
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                    {t("onboarding.wizard.theme")}
                  </label>
                  <div className="flex gap-3">
                    {(["light", "dark", "system"] as const).map((theme) => (
                      <button
                        key={theme}
                        onClick={() => updateConfig("preferences", { theme })}
                        className={`
                          px-4 py-2 rounded-lg border transition-colors
                          ${
                            config.preferences.theme === theme
                              ? "bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300"
                              : "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500"
                          }
                        `}
                      >
                        {theme === "light" && (
                          <Palette className="w-4 h-4 inline mr-2" />
                        )}
                        {theme === "dark" && (
                          <Palette className="w-4 h-4 inline mr-2" />
                        )}
                        {theme === "system" && (
                          <Settings className="w-4 h-4 inline mr-2" />
                        )}
                        {t(`onboarding.wizard.theme.${theme}` as MessageKey)}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                    {t("onboarding.wizard.notifications")}
                  </label>
                  <div className="space-y-3">
                    {Object.entries(config.preferences.notifications).map(
                      ([key, value]) => (
                        <div
                          key={key}
                          className="flex items-center justify-between"
                        >
                          <span className="text-sm text-gray-700 dark:text-gray-300">
                            {t(notifLabels[key])}
                          </span>
                          <button
                            onClick={() =>
                              updateConfig("preferences", {
                                notifications: {
                                  ...config.preferences.notifications,
                                  [key]: !value,
                                },
                              })
                            }
                            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                          >
                            {value ? (
                              <ToggleRight className="w-8 h-8 text-blue-600" />
                            ) : (
                              <ToggleLeft className="w-8 h-8" />
                            )}
                          </button>
                        </div>
                      )
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {t("onboarding.wizard.autoSave")}
                  </span>
                  <button
                    onClick={() =>
                      updateConfig("preferences", {
                        autoSave: !config.preferences.autoSave,
                      })
                    }
                    className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  >
                    {config.preferences.autoSave ? (
                      <ToggleRight className="w-8 h-8 text-blue-600" />
                    ) : (
                      <ToggleLeft className="w-8 h-8" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSection === "workspace" && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                {t("onboarding.wizard.workspaceSettings")}
              </h3>
              <div className="grid gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t("onboarding.wizard.workspaceName")}
                  </label>
                  <input
                    type="text"
                    value={config.workspace.name}
                    onChange={(e) =>
                      updateConfig("workspace", { name: e.target.value })
                    }
                    placeholder={t(
                      "onboarding.wizard.workspaceNamePlaceholder"
                    )}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t("onboarding.wizard.workspaceType")}
                  </label>
                  <select
                    value={config.workspace.type}
                    onChange={(e) =>
                      updateConfig("workspace", { type: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="personal">
                      {t("onboarding.wizard.wsType.personal")}
                    </option>
                    <option value="team">
                      {t("onboarding.wizard.wsType.team")}
                    </option>
                    <option value="enterprise">
                      {t("onboarding.wizard.wsType.enterprise")}
                    </option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t("onboarding.wizard.teamSize")}
                  </label>
                  <select
                    value={config.workspace.size}
                    onChange={(e) =>
                      updateConfig("workspace", { size: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="1">
                      {t("onboarding.wizard.size.solo")}
                    </option>
                    <option value="1-10">
                      {t("onboarding.wizard.size.1to10")}
                    </option>
                    <option value="11-50">
                      {t("onboarding.wizard.size.11to50")}
                    </option>
                    <option value="51-200">
                      {t("onboarding.wizard.size.51to200")}
                    </option>
                    <option value="201+">
                      {t("onboarding.wizard.size.201plus")}
                    </option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSection === "security" && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                {t("onboarding.wizard.securitySettings")}
              </h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {t("onboarding.wizard.twoFactor")}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {t("onboarding.wizard.twoFactorDesc")}
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      updateConfig("security", {
                        twoFactorAuth: !config.security.twoFactorAuth,
                      })
                    }
                    className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  >
                    {config.security.twoFactorAuth ? (
                      <ToggleRight className="w-8 h-8 text-blue-600" />
                    ) : (
                      <ToggleLeft className="w-8 h-8" />
                    )}
                  </button>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t("onboarding.wizard.sessionTimeout")}
                  </label>
                  <input
                    type="number"
                    value={config.security.sessionTimeout}
                    onChange={(e) =>
                      updateConfig("security", {
                        sessionTimeout: parseInt(e.target.value) || 30,
                      })
                    }
                    min="5"
                    max="1440"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {t("onboarding.wizard.ipWhitelist")}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {t("onboarding.wizard.ipWhitelistDesc")}
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      updateConfig("security", {
                        ipWhitelist: !config.security.ipWhitelist,
                      })
                    }
                    className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  >
                    {config.security.ipWhitelist ? (
                      <ToggleRight className="w-8 h-8 text-blue-600" />
                    ) : (
                      <ToggleLeft className="w-8 h-8" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mt-8 pt-6 border-t dark:border-gray-700">
          {onSkip && (
            <button
              onClick={onSkip}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              {t("onboarding.wizard.configureLater")}
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="ml-auto flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Save className="w-4 h-4" />
            {saving
              ? t("onboarding.wizard.saving")
              : t("onboarding.wizard.save")}
          </button>
        </div>
      </div>
    </div>
  );
};
