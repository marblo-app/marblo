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
    updates: Partial<WizardConfig[K]>,
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
    { id: "profile", label: "Profile", icon: User },
    { id: "preferences", label: "Preferences", icon: Settings },
    { id: "workspace", label: "Workspace", icon: Globe },
    { id: "security", label: "Security", icon: Shield },
  ];

  return (
    <div className="flex h-full">
      <div className="w-64 border-r dark:border-gray-700 p-4">
        <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
          Setup Sections
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
                Profile Information
              </h3>
              <div className="grid gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Display Name
                  </label>
                  <input
                    type="text"
                    value={config.profile.displayName}
                    onChange={(e) =>
                      updateConfig("profile", { displayName: e.target.value })
                    }
                    placeholder="Enter your name"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Email Address
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
                    Role
                  </label>
                  <select
                    value={config.profile.role}
                    onChange={(e) =>
                      updateConfig("profile", { role: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="member">Team Member</option>
                    <option value="lead">Team Lead</option>
                    <option value="admin">Administrator</option>
                    <option value="owner">Owner</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Timezone
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
                Preferences
              </h3>
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                    Theme
                  </label>
                  <div className="flex gap-3">
                    {(["light", "dark", "system"] as const).map((theme) => (
                      <button
                        key={theme}
                        onClick={() => updateConfig("preferences", { theme })}
                        className={`
                          px-4 py-2 rounded-lg border transition-colors capitalize
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
                        {theme}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                    Notifications
                  </label>
                  <div className="space-y-3">
                    {Object.entries(config.preferences.notifications).map(
                      ([key, value]) => (
                        <div
                          key={key}
                          className="flex items-center justify-between"
                        >
                          <span className="text-sm text-gray-700 dark:text-gray-300 capitalize">
                            {key === "push" ? "Push Notifications" : key}{" "}
                            Notifications
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
                      ),
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    Auto-save changes
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
                Workspace Settings
              </h3>
              <div className="grid gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Workspace Name
                  </label>
                  <input
                    type="text"
                    value={config.workspace.name}
                    onChange={(e) =>
                      updateConfig("workspace", { name: e.target.value })
                    }
                    placeholder="My Workspace"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Workspace Type
                  </label>
                  <select
                    value={config.workspace.type}
                    onChange={(e) =>
                      updateConfig("workspace", { type: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="personal">Personal</option>
                    <option value="team">Team</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Team Size
                  </label>
                  <select
                    value={config.workspace.size}
                    onChange={(e) =>
                      updateConfig("workspace", { size: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="1">Just me</option>
                    <option value="1-10">1-10 people</option>
                    <option value="11-50">11-50 people</option>
                    <option value="51-200">51-200 people</option>
                    <option value="201+">201+ people</option>
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
                Security Settings
              </h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Two-Factor Authentication
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Add an extra layer of security to your account
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
                    Session Timeout (minutes)
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
                      IP Address Whitelist
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Restrict access to specific IP addresses
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
              I'll configure this later
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="ml-auto flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Save className="w-4 h-4" />
            {saving ? "Saving..." : "Save Configuration"}
          </button>
        </div>
      </div>
    </div>
  );
};
