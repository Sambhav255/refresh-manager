import { Component } from 'react'
import { Icon } from './ui'

export class ScreenErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="content fade-in" style={{ display: 'grid', placeItems: 'center', flex: 1 }}>
          <div className="card" style={{ padding: 24, maxWidth: 420, textAlign: 'center' }}>
            <Icon name="alert-triangle" size={32} color="#ef4444" />
            <div style={{ fontSize: 16, fontWeight: 500, marginTop: 12 }}>Something went wrong</div>
            <div className="sub" style={{ marginTop: 8 }}>
              {this.state.error.message}
            </div>
            <button
              className="btn btn-primary"
              style={{ marginTop: 16 }}
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
