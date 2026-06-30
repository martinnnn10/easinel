# EAS Intelligence: Knowledge Graph Design & AI Architecture

**The Manufacturing Intelligence Platform**

---

## 1. Industrial Knowledge Graph Design

The fundamental flaw in legacy manufacturing software is the folder paradigm. Information is stored in disconnected tables or nested directories. EAS Intelligence replaces this with an Industrial Knowledge Graph—a semantic layer that connects every object in the facility and records how they relate to one another [11]. 

This graph is the connective tissue that allows the AI to reason about the plant as a holistic system rather than a collection of isolated files.

### Graph Ontology & Node Types

The graph is composed of semantic nodes connected by directional edges.

| Node Type | Examples |
| :--- | :--- |
| **Physical Asset** | Conveyor 3, Pump 12, PowerFlex 525 Drive |
| **Location** | Plant A, Packaging Area, Line 2 |
| **Control Logic** | Routine `MainProgram`, Tag `Motor_Speed`, AOI `VFD_Control` |
| **Documentation** | PF525 Manual (Page 42), Electrical Schematic `E-CONV3-014` |
| **Event** | Alarm `F007`, Work Order `WO-100431` |
| **Human Context** | Technician `Mike R.`, Lesson Learned `Belt Mistracking Drag` |

### Edge Relationships (The Connective Tissue)

The power of the graph lies in its edges. Example traversals include:
- `Tag(Motor_Speed)` **IS_WRITTEN_BY** `Routine(Speed_Control)`
- `Routine(Speed_Control)` **CONTROLS** `Asset(Conveyor 3)`
- `Asset(Conveyor 3)` **TRIGGERED** `Alarm(F007)`
- `Alarm(F007)` **IS_DOCUMENTED_IN** `Document(PF525 Manual, Pg 42)`
- `Alarm(F007)` **WAS_RESOLVED_BY** `Work Order(WO-100431)`
- `Work Order(WO-100431)` **WAS_EXECUTED_BY** `Technician(Mike R.)`

### Graph Construction & Ingestion

The graph is built continuously and automatically:
1. **Structured Ingestion:** When an asset is created or a work order is closed, relational database triggers emit events that create nodes and edges in the graph.
2. **Parser-Driven Ingestion:** When a PLC file (e.g., L5X) is uploaded, our deterministic parsers extract the routines and tags, automatically creating `CONTROLS` and `IS_WRITTEN_BY` edges.
3. **AI-Driven Entity Extraction:** When unstructured text (manuals, technician notes) is uploaded, NLP pipelines extract mentioned entities (fault codes, part numbers) and dynamically forge relationships to existing assets.

---

## 2. AI Architecture (The Reasoning Engine)

The AI in EAS Intelligence is not a generic chatbot. It is a deterministic reasoning engine grounded exclusively in the plant's Industrial Knowledge Graph. It is designed to connect information, detect patterns, predict likely causes, and recommend actions.

### Core AI Principles
- **Calibrated Diagnostic Assistant:** The AI is explicitly designed to know when it does not know. It is grounded in customer data and pre-seeded OEM knowledge, clearly indicating its supporting sources or uncertainty. It advises; the human acts.
- **Source Prioritization:** Context is injected into the prompt in a strict hierarchy: Plant-specific Lessons Learned > Asset Failure History > PLC Logic > Pre-seeded OEM Manuals > General Web Knowledge.
- **Explainability:** Every assertion made by the AI must be accompanied by a citation to the specific manual page, PLC routine, or prior work order.

### The Retrieval-Augmented Generation (RAG) Pipeline

When a technician asks, *"Why did Conveyor 3 trip on F007?"*, the architecture executes the following pipeline:

1. **Intent & Entity Extraction:** The query is parsed to identify the target asset (`Conveyor 3`) and the fault code (`F007`).
2. **Graph Traversal:** The system queries the Knowledge Graph to find all nodes connected to `Conveyor 3` and `F007` (e.g., recent work orders, specific manual pages, PLC tags).
3. **Semantic Vector Search:** Simultaneously, the query is embedded and compared against the vector database to find semantically similar chunks in the unstructured documentation (e.g., paragraphs discussing "thermal overload").
4. **Context Assembly:** The results from the Graph Traversal and Vector Search are deduplicated, ranked by the Source Prioritization rules, and assembled into a dense context payload.
5. **LLM Generation:** The context payload and the original query are sent to the LLM (e.g., Claude 3.5 Sonnet) with a strict system prompt instructing it to synthesize a diagnostic path.
6. **Citation Verification:** The generated response is verified to ensure all claims map back to the provided context chunks before being streamed to the user interface.

### Embedding Strategy & Fallback

To ensure the platform remains functional in offline or air-gapped environments, the architecture implements a dual-provider embedding strategy:
- **Primary:** High-dimensional semantic embeddings via OpenAI or Anthropic for deep conceptual matching.
- **Deterministic Fallback:** A robust keyword-based hashing (Bag-of-Words) algorithm that provides L2-normalized vectors. This guarantees that exact fault codes and part numbers are always retrievable, even without an active internet connection or API key.

---

## References

[11] Industrial Knowledge Graphs for AI Agents and Operational Digital Twins. *DataMesh*. https://datamesh.com/resources/guides/industrial-knowledge-graphs-ai-agents-digital-twins
