
# TEOS DEALMAKER

## Enterprise AI Revenue Operating System

### Powered by an Extensible AI Workforce Platform

> **A policy-governed AI workforce platform that orchestrates the complete revenue lifecycle—from prospect identification to deal closure—through policy-governed AI agents, an extensible plugin platform, and enterprise governance.**

## Vision

TEOS DEALMAKER transforms revenue operations by deploying a coordinated fleet of specialized AI agents that function as a unified Revenue Operating System (Revenue OS). Unlike traditional AI assistants or point solutions, TEOS is a **platform**: agents collaborate, share context, execute policy-governed revenue workflows under human oversight at every critical juncture, and are extended through plugins and enterprise governance rather than core code changes.

## Governance Commitment

TEOS DEALMAKER operates as a policy-governed platform. The architecture enforces:

- **Human oversight**: AI agents assist in decision preparation and workflow execution but do not perform irreversible actions without explicit authorization where required by organizational policy.
- **Policy enforcement**: Every capability invocation passes through a deny-wins policy evaluator before execution.
- **Approval workflows**: Mission-critical steps require explicit human approval through the Mission Center.
- **Immutable audit trails**: Every decision, allowance, and denial is recorded in an append-only audit log.
- **Role-based authorization**: Agent actions are scoped to tenant roles and plan entitlements.

Policy-governed AI that operates under enterprise governance, not outside it.

## Platform Architecture

```
Applications (Telegram, Web UI, REST API)
    │
Mission Controller
    │
Workforce Runtime
    │
Plugin Platform
    │
MCP Layer
    │
Providers
    │
Enterprise Platform
    │
Persistence (PostgreSQL)
```

## Core Philosophy

**This is not a chatbot.** It is a sovereign AI workforce platform operating under strict governance frameworks, designed for enterprises that require:

- **Policy-governed execution**: Agents that execute complex multi-stage sales processes under policy control and human oversight
- **Enterprise governance**: Role-based access, entitlements, audit trails, and policy controls
- **Revenue predictability**: Consistent pipeline generation and forecast accuracy
- **Extensibility**: New capabilities ship as plugins, never as core changes
- **Seamless integration**: Native connectivity through a single MCP gateway abstraction
- **Operational transparency**: Full visibility into AI decision-making and performance

## Architecture Overview

TEOS DEALMAKER implements a modular, platform-oriented architecture for AI agent orchestration:

### Core Layers
1. **Mission Controller** - Orchestration layer for missions: planning, approval workflows, lifecycle management, human checkpoints, budget enforcement, and workforce delegation. It never executes work directly.
2. **Workforce Runtime** - Executes missions through the policy-governed workforce: scheduler, dispatcher, executor, reviewer, approvals, confidence, optimizer, recovery, and telemetry.
3. **Plugin Platform** - A transport-agnostic plugin manager. Plugins expose adapters, capabilities, policies, schemas, audits, and permissions. MCP is one transport; the same manager will serve REST, gRPC, and webhook transports.
4. **MCP Layer** - The Model Context Protocol client through which every external enterprise action flows. The platform consumes **TEOS Civic Mixer** as its MCP gateway and never implements enterprise connectors directly.
5. **Providers** - Pluggable AI provider abstraction: 8+ LLM providers with automatic fallback chains.
6. **Enterprise Platform** - Platform governance: tenant resolution, entitlements (license, plan, limits, quotas), and RBAC capability authorization.
7. **Intelligence Layer** - Retrieval-augmented generation (RAG) system for company-specific knowledge grounding.
8. **Integration Hub** - Unified interface to 17+ enterprise systems (CRM, email, calendar, storage).
9. **Persistence Layer** - Multi-tenant PostgreSQL with workspace isolation and audit trails.

### Key Architectural Principles
- **Multi-tenancy**: Complete data isolation via workspace_id scoping
- **Pluggable AI Providers**: 8+ LLM providers with automatic fallback chains
- **Transport-agnostic plugins**: Capabilities are not coupled to any single protocol
- **Governance-first**: Authorization, entitlements, and policy are enforced at the capability execution gate
- **Backward compatibility**: Every new layer is opt-in and inert until enabled
- **Event-driven Communication**: Loose coupling between services via message queues
- **Observability-first**: Built-in metrics, tracing, and structured logging
- **Security by Design**: Defense-in-depth with encryption, authentication, and least-privilege access

