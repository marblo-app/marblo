import React, { useState } from "react";
import {
  MessageCircle,
  Hash,
  Zap,
  Globe,
  Check,
  Copy,
  ExternalLink,
  AlertCircle,
} from "lucide-react";
import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";

/**
 * Channel `id` stays an English code identifier (used for connect calls,
 * docs URLs, webhook branching); only the display name/description/setup
 * steps are translated via key references. See ../../locales/README.md.
 */
interface IntegrationChannel {
  id: string;
  nameKey: MessageKey;
  icon: React.ReactNode;
  descKey: MessageKey;
  setupStepKeys: MessageKey[];
  webhookUrl?: string;
  apiKey?: string;
  connected?: boolean;
}

interface ChannelIntegrationGuideProps {
  availableChannels?: IntegrationChannel[];
  onConnect: (channelId: string, config: string) => Promise<void>;
  onSkip?: () => void;
}

const defaultChannels: IntegrationChannel[] = [
  {
    id: "google-ads",
    nameKey: "onboarding.channel.googleAds.name",
    icon: <Globe className="w-6 h-6" />,
    descKey: "onboarding.channel.googleAds.desc",
    setupStepKeys: [
      "onboarding.channel.googleAds.step1",
      "onboarding.channel.googleAds.step2",
      "onboarding.channel.googleAds.step3",
      "onboarding.channel.googleAds.step4",
      "onboarding.channel.googleAds.step5",
      "onboarding.channel.googleAds.step6",
    ],
  },
  {
    id: "meta",
    nameKey: "onboarding.channel.meta.name",
    icon: <MessageCircle className="w-6 h-6" />,
    descKey: "onboarding.channel.meta.desc",
    setupStepKeys: [
      "onboarding.channel.meta.step1",
      "onboarding.channel.meta.step2",
      "onboarding.channel.meta.step3",
      "onboarding.channel.meta.step4",
      "onboarding.channel.meta.step5",
      "onboarding.channel.meta.step6",
    ],
  },
  {
    id: "naver",
    nameKey: "onboarding.channel.naver.name",
    icon: <Hash className="w-6 h-6" />,
    descKey: "onboarding.channel.naver.desc",
    setupStepKeys: [
      "onboarding.channel.naver.step1",
      "onboarding.channel.naver.step2",
      "onboarding.channel.naver.step3",
      "onboarding.channel.naver.step4",
      "onboarding.channel.naver.step5",
      "onboarding.channel.naver.step6",
    ],
  },
  {
    id: "coupang",
    nameKey: "onboarding.channel.coupang.name",
    icon: <Zap className="w-6 h-6" />,
    descKey: "onboarding.channel.coupang.desc",
    setupStepKeys: [
      "onboarding.channel.coupang.step1",
      "onboarding.channel.coupang.step2",
      "onboarding.channel.coupang.step3",
      "onboarding.channel.coupang.step4",
      "onboarding.channel.coupang.step5",
    ],
  },
  {
    id: "smartstore",
    nameKey: "onboarding.channel.smartstore.name",
    icon: <Globe className="w-6 h-6" />,
    descKey: "onboarding.channel.smartstore.desc",
    setupStepKeys: [
      "onboarding.channel.smartstore.step1",
      "onboarding.channel.smartstore.step2",
      "onboarding.channel.smartstore.step3",
      "onboarding.channel.smartstore.step4",
      "onboarding.channel.smartstore.step5",
      "onboarding.channel.smartstore.step6",
    ],
  },
  {
    id: "webhook",
    nameKey: "onboarding.channel.webhook.name",
    icon: <Zap className="w-6 h-6" />,
    descKey: "onboarding.channel.webhook.desc",
    setupStepKeys: [
      "onboarding.channel.webhook.step1",
      "onboarding.channel.webhook.step2",
      "onboarding.channel.webhook.step3",
      "onboarding.channel.webhook.step4",
    ],
  },
];

export const ChannelIntegrationGuide: React.FC<
  ChannelIntegrationGuideProps
