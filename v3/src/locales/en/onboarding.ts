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

  // — StartHereTab (onboarding promoted from a modal to a tab, ZdgQMxW7) —
  "onboarding.startHere.title": "Start here",
  "onboarding.startHere.subtitle":
    "Four steps to your first ticket. Your progress is saved — pick it up whenever.",
  "onboarding.startHere.progress": "{done} of {total} done",
  "onboarding.startHere.demoLead": "Want to see how it works first?",
  // {seconds} = runtime, measured from the demo script. Never hard-code it.
  "onboarding.startHere.watchDemo": "Watch the {seconds}-second demo",
  "onboarding.startHere.stuckLabel": "Stuck?",
  "onboarding.startHere.skipStep": "Skip for now (it stays on the list)",
  "onboarding.startHere.badge.done": "Done",
  "onboarding.startHere.badge.current": "You're here",
  "onboarding.startHere.badge.remaining": "Remaining",
  "onboarding.startHere.badge.skipped": "Skipped · remaining",
  "onboarding.startHere.allDone.title": "You're all set!",
  "onboarding.startHere.allDone.body":
    "Your first ticket is with the orchestrator. Watch it work from the Board tab.",
  "onboarding.startHere.dontLand": "Don't open this tab on launch",
  "onboarding.startHere.reenableLanding": "Open this tab on launch",
  "onboarding.startHere.dontLandHint":
    "Either way, your remaining steps stay right here.",
  "onboarding.startHere.value.kicker": "Try the value before sign-in",
  "onboarding.startHere.value.title":
    "See tickets assigned and agents doing the work",
  "onboarding.startHere.value.body":
    "The demo shows the orchestrator turning a request into tickets, assigning the right agents, and letting them work in parallel. After you connect the CLI and link your account, the same flow runs against your own project with real terminals and worktrees.",
  "onboarding.startHere.value.playInteractive": "Play interactive demo",
  "onboarding.startHere.value.zeroCost":
    "The demo plays without CLI runs, AI calls, or billing.",
  "onboarding.startHere.activation.kicker": "CLI connect + account link",
  "onboarding.startHere.activation.title":
    "After install, sign in from the bottom Agents terminal",
  "onboarding.startHere.activation.body":
    "Once auto-install finishes, Marblo creates an agent terminal. Complete claude login or codex login there; Marblo detects the session and moves you toward your first spawn.",
  "onboarding.startHere.activation.terminalTitle": "Bottom Agents terminal",
  "onboarding.startHere.activation.autoCreated": "Auto-created",
  "onboarding.startHere.activation.browserAuth":
    "Confirm the account in the browser, then return to the terminal.",
  "onboarding.startHere.activation.detected":
    "Sign-in detected — you can create the first ticket now.",
  "onboarding.startHere.activation.step.install.title": "Install",
  "onboarding.startHere.activation.step.install.body":
    "Use the install button to auto-install the required CLI and check versions.",
  "onboarding.startHere.activation.step.terminal.title": "Terminal appears",
  "onboarding.startHere.activation.step.terminal.body":
    "When sign-in is needed, a login terminal opens in the bottom Agents tab.",
  "onboarding.startHere.activation.step.auth.title": "Sign in",
  "onboarding.startHere.activation.step.auth.body":
    "Finish claude login or codex login in the terminal, then re-check.",
  "onboarding.startHere.activation.step.spawn.title": "First spawn",
  "onboarding.startHere.activation.step.spawn.body":
    "Connect a project and PRD, send the first ticket, and the orchestrator proposes agent assignments.",
  // One line per step: why it's needed
  "onboarding.startHere.why.install":
    "The orchestrator and agents run on top of these CLIs — without one, nothing can launch.",
  "onboarding.startHere.why.auth":
    "This connects the AI account you already pay for. Without it, spawns fail silently.",
  "onboarding.startHere.why.prd":
    "Project connection is for work you want to delegate. Plain local-folder browsing stays in the file tree.",
  "onboarding.startHere.why.firstTicket":
    "Creating one ticket is what makes it obvious what Marblo actually does for you.",
  // One line per step: what to do when you're stuck
  "onboarding.startHere.alt.install":
    "If auto-install fails (EACCES / npm prefix permissions), run the command shown above in a terminal yourself, or follow the official install docs.",
  "onboarding.startHere.alt.auth":
    "You only need ONE of Claude Code or Codex. If the browser flow is blocked, copy the command and run it in a terminal.",
  "onboarding.startHere.alt.prd":
    "An empty folder is fine. For a non-worktree folder you only want to inspect, use Open folder options in the file tree and choose Browse.",
  "onboarding.startHere.alt.firstTicket":
    "If sending fails, check that the orchestrator terminal is running and try again.",
  // Inline banner (the modal's replacement) — onboarding still has work left.
  // The title MUST vary per step: it used to be the single sentence "CLI
  // sign-in required", so a user who had signed in and only lacked a folder saw
  // a title saying "sign in" above a body saying "connect a folder" (barrier F2).
  "onboarding.startHere.banner.title.install": "Install the orchestrator CLI",
  "onboarding.startHere.banner.title.auth": "CLI sign-in required",
  "onboarding.startHere.banner.title.prd": "Connect a folder to work in",
  "onboarding.startHere.banner.title.firstTicket":
    "One first ticket and you're done",
  "onboarding.startHere.banner.cta": "Open Start here",
  "onboarding.startHere.banner.dismiss": "Dismiss (don't show this again)",

  // — Start Here tab: connecting other vendors (XHXSIdPN) —
  // No vendor name or model id lives here: the list is derived from the model
  // registry. These strings only say what the first-run action is; endpoints,
  // context nuances and the verification runbook stay in
  // docs/VENDOR-MODEL-USAGE-GUIDE.md.
  "onboarding.startHere.vendors.title": "Other vendors work here too",
  "onboarding.startHere.vendors.subtitle":
    "Steps ① and ② cover Claude and Codex. These are optional, and each vendor takes one setup step — once.",
  "onboarding.startHere.vendors.summary": "{ready} of {total} ready",
  "onboarding.startHere.vendors.loading": "Loading the model list…",
  "onboarding.startHere.vendors.loadFailed": "Could not load the model list.",
  "onboarding.startHere.vendors.retry": "Try again",
  // {command} = the binary this vendor actually spawns (registry-derived).
  // Vendors with their own CLI (Grok) have no such line — they reuse the very
  // same row card as steps ① and ②, described by `onboarding.cliGate.*Desc`.
  "onboarding.startHere.vendors.kind.envSwap":
    "Runs on the {command} you already have — no new CLI, just a subscription key.",
  "onboarding.startHere.vendors.status.ready": "Ready",
  "onboarding.startHere.vendors.status.needsKey": "Key needed",
  "onboarding.startHere.vendors.status.needsInstall": "Install needed",
  "onboarding.startHere.vendors.status.needsLogin": "Sign-in needed",
  "onboarding.startHere.vendors.status.unknown": "Checking",
  // {keys} = env key NAMES only — values never reach the renderer.
  "onboarding.startHere.vendors.key.hint":
    "Keys needed: {keys} — stored encrypted in the OS keychain and never shown back on screen.",
  "onboarding.startHere.vendors.key.cta": "Add the key in Settings",
  "onboarding.startHere.vendors.key.recheck": "Re-check",
  "onboarding.startHere.vendors.key.ready":
    "The key is registered. Pin a model as shown below (agents spawned after the key was saved pick it up).",
  "onboarding.startHere.vendors.dispatchLabel":
    "How to launch it — say this to the orchestrator",
  // {model} = the concrete model id picked from the chips above (registry-derived).
  "onboarding.startHere.vendors.dispatchSnippet":
    'dispatch_task(role="backend", instruction="…", model="{model}")',
  "onboarding.startHere.vendors.guideLead":
    "Endpoints, context nuances and the verification runbook live here:",

  // — Step ②'s BYOM alternative (activation F4) —
  // ★No vendor names here either. The list is registry-derived; this table only
  //   carries the fact that you can start without an account, and on what terms.
  "onboarding.byom.title": "No account? Start with a vendor key",
  "onboarding.byom.headline.ready":
    "A registered vendor key is ready — continue without a Claude or Codex account.",
  "onboarding.byom.headline.workerOnly":
    "You have a usable vendor. The orchestrator still runs on Claude/Codex only, so assign these vendors to worker agents instead.",
  "onboarding.byom.headline.setup":
    "Instead of a Claude or Codex account you can start with a key from an AI subscription you already pay for. Each vendor is a one-time setup.",
  "onboarding.byom.headline.none":
    "This build has no additional vendors to connect.",
  "onboarding.byom.canHostOrchestrator":
    "✓ This vendor can run the orchestrator too — it satisfies this step on its own.",
  // ★This line is what keeps the screen honest. Do not drop or soften it —
  //   without it a user clears step ② and then stalls at step ④ for no visible
  //   reason.
  "onboarding.byom.workerOnlyNote":
    "This vendor is worker-agent only for now. The orchestrator — the side that files tickets and dispatches agents — still needs a Claude or Codex account, so this vendor alone cannot clear this step.",

  // — LoginPage (auth) —
  "onboarding.login.signupSubtitle": "Create a new account",
  "onboarding.login.loginSubtitle": "Sign in to your account",
  "onboarding.login.google": "Continue with Google",
  "onboarding.login.github": "Continue with GitHub",
  // — CliSetupGate (first-run CLI install/login gate) —
  "onboarding.cliGate.title": "Before you start — install & sign in",
  "onboarding.cliGate.subtitle":
    "Sign in to Claude Code first to open the orchestrator. Codex and others are optional.",
  "onboarding.cliGate.required": "Required",
  "onboarding.cliGate.optional": "Optional",
  "onboarding.cliGate.claudeDesc":
    "Required to run the orchestrator and Claude agents.",
  "onboarding.cliGate.codexDesc":
    "Optional: install to run Codex (GPT) agents.",
  "onboarding.cliGate.agyDesc":
    "Optional: install to use Antigravity (agy) agents.",
  "onboarding.cliGate.grokDesc":
    "Optional: install, then sign in through the browser to use Grok (xAI) agents.",
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
  "onboarding.cliGate.outdated": "Outdated (v{from} → v{to})",
  "onboarding.cliGate.updateHint":
    "Update to the latest version with the command below:",
  "onboarding.cliGate.runLogin": "Run sign-in",
  "onboarding.cliGate.runLoginHint":
    "Runs in a terminal · detected automatically when done",

  // — One-click onboarding (ticket afW5wNdX) —
  "onboarding.cliGate.installAll.title": "Install all required CLIs",
  "onboarding.cliGate.installAll.body":
    "Installs only the CLIs that are still missing, one after another. Anything already installed is skipped.",
  "onboarding.cliGate.installAll.cta": "Install all ({count})",
  "onboarding.cliGate.installAll.running": "Installing… {done}/{total}",
  "onboarding.cliGate.installAll.done": "All {total} installed.",
  "onboarding.cliGate.installAll.partial":
    "{failed} of {total} failed — continue from the manual command and official docs on each failed card.",
  "onboarding.cliGate.installAll.allDone":
    "Every required CLI is already installed.",
  "onboarding.cliGate.signInAll.title": "One-click sign-in",
  "onboarding.cliGate.signInAll.body":
    "A terminal tab opens and the login command is typed for you. Approve in the browser when it pops up — there is nothing to type yourself.",
  "onboarding.cliGate.signInAll.cta": "Sign in with {cli}",
  "onboarding.cliGate.signInAll.launched":
    "Opened the {cli} terminal and ran its login command. Approve it in the browser.",
  "onboarding.cliGate.signInAll.watching":
    "We detect completion automatically.",
  "onboarding.cliGate.signInAll.others":
    "{count} other CLI(s) can be signed in the same way from their own cards.",
  "onboarding.cliGate.subscription.title": "No subscription yet?",
  "onboarding.cliGate.subscription.body":
    "Open the official subscription page to choose a plan. One subscription is a fixed plan: no surprise per-token billing, and safe use within the plan's usage limits.",
  "onboarding.cliGate.subscription.byomComplement":
    "Subscriptions sign in with a Claude Code/Codex account; vendor keys are a separate path for providers you bring yourself.",
  "onboarding.cliGate.subscription.byomBridge":
    "Claude/Codex subscription sign-in and vendor-key setup are complementary paths. Subscriptions run within official plan limits; BYOM keys are managed separately below.",
  "onboarding.cliGate.subscription.openClaude":
    "Go to the official Claude Pro/Max page",
  "onboarding.cliGate.subscription.openCodex":
    "Go to the official ChatGPT Plus/Pro page",

  // — CliSetupGate connection wizard steps (ticket CecrriY8) —
  "onboarding.cliGate.step.notice": "Notice",
  "onboarding.cliGate.step.connect": "Connect",
  "onboarding.cliGate.step.project": "Start",
  "onboarding.cliGate.stepOf": "Step {current} of {total}",
  // Cost notice block — describes "connect your existing account" without the BYOK term.
  "onboarding.cliGate.notice.title":
    "Before installing — AI usage is not included",
  "onboarding.cliGate.notice.body":
    "Marblo orchestrates AI CLIs like Claude Code and Codex. AI usage is not part of your Marblo plan — you connect the Claude Code and Codex accounts you already use. Marblo never asks you for a separate API key.",
  "onboarding.cliGate.notice.b1":
    "Connect the Claude Code / Codex accounts you already subscribe to.",
  "onboarding.cliGate.notice.b2":
    "AI token usage is billed to each CLI account — separate from your Marblo plan.",
  "onboarding.cliGate.notice.b3":
    "We auto-detect and install the CLIs you need below, and sign-in runs in a built-in terminal.",
  "onboarding.cliGate.notice.continue": "Start install & connect",
  "onboarding.cliGate.back": "Back",
  "onboarding.cliGate.next": "Next",
  // Project / launch step
  "onboarding.cliGate.project.title": "Connect a project · first run",
  "onboarding.cliGate.project.body":
    "Connect a folder as a project when you want the orchestrator to work on it. New here? Start with a sample PRD to create your first ticket.",
  "onboarding.cliGate.project.connectFolder": "Connect a folder & start",
  "onboarding.cliGate.project.seedPrd": "Create a sample PRD",
  "onboarding.cliGate.project.seeding": "Creating…",
  "onboarding.cliGate.project.seeded": "Created PRD.md — opened in the editor.",
  "onboarding.cliGate.project.seedFail": "Failed to create the PRD.",
  "onboarding.cliGate.project.connected": "Connected",
  "onboarding.cliGate.project.launching": "Launching the orchestrator…",
  "onboarding.cliGate.project.hint":
    "This button registers the folder as a project and opens the orchestrator automatically.",
  "onboarding.cliGate.project.localFolderHint":
    "To just open a local folder and browse files, use Open folder options in the file tree and choose Browse.",
  "onboarding.cliGate.done": "Done",

  // — CliSetupGate linear 4-step activation wizard (ticket ir94m9C6) —
  // Progress-indicator step labels
  "onboarding.cliGate.step.install": "Install",
  "onboarding.cliGate.step.auth": "Sign in",
  "onboarding.cliGate.step.prd": "PRD",
  "onboarding.cliGate.step.firstTicket": "First ticket",
  // ① Install
  "onboarding.cliGate.install.title": "① Install the CLI",
  "onboarding.cliGate.install.body":
    "Install the AI CLI that runs the orchestrator. We try to install it automatically, and show the official install method if that fails.",
  "onboarding.cliGate.install.costNote":
    "AI usage is not part of your Marblo plan — it's billed to the Claude Code / Codex accounts you already use.",
  "onboarding.cliGate.install.officialHint":
    "If auto-install is blocked (e.g. EACCES / npm prefix permission issues), run the command below in a terminal yourself, or follow the official install docs.",
  "onboarding.cliGate.install.official": "Open official install docs",
  // ② Auth
  "onboarding.cliGate.auth.title": "② Sign in",
  "onboarding.cliGate.auth.body":
    "Sign in to just one of Claude Code or Codex. ‘Run sign-in’ runs in a built-in terminal and is detected automatically when done.",
  "onboarding.cliGate.auth.needInstall":
    "Install a CLI first before signing in. Go back to the install step.",
  // ③ Sample PRD
  "onboarding.cliGate.prd.title": "③ Sample PRD",
  "onboarding.cliGate.prd.body":
    "Connect the folder you want the orchestrator to work on as a project, then start from a sample PRD.",
  // ④ First ticket (the aha moment)
  "onboarding.cliGate.firstTicket.title": "④ Create your first ticket",
  "onboarding.cliGate.firstTicket.body":
    "Ask the orchestrator to create your first ticket from this PRD and propose spawning an agent. The button hands it your first prompt — then watch the orchestrator get to work.",
  "onboarding.cliGate.firstTicket.create":
    "Create my first ticket from this PRD",
  "onboarding.cliGate.firstTicket.creating": "Sending to the orchestrator…",
  "onboarding.cliGate.firstTicket.sent":
    "First prompt sent — the orchestrator is preparing your first ticket. Hang tight.",
  "onboarding.cliGate.firstTicket.result.delivered.title":
    "First ticket is starting",
  "onboarding.cliGate.firstTicket.result.queued.title":
    "Nothing will happen until the orchestrator starts",
  "onboarding.cliGate.firstTicket.result.failed.title":
    "The first ticket was not created",
  "onboarding.cliGate.firstTicket.retry": "Try again",
  "onboarding.cliGate.firstTicket.retrying": "Trying again…",
  // ★queued ≠ delivered: it only landed in the durable queue because no local
  //   orchestrator accepted it. Showing this as a green "sent" is what made a
  //   dead screen read as success (activation F3). needOrch.* is the next step.
  "onboarding.cliGate.firstTicket.queued":
    "Not delivered yet — it's only sitting in the queue. This project's orchestrator isn't running, so there's nobody to create the first ticket right now.",
  "onboarding.cliGate.firstTicket.needOrch.title":
    "Start the orchestrator to actually get your first ticket",
  "onboarding.cliGate.firstTicket.needOrch.step1":
    "Open the orchestrator panel (the left spine, or the “Orchestrator” bar at the bottom). If it says “Stopped”, pick a model and hit [Start].",
  "onboarding.cliGate.firstTicket.needOrch.step2":
    "If [Start] is blocked on CLI sign-in, finish steps ① install and ② sign-in. The orchestrator relaunches by itself once you're authenticated.",
  "onboarding.cliGate.firstTicket.needOrch.step3":
    "Once the orchestrator is running, press the button above once more to create the first ticket.",
  "onboarding.cliGate.firstTicket.needOrch.crossMachine":
    "If this project's orchestrator is running on another machine, the queued prompt will be delivered there shortly.",
  "onboarding.cliGate.firstTicket.failed":
    "Couldn't send it. Make sure the orchestrator is running, then try again.",
  "onboarding.cliGate.firstTicket.needProject":
    "Connect a folder first (step ③).",
  // First prompt sent to the orchestrator — wires into the tf-start greeting hook.
  "onboarding.cliGate.firstTicket.prompt":
    "Read this project's PRD.md and create the first ticket from it. Then propose spawning the right agent(s) for that ticket.",
  // Sample PRD file contents (nudges the first ticket, opened in the editor)
  "onboarding.cliGate.prdContent":
    "# Product Requirements (PRD)\n\n> This is a Marblo sample PRD. Replace the sections below with your own goal, then tell the orchestrator: 'Create my first ticket from this PRD.'\n\n## What are we building?\nDescribe the goal in one sentence. e.g. A simple landing page where visitors can leave their email.\n\n## Why does it matter?\nDescribe the problem this solves.\n\n## Key requirements\n- [ ] Requirement 1\n- [ ] Requirement 2\n- [ ] Requirement 3\n\n## Definition of done\n- What makes this 'done'?\n",

  "onboarding.login.or": "or",
  "onboarding.login.email": "Email",
  "onboarding.login.password": "Password",
  "onboarding.login.marketingConsentLabel":
    "Receive Marblo news and update emails (optional)",
  "onboarding.login.marketingConsentHint":
    "Get product news, updates, and beta notices from team@marblo.app. You can sign up and use Marblo without agreeing.",
  "onboarding.login.signupButton": "Sign up",
  "onboarding.login.loginButton": "Log in",
  "onboarding.login.haveAccount": "Already have an account?",
  "onboarding.login.noAccount": "Don't have an account yet?",

  // — LoginPage: pre-auth demo entry (Demo Mode P3, ticket qQLGS3NW) —
  "onboarding.login.demoLead": "Want to see how Marblo works first?",
  "onboarding.login.watchDemo": "Watch the {seconds}-second demo",

  // — DemoMode (pre-auth sample demo playback, two acts) —
  // NOTE: step delays are computed from the *Korean* copy (see demoScript.ts),
  // so editing these English strings does not change the runtime.
  "onboarding.demo.badge": "Sample demo",
  "onboarding.demo.title":
    "The orchestrator breaks a ticket down and assigns agents",
  "onboarding.demo.disclaimer":
    "A preview that plays with no real CLI runs, AI calls, or billing.",
  "onboarding.demo.close": "Close",
  "onboarding.demo.orchestrator": "Orchestrator",
  "onboarding.demo.thinking": "Thinking…",
  "onboarding.demo.board": "Task board",
  "onboarding.demo.status.queued": "Queued",
  "onboarding.demo.status.analyzing": "Analyzing",
  "onboarding.demo.status.running": "In progress",
  "onboarding.demo.status.done": "Done",
  "onboarding.demo.col.todo": "To do",
  "onboarding.demo.col.doing": "In progress",
  "onboarding.demo.col.done": "Done",
  "onboarding.demo.agentWorking": "working",
  "onboarding.demo.playing": "Playing the sample scenario…",
  "onboarding.demo.paused":
    "Paused — hit resume to pick up where you left off.",
  "onboarding.demo.skip": "Skip this act",
  "onboarding.demo.replay": "Replay from the start",
  "onboarding.demo.pause": "Pause",
  "onboarding.demo.resume": "Resume",
  "onboarding.demo.nextStep": "Next step",
  "onboarding.demo.cta": "Connect my account and run it for real",
  // Act (chapter) structure
  "onboarding.demo.act.indicator": "Act {current}/{total}",
  "onboarding.demo.act1.name": "Act 1 · Open the project from a PRD",
  "onboarding.demo.act2.name": "Act 2 · Add follow-up work",
  "onboarding.demo.act1.request": "Build a landing page",
  "onboarding.demo.act2.request": "Add a subscriber admin screen",
  "onboarding.demo.nextAct": "Continue to Act 2 · Add follow-up work",
  "onboarding.demo.actDone": "That's Act 1. In real life you don't stop there.",
  // Ticket cards — Act 1 (PRD decomposition)
  "onboarding.demo.sub.frontend": "Build the landing page UI and email form",
  "onboarding.demo.sub.backend": "Write the email-capture API endpoint",
  "onboarding.demo.sub.test": "End-to-end test the form submission flow",
  // Ticket cards — Act 2 (added via /tf-add)
  "onboarding.demo.sub.subApi": "Subscriber list API with search params",
  "onboarding.demo.sub.subUi": "Subscriber list screen with CSV export",
  "onboarding.demo.role.frontend": "Frontend",
  "onboarding.demo.role.backend": "Backend",
  "onboarding.demo.role.test": "Test",
  "onboarding.demo.carriedOver": "Done in Act 1",
  "onboarding.demo.scheduled": "Scheduled",
  "onboarding.demo.blockedBy": "Waiting on a prerequisite",
  // — Act 1 script: you write a PRD and open the project with /tf-start —
  "onboarding.demo.a1.user": "I wrote what I want to build in PRD.md.",
  "onboarding.demo.a1.cmd": "/tf-start PRD.md",
  "onboarding.demo.a1.cmdHint":
    "The first time in, open it with your PRD and /tf-start.",
  "onboarding.demo.a1.readPrd": "Read the PRD. Found 3 requirements.",
  "onboarding.demo.a1.decompose":
    "Broke it into 3 tickets and put them on the board.",
  "onboarding.demo.a1.assign": "Assigning the right agent to each ticket.",
  "onboarding.demo.a1.claudeStart": "I've got frontend and test.",
  "onboarding.demo.a1.codexStart": "I've got the backend API.",
  "onboarding.demo.a1.working":
    "Working in parallel, each in its own isolated worktree.",
  "onboarding.demo.a1.done":
    "All 3 tickets are done. For real, each one carries on to a PR.",
  // — Act 2 script: from then on, write your prompt right after /tf-add —
  "onboarding.demo.a2.user":
    "One more requirement came in — an admin screen listing subscribers.",
  // The command and the prompt land as two separate beats, in typing order.
  "onboarding.demo.a2.cmd": "/tf-add",
  "onboarding.demo.a2.prompt":
    "Subscriber list screen. Email search and CSV export.",
  "onboarding.demo.a2.cmdHint":
    "From then on, just write what you want right after /tf-add.",
  "onboarding.demo.a2.ingest":
    "Left the running board alone and stacked 2 new tickets on top.",
  "onboarding.demo.a2.dependency":
    "The list screen needs the query API first, so I scheduled it.",
  "onboarding.demo.a2.codexStart": "I've got the subscriber query API.",
  "onboarding.demo.a2.unblocked":
    "The prerequisite landed, so the hold is released.",
  "onboarding.demo.a2.claudeStart": "Starting the list screen right away.",
  "onboarding.demo.a2.done":
    "The follow-up work is done too 🎉 — keep stacking with /tf-add while the project runs.",
};
