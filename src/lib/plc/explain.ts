import { getLiveChatProvider } from "@/lib/ai/providers";
import type { NodeDetail } from "./nodes";

// ─────────────────────────────────────────────────────────────────────────
// Plain-English AI explanations for PLC nodes.
//
// Live mode → Anthropic. Demo mode → a deterministic, domain-plausible
// explanation generated from the structured node detail, so the feature is
// fully demoable with zero configuration (mirrors the Copilot's demo engine).
// ─────────────────────────────────────────────────────────────────────────

const SYS = `You are a senior controls engineer explaining a Rockwell (Studio 5000) PLC program element to a maintenance technician who does NOT own Studio 5000. Be concrete and practical. Explain what the element does, how it fits the machine's operation, and what a technician should watch for when troubleshooting. Use short paragraphs and bullet lists. Never invent tag names or logic that isn't in the provided context.`;

export async function explainNode(detail: NodeDetail, userQuestion?: string): Promise<{ text: string; live: boolean }> {
  const provider = getLiveChatProvider();
  const prompt =
    `${nodeKindLabel(detail.type)} context:\n${detail.aiContext}\n\n` +
    (userQuestion ? `The technician asks: "${userQuestion}"\n\n` : "") +
    `Explain this in plain English for a maintenance technician.`;

  if (provider) {
    try {
      let text = "";
      const gen = provider.stream({
        system: SYS,
        maxTokens: 900,
        messages: [{ role: "user", content: prompt }],
      });
      for await (const delta of gen) text += delta;
      if (text.trim()) return { text, live: true };
    } catch (err) {
      console.error("[plc-explain] live failed, falling back to demo:", (err as Error).message);
    }
  }
  return { text: demoExplain(detail, userQuestion), live: false };
}

function nodeKindLabel(t: NodeDetail["type"]): string {
  switch (t) {
    case "routine":
      return "PLC routine";
    case "tag":
      return "PLC tag";
    case "aoi":
      return "Add-On Instruction (AOI)";
    case "udt":
      return "User-Defined Type (UDT)";
    case "program":
      return "PLC program";
    default:
      return "PLC element";
  }
}

