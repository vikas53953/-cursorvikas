// Incident Operations Agent ticket store.

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs/promises");

const ticketsPath = path.join(process.cwd(), "data", "tickets.json");
let writeQueue = Promise.resolve();

async function readTickets() {
  try {
    const raw = JSON.parse(await fs.readFile(ticketsPath, "utf8"));
    return Array.isArray(raw.tickets) ? raw.tickets : [];
  } catch {
    return [];
  }
}

async function mutateTickets(mutator) {
  const operation = writeQueue.then(async () => {
    const tickets = await readTickets();
    const result = await mutator(tickets);
    await fs.mkdir(path.dirname(ticketsPath), { recursive: true });
    await fs.writeFile(ticketsPath, JSON.stringify({ tickets: tickets.slice(-200) }, null, 2));
    return result;
  });
  writeQueue = operation.catch(() => {});
  return operation;
}

async function listTickets() {
  const tickets = await readTickets();
  return tickets.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function openTicket({ title, severity, device, summary, sourceAlertId }) {
  const ticket = {
    id: `INC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    title: String(title || "Untitled incident").slice(0, 140),
    severity: severity || "medium",
    device: device || null,
    summary: String(summary || ""),
    sourceAlertId: sourceAlertId || null,
    status: "open",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    notes: [],
  };
  await mutateTickets((tickets) => {
    tickets.push(ticket);
  });
  return ticket;
}

async function updateTicket(id, patch) {
  let updated = null;
  await mutateTickets((tickets) => {
    const ticket = tickets.find((item) => item.id === id);
    if (!ticket) return;
    Object.assign(ticket, patch, { updatedAt: new Date().toISOString() });
    updated = ticket;
  });
  return updated;
}

async function addTicketNote(id, text) {
  let updated = null;
  await mutateTickets((tickets) => {
    const ticket = tickets.find((item) => item.id === id);
    if (!ticket) return;
    ticket.notes.push({ ts: new Date().toISOString(), text: String(text) });
    ticket.updatedAt = new Date().toISOString();
    updated = ticket;
  });
  return updated;
}

module.exports = { listTickets, openTicket, updateTicket, addTicketNote };
