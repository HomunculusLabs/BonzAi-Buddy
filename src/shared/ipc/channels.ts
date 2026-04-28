export const IPC_CHANNELS = {
  app: {
    getShellState: 'app:get-shell-state'
  },
  settings: {
    getElizaPlugins: 'settings:get-eliza-plugins',
    updateElizaPlugins: 'settings:update-eliza-plugins',
    getRuntimeApprovalSettings: 'settings:get-runtime-approval-settings',
    updateRuntimeApprovalSettings: 'settings:update-runtime-approval-settings',
    getElizaCharacterSettings: 'settings:get-eliza-character-settings',
    updateElizaCharacterSettings: 'settings:update-eliza-character-settings',
    importKnowledgeDocuments: 'settings:import-knowledge-documents',
    selectKnowledgeImportFolders: 'settings:select-knowledge-import-folders',
    importKnowledgeFolders: 'settings:import-knowledge-folders',
    cancelKnowledgeImport: 'settings:cancel-knowledge-import',
    getKnowledgeImportStatus: 'settings:get-knowledge-import-status',
    getWorkspaceSettings: 'settings:get-workspace-settings',
    selectWorkspaceFolder: 'settings:select-workspace-folder',
    resetWorkspaceFolder: 'settings:reset-workspace-folder'
  },
  plugins: {
    discover: 'plugins:discover',
    install: 'plugins:install',
    uninstall: 'plugins:uninstall'
  },
  window: {
    getBounds: 'window:get-bounds',
    minimize: 'window:minimize',
    close: 'window:close',
    setPosition: 'window:set-position',
    setBounds: 'window:set-bounds',
    setMouseEventsIgnored: 'window:set-mouse-events-ignored'
  },
  assistant: {
    sendCommand: 'assistant:send-command',
    executeAction: 'assistant:execute-action',
    getHistory: 'assistant:get-history',
    resetConversation: 'assistant:reset-conversation',
    reloadRuntime: 'assistant:reload-runtime',
    getWorkflowRuns: 'assistant:get-workflow-runs',
    getWorkflowRun: 'assistant:get-workflow-run',
    respondWorkflowApproval: 'assistant:respond-workflow-approval',
    cancelWorkflow: 'assistant:cancel-workflow',
    event: 'assistant:event'
  }
} as const
