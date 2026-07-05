import { Copilot } from "@/components/Copilot";
import { TopBar } from "@/components/TopBar";

// The app's Copilot screen. Lives at /copilot — the root route (/) is the
// public marketing site; the logged-in experience starts at /today.
export default function CopilotPage() {
  return (
    <>
      <TopBar
        title="Copilot"
        subtitle="Ask about a fault, a machine, or a procedure — answers cite your manuals and repair history"
      />
      <div className="flex-1 min-h-0">
        <Copilot />
      </div>
    </>
  );
}
