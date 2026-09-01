---
status: accepted
---

# Use transition ID arrays for timing endpoints

Timing parameter endpoints use canonical `startTransitionIds` and `endTransitionIds` arrays because an endpoint represents a selected subset of one synchronous transition group. Nested endpoint objects would add unused structure, while storing marker IDs beside transition IDs would duplicate the order-slot source of truth; known `1.0` singular fields are therefore migrated to the array-based `1.1` contract.

## Consequences

Validators and mutations must preserve the single-order-slot invariant for every endpoint. Downstream consumers can use every referenced transition directly and derive the shared order slot from those transitions without reading presentation data.
