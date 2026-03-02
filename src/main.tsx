import { createRoot } from 'react-dom/client'
import './index.css'
import '@xyflow/react/dist/style.css'
import App from './App.tsx'
import SystemCoordinateOverlay from './components/SystemCoordinateOverlay'

document.addEventListener('contextmenu', (event) => {
  event.preventDefault()
})

const search = new URLSearchParams(window.location.search)
const isCoordinateOverlay = search.get('coordinateOverlay') === '1'

if (isCoordinateOverlay) {
  document.documentElement.classList.add('coordinate-overlay-mode')
}

createRoot(document.getElementById('root')!).render(
  isCoordinateOverlay ? <SystemCoordinateOverlay /> : <App />,
)
