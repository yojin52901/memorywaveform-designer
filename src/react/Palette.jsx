import {
  Alert,
  Button,
  Card,
  Collapse,
  Form,
  Input,
  InputNumber,
  List,
  Popconfirm,
  Select,
  Space,
  Typography
} from 'antd';
import { BookOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { STATES, SIGNAL_TYPES } from '../domain/constants.js';
import { addAnnotation, addPhase, addSignal, addTimingParameter, setSegmentBoundary } from '../domain/operations.js';
import { splitTags } from './editor-state.js';
import { anchorOptions, transitionOptions } from './editor-utils.js';

const stateOptions = STATES.map((value) => ({ value, label: value }));
const signalTypeOptions = SIGNAL_TYPES.map((value) => ({ value, label: value }));

function FormActions({ children }) {
  return <Space wrap>{children}</Space>;
}

function AddSignalForm({ applyOperation }) {
  return (
    <Form layout="vertical" onFinish={(values) => applyOperation((documentModel) => addSignal(documentModel, {
      ...values,
      tags: splitTags(values.tags)
    }))} initialValues={{ type: 'control', initialState: 'LOW' }}>
      <Form.Item label="Name" name="name" rules={[{ required: true, message: 'A signal name is required.' }]}>
        <Input placeholder="WE#" />
      </Form.Item>
      <Form.Item label="Type" name="type"><Select options={signalTypeOptions} /></Form.Item>
      <Form.Item label="Initial state" name="initialState"><Select options={stateOptions} /></Form.Item>
      <Form.Item label="Subtype" name="subtype"><Input placeholder="write-enable" /></Form.Item>
      <Form.Item label="Tags" name="tags"><Input placeholder="active-low, write" /></Form.Item>
      <Button htmlType="submit" icon={<PlusOutlined />} type="primary">Add signal</Button>
    </Form>
  );
}

function AddBoundaryForm({ documentModel, applyOperation }) {
  const signals = documentModel.semantic.signals.map((signal) => ({ value: signal.id, label: signal.name }));
  return (
    <Form layout="vertical" onFinish={(values) => applyOperation((document) => setSegmentBoundary(document, {
      ...values, sequence: Number(values.sequence)
    }))} initialValues={{ sequence: 1, rightState: 'HIGH' }}>
      <Form.Item label="Signal" name="signalId" rules={[{ required: true, message: 'Add a signal first.' }]}>
        <Select disabled={!signals.length} options={signals} placeholder="Choose a signal" />
      </Form.Item>
      <Form.Item label="Order slot" name="sequence" rules={[{ required: true }]}><InputNumber min={-999} precision={0} style={{ width: '100%' }} /></Form.Item>
      <Form.Item label="State after transition" name="rightState"><Select options={stateOptions} /></Form.Item>
      <Button disabled={!signals.length} htmlType="submit" icon={<PlusOutlined />} type="primary">Add boundary</Button>
    </Form>
  );
}

function AddTimingForm({ documentModel, applyOperation, beginRelationCreation }) {
  const [form] = Form.useForm();
  const transitions = transitionOptions(documentModel);
  const pickEndpoints = async () => {
    try {
      await form.validateFields(['name']);
      beginRelationCreation('timing', form.getFieldsValue());
    } catch {
      // Ant Design renders the field-level validation feedback.
    }
  };
  return (
    <Form form={form} layout="vertical" onFinish={(values) => applyOperation((document) => addTimingParameter(document, {
      ...values,
      startTransitionIds: [values.startTransitionId],
      endTransitionIds: [values.endTransitionId],
      tags: splitTags(values.tags)
    }))} initialValues={{ name: 'tWP' }}>
      <Form.Item label="Name" name="name" rules={[{ required: true, message: 'A timing name is required.' }]}><Input /></Form.Item>
      <Form.Item label="Start transition" name="startTransitionId" rules={[{ required: true, message: 'Choose a start transition.' }]}>
        <Select disabled={!transitions.length} options={transitions} />
      </Form.Item>
      <Form.Item label="End transition" name="endTransitionId" rules={[{ required: true, message: 'Choose an end transition.' }]}>
        <Select disabled={!transitions.length} options={transitions} />
      </Form.Item>
      <Form.Item label="Requirement note (optional)" name="requirementText"><Input.TextArea placeholder="Datasheet note or timing requirement" autoSize={{ minRows: 2, maxRows: 5 }} /></Form.Item>
      <Form.Item label="Tags" name="tags"><Input placeholder="write, datasheet" /></Form.Item>
      <FormActions>
        <Button disabled={!transitions.length} htmlType="submit" icon={<PlusOutlined />} type="primary">Add timing</Button>
        <Button disabled={!transitions.length} onClick={pickEndpoints}>Pick endpoints</Button>
      </FormActions>
    </Form>
  );
}

function AddPhaseForm({ documentModel, applyOperation, beginRelationCreation }) {
  const [form] = Form.useForm();
  const transitions = transitionOptions(documentModel);
  const pickEndpoints = async () => {
    try {
      await form.validateFields(['name']);
      beginRelationCreation('phase', form.getFieldsValue());
    } catch {
      // Ant Design renders the field-level validation feedback.
    }
  };
  return (
    <Form form={form} layout="vertical" onFinish={(values) => applyOperation((document) => addPhase(document, {
      ...values, tags: splitTags(values.tags)
    }))} initialValues={{ name: 'Program' }}>
      <Form.Item label="Name" name="name" rules={[{ required: true, message: 'A phase name is required.' }]}><Input /></Form.Item>
      <Form.Item label="Start transition" name="startTransitionId" rules={[{ required: true, message: 'Choose a start transition.' }]}>
        <Select disabled={!transitions.length} options={transitions} />
      </Form.Item>
      <Form.Item label="End transition" name="endTransitionId" rules={[{ required: true, message: 'Choose an end transition.' }]}>
        <Select disabled={!transitions.length} options={transitions} />
      </Form.Item>
      <Form.Item label="Tags" name="tags"><Input placeholder="program, write" /></Form.Item>
      <FormActions>
        <Button disabled={!transitions.length} htmlType="submit" icon={<PlusOutlined />} type="primary">Add phase</Button>
        <Button disabled={!transitions.length} onClick={pickEndpoints}>Pick endpoints</Button>
      </FormActions>
    </Form>
  );
}

function AddAnnotationForm({ documentModel, applyOperation }) {
  return (
    <Form layout="vertical" onFinish={(values) => {
      const [anchorType, ...anchorParts] = values.anchor.split(':');
      applyOperation((document) => addAnnotation(document, {
        text: values.text,
        anchorType,
        anchorId: anchorParts.join(':') || null
      }));
    }} initialValues={{ anchor: 'document:' }}>
      <Form.Item label="Anchor" name="anchor"><Select options={anchorOptions(documentModel)} /></Form.Item>
      <Form.Item label="Note" name="text" rules={[{ required: true, message: 'A note is required.' }]}><Input.TextArea placeholder="Review note" autoSize={{ minRows: 2, maxRows: 5 }} /></Form.Item>
      <Button htmlType="submit" icon={<PlusOutlined />} type="primary">Add note</Button>
    </Form>
  );
}

function History({ state, openExample, selectHistory, deleteHistory }) {
  const items = [...state.history.entries].sort((left, right) => right.updatedAt - left.updatedAt);
  return (
    <>
      <Card className="example-card" size="small">
        <Space direction="vertical" size={6} style={{ width: '100%' }}>
          <Button block icon={<BookOutlined />} onClick={openExample}>Example document</Button>
          <Typography.Text type="secondary">ENVM power-on → write → power-off</Typography.Text>
          <Typography.Text type="secondary">Opens a fresh, editable copy.</Typography.Text>
        </Space>
      </Card>
      <Collapse size="small" items={[{
        key: 'history',
        label: `Document history (${items.length})`,
        children: <List
          className="history-list"
          dataSource={items}
          locale={{ emptyText: 'No saved documents yet.' }}
          renderItem={(entry) => (
            <List.Item key={entry.id} className={entry.id === state.history.activeId ? 'history-entry active' : 'history-entry'}>
              <Button block onClick={() => selectHistory(entry.id)} type={entry.id === state.history.activeId ? 'primary' : 'text'}>
                <span className="history-title">{entry.title}</span>
                <span className="history-time">{new Date(entry.updatedAt).toLocaleString()}</span>
              </Button>
              <Popconfirm
                cancelText="Cancel"
                okButtonProps={{ danger: true }}
                okText="Delete"
                onConfirm={() => deleteHistory(entry.id)}
                title={`Delete ${entry.title} from document history?`}
              >
                <Button aria-label={`Delete ${entry.title}`} danger icon={<DeleteOutlined />} size="small" type="text" />
              </Popconfirm>
            </List.Item>
          )}
        />
      }]} />
    </>
  );
}

export function Palette({ editor }) {
  const { state, applyOperation, beginRelationCreation, deleteHistory, openExample, selectHistory } = editor;
  const isRepair = state.mode === 'repair';
  const authoringItems = isRepair ? [] : [
    { key: 'signal', label: 'Add signal', children: <AddSignalForm applyOperation={applyOperation} /> },
    { key: 'boundary', label: 'Add state transition', children: <AddBoundaryForm applyOperation={applyOperation} documentModel={state.document} /> },
    { key: 'timing', label: 'Timing parameter', children: <AddTimingForm applyOperation={applyOperation} beginRelationCreation={beginRelationCreation} documentModel={state.document} /> },
    { key: 'phase', label: 'Phase', children: <AddPhaseForm applyOperation={applyOperation} beginRelationCreation={beginRelationCreation} documentModel={state.document} /> },
    { key: 'annotation', label: 'Annotation', children: <AddAnnotationForm applyOperation={applyOperation} documentModel={state.document} /> }
  ];
  return (
    <aside aria-label="Authoring tools" className="editor-panel palette-panel">
      <History deleteHistory={deleteHistory} openExample={openExample} selectHistory={selectHistory} state={state} />
      {isRepair ? <Alert description="Imported JSON is not safe to render. Correct it in the raw editor, then apply it again." message="Repair mode" type="warning" showIcon /> : (
        <>
          <Typography.Title level={5}>Authoring</Typography.Title>
          {state.relationCreation && <Alert className="relation-pick-alert" description="Click the start and then end transition point on the waveform." message={`Picking ${state.relationCreation.kind} endpoints`} type="info" showIcon />}
          <Collapse className="authoring-tools" items={authoringItems} />
        </>
      )}
    </aside>
  );
}
