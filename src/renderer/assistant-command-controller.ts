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

  const setInputEnabled = (enabled: boolean): void => {
    chatInputEl.disabled = !enabled
    assistantSendButton.disabled = !enabled
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
    conversationController.setAwaitingAssistant(true)

    chatInputEl.value = ''
    setInputEnabled(false)

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

      conversationController.setAwaitingAssistant(false)
      conversationController.setUiVisible(false)
    } catch (error) {
      conversationController.setAwaitingAssistant(false)
      conversationController.appendSystemMessage(
        `Assistant request failed: ${String(error)}`
      )
    } finally {
      conversationController.setAwaitingAssistant(false)
      setInputEnabled(true)

      if (conversationController.isUiVisible()) {
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
