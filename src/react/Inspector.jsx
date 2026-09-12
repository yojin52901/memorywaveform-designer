import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Empty,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Tag,
  Typography
} from 'antd';
import { DeleteOutlined, DownOutlined, SaveOutlined, UpOutlined } from '@ant-design/icons';
import { STATES, SIGNAL_TYPES } from '../domain/constants.js';
import {
  deleteSignal,
  deleteTransitionWithDependencies,
  getTransitionDependencies,
  moveSignalRow,
  updateAnnotation,
  updatePhase,
  updateSignal,
  updateTimingParameter,
  updateTransition
} from '../domain/operations.js';
import { repairObjects, splitTags, updateDocumentMetadata } from './editor-state.js';
import { anchorOptions, endpointChoices, markerSequence, orderedSignals, splitAnchor, transitionOptions } from './editor-utils.js';

const stateOptions = STATES.map((value) => ({ value, label: value }));
const signalTypeOptions = SIGNAL_TYPES.map((value) => ({ value, label: value }));

function MetadataForm({ documentModel, applyOperation }) {
  const metadata = documentModel.metadata;
  return (
    <Form key={JSON.stringify(metadata)} initialValues={{ ...metadata, tags: metadata.tags.join(', ') }} layout="vertical" onFinish={(values) => applyOperation((document) => updateDocumentMetadata(document, values))}>
      <Form.Item label="Title" name="title" rules={[{ required: true, message: 'A document title is required.' }]}><Input /></Form.Item>
      <Form.Item label="Operation" name="operation"><Input /></Form.Item>
      <Form.Item label="Description" name="description"><Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} /></Form.Item>
      <Form.Item label="Memory technology" name="memoryTechnology"><Input /></Form.Item>
      <Form.Item label="Tags" name="tags"><Input placeholder="example, power-sequence" /></Form.Item>
      <Button htmlType="submit" icon={<SaveOutlined />}>Save metadata</Button>
    </Form>
  );
}

function SignalForm({ documentModel, signal, index, count, editor }) {
  const { applyOperation, setSelectedTransition } = editor;
  const removeSignal = () => {
    setSelectedTransition(null);
    applyOperation((document) => deleteSignal(document, signal.id));
  };
  const move = (direction) => {
    const currentIndex = documentModel.presentation.signalRowOrder.indexOf(signal.id);
    applyOperation((document) => moveSignalRow(document, { signalId: signal.id, targetIndex: currentIndex + direction }));
  };
  return (
    <Form key={`${signal.id}-${signal.name}-${signal.initialState}`} initialValues={{ ...signal, tags: signal.tags.join(', ') }} layout="vertical" onFinish={(values) => applyOperation((document) => updateSignal(document, signal.id, {
      ...values, tags: splitTags(values.tags)
    }))}>
      <Form.Item label="Name" name="name" rules={[{ required: true, message: 'A signal name is required.' }]}><Input /></Form.Item>
      <Form.Item label="Type" name="type"><Select options={signalTypeOptions} /></Form.Item>
      <Form.Item label="Initial state" name="initialState"><Select options={stateOptions} /></Form.Item>
      <Form.Item label="Subtype" name="subtype"><Input /></Form.Item>
      <Form.Item label="Tags" name="tags"><Input /></Form.Item>
      <Space wrap>
        <Button htmlType="submit" icon={<SaveOutlined />}>Save</Button>
        <Button aria-label="Move signal up" disabled={index === 0} icon={<UpOutlined />} onClick={() => move(-1)} />
        <Button aria-label="Move signal down" disabled={index === count - 1} icon={<DownOutlined />} onClick={() => move(1)} />
        <Popconfirm
          cancelText="Cancel"
          okButtonProps={{ danger: true }}
          okText="Delete"
          onConfirm={removeSignal}
          title="Delete this signal, its waveform segments, transitions, and dependent timing objects?"
        >
          <Button danger icon={<DeleteOutlined />}>Delete</Button>
        </Popconfirm>
      </Space>
    </Form>
  );
}