// Deterministic demo explanation built from the structured detail.
function demoExplain(detail: NodeDetail, userQuestion?: string): string {
  const d = detail.data as Record<string, unknown>;
  const head = userQuestion
    ? `**Question:** ${userQuestion}\n\n`
    : "";

  switch (detail.type) {
    case "routine": {
      const type = String(d.routineType ?? "RLL");
      const refs = (d.referencedTags as string[]) ?? [];
      const calls = (d.calledRoutines as string[]) ?? [];
      const rungs = (d.rungs as { number: number; text: string; comment?: string }[] | null) ?? null;
      const lines: string[] = [];
      lines.push(`${head}**What this routine does**`);
      lines.push(
        `\`${detail.title}\` is a ${type === "ST" ? "Structured Text" : "ladder (RLL)"} routine in the **${String(
          d.program
        )}** program${detail.subtitle ? ` (${detail.subtitle})` : ""}.` +
          (d.description && d.description !== "—" ? ` Its documented purpose: *${String(d.description)}*.` : "")
      );
      if (rungs && rungs.length) {
        const first = rungs.slice(0, 3).map((r) => `- Rung ${r.number}: \`${r.text}\`${r.comment ? ` — ${r.comment}` : ""}`);
        lines.push(`\n**How the logic reads (first rungs)**\n${first.join("\n")}`);
        lines.push(
          `\nIn plain terms, the routine examines its input conditions (the \`XIC\`/\`XIO\` examine instructions on the left of each rung) and energizes outputs (\`OTE\`/\`OTL\`/timers) on the right when those conditions are met.`
        );
      }
      if (refs.length) lines.push(`\n**Tags it touches:** ${refs.slice(0, 16).map((t) => `\`${t}\``).join(", ")}${refs.length > 16 ? " …" : ""}.`);
      if (calls.length) lines.push(`**Routines it calls:** ${calls.map((c) => `\`${c}\``).join(", ")}.`);
      lines.push(
        `\n**What to watch when troubleshooting:** if this routine isn't producing the expected output, verify the input tags above are in the state you expect (use the Copilot or a HMI watch), confirm any called routines are actually being scanned, and check for a higher-priority routine or interlock overriding the outputs.`
      );
      return lines.join("\n");
    }

    case "tag": {
      const usage = (d.usage as { routine: string; locations: number[] }[]) ?? [];
      const lines: string[] = [];
      lines.push(`${head}**What this tag is**`);
      lines.push(
        `\`${detail.title}\` is a **${String(d.dataType)}** tag with **${String(d.scope)}** scope${
          d.program && d.program !== "—" ? ` (program ${String(d.program)})` : ""
        }.` + (d.alias ? ` It is an **alias** for \`${String(d.alias)}\`, so it points at that underlying tag.` : "")
      );
      if (d.description && d.description !== "—") lines.push(`Documented description: *${String(d.description)}*.`);
      lines.push(
        `\n**Likely purpose:** ${inferTagPurpose(detail.title, String(d.dataType))}`
      );
      if (usage.length) {
        lines.push(
          `\n**Where it's used:** referenced in ${usage
            .map((u) => `\`${u.routine}\` (${u.locations.length}x)`)
            .join(", ")}. Start there if you need to see what drives or reads this value.`
        );
      } else {
        lines.push(`\n**Where it's used:** no routine references were found in this export — it may be written by an HMI, a message instruction, or a routine that wasn't included in the upload.`);
      }
      return lines.join("\n");
    }

    case "aoi": {
      const params = (d.parameters as { name: string; usage: string; dataType: string }[]) ?? [];
      const ins = params.filter((p) => p.usage === "Input");
      const outs = params.filter((p) => p.usage === "Output");
      const lines: string[] = [];
      lines.push(`${head}**What this Add-On Instruction does**`);
      lines.push(
        `\`${detail.title}\` is a reusable instruction block${
          d.description && d.description !== "—" ? `: *${String(d.description)}*` : ""
        }. Engineers drop it onto a rung the way you'd use a built-in instruction, wiring its parameters to real tags.`
      );
      if (ins.length) lines.push(`\n**Inputs (you feed in):** ${ins.map((p) => `\`${p.name}\` (${p.dataType})`).join(", ")}.`);
      if (outs.length) lines.push(`**Outputs (it produces):** ${outs.map((p) => `\`${p.name}\` (${p.dataType})`).join(", ")}.`);
      const usage = (d.usage as { routine: string }[]) ?? [];
      if (usage.length) lines.push(`\n**Used in:** ${usage.map((u) => `\`${u.routine}\``).join(", ")}.`);
      lines.push(`\n**Troubleshooting tip:** because the same logic runs everywhere this AOI is used, a bug or mis-wired parameter shows up on every instance. Check the specific instance's input tags first before suspecting the AOI's internal logic.`);
      return lines.join("\n");
    }

    case "udt": {
      const members = (d.members as { name: string; dataType: string }[]) ?? [];
      const usedBy = (d.usedBy as string[]) ?? [];
      const lines: string[] = [];
      lines.push(`${head}**What this data type is**`);
      lines.push(
        `\`${detail.title}\` is a User-Defined Type — a custom data structure that groups related values into one tag${
          d.description && d.description !== "—" ? `: *${String(d.description)}*` : ""
        }.`
      );
      if (members.length) lines.push(`\n**Members:** ${members.map((m) => `\`${m.name}\` (${m.dataType})`).join(", ")}.`);
      if (usedBy.length) lines.push(`\n**Used by:** ${usedBy.slice(0, 12).join("; ")}${usedBy.length > 12 ? " …" : ""}.`);
      lines.push(`\n**Why it matters:** when you see a tag of this type, you can expect all of the members above to exist on it. That's how one conveyor/pump/valve can carry its whole state (commands, status, faults) in a single structured tag.`);
      return lines.join("\n");
    }

    case "program": {
      const routines = (d.routines as { name: string; type: string; rungs: number }[]) ?? [];
      return (
        `${head}**Program overview**\n\`${detail.title}\` groups the routines that control one functional area of the machine.` +
        (d.mainRoutine && d.mainRoutine !== "—" ? ` Execution starts in **${String(d.mainRoutine)}**, which typically calls the others via JSR.` : "") +
        (routines.length ? `\n\n**Routines:** ${routines.map((r) => `\`${r.name}\` (${r.type}, ${r.rungs} rungs)`).join(", ")}.` : "") +
        `\n\n**Where to start:** open the main routine to see the top-level sequence, then drill into the called routines for the detail.`
      );
    }

    default:
      return `${head}${detail.aiContext || "No additional explanation is available for this element."}`;
  }
}

function inferTagPurpose(name: string, dataType: string): string {
  const n = name.toLowerCase();
  if (dataType === "BOOL") {
    if (/run|start|on|enable/.test(n)) return "a boolean command/status bit — likely a run/enable or running indication.";
    if (/stop|estop|e_stop|fault|trip|alarm/.test(n)) return "a boolean fault/stop bit — when set it usually inhibits operation or signals a fault.";
    if (/jog|reset|ack/.test(n)) return "a momentary operator action bit (jog / reset / acknowledge).";
    return "a boolean status or command bit.";
  }
  if (/(TIMER|TON|TOF)/i.test(dataType)) return "a timer used to delay or time an action (check its .PRE preset and .DN done bit).";
  if (/(COUNTER|CTU|CTD)/i.test(dataType)) return "a counter tracking events/parts (check its .PRE and .ACC).";
  if (/(DINT|INT|REAL)/i.test(dataType)) {
    if (/speed|freq|rpm|hz/.test(n)) return "a numeric speed/frequency setpoint or feedback value.";
    if (/temp|press|level|flow|count|qty/.test(n)) return "a numeric process value (setpoint or measured reading).";
    return "a numeric value (setpoint, feedback, or count).";
  }
  return "a structured value carrying this element's state.";
}