### Execution Path

Every capability invocation flows through the policy-governed execution chain:

```
Mission
  → Policy Evaluation
    → Authorization
      → Entitlements
        → Plugin Resolution
          → Workforce Runtime
            → Agent
              → Provider
                → Memory + Audit
```

Governance happens **before** any agent executes.

## Extensible AI Workforce

TEOS ships with **thirteen production agents**. Additional agents can be installed through the Plugin Platform without modifying core runtime.

| Agent | Role | Primary Functions |
|-------|------|-------------------|
| **Prospector** | Lead Discovery | Identifies and scores new company prospects using multiple data sources |
| **Researcher** | Market Intelligence | Analyzes companies, competitors, and market signals for strategic insights |
| **Qualifier** | Lead Assessment | Evaluates leads against BANT/MedPICC frameworks and recommends next steps |
| **Revenue Strategist** | Revenue Strategy | Designs revenue strategy, monetization, and pricing architecture |
| **Strategist** | Deal Planning | Creates tactical playbooks tailored to specific opportunities |
| **Marketer** | Value Proposition | Develops compelling positioning and messaging for each deal |
| **Sales** | Objection Handling | Counters common sales objections with data-driven responses |
| **Negotiator** | Terms Optimization | Structures pricing, discounts, and payment terms for maximum value |
| **Treasurer** | Contract & Payment | Drafts agreements, prepares payment requests, and submits transactions for human approval per enterprise governance policies |
| **Gatekeeper** | Safety & Compliance | Reviews all communications for policy adherence and risk |
| **Orchestrator** | Workflow Coordination | Routes work between agents based on context and priority |
| **Closing** | Deal Finalization | Confirms commitment completeness and manages won/lost outcomes |
| **Intelligence** | Knowledge Assistant | Answers complex questions using company-specific data and documents |

## Mission Controller

Mission Controller is the orchestration layer at the top of the platform stack.

Responsibilities:

- **Mission planning** - Decomposes a goal into a validated, ordered plan
- **Approval workflows** - Human gates before a mission runs or resumes
- **Lifecycle management** - Launch, pause, resume, and complete mission states
- **Human checkpoints** - Review steps embedded in plans
- **Budget enforcement** - Automatic halts when limits are reached
- **Workforce delegation** - Hands execution to the Workforce Runtime

**Mission Controller does not execute work directly.** Execution is delegated to the Workforce Runtime, which schedules and dispatches agents and steps.

## MCP Integration

DealMaker includes an optional Model Context Protocol layer. Capabilities can be executed through:

- **local adapters**
- **remote MCP servers**
- **TEOS Civic Mixer**

...without changing mission or workforce logic. When MCP is disabled, the platform behaves exactly as before. Config: `MCP_ENABLED`, `MCP_ENDPOINT`, `MCP_API_KEY`, `MCP_TIMEOUT`. See [docs/MCP_ARCHITECTURE.md](docs/MCP_ARCHITECTURE.md) for the call pipeline, sequence diagrams, and security model.

## Plugin Platform

The Plugin Platform allows new enterprise capabilities to be added without changing the core runtime. Plugins expose:

- **adapters**
- **capabilities**
- **policies**
- **schemas**
- **audits**
- **permissions**

Current plugins:

- **Civic Mixer** - MCP gateway transport adapter + civic capabilities
- **Sentinel Shield** - Enterprise governance shield

Future plugins:

- **GitHub**
- **Slack**
- **Jira**
- **Salesforce**
- **HubSpot**
- **Microsoft 365**
- **Google Workspace**

See [docs/PLUGIN_CONTRACT.md](docs/PLUGIN_CONTRACT.md) for the plugin contract, manifest schema, lifecycle, permissions, and compatibility rules.

## Key Capabilities

