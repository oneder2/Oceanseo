import { Component, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";

export default class PageLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <section className="workspace-loading" role="alert">
      <p>这个页面暂时无法打开。已保存的记录不受影响，可以先使用其他页面。</p>
      <button className="secondary-button" type="button" onClick={() => window.location.reload()}><RotateCcw size={16} />重新载入应用</button>
    </section>;
  }
}
