import type { DashboardDevice, DashboardLink } from "../vite-env";

type TopologyMapProps = {
  devices: DashboardDevice[];
  links: DashboardLink[];
  onSelect?: (name: string) => void;
};

const ROLE_LAYER: Record<string, number> = {
  siem: 0,
  cloud: 0,
  router: 0,
  core: 0,
  wlc: 1,
  controller: 1,
  distribution: 1,
  firewall: 1,
  vpn: 1,
  perimeter: 1,
  proxy: 1,
  load: 1,
  identity: 1,
  domain: 1,
  access: 2,
  switch: 2,
  ap: 3,
  wireless: 3,
  endpoint: 3,
  laptop: 3,
  edr: 3,
  client: 3,
  unknown: 2,
};

function layerOf(device: DashboardDevice): number {
  const role = String(device.role || "unknown").toLowerCase();
  for (const [key, layer] of Object.entries(ROLE_LAYER)) {
    if (role.includes(key)) return layer;
  }
  return 2;
}

function healthTone(device: DashboardDevice): string {
  if (device.status === "fixture") return "fixture";
  if (device.status === "ok" || device.status === "up") return "ok";
  if (device.status === "warn" || device.status === "warning") return "warn";
  if (device.healthScore != null && device.healthScore >= 8) return "ok";
  if (device.healthScore != null && device.healthScore >= 4) return "warn";
  if (device.status && device.status !== "ok") return "bad";
  return "neutral";
}

export function TopologyMap({ devices, links, onSelect }: TopologyMapProps) {
  if (devices.length === 0) {
    return <p className="ui-empty">No topology — inventory is empty or the source is unreachable.</p>;
  }

  const width = 920;
  const height = 360;
  const padX = 70;
  const padY = 48;
  const layers = new Map<number, DashboardDevice[]>();
  for (const device of devices) {
    const layer = layerOf(device);
    const list = layers.get(layer) || [];
    list.push(device);
    layers.set(layer, list);
  }
  const layerKeys = [...layers.keys()].sort((a, b) => a - b);
  const positions = new Map<string, { x: number; y: number; device: DashboardDevice }>();
  layerKeys.forEach((layer, layerIndex) => {
    const row = layers.get(layer) || [];
    const y = padY + (layerKeys.length === 1 ? height / 2 - padY : (layerIndex * (height - padY * 2)) / Math.max(1, layerKeys.length - 1));
    row.forEach((device, index) => {
      const x = row.length === 1 ? width / 2 : padX + (index * (width - padX * 2)) / Math.max(1, row.length - 1);
      const key = device.name || device.id || `${layer}-${index}`;
      positions.set(key, { x, y, device });
      if (device.id && device.id !== key) positions.set(device.id, { x, y, device });
    });
  });

  function findPos(name?: string) {
    if (!name) return null;
    if (positions.has(name)) return positions.get(name);
    const match = [...positions.values()].find((entry) => entry.device.name === name || entry.device.id === name);
    return match || null;
  }

  return (
    <div className="topo-map">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Network topology">
        {links.map((link, index) => {
          const a = findPos(link.source);
          const b = findPos(link.target);
          if (!a || !b) return null;
          const down = link.status && link.status !== "up";
          return (
            <g key={`${link.source}-${link.target}-${index}`}>
              <line
                className={down ? "topo-link topo-link-down" : "topo-link"}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
              />
            </g>
          );
        })}
        {[...new Map([...positions.values()].map((entry) => [entry.device.name || entry.device.id, entry])).values()].map((entry) => {
          const { x, y, device } = entry;
          const name = device.name || device.id || "device";
          const tone = healthTone(device);
          return (
            <g
              key={name}
              className={`topo-node topo-node-${tone}`}
              transform={`translate(${x}, ${y})`}
              onClick={() => onSelect?.(name)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onSelect?.(name);
              }}
            >
              <rect x={-54} y={-22} width={108} height={44} rx={3} />
              <text className="topo-node-name" y={-2} textAnchor="middle">
                {name}
              </text>
              <text className="topo-node-meta" y={14} textAnchor="middle">
                {[device.role, device.ip].filter(Boolean).join(" · ") || device.status}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
