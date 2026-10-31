import { Component, type ComponentChildren } from "preact";

// A bug in one screen must not leave a blank page, least of all on a TV with no way to
// reload: show what happened and offer a restart.
export class ErrorBoundary extends Component<{ children: ComponentChildren }, { error: string }> {
  state = { error: "" };
  componentDidCatch(error: unknown) {
    this.setState({ error: error instanceof Error ? error.message : String(error) });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ padding: "3rem", maxWidth: "40rem" }}>
        <h2>Something went wrong</h2>
        <p style={{ color: "#98a2b8" }}>{this.state.error}</p>
        <button
          style={{ marginTop: "1rem", padding: "0.8rem 1.6rem", borderRadius: "0.6rem", background: "#5b9dff", color: "#06142e", fontWeight: 700 }}
          autoFocus
          onClick={() => {
            location.hash = "";
            location.reload();
          }}
        >
          Start over
        </button>
      </div>
    );
  }
}
