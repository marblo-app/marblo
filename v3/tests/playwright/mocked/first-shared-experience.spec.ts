import { test, expect } from "@playwright/test";

async function renderMarkup(page: import("@playwright/test").Page, html: string) {
  await page.setContent(`
    <html>
      <head>
        <style>
          body { margin: 0; background: #111827; color: white; font-family: Inter, system-ui, sans-serif; }
          .fixed { position: fixed; }
          .inset-0 { inset: 0; }
          .z-50 { z-index: 50; }
          .flex { display: flex; }
          .grid { display: grid; }
          .items-center { align-items: center; }
          .justify-center { justify-content: center; }
          .justify-between { justify-content: space-between; }
          .flex-wrap { flex-wrap: wrap; }
          .gap-2 { gap: 8px; }
          .gap-3 { gap: 12px; }
          .space-y-4 > * + * { margin-top: 16px; }
          .rounded, .rounded-lg { border-radius: 8px; }
          .border { border: 1px solid #374151; }
          .bg-gray-800 { background: #1f2937; }
          .bg-gray-900\\/70 { background: rgba(17, 24, 39, 0.7); }
          .bg-black\\/65 { background: rgba(0, 0, 0, 0.65); }
          .bg-violet-500\\/10 { background: rgba(139, 92, 246, 0.1); }
          .bg-blue-500\\/10 { background: rgba(59, 130, 246, 0.1); }
          .bg-amber-500\\/10 { background: rgba(245, 158, 11, 0.1); }
          .bg-blue-600 { background: #2563eb; }
          .px-3 { padding-left: 12px; padding-right: 12px; }
          .px-4 { padding-left: 16px; padding-right: 16px; }
          .px-5 { padding-left: 20px; padding-right: 20px; }
          .py-2 { padding-top: 8px; padding-bottom: 8px; }
          .py-3 { padding-top: 12px; padding-bottom: 12px; }
          .py-4 { padding-top: 16px; padding-bottom: 16px; }
          .py-5 { padding-top: 20px; padding-bottom: 20px; }
          .p-4 { padding: 16px; }
          .pt-1 { padding-top: 4px; }
          .mt-1 { margin-top: 4px; }
          .max-w-xl { max-width: 576px; }
          .w-full { width: 100%; }
          .min-w-0 { min-width: 0; }
          .flex-1 { flex: 1 1 0%; }
          .flex-shrink-0, .shrink-0 { flex-shrink: 0; }
          .text-xs { font-size: 12px; }
          .text-sm { font-size: 14px; }
          .text-lg { font-size: 18px; }
          .font-medium { font-weight: 500; }
          .font-semibold { font-weight: 600; }
          .uppercase { text-transform: uppercase; }
          .leading-5 { line-height: 20px; }
          .leading-6 { line-height: 24px; }
          .text-gray-100 { color: #f3f4f6; }
          .text-gray-200 { color: #e5e7eb; }
          .text-gray-300 { color: #d1d5db; }
          .text-gray-400 { color: #9ca3af; }
          .text-gray-500 { color: #6b7280; }
          .text-violet-100 { color: #ede9fe; }
          .text-violet-200 { color: #ddd6fe; }
          .text-violet-300\\/70 { color: rgba(196, 181, 253, 0.7); }
          .text-blue-100 { color: #dbeafe; }
          .text-blue-200 { color: #bfdbfe; }
          .text-blue-300 { color: #93c5fd; }
          .text-white { color: white; }
          .text-amber-100 { color: #fef3c7; }
          .border-gray-700 { border-color: #374151; }
          .border-violet-500\\/30 { border-color: rgba(139, 92, 246, 0.3); }
          .border-violet-400\\/60 { border-color: rgba(167, 139, 250, 0.6); }
          .border-blue-500\\/25 { border-color: rgba(59, 130, 246, 0.25); }
          .border-blue-500\\/60 { border-color: rgba(59, 130, 246, 0.6); }
          .border-amber-500\\/30 { border-color: rgba(245, 158, 11, 0.3); }
          .shadow-2xl { box-shadow: 0 25px 50px -12px rgba(0,0,0,.6); }
          button { cursor: pointer; }
          @media (min-width: 640px) { .sm\\:grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
        </style>
      </head>
      <body><main style="min-height: 100vh; padding: 32px;">${html}</main></body>
    </html>
  `);
}

