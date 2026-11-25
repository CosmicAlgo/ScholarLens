import type { Metadata } from "next";
import { WorkspaceClient } from "./workspace-client";

export const metadata: Metadata = {
  title: "Research workspace",
  description:
    "Read papers side by side and work with an AI copilot that dispatches agents to gather evidence and cites the exact page.",
};

export default function WorkspacePage() {
  return (
    <>
      {/* Server-rendered so search engines, link previews and no-JS readers see what this page is. */}
      <div className="sr-only">
        <h1>Research workspace</h1>
        <p>
          Open papers from OpenAlex or upload your own PDFs, read them side by side, and ask Copilot, the AI panel in
          this workspace. Every answer cites the exact page it came from. Uploaded PDFs stay in your browser.
        </p>
      </div>
      <WorkspaceClient />
    </>
  );
}