> = ({ availableChannels = defaultChannels, onConnect, onSkip }) => {
  const { t } = useTranslation();
  // selectedChannel is reset via setSelectedChannel after a successful
  // connect (so the wizard returns to the channel list); the value itself
  // isn't read here yet — Future PR will use it for "active channel"
  // highlight in the list.
  const [, setSelectedChannel] = useState<string | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<string | null>(null);
  const [connectionConfig, setConnectionConfig] = useState<
    Record<string, string>
  >({});
  const [connecting, setConnecting] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleConnect = async (channelId: string) => {
    setConnecting(true);
    try {
      await onConnect(channelId, connectionConfig[channelId]);
      setSelectedChannel(null);
      setConnectionConfig({});
    } catch (error) {
      console.error("Failed to connect channel:", error);
    } finally {
      setConnecting(false);
    }
  };

  const toggleSteps = (channelId: string) => {
    setExpandedSteps(expandedSteps === channelId ? null : channelId);
  };

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5" />
          <div>
            <h4 className="font-medium text-blue-900 dark:text-blue-100">
              {t("onboarding.channels.banner.title")}
            </h4>
            <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
              {t("onboarding.channels.banner.desc")}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4">
        {availableChannels.map((channel) => (
          <div
            key={channel.id}
            className={`
              border rounded-lg transition-all
              ${
                channel.connected
                  ? "bg-green-50 dark:bg-green-900/10 border-green-300 dark:border-green-800"
                  : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700"
              }
            `}
          >
            <div className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div
                    className={`
                    p-2 rounded-lg
                    ${
                      channel.connected
                        ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                        : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
                    }
                  `}
                  >
                    {channel.icon}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
                      {t(channel.nameKey)}
                      {channel.connected && (
                        <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                          <Check className="w-3 h-3" />
                          {t("onboarding.channels.connected")}
                        </span>
                      )}
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      {t(channel.descKey)}
                    </p>
                  </div>
                </div>

                {!channel.connected && (
                  <button
                    onClick={() => toggleSteps(channel.id)}
                    className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium"
                  >
                    {expandedSteps === channel.id
                      ? t("onboarding.channels.hideGuide")
                      : t("onboarding.channels.setupGuide")}
                  </button>
                )}
              </div>

              {expandedSteps === channel.id && (
                <div className="mt-4 space-y-4 border-t dark:border-gray-700 pt-4">
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {t("onboarding.channels.setupStepsTitle")}
                    </h4>
                    <ol className="space-y-2">
                      {channel.setupStepKeys.map((stepKey, index) => (
                        <li
                          key={index}
                          className="flex gap-2 text-sm text-gray-600 dark:text-gray-400"
                        >
                          <span className="font-medium text-gray-500">
                            {index + 1}.
                          </span>
                          <span>{t(stepKey)}</span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {channel.id === "webhook"
                          ? t("onboarding.channels.webhookUrl")
                          : t("onboarding.channels.apiToken")}
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder={
                            channel.id === "webhook"
                              ? "https://your-webhook-url.com/hook"
                              : t("onboarding.channels.apiPlaceholder")
                          }
                          value={connectionConfig[channel.id] || ""}
                          onChange={(e) =>
                            setConnectionConfig({
                              ...connectionConfig,
                              [channel.id]: e.target.value,
                            })
                          }
                          className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                          onClick={() =>
                            handleCopy(
                              connectionConfig[channel.id] || "",
                              channel.id
                            )
                          }
                          className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                        >
                          {copiedField === channel.id ? (
                            <Check className="w-5 h-5 text-green-600" />
                          ) : (
                            <Copy className="w-5 h-5" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => handleConnect(channel.id)}
                        disabled={!connectionConfig[channel.id] || connecting}
                        className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {connecting
                          ? t("onboarding.channels.connecting")
                          : t("onboarding.channels.connect")}
                      </button>
                      <button
                        onClick={() =>
                          window.open(
                            `https://docs.example.com/integrations/${channel.id}`,
                            "_blank"
                          )
                        }
                        className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center gap-2"
                      >
                        <ExternalLink className="w-4 h-4" />
                        {t("onboarding.channels.docs")}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {onSkip && (
        <div className="flex justify-center pt-4">
          <button
            onClick={onSkip}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            {t("onboarding.channels.setupLater")}
          </button>
        </div>
      )}
    </div>
  );
};
