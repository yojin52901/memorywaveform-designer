import { useEffect, useMemo, useRef } from 'react';
import { getPngExportPolicy } from '../domain/import-export.js';
import { renderSvg } from '../render/svg-renderer.js';
import { bindCanvasPointerEvents } from '../ui/waveform-interactions.js';
import { orderedSignals } from './editor-utils.js';

export function renderCanvasSvg(documentModel, slotWidthUnits) {
  return renderSvg(documentModel, {
    draft: getPngExportPolicy(documentModel).draft,
    includeSignalLabels: false,
    timelineLeftX: 0,
    minimumWidth: 690,
    slotWidthUnits
  });
}

function dragMessage(state, drag, target = null) {
  if (drag.kind === 'canvas-pan') return 'Panning waveform canvas. Release to stop.';
  if (drag.kind === 'timing-position') {
    const parameter = state.document.semantic.timingParameters.find((item) => item.id === drag.id);
    const position = target ?? state.document.presentation?.timingParameterPositions?.[drag.id] ?? 0.2;
    return `Moving timing parameter · ${parameter?.name ?? drag.id}. Vertical position: ${Math.round(position * 100)}%.`;
  }
  if (drag.kind === 'phase-position') {
    const phase = state.document.semantic.phases.find((item) => item.id === drag.id);
    const position = target ?? state.document.presentation?.phasePositions?.[drag.id] ?? 0.2;
    return `Moving phase · ${phase?.name ?? drag.id}. Vertical position: ${Math.round(position * 100)}%.`;
  }
  const suffix = target === null ? 'Release to place it.' : `Target order slot: #${target}.`;
  if (drag.kind === 'transition') {
    const transition = state.document.semantic.transitions.find((item) => item.id === drag.id);
    const signal = state.document.semantic.signals.find((item) => item.id === transition?.signalId);
    return `Moving transition · ${signal?.name ?? transition?.signalId ?? drag.id}. ${suffix}`;
  }
  if (drag.kind === 'marker') {
    const marker = state.document.semantic.timeline.timeMarkers.find((item) => item.id === drag.id);
    return `Moving marker #${marker?.sequence ?? '?'}. All transitions in this column move together. ${suffix}`;
  }
  if (drag.kind === 'slot-width') return `Resizing timeline slot. Width: ${Math.round(drag.widthUnits * 100)}%. Release to apply.`;
  if (drag.kind === 'relation-endpoint') {
    const relations = drag.relationKind === 'timing' ? state.document.semantic.timingParameters : state.document.semantic.phases;
    const relation = relations.find((item) => item.id === drag.relationId);
    return `Rebinding ${relation?.name ?? drag.relationId} ${drag.endpoint} endpoint. Drop it on a transition.`;
  }
  return 'Selecting a relation endpoint. Drop on a transition.';
}

export function WaveformCanvas({ editor }) {
  const { state, stateRef, applyOperation, setNotice, refresh } = editor;
  const editorRef = useRef(null);
  const canvasRef = useRef(null);
  const scrollLeftRef = useRef(0);
  const markup = useMemo(() => renderCanvasSvg(state.document), [state.document]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const activeEditor = editorRef.current;
    if (!canvas || !activeEditor) return undefined;
    canvas.scrollLeft = scrollLeftRef.current;

    const showDragFeedback = (svg, drag, activeElement) => {
      canvas.classList.add('is-dragging');
      svg.classList.add('is-dragging');
      activeElement?.classList.add('is-dragging');
      document.body?.classList.add('waveform-dragging');
      const status = activeEditor.querySelector('#drag-status');
      if (status) {
        status.hidden = false;
        status.textContent = dragMessage(stateRef.current, drag);
      }
    };

    const clearDragFeedback = (svg) => {
      canvas.classList.remove('is-dragging');
      svg.classList.remove('is-dragging');
      svg.querySelectorAll('.is-dragging').forEach((element) => element.classList.remove('is-dragging'));
      document.body?.classList.remove('waveform-dragging');
      const status = activeEditor.querySelector('#drag-status');
      if (status) status.hidden = true;
    };

    const bind = (svg) => {
      if (!svg) return;
      bindCanvasPointerEvents(svg, {
        root: document,
        editor: activeEditor,
        getState: () => stateRef.current,
        applyOperation,
        setNotice,
        render: refresh,
        previewCanvas(slotWidthUnits, pointerId, drag) {
          scrollLeftRef.current = canvas.scrollLeft;
          canvas.innerHTML = renderCanvasSvg(stateRef.current.document, slotWidthUnits);
          const previewSvg = canvas.querySelector('svg');
          if (!previewSvg) return;
          bind(previewSvg);
          previewSvg.setPointerCapture(pointerId);
          const handle = previewSvg.querySelector(`[data-slot-resize-start-marker-id="${drag.startMarkerId}"]`);
          showDragFeedback(previewSvg, drag, handle);
        },
        showDragFeedback,
        clearDragFeedback,
        dragMessage: (drag, target) => dragMessage(stateRef.current, drag, target)
      });
    };

    bind(canvas.querySelector('svg'));
    return () => {
      document.body?.classList.remove('waveform-dragging');
    };
  }, [applyOperation, markup, refresh, setNotice, state.renderRevision, stateRef]);

  return (
    <div className="waveform-shell" ref={editorRef}>
      <aside className="signal-label-rail" aria-label="Signal labels">
        <div className="signal-label-rail-spacer" />
        {orderedSignals(state.document).map((signal) => (
          <div className="signal-label-rail-row" data-signal-label-id={signal.id} key={signal.id}>
            <strong title={signal.name}>{signal.name}</strong>
            <span>{signal.type}</span>
          </div>
        ))}
      </aside>
      <div
        aria-label="Waveform timeline; drag the background to scroll horizontally"
        className="waveform-canvas"
        id="waveform-canvas"
        key={state.renderRevision ?? 0}
        onScroll={(event) => { scrollLeftRef.current = event.currentTarget.scrollLeft; }}
        ref={canvasRef}
        tabIndex="0"
        dangerouslySetInnerHTML={{ __html: markup }}
      />
    </div>
  );
}
