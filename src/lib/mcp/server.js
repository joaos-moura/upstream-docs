import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { validateLink } from './tools/validate-link.js'
import { createDocument } from './tools/create-document.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf8'))

const TOOLS = [
  {
    name: 'validate_link',
    description: 'Validate a document URL and retrieve its title and metadata. Returns provider, title, last_edited date, and any error.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The document URL to validate' },
      },
      required: ['url'],
    },
  },
  {
    name: 'create_document',
    description: 'Create a new document in the connected provider (confluence, google-docs) and return its URL.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', description: 'Provider name: confluence or google-docs' },
        title: { type: 'string', description: 'Document title' },
        content: { type: 'string', description: 'Initial document content. Google Docs: HTML. Confluence: storage format (XHTML-based).' },
        destination: {
          type: 'string',
          description: 'Parent location. Confluence: "SPACE_KEY" or "SPACE_KEY:parent_page_id". Google Docs: parent folder ID (optional).',
        },
      },
      required: ['provider', 'title', 'destination'],
    },
  },
]

export async function startMcpServer() {
  const server = new Server(
    { name: 'upstream', version },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    if (name === 'validate_link') {
      if (typeof args?.url !== 'string') throw new Error('validate_link requires a string url argument')
      const result = await validateLink(args.url)
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    }

    if (name === 'create_document') {
      if (typeof args?.provider !== 'string') throw new Error('create_document requires a string provider argument')
      if (typeof args?.title !== 'string') throw new Error('create_document requires a string title argument')
      if (typeof args?.destination !== 'string') throw new Error('create_document requires a string destination argument')
      if (!args.destination) throw new Error('create_document requires a non-empty destination argument')
      const result = await createDocument({
        provider: args.provider,
        title: args.title,
        content: args.content ?? '',
        destination: args.destination,
      })
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    }

    throw new Error(`Unknown tool: ${name}`)
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
