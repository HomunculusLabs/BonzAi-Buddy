import './styles.css'
import { renderAdminApp } from './admin-app'
import { renderApp } from './app'

const root = document.querySelector<HTMLDivElement>('#app')

if (!root) {
  throw new Error('Renderer root #app was not found.')
}

const searchParams = new URLSearchParams(window.location.search)

if (searchParams.get('bonziAdmin') === '1') {
  renderAdminApp(root)
} else {
  renderApp(root)
}

