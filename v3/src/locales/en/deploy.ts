/**
 * English — `deploy.*` namespace. Typed `Record<keyof typeof koDeploy, string>`
 * so a key present in ko but missing here (or vice-versa) is a compile error
 * for this namespace alone.
 */
import type { deploy as koDeploy } from "../ko/deploy";

export const deploy: Record<keyof typeof koDeploy, string> = {
  "deploy.selectProject": "Select a project",
  "deploy.subtitle": "Manage GCP Cloud Run deployments",
  "deploy.requestDeploy": "Request deploy",
  "deploy.gcpConnection": "GCP connection",
  "deploy.notConnected": "Not connected",
  "deploy.connect": "Set up connection",
  "deploy.history": "Deployment history",
  "deploy.loading": "Loading...",
  "deploy.empty": "No deployments yet",
  "deploy.emptyHintBefore": "Ask the orchestrator to deploy with ",
  "deploy.emptyHintAfter": "",
  "deploy.guide.title": "Getting started",
  "deploy.guide.step1Before": "Start the orchestrator and ask ",
  "deploy.guide.step1Quoted": '"Connect my GCP project"',
  "deploy.guide.step1After": "",
  "deploy.guide.step2After": " + set project ID / region",
  "deploy.guide.step3Before": "Request a Cloud Run deploy with ",
  "deploy.guide.step3After": "",
};