test.describe("첫 공유 경험 mocked 렌더", () => {
  test("sharer 프로젝트 첫 공유 넛지가 렌더된다", async ({ page }) => {
    const html = `
      <div role="status" class="flex items-center gap-3 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2">
        <span aria-hidden="true">🎉</span>
        <p class="min-w-0 flex-1 text-xs text-violet-100">
          Invite teammates when the project is ready. They receive board, completion history, and activity context first.
        </p>
        <button class="flex-shrink-0 rounded border border-violet-400/60 px-2 py-1 text-xs font-medium text-violet-200">Review sharing</button>
        <button aria-label="Dismiss" class="flex-shrink-0 text-violet-300/70">×</button>
      </div>
    `;
    await renderMarkup(page, html);

    const nudge = page.getByRole("status").filter({
      hasText: /Invite teammates when the project is ready/,
    });
    await expect(nudge).toBeVisible();
    await expect(
      page.getByText(/completion history, and activity context/),
    ).toBeVisible();
    await nudge.screenshot({ path: "test-results/first-share-sharer.png" });
  });

  test("sharee 첫 공유 프로젝트 모달이 렌더된다", async ({ page }) => {
    const html = `
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4">
        <div role="dialog" aria-modal="true" aria-labelledby="first-shared-project-title" class="w-full max-w-xl rounded-lg border border-gray-700 bg-gray-800 shadow-2xl">
          <div class="border-b border-gray-700 px-5 py-4">
            <p class="text-xs font-medium uppercase text-blue-300">Shared project</p>
            <h2 id="first-shared-project-title" class="mt-1 text-lg font-semibold text-gray-100">Shared Checkout</h2>
          </div>
          <div class="space-y-4 px-5 py-5">
            <p class="text-sm leading-6 text-gray-300">
              You have access to the shared board, completion history, and activity stream.
              Source code is not copied through Marblo: each teammate keeps code local and syncs changes through git.
            </p>
            <div class="grid gap-2 sm:grid-cols-3">
              <div class="rounded border border-blue-500/25 bg-blue-500/10 px-3 py-2 text-sm text-blue-100">Board</div>
              <div class="rounded border border-blue-500/25 bg-blue-500/10 px-3 py-2 text-sm text-blue-100">Done history</div>
              <div class="rounded border border-blue-500/25 bg-blue-500/10 px-3 py-2 text-sm text-blue-100">Activity</div>
            </div>
            <div class="rounded border border-gray-700 bg-gray-900/70 px-3 py-3">
              <p class="text-sm font-medium text-gray-200">Code stays local</p>
              <p class="mt-1 text-xs leading-5 text-gray-400">
                Connect or clone the repo on this machine before using the Code tab.
                Presence shows who is active, and same-file conflict warnings help avoid overwriting a teammate's work.
              </p>
            </div>
            <div class="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-xs leading-5 text-amber-100">
              Avoid conflicts by pulling before edits, keeping task ownership clear on the board, and pushing changes through the shared git remote.
            </div>
            <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span class="text-xs text-gray-500">Repo remote is available for this project.</span>
              <div class="flex items-center gap-2">
                <button class="rounded border border-blue-500/60 px-3 py-2 text-sm font-medium text-blue-200">Connect repo</button>
                <button class="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white">Got it</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    await renderMarkup(page, html);

    const dialog = page.getByRole("dialog", { name: "Shared Checkout" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Shared project")).toBeVisible();
    await expect(dialog.getByText("Board", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Done history", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Activity", { exact: true })).toBeVisible();
    await expect(
      dialog.getByText(/Source code is not copied through Marblo/),
    ).toBeVisible();
    await expect(dialog.getByText(/same-file conflict warnings/)).toBeVisible();
    await dialog.screenshot({ path: "test-results/first-share-sharee.png" });
  });
});