### Policy-Governed Revenue Execution
- Policy-governed execution with human approval at every critical juncture
- Mission checkpoints and budget enforcement with automatic halts
- Role-based access control and enterprise entitlements
- Complete auditability of every AI action and decision
- Self-directed learning from outcomes to improve future performance under governance constraints

### Mission Center
- Learn-first onboarding that orients new operators before missions unlock
- Guided missions (Sell TEOS Dealmaker, Revenue Pipeline, and goal-driven missions) with step-by-step planning and approval gates
- Progress tracking, agent handoffs, and budget-aware execution with automatic halts when limits are reached

### Enterprise Integration Hub
- Pre-built connectors for Salesforce, HubSpot, Microsoft 365, Google Workspace
- Bidirectional synchronization with CRM systems
- Automated data enrichment from external sources
- Webhook ingestion for real-time event processing

### Advanced Intelligence Layer
- Retrieval-Augmented Generation (RAG) with company-specific knowledge
- Multi-source document processing (PDF, DOCX, CSV, web pages)
- Semantic search with intent-aware ranking
- Source-attributed answers to prevent hallucination

### Observability & Governance
- Real-time workforce performance dashboard
- Detailed audit trails for all AI actions and decisions
- Cost tracking and optimization recommendations
- Health monitoring for all system components
- Configurable alerting for anomalies and SLA breaches

### TEOS Sentinel Shield

TEOS Sentinel Shield is delivered as an enterprise governance plugin. It provides:

- AI security scanning
- Prompt inspection
- Code review
- Smart contract analysis
- Policy enforcement
- Audit logging

Mission Controller invokes Sentinel through the Plugin Platform rather than direct integration. Sentinel remains Elmahrosa International's flagship demo offering — its code-audit, smart-contract review, and CI/CD security capabilities are pitched to prospects, with a public landing page served alongside the Dealmaker dashboard.

### Deployment Flexibility
- Multi-tenant architecture for SaaS or private instance deployment
- Docker containerization for consistent environments
- Kubernetes-ready with horizontal scaling capabilities
- API-first design for extensive customization and extension

## Enterprise Platform

Current foundation:

- ✓ Multi-workspace architecture
- ✓ Subscription model
- ✓ Usage tracking
- ✓ RBAC foundation
- ✓ Tenant isolation
- ✓ Capability permissions
- ✓ Entitlements (license, plan, limits, quotas)
- ✓ executeCapability() governance gate (opt-in via `TEOS_ENTERPRISE`)

Roadmap:

- Billing
- Marketplace
- Plugin signing
- OpenTelemetry
- Distributed tracing

## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL 13+ (for production) or in-memory store (for development)
- Telegram Bot Token (for the conversational interface)
- API keys for desired LLM providers (OpenAI, Anthropic, etc.)

### Installation
```bash
# Clone the repository
git clone https://github.com/your-org/teos-dealmaker.git
cd teos-dealmaker

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your Telegram bot token, database URL, and LLM API keys

# Initialize database (requires PostgreSQL)
npm run db:migrate

# Start the bot (Telegram interface)
npm start

# Start the web server (landing page + dashboard)
npm run server
```

### Enterprise Mode
Enable platform governance at the capability execution gate:

```bash
TEOS_ENTERPRISE=true
```

The gate enforces tenant resolution, license/entitlement validity, plan capability scope, and RBAC authorization before any tool or plugin runs. Off by default — runtime behavior is unchanged.

### Production Deployment
For production environments, we recommend:
1. Using Docker containers with Kubernetes orchestration
2. Configuring external secrets management (HashiCorp Vault, AWS Secrets Manager)
3. Setting up monitoring and alerting (Prometheus/Grafana)
4. Implementing regular backup and disaster recovery procedures
5. Establishing CI/CD pipelines for automated testing and deployment

## API Reference

TEOS exposes a small set of public HTTP endpoints (no authentication required — public marketing/ops endpoints):

