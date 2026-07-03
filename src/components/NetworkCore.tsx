import type { CSSProperties } from "react";
import type { JarvisMood, MouthShape } from "../lib/realtime";

type NetworkCoreProps = {
  mood: JarvisMood;
  mouthShape: MouthShape;
};

// Satellite node positions around the core (a small topology, like a NOC map).
const NODES = [0, 60, 120, 180, 240, 300].map((deg) => {
  const rad = (deg * Math.PI) / 180;
  return {
    deg,
    x: 200 + Math.sin(rad) * 118,
    y: 200 - Math.cos(rad) * 118,
  };
});

// Perimeter links between adjacent satellites (partial ring for a mesh look).
const RING_LINKS = [
  [0, 1],
  [1, 2],
  [3, 4],
  [4, 5],
];

const WAVE_FACTORS = [0.25, 0.45, 0.65, 0.85, 1, 0.9, 0.7, 0.9, 1, 0.85, 0.65, 0.45, 0.25];

// NetJarvis's avatar: a network core. The outer ring is the status indicator
// (color + animation per mood), the inner graph is a live-looking topology
// with packets in flight while tools run, and the bars are a voice waveform
// driven by the realtime audio meter.
export function NetworkCore({ mood, mouthShape }: NetworkCoreProps) {
  const energy = Math.min(1, mouthShape.open * 1.25 + mouthShape.teeth * 0.3 + mouthShape.width * 0.15);

  return (
    <div
      className={`netcore netcore-${mood}`}
      style={{ "--voice-energy": (mood === "speaking" ? energy : 0).toFixed(3) } as CSSProperties}
      aria-label={`NetJarvis state: ${mood}`}
    >
      <svg className="netcore-svg" viewBox="0 0 400 400" role="img">
        {/* Status ring */}
        <circle className="nc-ring" cx="200" cy="200" r="190" />
        <circle className="nc-ring-dash" cx="200" cy="200" r="178" />

        {/* Listening pulses */}
        {mood === "listening" ? (
          <>
            <circle className="nc-pulse nc-pulse-1" cx="200" cy="200" r="60" />
            <circle className="nc-pulse nc-pulse-2" cx="200" cy="200" r="60" />
          </>
        ) : null}

        {/* Spokes: core to satellites */}
        {NODES.map((node) => (
          <line key={`spoke-${node.deg}`} className="nc-link" x1="200" y1="200" x2={node.x} y2={node.y} />
        ))}

        {/* Partial mesh between satellites */}
        {RING_LINKS.map(([a, b]) => (
          <line key={`ring-${a}-${b}`} className="nc-link nc-link-dim" x1={NODES[a].x} y1={NODES[a].y} x2={NODES[b].x} y2={NODES[b].y} />
        ))}

        {/* Packets in flight while a tool is running */}
        {mood === "working"
          ? NODES.map((node, index) => (
              <circle key={`packet-${node.deg}`} className="nc-packet" r="4.5">
                <animateMotion
                  dur="1.1s"
                  repeatCount="indefinite"
                  begin={`${index * 0.18}s`}
                  path={`M200,200 L${node.x},${node.y}`}
                />
              </circle>
            ))
          : null}

        {/* Satellite nodes */}
        {NODES.map((node, index) => (
          <g key={`node-${node.deg}`} className="nc-node" style={{ "--node-delay": `${index * 0.35}s` } as CSSProperties}>
            <circle className="nc-node-glow" cx={node.x} cy={node.y} r="16" />
            <circle className="nc-node-dot" cx={node.x} cy={node.y} r="9" />
          </g>
        ))}

        {/* Core */}
        <circle className="nc-core-glow" cx="200" cy="200" r="52" />
        <circle className="nc-core" cx="200" cy="200" r="36" />
        <circle className="nc-core-inner" cx="200" cy="200" r="16" />
      </svg>

      {/* Voice waveform (amplitude follows the realtime audio meter) */}
      <div className="netcore-wave" aria-hidden="true">
        {WAVE_FACTORS.map((factor, index) => (
          <span key={index} style={{ "--f": factor } as CSSProperties} />
        ))}
      </div>
    </div>
  );
}
