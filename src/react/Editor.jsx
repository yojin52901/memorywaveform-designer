import { useEffect, useState } from 'react';
import {
  Alert,
  Avatar,
  Button,
  Card,
  Input,
  Layout,
  Modal,
  Segmented,
  Space,
  Tag,
  Typography,
  Upload
} from 'antd';
import {
  DownloadOutlined,
  ExportOutlined,
  FileAddOutlined,
  FileTextOutlined,
  ImportOutlined,
  LogoutOutlined,
  UserOutlined
} from '@ant-design/icons';
import { exportDocumentJson, getPngExportPolicy } from '../domain/import-export.js';
import { renderSvg, svgToPngBlob } from '../render/svg-renderer.js';
import { Inspector } from './Inspector.jsx';
import { Palette } from './Palette.jsx';
import { useEditor } from './use-editor.js';
import { WaveformCanvas } from './WaveformCanvas.jsx';

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function RepairEditor({ editor }) {
  const { state, repairJson } = editor;
  const [text, setText] = useState(state.repairText);
  useEffect(() => { setText(state.repairText); }, [state.repairText]);
  return (
    <section className="editor-panel canvas-panel repair-editor" aria-label="Repair imported JSON">
      <Typography.Title level={4}>Repair imported JSON</Typography.Title>
      <Typography.Paragraph type="secondary">The waveform is intentionally not rendered until all validation errors are resolved.</Typography.Paragraph>
      <Input.TextArea aria-label="Repair JSON" autoSize={false} className="repair-json" onChange={(event) => setText(event.target.value)} spellCheck={false} value={text} />
      <Button onClick={() => repairJson(text)} type="primary">Validate and apply JSON</Button>
    </section>
  );
}

function CanvasWorkspace({ editor }) {
  const { state, setView } = editor;
  if (state.mode === 'repair') return <RepairEditor editor={editor} />;
  const policy = getPngExportPolicy(state.document);
  const valid = Boolean(state.validation?.valid);
  const activeView = valid && state.view === 'json' ? 'json' : 'waveform';
  const errors = state.validation?.errors ?? [];
  return (
    <section className="editor-panel canvas-panel" aria-label="Waveform canvas">
      <div className="canvas-header">
        <div>
          <Typography.Title level={4}>{activeView === 'json' ? 'Current document JSON' : 'Waveform canvas'}</Typography.Title>
          <Typography.Text type="secondary">
            {policy.draft ? `Draft rendering: ${errors.length} validation issue${errors.length === 1 ? '' : 's'} need attention before JSON export.` : 'Validated semantic projection.'}
          </Typography.Text>
        </div>
        {valid && <Segmented aria-label="Canvas view" onChange={setView} options={[{ label: 'Waveform', value: 'waveform' }, { label: 'JSON', value: 'json' }]} value={activeView} />}
      </div>
      {policy.draft && <Alert className="validation-summary" description={<ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul>} message="Why this waveform is invalid" type="warning" showIcon />}
      {activeView === 'json' ? <pre className="document-json-view">{exportDocumentJson(state.document)}</pre> : <>
        <div className="drag-status-slot"><p className="drag-status" hidden id="drag-status" aria-live="polite" /></div>
        <WaveformCanvas editor={editor} />
      </>}
    </section>
  );
}

function Toolbar({ account, editor, onLogout }) {
  const { state, importJson, newDocument, setNotice, setView } = editor;
  const valid = state.mode === 'editor' && state.validation?.valid;
  const status = state.mode === 'repair' ? 'Repair mode' : valid ? 'Valid' : 'Draft / invalid';
  const statusColor = state.mode === 'repair' ? 'orange' : valid ? 'success' : 'warning';
  const exportJson = () => {
    try {
      downloadBlob(new Blob([exportDocumentJson(state.document)], { type: 'application/json' }), 'waveform.json');
      setNotice('Validated JSON exported.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'JSON export failed.');
    }
  };
  const exportPng = async () => {
    try {
      setView('waveform');
      const svg = renderSvg(state.document, { draft: getPngExportPolicy(state.document).draft });
      downloadBlob(await svgToPngBlob(svg), 'waveform.png');
      setNotice(getPngExportPolicy(state.document).draft ? 'Draft PNG exported with watermark.' : 'PNG exported.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'PNG export failed.');
    }
  };
  const importFile = async (file) => {
    try {
      importJson(await file.text());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to read JSON file.');
    }
    return Upload.LIST_IGNORE;
  };
  return (
    <Layout.Header className="app-toolbar">
      <div className="title-lockup">
        <Typography.Text className="eyebrow">Structured Memory Waveform Editor</Typography.Text>
        <Typography.Title level={2}>Memory Waveform Designer</Typography.Title>
      </div>
      <Space className="toolbar-actions" wrap>
        <Button icon={<FileAddOutlined />} onClick={() => Modal.confirm({
          cancelText: 'Cancel',
          content: 'The current document remains available in history.',
          okText: 'New document',
          onOk: newDocument,
          title: 'Start a new waveform document?'
        })}>New document</Button>
        <Button disabled={state.mode === 'repair'} icon={<DownloadOutlined />} onClick={exportPng}>Export PNG</Button>
        <Button disabled={!valid} icon={<ExportOutlined />} onClick={exportJson} type="primary">Export JSON</Button>
        <Upload accept="application/json" beforeUpload={importFile} showUploadList={false}>
          <Button icon={<ImportOutlined />}>Import JSON</Button>
        </Upload>
        <Tag className="document-status" color={statusColor}>{status}</Tag>
        <Space className="account-actions" size={6}>
          <Avatar icon={<UserOutlined />} size="small" />
          <Typography.Text className="account-email" title="Signed in account">{account.email}</Typography.Text>
          <Button icon={<LogoutOutlined />} onClick={onLogout} size="small">登出</Button>
        </Space>
      </Space>
    </Layout.Header>
  );
}

export function Editor({ account, onLogout }) {
  const editor = useEditor();
  const { state } = editor;
  return (
    <Layout className="waveform-app">
      <Toolbar account={account} editor={editor} onLogout={onLogout} />
      <Layout.Content className="workspace">
        <Palette editor={editor} />
        <CanvasWorkspace editor={editor} />
        <Inspector editor={editor} />
      </Layout.Content>
      {state.notice && <Alert className="notice" closable message={state.notice} onClose={() => editor.setNotice('')} showIcon type="info" />}
    </Layout>
  );
}
