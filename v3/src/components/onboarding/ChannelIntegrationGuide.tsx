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

interface IntegrationChannel {
  id: string;
  name: string;
  icon: React.ReactNode;
  description: string;
  setupSteps: string[];
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
    name: "Google Ads",
    icon: <Globe className="w-6 h-6" />,
    description:
      "Connect Google Ads to track and optimize campaign performance",
    setupSteps: [
      "Sign in to your Google Ads account",
      "Go to Tools & Settings → API Center",
      "Apply for API access or use existing access",
      "Generate developer token and customer ID",
      "Enable Google Ads API in Google Cloud Console",
      "Configure OAuth2 credentials for your application",
    ],
  },
  {
    id: "meta",
    name: "Meta Business",
    icon: <MessageCircle className="w-6 h-6" />,
    description: "Integrate Meta (Facebook/Instagram) advertising platform",
    setupSteps: [
      "Go to Meta for Developers portal",
      "Create a new app for Marketing API",
      "Request Marketing API permissions",
      "Get your App ID and App Secret",
      "Generate access token with ads_management permissions",
      "Add your ad account ID",
    ],
  },
  {
    id: "naver",
    name: "네이버 쇼핑/검색광고",
    icon: <Hash className="w-6 h-6" />,
    description: "네이버 쇼핑 및 검색광고 계정을 연동하여 성과를 관리하세요",
    setupSteps: [
      "네이버 검색광고 관리자 도구에 로그인",
      "도구 → API 관리 → API 신청",
      "API 키 및 시크릿 키 발급받기",
      "고객 ID 확인 (우상단 고객센터에서 확인)",
      "API 사용 승인 대기 (영업일 기준 1-2일)",
      "발급된 API 정보 입력",
    ],
  },
  {
    id: "coupang",
    name: "쿠팡 파트너스",
    icon: <Zap className="w-6 h-6" />,
    description: "쿠팡 파트너스 API를 연동하여 주문 및 수수료 데이터를 추적",
    setupSteps: [
      "쿠팡 파트너스에 로그인",
      "파트너스 센터 → API 관리",
      "Access Key와 Secret Key 발급",
      "서비스 이용약관 동의",
      "API 테스트 및 연동 확인",
    ],
  },
  {
    id: "smartstore",
    name: "네이버 스마트스토어",
    icon: <Globe className="w-6 h-6" />,
    description: "네이버 스마트스토어 주문 관리 및 정산 데이터 연동",
    setupSteps: [
      "네이버 커머스 API 센터 접속",
      "스마트스토어 API 신청",
      "Application ID 및 Secret 발급",
      "스마트스토어 계정과 연동 승인",
      "주문/상품 API 권한 확인",
      "테스트 환경에서 API 호출 테스트",
    ],
  },
  {
    id: "webhook",
    name: "Custom Webhook",
    icon: <Zap className="w-6 h-6" />,
    description: "Set up a custom webhook endpoint for maximum flexibility",
    setupSteps: [
      "Prepare your webhook endpoint URL",
      "Ensure it accepts POST requests",
      "Configure authentication if needed",
      "Test the connection",
    ],
  },
];

export const ChannelIntegrationGuide: React.FC<
  ChannelIntegrationGuideProps
> = ({ availableChannels = defaultChannels, onConnect, onSkip }) => {
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
              Connect Your Communication Channels
            </h4>
            <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
              Integrate with your team's communication platforms to receive
              real-time updates and notifications. You can always add more
              channels later from settings.
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
                      {channel.name}
                      {channel.connected && (
                        <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                          <Check className="w-3 h-3" />
                          Connected
                        </span>
                      )}
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      {channel.description}
                    </p>
                  </div>
                </div>

                {!channel.connected && (
                  <button
                    onClick={() => toggleSteps(channel.id)}
                    className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium"
                  >
                    {expandedSteps === channel.id ? "Hide" : "Setup"} Guide
                  </button>
                )}
              </div>

              {expandedSteps === channel.id && (
                <div className="mt-4 space-y-4 border-t dark:border-gray-700 pt-4">
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Setup Steps:
                    </h4>
                    <ol className="space-y-2">
                      {channel.setupSteps.map((step, index) => (
                        <li
                          key={index}
                          className="flex gap-2 text-sm text-gray-600 dark:text-gray-400"
                        >
                          <span className="font-medium text-gray-500">
                            {index + 1}.
                          </span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {channel.id === "webhook"
                          ? "Webhook URL"
                          : "API Token/Key"}
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder={
                            channel.id === "webhook"
                              ? "https://your-webhook-url.com/hook"
                              : "Enter your API token"
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
                        {connecting ? "Connecting..." : "Connect Channel"}
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
                        Docs
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
            I'll set this up later
          </button>
        </div>
      )}
    </div>
  );
};
