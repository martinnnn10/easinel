import { Copilot } from "@/components/Copilot";
import { TopBar } from "@/components/TopBar";

export default function HomePage() {
  return (
    <>
      <TopBar
        title="Copilot"
        subtitle="The AI technician every maintenance department wishes they had"
      />
      <div className="flex-1 min-h-0">
        <Copilot />
      </div>
    </>
  );
}
