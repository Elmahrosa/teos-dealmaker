# Suggested GitHub Issues for TEOS DealMaker

This file lists potential issues that could be added to the repository's issue tracker to improve the project.

## Bugs

### Missing Agents Directory
**Description**: The bot/commands.js file references agent modules (e.g., ../agents/outreach) that do not exist in the repository. This likely causes runtime errors when those commands are invoked.
**Steps to Reproduce**:
1. Run the bot (
pm start).
2. Execute a command like /outreach test.
3. Observe the error: Cannot find module '../agents/outreach'.
**Expected Behavior**: The command should execute successfully.
**Actual Behavior**: Module not found error.
**Suggested Fix**: Either implement the missing agent modules or update the references to point to the correct location (e.g., services/workforce).
**Labels**: bug, high-priority

### Dependency Vulnerabilities
**Description**: 
pm audit reports 9 vulnerabilities, including deprecated dependencies in 
ode-telegram-bot-api.
**Steps to Reproduce**: Run 
pm audit.
**Expected Behavior**: No known vulnerabilities.
**Actual Behavior**: Vulnerabilities found.
**Suggested Fix**: Update dependencies to secure versions. If updates are not available, consider patching or replacing the affected packages.
**Labels**: bug, security, medium-priority

## Feature Requests

### Add Authentication to HTTP API
**Description**: The HTTP API endpoints (/api/pricing, /api/health, /api/audit) are currently unauthenticated. In a production environment, this could expose sensitive data.
**Desired Behavior**: Require authentication (e.g., API key, JWT) for accessing these endpoints.
**Acceptance Criteria**:
- Unauthorized requests return 401.
- Authorized requests succeed with valid credentials.
- Authentication method is configurable (e.g., via environment variable).
**Labels**: enhancement, security, high-priority

### Implement Structured Logging
**Description**: Current logging uses a mix of console.log and a custom file logger. This makes log aggregation and analysis difficult in production.
**Desired Behavior**: Replace with a structured logging library (e.g., pino, winston) that outputs JSON logs and supports configurable log levels.
**Acceptance Criteria**:
- Logs are output in JSON format.
- Log levels (info, warn, error) are respected.
- Logs can be directed to stdout/stderr, files, or external services.
**Labels**: enhancement, medium-priority

### Add Prometheus Metrics Endpoint
**Description**: To improve observability, expose key metrics (agent latency, success rates, token usage, etc.) in a format consumable by Prometheus.
**Desired Behavior**: A /metrics endpoint that returns Prometheus-formatted metrics.
**Acceptance Criteria**:
- Endpoint /metrics returns plain text with metric definitions and values.
- Metrics include: gent_runs_total, gent_run_duration_seconds, gent_run_success_total, llm_token_usage_total, http_request_duration_seconds, etc.
- Metrics are updated in real-time.
**Labels**: enhancement, monitoring, medium-priority

### Containerize the Application
**Description**: Lack of Dockerfile makes consistent deployment across environments challenging.
**Desired Behavior**: Provide a Dockerfile that builds a runnable image of the application.
**Acceptance Criteria**:
- Dockerfile exists in the repository root.
- docker build -t teos-dealmaker . succeeds.
- docker run starts both the bot and server (or they can be run separately via environment variables).
- The image uses a non-root user for security.
**Labels**: enhancement, devops, high-priority

### Establish CI/CD Pipeline
**Description**: No automated testing or deployment pipeline is present.
**Desired Behavior**: GitHub Actions workflow that runs on pull requests and pushes to main.
**Acceptance Criteria**:
- Workflow runs 
pm install, 
pm test, and 
pm run lint (if linting exists).
- On push to main, optionally deploys to a staging environment.
- Workflow fails on test failures or linting errors.
**Labels**: enhancement, devops, high-priority

### Add OpenAPI Specification
**Description**: No formal documentation exists for the HTTP API, making integration difficult for clients.
**Desired Behavior**: Provide an OpenAPI (Swagger) YAML or JSON file describing the API endpoints.
**Acceptance Criteria**:
- File openapi.yaml or openapi.json in the repository root.
- Describes all endpoints (/api/pricing, /api/health, /api/audit, etc.).
- Includes request/response schemas, authentication requirements, and error codes.
**Labels**: enhancement, documentation, medium-priority

### Implement Rate Limiting
**Description**: The HTTP API lacks rate limiting, making it susceptible to abuse or accidental overload.
**Desired Behavior**: Limit the number of requests per IP or API key within a time window.
**Acceptance Criteria**:
- Use a rate-limiting middleware (e.g., express-rate-limit).
- Configurable limits (e.g., 100 requests per 15 minutes).
- Returns 429 status code when limit is exceeded.
- Optionally, exclude health check endpoint from limiting.
**Labels**: enhancement, security, medium-priority

### Improve Error Handling
**Description**: Error handling is inconsistent; some errors are logged and swallowed, others crash the process.
**Desired Behavior**: Implement centralized error handling for both the bot and server.
**Acceptance Criteria**:
- Unhandlers) a central logger with not cause process. the bot sends a friendly error message.
- Unhandled promise rejections are logged and do not crash the process (unless critical).
- Error responses do not leak stack traces or internal details.
**Labels**: enhancement, medium-priority

## Tasks

### Write Database Migration Documentation
**Description**: The db:migrate script exists, but its usage and assumptions are not well documented.
**Desired Behavior**: Add a section to the README or create a MIGRATIONS.md file explaining how to run migrations, what they do, and how to handle schema changes.
**Acceptance Criteria**:
- Document explains the purpose of db:migrate.
- Notes that it is safe to run multiple times (due to IF NOT EXISTS clauses).
- Mentions the requirement of DATABASE_URL environment variable.
**Labels**: documentation, task

### Create Development Contributing Guidelines
**Description**: No CONTRIBUTING.md or similar guide exists for developers wishing to contribute.
**Desired Behavior**: Add a CONTRIBUTING.md file that outlines:
- How to set up the development environment.
- How to run tests.
- Coding style guidelines (if any).
- Pull request process.
**Acceptance Criteria**:
- File exists and is clear and helpful.
**Labels**: documentation, task

### Add License Header to Source Files
**Description**: While a LICENSE file is present, individual source files lack copyright headers.
**Desired Behavior**: Add a standard header to each source file (e.g., // Copyright (c) 2026 Elmahrosa International. Licensed under the MIT License.).
**Acceptance Criteria**:
- All .js files in the repository contain the appropriate license header.
**Labels**: task, low-priority

## Conclusion
Addressing these issues will significantly improve the project's quality, security, maintainability, and readiness for enterprise adoption.
