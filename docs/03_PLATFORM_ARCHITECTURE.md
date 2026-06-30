# EAS Intelligence: Platform Architecture & Domain Model

**The Manufacturing Intelligence Platform**

---

## 1. Platform Architecture

The EAS Intelligence platform is designed to scale across 10,000 manufacturing facilities, processing millions of assets and billions of maintenance records. The architecture must be multi-tenant, event-driven, API-first, and highly observable.

### Core Architectural Principles
- **Event-Driven:** Every state change (asset created, alarm triggered, work order closed) emits a domain event. This decouples services and allows for asynchronous processing, webhooks, and real-time UI updates.
- **API-First:** The frontend UI consumes the exact same REST/GraphQL APIs available to external integrators. There are no hidden internal endpoints.
- **Modular Monolith to Microservices:** We begin with a well-structured modular monolith to maximize development velocity. Domain boundaries are strictly enforced at the code level (e.g., `src/lib/assets/repository.ts`). As scale demands, these domains can be cleanly extracted into independent microservices.
- **Storage Agnostic Isolation:** Application logic never speaks directly to the database driver. Repository interfaces abstract the storage layer, allowing seamless migration from libSQL/SQLite to PostgreSQL without rewriting business logic.

### High-Level System Components

| Component | Description |
| :--- | :--- |
| **API Gateway & Routing** | Next.js App Router handles HTTP routing, authentication middleware, and RBAC enforcement. |
| **Domain Services** | Isolated modules for Assets, Work Orders, Knowledge (Documents/Embeddings), PLC Parsing, and Workforce. |
| **Reasoning Engine (AI)** | The Copilot orchestration layer. Manages context assembly, RAG (Retrieval-Augmented Generation), and LLM interactions. |
| **Event Bus** | Asynchronous message broker (e.g., Redis Pub/Sub or Kafka) for domain events and background jobs (e.g., document vectorization). |
| **Data Persistence** | Relational data (PostgreSQL), Vector embeddings (pgvector), and Blob storage (S3) for documents and photos. |

---

## 2. Domain Model

The domain model reflects the physical and operational reality of a manufacturing plant. It is designed to capture the relationships necessary to build the Industrial Knowledge Graph.

### Core Entities

#### Asset (The Digital Twin)
The central node of the system. An Asset represents a physical piece of equipment (e.g., a conveyor, pump, or drive).
- **Attributes:** Name, Tag, Manufacturer, Model, Serial Number, Type, Status, Criticality, Installed Date.
- **Location Hierarchy:** Site → Area → Line → Cell.
- **Computed Metrics:** Failure Count, Avg MTTR, Recurring Faults, Days Since Last Fault, Suggested PM Interval.

#### Knowledge Artifacts
The unstructured intelligence of the plant.
- **Document:** PDFs, manuals, and electrical drawings. Sliced into retrievable chunks.
- **Lesson Learned:** Captured tribal knowledge from resolved work orders or senior technicians.
- **PLC Project:** Parsed control logic (e.g., L5X files) broken down into Routines, Tags, and Add-On Instructions (AOIs).

#### Operational Events
The heartbeat of the plant.
- **Work Order:** A record of maintenance activity. Includes Type (Corrective/Preventive), Status, Priority, Estimated Labor, and the Assigned Technician.
- **Alarm Event:** A machine-generated fault or warning. Includes Code, Message, Severity, and Timestamp.
- **Troubleshooting Session:** A recorded conversation between a technician and the AI Copilot regarding a specific asset.

#### Workforce
The human element.
- **Technician:** Represents the plant personnel. Includes Role, Level, Certifications, and a history of resolved work orders (which builds their specific expertise profile).

### Entity Relationships

| Source Entity | Relationship | Target Entity |
| :--- | :--- | :--- |
| **Asset** | *has many* | Documents, Photos, PLC Projects, Work Orders, Alarms, Sessions |
| **Asset** | *is located in* | Site / Area / Line / Cell |
| **Work Order** | *is assigned to* | Technician |
| **Work Order** | *generates* | Lesson Learned |
| **PLC Project** | *contains* | Routines, Tags, AOIs |
| **Document** | *is chunked into* | Vector Embeddings |

This domain model serves as the foundation for the Knowledge Graph. By formalizing these relationships, the system can answer complex queries such as: *"Which technician has the most experience repairing the specific model of drive that just triggered an F007 alarm on Line 2?"*
