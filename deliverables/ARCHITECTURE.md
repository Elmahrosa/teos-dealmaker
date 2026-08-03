# Architecture Diagram

```mermaid
flowchart TD
    %% External Interfaces
    A[Telegram Bot Users] --> B[Telegram Bot Interface]
    C[Admin/Users] --> D[Web Dashboard]
    E[External Systems] --> F[Integration Hub]
    
    %% Bot Layer
    B --> G[Bot Commands & Handlers]
    G --> H[Bot Services: Access, Config, Store]
    
    %% Web Server Layer
    D --> I[Express Server]
    I --> J[API Endpoints: /api/pricing, /api/health, /api/audit]
    
    %% Core Services (Shared)
    H --> K[Core Services]
    I --> K
    
    %% Core Services Details
    K --> L[Identity Service]
    K --> M[Workforce Service]
    K --> N[Memory Service]
    K --> O[Intelligence Service (RAG)]
    K --> P[Provider Management (LLMs)]
    K --> Q[Task Queue Management]
    K --> R[Integration Hub]
    K --> S[Audit Logger]
    
    %% Workforce Service Details
    M --> T[Agent Registry]
    M --> U[Agent Runner & Scheduler]
    M --> V[Telemetry & Health Checks]
    T --> W[Individual Agent Types: Prospector, Qualifier, Outreach, etc.]
    
    %% Data Layer
    L --> X[(User/Workspace DB)]
    M --> X
    N --> X
    O --> X
    P --> X
    Q --> X
    R --> X
    S --> X
    
    %% Storage Backend
    X --> Y[PostgreSQL Database]
    X --> Z[In-Memory Store (for testing)]
    
    %% Knowledge Base
    O --> AA[Knowledge Documents]
    O --> AB[Vector Embeddings (conceptual)]
    
    %% Styling
    classDef external fill:#f9f,stroke:#333,stroke-width:2px;
    classDef service fill:#bbf,stroke:#333,stroke-width:1px;
    classDef data fill:#bfb,stroke:#333,stroke-width:1px;
    classDef storage fill:#ff9,stroke:#333,stroke-width:1px;
    class A,C,E,G,I,K,L,M,N,O,P,Q,R,S,T,U,V,W,X,Y,Z,AA,AB external;
    class L,M,N,O,P,Q,R,S service;
    class X data;
    class Y,Z storage;
```
