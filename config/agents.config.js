// config/agents.config.js
/**
 * TEOS DealMaker: The 7-Agent Royal Court
 * Defines the core agents, their Pharaoh identities, and their system roles.
 */
const RoyalRegistry = {
    ORCHESTRATOR: {
        systemName: "ORCHESTRATOR",
        title: "The Vizier",
        emoji: "📜",
        role: "Coordinates the 7-agent court and routes data."
    },
    STRATEGIST: {
        systemName: "STRATEGIST",
        title: "Imhotep",
        emoji: "📐",
        role: "Maps out the tactical deal playbooks and paths."
    },
    MARKETER: {
        systemName: "MARKETER",
        title: "Hatshepsut",
        emoji: "📣",
        role: "Manages outreach positioning and branding."
    },
    SALES: {
        systemName: "SALES",
        title: "The Scribe",
        emoji: "✒️",
        role: "Drafts objection handling and real-time talk tracks."
    },
    NEGOTIATOR: {
        systemName: "NEGOTIATOR",
        title: "Ramses",
        emoji: "🤝",
        role: "Manages price structuring, discount thresholds, and terms."
    },
    TREASURER: {
        systemName: "TREASURER",
        title: "The Royal Treasurer",
        emoji: "💰",
        role: "Generates contracts, triggers Dodo Payments, and closes the deal."
    },
    GATEKEEPER: {
        systemName: "GATEKEEPER",
        title: "The Royal Sentinel",
        emoji: "🛡️",
        role: "Independently reviews and approves contracts before sending."
    }
};

module.exports = RoyalRegistry;
