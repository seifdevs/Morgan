import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

type Props = { children: ReactNode };
type State = { failed: boolean };

/** Keeps render-time React errors from leaving the workspace as a blank screen. */
export class RenderBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State { return { failed: true }; }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Avoid putting financial context or server payloads into the browser console.
    console.error('Morgan view failed to render.');
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="render-failure" role="alert">
      <span className="eyebrow">MORGAN WORKSPACE</span>
      <h1>This view couldn’t load</h1>
      <p>Try reloading Morgan. Your saved financial records are not changed by a page render error.</p>
      <div><button className="btn primary" onClick={() => window.location.reload()}>Reload Morgan</button><Link className="btn outline" to="/">Return to site</Link></div>
    </main>;
  }
}
