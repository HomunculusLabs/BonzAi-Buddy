import './styles.css'
import { renderApp } from './app'

const root = document.querySelector<HTMLDivElement>('#app')

if (!root) {
  throw new Error('Renderer root #app was not found.')
}

renderApp(root)

