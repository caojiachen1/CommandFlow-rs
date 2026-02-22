import { create } from 'zustand'

export interface ExecutionLogItem {
  id: string
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'success'
  message: string
}

interface ExecutionState {
  running: boolean
  statusText: string
  logs: ExecutionLogItem[]
  setRunning: (running: boolean) => void
  addLog: (level: ExecutionLogItem['level'], message: string) => void
  clearLogs: () => void
}

const now = () => new Date().toISOString()

export const useExecutionStore = create<ExecutionState>((set) => ({
  running: false,
  statusText: '就绪',
  logs: [
    {
      id: crypto.randomUUID(),
      timestamp: now(),
      level: 'info',
      message: 'CommandFlow-rs 已启动，等待执行。',
    },
  ],
  setRunning: (running) =>
    set(() => ({
      running,
      statusText: running ? '执行中' : '就绪',
    })),
  addLog: (level, message) =>
    set((state) => ({
      logs: [
        ...state.logs,
        {
          id: crypto.randomUUID(),
          timestamp: now(),
          level,
          message,
        },
      ].slice(-200),
    })),
  clearLogs: () => set(() => ({ logs: [] })),
}))
