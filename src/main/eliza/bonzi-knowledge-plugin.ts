import {
  ModelType,
  type Memory,
  type Plugin,
  type Provider,
  type ProviderResult,
  type State
} from '@elizaos/core/node'

const MAX_KNOWLEDGE_SNIPPET_LENGTH = 500

export function createBonziKnowledgePlugin(): Plugin {
  return {
    name: 'bonzi-knowledge',
    description:
      'Retrieves Markdown imported through Bonzi settings from the elizaOS knowledge memory table.',
    providers: [createBonziKnowledgeProvider()]
  }
}

function createBonziKnowledgeProvider(): Provider {
  return {
    name: 'KNOWLEDGE',
    description:
      'Provides relevant knowledge from Bonzi imported Markdown based on semantic similarity.',
    dynamic: false,
    get: async (runtime, message: Memory, _state?: State): Promise<ProviderResult> => {
      const queryText = message.content?.text ?? ''

      if (!queryText) {
        return createEmptyKnowledgeResult('')
      }

      const embedding = await runtime.useModel(ModelType.TEXT_EMBEDDING, {
        text: queryText
      })
      const relevantKnowledge = await runtime.searchMemories({
        tableName: 'knowledge',
        embedding,
        query: queryText,
        count: 5
      })

      if (relevantKnowledge.length === 0) {
        return createEmptyKnowledgeResult(queryText)
      }

      const entries = relevantKnowledge.flatMap((entry) => {
        const text = entry.content?.text
        if (!text) {
          return []
        }

        return [
          {
            id: entry.id?.toString() ?? '',
            text:
              text.length > MAX_KNOWLEDGE_SNIPPET_LENGTH
                ? `${text.slice(0, MAX_KNOWLEDGE_SNIPPET_LENGTH)}...`
                : text,
            source: entry.metadata?.source ?? 'unknown'
          }
        ]
      })

      if (entries.length === 0) {
        return createEmptyKnowledgeResult(queryText)
      }

      return {
        text: `# Relevant Knowledge\n${entries.map((entry) => `- ${entry.text}`).join('\n')}`,
        values: {
          knowledgeCount: entries.length,
          hasKnowledge: true
        },
        data: {
          entries,
          query: queryText
        }
      }
    }
  }
}

function createEmptyKnowledgeResult(query: string): ProviderResult {
  return {
    text: '',
    values: {
      knowledgeCount: 0,
      hasKnowledge: false
    },
    data: {
      entries: [],
      query
    }
  }
}
