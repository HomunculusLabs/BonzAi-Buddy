import type { ConversationController } from './conversation-controller'
import type { ShellStateController } from './shell-state-controller'

export interface AssistantCommandController {
  setInputEnabled(enabled: boolean): void
  dispose(): void
}

export interface AssistantCommandControllerOptions {
  chatFormEl: HTMLFormElement
  chatInputEl: HTMLInputElement
  assistantSendButton: HTMLButtonElement
  conversationController: ConversationController
  shellStateController: ShellStateController
}

export function createAssistantCommandController(
  options: AssistantCommandControllerOptions
): AssistantCommandController {
  const {
    chatFormEl,
    chatInputEl,
    assistantSendButton,
    conversationController,
    shellStateController
  } = options

  let commandRequestsInFlight = 0
  let appInputEnabled = true

  const setInputEnabled = (enabled: boolean): void => {
    appInputEnabled = enabled
    chatInputEl.disabled = !enabled
    assistantSendButton.disabled = !enabled
  }

  const syncAwaitingAssistant = (): void => {
    conversationController.setAwaitingAssistant(commandRequestsInFlight > 0)
  }

  const handleSubmit = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault()

    if (!window.bonzi) {
      return
    }

    const command = chatInputEl.value.trim()

    if (!command) {
      return
    }

    conversationController.addUserMessage(command)
    commandRequestsInFlight += 1
    syncAwaitingAssistant()

    chatInputEl.value = ''
    if (appInputEnabled) {
      window.requestAnimationFrame(() => {
        chatInputEl.focus()
      })
    }

    try {
      const response = await window.bonzi.assistant.sendCommand({ command })

      shellStateController.setProviderLabel(response.provider.label)

      if (response.ok && response.reply) {
        conversationController.addAssistantResponse(response)
      } else {
        conversationController.appendSystemMessage(
          response.error ??
            'The assistant did not return a reply for this command.'
        )
      }

      conversationController.setUiVisible(false)
    } catch (error) {
      conversationController.appendSystemMessage(
        `Assistant request failed: ${String(error)}`
      )
    } finally {
      commandRequestsInFlight = Math.max(0, commandRequestsInFlight - 1)
      syncAwaitingAssistant()
      setInputEnabled(appInputEnabled)

      if (conversationController.isUiVisible() && appInputEnabled) {
        chatInputEl.focus()
      }
    }
  }

  chatFormEl.addEventListener('submit', handleSubmit)

  return {
    setInputEnabled,
    dispose: () => {
      chatFormEl.removeEventListener('submit', handleSubmit)
    }
  }
}