function TimingForm({ documentModel, parameter, applyOperation }) {
  const startOptions = endpointChoices(documentModel, parameter, 'start');
  const endOptions = endpointChoices(documentModel, parameter, 'end');
  return (
    <Form
      key={`${parameter.id}-${parameter.name}-${parameter.startTransitionIds.join(',')}-${parameter.endTransitionIds.join(',')}`}
      initialValues={{ ...parameter, tags: (parameter.tags ?? []).join(', ') }}
      layout="vertical"
      onFinish={(values) => applyOperation((document) => updateTimingParameter(document, parameter.id, {
        name: values.name,
        startTransitionIds: values.startTransitionIds,
        endTransitionIds: values.endTransitionIds,
        requirementText: values.requirementText,
        tags: splitTags(values.tags)
      }))}
    >
      <Form.Item label="Name" name="name" rules={[{ required: true, message: 'A timing name is required.' }]}><Input /></Form.Item>
      <Form.Item label={`Start endpoint · order slot #${markerSequence(documentModel, parameter.startTransitionIds[0]) ?? '?'}`} name="startTransitionIds" rules={[{ required: true, type: 'array', min: 1, message: 'Select at least one start transition.' }]}>
        <Checkbox.Group options={startOptions} />
      </Form.Item>
      <Form.Item label={`End endpoint · order slot #${markerSequence(documentModel, parameter.endTransitionIds[0]) ?? '?'}`} name="endTransitionIds" rules={[{ required: true, type: 'array', min: 1, message: 'Select at least one end transition.' }]}>
        <Checkbox.Group options={endOptions} />
      </Form.Item>
      <Form.Item label="Requirement note (optional)" name="requirementText"><Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} /></Form.Item>
      <Form.Item label="Tags" name="tags"><Input /></Form.Item>
      <Button htmlType="submit" icon={<SaveOutlined />}>Save timing parameter</Button>
    </Form>
  );
}

function PhaseForm({ documentModel, phase, applyOperation }) {
  const transitions = transitionOptions(documentModel);
  return (
    <Form key={`${phase.id}-${phase.name}-${phase.startTransitionId}-${phase.endTransitionId}`} initialValues={{ ...phase, tags: (phase.tags ?? []).join(', ') }} layout="vertical" onFinish={(values) => applyOperation((document) => updatePhase(document, phase.id, {
      ...values, tags: splitTags(values.tags)
    }))}>
      <Form.Item label="Name" name="name" rules={[{ required: true, message: 'A phase name is required.' }]}><Input /></Form.Item>
      <Form.Item label="Start transition" name="startTransitionId" rules={[{ required: true }]}><Select options={transitions} /></Form.Item>
      <Form.Item label="End transition" name="endTransitionId" rules={[{ required: true }]}><Select options={transitions} /></Form.Item>
      <Form.Item label="Tags" name="tags"><Input /></Form.Item>
      <Button htmlType="submit" icon={<SaveOutlined />}>Save phase</Button>
    </Form>
  );
}

function AnnotationForm({ documentModel, annotation, applyOperation }) {
  const anchor = annotation.anchorType === 'document' ? 'document:' : `${annotation.anchorType}:${annotation.anchorId}`;
  return (
    <Form key={`${annotation.id}-${annotation.text}-${anchor}`} initialValues={{ anchor, text: annotation.text }} layout="vertical" onFinish={(values) => {
      const { anchorType, anchorId } = splitAnchor(values.anchor);
      applyOperation((document) => updateAnnotation(document, annotation.id, { text: values.text, anchorType, anchorId }));
    }}>
      <Form.Item label="Anchor" name="anchor"><Select options={anchorOptions(documentModel)} /></Form.Item>
      <Form.Item label="Note" name="text" rules={[{ required: true, message: 'A note is required.' }]}><Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} /></Form.Item>
      <Button htmlType="submit" icon={<SaveOutlined />}>Save annotation</Button>
    </Form>
  );
}

function TransitionCard({ documentModel, selectedTransitionId, editor }) {
  const transition = documentModel.semantic.transitions.find((item) => item.id === selectedTransitionId);
  if (!transition) return <Typography.Paragraph type="secondary">Click a transition point to inspect, edit, or delete it.</Typography.Paragraph>;
  const dependencies = getTransitionDependencies(documentModel, transition.id);
  const dependentNames = [...dependencies.timingParameters, ...dependencies.phases].map((item) => item.name);
  const signalOptions = orderedSignals(documentModel).map((signal) => ({ value: signal.id, label: signal.name }));
  const removeTransition = () => {
    editor.setSelectedTransition(null);
    editor.applyOperation((document) => {
      const outcome = deleteTransitionWithDependencies(document, transition.id, { cascade: dependentNames.length > 0 });
      if (!outcome.deleted) throw new Error('Transition still has dependencies.');
      return outcome.document;
    });
  };
  return (
    <Card className="selected-transition" size="small" title="Edit selected transition">
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        <Typography.Text code>{transition.id}</Typography.Text>
        <Typography.Text>{transition.fromState} → {transition.toState}</Typography.Text>
      </Space>
      <Form key={`${transition.id}-${transition.signalId}-${transition.markerId}-${transition.toState}`} initialValues={{ signalId: transition.signalId, sequence: markerSequence(documentModel, transition.id), rightState: transition.toState }} layout="vertical" onFinish={(values) => editor.applyOperation((document) => updateTransition(document, transition.id, {
        signalId: values.signalId,
        sequence: Number(values.sequence),
        rightState: values.rightState
      }))}>
        <Form.Item label="Signal" name="signalId"><Select options={signalOptions} /></Form.Item>
        <Form.Item label="Order slot" name="sequence" rules={[{ required: true }]}><InputNumber precision={0} style={{ width: '100%' }} /></Form.Item>
        <Form.Item label="State after transition" name="rightState"><Select options={stateOptions} /></Form.Item>
        <Button htmlType="submit" icon={<SaveOutlined />}>Save transition</Button>
      </Form>
      <Typography.Paragraph type="secondary">Dependencies: {dependencies.timingParameters.length} timing, {dependencies.phases.length} phases</Typography.Paragraph>
      <Popconfirm
        cancelText="Cancel"
        description={dependentNames.length ? `This transition is used by: ${dependentNames.join(', ')}. Dependent objects will be updated or removed as required.` : undefined}
        okButtonProps={{ danger: true }}
        okText="Delete"
        onConfirm={removeTransition}
        title="Delete this transition?"
      >
        <Button danger icon={<DeleteOutlined />}>Delete transition</Button>
      </Popconfirm>
    </Card>
  );
}

