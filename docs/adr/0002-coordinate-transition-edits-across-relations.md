---
status: accepted
---

# Coordinate transition edits across relations

Editing an existing transition preserves its identity and coordinates every transition connected through timing endpoint selections, rather than forcing the user to detach relations first. The group is transitive: if selected endpoint members occur in another endpoint together, every connected member moves as one group; unrelated transitions in the original marker remain in place. When a coordinated move crosses the opposite endpoint of a timing parameter or phase, the relation exchanges start and end so it remains ordered; an exact same-slot interval or a move that cannot fit every affected signal remains invalid. Transition, timing parameter, phase, annotation, and presentation IDs remain stable, so renderers recompute the complete visual relationship from the single semantic document. This favors direct waveform editing and referential integrity over preserving the original start/end label at the cost of blocking the edit.
