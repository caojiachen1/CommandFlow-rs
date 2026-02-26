import { createRoot } from 'react-dom/client'
import './index.css'
import '@xyflow/react/dist/style.css'
import App from './App.tsx'

document.addEventListener('contextmenu', (event) => {
  event.preventDefault()
})

createRoot(document.getElementById('root')!).render(<App />)
