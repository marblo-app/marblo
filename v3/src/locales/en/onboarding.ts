/**
 * English — `onboarding.*` namespace. Typed
 * `Record<keyof typeof koOnboarding, string>` so a key present in ko but
 * missing here (or vice-versa) is a compile error for this namespace alone.
 */
import type { onboarding as koOnboarding } from "../ko/onboarding";

export const onboarding: Record<keyof typeof koOnboarding, string> = {
  // — shared within this namespace —
  "onboarding.common.skip": "Skip",
  "onboarding.common.setupLater": "Set up later",

  // — LanguageFirstRun (first-launch language picker modal) —
  "onboarding.langFirstRun.title": "Choose your language",
  "onboarding.langFirstRun.subtitle":
    "Pick the language for Marblo. You can change it anytime in Settings.",
  "onboarding.langFirstRun.continue": "Continue",

  // — WelcomeScreen —
  "onboarding.welcome.title": "Welcome to Marblo!",
  "onboarding.welcome.subtitle":
    "Manage and optimize performance across all your channels in one place with an all-in-one marketing platform. You can get started in just a few minutes.",
  "onboarding.welcome.feature.dashboard.title": "Unified Dashboard",
  "onboarding.welcome.feature.dashboard.desc":
    "Track and analyze performance across every channel at a glance",
  "onboarding.welcome.feature.automation.title": "Automated Workflows",
  "onboarding.welcome.feature.automation.desc":
    "Automate repetitive tasks to maximize efficiency",
  "onboarding.welcome.feature.ai.title": "AI-Powered Optimization",
  "onboarding.welcome.feature.ai.desc":
    "Improve marketing performance with AI-driven insights",
  "onboarding.welcome.feature.collaboration.title": "Team Collaboration",
  "onboarding.welcome.feature.collaboration.desc":
    "Collaborate and communicate with your team in real time",
  "onboarding.welcome.stepsTitle": "🚀 Setup steps (about 5 minutes)",
  "onboarding.welcome.step.profile": "Set up your profile and basic info",
  "onboarding.welcome.step.channels":
    "Connect marketing channels (Google Ads, Meta, Naver, etc.)",
  "onboarding.welcome.step.dashboard": "Personalize your dashboard",
  "onboarding.welcome.step.team": "Invite team members and set permissions",
  "onboarding.welcome.getStarted": "Get started",

  // — OnboardingPage: step titles/descriptions + completion + header —
  "onboarding.step.profile.title": "Profile setup",
  "onboarding.step.profile.description":
    "Set up your company info and marketing goals",
  "onboarding.step.channels.title": "Channel integration",
  "onboarding.step.channels.description":
    "Connect marketing channels to start unified management",
  "onboarding.step.preferences.title": "Preferences",
  "onboarding.step.preferences.description":
    "Configure personalization and security options",
  "onboarding.step.complete.title": "Setup complete",
  "onboarding.step.complete.description": "All settings are complete",
  "onboarding.complete.heading": "🎉 Setup complete!",
  "onboarding.complete.body":
    "Marblo setup is complete. Now track and manage your marketing performance from the unified dashboard.",
  "onboarding.complete.goToDashboard": "Go to dashboard",
  "onboarding.header.title": "Marblo setup",

  // — OnboardingSteps nav —
  "onboarding.nav.previous": "Previous",
  "onboarding.nav.skipSetup": "Skip Setup",
  "onboarding.nav.skipStep": "Skip This Step",
  "onboarding.nav.next": "Next",
  "onboarding.nav.complete": "Complete",

  // — ProgressIndicator —
  "onboarding.progress.stepOf": "Step {current} of {total}",
  "onboarding.progress.percentComplete": "{percent}% Complete",

  // — ProfileSetupForm —
  "onboarding.profile.title": "Profile setup",
  "onboarding.profile.subtitle":
    "Enter your basic info for better recommendations and analysis",
  "onboarding.profile.basicInfo": "Basic info",
  "onboarding.profile.companyName": "Company name",
  "onboarding.profile.companyNamePlaceholder": "Your company",
  "onboarding.profile.website": "Website",
  "onboarding.profile.industry": "Industry",
  "onboarding.profile.industryPlaceholder": "Select an industry",
  "onboarding.profile.businessType": "Business type",
  "onboarding.profile.businessTypePlaceholder": "Select a business type",
  "onboarding.profile.teamSize": "Team size",
  "onboarding.profile.teamSizePlaceholder": "Select a team size",
  "onboarding.profile.budget": "Monthly marketing budget",
  "onboarding.profile.budgetPlaceholder": "Select a budget range",
  "onboarding.profile.description": "Company description",
  "onboarding.profile.descriptionPlaceholder":
    "Briefly describe your company's main business or strengths",
  "onboarding.profile.goalsTitle": "Marketing goals",
  "onboarding.profile.goalsHint":
    "Select your main marketing goals (multiple allowed)",
  "onboarding.profile.next": "Next step",
  "onboarding.profile.error.companyName": "Please enter your company name",
  "onboarding.profile.error.primaryGoals": "Please select at least one goal",

  // — Industries —
  "onboarding.industry.ecommerce": "E-commerce / Online shopping",
  "onboarding.industry.fashionBeauty": "Fashion / Beauty",
  "onboarding.industry.foodBeverage": "Food / Beverage",
  "onboarding.industry.electronics": "Electronics / Appliances",
  "onboarding.industry.healthMedical": "Health / Medical",
  "onboarding.industry.education": "Education / Learning",
  "onboarding.industry.travel": "Travel / Hospitality",
  "onboarding.industry.realEstate": "Real estate",
  "onboarding.industry.finance": "Finance / Insurance",
  "onboarding.industry.software": "IT / Software",
  "onboarding.industry.gameEntertainment": "Gaming / Entertainment",
  "onboarding.industry.sportsFitness": "Sports / Fitness",
  "onboarding.industry.other": "Other",

  // — Business types —
  "onboarding.businessType.b2c": "B2C (consumer-facing)",
  "onboarding.businessType.b2b": "B2B (business-facing)",
  "onboarding.businessType.b2b2c": "B2B2C (hybrid)",
  "onboarding.businessType.marketplace": "Marketplace",
  "onboarding.businessType.saas": "SaaS / Subscription",
  "onboarding.businessType.other": "Other",

  // — Team sizes (profile) —
  "onboarding.teamSize.solo": "1 (solo)",
  "onboarding.teamSize.2to5": "2–5",
  "onboarding.teamSize.6to20": "6–20",
  "onboarding.teamSize.21to50": "21–50",
  "onboarding.teamSize.51to200": "51–200",
  "onboarding.teamSize.201plus": "201+",

  // — Budget ranges —
  "onboarding.budget.under1m": "Under ₩1M / month",
  "onboarding.budget.1to5m": "₩1M–5M / month",
  "onboarding.budget.5to10m": "₩5M–10M / month",
  "onboarding.budget.10to50m": "₩10M–50M / month",
  "onboarding.budget.over50m": "Over ₩50M / month",
  "onboarding.budget.undecided": "Not decided yet",

  // — Marketing goals —
  "onboarding.goal.revenue": "Increase revenue",
  "onboarding.goal.newCustomers": "Acquire new customers",
  "onboarding.goal.brandAwareness": "Improve brand awareness",
  "onboarding.goal.retention": "Increase repeat purchase rate",
  "onboarding.goal.roi": "Improve marketing ROI",
  "onboarding.goal.competitive": "Gain a competitive advantage",
  "onboarding.goal.global": "Expand globally",
  "onboarding.goal.productLaunch": "Launch new products",
  "onboarding.goal.seasonal": "Manage seasonal sales",
  "onboarding.goal.dataDecision": "Data-driven decisions",

  // — ChannelIntegrationGuide: shell —
  "onboarding.channels.banner.title": "Connect Your Communication Channels",
  "onboarding.channels.banner.desc":
    "Integrate with your team's communication platforms to receive real-time updates and notifications. You can always add more channels later from settings.",
  "onboarding.channels.connected": "Connected",
  "onboarding.channels.hideGuide": "Hide Guide",
  "onboarding.channels.setupGuide": "Setup Guide",
  "onboarding.channels.setupStepsTitle": "Setup Steps:",
  "onboarding.channels.webhookUrl": "Webhook URL",
  "onboarding.channels.apiToken": "API Token/Key",
  "onboarding.channels.apiPlaceholder": "Enter your API token",
  "onboarding.channels.connecting": "Connecting...",
  "onboarding.channels.connect": "Connect Channel",
  "onboarding.channels.docs": "Docs",
  "onboarding.channels.setupLater": "I'll set this up later",

  // — Channel data: names —
  "onboarding.channel.googleAds.name": "Google Ads",
  "onboarding.channel.meta.name": "Meta Business",
  "onboarding.channel.naver.name": "Naver Shopping / Search Ads",
  "onboarding.channel.coupang.name": "Coupang Partners",
  "onboarding.channel.smartstore.name": "Naver SmartStore",
  "onboarding.channel.webhook.name": "Custom Webhook",

  // — Channel data: descriptions —
  "onboarding.channel.googleAds.desc":
    "Connect Google Ads to track and optimize campaign performance",
  "onboarding.channel.meta.desc":
    "Integrate the Meta (Facebook/Instagram) advertising platform",
  "onboarding.channel.naver.desc":
    "Connect your Naver Shopping and Search Ads accounts to manage performance",
  "onboarding.channel.coupang.desc":
    "Connect the Coupang Partners API to track order and commission data",
  "onboarding.channel.smartstore.desc":
    "Integrate Naver SmartStore order management and settlement data",
  "onboarding.channel.webhook.desc":
    "Set up a custom webhook endpoint for maximum flexibility",

  // — Channel data: setup steps —
  "onboarding.channel.googleAds.step1": "Sign in to your Google Ads account",
  "onboarding.channel.googleAds.step2": "Go to Tools & Settings → API Center",
  "onboarding.channel.googleAds.step3":
    "Apply for API access or use existing access",
  "onboarding.channel.googleAds.step4":
    "Generate a developer token and customer ID",
  "onboarding.channel.googleAds.step5":
    "Enable the Google Ads API in Google Cloud Console",
  "onboarding.channel.googleAds.step6":
    "Configure OAuth2 credentials for your application",
  "onboarding.channel.meta.step1": "Go to the Meta for Developers portal",
  "onboarding.channel.meta.step2": "Create a new app for the Marketing API",
  "onboarding.channel.meta.step3": "Request Marketing API permissions",
  "onboarding.channel.meta.step4": "Get your App ID and App Secret",
  "onboarding.channel.meta.step5":
    "Generate an access token with ads_management permissions",
  "onboarding.channel.meta.step6": "Add your ad account ID",
  "onboarding.channel.naver.step1":
    "Sign in to the Naver Search Ads manager tools",
  "onboarding.channel.naver.step2": "Tools → API Management → Apply for API",
  "onboarding.channel.naver.step3": "Issue your API key and secret key",
  "onboarding.channel.naver.step4":
    "Check your customer ID (top-right support center)",
  "onboarding.channel.naver.step5": "Wait for API approval (1–2 business days)",
  "onboarding.channel.naver.step6": "Enter the issued API details",
  "onboarding.channel.coupang.step1": "Sign in to Coupang Partners",
  "onboarding.channel.coupang.step2": "Partners Center → API Management",
  "onboarding.channel.coupang.step3": "Issue an Access Key and Secret Key",
  "onboarding.channel.coupang.step4": "Agree to the terms of service",
  "onboarding.channel.coupang.step5": "Test the API and verify the connection",
  "onboarding.channel.smartstore.step1": "Open the Naver Commerce API Center",
  "onboarding.channel.smartstore.step2": "Apply for the SmartStore API",
  "onboarding.channel.smartstore.step3": "Issue an Application ID and Secret",
  "onboarding.channel.smartstore.step4":
    "Approve linking with your SmartStore account",
  "onboarding.channel.smartstore.step5": "Verify order/product API permissions",
  "onboarding.channel.smartstore.step6":
    "Test API calls in the test environment",
  "onboarding.channel.webhook.step1": "Prepare your webhook endpoint URL",
  "onboarding.channel.webhook.step2": "Ensure it accepts POST requests",
  "onboarding.channel.webhook.step3": "Configure authentication if needed",
  "onboarding.channel.webhook.step4": "Test the connection",

  // — SetupWizard —
  "onboarding.wizard.sectionsTitle": "Setup Sections",
  "onboarding.wizard.section.profile": "Profile",
  "onboarding.wizard.section.preferences": "Preferences",
  "onboarding.wizard.section.workspace": "Workspace",
  "onboarding.wizard.section.security": "Security",
  "onboarding.wizard.profileInfo": "Profile Information",
  "onboarding.wizard.displayName": "Display Name",
  "onboarding.wizard.displayNamePlaceholder": "Enter your name",
  "onboarding.wizard.email": "Email Address",
  "onboarding.wizard.role": "Role",
  "onboarding.wizard.role.member": "Team Member",
  "onboarding.wizard.role.lead": "Team Lead",
  "onboarding.wizard.role.admin": "Administrator",
  "onboarding.wizard.role.owner": "Owner",
  "onboarding.wizard.timezone": "Timezone",
  "onboarding.wizard.theme": "Theme",
  "onboarding.wizard.theme.light": "Light",
  "onboarding.wizard.theme.dark": "Dark",
  "onboarding.wizard.theme.system": "System",
  "onboarding.wizard.notifications": "Notifications",
  "onboarding.wizard.notif.email": "Email Notifications",
  "onboarding.wizard.notif.push": "Push Notifications",
  "onboarding.wizard.notif.sound": "Sound Notifications",
  "onboarding.wizard.autoSave": "Auto-save changes",
  "onboarding.wizard.workspaceSettings": "Workspace Settings",
  "onboarding.wizard.workspaceName": "Workspace Name",
  "onboarding.wizard.workspaceNamePlaceholder": "My Workspace",
  "onboarding.wizard.workspaceType": "Workspace Type",
  "onboarding.wizard.wsType.personal": "Personal",
  "onboarding.wizard.wsType.team": "Team",
  "onboarding.wizard.wsType.enterprise": "Enterprise",
  "onboarding.wizard.teamSize": "Team Size",
  "onboarding.wizard.size.solo": "Just me",
  "onboarding.wizard.size.1to10": "1-10 people",
  "onboarding.wizard.size.11to50": "11-50 people",
  "onboarding.wizard.size.51to200": "51-200 people",
  "onboarding.wizard.size.201plus": "201+ people",
  "onboarding.wizard.securitySettings": "Security Settings",
  "onboarding.wizard.twoFactor": "Two-Factor Authentication",
  "onboarding.wizard.twoFactorDesc":
    "Add an extra layer of security to your account",
  "onboarding.wizard.sessionTimeout": "Session Timeout (minutes)",
  "onboarding.wizard.ipWhitelist": "IP Address Whitelist",
  "onboarding.wizard.ipWhitelistDesc":
    "Restrict access to specific IP addresses",
  "onboarding.wizard.configureLater": "I'll configure this later",
  "onboarding.wizard.saving": "Saving...",
  "onboarding.wizard.save": "Save Configuration",

  // — LoginPage (auth) —
  "onboarding.login.signupSubtitle": "Create a new account",
  "onboarding.login.loginSubtitle": "Sign in to your account",
  "onboarding.login.google": "Continue with Google",
  "onboarding.login.github": "Continue with GitHub",
  // — CliSetupGate (first-run CLI install/login gate) —
  "onboarding.cliGate.title": "Before you start — install & sign in",
  "onboarding.cliGate.subtitle":
    "The orchestrator and agents need these CLIs installed and signed in to run.",
  "onboarding.cliGate.required": "Required",
  "onboarding.cliGate.optional": "Optional",
  "onboarding.cliGate.claudeDesc":
    "Required to run the orchestrator and Claude agents.",
  "onboarding.cliGate.codexDesc": "Required to run Codex (GPT) agents.",
  "onboarding.cliGate.agyDesc":
    "Optional: install to use Antigravity (agy) agents.",
  "onboarding.cliGate.installFail": "Install failed",
  "onboarding.cliGate.manualHint":
    "Auto-install failed. Run this in a terminal instead:",
  "onboarding.cliGate.checking": "Checking…",
  "onboarding.cliGate.ready": "Ready",
  "onboarding.cliGate.notInstalled": "Not installed",
  "onboarding.cliGate.needsLogin": "Sign-in required",
  "onboarding.cliGate.install": "Install",
  "onboarding.cliGate.installing": "Installing…",
  "onboarding.cliGate.loginHint":
    "Run this in a terminal to sign in, then click ‘Re-check’:",
  "onboarding.cliGate.copy": "Copy",
  "onboarding.cliGate.copied": "Copied",
  "onboarding.cliGate.recheck": "Re-check",
  "onboarding.cliGate.continue": "Continue",
  "onboarding.cliGate.skip": "Later",

  "onboarding.login.or": "or",
  "onboarding.login.email": "Email",
  "onboarding.login.password": "Password",
  "onboarding.login.signupButton": "Sign up",
  "onboarding.login.loginButton": "Log in",
  "onboarding.login.haveAccount": "Already have an account?",
  "onboarding.login.noAccount": "Don't have an account yet?",
};
