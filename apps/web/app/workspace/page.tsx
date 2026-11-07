import type { Metadata } from "next";
import { WorkspaceClient } from "./workspace-client";

export const metadata: Metadata = {
  title: "Research workspace",
  description:
    "Read papers side by side and work with an AI copilot that dispatches agents to gather evidence and cites the exact page.",
};

export default function WorkspacePage() {
  return <WorkspaceClient />;
}
