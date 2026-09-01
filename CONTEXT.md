# Memory Waveform Designer

This context defines the engineering concepts used to author structured memory timing waveforms.

## Language

**Order slot**:
A position in the left-to-right waveform sequence. Transitions in the same order slot occur at the same logical time.
_Avoid_: Pixel column, timestamp

**Synchronous transition group**:
One or more transitions that belong to the same order slot and therefore share one logical time.
_Avoid_: Transition list, simultaneous marker

**Timing endpoint**:
One side of a timing interval, referencing one or more transitions from a single synchronous transition group. A timing endpoint cannot combine transitions from different order slots.
_Avoid_: Arrow handle, single transition endpoint

**Timing parameter**:
A named interval between a start timing endpoint and an end timing endpoint. Its start order slot must precede its end order slot.
_Avoid_: Timing lane, arrow
