import { App as AntdApp, ConfigProvider, Result, Spin } from 'antd';
import { useEffect, useState } from 'react';
import { endAccountSession, getVerifiedAccount } from '../ui/account.js';
import { Editor } from './Editor.jsx';

function useAccount() {
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadAccount() {
      try {
        const verifiedAccount = await getVerifiedAccount();
        if (!cancelled) setAccount(verifiedAccount);
      } catch {
        if (!cancelled) window.location.assign('/login');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadAccount();
    return () => { cancelled = true; };
  }, []);

  const logout = async () => {
    try {
      await endAccountSession();
      window.location.assign('/login');
    } catch {
      setError('Unable to sign out. Please try again.');
    }
  };

  return { account, error, loading, logout };
}

export function App() {
  const { account, error, loading, logout } = useAccount();

  return (
    <ConfigProvider componentSize="middle" theme={{ token: { colorPrimary: '#5f57d8', borderRadius: 8 } }}>
      <AntdApp>
        {loading && <div className="react-loading" aria-live="polite"><Spin tip="Loading editor…" /></div>}
        {!loading && account && <Editor account={account} onLogout={logout} />}
        {!loading && !account && error && <Result status="error" subTitle={error} title="Account session unavailable" />}
      </AntdApp>
    </ConfigProvider>
  );
}