function RepairInspector({ state, setRepairSelection }) {
  const objects = repairObjects(state.document);
  const selectedKey = objects.some(([key]) => key === state.repairSelection) ? state.repairSelection : objects[0]?.[0];
  const selected = objects.find(([key]) => key === selectedKey)?.[1] ?? state.document;
  return (
    <>
      <Alert description={<ul className="repair-errors">{(state.validation?.errors ?? ['Unknown import error.']).map((error) => <li key={error}>{error}</li>)}</ul>} message="Validation errors" type="error" showIcon />
      <Typography.Title level={5}>Objects received</Typography.Title>
      <Space wrap>
        {objects.length ? objects.map(([key]) => <Button key={key} onClick={() => setRepairSelection(key)} size="small" type={key === selectedKey ? 'primary' : 'default'}>{key}</Button>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
      </Space>
      <Typography.Title level={5}>Selected properties</Typography.Title>
      <pre className="repair-properties">{JSON.stringify(selected, null, 2)}</pre>
    </>
  );
}

export function Inspector({ editor }) {
  const { state, applyOperation, setRepairSelection } = editor;
  if (state.mode === 'repair') {
    return <aside aria-label="Property inspector" className="editor-panel inspector-panel"><RepairInspector setRepairSelection={setRepairSelection} state={state} /></aside>;
  }
  const documentModel = state.document;
  const signals = orderedSignals(documentModel);
  const items = [
    { key: 'metadata', label: 'Document metadata', children: <MetadataForm applyOperation={applyOperation} documentModel={documentModel} /> },
    {
      key: 'signals', label: `Signals (${signals.length})`, children: signals.length ? <Collapse className="nested-inspector-collapse" items={signals.map((signal, index) => ({
        key: signal.id,
        label: `${signal.name} · signal`,
        children: <SignalForm documentModel={documentModel} editor={editor} index={index} count={signals.length} signal={signal} />
      }))} /> : <Empty description="No signals yet." image={Empty.PRESENTED_IMAGE_SIMPLE} />
    },
    {
      key: 'timing', label: `Timing parameters (${documentModel.semantic.timingParameters.length})`, children: documentModel.semantic.timingParameters.length ? <Collapse className="nested-inspector-collapse" items={documentModel.semantic.timingParameters.map((parameter) => ({
        key: parameter.id, label: `${parameter.name} · timing parameter`, children: <TimingForm applyOperation={applyOperation} documentModel={documentModel} parameter={parameter} />
      }))} /> : <Empty description="No timing parameters yet." image={Empty.PRESENTED_IMAGE_SIMPLE} />
    },
    {
      key: 'phases', label: `Phases (${documentModel.semantic.phases.length})`, children: documentModel.semantic.phases.length ? <Collapse className="nested-inspector-collapse" items={documentModel.semantic.phases.map((phase) => ({
        key: phase.id, label: `${phase.name} · phase`, children: <PhaseForm applyOperation={applyOperation} documentModel={documentModel} phase={phase} />
      }))} /> : <Empty description="No phases yet." image={Empty.PRESENTED_IMAGE_SIMPLE} />
    },
    {
      key: 'annotations', label: `Annotations (${documentModel.semantic.annotations.length})`, children: documentModel.semantic.annotations.length ? <Collapse className="nested-inspector-collapse" items={documentModel.semantic.annotations.map((annotation) => ({
        key: annotation.id, label: `Annotation · ${annotation.text}`, children: <AnnotationForm applyOperation={applyOperation} annotation={annotation} documentModel={documentModel} />
      }))} /> : <Empty description="No annotations yet." image={Empty.PRESENTED_IMAGE_SIMPLE} />
    }
  ];
  return (
    <aside aria-label="Property inspector" className="editor-panel inspector-panel">
      <Typography.Title level={5}>Document</Typography.Title>
      <Collapse className="inspector-collapse" defaultActiveKey={['metadata']} items={items} />
      <TransitionCard documentModel={documentModel} editor={editor} selectedTransitionId={state.selectedTransitionId} />
    </aside>
  );
}