### Endpoints
- GET /api/pricing - Returns live pricing tiers with Dodo checkout URLs
- GET /api/health - Health check (`{"status":"ok","mode":...}`); used by uptime monitors
- GET /api/audit - Returns a recent subset of audit-log entries from the file-backed audit store
- POST /webhook/dodo - Dodo payment webhook (HMAC-signed, validated with `DODO_WEBHOOK_SECRET`)

Other routes serve the landing page (`/`), static assets (`/robots.txt`, `/sitemap.xml`, `/favicon.svg`, `/og-image.*`), and the ops dashboard (`/dashboard`, `X-Robots-Tag: noindex`).

### Security
- The `/webhook/dodo` endpoint is validated with an HMAC signature (`X-Dodo-Signature`); invalid signatures return `401 invalid_signature`
- Rate limiting via express-rate-limit: 120 requests/min per IP on `/api/`, 30 requests/min on `/webhook/`
- Security headers (HSTS, CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy) are set on all responses

Internal agent, workforce, and mission execution is driven by the Telegram bot and internal modules, not by public REST endpoints.

## Enterprise Readiness

### Security & Compliance
- Role-Based Access Control (RBAC) with fine-grained permissions
- End-to-end encryption for data in transit and at rest
- SOC 2 Type II and ISO 27001 ready architecture
- GDPR/CCPA compliance tooling (data export, deletion, consent management)
- Regular third-party penetration testing and security audits

### Reliability & Performance
- 99.9% uptime SLA with multi-zone deployment options
- Horizontal autoscaling based on workload demand
- Automated failover and disaster recovery capabilities
- Performance benchmarks: <200ms API response times, 1000+ concurrent workflows

### Operations & Support
- Comprehensive observability stack (metrics, logs, traces)
- Automated health checks and self-healing mechanisms
- Detailed runbooks for common operational scenarios
- 24/7 enterprise support with defined SLAs
- Regular security patches and feature updates

## Customization & Extension

### Adding New Agents
1. Create agent implementation in agents/
2. Register in the agent registry with metadata (role, cadence, queue)
3. Define any required data models and database migrations
4. Add unit and integration tests
5. Expose via workforce API and control center UI

### Adding New Plugins
1. Create a leaf package under plugins/ with a manifest.json declaring capabilities, tools, permissions, and entries
2. Implement adapter, policy, schema, and (optionally) audit modules
3. Ship a plugin-local test suite (auto-discovered by the aggregate runner)
4. Configure entirely through environment variables — never hardcode URLs or credentials
5. Load through the Plugin Platform; MCP consumes it as one transport

### Integrating New Systems
1. Implement adapter following the integration interface contract
2. Add configuration schema for credentials and settings
3. Register connector in the Integration Hub catalog
4. Implement sync logic for bi-directional data flow
5. Add monitoring and error handling specific to the system

## Major Milestones

**v1.0.0 — Public Launch**
- TEOS DEALMAKER rebrand: Enterprise AI Revenue Operating System
- Env-driven Dodo production catalog (Solo, Growth, Business, Enterprise + add-ons)
- Production landing page + Sentinel governance console (SEO, robots, sitemap, analytics hooks)
- Plugin engine contract frozen at `^1.0.0`

**v0.8.1 — Recovery Release**
- Repository restored
- Runtime stabilized
- Enterprise documentation

**v0.9 — Architecture Foundation**
- Modular Workforce
- Mission Controller
- MCP Layer
- Plugin Platform
- Sentinel Plugin
- Civic Mixer Plugin
- Enterprise Platform (tenants, entitlements, RBAC authorization)

**Current Status**
v1.0.0 Public Launch — production catalog configured, release tagged

## License

Proprietary. © 2026 Elmahrosa International. All rights reserved.

See [LICENSE](LICENSE) for full details.

## Enterprise Support

For production deployments, service level agreements, and custom implementation services, please contact:
**Enterprise Sales**: enterprise@elmahrosa.org
**Technical Support**: support@elmahrosa.org
**Security Reporting**: security@elmahrosa.org

---

*TEOS DEALMAKER is continuously evolving. For the latest features, roadmap, and release notes, visit our [documentation portal](https://docs.elmahrosa.org/teos-dealmaker).
