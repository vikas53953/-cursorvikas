export type SlashCommand = {
  name: string;
  description: string;
  template: string;
};

export const SQUAD_SLASH_COMMANDS: SlashCommand[] = [
  { name: "help", description: "List what NetJarvis can do in this channel", template: "What can you do in this squad channel? List tools and slash commands briefly." },
  { name: "overview", description: "Network overview and health headlines", template: "Give me the network overview — how is my network doing?" },
  { name: "inventory", description: "List all managed devices", template: "Show me the full network inventory." },
  { name: "alerts", description: "Active alerts and issues", template: "What active alerts and issues do we have right now?" },
  { name: "briefing", description: "On-demand shift briefing", template: "Run a shift briefing for me." },
  { name: "board", description: "Show the agent squad Kanban board", template: "Show me what the team is working on on the squad board." },
  { name: "precheck", description: "Run CLI pre-check on a device — /precheck sw1", template: "Run a CLI pre-check on" },
  { name: "show", description: "Run a show command — /show vlan brief on sw2", template: "Run show command:" },
  { name: "delegate", description: "Hand off to a specialist — /delegate @data check STP", template: "Delegate to specialist:" },
  { name: "vuln", description: "Check CVEs for device software versions", template: "Run a vulnerability check on our switch software versions." },
  { name: "topology", description: "Show network topology", template: "Show me the network topology." },
  { name: "tickets", description: "List open incident tickets", template: "List open incident tickets." },
];

export function filterSlashCommands(query: string): SlashCommand[] {
  const needle = query.toLowerCase();
  return SQUAD_SLASH_COMMANDS.filter(
    (command) =>
      !needle ||
      command.name.startsWith(needle) ||
      command.description.toLowerCase().includes(needle),
  );
}

export function expandSlashCommand(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return text;

  const space = trimmed.indexOf(" ");
  const cmdName = (space === -1 ? trimmed.slice(1) : trimmed.slice(1, space)).toLowerCase();
  const args = space === -1 ? "" : trimmed.slice(space + 1).trim();
  const command = SQUAD_SLASH_COMMANDS.find((item) => item.name === cmdName);
  if (!command) return text;

  if (command.name === "show") {
    return args ? `Run show command: ${args}` : "What show command should I run? Give device and command.";
  }
  if (command.name === "delegate") {
    return args ? `Delegate to specialist: ${args}` : "Who should I delegate to? Use @data, @incident, etc. with the task.";
  }
  if (command.name === "precheck") {
    return args
      ? `Run a CLI pre-check on ${args}`
      : "Run a CLI pre-check on which device? (e.g. sw1)";
  }

  return args ? `${command.template} ${args}` : command.template;
}
