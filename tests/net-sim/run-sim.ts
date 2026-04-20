// ============================================================
// H4KKEN - Headless Network Simulation Runner
// ============================================================
// Entry point: `bun run tests/net-sim/run-sim.ts`
//
// Runs all scenarios across all network profiles, printing a
// summary table of rollback stats. No browser or Babylon.js
// required — pure Bun/TypeScript execution.
//
// Expected output: table showing rollback count, avg depth,
// misprediction %, stall frames per scenario × profile combo.
//
// Scope: this is a local regression harness. It is relevant because
// it stress-tests rollback behavior, prediction quality, and determinism
// under repeatable synthetic latency/jitter/loss before any browser,
// TURN, ICE, or real-network validation. It does not prove WebRTC
// connectivity or infrastructure correctness on its own.
// ============================================================

import { HeadlessClient, type HeadlessStats } from './HeadlessGame';
import { NET_PROFILES, type NetProfile, SimLink } from './NetSimulator';
import { SCENARIOS } from './scenarios';

const TICK_MS = 16.67; // 60fps simulation rate
const TOTAL_FRAMES = 600; // 10 seconds of gameplay per scenario

function runScenario(
  scenarioName: string,
  profile: NetProfile,
): { p1: HeadlessStats; p2: HeadlessStats } {
  const scenario = SCENARIOS[scenarioName];
  if (!scenario) throw new Error(`Unknown scenario: ${scenarioName}`);

  // Create bidirectional SimLinks
  const linkP1toP2 = new SimLink(profile);
  const linkP2toP1 = new SimLink(profile);

  const client0 = new HeadlessClient(0, linkP1toP2);
  const client1 = new HeadlessClient(1, linkP2toP1);

  // Wire delivery: packets from P1's outLink arrive at P2, and vice versa
  linkP1toP2.onDeliver = (data) => client1.receivePacket(data);
  linkP2toP1.onDeliver = (data) => client0.receivePacket(data);

  // Run simulation
  for (let t = 0; t < TOTAL_FRAMES; t++) {
    // Both clients tick with their scripted inputs
    const p1Input = scenario.p1(t);
    const p2Input = scenario.p2(t);

    client0.tick(p1Input);
    client1.tick(p2Input);

    // Advance both network links by one tick duration
    linkP1toP2.tick(TICK_MS);
    linkP2toP1.tick(TICK_MS);
  }

  return { p1: client0.getStats(), p2: client1.getStats() };
}

// ── Main ────────────────────────────────────────────────────

const scenarioNames = Object.keys(SCENARIOS);
const profileNames = Object.keys(NET_PROFILES);

console.log('╔══════════════════════════════════════════════════════════════════════════╗');
console.log('║              H4KKEN — Headless Network Simulation Results               ║');
console.log('╚══════════════════════════════════════════════════════════════════════════╝');
console.log();

for (const sName of scenarioNames) {
  const scenario = SCENARIOS[sName];
  console.log(`▸ ${sName}: ${scenario.description}`);
  console.log('  ┌──────────────────┬────────┬──────────┬──────────┬────────┬──────────┐');
  console.log('  │ Profile          │ Player │ Rollback │ Avg Dep. │ Misprd │ Stalls   │');
  console.log('  ├──────────────────┼────────┼──────────┼──────────┼────────┼──────────┤');

  for (const pName of profileNames) {
    const profile = NET_PROFILES[pName];
    const { p1, p2 } = runScenario(sName, profile);

    for (const stats of [p1, p2]) {
      const d = stats.diag;
      const avgDepth = d.rollbacks > 0 ? (d.rollbackDepthSum / d.rollbacks).toFixed(1) : '0.0';
      const mispredPct =
        d.predictionsTotal > 0
          ? `${Math.round((d.mispredictions / d.predictionsTotal) * 100)}%`
          : '0%';
      const profileLabel = stats.playerIndex === 0 ? profile.name.padEnd(16) : ''.padEnd(16);
      const player = `P${stats.playerIndex + 1}`;

      console.log(
        `  │ ${profileLabel} │ ${player.padEnd(6)} │ ${String(d.rollbacks).padStart(8)} │ ${avgDepth.padStart(8)} │ ${mispredPct.padStart(6)} │ ${String(stats.stallFrames).padStart(8)} │`,
      );
    }
  }

  console.log('  └──────────────────┴────────┴──────────┴──────────┴────────┴──────────┘');
  console.log();
}

console.log('Done. All scenarios completed.');
