import { describe, it, expect } from "vitest";
import {
  buildCadenceTasks,
  sequenceTasks,
  lotoTransitionStep,
  taskBankFor,
  type PmTaskDetail,
} from "./procedure";

const isContact = (s: string) => s === "Stopped" || s === "LOTO";
const isObservation = (s: string) => s.startsWith("Running");

describe("PM procedure quality standard", () => {
  it("sequences observations BEFORE the LOTO transition, and LOTO before contact work", () => {
    for (const type of ["motor", "pump", "conveyor", "gearbox", "drive", "compressor", "general"]) {
      const tasks = buildCadenceTasks(type, 365); // annual = richest set
      const lotoIdx = tasks.findIndex((t) => t.isLotoTransition);

      // There must be exactly one LOTO transition step.
      expect(tasks.filter((t) => t.isLotoTransition)).toHaveLength(1);

      // Every running observation must come BEFORE the LOTO transition.
      tasks.forEach((t, i) => {
        if (isObservation(t.operatingState)) {
          expect(i, `${type}: observation "${t.title}" must precede LOTO`).toBeLessThan(lotoIdx);
        }
      });

      // Every contact (Stopped/LOTO) task other than the transition must come AFTER it.
      tasks.forEach((t, i) => {
        if (!t.isLotoTransition && isContact(t.operatingState)) {
          expect(i, `${type}: contact "${t.title}" must follow LOTO`).toBeGreaterThan(lotoIdx);
        }
      });
    }
  });

  it("always sequences the close-out / return-to-service step LAST, after all contact work", () => {
    for (const type of ["motor", "pump", "conveyor", "gearbox", "drive", "compressor", "general"]) {
      const tasks = buildCadenceTasks(type, 365);
      const closeoutIdx = tasks.findIndex((t) => t.isCloseout);
      expect(closeoutIdx, `${type}: must have a close-out step`).toBeGreaterThanOrEqual(0);
      // Close-out is the final element.
      expect(closeoutIdx, `${type}: close-out must be last`).toBe(tasks.length - 1);
      // Every contact task (other than the close-out itself) precedes it.
      tasks.forEach((t, i) => {
        if (!t.isCloseout && isContact(t.operatingState)) {
          expect(i, `${type}: contact "${t.title}" must precede close-out`).toBeLessThan(closeoutIdx);
        }
      });
    }
  });

  it("does NOT put LOTO first when the first task is an observation", () => {
    const tasks = buildCadenceTasks("motor", 365);
    expect(tasks[0].isLotoTransition).toBeFalsy();
    expect(isObservation(tasks[0].operatingState)).toBe(true);
  });

  it("omits the LOTO transition entirely when there is no contact work", () => {
    const observationsOnly: PmTaskDetail[] = [
      { title: "Look", operatingState: "Running" },
      { title: "Listen", operatingState: "Running under load" },
    ];
    const seq = sequenceTasks(observationsOnly);
    expect(seq.find((t) => t.isLotoTransition)).toBeUndefined();
    expect(seq).toHaveLength(2);
  });

  it("inserts exactly one canonical LOTO step and drops any pre-authored one", () => {
    const withStrayLoto: PmTaskDetail[] = [
      { title: "Observe", operatingState: "Running" },
      { ...lotoTransitionStep() }, // a stray duplicate authored too early
      { title: "Open guard and inspect", operatingState: "LOTO" },
    ];
    const seq = sequenceTasks(withStrayLoto);
    expect(seq.filter((t) => t.isLotoTransition)).toHaveLength(1);
    // Observation still first, LOTO second, contact last.
    expect(isObservation(seq[0].operatingState)).toBe(true);
    expect(seq[1].isLotoTransition).toBe(true);
    expect(seq[2].operatingState).toBe("LOTO");
  });

  it("produces rich structured steps (purpose, procedure, measurements, acceptance, out-of-spec)", () => {
    const tasks = buildCadenceTasks("motor", 365);
    // The observation step is fully structured.
    const obs = tasks.find((t) => isObservation(t.operatingState))!;
    expect(obs.purpose).toBeTruthy();
    expect((obs.procedure ?? []).length).toBeGreaterThan(0);
    expect((obs.measurements ?? []).length).toBeGreaterThan(0);
    expect((obs.acceptanceCriteria ?? []).length).toBeGreaterThan(0);
    expect(obs.outOfSpecAction).toBeTruthy();
    // The LOTO step carries safety + standards.
    const loto = tasks.find((t) => t.isLotoTransition)!;
    expect((loto.safety ?? []).length).toBeGreaterThan(0);
    expect((loto.standards ?? []).some((s) => /1910\.147/.test(s))).toBe(true);
  });

  it("scales task richness with cadence (annual >= monthly)", () => {
    const monthly = buildCadenceTasks("conveyor", 30);
    const annual = buildCadenceTasks("conveyor", 365);
    expect(annual.length).toBeGreaterThanOrEqual(monthly.length);
  });

  it("falls back to the general bank for an unknown type", () => {
    expect(taskBankFor("flux-capacitor")).toBe(taskBankFor("general"));
  });
});
